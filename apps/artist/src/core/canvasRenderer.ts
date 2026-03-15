// Canvas rendering functions for the export pipeline
// Handles drawing clips, overlays, and transitions to canvas

import type { Clip, TextOverlayData, ShapeOverlayData } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getAnimatedValuesCached } from '../utils/animation';
import type {
  DrawableMediaSource,
  TransitionInfo,
  TransitionModifiers,
  AnimatedOverlayValues,
} from './exportTypes';
import { blendModeToCanvas, getSourceDimensions } from './exportTypes';

/**
 * Draw a text overlay to canvas with full animated transform values
 */
export function drawTextOverlayToCanvasAnimated(
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

  // Split text into lines for multi-line support
  const lines = textData.text.split('\n');
  const lineHeight = textData.fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;

  // Draw background if set
  if (textData.backgroundColor && textData.backgroundColor !== '#00000000') {
    const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    const padding = textData.fontSize * 0.3;
    const bgWidth = maxLineWidth + padding * 2;
    const bgHeight = totalHeight + padding * 2;

    let bgX = x - padding;
    if (textData.textAlign === 'center') {
      bgX = x - bgWidth / 2;
    } else if (textData.textAlign === 'right') {
      bgX = x - bgWidth + padding;
    }

    ctx.fillStyle = textData.backgroundColor;
    ctx.fillRect(bgX, y - bgHeight / 2, bgWidth, bgHeight);
  }

  // Draw each line of text
  ctx.fillStyle = textData.color;
  lines.forEach((line, i) => {
    const lineY = y - (totalHeight / 2) + (i * lineHeight) + (lineHeight / 2);
    ctx.fillText(line, x, lineY);
  });

  ctx.restore();
}

/**
 * Draw a shape overlay to canvas with full animated transform values
 */
export function drawShapeOverlayToCanvasAnimated(
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
    case 'arrow': {
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
  }

  ctx.restore();
}

/**
 * Draw a clip to canvas with transform and blend mode
 * Media sources (videos, images, VideoFrames) are scaled to fill the canvas by default
 */
export function drawClipToCanvas(
  ctx: CanvasRenderingContext2D,
  source: DrawableMediaSource,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  canvasWidth: number,
  canvasHeight: number,
  transitionModifiers?: TransitionModifiers
) {
  // Get animated values - this applies presets and custom keyframes
  // Use cached version for export performance
  const cacheKey = `${clip.id}:${clipTime.toFixed(3)}`;
  const animated = getAnimatedValuesCached(
    cacheKey,
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

  // Get source dimensions (works for VideoFrame, HTMLVideoElement, HTMLImageElement)
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source);
  const videoWidth = sourceWidth || canvasWidth;
  const videoHeight = sourceHeight || canvasHeight;

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

  // Draw the media frame (VideoFrame, HTMLVideoElement, or HTMLImageElement)
  ctx.drawImage(source, x, y, scaledWidth, scaledHeight);

  // Restore context state
  ctx.restore();
}

/**
 * Generic function to draw a clip (video or image) with transition modifiers
 */
export function drawMediaWithModifiers(
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
  if (video && video.readyState >= 1) {
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
 * Draw a clip using a pre-fetched frame with transition modifiers
 * Used when frames have been fetched via FrameManager
 */
export function drawMediaWithFrame(
  ctx: CanvasRenderingContext2D,
  frame: DrawableMediaSource | null,
  clip: Clip,
  clipTime: number,
  canvasWidth: number,
  canvasHeight: number,
  modifiers?: TransitionModifiers
): boolean {
  if (!frame) return false;

  if (frame instanceof HTMLImageElement) {
    drawImageToCanvasWithModifiers(ctx, frame, clip, clipTime, canvasWidth, canvasHeight, modifiers);
    return true;
  }

  // VideoFrame or HTMLVideoElement
  drawClipToCanvas(ctx, frame, clip, clipTime, canvasWidth, canvasHeight, modifiers);
  return true;
}

/**
 * Draw an image clip to canvas with transform and transition modifiers
 */
export function drawImageToCanvasWithModifiers(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  clip: Clip,
  clipTime: number, // Time relative to clip start (for animations)
  canvasWidth: number,
  canvasHeight: number,
  transitionModifiers?: TransitionModifiers
) {
  // Get animated values - this applies presets and custom keyframes
  // Use cached version for export performance
  const cacheKey = `${clip.id}:${clipTime.toFixed(3)}`;
  const animated = getAnimatedValuesCached(
    cacheKey,
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
export function drawTransition(
  ctx: CanvasRenderingContext2D,
  videoElements: Map<string, HTMLVideoElement>,
  imageElements: Map<string, HTMLImageElement>,
  transition: TransitionInfo,
  currentTime: number, // Current timeline time (for calculating clip times)
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const { outgoingClip, incomingClip, progress, type } = transition;

  // Calculate clip times for animations
  const outClipTime = currentTime - outgoingClip.timelinePosition;
  const inClipTime = currentTime - incomingClip.timelinePosition;

  // Check if we have media for both clips
  const hasOutgoing = videoElements.has(outgoingClip.sourceVideoId) || imageElements.has(outgoingClip.sourceVideoId);
  const hasIncoming = videoElements.has(incomingClip.sourceVideoId) || imageElements.has(incomingClip.sourceVideoId);

  if (!hasOutgoing && !hasIncoming) {
    return false;
  }

  // Check video readyState before attempting to draw
  const outgoingVideo = videoElements.get(outgoingClip.sourceVideoId);
  const incomingVideo = videoElements.get(incomingClip.sourceVideoId);

  // Warn if videos exist but aren't ready (potential black flash cause)
  // Using readyState >= 1 like preview player for forgiving rendering
  if (outgoingVideo && outgoingVideo.readyState < 1) {
    console.warn(`Transition: outgoing video not ready (readyState=${outgoingVideo.readyState}) at time ${currentTime}`);
  }
  if (incomingVideo && incomingVideo.readyState < 1) {
    console.warn(`Transition: incoming video not ready (readyState=${incomingVideo.readyState}) at time ${currentTime}`);
  }

  // If only one clip has media, draw it normally
  if (!hasOutgoing) {
    return drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, canvasWidth, canvasHeight, { opacity: progress });
  }
  if (!hasIncoming) {
    return drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, canvasWidth, canvasHeight, { opacity: 1 - progress });
  }

  const w = canvasWidth;
  const h = canvasHeight;

  switch (type) {
    case 'fade':
      // Crossfade: outgoing fades out, incoming fades in
      drawMediaWithModifiers(ctx, videoElements, imageElements, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithModifiers(ctx, videoElements, imageElements, incomingClip, inClipTime, w, h, { opacity: progress });
      break;

    case 'dissolve': {
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
    }

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

  return true;
}

/**
 * Draw a transition between two clips using pre-fetched frames
 * Used when frames have been fetched via FrameManager
 */
export function drawTransitionWithFrames(
  ctx: CanvasRenderingContext2D,
  outgoingFrame: DrawableMediaSource | null,
  incomingFrame: DrawableMediaSource | null,
  transition: TransitionInfo,
  currentTime: number,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const { outgoingClip, incomingClip, progress, type } = transition;

  // Calculate clip times for animations
  const outClipTime = currentTime - outgoingClip.timelinePosition;
  const inClipTime = currentTime - incomingClip.timelinePosition;

  const hasOutgoing = outgoingFrame !== null;
  const hasIncoming = incomingFrame !== null;

  if (!hasOutgoing && !hasIncoming) {
    return false;
  }

  // If only one clip has media, draw it normally
  if (!hasOutgoing) {
    return drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, canvasWidth, canvasHeight, { opacity: progress });
  }
  if (!hasIncoming) {
    return drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, canvasWidth, canvasHeight, { opacity: 1 - progress });
  }

  const w = canvasWidth;
  const h = canvasHeight;

  switch (type) {
    case 'fade':
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { opacity: progress });
      break;

    case 'dissolve': {
      const dissolveBlur = Math.sin(progress * Math.PI) * 3;
      ctx.save();
      if (dissolveBlur > 0) {
        ctx.filter = `blur(${dissolveBlur}px)`;
      }
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { opacity: progress });
      ctx.restore();
      break;
    }

    case 'wipe-left':
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w * (1 - progress), height: h }
      });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, {
        clipRegion: { x: w * (1 - progress), y: 0, width: w * progress, height: h }
      });
      break;

    case 'wipe-right':
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: w * progress, y: 0, width: w * (1 - progress), height: h }
      });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w * progress, height: h }
      });
      break;

    case 'wipe-up':
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: h * progress, width: w, height: h * (1 - progress) }
      });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w, height: h * progress }
      });
      break;

    case 'wipe-down':
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, {
        clipRegion: { x: 0, y: 0, width: w, height: h * (1 - progress) }
      });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, {
        clipRegion: { x: 0, y: h * (1 - progress), width: w, height: h * progress }
      });
      break;

    case 'slide-left': {
      const outX = -w * progress;
      const inX = w * (1 - progress);
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { offsetX: outX });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { offsetX: inX });
      break;
    }

    case 'slide-right': {
      const outX = w * progress;
      const inX = -w * (1 - progress);
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { offsetX: outX });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { offsetX: inX });
      break;
    }

    case 'slide-up': {
      const outY = -h * progress;
      const inY = h * (1 - progress);
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { offsetY: outY });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { offsetY: inY });
      break;
    }

    case 'slide-down': {
      const outY = h * progress;
      const inY = -h * (1 - progress);
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { offsetY: outY });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { offsetY: inY });
      break;
    }

    default:
      // Fallback: simple crossfade
      drawMediaWithFrame(ctx, outgoingFrame, outgoingClip, outClipTime, w, h, { opacity: 1 - progress });
      drawMediaWithFrame(ctx, incomingFrame, incomingClip, inClipTime, w, h, { opacity: progress });
  }

  return true;
}
