import type { ShapeType } from '../../store/types';
import styles from './ClipEditor.module.css';

interface ClipEditorEmptyStateProps {
  /** Add a text overlay clip to the timeline. */
  onAddText: () => void;
  /** Add a shape overlay clip of `type` to the timeline. */
  onAddShape: (type: ShapeType) => void;
}

/**
 * The inspector panel's contents when no clip is selected: the "Select a
 * clip to edit" prompt plus the five buttons that create an overlay out of
 * nothing. `ClipEditor` supplies the surrounding `div.container` itself —
 * in both the empty and selected states — so that element's identity is
 * stable across the empty↔selected transition and the scrolling container
 * never remounts.
 *
 * It owns the prompt and the buttons' icons and labels; which shape each
 * button asks for is the only thing it tells its caller, so the store stays
 * entirely in `ClipEditor`.
 */
export function ClipEditorEmptyState({ onAddText, onAddShape }: ClipEditorEmptyStateProps) {
  return (
    <>
      <div className={styles.empty}>
        <p>Select a clip to edit</p>
        <p className={styles.hint}>Or add an overlay:</p>
      </div>

      <div className={styles.addOverlaySection}>
        <button className={styles.addOverlayButton} onClick={onAddText}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3" />
            <path d="M12 4v16" />
            <path d="M8 20h8" />
          </svg>
          Add Text
        </button>
        <button className={styles.addOverlayButton} onClick={() => onAddShape('rectangle')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          Rectangle
        </button>
        <button className={styles.addOverlayButton} onClick={() => onAddShape('ellipse')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="9" ry="7" />
          </svg>
          Ellipse
        </button>
        <button className={styles.addOverlayButton} onClick={() => onAddShape('arrow')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          Arrow
        </button>
        <button className={styles.addOverlayButton} onClick={() => onAddShape('blur')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="12" cy="12" r="3" strokeDasharray="2 1" />
          </svg>
          Blur
        </button>
      </div>
    </>
  );
}
