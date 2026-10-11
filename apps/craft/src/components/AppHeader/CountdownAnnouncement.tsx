import { useRecorderStore } from '../../store/recorderStore';
import styles from '../../App.module.css';

/**
 * The header's countdown phrase — "Recording starts in 3", "…2", "…1" — and
 * its own subscription to `countdownValue` (ESCSUITE-231).
 *
 * Rendered by `AppHeader` only while `state === 'countdown'`, inside the live
 * region, as the region's one `role="status"` span. The subscription lives here
 * for the reason `CountdownOverlay`'s does: a tick must re-render one phrase,
 * not `App`. The zero step the countdown interval writes last draws nothing, so
 * the take's own "Recording" phrase is the only thing announced at the start.
 */
export function CountdownAnnouncement() {
  const countdownValue = useRecorderStore((s) => s.countdownValue);

  if (countdownValue <= 0) return null;

  return (
    <span className={styles.pausedIndicator} role="status">
      Recording starts in {countdownValue}
    </span>
  );
}
