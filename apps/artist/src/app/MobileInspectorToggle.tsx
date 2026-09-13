import styles from '../App.module.css';

interface MobileInspectorToggleProps {
  /** Whether the inspector is currently collapsed. */
  collapsed: boolean;
  /** Flip the inspector open or shut. */
  onToggle: () => void;
}

/**
 * The floating inspector toggle shown at narrow widths, rendered inside
 * `<main>` as a sibling of the inspector it controls.
 */
export function MobileInspectorToggle({ collapsed, onToggle }: MobileInspectorToggleProps) {
  return (
    <button
      className={styles.mobileInspectorToggle}
      onClick={onToggle}
      title="Toggle inspector"
      aria-label={collapsed ? 'Show inspector' : 'Hide inspector'}
      aria-expanded={!collapsed}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
  );
}
