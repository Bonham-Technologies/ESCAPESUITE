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
import { sendToEditor } from '../utils/sendToEditor';
import { safeFileName } from '../utils/recordingFormat';
import type { Recording } from '../store/types';

export interface RecordingLibraryDeps {
  /** The list as the store holds it — read for the played recording's duration. */
  recordings: Recording[];
  removeRecording: (id: string) => void;
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

export function useRecordingLibrary({ recordings, removeRecording }: RecordingLibraryDeps): RecordingLibrary {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackName, setPlaybackName] = useState<string>('');
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);

  // Delete a recording
  const handleDeleteRecording = async (id: string) => {
    await deleteVideo(id);
    removeRecording(id);
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
  };

  // Download a recording as WebM (instant — blob is already fixed during save)
  const handleDownload = async (id: string, name: string) => {
    const blob = await getVideoBlob(id);
    if (!blob) return;

    analytics.recordingDownloaded();
    const url = createBlobUrl(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = safeFileName(name);
    a.download = `${safeName}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    revokeBlobUrl(url);
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
