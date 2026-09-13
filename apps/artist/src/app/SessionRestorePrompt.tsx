import type { SessionState } from '../core/storage';
import styles from '../App.module.css';

interface SessionRestorePromptProps {
  /** The session found in storage, summarised in the prompt. */
  session: SessionState;
  /** Restore the session. Handed the same session back. */
  onRestore: (session: SessionState) => void;
  /** Start fresh and leave the session alone. */
  onDecline: () => void;
}

/**
 * The "Resume Previous Session?" modal, offering the unsaved session found in
 * storage on startup.
 *
 * The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so
 * `session` is always present here.
 */
export function SessionRestorePrompt({ session, onRestore, onDecline }: SessionRestorePromptProps) {
  return (
    <div className={styles.loadingOverlay} role="dialog" aria-modal="true" aria-labelledby="session-prompt-title">
      <div className={styles.sessionPrompt}>
        <h3 id="session-prompt-title">Resume Previous Session?</h3>
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
