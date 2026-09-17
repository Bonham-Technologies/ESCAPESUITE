import { useDialogBehaviour } from '@escapesuite/shared/hooks';
import { CloseIcon } from '../icons';
import styles from '../../App.module.css';

interface HelpDialogProps {
  onClose: () => void;
}

/**
 * The Recording Tips modal — static copy about what to capture, how to get a
 * clean take, the six recording modes, and the two download formats.
 *
 * Like the playback dialog, the backdrop closes it and the panel swallows the
 * click, and it is named through `aria-labelledby="help-title"`. Whether it is
 * open is the App's state; this component is the contents.
 *
 * `useDialogBehaviour` supplies the rest of what a modal owes the keyboard —
 * Escape, the focus trap, and focus back to the Help button on close.
 */
export function HelpDialog({ onClose }: HelpDialogProps) {
  const dialogRef = useDialogBehaviour(onClose);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.helpModal}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
    >
      <div className={styles.helpContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.helpHeader}>
          <h2 id="help-title" className={styles.helpTitle}>Recording Tips</h2>
          <button
            className={styles.helpClose}
            onClick={onClose}
            title="Close"
            aria-label="Close help"
          >
            <CloseIcon />
          </button>
        </div>

        {/* The tips scroll and hold no controls of their own, so the region
            itself has to be in the tab order for a keyboard to scroll it
            (axe: scrollable-region-focusable). */}
        <div className={styles.helpBody} tabIndex={0}>
          <section className={styles.helpSection}>
            <h3>Choosing What to Record</h3>
            <p>When you start recording, your browser will ask what you want to capture:</p>
            <ul>
              <li>
                <strong>Entire Screen</strong> (Recommended) - Captures everything on your monitor.
                Best for tutorials and demos where you switch between apps.
              </li>
              <li>
                <strong>Window</strong> - Captures a specific application window.
                Note: For browser windows, only the active tab is visible.
              </li>
              <li>
                <strong>Browser Tab</strong> - Captures a single browser tab.
                Good for recording web content without distractions.
              </li>
            </ul>
          </section>

          <section className={styles.helpSection}>
            <h3>Best Practices</h3>
            <ul>
              <li>
                <strong>Use "Entire Screen" for multi-app recordings</strong> - This ensures
                everything you do is captured, regardless of which window is focused.
              </li>
              <li>
                <strong>Keep ESCAPECRAFT in a separate window</strong> - If using window capture,
                run ESCAPECRAFT in its own browser window so it doesn't appear in your recording.
              </li>
              <li>
                <strong>Check "Share system audio"</strong> - Enable this in the capture dialog
                to record sounds from videos, games, and other applications.
              </li>
              <li>
                <strong>Use keyboard shortcuts</strong> - Press <kbd>R</kbd> to start,
                <kbd>P</kbd> to pause, <kbd>S</kbd> to stop, and <kbd>Esc</kbd> to cancel.
              </li>
            </ul>
          </section>

          <section className={styles.helpSection}>
            <h3>Recording Modes</h3>
            <ul>
              <li><strong>Screen Only</strong> - Just your screen, no audio</li>
              <li><strong>Screen + Mic</strong> - Screen with your voice narration</li>
              <li><strong>Screen + System Audio</strong> - Screen with app sounds</li>
              <li><strong>Screen + Both</strong> - Screen with mic and system audio</li>
              <li><strong>Webcam Only</strong> - Just your camera with microphone</li>
              <li><strong>Picture-in-Picture</strong> - Screen with webcam overlay</li>
            </ul>
          </section>

          <section className={styles.helpSection}>
            <h3>Download Formats</h3>
            <ul>
              <li>
                <strong>WebM</strong> - Native browser format. Instant download, works great
                in Chrome, Firefox, and most video editors.
              </li>
              <li>
                <strong>MP4</strong> - Universal format, and it plays everywhere including
                Windows Media Player and QuickTime. Your browser converts it here on your
                machine, which takes roughly as long as the recording itself - you will see
                the progress and can cancel at any point. One at a time, and Chrome or Edge
                only.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
