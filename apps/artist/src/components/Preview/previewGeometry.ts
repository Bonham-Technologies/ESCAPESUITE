// Where things are on the preview canvas.
//
// Pure functions: everything they read is a parameter, so the same maths backs
// the component's rendering, its mouse handling and its tests without a ref, a
// store subscription or a React render in sight.
import { getAnimatedValues } from '../../utils/animation';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import type { Clip, SourceVideo } from '../../store/types';
import type { ManipulableClipType, NormalizedPoint, OverlayBounds } from './types';

// Handle size in pixels (for hit detection and drawing)
export const HANDLE_SIZE = 8;
export const ROTATION_HANDLE_OFFSET = 25; // Distance above the bounding box

/**
 * Get overlay bounds in canvas pixels for a given clip.
 * Uses animated values from keyframes when available.
 *
 * Text is measured through the canvas' own 2D context, so the caller has to
 * pass the canvas the bounds are for rather than just its dimensions.
 */
export function getOverlayBounds(
  clip: Clip,
  canvas: HTMLCanvasElement,
  time: number | undefined,
  sourceVideos: SourceVideo[]
): OverlayBounds | null {
  // Calculate animated values if time is provided
  let animatedX: number | undefined;
  let animatedY: number | undefined;
  let animatedScaleX: number | undefined;
  let animatedScaleY: number | undefined;
  let animatedRotation: number | undefined;

  if (time !== undefined && clip.animation) {
    const clipTime = time - clip.timelinePosition;
    if (clipTime >= 0 && clipTime <= clip.duration) {
      // Build base transform from overlay properties
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
        clipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      animatedX = animated.x;
      animatedY = animated.y;
      animatedScaleX = animated.scaleX;
      animatedScaleY = animated.scaleY;
      animatedRotation = animated.rotation;
    }
  }

  if (clip.overlayType === 'shape' && clip.shapeData) {
    const x = animatedX ?? clip.shapeData.x;
    const y = animatedY ?? clip.shapeData.y;
    const scaleX = animatedScaleX ?? 1;
    const scaleY = animatedScaleY ?? 1;
    const rotation = animatedRotation ?? clip.shapeData.rotation;

    return {
      centerX: x * canvas.width,
      centerY: y * canvas.height,
      width: clip.shapeData.width * canvas.width * scaleX,
      height: clip.shapeData.height * canvas.height * scaleY,
      rotation,
    };
  } else if (clip.overlayType === 'text' && clip.textData) {
    // For text, we need to measure it
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const textData = clip.textData;
    const baseScale = textData.scale ?? 1;
    const scaleX = animatedScaleX ?? baseScale;
    const scaleY = animatedScaleY ?? baseScale;
    const scale = Math.max(scaleX, scaleY);
    const x = animatedX ?? textData.x;
    const y = animatedY ?? textData.y;
    const rotation = animatedRotation ?? (textData.rotation ?? 0);

    const fontStyle = textData.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = textData.fontWeight === 'bold' ? 'bold ' : '';
    // The context is the preview's own, and the next frame draws through it:
    // the measuring font has to come back off again.
    ctx.save();
    ctx.font = `${fontStyle}${fontWeight}${textData.fontSize}px ${textData.fontFamily}`;
    const lines = textData.text.split('\n');
    const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    ctx.restore();
    const lineHeight = textData.fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const textWidth = maxLineWidth * scale;
    const textHeight = totalHeight * scale;

    // Adjust center based on text alignment
    let centerX = x * canvas.width;
    if (textData.textAlign === 'left') {
      centerX += textWidth / 2;
    } else if (textData.textAlign === 'right') {
      centerX -= textWidth / 2;
    }

    return {
      centerX,
      centerY: y * canvas.height,
      width: textWidth,
      height: textHeight,
      rotation,
    };
  } else if (!clip.overlayType && clip.sourceVideoId) {
    // Image or video clip - use transform properties
    const transform = clip.transform || DEFAULT_TRANSFORM;
    const x = animatedX ?? transform.x;
    const y = animatedY ?? transform.y;
    const scaleX = animatedScaleX ?? transform.scaleX;
    const scaleY = animatedScaleY ?? transform.scaleY;
    const rotation = animatedRotation ?? (transform.rotation ?? 0);

    // Get the source media dimensions
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return null;

    // Base dimensions = native source pixels (matches drawClip)
    return {
      centerX: x * canvas.width,
      centerY: y * canvas.height,
      width: sourceMedia.width * scaleX,
      height: sourceMedia.height * scaleY,
      rotation,
    };
  }
  return null;
}

/** Helper to determine if a clip is manipulable (overlays, images, videos - not audio) */
export function isManipulableClip(clip: Clip, sourceVideos: SourceVideo[]): boolean {
  // Overlays are always manipulable
  if (clip.overlayType) return true;
  // Media clips are manipulable if they're not audio. A source that is not in
  // the list has no dimensions to draw handles around, so it is not one either.
  if (clip.sourceVideoId) {
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return false;
    return sourceMedia.mediaType !== 'audio';
  }
  return false;
}

/** Get the manipulable clip type */
export function getClipType(clip: Clip, sourceVideos: SourceVideo[]): ManipulableClipType | null {
  if (clip.overlayType === 'text') return 'text';
  if (clip.overlayType === 'shape') return 'shape';
  if (clip.sourceVideoId) {
    const sourceMedia = sourceVideos.find(s => s.id === clip.sourceVideoId);
    if (!sourceMedia) return null;
    if (sourceMedia.mediaType === 'image') return 'image';
    if (sourceMedia.mediaType === 'audio') return null;
    return 'video';
  }
  return null;
}

/** Check if a clip has custom keyframes (not just presets) */
export function hasCustomKeyframes(clip: Clip): boolean {
  if (!clip.animation?.keyframes) return false;
  const properties: ('x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'blur')[] =
    ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur'];
  for (const prop of properties) {
    const kfs = clip.animation.keyframes[prop];
    if (kfs && kfs.length > 0) return true;
  }
  return false;
}

/**
 * Get mouse position relative to canvas in normalized coordinates (0-1).
 * Accounts for object-fit: contain which letterboxes the canvas content.
 * Accepts any MouseEvent (canvas or window) so dragging works outside the canvas.
 */
export function getCanvasPosition(
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number }
): NormalizedPoint {
  const rect = canvas.getBoundingClientRect();

  // Calculate the actual rendered size of the canvas content (accounting for object-fit: contain)
  const canvasAspect = canvas.width / canvas.height;
  const elementAspect = rect.width / rect.height;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (canvasAspect > elementAspect) {
    // Canvas is wider than element - letterboxed top/bottom
    renderedWidth = rect.width;
    renderedHeight = rect.width / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - renderedHeight) / 2;
  } else {
    // Canvas is taller than element - letterboxed left/right
    renderedHeight = rect.height;
    renderedWidth = rect.height * canvasAspect;
    offsetX = (rect.width - renderedWidth) / 2;
    offsetY = 0;
  }

  // Convert mouse position to be relative to the actual canvas content area
  const mouseX = e.clientX - rect.left - offsetX;
  const mouseY = e.clientY - rect.top - offsetY;

  // Return normalized coordinates — NOT clamped, so dragging outside canvas works
  return {
    x: mouseX / renderedWidth,
    y: mouseY / renderedHeight,
  };
}
