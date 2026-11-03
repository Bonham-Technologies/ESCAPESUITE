import { TransportBar, type TransportBarProps } from './TransportBar';
import styles from '../../App.module.css';

interface RecorderControlsProps extends Omit<TransportBarProps, 'blockedReasonId'> {
  /**
   * Opens or closes the "Float controls" window (ESCSUITE-400). Absent where
   * the window cannot be opened — no Document Picture-in-Picture, or CRAFT is
   * embedded — and then the button is not drawn at all.
   */
  onToggleFloat?: () => void;
  /** Whether the "Float controls" window is open; drawn as the button's pressed state. */
  floating?: boolean;
}

/** The id `aria-describedby` points at; there is only ever one of these. */
const BLOCKED_REASON_ID = 'record-blocked-reason';

/**
 * The transport bar, the keyboard-shortcut legend underneath it, and the
 * "Float controls" toggle at the end of that legend.
 *
 * The bar itself — which buttons exist in which state, and what the record
 * button does — is `TransportBar`, shared with the floating window.
 *
 * `blockedReason` is printed under the bar as the record button's accessible
 * description while it is set. The reason is computed by the App (see
 * `utils/recordReadiness.ts`), because it is a fact about the store's
 * capabilities and config rather than about this bar.
 */
export function RecorderControls({ onToggleFloat, floating = false, ...transport }: RecorderControlsProps) {
  const { blockedReason } = transport;

  return (
    <>
      <TransportBar {...transport} blockedReasonId={BLOCKED_REASON_ID} />

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
        {onToggleFloat && (
          <button
            type="button"
            className={styles.floatButton}
            onClick={onToggleFloat}
            aria-pressed={floating}
            title="Keep the timer and controls on top of the window you are recording"
          >
            Float controls
          </button>
        )}
      </div>
    </>
  );
}
