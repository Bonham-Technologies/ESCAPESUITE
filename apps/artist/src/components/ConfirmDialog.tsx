import { useEffect } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { answerConfirm, useConfirmRequest } from '../app/confirmAction';
import styles from './ConfirmDialog.module.css';

const cancel = () => answerConfirm(false);
const accept = () => answerConfirm(true);

/**
 * The editor's confirm dialog (ESCSUITE-448): whatever `confirmAction` asks,
 * with Cancel and one destructive button. `App` renders it once, for the life
 * of the editor.
 *
 * **Escape cancels**, like Cancel: every question it asks is about destroying
 * something, so a dismissal must never be a yes. Cancel is first, so it has
 * the initial focus. Trap and focus restore come from `useDialogBehaviour`,
 * which opens and closes with the question.
 *
 * `role="alertdialog"`, labelled by the question itself: there is no title,
 * because the native prompts it replaces had none and the wording is theirs.
 */
export function ConfirmDialog() {
  const request = useConfirmRequest();
  const dialogRef = useDialogBehaviour(cancel, request !== null);

  // An editor that goes away with a question up has answered it: no.
  useEffect(() => cancel, []);

  if (!request) return null;

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
      >
        <p className={styles.message} id="confirm-dialog-message">
          {request.message}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={cancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmButton} onClick={accept}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
