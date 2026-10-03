// Whether a track is hidden, and the one question every reader of it asks.
//
// `Track.visible` means "draw its clips" — `getClipsAtTime` (`clipQueries.ts`)
// asks this before compositing a clip at all, and everything else that has to
// agree with what the frame actually shows asks the identical question:
// `getActiveTransition` and the audio mixer in the export pipeline, crop
// mode's own `cropTarget`, and the preview's selection chrome, hit test and
// marquee (ESCSUITE-178). Each of those used to write out `!track ||
// !track.visible` (or the positive form, `track && track.visible`) by hand,
// which is harmless only as long as every copy agrees — this collapses them
// into one place to read, the same reasoning `trackLock.ts` beside this file
// already applies to `Track.locked`. Pure functions over the clips and tracks
// they are handed — no store, no React — so either layer can import them
// without an edge to the other.
//
// A track that is missing — deleted, or an id that never named one — is
// treated as hidden: "gone" is not "showing", the same answer a missing track
// gives `isTrackLocked`'s "not frozen" for the opposite question.
import type { Track } from './types';

/**
 * Whether a track OBJECT is currently showing its clips. `undefined` — a
 * track that `tracks.find()` or a `Map` lookup did not find — reads as
 * hidden, so a caller that already has the lookup's result (`clipQueries.ts`'s
 * and `dragGeometry.ts`'s own `Map<string, Track>`, built once per call rather
 * than per clip) can ask this directly without a second search. A type guard
 * rather than a plain boolean, so a caller that goes on to read the track —
 * `clipQueries.ts`'s own `results.push({ ..., track })` — gets it narrowed to
 * `Track` instead of writing a second `track &&` to satisfy the compiler.
 */
export function isVisibleTrack(track: Track | undefined): track is Track {
  return track !== undefined && track.visible;
}

/** Whether `trackId` names a track that is currently showing its clips. */
export function isTrackVisible(tracks: Track[], trackId: string | undefined): boolean {
  if (trackId === undefined) return false;
  return isVisibleTrack(tracks.find((t) => t.id === trackId));
}
