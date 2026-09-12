// The measurements a pointer gesture takes, with no pointer in sight.
//
// A drag needs to know where the clip *was* when the button went down, a
// marquee needs to know which clips its rectangle swept, and a double-click
// needs to know which text it landed on. All three are questions about the
// canvas and the timeline alone — no React state, no refs, no event objects —
// so they live here rather than inside the mouse state machine that asks them.
import { getAnimatedValues } from '../../utils/animation';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../../store/types';
import type { Clip, SourceVideo, Track } from '../../store/types';
import { getClipsAtTime } from '../../store/projectStore';
import * as geometry from './previewGeometry';
import type { ManipulableClipType } from './types';

/**
 * Where a clip starts a drag from: position and size in the canvas' own 0-1
 * space, rotation in degrees, scale as a multiplier.
 */
export interface DragStartMeasurements {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  startScaleX: number;
  startScaleY: number;
}

/**
 * Measure the clip a drag is about to move, as it stands right now.
 *
 * In keyframe mode the numbers come from the clip's *animated* state at the
 * playhead — the drag continues from what the eye can see, not from the
 * untouched base transform the keyframes are animating away from.
 */
export function measureDragStart(
  clip: Clip,
  clipType: ManipulableClipType,
  canvas: HTMLCanvasElement | null,
  currentTime: number,
  isKeyframeMode: boolean,
  sourceVideos: SourceVideo[]
): DragStartMeasurements {
  let startX = 0, startY = 0, startWidth = 0, startHeight = 0, startRotation = 0, startScaleX = 1, startScaleY = 1;

  const boundsOf = (time: number) =>
    canvas ? geometry.getOverlayBounds(clip, canvas, time, sourceVideos) : null;

  if (isKeyframeMode && canvas) {
    // Use animated values from getOverlayBounds
    const bounds = boundsOf(currentTime);
    if (bounds) {
      startX = bounds.centerX / canvas.width;
      startY = bounds.centerY / canvas.height;
      startWidth = bounds.width / canvas.width;
      startHeight = bounds.height / canvas.height;
      startRotation = bounds.rotation;
      // For scale, we need to calculate from the animated scale
      if (clip.overlayType === 'text' && clip.textData) {
        const baseScale = clip.textData.scale ?? 1;
        // Get animated scale from the bounds vs base text size
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const fontStyle = clip.textData.fontStyle === 'italic' ? 'italic ' : '';
          const fontWeight = clip.textData.fontWeight === 'bold' ? 'bold ' : '';
          // Same context the preview draws the next frame through: put the
          // font back where it was once the measurement is taken.
          ctx.save();
          ctx.font = `${fontStyle}${fontWeight}${clip.textData.fontSize}px ${clip.textData.fontFamily}`;
          const metrics = ctx.measureText(clip.textData.text);
          ctx.restore();
          const baseWidth = metrics.width * baseScale;
          startScaleX = bounds.width / baseWidth * baseScale;
          startScaleY = startScaleX;
        } else {
          startScaleX = baseScale;
          startScaleY = baseScale;
        }
      } else if (clipType === 'image' || clipType === 'video') {
        // For image/video clips, get the current animated scale values
        const transform = clip.transform || DEFAULT_TRANSFORM;
        const timeInClip = currentTime - clip.timelinePosition;
        const animatedValues = getAnimatedValues(
          timeInClip,
          clip.duration,
          clip.animation,
          transform,
          clip.effects || DEFAULT_EFFECTS
        );
        startScaleX = animatedValues.scaleX;
        startScaleY = animatedValues.scaleY;
      }
    }
  } else if (clipType === 'text' && clip.textData) {
    startX = clip.textData.x;
    startY = clip.textData.y;
    startRotation = clip.textData.rotation ?? 0;
    startScaleX = clip.textData.scale ?? 1;
    startScaleY = startScaleX;
    // Estimate text dimensions for resizing
    if (canvas) {
      const bounds = boundsOf(currentTime);
      if (bounds) {
        startWidth = bounds.width / canvas.width;
        startHeight = bounds.height / canvas.height;
      }
    }
  } else if (clipType === 'shape' && clip.shapeData) {
    startX = clip.shapeData.x;
    startY = clip.shapeData.y;
    startWidth = clip.shapeData.width;
    startHeight = clip.shapeData.height;
    startRotation = clip.shapeData.rotation;
  } else if (clipType === 'image' || clipType === 'video') {
    // Image or video clip - use transform properties
    const transform = clip.transform || DEFAULT_TRANSFORM;
    startX = transform.x;
    startY = transform.y;
    startScaleX = transform.scaleX;
    startScaleY = transform.scaleY;
    startRotation = transform.rotation ?? 0;
    // Get dimensions from bounds
    if (canvas) {
      const bounds = boundsOf(currentTime);
      if (bounds) {
        startWidth = bounds.width / canvas.width;
        startHeight = bounds.height / canvas.height;
      }
    }
  }

  return { startX, startY, startWidth, startHeight, startRotation, startScaleX, startScaleY };
}

/**
 * The ids of the clips a marquee rectangle swept.
 *
 * The rectangle arrives in the canvas element's own CSS pixels; the clips are
 * measured in canvas pixels. Both are mapped into the 0-1 space of the
 * *rendered* content, which is what object-fit: contain letterboxes, so a
 * marquee drawn over a letterbox bar selects nothing rather than everything.
 */
export function clipsIntersectingMarquee(
  canvas: HTMLCanvasElement,
  start: { x: number; y: number },
  current: { x: number; y: number },
  clips: Clip[],
  currentTime: number,
  sourceVideos: SourceVideo[]
): string[] {
  // The rendered canvas area within the element (object-fit: contain)
  const content = geometry.contentBox(canvas);

  // Convert marquee rect from CSS pixels to normalized canvas coords (0-1)
  const normLeft = Math.min(start.x, current.x);
  const normTop = Math.min(start.y, current.y);
  const normRight = Math.max(start.x, current.x);
  const normBottom = Math.max(start.y, current.y);

  const mLeft = (normLeft - content.offsetX) / content.width;
  const mTop = (normTop - content.offsetY) / content.height;
  const mRight = (normRight - content.offsetX) / content.width;
  const mBottom = (normBottom - content.offsetY) / content.height;

  // Find overlay clips whose bounding boxes intersect the marquee
  const intersecting: string[] = [];
  for (const clip of clips) {
    // Only check clips visible at current time
    const clipEnd = clip.timelinePosition + clip.duration;
    if (currentTime < clip.timelinePosition || currentTime >= clipEnd) continue;

    const bounds = geometry.getOverlayBounds(clip, canvas, currentTime, sourceVideos);
    if (!bounds) continue;

    // Convert bounds to normalized coords
    const bLeft = (bounds.centerX - bounds.width / 2) / canvas.width;
    const bTop = (bounds.centerY - bounds.height / 2) / canvas.height;
    const bRight = (bounds.centerX + bounds.width / 2) / canvas.width;
    const bBottom = (bounds.centerY + bounds.height / 2) / canvas.height;

    // Check AABB intersection (ignoring rotation for simplicity)
    if (bRight > mLeft && bLeft < mRight && bBottom > mTop && bTop < mBottom) {
      intersecting.push(clip.id);
    }
  }

  return intersecting;
}

/**
 * The topmost text clip whose box contains a point, or null.
 *
 * Unlike the handle hit test this ignores selection and keyframe mode
 * entirely: a double-click opens the editor on whatever text is under it.
 */
export function textClipAtPoint(
  mouseX: number,
  mouseY: number,
  canvas: HTMLCanvasElement,
  clips: Clip[],
  tracks: Track[],
  currentTime: number,
  sourceVideos: SourceVideo[]
): Clip | null {
  const activeClips = getClipsAtTime(clips, tracks, currentTime);
  // Check in reverse z-order (top-most first)
  for (const { clip } of [...activeClips].reverse()) {
    if (clip.overlayType !== 'text' || !clip.textData) continue;

    const bounds = geometry.getOverlayBounds(clip, canvas, currentTime, sourceVideos);
    if (!bounds) continue;

    const { centerX, centerY, width, height, rotation } = bounds;
    const halfW = width / 2;
    const halfH = height / 2;

    // Transform mouse into local space (accounting for rotation)
    const rad = (-rotation * Math.PI) / 180;
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

    if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
      return clip;
    }
  }

  return null;
}
