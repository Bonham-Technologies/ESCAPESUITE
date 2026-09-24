import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import type { SessionState } from '../core/storage';
import styles from '../App.module.css';

interface SessionRestorePromptProps {
  /** The session found in storage, summarised in the prompt. */
  session: SessionState;
  /** Restore the session. Handed the same session back. */
  onRestore: (session: SessionState) => void;
  /**
   * Start fresh. **Destructive**: `useSessionRestore`'s `handleDeclineSession`
   * calls `clearSessionState()`, so the saved session is gone afterwards.
   */
  onDecline: () => void;
}

/**
 * Escape's meaning here, and why it is the odd one out.
 *
 * `useDialogBehaviour` closes a dialog on Escape by calling whatever it is
 * handed. The other two overlays hand it their cancel — the shortcut sheet's
 * close, the project-load dialog's Cancel — because dismissing those costs
 * nothing. This prompt has no such answer: its two buttons *both* settle the
 * question, and one of them (`onDecline`) deletes the saved session. Escape is
 * the key people press to make a thing go away, so routing it to either button
 * would either discard work or silently accept it.
 *
 * So Escape is **swallowed**: the hook still claims it (preventDefault and
 * stopPropagation, keeping it off the editor's cascades behind the prompt) and
 * then calls this no-op. The prompt stays up, focus stays trapped inside it, and
 * the only two ways out are the two buttons — which is the right shape for a
 * question that must be answered.
 */
function swallowEscape(): void {
  /* deliberately nothing — see above */
}

/**
 * The "Resume Previous Session?" modal, offering the unsaved session found in
 * storage on startup.
 *
 * The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so
 * `session` is always present here — and so "closed" is "unmounted", which is
 * why `useDialogBehaviour` is left on its default `isOpen`.
 */
export function SessionRestorePrompt({ session, onRestore, onDecline }: SessionRestorePromptProps) {
  const dialogRef = useDialogBehaviour(swallowEscape);

  return (
    <div className={styles.loadingOverlay}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.sessionPrompt}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-prompt-title"
      >
        <h2 id="session-prompt-title">Resume Previous Session?</h2>
        <p>
          You have an unsaved session from{' '}
          {new Date(session.timestamp).toLocaleString()}
        </p>
        <p>
          Project: <strong>{session.project.name}</strong>
          <br />
          {session.sourceVideos.length} video(s),{' '}
          {session.project.timeline.clips.length} clip(s) on timeline
        </p>
        <div className={styles.sessionPromptButtons}>
          <button
            className={styles.sessionRestoreButton}
            onClick={() => onRestore(session)}
          >
            Restore Session
          </button>
          <button
            className={styles.sessionDeclineButton}
            onClick={onDecline}
          >
            Start Fresh
          </button>
        </div>
      </div>
    </div>
  );
}
