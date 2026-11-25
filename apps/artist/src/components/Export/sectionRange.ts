import { formatTime } from '../../utils/timeUtils'

/** A selected stretch of the timeline, in seconds. */
export interface SectionRange {
  start: number
  end: number
}

/**
 * The part of a selected section that lies on the timeline (ESCSUITE-519), or
 * `null` when none of it does. An edit that shortens the timeline (a clip sped
 * up, a clip removed) leaves the in and out points where they were, so the
 * section can run past the end: past the end there is nothing to encode, and
 * the exporters would fill it with black and silence. A section that
 * straddles the end ends at it; one that starts at or after the end, or a
 * timeline with no length, has nothing to export. A section inside the
 * timeline is returned as it is.
 */
export function sectionOnTimeline(range: SectionRange, timelineSeconds: number): SectionRange | null {
  // Written as "not before the end" so a NaN length also has nothing to export.
  if (!(range.start < timelineSeconds)) return null
  return range.end <= timelineSeconds ? range : { start: range.start, end: timelineSeconds }
}

/**
 * Why a section {@link sectionOnTimeline} finds wholly past the end cannot be
 * exported, with the two ways out. No closing full stop: the dialog adds it,
 * as it does to every length reason.
 */
export function sectionPastEndReason(range: SectionRange, timelineSeconds: number): string {
  const start = formatTime(range.start)
  const end = formatTime(timelineSeconds)
  // Whole seconds: a start at, or just past, the end shows the same time as
  // the end, and "starts at 0:01 and the timeline ends at 0:01" reads as a
  // contradiction.
  const where = start === end ? `it starts at ${start}, where the timeline ends` : `it starts at ${start} and the timeline ends at ${end}`
  return `Cannot export the section: ${where}. Set the in point before the end, or export the full video`
}
