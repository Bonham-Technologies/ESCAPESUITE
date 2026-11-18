import { useEffect, useRef, useState } from 'react';
import { isEmbedded } from '@escapesuite/shared/config';
import { useStoragePersisted } from '@escapesuite/shared/hooks';
import { useRecorderStore } from '../../store/recorderStore';
import { useMp4Download } from '../../hooks/useMp4Download';
import { editorBlockedReasonFor } from '../../utils/sendToEditor';
import { uploadToHost } from '../../utils/uploadToHost';
import { UPLOAD_UNAVAILABLE, UPLOAD_NO_HOST_ORIGIN } from '../../utils/notices';
import { confirmAction } from '../../utils/confirmAction';
import { deleteConfirmation } from '../../utils/deleteConfirmation';
import { RecordingsList } from './RecordingsList';
import type { Recording } from '../../store/types';

interface RecordingsListPanelProps {
  /** Newest first, as the store keeps them. */
  recordings: Recording[];
  onPlay: (id: string, name: string) => void;
  onDownload: (id: string, name: string, createdAt: number) => void;
  onSendToEditor: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The library panel's conversion state — MP4 and M4A both — held one level
 * below `App`.
 *
 * `convertToMP4` reports progress continuously for the whole length of a
 * conversion, and the only pixels it moves are one row's progress bar. Holding
 * that state here — rather than in `App`, which would re-render the header,
 * the preview stage, the transport bar and its seven hooks on every report —
 * is the same trade `SourceTogglesPanel` makes for the ~12-a-second
 * `audioLevels` push. `App.mp4rerender.test.tsx` counts it.
 *
 * The four handlers that reach past the library (play, download, editor,
 * delete) still come from `App`, because `useRecordingLibrary` owns the
 * playback dialog the keyboard shortcuts have to know about. What is picked up
 * here is the notice channel and the MP4 codec probe's answer: `setNotice` is
 * a stable zustand action, and `mp4Support` is written exactly once, when the
 * probe answers, so neither costs this panel a render in flight.
 *
 * `RecordingsList` itself stays driven by props alone — its own test asserts
 * exactly that. That is why "Upload to host" is decided here too: whether
 * there is a host at all is not a property of a recording, and `isEmbedded()`
 * is a `window.parent !== window` comparison, so asking it on every render
 * costs less than remembering the answer.
 */
export function RecordingsListPanel({
  recordings,
  onPlay,
  onDownload,
  onSendToEditor,
  onDelete,
}: RecordingsListPanelProps) {
  const setNotice = useRecorderStore((s) => s.setNotice);
  // ESCSUITE-468: whether the browser will keep the library, read on mount
  // and again after every save (`useRecordingSave` asks after the first).
  const storagePersisted = useStoragePersisted();
  // Selected here rather than in `App` for the same reason the conversion
  // state lives here: it is the library's gate and nothing above it draws it.
  // It is written once, by the capability bootstrap, so this panel re-renders
  // once when the probe answers and never again.
  const mp4Support = useRecorderStore((s) => s.mp4Support);
  // A stable zustand action, like `setNotice` — selecting it here costs this
  // panel nothing. `useMp4Download` re-runs it when a conversion discovers
  // the row's bytes are gone (ESCSUITE-176): the quota estimate the Record
  // button's gate reads (including item 3's separate-tracks arm) is stale
  // the moment that is discovered, the same reason `useRecordingLibrary`'s
  // Play and Download handlers already re-run it for the same fact.
  const refreshStorageSpace = useRecorderStore((s) => s.refreshStorageSpace);
  const {
    converting,
    blockedReason,
    m4aBlockedReason,
    note,
    startMp4Download,
    cancelMp4Download,
  } = useMp4Download({
    setNotice,
    mp4Support,
    refreshStorageSpace,
  });
  // Standalone CRAFT has no one to post to, so the action does not exist
  // there — the prop is simply absent and the button is never drawn.
  const embedded = isEmbedded();
  // Opened from disk, or as a standalone build with no absolute editor
  // address, and with no host to hand the id to, "Open in Editor" has nowhere
  // to go. Embedded, it posts `SEND_TO_EDITOR` instead and works wherever the
  // page came from (ESCSUITE-221, 259).
  const editorBlockedReason = editorBlockedReasonFor({ embedded });
  // The ids whose blobs are being read right now. A take can be a gigabyte,
  // so a second click before the first read returns would read it twice and
  // hand the host two copies of the same recording. Per id rather than one
  // flag, because one row's read is no reason to refuse another's — the
  // narrower version of the "one at a time" rule `useMp4Download` needs for
  // the conversion, which is CPU-bound where this is not. A ref, not state:
  // nothing on screen changes, so nothing should re-render. The Set is built
  // once through a lazy `useState` initialiser rather than `useRef(new Set())`,
  // which would allocate and discard a Set on every render — and this panel
  // renders on every MP4 progress tick.
  const [uploadsInFlight] = useState(() => ({ current: new Set<string>() }));

  // What the delete below needs after its confirmation has been answered,
  // read then rather than when the button was pressed (ESCSUITE-483). The
  // dialog can stay up for as long as the user likes, and meanwhile a
  // conversion can finish or start, a take can be saved (the floating
  // controls window is not behind the dialog's backdrop), and `onDelete` —
  // whose closure holds the list it cascades over — is replaced on every
  // render. Kept current by an effect rather than an assignment in the render
  // body, which `react-hooks/refs` refuses.
  const latest = useRef({ recordings, converting, onDelete });
  useEffect(() => {
    latest.current = { recordings, converting, onDelete };
  });

  // Delete asks first (ESCSUITE-483): one click used to take a whole take,
  // every file of it, with no undo, from a button next to "Open in Editor".
  // The question names the take and, when it is several files, says how many
  // go; Cancel, Escape and the backdrop delete nothing.
  //
  // Deleting the row that is converting must not strand the one conversion
  // slot: the row unmounting takes the progress readout and the only Cancel
  // button with it, while `useMp4Download`'s `converting` and `abortRef` stay
  // set — every other row's MP4 and M4A buttons stay disabled with
  // `MP4_BUSY_REASON` for however long the orphaned conversion still needs. So
  // a delete that matches the recording in flight cancels it first, before the
  // row underneath it is asked to go — the honest reading of "the user asked
  // for the take to go" (ESCSUITE-103). That is decided once the user has said
  // yes, against the conversion running then: a No must not cost the user a
  // conversion. `useMp4Download` also re-checks the recording still exists
  // before handing back a file, for the completion that races this instead
  // of losing to it.
  const handleDelete = async (recording: Recording, trigger: HTMLElement): Promise<void> => {
    const confirmed = await confirmAction({
      ...deleteConfirmation(recording, recordings),
      returnFocus: trigger,
    });
    if (!confirmed) return;
    const now = latest.current;
    // Gone while the question was up: there is nothing left to delete, and
    // deleting it again would report a second deletion.
    if (!now.recordings.some((r) => r.id === recording.id)) return;
    if (now.converting?.id === recording.id) {
      cancelMp4Download();
    }
    now.onDelete(recording.id);
  };

  const handleUploadToHost = async (id: string, name: string): Promise<void> => {
    if (uploadsInFlight.current.has(id)) return;
    uploadsInFlight.current.add(id);
    try {
      // The row's own bytes, with which half of which take it is. The panel
      // already has the list, so the component does not need a wider prop.
      // The third argument is passed only when the row actually has a role or
      // a takeId — a plain take's call stays two arguments, byte-identical to
      // what a host received before this feature existed.
      const row = recordings.find((recording) => recording.id === id);
      const part =
        row?.role !== undefined || row?.takeId !== undefined
          ? { role: row.role, takeId: row.takeId }
          : undefined;
      const result = part !== undefined
        ? await uploadToHost(id, name, part)
        : await uploadToHost(id, name);
      if (result === 'missing') setNotice(UPLOAD_UNAVAILABLE);
      // ESCSUITE-176: `uploadToHost` never broadcasts a recording's bytes —
      // without a `?hostOrigin=` it can parse, it posts nothing at all and
      // says so here, the same shape as the missing-blob case above.
      if (result === 'refused') setNotice(UPLOAD_NO_HOST_ORIGIN);
    } catch {
      // `getVideoBlob` reaches `getDB()`, which throws outright where
      // IndexedDB is blocked or unreadable. That is the same answer as an
      // absent blob as far as the user is concerned — the recording could not
      // be read and nothing was sent — and saying nothing would be worse here
      // than anywhere else, because the host, not CRAFT, is what would show a
      // result.
      setNotice(UPLOAD_UNAVAILABLE);
    } finally {
      uploadsInFlight.current.delete(id);
    }
  };

  return (
    <RecordingsList
      recordings={recordings}
      mp4Converting={converting}
      mp4BlockedReason={blockedReason}
      m4aBlockedReason={m4aBlockedReason}
      mp4Note={note}
      editorBlockedReason={editorBlockedReason}
      storagePersisted={storagePersisted}
      onPlay={onPlay}
      onDownload={onDownload}
      onDownloadMp4={(id, name) => void startMp4Download(id, name)}
      onDownloadM4a={(id, name) => void startMp4Download(id, name, 'm4a')}
      onCancelMp4={cancelMp4Download}
      onUploadToHost={
        embedded ? (id, name) => void handleUploadToHost(id, name) : undefined
      }
      onSendToEditor={onSendToEditor}
      onDelete={(recording, trigger) => void handleDelete(recording, trigger)}
    />
  );
}
