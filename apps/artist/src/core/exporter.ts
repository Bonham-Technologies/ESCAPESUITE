// Video export engine - WebM and MP4 via WebCodecs + Mediabunny
// Multi-track compositing with blend modes and transforms
// Frame-by-frame encoding for consistent output
// Supports Web Worker offloading with fallback for air-gapped environments

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { Clip, SourceVideo, Track, ExportOptions, ExportProgress, BlendMode, TransitionType, TextOverlayData, ShapeOverlayData } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValues, getAnimatedValuesCached, clearAnimationCache } from '../utils/animation';
import { drawWatermark, type WatermarkConfig } from '../utils/watermark';
import { getWorkerSupport } from '../utils/workerSupport';
import type { WorkerRequest, WorkerResponse, AudioClipMeta } from '../workers/exportWorker';

// Helper to get transition info between clips
interface TransitionInfo {
  outgoingClip: Clip;
  incomingClip: Clip;
  progress: number; // 0 = start of transition, 1 = end
  type: TransitionType;
}

function getActiveTransition(clips: Clip[], tracks: Track[], time: number): TransitionInfo | null {
  // Find clips that are in a transition period
  for (const clip of clips) {
    if (clip.transition.type === 'none' || clip.transition.duration <= 0) continue;

    const track = tracks.find(t => t.id === clip.trackId);
    if (!track || !track.visible) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    const transitionStart = clipEnd - clip.transition.duration;

    // Check if we're in the transition period
    if (time >= transitionStart && time < clipEnd) {
      // Find the incoming clip - first check same track, then look at other tracks
      // The incoming clip should be the one that will be visible when this clip ends

      // First, try to find a clip on the same track that starts at/near the end of this clip
      let incomingClip = clips
        .filter(c => c.trackId === clip.trackId && c.timelinePosition >= clipEnd - 0.01 && c.id !== clip.id)
        .sort((a, b) => a.timelinePosition - b.timelinePosition)[0];

      // If no same-track clip, find the topmost clip that will be visible at the end time
      // (excluding the current clip and overlays)
      if (!incomingClip) {
        const clipsAtEnd = clips
          .filter(c => {
            if (c.id === clip.id) return false;
            if (c.overlayType) return false; // Skip overlays
            const cEnd = c.timelinePosition + c.duration;
            return c.timelinePosition <= clipEnd && cEnd > clipEnd;
          })
          .map(c => {
            const t = tracks.find(tr => tr.id === c.trackId);
            return { clip: c, track: t };
          })
          .filter(({ track: t }) => t && t.visible)
          .sort((a, b) => (b.track?.index ?? 0) - (a.track?.index ?? 0)); // Higher index = on top

        if (clipsAtEnd.length > 0) {
          incomingClip = clipsAtEnd[0].clip;
        }
      }

      if (incomingClip) {
        const progress = (time - transitionStart) / clip.transition.duration;
        return {
          outgoingClip: clip,
          incomingClip,
          progress: Math.min(1, Math.max(0, progress)),
          type: clip.transition.type,
        };
      }
    }
  }
  return null;
}

type ProgressCallback = (progress: ExportProgress) => void;

// Map blend modes to canvas globalCompositeOperation
const blendModeToCanvas: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  add: 'lighter',
};

/**
 * Check if WebCodecs export is supported
 */
export function isMP4ExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/**
 * Check if WebM export via WebCodecs is supported
 */
export function isWebMExportSupported(): boolean {
  return isMP4ExportSupported();
}

/**
 * Get quality settings based on quality option
 */
function getQualitySettings(quality: ExportOptions['quality']) {
  switch (quality) {
    case 'low':
      return { videoBitrate: 2_000_000, audioBitrate: 128_000 };
    case 'medium':
      return { videoBitrate: 5_000_000, audioBitrate: 192_000 };
    case 'high':
      return { videoBitrate: 10_000_000, audioBitrate: 256_000 };
  }
}

/**
 * Get resolution dimensions
 */
function getResolution(
  resolution: ExportOptions['resolution'],
  originalWidth: number,
  originalHeight: number
): { width: number; height: number } {
  if (resolution === 'original') {
    return {
      width: originalWidth % 2 === 0 ? originalWidth : originalWidth + 1,
      height: originalHeight % 2 === 0 ? originalHeight : originalHeight + 1
    };
  }

  const targetHeights: Record<string, number> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
  };

  const targetHeight = targetHeights[resolution] || originalHeight;
  const aspectRatio = originalWidth / originalHeight;
  const width = Math.round(targetHeight * aspectRatio);

  return {
    width: width % 2 === 0 ? width : width + 1,
    height: targetHeight % 2 === 0 ? targetHeight : targetHeight + 1,
  };
}

/**
 * Load a video blob and create an HTMLVideoElement
 */
async function loadVideoElement(blob: Blob): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.muted = true;

    const url = URL.createObjectURL(blob);
    video.src = url;

    video.onloadeddata = () => {
      resolve(video);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };
  });
}

/**
 * Load an image blob and create an HTMLImageElement
 */
async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(blob);
    img.src = url;

    img.onload = () => {
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
  });
}

// Animated values type for overlays
interface AnimatedOverlayValues {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blur: number;
}

/**
 * Draw a text overlay to canvas with full animated transform values
 */
function drawTextOverlayToCanvasAnimated(
  ctx: CanvasRenderingContext2D,
  textData: TextOverlayData,
  canvasWidth: number,
  canvasHeight: number,
  animated: AnimatedOverlayValues
) {
  ctx.save();
  ctx.globalAlpha = animated.opacity;

  // Apply blur effect if specified
  if (animated.blur > 0) {
    ctx.filter = `blur(${animated.blur}px)`;
  }

  // Use animated position instead of textData position
  const x = animated.x * canvasWidth;
  const y = animated.y * canvasHeight;

  // Apply animated rotation and scale around the text position
  ctx.translate(x, y);
  if (animated.rotation !== 0) {
    ctx.rotate((animated.rotation * Math.PI) / 180);
  }
  // Use the larger of scaleX/scaleY for uniform text scaling
  const scale = Math.max(animated.scaleX, animated.scaleY);
  if (scale !== 1) {
    ctx.scale(scale, scale);
  }
  ctx.translate(-x, -y);

  // Set up font
  const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
  const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
  ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
  ctx.textAlign = textData.textAlign;
  ctx.textBaseline = 'middle';

  // Draw background if set
  if (textData.backgroundColor && textData.backgroundColor !== '#00000000') {
    const metrics = ctx.measureText(textData.text);
    const padding = textData.fontSize * 0.3;
    const bgWidth = metrics.width + padding * 2;
    const bgHeight = textData.fontSize * 1.4;

    let bgX = x - padding;
    if (textData.textAlign === 'center') {
      bgX = x - bgWidth / 2;
    } else if (textData.textAlign === 'right') {
      bgX = x - bgWidth + padding;
    }

    ctx.fillStyle = textData.backgroundColor;
    ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
  }

  // Draw text
  ctx.fillStyle = textData.color;
  ctx.fillText(textData.text, x, y);

  ctx.restore();
}

/**
 * Draw a shape overlay to canvas with full animated transform values
 */
function drawShapeOverlayToCanvasAnimated(
  ctx: CanvasRenderingContext2D,
  shapeData: ShapeOverlayData,
  canvasWidth: number,
  canvasHeight: number,
  animated: AnimatedOverlayValues,
  canvas?: HTMLCanvasElement | OffscreenCanvas
) {
  // Use animated position
  const centerX = animated.x * canvasWidth;
  const centerY = animated.y * canvasHeight;
  // Apply animated scale to shape dimensions
  const width = shapeData.width * canvasWidth * animated.scaleX;
  const height = shapeData.height * canvasHeight * animated.scaleY;
  const rotation = animated.rotation;
  const blurAmount = shapeData.blurAmount ?? 0;

  // Helper to create shape path
  const createShapePath = () => {
    ctx.beginPath();
    switch (shapeData.type) {
      case 'rectangle':
        ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
        break;
      case 'ellipse':
      case 'blur':
        ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
        break;
      default:
        ctx.rect(centerX - width / 2, centerY - height / 2, width, height);
    }
  };

  // If blur is enabled, capture and blur the region underneath
  const effectiveBlurAmount = shapeData.type === 'blur' ? (blurAmount || 10) : blurAmount;
  if (effectiveBlurAmount > 0 && canvas && (shapeData.type === 'rectangle' || shapeData.type === 'ellipse' || shapeData.type === 'blur')) {
    const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight);
    const offCtx = offscreen.getContext('2d');
    if (offCtx) {
      offCtx.drawImage(canvas, 0, 0);

      ctx.save();

      if (rotation !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }

      createShapePath();
      ctx.clip();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${effectiveBlurAmount}px)`;
      ctx.globalAlpha = animated.opacity;
      ctx.drawImage(offscreen, 0, 0);

      ctx.restore();
    }
  }

  // Draw the fill color
  ctx.save();
  ctx.globalAlpha = animated.opacity;

  // Apply animated blur effect to the shape itself
  if (animated.blur > 0) {
    ctx.filter = `blur(${animated.blur}px)`;
  }

  if (rotation !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  ctx.fillStyle = shapeData.fillColor;
  ctx.strokeStyle = shapeData.strokeColor;
  ctx.lineWidth = shapeData.strokeWidth;

  const hasVisibleFill = shapeData.fillColor && !shapeData.fillColor.endsWith('00');

  switch (shapeData.type) {
    case 'rectangle':
      if (hasVisibleFill) {
        ctx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
      }
      if (shapeData.strokeWidth > 0) {
        ctx.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
      }
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
      if (hasVisibleFill) {
        ctx.fill();
      }
      if (shapeData.strokeWidth > 0) {
        ctx.stroke();
      }
      break;
    case 'blur':
      // Blur type only applies blur effect, no fill/stroke
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(centerX - width / 2, centerY);
      ctx.lineTo(centerX + width / 2, centerY);
      ctx.stroke();
      break;
    case 'arrow':
      const arrowSize = Math.min(width, height) * 0.2;
      ctx.beginPath();
      ctx.moveTo(centerX - width / 2, centerY);
      ctx.lineTo(centerX + width / 2 - arrowSize, centerY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX + width / 2, centerY);
      ctx.lineTo(centerX + width / 2 - arrowSize, centerY - arrowSize / 2);
      ctx.lineTo(centerX + width / 2 - arrowSize, centerY + arrowSize / 2);
      ctx.closePath();
      ctx.fill();
      break;
  }

  ctx.restore();
}

/**
 * Wait for video to seek to a specific time with retry
 */
async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve(); // Resolve anyway to prevent blocking
    }, 500);

    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      // Small delay to ensure frame is ready
      setTimeout(resolve, 10);
    };

    if (Math.abs(video.currentTime - time) < 0.02) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    video.addEventListener('seeked', onSeeked);
    video.currentTime = Math.max(0, Math.min(time, video.duration || time));
  });
}

// Track last seek position per video to avoid redundant seeks
const lastSeekPositions = new Map<string, number>();

/**
 * Optimized seek that skips if we're already at the target time
 * Uses frame-level tolerance (1 frame at 30fps = ~0.033s)
 */
async function seekVideoOptimized(
  video: HTMLVideoElement,
  time: number,
  videoId: string,
  frameRate: number = 30
): Promise<void> {
  const frameTolerance = 1 / frameRate;
  const lastPosition = lastSeekPositions.get(videoId);

  // Skip seek if we're already within one frame of the target
  // This is the most common case during sequential playback
  if (lastPosition !== undefined && Math.abs(lastPosition - time) < frameTolerance) {
    // Still update to exact time for tracking
    lastSeekPositions.set(videoId, time);
    return;
  }

  // Also check actual video position
  if (Math.abs(video.currentTime - time) < frameTolerance) {
    lastSeekPositions.set(videoId, time);
    return;
  }

  await seekVideo(video, time);
  lastSeekPositions.set(videoId, time);
}

/**
 * Clear seek position tracking (call at start of export)
 */
function clearSeekPositions(): void {
  lastSeekPositions.clear();
}

// Transition modifiers for drawing clips during transitions
interface TransitionModifiers {
  opacity?: number;
  offsetX?: number;
  offsetY?: number;
  clipRegion?: { x: number; y: number; width: number; height: number };
}

/**
 * Draw a clip to canvas with transform and blend mode
 * Videos are scaled to fill the canvas by default (scale 1.0 = fill canvas)
 */
function drawClipToCanvas(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  canvasWidth: number,
  canvasHeight: number,
  transitionModifiers?: TransitionModifiers
) {
  // Get animated values - this applies presets and custom keyframes
  const animated = getAnimatedValues(
    clipTime,
    clip.duration,
    clip.animation,
    clip.transform || DEFAULT_TRANSFORM,
    clip.effects || DEFAULT_EFFECTS
  );

  // Save context state
  ctx.save();

  // Set blend mode
  ctx.globalCompositeOperation = blendModeToCanvas[clip.blendMode] || 'source-over';

  // Apply opacity with transition modifier
  const baseOpacity = animated.opacity;
  const finalOpacity = transitionModifiers?.opacity !== undefined
    ? baseOpacity * transitionModifiers.opacity
    : baseOpacity;
  ctx.globalAlpha = finalOpacity;

  // Apply blur effect (from animation or static)
  const blurAmount = animated.blur;
  if (blurAmount > 0) {
    ctx.filter = `blur(${blurAmount}px)`;
  }

  // Apply clip region for wipe transitions
  if (transitionModifiers?.clipRegion) {
    const { x, y, width, height } = transitionModifiers.clipRegion;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  // Get video dimensions
  const videoWidth = video.videoWidth || canvasWidth;
  const videoHeight = video.videoHeight || canvasHeight;

  // Calculate scale to fill canvas (cover mode - fills canvas, may crop)
  const videoAspect = videoWidth / videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let baseWidth: number;
  let baseHeight: number;

  if (videoAspect > canvasAspect) {
    // Video is wider - fit to height, crop width
    baseHeight = canvasHeight;
    baseWidth = canvasHeight * videoAspect;
  } else {
    // Video is taller - fit to width, crop height
    baseWidth = canvasWidth;
    baseHeight = canvasWidth / videoAspect;
  }

  // Apply animated scale on top of the base fill size
  const scaledWidth = baseWidth * animated.scaleX;
  const scaledHeight = baseHeight * animated.scaleY;

  // Apply animated position with transition offset
  const offsetX = transitionModifiers?.offsetX || 0;
  const offsetY = transitionModifiers?.offsetY || 0;
  const centerX = (animated.x * canvasWidth) + offsetX;
  const centerY = (animated.y * canvasHeight) + offsetY;

  // Apply rotation around center point
  if (animated.rotation !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((animated.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  const x = centerX - (scaledWidth / 2);
  const y = centerY - (scaledHeight / 2);

  // Draw the video frame
  ctx.drawImage(video, x, y, scaledWidth, scaledHeight);

  // Restore context state
  ctx.restore();
}

/**
 * Generic function to draw a clip (video or image) with transition modifiers
 */
function drawMediaWithModifiers(
  ctx: CanvasRenderingContext2D,
  videoElements: Map<string, HTMLVideoElement>,
  imageElements: Map<string, HTMLImageElement>,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  canvasWidth: number,
  canvasHeight: number,
  modifiers?: TransitionModifiers
) {
  const video = videoElements.get(clip.sourceVideoId);
  if (video && video.readyState >= 2) {
    drawClipToCanvas(ctx, video, clip, clipTime, canvasWidth, canvasHeight, modifiers);
    return true;
  }

  const image = imageElements.get(clip.sourceVideoId);
  if (image) {
    drawImageToCanvasWithModifiers(ctx, image, clip, clipTime, canvasWidth, canvasHeight, modifiers);
    return true;
  }

  return false;
}

/**
 * Draw an image clip to canvas with transform and transition modifiers
 */
function drawImageToCanvasWithModifiers(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  canvasWidth: number,
  canvasHeight: number,
  transitionModifiers?: TransitionModifiers
) {
  // Get animated values - this applies presets and custom keyframes
  const animated = getAnimatedValues(
    clipTime,
    clip.duration,
    clip.animation,
    clip.transform || DEFAULT_TRANSFORM,
    clip.effects || DEFAULT_EFFECTS
  );

  ctx.save();

  // Set blend mode
  ctx.globalCompositeOperation = blendModeToCanvas[clip.blendMode] || 'source-over';

  // Apply opacity with transition modifier
  const baseOpacity = animated.opacity;
  const finalOpacity = transitionModifiers?.opacity !== undefined
    ? baseOpacity * transitionModifiers.opacity
    : baseOpacity;
  ctx.globalAlpha = finalOpacity;

  // Apply blur effect (from animation or static)
  const blurAmount = animated.blur;
  if (blurAmount > 0) {
    ctx.filter = `blur(${blurAmount}px)`;
  }

  // Apply clip region for wipe transitions
  if (transitionModifiers?.clipRegion) {
    const { x, y, width, height } = transitionModifiers.clipRegion;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  // Get image dimensions
  const imageWidth = image.naturalWidth || canvasWidth;
  const imageHeight = image.naturalHeight || canvasHeight;

  // Calculate scale to fill canvas (cover mode)
  const imageAspect = imageWidth / imageHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let baseWidth: number;
  let baseHeight: number;

  if (imageAspect > canvasAspect) {
    baseHeight = canvasHeight;
    baseWidth = canvasHeight * imageAspect;
  } else {
    baseWidth = canvasWidth;
    baseHeight = canvasWidth / imageAspect;
  }

  // Apply animated scale
  const scaledWidth = baseWidth * animated.scaleX;
  const scaledHeight = baseHeight * animated.scaleY;

  // Apply animated position with transition offset
  const offsetX = transitionModifiers?.offsetX || 0;
  const offsetY = transitionModifiers?.offsetY || 0;
  const centerX = (animated.x * canvasWidth) + offsetX;
  const centerY = (animated.y * canvasHeight) + offsetY;

  // Apply rotation around center point
  if (animated.rotation !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((animated.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  const x = centerX - (scaledWidth / 2);
  const y = centerY - (scaledHeight / 2);

  // Draw the image
  ctx.drawImage(image, x, y, scaledWidth, scaledHeight);

  ctx.restore();
}

/**
 * Draw a transition between two clips (supports both video and image)
 */
function drawTransition(
  ctx: CanvasRenderingContext2D,
  videoElements: Map<string, HTMLVideoElement>,
  imageElements: Map<string, HTMLImageElement>,
  transition: TransitionInfo,
  currentTime: number, // Current timeline time (for calculating clip times)
  canvasWidth: number,
  canvasHeight: number
) {
  const { outgoingClip, incomingClip, progress, type } = transition;

  // Calculate clip times for animations
  const outClipTime = currentTime - outgoingClip.timelinePosition;
  const inClipTime = currentTime - incomingClip.timelinePosition;

  // Check if we have media for both clips
  const hasOutgoing = videoElements.has(outgoingClip.sourceVideoId) || imageElements.has(outgoingClip.sourceVideoId);
  const hasIncoming = videoElements.has(incomingClip.sourceVideoId) || imageElements.has(incomingClip.sourceVideoId);

  if (!hasOutgoing && !hasIncoming) {
    return;
  }

  // If only one clip has media, draw it normally
  if (!hasOutgoing) {
    drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, canvasWidth, canvasHeight, { opacity: progress });
    return;
  }
  if (!hasIncoming) {
    drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, canvasWidth, canvasHeight, { opacity: 1 - progress });
    return;
  }

  const w = canvasWidth;
  const h = canvasHeight;

  switch (type) {
    case 'fade':
      // Crossfade: outgoing fades out, incoming fades in
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { opacity: progress });
      break;

    case 'dissolve':
      // Similar to fade but with slight blur effect during transition
      const dissolveBlur = Math.sin(progress * Math.PI) * 3;
      ctx.save();
      if (dissolveBlur > 0) {
        ctx.filter = `blur(${dissolveBlur}px)`;
      }
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { opacity: progress });
      ctx.restore();
      break;

    case 'wipe-left':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w * (1 - progress), height: h }
      });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, {
        clipRegion: { x: w * (1 - progress), y: 0, width: w * progress, height: h }
      });
      break;

    case 'wipe-right':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: w * progress, y: 0, width: w * (1 - progress), height: h }
      });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w * progress, height: h }
      });
      break;

    case 'wipe-up':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w, height: h * (1 - progress) }
      });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: h * (1 - progress), width: w, height: h * progress }
      });
      break;

    case 'wipe-down':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: h * progress, width: w, height: h * (1 - progress) }
      });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w, height: h * progress }
      });
      break;

    case 'slide-left':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { offsetX: -w * progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { offsetX: w * (1 - progress) });
      break;

    case 'slide-right':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { offsetX: w * progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { offsetX: -w * (1 - progress) });
      break;

    case 'slide-up':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { offsetY: -h * progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { offsetY: h * (1 - progress) });
      break;

    case 'slide-down':
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { offsetY: h * progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { offsetY: -h * (1 - progress) });
      break;

    default:
      // For 'none' or unknown types, just draw normally
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h);
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h);
  }
}

/**
 * Calculate total timeline duration from clips
 */
function calculateTimelineDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  return Math.max(...clips.map(c => c.timelinePosition + c.duration));
}

/**
 * Extract audio from video files and mix for export
 * Returns audio data as Float32Array stereo interleaved at 48000Hz
 */
async function extractAndMixAudio(
  clips: Clip[],
  tracks: Track[],
  totalDuration: number,
  onProgress: (percent: number) => void
): Promise<Float32Array | null> {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.ceil(totalDuration * sampleRate);

  // Create output buffer (stereo interleaved)
  const outputBuffer = new Float32Array(totalSamples * channels);

  // Create offline audio context for decoding
  const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

  // Track which clips have audio
  let hasAnyAudio = false;

  // Process each clip
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const track = tracks.find(t => t.id === clip.trackId);

    // Skip muted tracks
    if (track?.muted) continue;

    // Get track volume (default to 1 if not set)
    const trackVolume = track?.volume ?? 1;

    try {
      const blob = await getVideoBlob(clip.sourceVideoId);
      if (!blob) continue;

      // Decode audio from blob
      const arrayBuffer = await blob.arrayBuffer();
      let audioBuffer: AudioBuffer;

      try {
        audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));
      } catch {
        // No audio in this video
        continue;
      }

      hasAnyAudio = true;

      // Calculate positions
      const clipStartInTimeline = clip.timelinePosition;
      const clipSourceStart = clip.startTime;
      const clipDuration = clip.duration;

      // Sample positions
      const outputStartSample = Math.floor(clipStartInTimeline * sampleRate);
      const sourceStartSample = Math.floor(clipSourceStart * sampleRate);
      const durationSamples = Math.floor(clipDuration * sampleRate);

      // Get audio data from source
      for (let ch = 0; ch < Math.min(channels, audioBuffer.numberOfChannels); ch++) {
        const sourceData = audioBuffer.getChannelData(ch);

        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + ch;

          if (sourceIdx >= 0 && sourceIdx < sourceData.length && outputIdx >= 0 && outputIdx < outputBuffer.length) {
            // Mix (add) audio with track volume - could cause clipping, but simple for now
            outputBuffer[outputIdx] += sourceData[sourceIdx] * trackVolume;
          }
        }
      }

      // If mono source, copy to both channels
      if (audioBuffer.numberOfChannels === 1) {
        const sourceData = audioBuffer.getChannelData(0);
        for (let s = 0; s < durationSamples; s++) {
          const sourceIdx = sourceStartSample + s;
          const outputIdx = (outputStartSample + s) * channels + 1;

          if (sourceIdx >= 0 && sourceIdx < sourceData.length && outputIdx >= 0 && outputIdx < outputBuffer.length) {
            outputBuffer[outputIdx] += sourceData[sourceIdx] * trackVolume;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to extract audio from clip:', e);
    }

    onProgress((i + 1) / clips.length * 100);
  }

  if (!hasAnyAudio) {
    return null;
  }

  // Normalize to prevent clipping
  let maxSample = 0;
  for (let i = 0; i < outputBuffer.length; i++) {
    maxSample = Math.max(maxSample, Math.abs(outputBuffer[i]));
  }

  if (maxSample > 1) {
    const scale = 0.95 / maxSample;
    for (let i = 0; i < outputBuffer.length; i++) {
      outputBuffer[i] *= scale;
    }
  }

  return outputBuffer;
}

/**
 * Extract and mix audio using Web Worker
 * Falls back to main thread if worker is unavailable
 */
async function extractAndMixAudioWithWorker(
  clips: Clip[],
  tracks: Track[],
  totalDuration: number,
  onProgress: (percent: number) => void
): Promise<Float32Array | null> {
  // Check worker support
  const canUseWorker = await getWorkerSupport();

  if (!canUseWorker) {
    // Fall back to main thread extraction
    return extractAndMixAudio(clips, tracks, totalDuration, onProgress);
  }

  try {
    // Create worker from bundled code
    const workerUrl = new URL('../workers/exportWorker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });

    // Collect audio blobs and metadata
    const audioBlobs: ArrayBuffer[] = [];
    const clipMeta: AudioClipMeta[] = [];
    const sourceIndexMap = new Map<string, number>();

    for (const clip of clips) {
      if (!clip.sourceVideoId) continue;

      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) continue;

      // Get blob if not already loaded
      if (!sourceIndexMap.has(clip.sourceVideoId)) {
        const blob = await getVideoBlob(clip.sourceVideoId);
        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          sourceIndexMap.set(clip.sourceVideoId, audioBlobs.length);
          audioBlobs.push(arrayBuffer);
        }
      }

      const sourceIndex = sourceIndexMap.get(clip.sourceVideoId);
      if (sourceIndex === undefined) continue;

      clipMeta.push({
        sourceIndex,
        clipId: clip.id,
        trackId: clip.trackId,
        trackVolume: track.volume ?? 1,
        trackMuted: track.muted,
        sourceStartTime: clip.startTime,
        clipDuration: clip.duration,
        timelinePosition: clip.timelinePosition,
      });
    }

    // Initialize worker
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 5000);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'INIT_COMPLETE') {
          clearTimeout(timeout);
          resolve();
        } else if (e.data.type === 'ERROR') {
          clearTimeout(timeout);
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Worker error: ${e.message}`));
      };

      worker.postMessage({
        type: 'INIT',
        clips,
        tracks,
        totalDuration,
      } as WorkerRequest);
    });

    // Request audio extraction
    const audioResult = await new Promise<Float32Array | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio extraction timeout')), 60000);

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'AUDIO_READY') {
          clearTimeout(timeout);
          resolve(e.data.hasAudio ? e.data.audioBuffer : null);
        } else if (e.data.type === 'AUDIO_PROGRESS') {
          onProgress(e.data.progress);
        } else if (e.data.type === 'ERROR') {
          clearTimeout(timeout);
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Worker error: ${e.message}`));
      };

      // Transfer audio blobs to worker
      worker.postMessage(
        {
          type: 'EXTRACT_AUDIO',
          audioBlobs,
          clipMeta,
        } as WorkerRequest,
        { transfer: audioBlobs }
      );
    });

    // Terminate worker
    worker.postMessage({ type: 'TERMINATE' } as WorkerRequest);
    worker.terminate();

    return audioResult;
  } catch (error) {
    console.warn('Worker audio extraction failed, falling back to main thread:', error);
    // Fall back to main thread extraction
    return extractAndMixAudio(clips, tracks, totalDuration, onProgress);
  }
}

/**
 * Export timeline to WebM using WebCodecs + webm-muxer
 * Frame-by-frame encoding with proper seeking support
 */
export async function exportToWebM(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  watermark?: WatermarkConfig | null
): Promise<Blob> {
  if (!isWebMExportSupported()) {
    throw new Error('WebM export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  // Clear optimization caches at start of export
  clearSeekPositions();
  clearAnimationCache();

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

  // Use the bottom-most track's source dimensions as the base
  // Lower track index = base layer, typically the main video content
  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  let baseWidth = 1920; // Default resolution for overlay-only exports
  let baseHeight = 1080;

  // Sort clips by track index (lower = base/bottom) and find the bottom-most media clip with dimensions
  const sortedClips = [...clips].sort((a, b) => {
    const trackA = exportTracks.find(t => t.id === a.trackId);
    const trackB = exportTracks.find(t => t.id === b.trackId);
    return (trackA?.index ?? 0) - (trackB?.index ?? 0); // Lower index first
  });

  for (const clip of sortedClips) {
    if (clip.overlayType) continue; // Skip overlay clips
    const source = sourceMap.get(clip.sourceVideoId);
    if (source && source.width && source.height) {
      baseWidth = source.width;
      baseHeight = source.height;
      break; // Use bottom-most source with dimensions
    }
  }

  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight);
  const { videoBitrate, audioBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = 48000;

  // Calculate total duration
  const totalDuration = calculateTimelineDuration(clips);
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first (uses Web Worker if available, falls back to main thread)
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  const audioData = await extractAndMixAudioWithWorker(clips, exportTracks, totalDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });

  // Create canvas for frame rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Load all unique source media (videos and images)
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video (skip audio-only files for visual rendering)
        try {
          const video = await loadVideoElement(blob);
          videoElements.set(sourceId, video);
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  onProgress({ phase: 'encoding', progress: 15, message: 'Initializing encoder...' });

  // Create Mediabunny output with WebM format
  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });

  // Create video and audio packet sources
  const videoSource = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(videoSource, { frameRate });

  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioData) {
    audioSource = new EncodedAudioPacketSource('opus');
    output.addAudioTrack(audioSource);
  }

  // Start the output
  await output.start();

  // Create video encoder
  let encodedFrames = 0;
  const videoEncoder = new VideoEncoder({
    output: async (chunk, meta) => {
      await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      encodedFrames++;
    },
    error: (e) => {
      console.error('Video encoder error:', e);
    },
  });

  await videoEncoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: videoBitrate,
    framerate: frameRate,
  });

  // Create audio encoder if we have audio
  let audioEncoder: AudioEncoder | null = null;
  if (audioData && audioSource) {
    audioEncoder = new AudioEncoder({
      output: async (chunk, meta) => {
        await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Audio encoder error:', e);
      },
    });

    await audioEncoder.configure({
      codec: 'opus',
      sampleRate,
      numberOfChannels: 2,
      bitrate: audioBitrate,
    });
  }

  onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });

  // Process frame by frame
  const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);
  let frameCount = 0;

  for (let currentTime = 0; currentTime < totalDuration; currentTime += 1 / frameRate) {
    // Check for active transition
    const activeTransition = getActiveTransition(clips, exportTracks, currentTime);

    // Get all clips at current time
    const activeClips = getClipsAtTime(clips, exportTracks, currentTime);

    // Clear canvas to black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Separate media clips from overlay clips
    const mediaClips: typeof activeClips = [];
    const overlayClips: typeof activeClips = [];

    for (const clipData of activeClips) {
      if (clipData.clip.overlayType) {
        overlayClips.push(clipData);
      } else {
        mediaClips.push(clipData);
      }
    }

    // Seek all active videos to correct positions first (using optimized seek)
    const seekPromises: Promise<void>[] = [];
    for (const { clip, clipTime } of mediaClips) {
      const video = videoElements.get(clip.sourceVideoId);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      seekPromises.push(seekVideoOptimized(video, sourceTime, clip.sourceVideoId, frameRate));
    }

    // Also seek transition clips if in a transition
    if (activeTransition) {
      const incomingVideo = videoElements.get(activeTransition.incomingClip.sourceVideoId);
      if (incomingVideo) {
        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const incomingClipTime = currentTime - clipEnd;
        if (incomingClipTime >= 0) {
          const sourceTime = activeTransition.incomingClip.startTime + incomingClipTime;
          seekPromises.push(seekVideoOptimized(incomingVideo, sourceTime, activeTransition.incomingClip.sourceVideoId, frameRate));
        } else {
          seekPromises.push(seekVideoOptimized(incomingVideo, activeTransition.incomingClip.startTime, activeTransition.incomingClip.sourceVideoId, frameRate));
        }
      }
    }

    await Promise.all(seekPromises);

    // Helper to calculate clip time
    const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

    // Draw each media clip (bottom to top by track index)
    for (const { clip } of mediaClips) {
      // Skip clips that are part of an active transition
      if (activeTransition &&
          (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
        continue;
      }

      const clipTime = getClipTime(clip);

      // Try video first, then image
      const video = videoElements.get(clip.sourceVideoId);
      if (video && video.readyState >= 2) {
        drawClipToCanvas(ctx, video, clip, clipTime, width, height);
        continue;
      }

      const image = imageElements.get(clip.sourceVideoId);
      if (image) {
        drawImageToCanvasWithModifiers(ctx, image, clip, clipTime, width, height);
      }
    }

    // Draw transition if active
    if (activeTransition) {
      drawTransition(ctx, videoElements, imageElements, activeTransition, currentTime, width, height);
    }

    // Draw overlay clips in track order (lower index = rendered first = behind)
    // This ensures blur overlays on higher tracks can blur content on lower tracks
    const sortedOverlayClips = [...overlayClips].sort((a, b) => {
      return (a.track?.index || 0) - (b.track?.index || 0);
    });

    for (const { clip } of sortedOverlayClips) {
      const overlayClipTime = getClipTime(clip);

      // Build base transform from overlay's own properties
      let baseTransform = clip.transform || DEFAULT_TRANSFORM;

      if (clip.overlayType === 'text' && clip.textData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.textData.x,
          y: clip.textData.y,
          scaleX: clip.textData.scale ?? 1,
          scaleY: clip.textData.scale ?? 1,
          rotation: clip.textData.rotation ?? 0,
        };
      } else if (clip.overlayType === 'shape' && clip.shapeData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.shapeData.x,
          y: clip.shapeData.y,
          rotation: clip.shapeData.rotation,
        };
      }

      const animated = getAnimatedValues(
        overlayClipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      if (clip.overlayType === 'shape' && clip.shapeData) {
        drawShapeOverlayToCanvasAnimated(ctx, clip.shapeData, width, height, animated, canvas);
      } else if (clip.overlayType === 'text' && clip.textData) {
        drawTextOverlayToCanvasAnimated(ctx, clip.textData, width, height, animated);
      }
    }

    // Draw watermark if enabled (for trial users)
    if (watermark) {
      drawWatermark(ctx, width, height, watermark);
    }

    // Create VideoFrame from canvas
    const timestamp = Math.round(currentTime * 1_000_000);
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDurationUs,
    });

    // Encode frame (keyframe every 2 seconds)
    const keyFrame = frameCount % (frameRate * 2) === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    frameCount++;

    // Update progress periodically
    if (frameCount % 5 === 0 || frameCount === totalFrames) {
      const progress = 18 + (frameCount / totalFrames) * 70;
      onProgress({
        phase: 'encoding',
        progress: Math.min(progress, 88),
        message: `Encoding frame ${frameCount}/${totalFrames}...`,
      });

      // Yield to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Encode audio in chunks if available
  if (audioEncoder && audioData) {
    onProgress({ phase: 'encoding', progress: 89, message: 'Encoding audio...' });

    const samplesPerChunk = sampleRate; // 1 second chunks
    const totalSamples = audioData.length / 2; // audioData is interleaved stereo
    const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * samplesPerChunk;
      const endSample = Math.min((i + 1) * samplesPerChunk, totalSamples);
      const chunkSamples = endSample - startSample;

      // Create planar audio data (left channel first, then right channel)
      const chunkData = new Float32Array(chunkSamples * 2);

      // Left channel (first half)
      for (let s = 0; s < chunkSamples; s++) {
        chunkData[s] = audioData[(startSample + s) * 2]; // Left from interleaved
      }
      // Right channel (second half)
      for (let s = 0; s < chunkSamples; s++) {
        chunkData[chunkSamples + s] = audioData[(startSample + s) * 2 + 1]; // Right from interleaved
      }

      const audioDataObj = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: chunkSamples,
        numberOfChannels: 2,
        timestamp: Math.round((startSample / sampleRate) * 1_000_000),
        data: chunkData,
      });

      audioEncoder.encode(audioDataObj);
      audioDataObj.close();
    }
  }

  // Flush and finalize
  onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing WebM...' });

  await videoEncoder.flush();
  videoEncoder.close();

  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
  }

  await output.finalize();

  // Clean up media elements
  videoElements.forEach((v) => {
    URL.revokeObjectURL(v.src);
  });
  imageElements.forEach((img) => {
    URL.revokeObjectURL(img.src);
  });

  onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

  // Get the final buffer
  const buffer = target.buffer;
  if (!buffer) {
    throw new Error('Export failed: no data was written to buffer');
  }
  return new Blob([buffer], { type: 'video/webm' });
}

/**
 * Export timeline to MP4 using WebCodecs + Mediabunny
 * Frame-by-frame encoding with H.264 video and AAC audio
 */
export async function exportToMP4(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  watermark?: WatermarkConfig | null
): Promise<Blob> {
  if (!isMP4ExportSupported()) {
    throw new Error('MP4 export requires WebCodecs API (Chrome/Edge)');
  }

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  // Clear optimization caches at start of export
  clearSeekPositions();
  clearAnimationCache();

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing MP4 export...' });

  // Use the bottom-most track's source dimensions as the base
  // Lower track index = base layer, typically the main video content
  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  let baseWidth = 1920; // Default resolution for overlay-only exports
  let baseHeight = 1080;

  // Sort clips by track index (lower = base/bottom) and find the bottom-most media clip with dimensions
  const sortedClips = [...clips].sort((a, b) => {
    const trackA = exportTracks.find(t => t.id === a.trackId);
    const trackB = exportTracks.find(t => t.id === b.trackId);
    return (trackA?.index ?? 0) - (trackB?.index ?? 0); // Lower index first
  });

  for (const clip of sortedClips) {
    if (clip.overlayType) continue; // Skip overlay clips
    const source = sourceMap.get(clip.sourceVideoId);
    if (source && source.width && source.height) {
      baseWidth = source.width;
      baseHeight = source.height;
      break; // Use bottom-most source with dimensions
    }
  }

  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight);
  const { videoBitrate } = getQualitySettings(options.quality);
  const frameRate = 30;
  const sampleRate = 48000;

  // Calculate total duration
  const totalDuration = calculateTimelineDuration(clips);
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Extract and mix audio first (uses Web Worker if available, falls back to main thread)
  onProgress({ phase: 'preparing', progress: 2, message: 'Extracting audio...' });

  let audioData: Float32Array | null = await extractAndMixAudioWithWorker(clips, exportTracks, totalDuration, (p) => {
    onProgress({ phase: 'preparing', progress: 2 + p * 0.08, message: 'Extracting audio...' });
  });

  // Create canvas for frame rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Load all unique source media (videos and images)
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video (skip audio-only files for visual rendering)
        try {
          const video = await loadVideoElement(blob);
          videoElements.set(sourceId, video);
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  onProgress({ phase: 'encoding', progress: 15, message: 'Initializing encoder...' });

  // Create Mediabunny output with MP4 format
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'in-memory',
    }),
    target,
  });

  // Create video packet source
  const videoSource = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(videoSource, { frameRate });

  // Create audio packet source if we have audio
  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioData) {
    // Check if AAC is supported
    const aacConfig = {
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128000, // Use standard 128kbps - widely supported
    };

    try {
      const support = await AudioEncoder.isConfigSupported(aacConfig);
      if (!support.supported) {
        console.warn('AAC not supported, exporting without audio');
        audioData = null;
      } else {
        audioSource = new EncodedAudioPacketSource('aac');
        output.addAudioTrack(audioSource);
      }
    } catch (e) {
      console.warn('Failed to check AAC support, exporting without audio:', e);
      audioData = null;
    }
  }

  // Start the output
  await output.start();

  // Create video encoder
  const videoEncoder = new VideoEncoder({
    output: async (chunk, meta) => {
      await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta);
    },
    error: (e) => {
      console.error('Video encoder error:', e);
    },
  });

  await videoEncoder.configure({
    codec: 'avc1.640028', // H.264 High Profile Level 4.0 for better quality
    width,
    height,
    bitrate: videoBitrate,
    framerate: frameRate,
  });

  // Create audio encoder if we have audio
  let audioEncoder: AudioEncoder | null = null;
  if (audioData && audioSource) {
    const aacConfig = {
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128000,
    };

    audioEncoder = new AudioEncoder({
      output: async (chunk, meta) => {
        await audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (e) => {
        console.error('Audio encoder error:', e);
      },
    });

    await audioEncoder.configure(aacConfig);
  }

  const frameDurationUs = Math.round((1 / frameRate) * 1_000_000);
  let frameCount = 0;

  onProgress({ phase: 'encoding', progress: 18, message: 'Encoding frames...' });

  // Process frame by frame
  for (let currentTime = 0; currentTime < totalDuration; currentTime += 1 / frameRate) {
    // Check for active transition
    const activeTransition = getActiveTransition(clips, exportTracks, currentTime);

    // Get all clips at current time
    const activeClips = getClipsAtTime(clips, exportTracks, currentTime);

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Separate media clips from overlay clips
    const mediaClips: typeof activeClips = [];
    const overlayClips: typeof activeClips = [];

    for (const clipData of activeClips) {
      if (clipData.clip.overlayType) {
        overlayClips.push(clipData);
      } else {
        mediaClips.push(clipData);
      }
    }

    // Seek all active videos first (using optimized seek)
    const seekPromises: Promise<void>[] = [];
    for (const { clip, clipTime } of mediaClips) {
      const video = videoElements.get(clip.sourceVideoId);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      seekPromises.push(seekVideoOptimized(video, sourceTime, clip.sourceVideoId, frameRate));
    }

    // Also seek transition clips if in a transition
    if (activeTransition) {
      const incomingVideo = videoElements.get(activeTransition.incomingClip.sourceVideoId);
      if (incomingVideo) {
        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const incomingClipTime = currentTime - clipEnd;
        if (incomingClipTime >= 0) {
          const sourceTime = activeTransition.incomingClip.startTime + incomingClipTime;
          seekPromises.push(seekVideoOptimized(incomingVideo, sourceTime, activeTransition.incomingClip.sourceVideoId, frameRate));
        } else {
          seekPromises.push(seekVideoOptimized(incomingVideo, activeTransition.incomingClip.startTime, activeTransition.incomingClip.sourceVideoId, frameRate));
        }
      }
    }

    await Promise.all(seekPromises);

    // Helper to calculate clip time
    const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

    // Composite each media clip (bottom to top by track index)
    for (const { clip } of mediaClips) {
      // Skip clips that are part of an active transition
      if (activeTransition &&
          (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
        continue;
      }

      const clipTime = getClipTime(clip);

      // Try video first, then image
      const video = videoElements.get(clip.sourceVideoId);
      if (video && video.readyState >= 2) {
        drawClipToCanvas(ctx, video, clip, clipTime, width, height);
        continue;
      }

      const image = imageElements.get(clip.sourceVideoId);
      if (image) {
        drawImageToCanvasWithModifiers(ctx, image, clip, clipTime, width, height);
      }
    }

    // Draw transition if active
    if (activeTransition) {
      drawTransition(ctx, videoElements, imageElements, activeTransition, currentTime, width, height);
    }

    // Draw overlay clips in track order (lower index = rendered first = behind)
    // This ensures blur overlays on higher tracks can blur content on lower tracks
    const sortedOverlayClips = [...overlayClips].sort((a, b) => {
      return (a.track?.index || 0) - (b.track?.index || 0);
    });

    for (const { clip } of sortedOverlayClips) {
      const overlayClipTime = getClipTime(clip);

      // Build base transform from overlay's own properties
      let baseTransform = clip.transform || DEFAULT_TRANSFORM;

      if (clip.overlayType === 'text' && clip.textData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.textData.x,
          y: clip.textData.y,
          scaleX: clip.textData.scale ?? 1,
          scaleY: clip.textData.scale ?? 1,
          rotation: clip.textData.rotation ?? 0,
        };
      } else if (clip.overlayType === 'shape' && clip.shapeData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.shapeData.x,
          y: clip.shapeData.y,
          rotation: clip.shapeData.rotation,
        };
      }

      const animated = getAnimatedValues(
        overlayClipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      if (clip.overlayType === 'shape' && clip.shapeData) {
        drawShapeOverlayToCanvasAnimated(ctx, clip.shapeData, width, height, animated, canvas);
      } else if (clip.overlayType === 'text' && clip.textData) {
        drawTextOverlayToCanvasAnimated(ctx, clip.textData, width, height, animated);
      }
    }

    // Draw watermark if enabled (for trial users)
    if (watermark) {
      drawWatermark(ctx, width, height, watermark);
    }

    // Create VideoFrame from canvas
    const timestamp = Math.round(currentTime * 1_000_000);
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDurationUs,
    });

    // Encode frame (keyframe every 2 seconds)
    const keyFrame = frameCount % (frameRate * 2) === 0;
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    frameCount++;

    // Update progress periodically
    if (frameCount % 5 === 0 || frameCount === totalFrames) {
      const progress = 18 + (frameCount / totalFrames) * 70;
      onProgress({
        phase: 'encoding',
        progress: Math.min(progress, 88),
        message: `Encoding frame ${frameCount}/${totalFrames}...`,
      });

      // Yield to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Encode audio in chunks if available
  if (audioEncoder && audioData) {
    onProgress({ phase: 'encoding', progress: 89, message: 'Encoding audio...' });

    const samplesPerChunk = sampleRate; // 1 second chunks
    const totalSamples = audioData.length / 2; // audioData is interleaved stereo
    const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * samplesPerChunk;
      const endSample = Math.min((i + 1) * samplesPerChunk, totalSamples);
      const chunkSamples = endSample - startSample;

      // Create planar audio data (left channel first, then right channel)
      const chunkData = new Float32Array(chunkSamples * 2);

      // Left channel (first half)
      for (let s = 0; s < chunkSamples; s++) {
        chunkData[s] = audioData[(startSample + s) * 2]; // Left from interleaved
      }
      // Right channel (second half)
      for (let s = 0; s < chunkSamples; s++) {
        chunkData[chunkSamples + s] = audioData[(startSample + s) * 2 + 1]; // Right from interleaved
      }

      const audioDataObj = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: chunkSamples,
        numberOfChannels: 2,
        timestamp: Math.round((startSample / sampleRate) * 1_000_000),
        data: chunkData,
      });

      audioEncoder.encode(audioDataObj);
      audioDataObj.close();
    }
  }

  // Flush and finalize
  onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing MP4...' });

  await videoEncoder.flush();
  videoEncoder.close();

  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
  }

  await output.finalize();

  // Clean up media elements
  videoElements.forEach((v) => {
    URL.revokeObjectURL(v.src);
  });
  imageElements.forEach((img) => {
    URL.revokeObjectURL(img.src);
  });

  onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

  // Get the final buffer
  const buffer = target.buffer;
  if (!buffer) {
    throw new Error('Export failed: no data was written to buffer');
  }
  return new Blob([buffer], { type: 'video/mp4' });
}
