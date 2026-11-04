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
//
// A request whose waits end over an element still seeking with no frame gives
// that seek `SEEK_IN_FLIGHT_GRACE_MS` more to land before it is counted
// (ESCSUITE-370). Without it, a seek merely slower than the 800 ms of waits was
// counted as wedged, and the export's next frame — they run back to back —
// issued its own seek over it, which aborts the one in flight (the HTML seek
// algorithm: only the last seek ever lands). Chrome on a loaded CI runner whose
// seeks briefly ran past the waits therefore never landed one, and the third
// frame refused a healthy recording by this module's own message. A slow seek
// now lands, and its frame is drawn; a wedged one still never does, and is
// refused after three requests as before, each a grace longer.
//
// Chromium wedges too (ESCSUITE-412), on a take whose key frame shares its
// WebM timecode with the delta frame before it — ESCAPECRAFT declares 30 fps to
// Mediabunny, which snaps every timestamp to that grid, so two frames captured
// inside one 33 ms slot get one timecode, and a key frame with a timecode the
// Cluster in progress already holds cannot start a Cluster. Every seek past that
// key frame never lands, in a fresh element over the same bytes as well; the
// same packets remuxed with that frame 1 ms later seek every time. The grace above cannot help a seek that never lands,
// so the element exporters (`elementFrames.ts`) reload a source once, from such
// a copy, on its first wedged request — and compose that frame again, so no
// frame is drawn without it — and refuse it only when the reloaded element
// reaches `WEDGED_SEEK_FRAMES`; and the refusal no longer sends a Chromium user
// to Chrome or Edge.
import { isChromiumEngine, type EngineNavigator } from './browserEngine';

/** Consecutive wedged requests of one element before the export gives up on it. */
export const WEDGED_SEEK_FRAMES = 3;

/**
 * An element whose seeks never complete, by the name the user knows the source
 * by. The exporters turn it into an `ExportError` carrying `code`, which the
 * headless kit reads as a permanent failure of the job's input.
 */
export class SourceNotSeekableError extends Error {
  readonly code = 'SOURCE_NOT_SEEKABLE' as const;

  constructor(sourceName: string, nav: EngineNavigator | undefined = globalThis.navigator) {
    super(sourceNotSeekableMessage(sourceName, nav));
    this.name = 'SourceNotSeekableError';
  }
}

/**
 * The refusal's sentence, by engine (ESCSUITE-412). Firefox's wedge
 * (ESCSUITE-305) is Firefox's own, so Chrome or Edge is real advice there. A
 * Chromium user *is* in Chrome or Edge, and the export has already reloaded
 * the source before refusing it: what is left is a different file, and an MP4
 * is read by a different decoder.
 */
export function sourceNotSeekableMessage(sourceName: string, nav: EngineNavigator | undefined): string {
  if (isChromiumEngine(nav)) {
    return `This browser cannot read "${sourceName}" frame by frame (its seeks never completed, even after reloading it). Convert it to MP4 (ESCAPECRAFT's MP4 download does) and import that instead.`;
  }
  return `This browser cannot read "${sourceName}" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.`;
}

/**
 * How long a request whose waits are over gives a seek still in flight on its
 * element, with no frame yet, to land before counting it (ESCSUITE-370).
 */
export const SEEK_IN_FLIGHT_GRACE_MS = 2_000;

/**
 * Wait up to {@link SEEK_IN_FLIGHT_GRACE_MS} for the seek in flight on `video`
 * to land. Callers ask only for an element still `seeking` with no frame
 * (`readyState < 2`), so a request that can draw never waits. Resolves to
 * whether 'seeked' fired. Whichever settles the wait cancels the other, so
 * neither the timer nor the listener outlives it.
 */
export function settleSeekInFlight(video: HTMLVideoElement): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onSeeked = () => {
      clearTimeout(fallback);
      resolve(true);
    };
    const fallback = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve(false);
    }, SEEK_IN_FLIGHT_GRACE_MS);
    video.addEventListener('seeked', onSeeked, { once: true });
  });
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
  const next = nextWedgeCount(previous, video, seekLanded);
  if (next >= WEDGED_SEEK_FRAMES) throw new SourceNotSeekableError(sourceName);
  return next;
}

/**
 * {@link countWedgedSeek}'s count without the throw: the caller decides what
 * reaching {@link WEDGED_SEEK_FRAMES} means. The element exporters reload the
 * source once before they refuse it (ESCSUITE-412).
 */
export function nextWedgeCount(previous: number, video: HTMLVideoElement, seekLanded: boolean): number {
  if (seekLanded || video.readyState >= 2) return 0;
  if (!video.seeking) return previous;
  return previous + 1;
}

/** What one seek request did, for the export's diagnostic log (ESCSUITE-412). */
export interface SeekRequestState {
  /** The time the request asked the element for, in source seconds. */
  target: number;
  /** Whether it assigned `currentTime`: a request within half a frame of the element issues none. */
  issued: boolean;
  /** Whether 'seeked' fired for it, within its waits or its grace. */
  landed: boolean;
  /** The element's `seeking` and `readyState` once the request's waits were over. */
  seeking: boolean;
  readyState: number;
  /** How long the request took, waits and grace included. */
  elapsedMs: number;
  /** The element's consecutive wedged requests after this one. */
  wedged: number;
}

/**
 * One line of the diagnostic log for one seek request: enough to tell a slow
 * seek (landed, late) from a wedge (never landed, `seeking` true, `readyState`
 * 1) from the console alone, which the two CI failures of ESCSUITE-412 could
 * not — their log had no seek in it at all.
 */
export function describeSeekRequest(sourceName: string, element: number, state: SeekRequestState): string {
  const outcome = !state.issued
    ? 'no seek issued'
    : state.landed
      ? 'landed'
      : state.seeking
        ? 'never landed'
        : 'no seeked event in its waits';
  return (
    `"${sourceName}" element ${element}, seek to ${state.target.toFixed(4)} s: ${outcome} after ` +
    `${Math.round(state.elapsedMs)} ms (seeking=${state.seeking}, readyState=${state.readyState}, ` +
    `wedged ${state.wedged}/${WEDGED_SEEK_FRAMES})`
  );
}
