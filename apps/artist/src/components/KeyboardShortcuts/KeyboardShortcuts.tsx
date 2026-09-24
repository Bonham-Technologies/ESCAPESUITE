// The shortcut sheet, and the one key that is still its own.
//
// It is a modal, so `App` counts it in `modalOpen` and the global cascade
// (`app/useAppKeyboardShortcuts.ts`) stops taking keys while it is up. That
// cascade is also what used to *open and close* it, so the second `?` that
// toggles it shut is bound here instead — the same arrangement ESCAPECRAFT's
// playback dialog uses, and what keeps the footer's "Press ? to toggle this
// panel" true.
//
// **Escape closes the sheet, and it is `useDialogBehaviour`'s.** It was bound
// here too until the sheet adopted the shared hook; two listeners for one key
// was one Escape path too many. Closing the sheet costs nothing — it holds no
// state and destroys nothing — so the hook's unconditional Escape is exactly
// the right meaning here. The hook also claims the key in the capture phase on
// `document` and `stopPropagation()`s it, which the sheet's own listener never
// did (it did not need to: the cascades below were already gated).
import { useEffect, useRef } from 'react';
import { useDialogBehaviour } from '@escapesuite/shared/hooks';
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
    title: 'Keyframe Graph',
    shortcuts: [
      { keys: ['←'], description: 'Previous Keyframe' },
      { keys: ['→'], description: 'Next Keyframe' },
      { keys: ['Home'], description: 'First Keyframe' },
      { keys: ['End'], description: 'Last Keyframe' },
      { keys: ['↑'], description: 'Nudge Value Up' },
      { keys: ['↓'], description: 'Nudge Value Down' },
      { keys: ['Shift', '↑'], description: 'Nudge Value Up (Coarse)' },
      { keys: ['Shift', '↓'], description: 'Nudge Value Down (Coarse)' },
      { keys: ['Alt', '←'], description: 'Nudge Time Back' },
      { keys: ['Alt', '→'], description: 'Nudge Time Forward' },
      { keys: ['Alt', 'Shift', '←'], description: 'Nudge Time Back (Coarse)' },
      { keys: ['Alt', 'Shift', '→'], description: 'Nudge Time Forward (Coarse)' },
      { keys: ['Enter'], description: 'Add Keyframe at Playhead' },
      { keys: ['Delete'], description: 'Delete Keyframe' },
      { keys: ['Backspace'], description: 'Delete Keyframe' },
      { keys: ['Escape'], description: 'Clear Keyframe Selection' },
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
  // `onClose` is read through a ref because `App` passes a fresh arrow every
  // render; depending on it directly would re-bind the listener on every
  // keystroke the app re-renders for. Same reason as `useDialogBehaviour`'s.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const dialogRef = useDialogBehaviour(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // The same typing guard the other two window listeners open with. The
      // sheet traps focus now, so no field inside it can take a keystroke and
      // the header's project-name input is no longer Tab-reachable behind it —
      // but this listener is on `window`, which every field in the document
      // reaches, so the guard is still what keeps a typed `?` a `?`.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // No stopPropagation and no preventDefault: the editor's two cascades
      // are already gated on `App`'s `modalOpen` while the sheet is up, so
      // there is nothing below to stop, and `?` has no default worth taking
      // away.
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
      >
        <div className={styles.header}>
          <h2 id="keyboard-shortcuts-title">Keyboard Shortcuts</h2>
          <button className={styles.closeButton} onClick={onClose} title="Close (Escape)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* The groups scroll and hold no controls of their own, so the region
            itself has to be in the tab order for a keyboard to scroll it
            (axe: scrollable-region-focusable). Being focusable also makes it
            the sheet's second and last stop in the focus trap. */}
        <div className={styles.content} tabIndex={0}>
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
