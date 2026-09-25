// The recordings already in storage: playing one back, downloading it, sending
// it to the editor, deleting it.
//
// The five handlers are plain functions, recreated on every render, exactly as
// they were inline. Memoising them now would change how often the sidebar and
// the playback dialog re-render, which is a behaviour change dressed as a
// cleanup — so they stay as they are. The hook binds no effect.
import { useState } from 'react';
import { deleteVideo, getVideoBlob, createBlobUrl, revokeBlobUrl } from '../core/storage';
import { analytics } from '../utils/analytics';
import { downloadBlob } from '../utils/downloadBlob';
import { sendToEditor } from '../utils/sendToEditor';
import { safeFileName } from '../utils/recordingFormat';
import type { Recording } from '../store/types';

export interface RecordingLibraryDeps {
  /** The list as the store holds it — read for the played recording's duration. */
  recordings: Recording[];
  removeRecording: (id: string) => void;
  /**
   * Re-read the storage headroom. Deleting is the remedy a storage-blocked
   * Record button recommends, so it has to be re-measured here or the button
   * stays disabled after the user has done what it asked.
   */
  refreshStorageSpace: () => Promise<void>;
}

export interface RecordingLibrary {
  /** Object URL of the recording being played back, or null when the dialog is closed. */
  playbackUrl: string | null;
  playbackName: string;
  playbackDuration: number;
  handleDeleteRecording: (id: string) => Promise<void>;
  handleSendToEditor: (id: string) => void;
  handlePlayRecording: (id: string, name: string) => Promise<void>;
  handleClosePlayback: () => void;
  handleDownload: (id: string, name: string) => Promise<void>;
}

export function useRecordingLibrary({
  recordings,
  removeRecording,
  refreshStorageSpace,
}: RecordingLibraryDeps): RecordingLibrary {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackName, setPlaybackName] = useState<string>('');
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);

  // Delete a recording, and the companions that belong to it
  const handleDeleteRecording = async (id: string) => {
    // A take is one thing to delete even when it is several files: deleting the
    // screen part takes its webcam part with it. Deleting the companion alone
    // deletes only the companion — the primary keeps its takeId and renders as
    // a plain take (see `utils/takeOrder.ts`), so nothing is rewritten.
    const companions = recordings.filter((r) => r.takeId === id && r.id !== id);

    await deleteVideo(id);
    removeRecording(id);
    for (const companion of companions) {
      await deleteVideo(companion.id);
      removeRecording(companion.id);
    }
    // Never rejects — see the store action.
    void refreshStorageSpace();
  };

  // Send recording to ESCAPEARTIST (or the host, when embedded)
  const handleSendToEditor = (id: string) => {
    sendToEditor(id);
  };

  // Play a recording
  const handlePlayRecording = async (id: string, name: string) => {
    // Clean up any existing playback
    if (playbackUrl) {
      revokeBlobUrl(playbackUrl);
    }

    const blob = await getVideoBlob(id);
    if (blob) {
      const url = createBlobUrl(blob);
      setPlaybackUrl(url);
      setPlaybackName(name);
      // Pass known duration so the player doesn't depend on WebM metadata
      const recording = recordings.find(r => r.id === id);
      setPlaybackDuration(recording?.duration || 0);
    }
  };

  // Close playback
  const handleClosePlayback = () => {
    if (playbackUrl) {
      revokeBlobUrl(playbackUrl);
    }
    setPlaybackUrl(null);
    setPlaybackName('');
    // The duration goes with the other two. Left standing, it was handed to
    // the *next* recording opened whose own duration could not be found.
    setPlaybackDuration(0);
  };

  // Download a recording as WebM (instant — blob is already fixed during save)
  const handleDownload = async (id: string, name: string) => {
    const blob = await getVideoBlob(id);
    if (!blob) return;

    analytics.recordingDownloaded();
    // The same anchor the MP4 path uses, deferred revoke included.
    downloadBlob(blob, `${safeFileName(name)}.webm`);
  };

  return {
    playbackUrl,
    playbackName,
    playbackDuration,
    handleDeleteRecording,
    handleSendToEditor,
    handlePlayRecording,
    handleClosePlayback,
    handleDownload,
  };
}
