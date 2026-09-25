import { NO_AUDIO_TRACK_REASON, type Mp4Conversion } from '../../hooks/useMp4Download';
import type { Recording } from '../../store/types';
import { formatDuration } from '../../utils/recordingFormat';
import { DownloadIcon, EditIcon, PlayIcon, RecordIcon, TrashIcon, UploadIcon } from '../icons';
import styles from '../../App.module.css';

interface RecordingsListProps {
  /** Newest first, as the store keeps them. */
  recordings: Recording[];
  /** The MP4 conversion in flight, or null. At most one runs at a time. */
  mp4Converting: Mp4Conversion | null;
  /** Why no MP4 conversion may be started, or null when one may. */
  mp4BlockedReason: string | null;
  /**
   * Why no M4A conversion may be started, or null when one may. Separate from
   * `mp4BlockedReason` because the two are gated differently: a browser with
   * no AAC encoder still writes a (silent) MP4 and cannot write an M4A at all.
   * The per-recording half of the M4A gate — a take with no audio in it — is
   * decided here rather than handed down, because it is a fact about the row.
   */
  m4aBlockedReason: string | null;
  /**
   * What to say out loud under the library, or null. Not the same thing as
   * `mp4BlockedReason`: "still checking" blocks without being worth a
   * paragraph, and "this MP4 will be silent" is worth one without blocking.
   */
  mp4Note: string | null;
  onPlay: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onDownloadMp4: (id: string, name: string) => void;
  onDownloadM4a: (id: string, name: string) => void;
  onCancelMp4: () => void;
  /**
   * Hand the recording's bytes to the page embedding CRAFT, or absent when
   * nothing is embedding it. The button exists exactly when this prop does:
   * the panel asks `isEmbedded()`, this component only draws what it is
   * given, and standalone CRAFT is therefore one prop short of an action it
   * could not complete.
   */
  onUploadToHost?: (id: string, name: string) => void;
  onSendToEditor: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The id both conversion buttons' `aria-describedby` points at — the MP4 one
 * and the M4A one, because every sentence the note can carry is true of both
 * (no H.264 encoder and no WebCodecs block them together; no AAC encoder
 * silences one and forbids the other; a conversion already running blocks
 * both). One note for the whole list rather than one per row: what it says is
 * a fact about the app, not about the recording, so repeating it under every
 * row would say the same sentence five times. It exists only while `mp4Note`
 * is non-null, which is why the buttons point at it only then.
 */
const MP4_NOTE_ID = 'mp4-note';

/**
 * Said on the primary row of a take that has a webcam companion, for as long as
 * MP4 and M4A are the screen part alone.
 *
 * Slice 4 of ESCSUITE-14 makes both downloads composite — the converter will
 * draw the webcam through the take's stored `overlayPlacement` — and this note
 * goes with it. Until then the interim behaviour is acceptable *only* because
 * it is visible: a user who asked for a webcam and got an MP4 without one
 * would otherwise have to find that out by watching the file.
 */
export const SEPARATE_TRACKS_MP4_NOTE =
  'MP4 and M4A cover the screen track only — the webcam track is not included yet.';

/** The id of one row's interim note — one per row, since it is about that take. */
function separateTracksNoteId(id: string): string {
  return `separate-tracks-note-${id}`;
}

/** What each conversion is called on the row that is running it. */
const FORMAT_LABELS: Record<Mp4Conversion['format'], string> = {
  mp4: 'MP4',
  m4a: 'M4A',
};

/**
 * The library panel: every saved take with its thumbnail, duration and size,
 * and the six things that can be done with it — seven inside a host, which can
 * also be handed the file.
 *
 * Nothing here touches storage. The row knows the recording's id and name and
 * hands both to the caller, because playing, downloading, converting,
 * uploading to the host, handing over to the editor and deleting all reach
 * past this panel — into IndexedDB, into the playback dialog, into the host
 * page.
 *
 * Each action button is labelled with the recording's own name ("Play Standup
 * Demo"), so a screen reader can tell one row's buttons from the next's; the
 * icons themselves are `aria-hidden`.
 *
 * **The three downloads differ in kind, not only in format.** WebM is the
 * stored blob handed straight back; MP4 and M4A are conversions that use the
 * whole processor, so exactly one of them runs at a time — whichever it is:
 * the row it runs on shows the converter's progress message, its percentage and a Cancel
 * button (both named after the format actually running), and every other row's
 * conversion buttons go disabled with the reason in
 * `title` and in the visible note its `aria-describedby` points at — the same
 * "say why" shape the record button uses. Where the browser cannot encode
 * H.264 at all, the button is disabled with that reason rather than hidden.
 *
 * M4A is the audio alone, and it is gated twice: by the browser
 * (`m4aBlockedReason` — an AAC encoder is a hard requirement there, where an
 * MP4 merely goes silent without one) and by the recording (`hasAudio`, the
 * one gate this component decides for itself, because it is a fact about the
 * row rather than about the app).
 *
 * The note and the blocked reason are two props because they are two
 * questions. A button can be blocked by something not worth saying out loud
 * ("checking whether this browser can convert", true for a moment on every
 * load), and the library can have something to say while nothing is blocked
 * ("this MP4 will have no audio"). `mp4BlockedReason` disables and titles;
 * `mp4Note` is the paragraph, and the buttons are described by it when it is
 * there.
 */
export function RecordingsList({
  recordings,
  mp4Converting,
  mp4BlockedReason,
  m4aBlockedReason,
  mp4Note,
  onPlay,
  onDownload,
  onDownloadMp4,
  onDownloadM4a,
  onCancelMp4,
  onUploadToHost,
  onSendToEditor,
  onDelete,
}: RecordingsListProps) {
  // Which takes still have a webcam half in the library. A primary whose
  // companion was deleted is a plain take again (see `utils/takeOrder.ts`),
  // so its downloads leave nothing out and it says nothing.
  const takesWithCompanion = new Set(
    recordings
      .filter((recording) => recording.role === 'webcam' && recording.takeId !== undefined)
      .map((recording) => recording.takeId)
  );
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
            // What the conversion in flight is called, so a row running an M4A
            // does not describe itself as converting to MP4.
            const convertingLabel = converting ? FORMAT_LABELS[converting.format] : null;
            // The browser's answer first, then this recording's: where there
            // is no AAC encoder at all, that is the truer reason than "this
            // take has no sound in it".
            const m4aReason = converting
              ? null
              : m4aBlockedReason ?? (recording.hasAudio ? null : NO_AUDIO_TRACK_REASON);
            const isCompanion = recording.role === 'webcam';
            const hasCompanion = takesWithCompanion.has(recording.id);
            const noteId = hasCompanion ? separateTracksNoteId(recording.id) : null;
            // Both notes can apply at once: one is about the browser, one about
            // this take. aria-describedby takes a list.
            const conversionDescribedBy =
              [mp4Note && !converting ? MP4_NOTE_ID : null, noteId]
                .filter((id): id is string => id !== null)
                .join(' ') || undefined;
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
                    {isCompanion && 'Webcam track • '}
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
                  {!isCompanion && (
                    <>
                      <button
                        className={styles.mp4Button}
                        onClick={() => onDownloadMp4(recording.id, recording.name)}
                        title={
                          blockedReason ??
                          (converting ? `Converting to ${convertingLabel}…` : 'Download MP4')
                        }
                        aria-label={`Download ${recording.name} as MP4`}
                        aria-describedby={conversionDescribedBy}
                        disabled={converting !== null || blockedReason !== null}
                      >
                        MP4
                      </button>
                      <button
                        className={styles.mp4Button}
                        onClick={() => onDownloadM4a(recording.id, recording.name)}
                        title={
                          m4aReason ??
                          (converting
                            ? `Converting to ${convertingLabel}…`
                            : 'Download audio only (M4A)')
                        }
                        aria-label={`Download ${recording.name} as audio (M4A)`}
                        aria-describedby={conversionDescribedBy}
                        disabled={converting !== null || m4aReason !== null}
                      >
                        M4A
                      </button>
                    </>
                  )}
                  {onUploadToHost && (
                    <button
                      className={styles.iconButton}
                      onClick={() => onUploadToHost(recording.id, recording.name)}
                      title="Upload to host"
                      aria-label={`Upload ${recording.name} to host`}
                    >
                      <UploadIcon />
                    </button>
                  )}
                  {/* One take opens one project: either row hands over the
                      primary's id and the editor resolves the siblings. */}
                  <button
                    className={styles.iconButton}
                    onClick={() => onSendToEditor(recording.takeId ?? recording.id)}
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
                        {converting.message} • {Math.round(converting.progress)}%
                      </span>
                      <button
                        className={styles.conversionCancelButton}
                        onClick={onCancelMp4}
                        aria-label={`Cancel ${convertingLabel} conversion of ${recording.name}`}
                      >
                        Cancel
                      </button>
                    </div>
                    <div
                      className={styles.conversionProgressBar}
                      role="progressbar"
                      aria-label={`Converting ${recording.name} to ${convertingLabel}`}
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
                {noteId && (
                  <p className={styles.mp4BlockedReason} id={noteId}>
                    {SEPARATE_TRACKS_MP4_NOTE}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
      {mp4Note && recordings.length > 0 && (
        <p className={styles.mp4BlockedReason} id={MP4_NOTE_ID}>
          {mp4Note}
        </p>
      )}
    </section>
  );
}
