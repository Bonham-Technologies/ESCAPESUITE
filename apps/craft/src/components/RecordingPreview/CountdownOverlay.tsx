import { useRecorderStore } from '../../store/recorderStore';
import type { RecordingState } from '../../store/types';
import styles from '../../App.module.css';

interface CountdownOverlayProps {
  /** The overlay only exists during the countdown; every other state draws nothing. */
  state: RecordingState;
}

/**
 * The 3-2-1 overlay's own subscription to the store.
 *
 * `countdownValue` changes three times per take and moves one digit, so it is
 * read here rather than in `App` — which would re-render the whole screen and
 * the seven hooks it calls, three times, before a take even starts. The same
 * trade `SourceTogglesPanel` makes for `audioLevels` and
 * `RecordingDurationReadout` makes for the duration tick;
 * `App.rerender.test.tsx` counts it.
 *
 * `state` stays a prop: `App` derives it for the transport bar as well, and it
 * changes once per transition rather than on a tick.
 */
export function CountdownOverlay({ state }: CountdownOverlayProps) {
  const countdownValue = useRecorderStore((s) => s.countdownValue);

  if (state !== 'countdown' || countdownValue <= 0) return null;

  return (
    <div className={styles.countdown}>
      <span className={styles.countdownNumber}>{countdownValue}</span>
    </div>
  );
}
