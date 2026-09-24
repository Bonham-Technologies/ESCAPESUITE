import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import styles from './ProjectLoadDialog.module.css';

interface ProjectLoadDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onSaveAndLoad: () => void;
  onDiscardAndLoad: () => void;
}

/**
 * The "you have unsaved work" question asked in front of opening a project.
 *
 * **Escape cancels**, the same path as the Cancel button. The other two answers
 * — save then load, discard then load — both replace what is on the timeline, so
 * neither can be what a dismissal key does; cancelling is the only one of the
 * three that leaves the editor exactly as the user left it.
 *
 * Trap, initial focus and focus restore come from `useDialogBehaviour`. The
 * dialog returns `null` while closed but is mounted for the life of its parent,
 * so it passes `isOpen` and the effect opens and closes with the flag — the same
 * arrangement `ExportDialog` uses.
 */
export function ProjectLoadDialog({
  isOpen,
  onCancel,
  onSaveAndLoad,
  onDiscardAndLoad,
}: ProjectLoadDialogProps) {
  const dialogRef = useDialogBehaviour(onCancel, isOpen);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} data-testid="project-load-dialog">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-load-title"
      >
        <div className={styles.header}>
          <h3 className={styles.title} id="project-load-title">Load Project</h3>
        </div>
        <div className={styles.body}>
          <p className={styles.message}>
            Loading a project will replace your current work.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.cancelButton}
              onClick={onCancel}
              data-testid="project-load-cancel"
            >
              Cancel
            </button>
            <button
              className={styles.saveButton}
              onClick={onSaveAndLoad}
              data-testid="project-load-save"
            >
              Save &amp; Load
            </button>
            <button
              className={styles.discardButton}
              onClick={onDiscardAndLoad}
              data-testid="project-load-discard"
            >
              Discard &amp; Load
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
