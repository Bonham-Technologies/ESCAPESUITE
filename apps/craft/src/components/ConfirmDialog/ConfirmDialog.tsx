import { useEffect } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { answerConfirm, useConfirmRequest } from '../../utils/confirmAction';
import styles from '../../App.module.css';

const cancel = () => answerConfirm(false);
const accept = () => answerConfirm(true);

/**
 * CRAFT's confirm dialog (ESCSUITE-483): whatever `confirmAction` asks, with
 * Cancel and one destructive button. `App` renders it once, for the life of
 * the app, and it draws nothing while no question is up.
 *
 * That is the one way it differs from the Help and playback dialogs, which
 * render only while open: this one has to answer "no" if the app goes away
 * with a question up, and an unmount effect on a dialog mounted per question
 * would answer every question "no" the moment it opened — React's StrictMode
 * mounts, unmounts and remounts each new component once in development. So it
 * passes `useDialogBehaviour` its own `isOpen`, as ESCAPEARTIST's export and
 * confirm dialogs do.
 *
 * **Every way out that is not the destructive button is a no**: Cancel,
 * Escape and a click on the backdrop all answer false, because what it asks
 * about is deleting something. Cancel comes first, so it has the initial
 * focus, and Enter on it is a no as well.
 *
 * `useDialogBehaviour` supplies Escape and the focus trap, and puts focus back
 * where it was when the dialog opened. The request's `returnFocus` then wins
 * over that: the control that asked, which WebKit never focused on click.
 * Its effect is declared after the hook's, so its cleanup runs after the
 * hook's restore.
 */
export function ConfirmDialog() {
  const request = useConfirmRequest();
  const dialogRef = useDialogBehaviour(cancel, request !== null);
  const returnFocus = request?.returnFocus;

  useEffect(
    () => () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    },
    [returnFocus]
  );

  // An app that goes away with a question up has answered it: no.
  useEffect(() => cancel, []);

  if (!request) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.confirmModal}
      onClick={cancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <div className={styles.confirmContent} onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className={styles.confirmTitle}>
          {request.title}
        </h2>
        <p id="confirm-message" className={styles.confirmMessage}>
          {request.message}
        </p>
        <div className={styles.confirmActions}>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmDanger} onClick={accept}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
