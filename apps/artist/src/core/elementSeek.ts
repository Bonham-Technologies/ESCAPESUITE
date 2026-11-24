import type { SourceVideo } from '../store/types';

/**
 * Where to point a `<video>` element that is asked for the frame at `time`
 * (ESCSUITE-265, ESCSUITE-495).
 *
 * An export asks for frame-aligned times — `clip.startTime + n / 30` — so most
 * requests land exactly on the start of a source frame, as the timeline places
 * it: frame k of an `r` fps source at k / r. The element shows the frame whose
 * *stored* start is at or before the seek, and a stored start can sit after
 * that nominal one in two ways:
 *
 * - **The engine's microsecond.** Both measured engines resolve a seek at
 *   microsecond precision and, on a third of a 30 fps source's starts (33333.33…
 *   µs apart), land one microsecond short: Chromium 153 on the starts whose
 *   fraction is .67 (it truncates the request), Firefox 155 on the .33 ones
 *   (ESCSUITE-265).
 * - **The container's millisecond.** A WebM (Matroska) timecode holds whole
 *   milliseconds by default, so each frame start is rounded to the nearest one:
 *   a 30 fps frame at 66.67 ms is stored at 67 ms, a third of a millisecond
 *   late, so every third frame of a 30 fps WebM on a fixed grid is stored late
 *   like that (ESCSUITE-495), and an ESCAPECRAFT take, whose timestamps are
 *   capture times in whole milliseconds, can store a frame just after a
 *   request it was captured before. Rounding to the nearest millisecond puts
 *   a start at most half a millisecond late, at any rate.
 *
 * Seeking `ELEMENT_SEEK_BIAS` past the request clears both: one millisecond is
 * twice the most a rounded timecode can be late, and a thousand times the
 * engine's microsecond. The previous bias, 0.1 ms, cleared the engine's
 * microsecond but not the container's rounding, so a 30 fps WebM export
 * repeated the frame before every late-stored one. Waiting longer, or for
 * `requestVideoFrameCallback`, does not help with either (its `mediaTime`
 * echoes the request, not the frame drawn).
 *
 * The bias is a shift, not a snap to a frame's middle: the element path cannot
 * know where a source's frames start (a take's timestamps are its capture
 * times, not a fixed grid), and the rule stays the decode worker's — the last
 * frame that starts at or before the request, within a tolerance
 * (`TIME_TOLERANCE_US` in `workers/frameDecoder.ts`, 0.5 ms). So a request
 * that is not on a frame start, from a trim or a source whose frames are not
 * on the timeline's grid, moves by one millisecond, and one within a
 * millisecond before a frame's stored start is treated as that frame. The
 * worker's tolerance is half that, so for a request 0.5-1 ms before a frame's
 * start the two paths show neighbouring frames (the worker the earlier). Below a
 * quarter of a frame at 240 fps, the bias cannot carry a request on one
 * frame's start past the next frame's, even with that one stored half a
 * millisecond early.
 */
export const ELEMENT_SEEK_BIAS = 1e-3;

/** The time to assign to `video.currentTime` to show the frame at `time`. */
export function elementSeekTarget(time: number): number {
  return time + ELEMENT_SEEK_BIAS;
}

/**
 * How far from the element's current time a request may be before the `<video>`
 * path seeks: half of one frame at the source's own rate, since anything closer
 * is the frame already showing and anything further is a different one
 * (ESCSUITE-263). The rate is floored at 30 because the export asks for frames
 * 1/30 s apart: below 15 fps a half-frame window would be wider than that spacing
 * and serve the previous frame across a boundary. A rate that is missing or not
 * finite and positive counts as 30. An imported video's rate is measured
 * at import (ESCSUITE-276, `frameRateSource: 'measured'`); an ESCAPECRAFT take
 * (`'configured'`) carries 30, so it gets the 1/60 s window. A rate nobody
 * measured (`'assumed'`, or absent) never reaches this function from an
 * exporter: see {@link knownFrameRate} (ESCSUITE-505, ESCSUITE-508). The element
 * itself sits `ELEMENT_SEEK_BIAS` past the last request it was seeked for
 * (ESCSUITE-265), far inside this window.
 *
 * A window alone is not the whole decision: see {@link elementShowsFrameFor}.
 */
export function seekToleranceFor(frameRate: number | undefined): number {
  return 0.5 / Math.max(usableFrameRate(frameRate), 30);
}

/** `frameRate` when it is finite and positive; 30 otherwise. */
function usableFrameRate(frameRate: number | undefined): number {
  return frameRate !== undefined && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
}

/**
 * Whether a `<video>` sitting at `currentTime` already shows the frame a seek
 * for `time` would, so the seek can be skipped (ESCSUITE-505). Both element
 * paths decide with it: `HTMLVideoFrameSource.getFrame()` (MP4) and
 * `elementFrames.ts`'s `syncVideoToTime` (WebM, GIF).
 *
 * Two conditions, both at the source's own rate (30 when it is missing or not
 * finite and positive):
 *
 * - **The same frame.** The frame a seek would show — the one `elementSeekTarget(time)`
 *   falls in, frame k starting at k / rate — is the one `currentTime` falls in.
 *   A slowed clip's requests are closer together in source time than an output
 *   frame, so a window alone, however narrow, lets a request just past a frame
 *   start skip a seek from an element sitting just before it: at 0.25x a 120
 *   fps source moves on a frame every output frame, inside the old 0.4-output-frame
 *   window, and even half a source frame straddles a frame start when a trim
 *   puts the requests off the frame grid.
 * - **Within half a frame** ({@link seekToleranceFor}): the MP4 path's window,
 *   kept as a ceiling for a source whose frames are not on that grid (an
 *   ESCAPECRAFT take's timestamps are its capture times) or whose rate is a
 *   placeholder.
 *
 * Either one failing seeks, so this never skips a seek the half-frame window
 * would have issued, and for a source on its rate's grid it never skips a seek
 * to a different frame, whatever the clip's speed. The element exporters keep
 * their own, narrower ceiling on top — 0.4 of an output frame, which half a
 * frame of a source recorded at 30 fps exceeds — in `syncVideoToTime`.
 */
export function elementShowsFrameFor(
  currentTime: number,
  time: number,
  frameRate: number | undefined
): boolean {
  if (Math.abs(time - currentTime) > seekToleranceFor(frameRate)) return false;
  const rate = usableFrameRate(frameRate);
  return Math.floor(currentTime * rate) === Math.floor(elementSeekTarget(time) * rate);
}

/**
 * Whether a `<video>` sitting at `currentTime` is where a seek for `time` would
 * put it — at the request itself or at its seek target, or between the two —
 * so it shows that request's frame whatever the source's frame rate
 * (ESCSUITE-505). Both element paths' whole skip decision for a source
 * whose rate nobody measured (`frameRateSource` `'assumed'` or absent, every
 * import outside Chromium, ESCSUITE-327): the element exporters' since
 * ESCSUITE-505, `HTMLVideoFrameSource`'s (MP4) since ESCSUITE-508 (see
 * {@link knownFrameRate}). A placeholder rate's grid says nothing
 * about where the file's frames start, so only a request the element already
 * answered — the same time asked again, or the first frame at 0 over the
 * rewound element — skips its seek. A microsecond either side absorbs an
 * engine that reads `currentTime` back truncated to whole microseconds.
 */
export function elementSitsAt(currentTime: number, time: number): boolean {
  return currentTime >= time - 1e-6 && currentTime <= elementSeekTarget(time) + 1e-6;
}

/**
 * `source`'s frame rate when something stands behind it — measured from its
 * presented frames at import (`frameRateSource` `'measured'`, Chromium only,
 * ESCSUITE-276/327) or the rate ESCAPECRAFT was configured to record at
 * (`'configured'`) — and `undefined` for a placeholder: `'assumed'`, which
 * every import in Firefox and Safari is, or absent, which reads the same. Both
 * element paths hand the seek decision only this (ESCSUITE-505 for the WebM
 * and GIF exporters, ESCSUITE-508 for the MP4 one), and judge a source without
 * one by {@link elementSitsAt} alone.
 */
export function knownFrameRate(
  source: Pick<SourceVideo, 'frameRate' | 'frameRateSource'> | undefined
): number | undefined {
  return source?.frameRateSource === 'measured' || source?.frameRateSource === 'configured'
    ? source.frameRate
    : undefined;
}
