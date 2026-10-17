// Firefox's seek wedge (ESCSUITE-305).
//
// Firefox will not seek a WebM with no Cues index into a Cluster that does not
// start with a key frame: 'seeked' never fires, `seeking` stays true and
// `readyState` stays at HAVE_METADATA (1) — permanently, for that element and
// for a fresh one alike. Both `<video>` paths an export can take wait out a
// fallback per frame and then draw what the element has, which in that state is
// nothing: the export used to finish "complete" with a black picture. They now
// count, per element, the consecutive seeks that end this way, and fail the
// export by name at `WEDGED_SEEK_FRAMES`.
//
// A request that starts over an element no longer seeking resets the count:
// whatever earlier seek was outstanding has landed, however late — a healthy
// element on a slow machine whose seeks land after the fallbacks but before the
// next request is never refused (re-review round 1). After the request's waits,
// a seek that completed — 'seeked' fired — or an element that has a frame to
// draw (`readyState >= 2`) resets the count too. An element still `seeking` with no
// frame adds one, whether this request issued the seek that wedged or found
// the element still stuck on an earlier one: an incoming transition clip is
// held at one time for many frames and seeks only on the first, and resetting
// on the frames that issued no seek let such a source finish black (review
// round 1). Anything else — a seek whose fallback fired over an element that is
// no longer seeking but has no frame yet, a slow machine — leaves the count as
// it was.

/** Consecutive wedged requests of one element before the export gives up on it. */
export const WEDGED_SEEK_FRAMES = 3;

/**
 * An element whose seeks never complete, by the name the user knows the source
 * by. The exporters turn it into an `ExportError` carrying `code`, which the
 * headless kit reads as a permanent failure of the job's input.
 */
export class SourceNotSeekableError extends Error {
  readonly code = 'SOURCE_NOT_SEEKABLE' as const;

  constructor(sourceName: string) {
    super(
      `This browser cannot read "${sourceName}" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.`
    );
    this.name = 'SourceNotSeekableError';
  }
}

/**
 * The count a request starts from: unchanged while the element is still
 * seeking, 0 once it is not — the seek that was outstanding has landed.
 */
export function wedgeCountAtStart(previous: number, video: HTMLVideoElement): number {
  return video.seeking ? previous : 0;
}

/**
 * The next count of consecutive wedged requests for one element, once its
 * waits are over: 0 when the seek landed or there is a frame, one more while
 * the element is still seeking with none, unchanged otherwise. Throws by name
 * when it reaches the limit.
 */
export function countWedgedSeek(
  previous: number,
  video: HTMLVideoElement,
  seekLanded: boolean,
  sourceName: string
): number {
  if (seekLanded || video.readyState >= 2) return 0;
  if (!video.seeking) return previous;
  if (previous + 1 >= WEDGED_SEEK_FRAMES) throw new SourceNotSeekableError(sourceName);
  return previous + 1;
}
