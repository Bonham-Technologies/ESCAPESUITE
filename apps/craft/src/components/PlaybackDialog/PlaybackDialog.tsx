import { VideoPlayer } from '../VideoPlayer';
import { CloseIcon } from '../icons';
import styles from '../../App.module.css';

interface PlaybackDialogProps {
  /** Object URL for the recording's blob; the caller owns revoking it. */
  url: string;
  /** The recording's name — the dialog's accessible name and the player's title. */
  name: string;
  /**
   * The duration the recording was saved with. WebM straight out of
   * MediaRecorder has no reliable duration in its metadata, so the player is
   * told rather than asked.
   */
  duration: number;
  onClose: () => void;
}

/**
 * The modal that plays one saved recording back.
 *
 * The backdrop closes the dialog and the panel stops the click from reaching
 * it, which is the whole of the click-outside-to-dismiss behaviour. The dialog
 * is named by the recording's title through `aria-labelledby="playback-title"`.
 *
 * Whether the dialog exists at all is the caller's business — it renders only
 * when there is a URL to play — so this component draws unconditionally.
 */
export function PlaybackDialog({ url, name, duration, onClose }: PlaybackDialogProps) {
  return (
    <div className={styles.playbackModal} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="playback-title">
      <div className={styles.playbackContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.playbackHeader}>
          <span id="playback-title" className={styles.playbackTitle}>{name}</span>
          <button
            className={styles.playbackClose}
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close playback"
          >
            <CloseIcon />
          </button>
        </div>
        <VideoPlayer
          src={url}
          title={name}
          autoPlay
          knownDuration={duration}
          onClose={onClose}
          onError={(error) => console.error('Video playback error:', error)}
        />
      </div>
    </div>
  );
}
