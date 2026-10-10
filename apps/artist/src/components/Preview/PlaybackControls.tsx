// The transport under the preview: play/pause, step, jump to either end — and
// the keyboard shortcuts that do the same without the buttons.
//
// Owns no canvas and draws nothing; it only moves the playhead in the store,
// which is why it sits beside PreviewPlayer rather than inside it.
//
// Space and the arrows are bound on `window` here rather than in
// `app/useAppKeyboardShortcuts.ts`, so this listener carries its own copy of
// that hook's `modalOpen` gate: a dialog is modal, and Space must not start
// playback from behind one.
import { useCallback, useEffect } from 'react';
import { installFocusModalityTracker, wasFocusedByPointer } from './focusModality';
import { useEditorStore } from '../../store/projectStore';
import { isTextEntryTarget } from '../../app/useAppKeyboardShortcuts';
import styles from './PreviewPlayer.module.css';

/**
 * What Space activates natively. ESCAPECRAFT's selector minus `select` and
 * contenteditable, which the typing guard above already returns for.
 */
const SPACE_ACTIVATES = 'button, [role="button"], a[href]';

/**
 * Whether Space belongs to whatever has focus rather than to the transport
 * (ESCSUITE-247, the twin of ESCAPECRAFT's ESCSUITE-185). Space is the
 * browser's activation key for a focused control, and `preventDefault()` is
 * what suppresses the click it synthesises, so the transport leaves the
 * keydown alone when the target is something Space operates. Only Space is
 * gated: the arrows, Home and End keep their targets. A control the mouse
 * focused does not take Space (ESCSUITE-270; see `focusModality.ts`).
 */
function spaceBelongsToTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.matches(SPACE_ACTIVATES) &&
    !wasFocusedByPointer()
  );
}

interface PlaybackControlsProps {
  /**
   * True while a modal is on screen. The transport's keys stop; its buttons,
   * which the dialog covers anyway, are left alone.
   *
   * Optional, and false by default, so a test that renders the transport on
   * its own gets the plain behaviour. `App` always passes the real flag.
   */
  modalOpen?: boolean;
}

export function PlaybackControls({ modalOpen = false }: PlaybackControlsProps) {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const currentTime = useEditorStore((state) => state.currentTime);
  const timelineDuration = useEditorStore((state) => state.project.timeline.duration);
  const clips = useEditorStore((state) => state.project.timeline.clips);
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);

  useEffect(() => installFocusModalityTracker(), []);

  const canPlay = clips.length > 0 && currentTime < timelineDuration;

  const handlePlayPause = useCallback(() => {
    if (!canPlay && !isPlaying) return;
    setIsPlaying(!isPlaying);
  }, [isPlaying, canPlay, setIsPlaying]);

  const handleStepBackward = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(Math.max(0, currentTime - 1));
  }, [currentTime, setCurrentTime, setIsPlaying]);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(Math.min(timelineDuration, currentTime + 1));
  }, [currentTime, timelineDuration, setCurrentTime, setIsPlaying]);

  const handleGoToStart = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [setCurrentTime, setIsPlaying]);

  const handleGoToEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(timelineDuration);
  }, [timelineDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Text entry (the shared predicate), plus every other form control: an
      // arrow on a slider or a select moves that control, and Space on a
      // checkbox or radio toggles it — they never were the transport's keys.
      if (
        isTextEntryTarget(e.target) ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // A modal is in front; the app behind it is not taking keys.
      if (modalOpen) {
        return;
      }

      switch (e.code) {
        case 'Space':
          if (spaceBelongsToTarget(e.target)) return;
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleStepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleStepForward();
          break;
        case 'Home':
          e.preventDefault();
          handleGoToStart();
          break;
        case 'End':
          e.preventDefault();
          handleGoToEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, handlePlayPause, handleStepBackward, handleStepForward, handleGoToStart, handleGoToEnd]);

  return (
    <div className={styles.controls}>
      <button
        className={styles.controlButton}
        onClick={handleGoToStart}
        title="Go to start (Home)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
        </svg>
      </button>

      <button
        className={styles.controlButton}
        onClick={handleStepBackward}
        title="Step backward (←)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      <button
        className={`${styles.controlButton} ${styles.playButton}`}
        onClick={handlePlayPause}
        disabled={!canPlay && !isPlaying}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        className={styles.controlButton}
        onClick={handleStepForward}
        title="Step forward (→)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
        </svg>
      </button>

      <button
        className={styles.controlButton}
        onClick={handleGoToEnd}
        title="Go to end (End)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>

    </div>
  );
}
