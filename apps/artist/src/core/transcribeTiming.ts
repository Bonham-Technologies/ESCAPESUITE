import type { Clip } from '../store/types';
import { clipSpeed } from '../store/clipSpeed';

/**
 * Whether the timeline's sound moved between two states of it (ESCSUITE-486).
 *
 * "Transcribe to captions" hears the timeline as it was when the run started,
 * and its cues are timed against that. When an edit made during the run moves
 * where that sound plays (a clip moved, trimmed, slipped, sped up, put on
 * another track, split, added or taken off: a drag, a ripple delete, Remove
 * silences), the captions land out of step with the edited timeline, so the
 * finishing notice says so.
 *
 * Only media clips count: text and shape overlays make no sound, so a caption
 * or title added, moved or restyled meanwhile changes nothing heard. Nor does
 * anything but where and how long a clip plays: a rename, a colour, an effect.
 * The two states are compared, not the edits between them, so an edit undone
 * before the run ends is no change.
 */
export function soundTimingChanged(before: readonly Clip[], after: readonly Clip[]): boolean {
  const media = (clips: readonly Clip[]) => new Map(clips.filter((clip) => !clip.overlayType).map((clip) => [clip.id, clip]));
  const was = media(before);
  const now = media(after);
  if (was.size !== now.size) return true;
  for (const [id, a] of was) {
    const b = now.get(id);
    if (
      !b
      || a.trackId !== b.trackId
      || a.timelinePosition !== b.timelinePosition
      || a.duration !== b.duration
      || a.startTime !== b.startTime
      || clipSpeed(a) !== clipSpeed(b)
    ) {
      return true;
    }
  }
  return false;
}
