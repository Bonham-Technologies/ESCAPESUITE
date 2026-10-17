// Which clips have no source timeline of their own.

import type { Clip, SourceVideo } from './types';

/**
 * The shortest clip a trim may leave behind, in seconds. Lives here, beside
 * `isExtendableClip`, because the migration reads it too (ESCSUITE-304: a
 * trim-driven clip's dragged length is at least this);
 * `components/Timeline/timelineGeometry.ts` re-exports it.
 */
export const MIN_CLIP_DURATION = 0.1;

/**
 * Whether a clip can be trimmed past its source's length: overlays and images
 * have no fixed source duration, so trimming them changes how long they show.
 *
 * Such a clip's `startTime` / `endTime` pair is always `0` / `duration`
 * (ESCSUITE-304): there is no source window to keep, so `splitClip` gives both
 * halves that pair, `computeTrimUpdate` writes it on every trim, and the
 * migration in `projectMigration.ts` repairs a stored overlay that carries any
 * other. This is the one predicate all three read. It lives in the store so the
 * store can call it; `components/Timeline/timelineGeometry.ts` re-exports it.
 */
export function isExtendableClip(
  clip: Pick<Clip, 'overlayType'>,
  sourceVideo: Pick<SourceVideo, 'mediaType'> | undefined
): boolean {
  const isOverlay = clip.overlayType === 'text' || clip.overlayType === 'shape';
  const isImage = sourceVideo?.mediaType === 'image';
  return isOverlay || isImage;
}
