import { isStandaloneMode, editorUrl } from '@escapesuite/shared/config';
import type { RecordingState } from '../../store/types';
import styles from '../../App.module.css';

interface AppHeaderProps {
  /** The recorder's state machine — the only thing the status region reports. */
  state: RecordingState;
  /**
   * The app's one notice — a failed save, an unreadable library, a source that
   * did not arrive — or null. Announced through the same live region.
   */
  notice: string | null;
  /** Opens the recording-tips dialog; the dialog itself is the App's state. */
  onOpenHelp: () => void;
}

/**
 * The app bar: the suite link (hidden in the standalone build), the wordmark,
 * the live status region, and the two header buttons.
 *
 * The header owns its two navigation decisions rather than taking them as
 * props, because both are deployment facts and not App state: whether there is
 * a suite to go back to (`isStandaloneMode()`) and where the editor lives
 * (`editorUrl()`). The "Open Editor" button deliberately opens the editor
 * itself even when CRAFT is embedded — only "Send to Editor", which hands over
 * one specific recording, is routed through the host.
 *
 * The status region is `aria-live="polite" aria-atomic="true"` and holds at
 * most one `role="status"` span, so a screen reader hears the whole phrase
 * ("Recording", "Paused", "Saving...") each time the state changes.
 *
 * A `notice` is announced through that same region, and deliberately carries
 * **no** `role` of its own: the region's `aria-live` is what announces it, and
 * a second `role="status"` would both break the one-status promise above and
 * make an atomic region announce two independent things as one phrase. A
 * notice and a running take can be on screen at once — "System audio was not
 * shared" during a recording is exactly that case.
 */
export function AppHeader({ state, notice, onOpenHelp }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        {!isStandaloneMode() && (
          <a href="/" className={styles.dashboardLink} title="Back to ESCAPE Suite">
            ← ESCAPE Suite
          </a>
        )}
        <h1 className={styles.logo}>ESCAPECRAFT</h1>
      </div>

      <div className={styles.headerCenter} aria-live="polite" aria-atomic="true">
        {state === 'recording' && (
          <span className={styles.recordingIndicator} role="status">
            <span className={styles.recordingDot} aria-hidden="true" />
            Recording
          </span>
        )}
        {state === 'paused' && (
          <span className={styles.pausedIndicator} role="status">Paused</span>
        )}
        {state === 'saving' && (
          <span className={styles.pausedIndicator} role="status">Saving...</span>
        )}
        {notice && <span className={styles.noticeIndicator}>{notice}</span>}
      </div>

      <div className={styles.headerRight}>
        <button
          className={styles.headerButton}
          onClick={onOpenHelp}
          title="Recording Tips"
          aria-label="Help - Recording Tips"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Help
        </button>
        <button
          className={`${styles.headerButton} ${styles.editorButton}`}
          onClick={() => window.open(editorUrl(), 'escapeartist')}
          title="Open Editor"
          aria-label="Open Editor in new window"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open Editor
        </button>
      </div>
    </header>
  );
}
