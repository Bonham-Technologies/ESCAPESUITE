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
}

/** The SourceVideo metadata written to storage alongside a finished recording's blob. */
export function buildSourceVideo({ id, now, blob, duration, width, height }: BuildSourceVideoInput): SourceVideo {
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
