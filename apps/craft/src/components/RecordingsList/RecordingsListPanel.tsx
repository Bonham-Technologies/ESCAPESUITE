import { useRecorderStore } from '../../store/recorderStore';
import { useMp4Download } from '../../hooks/useMp4Download';
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
 * The library panel's MP4 conversion state, held one level below `App`.
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
 * exactly that.
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
  const { converting, blockedReason, note, startMp4Download, cancelMp4Download } = useMp4Download({
    setNotice,
    mp4Support,
  });

  return (
    <RecordingsList
      recordings={recordings}
      mp4Converting={converting}
      mp4BlockedReason={blockedReason}
      mp4Note={note}
      onPlay={onPlay}
      onDownload={onDownload}
      onDownloadMp4={(id, name) => void startMp4Download(id, name)}
      onCancelMp4={cancelMp4Download}
      onSendToEditor={onSendToEditor}
      onDelete={onDelete}
    />
  );
}
