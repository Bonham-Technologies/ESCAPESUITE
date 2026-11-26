import { VIDEO_EXPORT_FRAME_RATE } from '../../core/exportTypes'
import { formatTime } from '../../utils/timeUtils'

/** A selected stretch of the timeline, in seconds. */
export interface SectionRange {
  start: number
  end: number
}

/** Rounding slack in the one-frame comparison: a microsecond. */
const FRAME_TOLERANCE_SECONDS = 1e-6

/**
 * The part of a selected section that lies on the timeline (ESCSUITE-519), or
 * `null` when none of it does. An edit that shortens the timeline (a clip sped
 * up, a clip removed) leaves the in and out points where they were, so the
 * section can run past the end: past the end there is nothing to encode, and
 * the exporters would fill it with black and silence. A section that
 * straddles the end ends at it; one that starts at or after the end, or a
 * timeline with no length, has nothing to export. A section inside the
 * timeline is returned as it is.
 *
 * A section that reaches the end but starts less than one output frame
 * (`1 / frameRate`) before it has nothing to export either (ESCSUITE-526): a
 * timeline end that is no whole number of frames (a 5 s clip at 1.5x ends at
 * 3.333... s) can sit a rounding error after an in point the user meant to put
 * at it. `frameRate` is the export's output rate; the video exporters' 30 fps
 * when the caller does not name one. A section of exactly one frame is kept:
 * `end - (end - 1/30)` often comes out an ulp under `1/30` (it does for an
 * end of 3 s, and of 3.333... s), so the comparison allows
 * {@link FRAME_TOLERANCE_SECONDS}, far below any frame.
 */
export function sectionOnTimeline(
  range: SectionRange,
  timelineSeconds: number,
  frameRate: number = VIDEO_EXPORT_FRAME_RATE
): SectionRange | null {
  // Written as "not before the end" so a NaN length also has nothing to export.
  if (!(range.start < timelineSeconds)) return null
  if (range.end < timelineSeconds) return range
  if (timelineSeconds - range.start < 1 / frameRate - FRAME_TOLERANCE_SECONDS) return null
  return range.end <= timelineSeconds ? range : { start: range.start, end: timelineSeconds }
}

/**
 * Why a section {@link sectionOnTimeline} finds wholly past the end, or within
 * a frame of it, cannot be exported, with the two ways out. No closing full
 * stop: the dialog adds it, as it does to every length reason.
 */
export function sectionPastEndReason(range: SectionRange, timelineSeconds: number): string {
  const start = formatTime(range.start)
  const end = formatTime(timelineSeconds)
  // Whole seconds: a start at, or just past, the end shows the same time as
  // the end, and "starts at 0:01 and the timeline ends at 0:01" reads as a
  // contradiction. A start less than a frame before an end just past a whole
  // second (2.99 s against 3.01 s) shows an earlier second than the end, and
  // "starts at 0:02 and the timeline ends at 0:03" would read as a section
  // that can be exported (ESCSUITE-526): say how close it is instead.
  const where =
    start === end
      ? `it starts at ${start}, where the timeline ends`
      : range.start < timelineSeconds
        ? `it starts at ${start}, less than a frame before the timeline ends at ${end}`
        : `it starts at ${start} and the timeline ends at ${end}`
  return `Cannot export the section: ${where}. Set the in point before the end, or export the full video`
}
