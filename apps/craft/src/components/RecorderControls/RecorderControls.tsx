import type { RecordingState } from '../../store/types';
import { CloseIcon, PauseIcon, PlayIcon } from '../icons';
import { RecordingDurationReadout } from './RecordingDurationReadout';
import styles from '../../App.module.css';

interface RecorderControlsProps {
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
   * disables the record button, titles it with the reason, and prints the
   * reason under the bar as the button's accessible description.
   */
  blockedReason: string | null;
}

/** The id `aria-describedby` points at; there is only ever one of these. */
const BLOCKED_REASON_ID = 'record-blocked-reason';

/**
 * The transport bar and the keyboard-shortcut legend underneath it.
 *
 * Which controls exist depends on the state: pause/resume only while a take is
 * running, cancel only while something is running, and the record button
 * itself changes meaning. Its `onClick` is a three-way ladder — start when
 * idle, stop while active, and nothing at all in the two in-between states
 * (`preparing` and `saving`), which is what the `undefined` arm is for. Those
 * same two states set `disabled`, so the `undefined` arm and the disabled
 * attribute say the same thing twice; both are kept, because the button's
 * label and title still read "Stop" there and a handler would be a lie.
 *
 * `blockedReason` sits in front of that ladder: while it is set there is
 * nothing the button could usefully do, so it loses its handler, goes
 * disabled, and says why — in its `title`, and in a line under the bar that
 * `aria-describedby` points at. The reason is computed by the App (see
 * `utils/recordReadiness.ts`), because it is a fact about the store's
 * capabilities and config rather than about this bar.
 */
export function RecorderControls({
  state,
  isRecordingActive,
  onPause,
  onResume,
  onStart,
  onStop,
  onCancel,
  blockedReason,
}: RecorderControlsProps) {
  const blocked = blockedReason !== null;

  return (
    <>
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
          <RecordingDurationReadout />
        </span>

        {/* Main record button */}
        <button
          className={`${styles.recordButton} ${isRecordingActive ? styles.recording : ''}`}
          onClick={
            blocked
              ? undefined
              : state === 'idle'
              ? onStart
              : isRecordingActive
              ? onStop
              : undefined
          }
          disabled={blocked || state === 'preparing' || state === 'saving'}
          title={blockedReason ?? (state === 'idle' ? 'Record (R)' : 'Stop (S)')}
          aria-label={state === 'idle' ? 'Start recording' : 'Stop recording'}
          aria-describedby={blocked ? BLOCKED_REASON_ID : undefined}
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

      {/* Why the record button is dead, when it is */}
      {blockedReason && (
        <p className={styles.recordBlockedReason} id={BLOCKED_REASON_ID}>
          {blockedReason}
        </p>
      )}

      {/* Keyboard shortcuts hint */}
      <div className={styles.shortcutsHint}>
        <span className={styles.shortcut}>
          <kbd className={styles.shortcutKey}>R</kbd> Record
        </span>
        <span className={styles.shortcut}>
          <kbd className={styles.shortcutKey}>P</kbd> Pause
        </span>
        <span className={styles.shortcut}>
          <kbd className={styles.shortcutKey}>S</kbd> Stop
        </span>
        <span className={styles.shortcut}>
          <kbd className={styles.shortcutKey}>Esc</kbd> Cancel
        </span>
      </div>
    </>
  );
}
