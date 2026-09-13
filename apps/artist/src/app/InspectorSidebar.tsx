import { ClipEditor } from '../components/ClipEditor/ClipEditor';
import styles from '../App.module.css';

interface InspectorSidebarProps {
  /** Whether the inspector is collapsed to its header strip. */
  collapsed: boolean;
  /** Flip the inspector open or shut. */
  onToggle: () => void;
}

/**
 * The right sidebar: the inspector's header and collapse button, with the
 * clip editor underneath while it is open.
 */
export function InspectorSidebar({ collapsed, onToggle }: InspectorSidebarProps) {
  return (
    <aside className={`${styles.propertiesSidebar} ${collapsed ? styles.inspectorCollapsed : ''}`} aria-labelledby="inspector-title">
      <div className={styles.sidebarHeader}>
        <span id="inspector-title">Inspector</span>
        <button
          className={styles.collapseButton}
          onClick={onToggle}
          title={collapsed ? 'Show inspector' : 'Hide inspector'}
          aria-label={collapsed ? 'Show inspector panel' : 'Hide inspector panel'}
          aria-expanded={!collapsed}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {collapsed ? (
              <polyline points="15 18 9 12 15 6" />
            ) : (
              <polyline points="9 18 15 12 9 6" />
            )}
          </svg>
        </button>
      </div>
      {!collapsed && <ClipEditor />}
    </aside>
  );
}
