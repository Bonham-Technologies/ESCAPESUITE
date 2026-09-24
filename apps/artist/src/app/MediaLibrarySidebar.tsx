import { VideoUploader, VideoLibrary } from '../components/VideoUploader';
import { ResolutionPicker } from '../components/ResolutionPicker';
import styles from '../App.module.css';

interface MediaLibrarySidebarProps {
  /** Whether the sidebar is collapsed to its header strip. */
  collapsed: boolean;
  /** Flip the sidebar open or shut. */
  onToggle: () => void;
  /**
   * Passed straight to `ResolutionPicker`: told when its change-resolution
   * confirm opens or closes. Required here, unlike on the picker itself, so a
   * caller that forgets to count the fifth modal in `modalOpen` fails to
   * compile.
   */
  onConfirmOpenChange: (open: boolean) => void;
  /**
   * Passed straight to `VideoUploader`: called with a `.veditor` the user
   * dropped on it or picked through it. `App` passes `useProjectActions`'
   * `handleProjectFile`, which owns the editor's one project-load dialog — the
   * uploader asks nothing and loads nothing itself.
   */
  onProjectFile: (file: File) => void;
}

/**
 * The left sidebar: the media library's header and collapse button, and —
 * while it is open — the uploader, the resolution picker and the library
 * listing.
 *
 * Collapsing is the caller's state; this only renders the two halves of the
 * fork and asks to be toggled.
 */
export function MediaLibrarySidebar({
  collapsed,
  onToggle,
  onConfirmOpenChange,
  onProjectFile,
}: MediaLibrarySidebarProps) {
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.sidebarHeader}>
        {!collapsed && <span id="media-library-title">Media Library</span>}
        <button
          className={styles.collapseButton}
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand media library sidebar' : 'Collapse media library sidebar'}
          aria-expanded={!collapsed}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {collapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          <div className={styles.uploaderContainer}>
            <VideoUploader onProjectFile={onProjectFile} />
            <ResolutionPicker onConfirmOpenChange={onConfirmOpenChange} />
          </div>

          <div className={styles.libraryContainer}>
            <VideoLibrary />
          </div>
        </>
      )}
    </aside>
  );
}
