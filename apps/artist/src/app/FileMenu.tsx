import styles from '../App.module.css';

interface FileMenuProps {
  /** Whether the dropdown is open. */
  isOpen: boolean;
  /** Flip the dropdown open or shut. */
  onToggle: () => void;
  /** Shut the dropdown — the backdrop and every item call this after acting. */
  onClose: () => void;
  /** Start a new project. The confirmation prompt lives with the caller. */
  onNewProject: () => void;
  /** Open a project from disk. Async at the source; the result is not awaited here. */
  onLoadProject: () => void | Promise<void>;
  /** Save the current project to disk. Async at the source; the result is not awaited here. */
  onSaveProject: () => void | Promise<void>;
  /** Open the export dialog. */
  onExport: () => void;
  /** A project load is in flight, so Open is disabled. */
  isLoading: boolean;
  /** A save is in flight, so Save is disabled. */
  isSaving: boolean;
  /** There is something on the timeline to export. */
  canExport: boolean;
}

/**
 * The header's File dropdown: the button that opens it, the backdrop that
 * closes it on an outside click, and the four menu items with their shortcut
 * hints.
 *
 * Every item does its thing and then closes the menu; deciding what "its
 * thing" is belongs to the caller.
 */
export function FileMenu({
  isOpen,
  onToggle,
  onClose,
  onNewProject,
  onLoadProject,
  onSaveProject,
  onExport,
  isLoading,
  isSaving,
  canExport,
}: FileMenuProps) {
  return (
    <div className={styles.menuContainer}>
      <button
        className={styles.headerButton}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="File menu"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        File
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className={styles.menuBackdrop} onClick={onClose} aria-hidden="true" />
          <div className={styles.menuDropdown} role="menu" aria-label="File options">
            <button
              className={styles.menuItem}
              onClick={() => { onNewProject(); onClose(); }}
            >
              <span className={styles.menuItemLabel}>New Project</span>
              <span className={styles.menuItemShortcut}>Ctrl+N</span>
            </button>
            <button
              className={styles.menuItem}
              onClick={() => { onLoadProject(); onClose(); }}
              disabled={isLoading}
            >
              <span className={styles.menuItemLabel}>Open Project...</span>
              <span className={styles.menuItemShortcut}>Ctrl+O</span>
            </button>
            <button
              className={styles.menuItem}
              onClick={() => { onSaveProject(); onClose(); }}
              disabled={isSaving}
            >
              <span className={styles.menuItemLabel}>Save Project</span>
              <span className={styles.menuItemShortcut}>Ctrl+S</span>
            </button>
            <div className={styles.menuDivider} />
            <button
              className={styles.menuItem}
              onClick={() => { onExport(); onClose(); }}
              disabled={!canExport}
            >
              <span className={styles.menuItemLabel}>Export Video...</span>
              <span className={styles.menuItemShortcut}>Ctrl+E</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
