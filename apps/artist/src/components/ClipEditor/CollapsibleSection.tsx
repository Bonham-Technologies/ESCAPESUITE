import React, { useState } from 'react';
import styles from './ClipEditor.module.css';

// Collapsible section component
interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
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
 */
export function CollapsibleSection({ title, defaultOpen = true, children, badge, headerRight }: CollapsibleSectionProps) {
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
      {isOpen && <div className={styles.collapsibleContent}>{children}</div>}
    </div>
  );
}
