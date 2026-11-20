import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import styles from '../../App.module.css';

interface RecoverTakeDialogProps {
  /** When the unfinished take started (ms since the epoch). */
  startedAt: number;
  /** Bytes it left on the device, across every part. */
  size: number;
  onRecover: () => void;
  onDiscard: () => void;
  /** Escape or the backdrop: ask again next time CRAFT opens. */
  onClose: () => void;
}

/** "12.3 MB" — one decimal, base-1000 like the library's own sizes. */
function formatTakeSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * The prompt for a take that never finished (ESCSUITE-466): a recording
 * whose page closed, crashed or lost power before Stop, kept on the device
 * as it recorded (`core/takeStore.ts`). Recover repairs it and saves it to the
 * library; Discard deletes it; Escape or the backdrop leaves it for next time.
 *
 * The same modal shape as the help and playback dialogs, with
 * `useDialogBehaviour` for Escape, the focus trap and focus restore; Recover
 * is the first control, so it has focus when the prompt opens.
 */
export function RecoverTakeDialog({ startedAt, size, onRecover, onDiscard, onClose }: RecoverTakeDialogProps) {
  const dialogRef = useDialogBehaviour(onClose);
  const when = new Date(startedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.helpModal}
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recover-title"
      aria-describedby="recover-description"
    >
      <div className={`${styles.helpContent} ${styles.recoverContent}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.helpHeader}>
          <h2 id="recover-title" className={styles.helpTitle}>Recover unfinished recording?</h2>
        </div>
        <div className={styles.helpBody}>
          <p id="recover-description" className={styles.recoverText}>
            A recording started {when} never reached your library: the page closed, or the
            recording ended in an error, before it was saved. It was kept on this device as it
            recorded ({formatTakeSize(size)}). Recover saves what was recorded to your library;
            Discard deletes it.
          </p>
          <div className={styles.recoverActions}>
            <button type="button" className={styles.editorButton} onClick={onRecover}>
              Recover
            </button>
            <button type="button" onClick={onDiscard}>
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
