// What kind of clip this is, and the plain numbers ClipEditor's controls need.
//
// Pure functions: everything they read is a parameter, so the same maths that
// decides what the panel shows also backs its tests, with no store and no
// React in sight. They will later be shared with OverlayEditor, which is why
// `overlayPositionValue` and `describeClip` take the whole clip rather than
// pre-picked fields — everything else here takes plain values instead.
import type { Clip, ClipAnimation, SourceVideo } from '../../store/types';

/** The type flags ClipEditor branches its sections on, plus the label its header shows. */
export interface ClipDescription {
  isTextOverlay: boolean;
  isShapeOverlay: boolean;
  isOverlay: boolean;
  isImage: boolean;
  isAudio: boolean;
  isVideo: boolean;
  clipTypeLabel: string;
}

/**
 * Classify a clip: which kind of overlay (if any) it is, whether its source
 * is an image or audio file, and the human-readable label for its header.
 */
export function describeClip(clip: Clip | null | undefined, sourceVideo: SourceVideo | null | undefined): ClipDescription {
  const isTextOverlay = clip?.overlayType === 'text';
  const isShapeOverlay = clip?.overlayType === 'shape';
  const isOverlay = isTextOverlay || isShapeOverlay;
  const isImage = sourceVideo?.mediaType === 'image';
  const isAudio = sourceVideo?.mediaType === 'audio';
  const isVideo = !isOverlay && !isImage && !isAudio;

  let clipTypeLabel = 'Video Clip';
  if (isTextOverlay) clipTypeLabel = 'Text Overlay';
  else if (isShapeOverlay) clipTypeLabel = 'Shape Overlay';
  else if (isImage) clipTypeLabel = 'Image';
  else if (isAudio) clipTypeLabel = 'Audio';

  return { isTextOverlay, isShapeOverlay, isOverlay, isImage, isAudio, isVideo, clipTypeLabel };
}

/**
 * How far into the clip the playhead sits, or null when the playhead is
 * outside it. The upper bound is exclusive so a playhead sitting exactly on
 * the next clip's start does not read as "inside" this one.
 */
export function relativeTimeInClip(currentTime: number, clipPosition: number, duration: number): number | null {
  const relativeTime = currentTime - clipPosition;
  if (relativeTime >= 0 && relativeTime < duration) {
    return relativeTime;
  }
  return null;
}

/**
 * The position value the Pos X/Y sliders show and edit: an overlay's own
 * text/shape coordinate takes precedence over the clip transform, matching
 * whichever data the clip actually carries.
 */
export function overlayPositionValue(clip: Clip, axis: 'x' | 'y', isOverlay: boolean): number {
  if (isOverlay && clip.textData) return clip.textData[axis];
  if (isOverlay && clip.shapeData) return clip.shapeData[axis];
  return clip.transform[axis];
}

/** The upper bound offered for an animation/transition duration slider. */
export function maxPresetDuration(clipDuration: number): number {
  return Math.min(2, clipDuration / 2);
}

/** The uniform scale that fits a source video's frame inside the project canvas. */
export function fitToCanvasScale(
  resolution: { width: number; height: number },
  sourceVideo: { width: number; height: number }
): number {
  return Math.min(
    resolution.width / sourceVideo.width,
    resolution.height / sourceVideo.height
  );
}

/** How many keyframes a clip's animation carries across every animated property. */
export function keyframeCount(animation: ClipAnimation | undefined): number {
  return Object.values(animation?.keyframes || {}).reduce(
    (count, kfs) => count + (kfs?.length || 0), 0
  );
}
