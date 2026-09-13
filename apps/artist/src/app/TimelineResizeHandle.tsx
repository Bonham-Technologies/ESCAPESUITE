import type { MouseEventHandler } from 'react';
import styles from '../App.module.css';

interface TimelineResizeHandleProps {
  /** Whether a drag is in progress, which the handle shows as an active state. */
  isResizing: boolean;
  /** Begin a drag. */
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  /** Reset the timeline to its default height. */
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
}

/**
 * The grab strip between the editor body and the timeline.
 *
 * It only reports the two gestures; the drag itself — the document listeners,
 * the clamping and the persisted height — belongs to the caller.
 */
export function TimelineResizeHandle({ isResizing, onMouseDown, onDoubleClick }: TimelineResizeHandleProps) {
  return (
    <div
      className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ''}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize timeline (double-click to reset)"
    >
      <div className={styles.resizeHandleGrip} />
    </div>
  );
}
