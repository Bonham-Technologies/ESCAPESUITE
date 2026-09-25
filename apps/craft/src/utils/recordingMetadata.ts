// Pure builders for the two records a finished recording writes: the shared
// SourceVideo metadata stored beside the blob, and the recorder's own
// Recording list entry. Callers pass in whatever they already computed (the
// blob, the duration, the generated thumbnail URL) and get back a plain
// object — no store, no blob-URL creation (that stays at the call site).
//
// `resolveHasAudio` lives here too: it is the one expression that answers the
// question both records are given, and it is here rather than inside
// `useRecordingSave` so that the hook and the tests that pin the answer call
// the same function instead of two copies of the same `||`.
import type {
  SourceVideo,
  Recording,
  RecordingRole,
  OverlayPlacement,
} from '../store/types';
import { companionPartFor } from './companionParts';

/**
 * What the take actually captured, as opposed to what its config asked for.
 *
 * Resolved once by `useRecordingController` when the take starts, from the
 * streams it really acquired, and handed to `saveRecording` with the blob —
 * the same resolve-once discipline the separate-tracks mode gets, and for the
 * same reason: a fact about that take, not about the settings as they stand
 * now.
 */
export interface CapturedAudio {
  /**
   * A microphone stream with a track in it was really acquired — the toggle
   * AND the device. That is the pair the recorder asks when it wires the mix
   * and the pair the controller counts the take's parts with, so the stored
   * `hasAudio` cannot disagree with either (ESCSUITE-70).
   */
  micAcquired: boolean;
}

/**
 * Whether a take captured any audio: the one answer its two records are given.
 *
 * Neither half is a toggle, because a toggle only *asks*. The microphone half
 * is the track the take really acquired (ESCSUITE-70) — a machine with no
 * microphone leaves the toggle on and hands back `mic: null`. The system half
 * is the toggle AND `systemAudioShared`, which is what the tick box in the
 * browser's own share dialog answered (ESCSUITE-62).
 *
 * A pure function of three booleans, called once per record-writing pass by
 * `useRecordingSave`, so nothing derives this expression twice.
 */
export function resolveHasAudio(
  captured: CapturedAudio,
  systemAudioEnabled: boolean,
  systemAudioShared: boolean
): boolean {
  return captured.micAcquired || (systemAudioEnabled && systemAudioShared);
}

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
  // The role's own noun, from the one table that has it. Both parts of a take
  // are saved with the same `now`, so a companion's name is the take's name
  // with its half named — which is what its own WebM download is called and
  // what ARTIST shows as the source's name.
  const part = companionPartFor(role);
  return {
    id,
    name: part ? `${takeName} — ${part.label}` : takeName,
    duration,
    width,
    height,
    // An audio part has no frames to rate. 0 rather than 30 because that is
    // what ESCAPEARTIST's own audio importer writes (core/videoProcessor.ts),
    // and a part that arrived from a recording should be indistinguishable
    // from one that arrived from a file.
    frameRate: part?.isAudio ? 0 : 30,
    mimeType: blob.type,
    size: blob.size,
    // Everything in ARTIST that decides whether to draw a clip, decode a
    // frame or export a video track branches on this. A mic part written as
    // 'video' would be a black rectangle in the preview and a wasted encode
    // in the export.
    mediaType: part?.isAudio ? 'audio' : 'video',
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
  /**
   * Absent for a part with no thumbnail — an audio companion, which has no
   * picture to decode one from. The list draws its own empty placeholder.
   */
  thumbnailUrl?: string;
  /**
   * Whether this part captured the webcam. Passed in rather than read off the
   * config, for the same reason `hasAudio` is: the config describes the
   * *take*, and the parts of one take do not all answer alike — the audio
   * halves of a webcam take have no camera in them.
   */
  hasWebcam: boolean;
  /**
   * Whether this part captured any audio — the same value `buildSourceVideo`
   * was given. The config cannot answer it, in either half: ticking "System
   * Audio" only *asks* for it and the browser's share dialog has the last word
   * (ESCSUITE-62), and the microphone toggle only asks too — a machine with no
   * microphone records none with the toggle still on (ESCSUITE-70). See
   * `resolveHasAudio` above, which is what the caller computes it with.
   */
  hasAudio: boolean;
}

/** The recorder's own Recording list entry for a finished recording. */
export function buildRecordingEntry({
  sourceVideo,
  now,
  size,
  thumbnailUrl,
  hasWebcam,
  hasAudio,
}: BuildRecordingEntryInput): Recording {
  return {
    id: sourceVideo.id,
    name: sourceVideo.name,
    duration: sourceVideo.duration,
    createdAt: now,
    size,
    hasWebcam,
    hasAudio,
    // Genuinely absent, not present-and-undefined — an audio part has no
    // picture to decode a thumbnail from, and the list's empty placeholder
    // is drawn from the key being missing, the same way `takeId` and `role`
    // are missing on a single-file take.
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    // Same rule as the stored record: absent on a single-file take, so the
    // library's grouping sees nothing to group.
    ...(sourceVideo.takeId !== undefined ? { takeId: sourceVideo.takeId } : {}),
    ...(sourceVideo.role !== undefined ? { role: sourceVideo.role } : {}),
  };
}
