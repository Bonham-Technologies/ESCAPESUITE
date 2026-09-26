// Canvas rendering functions for the export pipeline
// Handles drawing clips, overlays, and transitions to canvas

import type { Clip, TextOverlayData, ShapeOverlayData, TransitionType } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getAnimatedValues } from '../utils/animation';
import type {
  DrawableMediaSource,
  MediaDrawOptions,
  TransitionInfo,
  TransitionModifiers,
  AnimatedOverlayValues,
} from './exportTypes';
import { blendModeToCanvas, getSourceDimensions } from './exportTypes';
import { drawWithMaskAndStroke } from './clipMask';

/**
 * The animated transform/effect values of a clip at one instant.
 *
 * Always computed. There used to be a memo cache here keyed by clip id and
 * clip time, but an export draws each clip time exactly once, so the key never
 * came round again and the cache was pure overhead; a preview redraws the same
 * clip at the same time after every edit, so it could not use the cache at all
 * without showing pre-edit values.
 */
function animatedValuesFor(clip: Clip, clipTime: number) {
  return getAnimatedValues(
    clipTime,
    clip.duration,
    clip.animation,
    clip.transform || DEFAULT_TRANSFORM,
    clip.effects || DEFAULT_EFFECTS
  );
}

/**
 * Whether a fill colour paints anything.
 *
 * Exported because the inspector has to agree with the canvas about it: a shape
 * the renderer fills must not show "no fill" in the panel beside it.
 *
 * The editors write a shape fill as eight-digit #RRGGBBAA and set the alpha to
 * '00' for "no fill", so a zero alpha is the only invisible case they can
 * produce — no shape fill is ever `transparent` or an `rgba()` string. A
 * six-digit #RRGGBB carries no alpha and is fully opaque, which is why this
 * cannot simply test the last two characters: that reads pure red (#ff0000)
 * and black (#000000) as transparent.
 */
export function hasVisibleFill(fillColor: string): boolean {
  if (!fillColor) return false;
  return !/^#[0-9a-f]{6}00$/i.test(fillColor);
}

/**
 * A blur radius given in drawing units, as `ctx.filter` wants it.
 *
 * `filter` lengths are pixels of the output bitmap and ignore the current
 * transform, so a caller whose canvas is not 1:1 with the coordinates it draws
 * in has to say so (see `MediaDrawOptions.filterScale`). For every canvas that
 * is its own project — all of them but the preview — the scale is 1 and this is
 * the string it always was.
 */
function blurFilter(radius: number, filterScale: number = 1): string {
  return `blur(${radius * filterScale}px)`;
}

/**
 * Apply a clip's own blur to the context.
 *
 * A clip with no blur of its own leaves the context's filter alone, so an
 * ambient one — the blur a dissolve puts on both sides of the transition —
 * survives. That is why the preview and an export blur a dissolve alike.
 */
function applyClipBlur(ctx: CanvasRenderingContext2D, blurAmount: number, filterScale?: number) {
  if (blurAmount > 0) {
    ctx.filter = blurFilter(blurAmount, filterScale);
  }
}

/**
 * Draw a text overlay to canvas with full animated transform values
 */
export function drawTextOverlayToCanvasAnimated(
  ctx: CanvasRenderingContext2D,
  textData: TextOverlayData,
  canvasWidth: number,
  canvasHeight: number,
  animated: AnimatedOverlayValues,
  /** Device pixels per drawing unit; see `MediaDrawOptions.filterScale`. */
  filterScale?: number
) {
  ctx.save();
  ctx.globalAlpha = animated.opacity;

  // Apply blur effect if specified
  if (animated.blur > 0) {
    ctx.filter = blurFilter(animated.blur, filterScale);
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
 * Whether a shape overlay blurs what is behind it, and so needs the frame so
 * far captured for it. Exported so a caller can skip preparing that capture —
 * the preview allocates its scratch canvas off the back of this.
 */
export function shapeBlursBackground(shapeData: ShapeOverlayData): boolean {
  if (shapeData.type !== 'rectangle' && shapeData.type !== 'ellipse' && shapeData.type !== 'blur') {
    return false;
  }
  return effectiveShapeBlur(shapeData) > 0;
}

/** A blur shape blurs by 10px unless it says otherwise; any other shape only if asked. */
function effectiveShapeBlur(shapeData: ShapeOverlayData): number {
  const blurAmount = shapeData.blurAmount ?? 0;
  return shapeData.type === 'blur' ? (blurAmount || 10) : blurAmount;
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
  canvas?: HTMLCanvasElement | OffscreenCanvas,
  scratch?: HTMLCanvasElement,
  /** Device pixels per drawing unit; see `MediaDrawOptions.filterScale`. */
  filterScale?: number
) {
  // Use animated position
  const centerX = animated.x * canvasWidth;
  const centerY = animated.y * canvasHeight;
  // Apply animated scale to shape dimensions
  const width = shapeData.width * canvasWidth * animated.scaleX;
  const height = shapeData.height * canvasHeight * animated.scaleY;
  const rotation = animated.rotation;

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
  const effectiveBlurAmount = effectiveShapeBlur(shapeData);
  if (canvas && shapeBlursBackground(shapeData)) {
    // A caller that redraws continuously (the preview) hands in one scratch
    // canvas to reuse: a fresh full-size canvas per frame costs megabytes.
    // An export draws each frame once, so it just allocates one.
    //
    // The capture is in the source canvas' *own* pixels — `drawImage` with no
    // size draws it at its intrinsic size, and it is handed back below at the
    // identity transform — so the scratch is sized to the canvas rather than to
    // the project. For an exporter's canvas the two are the same number; for
    // the preview, which rasterises at the size it is displayed at, the canvas
    // is the smaller of the two and the blur is correspondingly cheaper.
    const offscreen = scratch ?? new OffscreenCanvas(canvas.width, canvas.height);
    const offCtx = (offscreen as HTMLCanvasElement).getContext('2d');
    if (offCtx) {
      // A reused canvas still holds the previous frame's capture.
      if (scratch) offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      offCtx.drawImage(canvas, 0, 0);

      ctx.save();

      if (rotation !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }

      createShapePath();
      ctx.clip();

      // The capture is the canvas' own pixels, so it goes back at the identity
      // transform — and the blur radius is in those same pixels.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = blurFilter(effectiveBlurAmount, filterScale);
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
    ctx.filter = blurFilter(animated.blur, filterScale);
  }

  if (rotation !== 0) {
    ctx.translate(centerX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }

  ctx.fillStyle = shapeData.fillColor;
  ctx.strokeStyle = shapeData.strokeColor;
  ctx.lineWidth = shapeData.strokeWidth;

  const fillIsVisible = hasVisibleFill(shapeData.fillColor);

  switch (shapeData.type) {
    case 'rectangle':
      if (fillIsVisible) {
        ctx.fillRect(centerX - width / 2, centerY - height / 2, width, height);
      }
      if (shapeData.strokeWidth > 0) {
        ctx.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
      }
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
      if (fillIsVisible) {
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
  transitionModifiers?: TransitionModifiers,
  options?: MediaDrawOptions
) {
  // Get animated values - this applies presets and custom keyframes
  const animated = animatedValuesFor(clip, clipTime);

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
  applyClipBlur(ctx, animated.blur, options?.filterScale);

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

  // Base dimensions = native source pixels.
  // Scale 1.0 = actual source size on the canvas.
  const scaledWidth = videoWidth * animated.scaleX;
  const scaledHeight = videoHeight * animated.scaleY;

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

  // The mask and the stroke (ESCSUITE-65). This function and
  // `drawImageToCanvasWithModifiers` are the only two places either is drawn,
  // and every pipeline funnels through them — the preview, both exports, both
  // transition paths and the headless renderer — so a mask written here is a
  // mask drawn everywhere.
  //
  // Here rather than anywhere else because this is after the rotation block
  // above (so the mask turns with the clip) and after the drawn box is known.
  // A wipe transition's own clip() is already in effect and the two regions
  // intersect, which is the right composition. The mask needs no save of its
  // own: the outer save/restore this function already makes covers it. The
  // stroke is the one thing that needs a second save, and pays for it alone.
  //
  // The order lives in `drawWithMaskAndStroke` rather than being written out
  // here and again in the image draw: the two are near-duplicates, and the
  // spec's named risk is exactly that they drift apart.
  //
  // It draws the media frame (VideoFrame, HTMLVideoElement or HTMLImageElement)
  // itself, on the same five arguments the bare ctx.drawImage() here used to.
  drawWithMaskAndStroke(
    ctx,
    source,
    clip.mask,
    clip.stroke,
    x,
    y,
    scaledWidth,
    scaledHeight,
    canvasWidth
  );

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
  modifiers?: TransitionModifiers,
  options?: MediaDrawOptions
) {
  const video = videoElements.get(clip.sourceVideoId);
  if (video && video.readyState >= 1) {
    drawClipToCanvas(ctx, video, clip, clipTime, canvasWidth, canvasHeight, modifiers, options);
    return true;
  }

  const image = imageElements.get(clip.sourceVideoId);
  if (image) {
    drawImageToCanvasWithModifiers(ctx, image, clip, clipTime, canvasWidth, canvasHeight, modifiers, options);
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
  transitionModifiers?: TransitionModifiers,
  options?: MediaDrawOptions
) {
  // Get animated values - this applies presets and custom keyframes
  const animated = animatedValuesFor(clip, clipTime);

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
  applyClipBlur(ctx, animated.blur, options?.filterScale);

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

  // Base dimensions = native source pixels.
  // Scale 1.0 = actual source size on the canvas.
  const scaledWidth = imageWidth * animated.scaleX;
  const scaledHeight = imageHeight * animated.scaleY;

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

  // The mask and the stroke (ESCSUITE-65) — the same call as `drawClipToCanvas`,
  // in the same place, for the reasons argued in full there. These two
  // near-duplicate functions are the *only* two places either is drawn, and a
  // mask added to one and not the other would give videos a mask and images
  // none.
  //
  // It draws the image itself, on the same five arguments the bare
  // ctx.drawImage() here used to.
  drawWithMaskAndStroke(
    ctx,
    image,
    clip.mask,
    clip.stroke,
    x,
    y,
    scaledWidth,
    scaledHeight,
    canvasWidth
  );

  ctx.restore();
}

/** Which end of a transition a clip is: the one leaving, or the one arriving. */
type TransitionSide = 'outgoing' | 'incoming';

/**
 * The modifiers one side of a transition draws with at a given progress.
 *
 * The geometry of a transition lives here and nowhere else, so the two
 * renderers agree with each other, and — the reason it is a function rather
 * than two switch statements — so a transition with media on only one side
 * still draws that side the way the transition says, instead of fading it.
 *
 * Returns null for a type with no geometry of its own ('none', and anything
 * unrecognised); each pipeline has its own idea of what to do then. A
 * dissolve's blur is not a modifier — it is a filter on the context, set by
 * the caller around both draws.
 */
function transitionModifiersFor(
  type: TransitionType,
  progress: number,
  side: TransitionSide,
  w: number,
  h: number
): TransitionModifiers | null {
  const outgoing = side === 'outgoing';

  switch (type) {
    case 'fade':
    case 'dissolve':
      return { opacity: outgoing ? 1 - progress : progress };

    case 'wipe-left':
      return outgoing
        ? { clipRegion: { x: 0, y: 0, width: w * (1 - progress), height: h } }
        : { clipRegion: { x: w * (1 - progress), y: 0, width: w * progress, height: h } };

    case 'wipe-right':
      return outgoing
        ? { clipRegion: { x: w * progress, y: 0, width: w * (1 - progress), height: h } }
        : { clipRegion: { x: 0, y: 0, width: w * progress, height: h } };

    // wipe-up reveals the incoming clip from the bottom and wipe-down from the
    // top, in both renderers and the preview: the same clip must not wipe one
    // way in a WebM export and the other way in an MP4 one.
    case 'wipe-up':
      return outgoing
        ? { clipRegion: { x: 0, y: 0, width: w, height: h * (1 - progress) } }
        : { clipRegion: { x: 0, y: h * (1 - progress), width: w, height: h * progress } };

    case 'wipe-down':
      return outgoing
        ? { clipRegion: { x: 0, y: h * progress, width: w, height: h * (1 - progress) } }
        : { clipRegion: { x: 0, y: 0, width: w, height: h * progress } };

    case 'slide-left':
      return { offsetX: outgoing ? -w * progress : w * (1 - progress) };

    case 'slide-right':
      return { offsetX: outgoing ? w * progress : -w * (1 - progress) };

    case 'slide-up':
      return { offsetY: outgoing ? -h * progress : h * (1 - progress) };

    case 'slide-down':
      return { offsetY: outgoing ? h * progress : -h * (1 - progress) };

    default:
      return null;
  }
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
  canvasHeight: number,
  options?: MediaDrawOptions
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
  if (!options?.quiet) {
    if (outgoingVideo && outgoingVideo.readyState < 1) {
      console.warn(`Transition: outgoing video not ready (readyState=${outgoingVideo.readyState}) at time ${currentTime}`);
    }
    if (incomingVideo && incomingVideo.readyState < 1) {
      console.warn(`Transition: incoming video not ready (readyState=${incomingVideo.readyState}) at time ${currentTime}`);
    }
  }

  const w = canvasWidth;
  const h = canvasHeight;

  const drawSide = (side: TransitionSide): boolean => {
    const clip = side === 'outgoing' ? outgoingClip : incomingClip;
    const clipTime = side === 'outgoing' ? outClipTime : inClipTime;
    return drawMediaWithModifiers(
      ctx,
      videoElements,
      imageElements,
      clip,
      clipTime,
      w,
      h,
      transitionModifiersFor(type, progress, side, w, h) ?? undefined,
      options
    );
  };

  // A dissolve's blur belongs to the transition rather than to either side, so
  // it is set on the context around the draws instead of handed down as a
  // modifier — including when only one side has media to draw.
  if (type === 'dissolve') {
    const dissolveBlur = Math.sin(progress * Math.PI) * 3;
    ctx.save();
    if (dissolveBlur > 0) {
      ctx.filter = blurFilter(dissolveBlur, options?.filterScale);
    }
    const drewOutgoing = hasOutgoing && drawSide('outgoing');
    const drewIncoming = hasIncoming && drawSide('incoming');
    ctx.restore();
    return drewOutgoing || drewIncoming;
  }

  // One side missing is still this transition, not a fade: the side that is
  // there gets the very modifiers the two-sided path would have given it.
  if (!hasOutgoing) return drawSide('incoming');
  if (!hasIncoming) return drawSide('outgoing');

  drawSide('outgoing');
  drawSide('incoming');

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

  const w = canvasWidth;
  const h = canvasHeight;

  // This pipeline's fallback for a type it does not know is a crossfade, where
  // the element-based one draws both sides untouched.
  const crossfade = (side: TransitionSide): TransitionModifiers =>
    side === 'outgoing' ? { opacity: 1 - progress } : { opacity: progress };

  const drawSide = (side: TransitionSide): boolean => {
    const frame = side === 'outgoing' ? outgoingFrame : incomingFrame;
    const clip = side === 'outgoing' ? outgoingClip : incomingClip;
    const clipTime = side === 'outgoing' ? outClipTime : inClipTime;
    return drawMediaWithFrame(
      ctx,
      frame,
      clip,
      clipTime,
      w,
      h,
      transitionModifiersFor(type, progress, side, w, h) ?? crossfade(side)
    );
  };

  if (type === 'dissolve') {
    // No filterScale here: this pipeline draws decoded VideoFrames, which only
    // an export has, and an export's canvas is always its own project.
    const dissolveBlur = Math.sin(progress * Math.PI) * 3;
    ctx.save();
    if (dissolveBlur > 0) {
      ctx.filter = `blur(${dissolveBlur}px)`;
    }
    const drewOutgoing = hasOutgoing && drawSide('outgoing');
    const drewIncoming = hasIncoming && drawSide('incoming');
    ctx.restore();
    return drewOutgoing || drewIncoming;
  }

  // One side missing is still this transition, not a fade.
  if (!hasOutgoing) return drawSide('incoming');
  if (!hasIncoming) return drawSide('outgoing');

  drawSide('outgoing');
  drawSide('incoming');

  return true;
}
