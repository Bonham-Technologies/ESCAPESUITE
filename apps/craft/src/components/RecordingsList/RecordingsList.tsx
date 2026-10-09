import { NO_AUDIO_TRACK_REASON, type Mp4Conversion } from '../../hooks/useMp4Download';
import { MP4_NO_VIDEO_REASON } from '../../core/converter';
import type { Recording } from '../../store/types';
import { formatDuration } from '../../utils/recordingFormat';
import { companionPartFor } from '../../utils/companionParts';
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
  /**
   * Why "Open in Editor" cannot work right now, or null. The panel decides
   * (it is a deployment fact — opened from disk, no host to post to — not a
   * property of a recording); this component draws it as the button's title,
   * its `aria-describedby` target and one visible note, like the MP4 note.
   */
  editorBlockedReason: string | null;
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

/** The id the editor button's `aria-describedby` points at (ESCSUITE-221). */
const EDITOR_NOTE_ID = 'editor-note';

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
 * row rather than about the app). MP4 has the mirror-image per-recording gate
 * (ESCSUITE-143): a take with no picture at all — `mediaType === 'audio'`, a
 * mic-only take — disables the button with `MP4_NO_VIDEO_REASON`, the same
 * sentence `convertToMP4` itself throws if this ever slipped through, rather
 * than letting the user start a conversion that can only fail.
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
  editorBlockedReason,
  onPlay,
  onDownload,
  onDownloadMp4,
  onDownloadM4a,
  onCancelMp4,
  onUploadToHost,
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
            // The browser's answer first, then this recording's — the same
            // order `m4aReason` below reads in. A take with no picture at all
            // (a mic-only take, ESCSUITE-143) is refused by the converter
            // itself (`MP4_NO_VIDEO_REASON`), so the button is disabled with
            // that reason up front rather than offering a conversion that can
            // only fail at click.
            const blockedReason =
              converting
                ? null
                : mp4BlockedReason ?? (recording.mediaType === 'audio' ? MP4_NO_VIDEO_REASON : null);
            // What the conversion in flight is called, so a row running an M4A
            // does not describe itself as converting to MP4.
            const convertingLabel = converting ? FORMAT_LABELS[converting.format] : null;
            // The browser's answer first, then this recording's: where there
            // is no AAC encoder at all, that is the truer reason than "this
            // take has no sound in it".
            const m4aReason = converting
              ? null
              : m4aBlockedReason ?? (recording.hasAudio ? null : NO_AUDIO_TRACK_REASON);
            // Every companion row — camera or sound — says which track it is
            // and carries no conversions: those are the take's downloads and
            // live on the primary row.
            const companionLabel = companionPartFor(recording.role);
            // ESCSUITE-145: a row's `takeId` names its primary, but the
            // primary can be gone — deleted from ARTIST's media library while
            // this list still holds the orphaned companion (`takeOrder.ts`
            // shows it rather than hiding a file the user can still delete).
            // Sending an id nothing in this list answers to would hand the
            // editor a `?loadVideo=` that resolves to nothing at all, so this
            // falls back to the row's own id whenever its `takeId` is absent
            // from the list — which degrades exactly the way a non-primary id
            // already does: imported and placed alone.
            const editorTargetId =
              recording.takeId && recordings.some((r) => r.id === recording.takeId)
                ? recording.takeId
                : recording.id;
            // One note for the whole library, and only while there is one: it
            // is a fact about the app (a codec the browser lacks, a conversion
            // already running) rather than about this take.
            const conversionDescribedBy =
              mp4Note && !converting ? MP4_NOTE_ID : undefined;
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
                    {companionLabel && `${companionLabel.trackLabel} track • `}
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
                  {!companionLabel && (
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
                      primary's id and the editor resolves the siblings — or,
                      for an orphaned companion, its own id (ESCSUITE-145). */}
                  <button
                    className={styles.iconButton}
                    onClick={() => onSendToEditor(editorTargetId)}
                    title={editorBlockedReason ?? 'Open in Editor'}
                    aria-label={`Open ${recording.name} in Editor`}
                    aria-describedby={editorBlockedReason ? EDITOR_NOTE_ID : undefined}
                    disabled={editorBlockedReason !== null}
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
      {editorBlockedReason && recordings.length > 0 && (
        <p className={styles.mp4BlockedReason} id={EDITOR_NOTE_ID}>
          {editorBlockedReason}
        </p>
      )}
    </section>
  );
}
