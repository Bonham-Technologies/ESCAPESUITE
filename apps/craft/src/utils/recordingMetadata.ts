// Pure builders for the two records a finished recording writes: the shared
// SourceVideo metadata stored beside the blob, and the recorder's own
// Recording list entry. Callers pass in whatever they already computed (the
// blob, the duration, the generated thumbnail URL) and get back a plain
// object — no store, no blob-URL creation (that stays at the call site).
import type { SourceVideo, Recording, RecordingConfig } from '../store/types';

export interface BuildSourceVideoInput {
  id: string;
  now: number;
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  /**
   * Whether the take captured any audio. The caller passes the same
   * `microphoneEnabled || systemAudioEnabled` answer `buildRecordingEntry`
   * uses below, so the stored metadata and the list entry cannot disagree.
   */
  hasAudio: boolean;
}

/** The SourceVideo metadata written to storage alongside a finished recording's blob. */
export function buildSourceVideo({ id, now, blob, duration, width, height, hasAudio }: BuildSourceVideoInput): SourceVideo {
  return {
    id,
    name: `Recording ${new Date(now).toLocaleString()}`,
    duration,
    width,
    height,
    frameRate: 30,
    mimeType: blob.type,
    size: blob.size,
    mediaType: 'video',
    source: 'recording',
    recordedAt: now,
    // The list entry's `hasAudio` only lives as long as the tab. This is the
    // copy a reload reads back, and the M4A button is gated on it — see
    // `loadRecordings` in `store/recorderStore.ts`.
    hasAudio,
  };
}

export interface BuildRecordingEntryInput {
  sourceVideo: Pick<SourceVideo, 'id' | 'name' | 'duration'>;
  now: number;
  size: number;
  thumbnailUrl: string;
  config: Pick<RecordingConfig, 'webcamEnabled' | 'microphoneEnabled' | 'systemAudioEnabled'>;
}

/** The recorder's own Recording list entry for a finished recording. */
export function buildRecordingEntry({ sourceVideo, now, size, thumbnailUrl, config }: BuildRecordingEntryInput): Recording {
  return {
    id: sourceVideo.id,
    name: sourceVideo.name,
    duration: sourceVideo.duration,
    createdAt: now,
    size,
    thumbnailUrl,
    hasWebcam: config.webcamEnabled,
    hasAudio: config.microphoneEnabled || config.systemAudioEnabled,
  };
}
