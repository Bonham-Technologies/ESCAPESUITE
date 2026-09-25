// Turning a finished take into a stored recording: repair the container if the
// recorder that produced it needs it, pull the metadata, settle on a thumbnail,
// write both records, and put the result at the top of the list.
//
// The recorder type and the thumbnail grabbed off the live preview arrive
// through refs rather than arguments, because the recorder's onStop fires from
// callbacks captured one render earlier: a value passed down then would be the
// one from before the take started.
import { useCallback, type RefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { storeVideo, storeThumbnail, createBlobUrl } from '../core/storage';
import { generateThumbnail, extractVideoMetadata } from '../core/thumbnailGenerator';
import { fixWebMMetadata } from '../core/converter';
import { useRecorderStore } from '../store/recorderStore';
import { createPlaceholderThumbnail } from '../utils/previewThumbnail';
import { buildSourceVideo, buildRecordingEntry } from '../utils/recordingMetadata';
import { NOT_SEEKABLE } from '../utils/notices';
import type { CompanionPart, Recording, RecordingConfig, RecordingState } from '../store/types';

export interface RecordingSaveDeps {
  /** Which recorder produced the blob — written by handleStartRecording. */
  recorderTypeRef: RefObject<'webcodecs' | 'mediarecorder'>;
  /** The frame grabbed from the live preview before the recorder stopped. */
  capturedThumbnailRef: RefObject<Blob | null>;
  config: RecordingConfig;
  setState: (state: RecordingState) => void;
  addRecording: (recording: Recording) => void;
  /** The one notice channel — see utils/notices.ts. */
  setNotice: (notice: string | null) => void;
}

/** Save a finished take. `recordedDuration` is what the recorder timed. */
export type SaveRecording = (
  rawBlob: Blob,
  recordedDuration: number,
  /**
   * The take's second half, when the recorder produced one. Only the
   * separate-tracks mode does — see `core/webcodecs-recorder.ts`.
   */
  companion?: CompanionPart | null
) => Promise<void>;

export function useRecordingSave({
  recorderTypeRef,
  capturedThumbnailRef,
  config,
  setState,
  addRecording,
  setNotice,
}: RecordingSaveDeps): SaveRecording {
  // Save recording to storage
  const saveRecording = useCallback(async (
    rawBlob: Blob,
    recordedDuration: number,
    companion?: CompanionPart | null
  ) => {
    setState('saving');

    // No catch: a save that failed is the caller's to report. Swallowing it
    // here left the controller setting 'idle' as if the take had been stored.
    let blob: Blob;
    if (recorderTypeRef.current === 'webcodecs') {
      // WebCodecs output is already a proper WebM with Cues — no fix needed
      blob = rawBlob;
    } else {
      // MediaRecorder output needs duration/Cues metadata fix
      try {
        blob = await fixWebMMetadata(rawBlob);
      } catch (error) {
        // An unrepaired MediaRecorder WebM plays but does not seek: it has no
        // Duration and no Cues. Keeping it is still better than losing the
        // take — but saving it with no trace at all is how ESCSUITE-2 came
        // back as "my recording won't scrub".
        console.warn('WebM metadata repair failed:', error);
        setNotice(NOT_SEEKABLE);
        blob = rawBlob;
      }
    }

    const id = uuidv4();
    // Pass the known duration since WebM from MediaRecorder often has issues
    const metadata = await extractVideoMetadata(blob, recordedDuration);
    const now = Date.now();

    // Use pre-captured thumbnail from live preview (more reliable than from blob)
    // Fall back to generating from blob if capture failed
    let thumbnail = capturedThumbnailRef.current;
    if (!thumbnail) {
      try {
        thumbnail = await generateThumbnail(blob);
      } catch {
        // Create a simple placeholder thumbnail if all else fails
        thumbnail = await createPlaceholderThumbnail();
      }
    }
    capturedThumbnailRef.current = null; // Clear for next recording

    // Use recorded duration if metadata extraction failed. Both halves matter:
    // `> 0` rejects the zero a failed extraction reports, and `isFinite`
    // rejects the `Infinity` an unrepaired MediaRecorder WebM reports for its
    // duration — which `> 0` alone would accept and store as the take's length.
    // `extractVideoMetadata` already maps a non-finite duration to the timed
    // one, so nothing delivers that today; this is the hook's own contract, not
    // a dependence on the helper staying that way.
    const duration =
      Number.isFinite(metadata.duration) && metadata.duration > 0
        ? metadata.duration
        : recordedDuration;

    // Whether the take actually captured any audio — one answer, written to
    // both records below so the stored metadata and the list entry cannot
    // disagree (ESCSUITE-60), and the M4A button stays truthful after a reload.
    //
    // The microphone half is the config's to answer: asking for it and getting
    // it are the same event, and a refused permission never starts a take.
    // System audio is not: ticking it only *asks*, because the tick box that
    // decides is in the browser's own share dialog, so a take recorded with it
    // clear has no sound at all (ESCSUITE-62). `systemAudioShared` is what the
    // controller read off the display stream's tracks when this take started —
    // it is reset to `true` only when the *next* one starts, so at save time it
    // still describes the take being saved.
    //
    // Read through `getState()` rather than selected: this hook renders inside
    // `App`, and a subscription here would re-render the whole screen on a
    // field the save path reads once. Still the config rather than the blob —
    // reading the file back would mean a decode on the save path.
    const { systemAudioShared } = useRecorderStore.getState();
    const hasAudio =
      config.microphoneEnabled || (config.systemAudioEnabled && systemAudioShared);

    // A companion take is one take in two files: the primary names it (its own
    // id is the takeId), carries the mixed audio and the overlay geometry, and
    // the companion carries the camera. Both are written here rather than in
    // two passes so a half-saved take cannot reach the library.
    const isCompanionTake = companion != null;
    const overlayPlacement = isCompanionTake
      ? {
          position: config.webcamPosition,
          size: config.webcamSize,
          shape: config.webcamShape,
        }
      : undefined;

    const sourceVideo = buildSourceVideo({
      id,
      now,
      blob,
      duration,
      width: metadata.width,
      height: metadata.height,
      hasAudio,
      hasWebcam: config.webcamEnabled,
      ...(isCompanionTake
        ? { takeId: id, role: 'screen' as const, startOffset: 0, overlayPlacement }
        : {}),
    });

    await storeVideo(id, blob, sourceVideo);
    await storeThumbnail(id, thumbnail);

    if (companion) {
      const companionId = uuidv4();
      const companionMetadata = await extractVideoMetadata(companion.blob, recordedDuration);
      // The frame grabbed off the live preview is the *composited* picture, so
      // it is the primary's thumbnail and not this part's. Decode one from the
      // companion's own file, with the same placeholder behind it as the
      // primary's fallback chain.
      let companionThumbnail: Blob;
      try {
        companionThumbnail = await generateThumbnail(companion.blob);
      } catch {
        companionThumbnail = await createPlaceholderThumbnail();
      }
      const companionSourceVideo = buildSourceVideo({
        id: companionId,
        now,
        blob: companion.blob,
        duration:
          Number.isFinite(companionMetadata.duration) && companionMetadata.duration > 0
            ? companionMetadata.duration
            : recordedDuration,
        width: companionMetadata.width,
        height: companionMetadata.height,
        // Slice 1 keeps the whole mix on the primary output, so this half has
        // no audio track at all — and must not be offered an M4A download.
        hasAudio: false,
        hasWebcam: true,
        takeId: id,
        role: 'webcam',
        startOffset: companion.startOffset,
      });

      await storeVideo(companionId, companion.blob, companionSourceVideo);
      await storeThumbnail(companionId, companionThumbnail);

      // Added FIRST because `addRecording` prepends: the primary then lands on
      // top of it and the webcam row sits directly under the take it belongs
      // to, which is the order `loadRecordings` rebuilds after a reload.
      addRecording(buildRecordingEntry({
        sourceVideo: companionSourceVideo,
        now,
        size: companion.blob.size,
        thumbnailUrl: createBlobUrl(companionThumbnail),
        config,
        hasAudio: false,
      }));
    }

    addRecording(buildRecordingEntry({
      sourceVideo,
      now,
      size: blob.size,
      thumbnailUrl: createBlobUrl(thumbnail),
      config,
      hasAudio,
    }));
  }, [setState, addRecording, setNotice, config, recorderTypeRef, capturedThumbnailRef]);

  return saveRecording;
}
