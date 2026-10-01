// A tiny module of its own (ESCSUITE-13 round 3) purely so
// `pruneVisibleRangeCache` can be `export`ed and unit-tested directly: a
// component file may only export the component itself (`react-refresh/
// only-export-components`), so this one function could not live in
// `TimelineTrack.tsx` alongside `TimelineTrack` without breaking Fast
// Refresh there.
import type { Clip } from '../../store/types';

/**
 * Delete every `visibleRangeCacheRef` entry whose clip id is no longer in
 * `clips` (ESCSUITE-13 round 3, defect 2). Without this, a clip scrolled out
 * of the virtualiser's window and never scrolled back to — or, as the common
 * case, a clip trimmed away or deleted outright — leaves its `{offset,width}`
 * object in the cache forever: small individually, but unbounded over a long
 * editing session that imports, trims and deletes many clips.
 */
export function pruneVisibleRangeCache(
  cache: Map<string, { offset: number; width: number }>,
  clips: Clip[]
): void {
  const currentClipIds = new Set(clips.map((c) => c.id));
  for (const clipId of cache.keys()) {
    if (!currentClipIds.has(clipId)) cache.delete(clipId);
  }
}
