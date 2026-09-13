import { formatTimecode } from '../../utils/timeUtils';
import type { Track } from '../../store/types';
import styles from './ClipEditor.module.css';

interface ClipEditorHeaderProps {
  /** What kind of clip this is, e.g. `Video` or `Text Overlay`. */
  clipTypeLabel: string;
  /** The clip's name. */
  name: string;
  /** The clip's length, in seconds. */
  duration: number;
  /** Where the clip starts on the timeline, in seconds. */
  position: number;
  /** The track the clip sits on, or null/undefined when it can't be found. */
  track: Track | null | undefined;
  /** Delete the clip. The confirmation prompt lives with the caller. */
  onDelete: () => void;
}

/**
 * The clip inspector's title block: type, name, delete button, and the three
 * read-only rows underneath (duration, position, and — when the track is
 * known — its name).
 *
 * Everything here is display: the timecodes are formatted from the numbers it
 * is handed, and deleting is the caller's business.
 */
export function ClipEditorHeader({ clipTypeLabel, name, duration, position, track, onDelete }: ClipEditorHeaderProps) {
  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.clipType}>{clipTypeLabel}</span>
          <h3 className={styles.title}>{name}</h3>
        </div>
        <button
          className={styles.deleteButton}
          onClick={onDelete}
          title="Delete clip"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <div className={styles.info}>
        <div className={styles.infoRow}>
          <span className={styles.label}>Duration:</span>
          <span className={styles.value}>{formatTimecode(duration)}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.label}>Position:</span>
          <span className={styles.value}>{formatTimecode(position)}</span>
        </div>
        {track && (
          <div className={styles.infoRow}>
            <span className={styles.label}>Track:</span>
            <span className={styles.value}>{track.name}</span>
          </div>
        )}
      </div>
    </>
  );
}
