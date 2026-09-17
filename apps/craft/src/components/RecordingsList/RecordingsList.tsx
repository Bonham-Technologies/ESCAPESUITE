import type { Mp4Conversion } from '../../hooks/useMp4Download';
import type { Recording } from '../../store/types';
import { formatDuration } from '../../utils/recordingFormat';
import { DownloadIcon, EditIcon, PlayIcon, RecordIcon, TrashIcon } from '../icons';
import styles from '../../App.module.css';

interface RecordingsListProps {
  /** Newest first, as the store keeps them. */
  recordings: Recording[];
  /** The MP4 conversion in flight, or null. At most one runs at a time. */
  mp4Converting: Mp4Conversion | null;
  /** Why no MP4 conversion may be started, or null when one may. */
  mp4BlockedReason: string | null;
  onPlay: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onDownloadMp4: (id: string, name: string) => void;
  onCancelMp4: () => void;
  onSendToEditor: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The id every blocked MP4 button's `aria-describedby` points at. One note for
 * the whole list rather than one per row: the reason is a fact about the app
 * (no WebCodecs, or a conversion already running), not about the recording, so
 * repeating it under every row would say the same sentence five times.
 */
const MP4_BLOCKED_REASON_ID = 'mp4-blocked-reason';

/**
 * The library panel: every saved take with its thumbnail, duration and size,
 * and the five things that can be done with it.
 *
 * Nothing here touches storage. The row knows the recording's id and name and
 * hands both to the caller, because playing, downloading, converting, handing
 * over to the editor and deleting all reach past this panel — into IndexedDB,
 * into the playback dialog, into the host page.
 *
 * Each action button is labelled with the recording's own name ("Play Standup
 * Demo"), so a screen reader can tell one row's buttons from the next's; the
 * icons themselves are `aria-hidden`.
 *
 * **The two downloads differ in kind, not only in format.** WebM is the stored
 * blob handed straight back; MP4 is a conversion that takes about as long as
 * the recording does and uses the whole processor, so exactly one runs at a
 * time: the row it runs on shows its phase, its percentage and a Cancel
 * button, and every other row's MP4 button goes disabled with the reason in
 * `title` and in the visible note its `aria-describedby` points at — the same
 * "say why" shape the record button uses. Where the browser has no WebCodecs
 * at all, the button is disabled with that reason rather than hidden.
 */
export function RecordingsList({
  recordings,
  mp4Converting,
  mp4BlockedReason,
  onPlay,
  onDownload,
  onDownloadMp4,
  onCancelMp4,
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
          recordings.map((recording) => {
            // The row being converted shows its progress instead of a reason:
            // "one at a time" is not why *this* button is unavailable.
            const converting = mp4Converting?.id === recording.id ? mp4Converting : null;
            const blockedReason = converting ? null : mp4BlockedReason;
            return (
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
                    className={styles.mp4Button}
                    onClick={() => onDownloadMp4(recording.id, recording.name)}
                    title={blockedReason ?? (converting ? 'Converting to MP4…' : 'Download MP4')}
                    aria-label={`Download ${recording.name} as MP4`}
                    aria-describedby={blockedReason ? MP4_BLOCKED_REASON_ID : undefined}
                    disabled={converting !== null || blockedReason !== null}
                  >
                    MP4
                  </button>
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
                {converting && (
                  <div className={styles.conversionProgress}>
                    <div className={styles.conversionProgressHeader}>
                      <span className={styles.conversionProgressText}>
                        {converting.phase} • {Math.round(converting.progress)}%
                      </span>
                      <button
                        className={styles.conversionCancelButton}
                        onClick={onCancelMp4}
                        aria-label={`Cancel MP4 conversion of ${recording.name}`}
                      >
                        Cancel
                      </button>
                    </div>
                    <div
                      className={styles.conversionProgressBar}
                      role="progressbar"
                      aria-label={`Converting ${recording.name} to MP4`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(converting.progress)}
                    >
                      <div
                        className={styles.conversionProgressFill}
                        style={{ width: `${converting.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {mp4BlockedReason && recordings.length > 0 && (
        <p className={styles.mp4BlockedReason} id={MP4_BLOCKED_REASON_ID}>
          {mp4BlockedReason}
        </p>
      )}
    </section>
  );
}
