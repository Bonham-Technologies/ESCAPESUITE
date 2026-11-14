import { useRecorderStore } from '../../store/recorderStore';
import { RecordingDurationReadout } from './RecordingDurationReadout';

/**
 * The 3-2-1 digit, drawn in the timer's place in the "Float controls" window
 * during the countdown (ESCSUITE-440). The page draws the same number in its
 * preview overlay, but that is usually hidden behind whatever is being
 * recorded, so the window shows it where the timer would read "00:00".
 *
 * Its own subscription to `countdownValue`, for the reason
 * `RecordingDurationReadout` has one: a tick re-renders one digit, not the
 * bar. A 0 (no countdown, or a stale value) falls back to the elapsed time.
 */
export function CountdownReadout() {
  const countdownValue = useRecorderStore((s) => s.countdownValue);

  if (countdownValue <= 0) return <RecordingDurationReadout />;

  return <>{countdownValue}</>;
}
