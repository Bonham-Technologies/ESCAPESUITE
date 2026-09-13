import type { Recording } from '../../store/types';
import { formatDuration } from '../../utils/recordingFormat';
import { DownloadIcon, EditIcon, PlayIcon, RecordIcon, TrashIcon } from '../icons';
import styles from '../../App.module.css';

interface RecordingsListProps {
  /** Newest first, as the store keeps them. */
  recordings: Recording[];
  onPlay: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onSendToEditor: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The library panel: every saved take with its thumbnail, duration and size,
 * and the four things that can be done with it.
 *
 * Nothing here touches storage. The row knows the recording's id and name and
 * hands both to the caller, because playing, downloading, handing over to the
 * editor and deleting all reach past this panel — into IndexedDB, into the
 * playback dialog, into the host page.
 *
 * Each action button is labelled with the recording's own name ("Play Standup
 * Demo"), so a screen reader can tell one row's buttons from the next's; the
 * icons themselves are `aria-hidden`.
 */
export function RecordingsList({
  recordings,
  onPlay,
  onDownload,
  onSendToEditor,
  onDelete,
}: RecordingsListProps) {
  return (
    <section className={styles.sidebarSection} style={{ flex: 1, overflow: 'hidden' }}>
      <h2 className={styles.sidebarTitle}>Recordings</h2>
      <div className={styles.recordingsList}>
        {recordings.length === 0 ? (
          <div className={styles.emptyState}>
            <RecordIcon className={styles.emptyIcon} />
            <p>No recordings yet</p>
          </div>
        ) : (
          recordings.map((recording) => (
            <div key={recording.id} className={styles.recordingItem}>
              {recording.thumbnailUrl ? (
                <img
                  src={recording.thumbnailUrl}
                  alt=""
                  className={styles.recordingThumbnail}
                />
              ) : (
                <div className={styles.recordingThumbnail} />
              )}
              <div className={styles.recordingInfo}>
                <div className={styles.recordingName}>{recording.name}</div>
                <div className={styles.recordingMeta}>
                  {formatDuration(recording.duration)} •{' '}
                  {(recording.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
              <div className={styles.recordingActions}>
                <button
                  className={styles.iconButton}
                  onClick={() => onPlay(recording.id, recording.name)}
                  title="Play"
                  aria-label={`Play ${recording.name}`}
                >
                  <PlayIcon />
                </button>
                <div className={styles.downloadDropdown}>
                  <button
                    className={styles.iconButton}
                    onClick={() => onDownload(recording.id, recording.name)}
                    title="Download WebM"
                    aria-label={`Download ${recording.name}`}
                  >
                    <DownloadIcon />
                  </button>
                </div>
                <button
                  className={styles.iconButton}
                  onClick={() => onSendToEditor(recording.id)}
                  title="Open in Editor"
                  aria-label={`Open ${recording.name} in Editor`}
                >
                  <EditIcon />
                </button>
                <button
                  className={styles.iconButton}
                  onClick={() => onDelete(recording.id)}
                  title="Delete"
                  aria-label={`Delete ${recording.name}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
