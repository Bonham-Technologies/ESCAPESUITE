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
// A seek that merely runs slow — its fallback fires, but the element is no
// longer seeking, or already has the frame — is not counted, and any seek that
// completes starts the count again. Only the combination of all three is a
// wedge: the fallback fired, `seeking` is still true, and there is no frame.

/** Consecutive wedged seeks of one element before the export gives up on it. */
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
      `This browser cannot read "${sourceName}" frame by frame (its seek never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.`
    );
    this.name = 'SourceNotSeekableError';
  }
}

/**
 * Whether a seek that has been waited on is wedged: its fallback fired, the
 * element still says it is seeking, and it has no frame to draw.
 */
export function isWedgedSeek(video: HTMLVideoElement, seekFellBack: boolean): boolean {
  return seekFellBack && video.seeking && video.readyState < 2;
}

/**
 * The next count of consecutive wedged seeks for one element — reset by any
 * seek that is not wedged — throwing by name when it reaches the limit.
 */
export function countWedgedSeek(previous: number, wedged: boolean, sourceName: string): number {
  const run = wedged ? previous + 1 : 0;
  if (run >= WEDGED_SEEK_FRAMES) throw new SourceNotSeekableError(sourceName);
  return run;
}
