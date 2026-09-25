// Pure builders for the two records a finished recording writes: the shared
// SourceVideo metadata stored beside the blob, and the recorder's own
// Recording list entry. Callers pass in whatever they already computed (the
// blob, the duration, the generated thumbnail URL) and get back a plain
// object — no store, no blob-URL creation (that stays at the call site).
import type {
  SourceVideo,
  Recording,
  RecordingConfig,
  RecordingRole,
  OverlayPlacement,
} from '../store/types';

export interface BuildSourceVideoInput {
  id: string;
  now: number;
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  /**
   * Whether the take captured any audio. Computed once by the caller and
   * handed to `buildRecordingEntry` as well, so the stored metadata and the
   * list entry cannot disagree — see `useRecordingSave`, which owns the one
   * expression.
   */
  hasAudio: boolean;
  /**
   * Whether the take captured the webcam. Required, like `hasAudio`: this is
   * the only record of it that survives a reload, and `loadRecordings` read a
   * hard-coded `false` until ESCSUITE-14.
   */
  hasWebcam: boolean;
  /** Set on both parts of a separate-tracks take; the primary's own id. */
  takeId?: string;
  /** Which half of the take this record is. Absent whenever `takeId` is. */
  role?: RecordingRole;
  /** Seconds after the take's start at which this part begins. */
  startOffset?: number;
  /** Primary only: the overlay geometry the take was recorded with. */
  overlayPlacement?: OverlayPlacement;
}

/** The SourceVideo metadata written to storage alongside a finished recording's blob. */
export function buildSourceVideo({
  id,
  now,
  blob,
  duration,
  width,
  height,
  hasAudio,
  hasWebcam,
  takeId,
  role,
  startOffset,
  overlayPlacement,
}: BuildSourceVideoInput): SourceVideo {
  const takeName = `Recording ${new Date(now).toLocaleString()}`;
  return {
    id,
    // Both parts of a take are saved with the same `now`, so the webcam half's
    // name is the take's name with its half named — which is what its own WebM
    // download is called and what ARTIST will show as the source's name.
    name: role === 'webcam' ? `${takeName} — webcam` : takeName,
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
    hasWebcam,
    // Spread rather than assign: a take with no companion is stored with no
    // companion keys at all, so its record is what it was before ESCSUITE-14
    // and a reader cannot mistake a written `undefined` for a real absence.
    ...(takeId !== undefined ? { takeId } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(overlayPlacement !== undefined ? { overlayPlacement } : {}),
  };
}

export interface BuildRecordingEntryInput {
  sourceVideo: Pick<SourceVideo, 'id' | 'name' | 'duration' | 'takeId' | 'role'>;
  now: number;
  size: number;
  thumbnailUrl: string;
  config: Pick<RecordingConfig, 'webcamEnabled'>;
  /**
   * Whether the take captured any audio — the same value `buildSourceVideo`
   * was given. Passed in rather than derived from the config here, because the
   * config cannot answer it: ticking "System Audio" only *asks* for it, and
   * the browser's share dialog has the last word (ESCSUITE-62).
   */
  hasAudio: boolean;
}

/** The recorder's own Recording list entry for a finished recording. */
export function buildRecordingEntry({
  sourceVideo,
  now,
  size,
  thumbnailUrl,
  config,
  hasAudio,
}: BuildRecordingEntryInput): Recording {
  return {
    id: sourceVideo.id,
    name: sourceVideo.name,
    duration: sourceVideo.duration,
    createdAt: now,
    size,
    thumbnailUrl,
    hasWebcam: config.webcamEnabled,
    hasAudio,
    // Same rule as the stored record: absent on a single-file take, so the
    // library's grouping sees nothing to group.
    ...(sourceVideo.takeId !== undefined ? { takeId: sourceVideo.takeId } : {}),
    ...(sourceVideo.role !== undefined ? { role: sourceVideo.role } : {}),
  };
}
