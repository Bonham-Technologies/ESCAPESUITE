import { useState } from 'react';
import { isEmbedded } from '@escapesuite/shared/config';
import { useRecorderStore } from '../../store/recorderStore';
import { useMp4Download } from '../../hooks/useMp4Download';
import { uploadToHost } from '../../utils/uploadToHost';
import { UPLOAD_UNAVAILABLE } from '../../utils/notices';
import { RecordingsList } from './RecordingsList';
import type { Recording } from '../../store/types';

interface RecordingsListPanelProps {
  /** Newest first, as the store keeps them. */
  recordings: Recording[];
  onPlay: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
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
  // Selected here rather than in `App` for the same reason the conversion
  // state lives here: it is the library's gate and nothing above it draws it.
  // It is written once, by the capability bootstrap, so this panel re-renders
  // once when the probe answers and never again.
  const mp4Support = useRecorderStore((s) => s.mp4Support);
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
  });
  // Standalone CRAFT has no one to post to, so the action does not exist
  // there — the prop is simply absent and the button is never drawn.
  const embedded = isEmbedded();
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
      onPlay={onPlay}
      onDownload={onDownload}
      onDownloadMp4={(id, name) => void startMp4Download(id, name)}
      onDownloadM4a={(id, name) => void startMp4Download(id, name, 'm4a')}
      onCancelMp4={cancelMp4Download}
      onUploadToHost={
        embedded ? (id, name) => void handleUploadToHost(id, name) : undefined
      }
      onSendToEditor={onSendToEditor}
      onDelete={onDelete}
    />
  );
}
