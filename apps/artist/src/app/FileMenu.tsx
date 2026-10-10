import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { nextMenuIndex } from './menuNavigation';
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

/** One row of the dropdown. */
interface FileMenuItem {
  label: string;
  /** Only a chord the cascade binds (`BOUND_CHORDS`); absent when none is. */
  shortcut?: string;
  run: () => void | Promise<void>;
  disabled: boolean;
  /** Draw the hairline rule above this item. */
  separatorBefore: boolean;
}

/**
 * The header's File dropdown: the button that opens it, the backdrop that
 * closes it on an outside click, and the four menu items with their shortcut
 * hints.
 *
 * Every item does its thing and then closes the menu; deciding what "its
 * thing" is belongs to the caller.
 *
 * ESCSUITE-216: the markup has always promised a menu — `aria-haspopup="menu"`
 * on the trigger, `role="menu"` on the dropdown — over four plain `<button>`s
 * with no `menuitem` role and no keyboard model, which is an
 * `aria-required-children` violation and a control a keyboard user has to Tab
 * through item by item. It implements the APG menu pattern now: one tab stop
 * (roving `tabIndex`), focus on the first item when it opens, ArrowDown/ArrowUp
 * wrapping, Home/End, Escape closing it and handing focus back to the trigger,
 * and Tab closing it on the way past. Enter and Space are left alone — they are
 * the browser's own activation for a `<button>`, and claiming them would only
 * re-implement it.
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
  const menuId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  // Written through a callback ref that drops React's unmount `null`, so the
  // array stays non-nullable and reading one back costs no branch. Every entry
  // is rewritten on the next open, before the effect below reads it.
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  // `null!` rather than `null`: the trigger renders unconditionally and the
  // only thing that reads this is a keydown handler inside the menu the
  // trigger opened, so it is always set by then. A `?.` here would be a
  // branch no test could reach.
  const triggerRef = useRef<HTMLButtonElement>(null!);

  const items: FileMenuItem[] = [
    {
      label: 'New Project',
      run: onNewProject,
      disabled: false,
      separatorBefore: false,
    },
    {
      label: 'Open Project...',
      shortcut: 'Ctrl+O',
      run: onLoadProject,
      disabled: isLoading,
      separatorBefore: false,
    },
    {
      label: 'Save Project',
      shortcut: 'Ctrl+S',
      run: onSaveProject,
      disabled: isSaving,
      separatorBefore: false,
    },
    {
      label: 'Export Video...',
      shortcut: 'Ctrl+E',
      run: onExport,
      disabled: !canExport,
      separatorBefore: true,
    },
  ];

  // The items the roving focus walks. A `disabled` <button> is out of
  // `.focus()`'s reach as well as out of the tab order, so the arrows step
  // over it rather than aiming at something that cannot take focus.
  const focusable = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  // Opening the menu hands focus to its first item and makes that the one tab
  // stop. The first item is New Project, which is never disabled, so this
  // never aims focus at something that cannot take it.
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      itemRefs.current[0].focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // The menu owns Escape while it is open. The editor's own Escape
      // cascade is a `window` listener (`useAppKeyboardShortcuts`), and
      // closing the menu must not also leave crop mode, clear the in/out
      // points or drop the selection behind it — the same bargain
      // `useDialogBehaviour` strikes for every modal.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      triggerRef.current.focus();
      return;
    }

    if (e.key === 'Tab') {
      // Not `preventDefault`ed: Tab's job is to move focus on, and the menu
      // only has to get out of the way.
      onClose();
      return;
    }

    const next = nextMenuIndex(focusable.indexOf(activeIndex), e.key, focusable.length);
    // A key the menu does not navigate on is the browser's: Enter and Space
    // are a <button>'s own activation, and anything else belongs to whatever
    // is listening above.
    if (next === null) return;

    e.preventDefault();
    const target = focusable[next];
    setActiveIndex(target);
    itemRefs.current[target].focus();
  };

  return (
    <div className={styles.menuContainer}>
      <button
        ref={triggerRef}
        className={styles.headerButton}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
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
          <div
            className={styles.menuDropdown}
            id={menuId}
            role="menu"
            aria-label="File options"
            onKeyDown={handleKeyDown}
          >
            {items.map((item, index) => (
              <Fragment key={item.label}>
                {item.separatorBefore && <div className={styles.menuDivider} role="separator" />}
                <button
                  ref={(el) => {
                    if (el) itemRefs.current[index] = el;
                  }}
                  className={styles.menuItem}
                  role="menuitem"
                  tabIndex={activeIndex === index ? 0 : -1}
                  onClick={() => { item.run(); onClose(); }}
                  disabled={item.disabled}
                >
                  <span className={styles.menuItemLabel}>{item.label}</span>
                  {item.shortcut && <span className={styles.menuItemShortcut}>{item.shortcut}</span>}
                </button>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
