import { CollapsibleSection } from './CollapsibleSection';
import { SplitButton } from './SplitButton';
import styles from './ClipEditor.module.css';

interface ActionsSectionProps {
  /** Whether the clip is a video clip. Video and audio clips are the splittable ones. */
  isVideo: boolean;
  /** Whether the clip is an audio clip. */
  isAudio: boolean;
  /** Where the clip starts on the timeline, in seconds — for the Split button. */
  clipPosition: number;
  /** How long the clip runs, in seconds — for the Split button. */
  clipDuration: number;
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
 * Split is the one control here that depends on the playhead, so it is its own
 * component and subscribes for itself — see `SplitButton`. This section takes
 * the clip's position and duration rather than a `timeInClip` its parent would
 * have had to recompute on every playback tick.
 */
export function ActionsSection({ isVideo, isAudio, clipPosition, clipDuration, onGoToClip, onDuplicate, onSplit }: ActionsSectionProps) {
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
          <SplitButton clipPosition={clipPosition} clipDuration={clipDuration} onSplit={onSplit} />
        )}
      </div>
    </CollapsibleSection>
  );
}
