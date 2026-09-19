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
import { createPlaceholderThumbnail } from '../utils/previewThumbnail';
import { buildSourceVideo, buildRecordingEntry } from '../utils/recordingMetadata';
import { NOT_SEEKABLE } from '../utils/notices';
import type { Recording, RecordingConfig, RecordingState } from '../store/types';

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
export type SaveRecording = (rawBlob: Blob, recordedDuration: number) => Promise<void>;

export function useRecordingSave({
  recorderTypeRef,
  capturedThumbnailRef,
  config,
  setState,
  addRecording,
  setNotice,
}: RecordingSaveDeps): SaveRecording {
  // Save recording to storage
  const saveRecording = useCallback(async (rawBlob: Blob, recordedDuration: number) => {
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
    // rejects the `Infinity` an unrepaired MediaRecorder WebM reports — which
    // `> 0` would otherwise accept and store as the take's length.
    const duration =
      Number.isFinite(metadata.duration) && metadata.duration > 0
        ? metadata.duration
        : recordedDuration;

    const sourceVideo = buildSourceVideo({
      id,
      now,
      blob,
      duration,
      width: metadata.width,
      height: metadata.height,
    });

    await storeVideo(id, blob, sourceVideo);
    await storeThumbnail(id, thumbnail);

    addRecording(buildRecordingEntry({
      sourceVideo,
      now,
      size: blob.size,
      thumbnailUrl: createBlobUrl(thumbnail),
      config,
    }));
  }, [setState, addRecording, setNotice, config, recorderTypeRef, capturedThumbnailRef]);

  return saveRecording;
}
