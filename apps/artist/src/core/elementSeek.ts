/**
 * Where to point a `<video>` element that is asked for the frame at `time`
 * (ESCSUITE-265).
 *
 * An export asks for frame-aligned times — `clip.startTime + n / 30` — so most
 * requests land exactly on the start of a source frame, and a frame starts at a
 * time that is not a whole number of microseconds (33333.33… µs apart at
 * 30 fps). Both measured engines quantise the seek to whole microseconds and,
 * on a third of those starts, land one microsecond short of the frame and show
 * the one before it: Chromium 153 on the starts whose fraction is .67
 * (frames 2, 5, 8, … of a 30 fps source), Firefox 155 on the .33 ones
 * (1, 4, 7, …). Every in-page export repeated one frame in three and dropped
 * the frame it should have shown; waiting longer, or for
 * `requestVideoFrameCallback`, does not help (its `mediaTime` echoes the
 * request, not the frame drawn).
 *
 * Seeking a little past the requested time puts every frame start safely
 * inside its own frame in both engines. One microsecond was measured to be
 * enough in both; the bias is a hundred of them, so it still clears an engine
 * that quantises more coarsely, and it stays a fortieth of a frame at 240 fps —
 * a request that is not on a frame start moves by a tenth of a millisecond
 * within the frame it was already in.
 */
export const ELEMENT_SEEK_BIAS = 1e-4;

/** The time to assign to `video.currentTime` to show the frame at `time`. */
export function elementSeekTarget(time: number): number {
  return time + ELEMENT_SEEK_BIAS;
}
