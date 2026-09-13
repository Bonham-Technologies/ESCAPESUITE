import type { RecordingState } from '../../store/types';
import { formatDuration } from '../../utils/recordingFormat';
import { CloseIcon, PauseIcon, PlayIcon } from '../icons';
import styles from '../../App.module.css';

interface RecorderControlsProps {
  state: RecordingState;
  /** True for countdown, recording and paused. */
  isRecordingActive: boolean;
  /** Elapsed seconds, ticked while recording. */
  currentDuration: number;
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
}

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
 */
export function RecorderControls({
  state,
  isRecordingActive,
  currentDuration,
  onPause,
  onResume,
  onStart,
  onStop,
  onCancel,
}: RecorderControlsProps) {
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

        {/* Timer */}
        <span className={`${styles.timer} ${isRecordingActive ? styles.recording : ''}`}>
          {formatDuration(currentDuration)}
        </span>

        {/* Main record button */}
        <button
          className={`${styles.recordButton} ${isRecordingActive ? styles.recording : ''}`}
          onClick={
            state === 'idle'
              ? onStart
              : isRecordingActive
              ? onStop
              : undefined
          }
          disabled={state === 'preparing' || state === 'saving'}
          title={state === 'idle' ? 'Record (R)' : 'Stop (S)'}
          aria-label={state === 'idle' ? 'Start recording' : 'Stop recording'}
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
