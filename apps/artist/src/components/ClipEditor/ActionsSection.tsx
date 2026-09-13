import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface ActionsSectionProps {
  /** Whether the clip is a video clip. Video and audio clips are the splittable ones. */
  isVideo: boolean;
  /** Whether the clip is an audio clip. */
  isAudio: boolean;
  /** How far the playhead sits into the clip, or null when it is outside it. */
  timeInClip: number | null;
  /** Move the playhead to the clip's start. */
  onGoToClip: () => void;
  /** Duplicate the clip. */
  onDuplicate: () => void;
  /** Split the clip at the playhead. */
  onSplit: () => void;
}

/**
 * The "Actions" section of the clip inspector: go to, duplicate, and — only
 * for video and audio clips — split.
 *
 * Split stays visible but disabled when the playhead is outside the clip or
 * exactly on its first frame, since splitting there would produce an
 * empty first half.
 */
export function ActionsSection({ isVideo, isAudio, timeInClip, onGoToClip, onDuplicate, onSplit }: ActionsSectionProps) {
  return (
    <CollapsibleSection title="Actions">
      <div className={styles.actions}>
        <button
          className={styles.actionButton}
          onClick={onGoToClip}
          title="Go to clip start"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Go to
        </button>

        <button
          className={styles.actionButton}
          onClick={onDuplicate}
          title="Duplicate clip (Ctrl+D)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          Duplicate
        </button>

        {(isVideo || isAudio) && (
          <button
            className={styles.actionButton}
            onClick={onSplit}
            disabled={timeInClip === null || timeInClip <= 0}
            title="Split clip at playhead position"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="2" x2="12" y2="22" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            Split
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
}
