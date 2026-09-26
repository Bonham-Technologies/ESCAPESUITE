import React, { useState } from 'react';
import styles from './ClipEditor.module.css';

// Collapsible section component
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  /**
   * Freeze the section's contents (ESCSUITE-84). `children` then sit inside a
   * disabled `<fieldset>`, which disables every input, select, textarea and
   * button under it natively; the header toggle and `footer` stay outside it,
   * so a frozen section can still be opened, closed and read.
   */
  disabled?: boolean;
  /**
   * Content rendered inside the open section but *after* — and outside — that
   * fieldset, for the one control a frozen section keeps: Animation's "Open
   * Keyframe Editor" button, which opens a panel rather than editing the clip.
   */
  footer?: React.ReactNode;
}

/**
 * One titled, collapsible block of the clip inspector.
 *
 * Owns nothing but its own open/closed flag, which it seeds from `defaultOpen`
 * at mount and never re-reads — so whether a section is open survives a
 * re-render, and which section a given `{condition && <CollapsibleSection/>}`
 * slot maps to is decided positionally by React. That is why the conditions
 * that show and hide these sections stay where they are in `ClipEditor`,
 * in the order they are in: moving one would hand its open/closed state to
 * a different section.
 *
 * `disabled` is the inspector's answer to a locked track: the section's
 * contents go inert while its own header, and anything in `footer`, keep
 * working. The fieldset appears *only* while `disabled` is set, so an ordinary
 * section's DOM is exactly what it always was.
 */
export function CollapsibleSection({ title, defaultOpen = true, children, badge, headerRight, disabled, footer }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`${styles.section} ${styles.collapsible}`}>
      <div className={styles.collapsibleHeader}>
        <button
          className={styles.collapsibleToggle}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <svg
            className={`${styles.collapseIcon} ${isOpen ? styles.open : ''}`}
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5l8 7-8 7V5z" />
          </svg>
          <span className={styles.sectionTitle}>{title}</span>
          {badge}
        </button>
        {headerRight && <div className={styles.headerRightContent}>{headerRight}</div>}
      </div>
      {isOpen && (
        <div className={styles.collapsibleContent}>
          {disabled ? (
            <fieldset className={styles.sectionBody} disabled>
              {children}
            </fieldset>
          ) : (
            children
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
