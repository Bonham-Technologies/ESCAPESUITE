import { useEditorStore } from '../../store/projectStore';
import { timeToPixels } from '../../utils/timeUtils';
import styles from './Timeline.module.css';

interface TimelineSilenceBandsProps {
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** The track stack's height, in pixels. */
  height: number;
}

/**
 * The pauses the "Remove silences" review lists (ESCSUITE-403), drawn as bands
 * through the track stack while the review is open, so the user sees what
 * "Remove all" will cut. Its own subscription: the list changes only while
 * the dialog is up, and nothing else on the timeline needs to re-render for it.
 * Decorative — the dialog's list is the accessible form of the same ranges.
 */
export function TimelineSilenceBands({ pixelsPerSecond, height }: TimelineSilenceBandsProps) {
  const candidates = useEditorStore((state) => state.silenceReview?.candidates);
  if (!candidates?.length) return null;
  return (
    <>
      {candidates.map((range) => (
        <div
          key={`${range.start}-${range.end}`}
          className={styles.silenceBand}
          data-testid="silence-band"
          aria-hidden="true"
          style={{
            left: timeToPixels(range.start, pixelsPerSecond),
            width: timeToPixels(range.end - range.start, pixelsPerSecond),
            height,
          }}
        />
      ))}
    </>
  );
}
