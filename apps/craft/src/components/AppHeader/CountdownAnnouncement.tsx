import { useRecorderStore } from '../../store/recorderStore';
import styles from '../../App.module.css';

/**
 * The header's countdown phrase — "Recording starts in 3", "…2", "…1" — and
 * its own subscription to `countdownValue` (ESCSUITE-231).
 *
 * Rendered by `AppHeader` only while `state === 'countdown'`, inside the live
 * region, as the region's one `role="status"` span. The subscription lives here
 * for the reason `CountdownOverlay`'s does: a tick must re-render one phrase,
 * not `App`. The countdown never writes 0: the interval calls `startRecording`
 * at 1, and the take's own "Recording" phrase takes over. The `<= 0` guard is a
 * defensive bound (a countdown of 0 seconds, or a stale 0 in the store) that
 * keeps "Recording starts in 0" from ever being spoken.
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
