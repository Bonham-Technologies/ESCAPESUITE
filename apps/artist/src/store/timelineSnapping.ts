// Where a dragged clip is allowed to land.
//
// Pure functions over the clips they are handed: `getSnapPoints` collects the
// timeline's edges (plus 0, which is always a snap target), `findNearestSnapPoint`
// picks the closest of them inside a threshold, and `wouldOverlap` answers whether
// a placement collides with something already on the track. None of them reads the
// store, so the timeline's geometry and drag handlers can import them without
// pulling the store module into their graph. `projectStore.ts` re-exports all three
// for the callers that have always reached them through it.
import type { Clip } from './types';

// Get snap points from all clip edges
export function getSnapPoints(clips: Clip[], excludeClipId?: string): number[] {
  const points: Set<number> = new Set([0]); // Always snap to start

  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    points.add(clip.timelinePosition);
    points.add(clip.timelinePosition + clip.duration);
  }

  return Array.from(points).sort((a, b) => a - b);
}

// Find nearest snap point within threshold
export function findNearestSnapPoint(
  position: number,
  snapPoints: number[],
  threshold: number
): number | null {
  let nearest: number | null = null;
  let minDistance = threshold;

  for (const point of snapPoints) {
    const distance = Math.abs(position - point);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

// Check if clip placement would overlap with another on same track
export function wouldOverlap(
  clips: Clip[],
  trackId: string,
  position: number,
  duration: number,
  excludeClipId?: string
): boolean {
  const end = position + duration;

  for (const clip of clips) {
    if (clip.trackId !== trackId) continue;
    if (clip.id === excludeClipId) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    // Overlap if ranges intersect
    if (position < clipEnd && end > clip.timelinePosition) {
      return true;
    }
  }

  return false;
}
