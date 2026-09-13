import { isStandaloneMode } from '@escapesuite/shared/config';
import { FileMenu } from './FileMenu';
import styles from '../App.module.css';

interface AppHeaderProps {
  /** The project's name, shown in the editable field in the middle. */
  projectName: string;
  /** Rename the project. Receives the field's new value. */
  onRenameProject: (name: string) => void;
  /** Whether the File dropdown is open. */
  fileMenuOpen: boolean;
  /** Flip the File dropdown open or shut. */
  onToggleFileMenu: () => void;
  /** Shut the File dropdown. */
  onCloseFileMenu: () => void;
  /** Start a new project. */
  onNewProject: () => void;
  /** Open a project from disk. */
  onLoadProject: () => void;
  /** Save the current project to disk — both the menu item and the quick button. */
  onSaveProject: () => void;
  /** Open the export dialog — both the menu item and the Export button. */
  onExport: () => void;
  /** A project load is in flight. */
  isLoading: boolean;
  /** A save is in flight, so both Save affordances are disabled. */
  isSaving: boolean;
  /** There is something on the timeline to export. */
  canExport: boolean;
}

/**
 * The editor's top bar: the dashboard link and wordmark, the project-name
 * field, and the right-hand cluster of the File menu plus the quick Save and
 * Export buttons.
 *
 * The dashboard link is hidden in the standalone build, which this component
 * asks about directly; everything else is handed to it.
 */
export function AppHeader({
  projectName,
  onRenameProject,
  fileMenuOpen,
  onToggleFileMenu,
  onCloseFileMenu,
  onNewProject,
  onLoadProject,
  onSaveProject,
  onExport,
  isLoading,
  isSaving,
  canExport,
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        {!isStandaloneMode() && (
          <a href="/" className={styles.dashboardLink} title="Back to ESCAPE Suite">
            ← ESCAPE Suite
          </a>
        )}
        <h1 className={styles.logo}>ESCAPEARTIST</h1>
      </div>

      <div className={styles.headerCenter}>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onRenameProject(e.target.value)}
          className={styles.projectName}
          placeholder="Project Name"
          aria-label="Project name"
        />
      </div>

      <div className={styles.headerRight}>
        {/* File Menu Dropdown */}
        <FileMenu
          isOpen={fileMenuOpen}
          onToggle={onToggleFileMenu}
          onClose={onCloseFileMenu}
          onNewProject={onNewProject}
          onLoadProject={onLoadProject}
          onSaveProject={onSaveProject}
          onExport={onExport}
          isLoading={isLoading}
          isSaving={isSaving}
          canExport={canExport}
        />

        {/* Quick action buttons */}
        <button className={styles.headerButton} onClick={onSaveProject} disabled={isSaving} title="Save (Ctrl+S)" aria-label="Save project">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        </button>

        <button
          className={`${styles.headerButton} ${styles.exportButton}`}
          onClick={onExport}
          disabled={!canExport}
          title="Export (Ctrl+E)"
          aria-label="Export video"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
      </div>
    </header>
  );
}
