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
 * millisecond before a frame's stored start is treated as that frame. Below a
 * quarter of a frame at 240 fps, the bias cannot carry a request on one
 * frame's start past the next frame's, even with that one stored half a
 * millisecond early.
 */
export const ELEMENT_SEEK_BIAS = 1e-3;

/** The time to assign to `video.currentTime` to show the frame at `time`. */
export function elementSeekTarget(time: number): number {
  return time + ELEMENT_SEEK_BIAS;
}
