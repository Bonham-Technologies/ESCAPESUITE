import type { RecordingState } from '../../store/types';
import { CloseIcon, PauseIcon, PlayIcon } from '../icons';
import { CountdownReadout } from './CountdownReadout';
import { RecordingDurationReadout } from './RecordingDurationReadout';
import styles from '../../App.module.css';

export interface TransportBarProps {
  state: RecordingState;
  /** True for countdown, recording and paused. */
  isRecordingActive: boolean;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  /**
   * Abandons whatever is running. The caller picks which "abandon" that is —
   * cancelling a countdown throws away nothing, cancelling a take throws away
   * a recording — so the choice stays with the App.
   */
  onCancel: () => void;
  /**
   * Why a take cannot be started right now, or null when one can. Non-null
   * disables the record button and titles it with the reason.
   */
  blockedReason: string | null;
  /**
   * The id of an element in the same document that says `blockedReason` out
   * loud, for the record button's `aria-describedby`. The page and the
   * floating window each print one under their bar (ESCSUITE-440).
   */
  blockedReasonId?: string;
  /**
   * Draw the countdown digit in the timer's place during `countdown`. The
   * floating window sets it, because the page's countdown overlay is hidden
   * behind whatever is being recorded (ESCSUITE-440); the page's own bar,
   * with the overlay right above it, does not.
   */
  showCountdown?: boolean;
}

/**
 * The transport bar: pause/resume, the timer, the record button and cancel.
 * Drawn under the preview by `RecorderControls` and, while it is open, in the
 * "Float controls" window by `FloatingControls` — the same buttons wired to
 * the same handlers in both places (ESCSUITE-400).
 *
 * Which controls exist depends on the state: pause/resume only while a take is
 * running, cancel only while something is running, and the record button
 * itself changes meaning. Its `onClick` is a four-way ladder — start when
 * idle, **cancel** (not stop) during the countdown, stop once a take is
 * actually recording or paused, and nothing at all in the two in-between
 * states (`preparing` and `saving`), which is what the `undefined` arm is
 * for. Those same two states set `disabled`, so the `undefined` arm and the
 * disabled attribute say the same thing twice; both are kept, because the
 * button's label and title still read "Stop" there and a handler would be a
 * lie.
 *
 * The countdown arm exists because `recorder.stop()` is a no-op before
 * `start()` — clicking a button labelled "Stop recording" during the 3-2-1
 * count did nothing but leave the ticker running and the take starting
 * anyway. During `countdown` the button reads "Cancel countdown" instead and
 * calls `onCancel`, the same action Escape and the bar's own Cancel button
 * already take (ESCSUITE-106), so all three agree.
 *
 * `blockedReason` sits in front of that ladder: while it is set there is
 * nothing the button could usefully do, so it loses its handler, goes
 * disabled, and says why in its `title` (and through `blockedReasonId`).
 */
export function TransportBar({
  state,
  isRecordingActive,
  onPause,
  onResume,
  onStart,
  onStop,
  onCancel,
  blockedReason,
  blockedReasonId,
  showCountdown = false,
}: TransportBarProps) {
  const blocked = blockedReason !== null;

  return (
    <div className={styles.controlsBar}>
      {/* Pause/Resume button */}
      {(state === 'recording' || state === 'paused') && (
        <button
          className={styles.controlButton}
          onClick={state === 'recording' ? onPause : onResume}
          title={state === 'recording' ? 'Pause (P)' : 'Resume (P)'}
          aria-label={state === 'recording' ? 'Pause recording' : 'Resume recording'}
        >
          {state === 'recording' ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}

      {/* Timer — the number subscribes to the store itself, so the
          once-a-second tick re-renders it and not this bar */}
      <span className={`${styles.timer} ${isRecordingActive ? styles.recording : ''}`}>
        {showCountdown && state === 'countdown' ? <CountdownReadout /> : <RecordingDurationReadout />}
      </span>

      {/* Main record button */}
      <button
        className={`${styles.recordButton} ${isRecordingActive ? styles.recording : ''}`}
        onClick={
          blocked
            ? undefined
            : state === 'idle'
            ? onStart
            : state === 'countdown'
            ? onCancel
            : isRecordingActive
            ? onStop
            : undefined
        }
        disabled={blocked || state === 'preparing' || state === 'saving'}
        title={
          blockedReason ??
          (state === 'idle' ? 'Record (R)' : state === 'countdown' ? 'Cancel countdown (Esc)' : 'Stop (S)')
        }
        aria-label={
          state === 'idle' ? 'Start recording' : state === 'countdown' ? 'Cancel countdown' : 'Stop recording'
        }
        aria-describedby={blocked ? blockedReasonId : undefined}
      >
        <span className={styles.recordButtonInner} aria-hidden="true" />
      </button>

      {/* Cancel button */}
      {isRecordingActive && (
        <button
          className={styles.controlButton}
          onClick={onCancel}
          title="Cancel (Esc)"
          aria-label="Cancel recording"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
