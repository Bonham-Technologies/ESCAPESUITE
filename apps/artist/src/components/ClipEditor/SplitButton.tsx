import { useEditorStore } from '../../store/projectStore';
import { relativeTimeInClip } from './clipEditorModel';
import styles from './ClipEditor.module.css';

interface SplitButtonProps {
  /** Where the clip starts on the timeline, in seconds. */
  clipPosition: number;
  /** How long the clip runs, in seconds. */
  clipDuration: number;
  /** Split the clip at the playhead. */
  onSplit: () => void;
  /**
   * Refuse the split outright — the clip's track is locked (ESCSUITE-84).
   * Or'd with the playhead-derived reason this button already has.
   */
  disabled?: boolean;
}

/**
 * The Actions section's Split button, and the only part of the clip inspector
 * that depends on the playhead.
 *
 * Deliberately its own component, and deliberately subscribed to the *answer*
 * rather than to the playhead: playback writes `currentTime` to the store
 * roughly every 200 ms, and a selector for it anywhere above here re-rendered
 * the whole panel on every tick to change one `disabled` attribute (see
 * `ClipEditor.rerender.test.tsx`). Selecting the boolean means zustand's
 * `Object.is` comparison ends the tick for us: this button re-renders when the
 * playhead enters or leaves the clip, twice over a pass across it, and not at
 * all in between.
 *
 * Not wrapped in `React.memo`, for the same reason `PreviewTimecode` is not:
 * its parent only re-renders when the selected clip itself changes, so a memo
 * here would skip no render any counter can see — and this repo does not add a
 * memo without a counter that moved.
 *
 * Split stays visible but disabled when the playhead is outside the clip or
 * exactly on its first frame, since splitting there would produce an empty
 * first half — and when the caller says the clip's track is locked, which the
 * store would refuse anyway.
 */
export function SplitButton({ clipPosition, clipDuration, onSplit, disabled }: SplitButtonProps) {
  const outsideClip = useEditorStore((state) => {
    const timeInClip = relativeTimeInClip(state.currentTime, clipPosition, clipDuration);
    return timeInClip === null || timeInClip <= 0;
  });

  return (
    <button
      className={styles.actionButton}
      onClick={onSplit}
      disabled={disabled || outsideClip}
      title="Split clip at playhead position"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="2" x2="12" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
      Split
    </button>
  );
}
