import styles from './KeyboardShortcuts.module.css';

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Tools',
    shortcuts: [
      { keys: ['V'], description: 'Selection Tool' },
      { keys: ['C'], description: 'Razor Tool (Split Clip)' },
      { keys: ['B'], description: 'Ripple Edit Tool' },
    ],
  },
  {
    title: 'Playback',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause' },
      { keys: ['J'], description: 'Play Backward' },
      { keys: ['K'], description: 'Pause' },
      { keys: ['L'], description: 'Play Forward' },
      { keys: ['←'], description: 'Previous Frame' },
      { keys: ['→'], description: 'Next Frame' },
      { keys: ['Home'], description: 'Go to Start' },
      { keys: ['End'], description: 'Go to End' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
      { keys: ['Ctrl', 'Y'], description: 'Redo' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['Delete'], description: 'Delete Selected Clip' },
      { keys: ['Ctrl', 'D'], description: 'Duplicate Clip' },
      { keys: ['Ctrl', 'B'], description: 'Split Clip at Playhead' },
      { keys: ['Escape'], description: 'Deselect' },
    ],
  },
  {
    title: 'Timeline',
    shortcuts: [
      { keys: ['+'], description: 'Zoom In' },
      { keys: ['-'], description: 'Zoom Out' },
      { keys: ['S'], description: 'Toggle Snapping' },
      { keys: ['L'], description: 'Toggle Loop Playback' },
      { keys: ['M'], description: 'Add Marker' },
      { keys: ['Shift', 'M'], description: 'Go to Next Marker' },
      { keys: ['Ctrl', 'M'], description: 'Go to Previous Marker' },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { keys: ['K'], description: 'Toggle Keyframe Panel' },
      { keys: ['?'], description: 'Show Keyboard Shortcuts' },
    ],
  },
  {
    title: 'File',
    shortcuts: [
      { keys: ['Ctrl', 'S'], description: 'Save Project' },
      { keys: ['Ctrl', 'O'], description: 'Open Project' },
      { keys: ['Ctrl', 'E'], description: 'Export Video' },
      { keys: ['Ctrl', 'N'], description: 'New Project' },
    ],
  },
];

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Keyboard Shortcuts</h2>
          <button className={styles.closeButton} onClick={onClose} title="Close (Escape)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {shortcutGroups.map((group) => (
            <div key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <div className={styles.shortcuts}>
                {group.shortcuts.map((shortcut, index) => (
                  <div key={index} className={styles.shortcutRow}>
                    <div className={styles.keys}>
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex}>
                          <kbd className={styles.key}>{key}</kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className={styles.plus}>+</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <span className={styles.description}>{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.tip}>Press <kbd className={styles.key}>?</kbd> to toggle this panel</span>
        </div>
      </div>
    </div>
  );
}
