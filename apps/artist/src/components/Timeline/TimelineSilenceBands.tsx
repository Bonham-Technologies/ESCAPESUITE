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
 *
 * Pauses less than a pixel apart at the current zoom are drawn as one band
 * (ESCSUITE-487): the gap between them could not be seen, and tens of
 * thousands of short pauses made a band each, which slowed every keystroke in
 * the dialog's fields.
 */
export function TimelineSilenceBands({ pixelsPerSecond, height }: TimelineSilenceBandsProps) {
  const candidates = useEditorStore((state) => state.silenceReview?.candidates);
  if (!candidates?.length) return null;
  const bands: { left: number; right: number }[] = [];
  for (const range of candidates) {
    const left = timeToPixels(range.start, pixelsPerSecond);
    const right = timeToPixels(range.end, pixelsPerSecond);
    const last = bands[bands.length - 1];
    if (last && left - last.right < 1) last.right = Math.max(last.right, right);
    else bands.push({ left, right });
  }
  return (
    <>
      {bands.map((band) => (
        <div
          key={`${band.left}-${band.right}`}
          className={styles.silenceBand}
          data-testid="silence-band"
          aria-hidden="true"
          style={{ left: band.left, width: band.right - band.left, height }}
        />
      ))}
    </>
  );
}
