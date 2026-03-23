import styles from './ProjectLoadDialog.module.css';

interface ProjectLoadDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onSaveAndLoad: () => void;
  onDiscardAndLoad: () => void;
}

export function ProjectLoadDialog({
  isOpen,
  onCancel,
  onSaveAndLoad,
  onDiscardAndLoad,
}: ProjectLoadDialogProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} data-testid="project-load-dialog">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h3 className={styles.title}>Load Project</h3>
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
