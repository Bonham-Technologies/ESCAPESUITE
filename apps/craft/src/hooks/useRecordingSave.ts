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
import {
  buildSourceVideo,
  buildRecordingEntry,
  resolveHasAudio,
  type CapturedTake,
} from '../utils/recordingMetadata';
import { COMPANION_PARTS } from '../utils/companionParts';
import { NOT_SEEKABLE, SEPARATE_TRACK_NOT_SAVED } from '../utils/notices';
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

// The argument type travels with the save signature, so it is re-exported
// here; it is declared beside `resolveHasAudio`, which is the only thing that
// reads its audio half.
export type { CapturedTake };

/** Save a finished take. `recordedDuration` is what the recorder timed. */
export type SaveRecording = (
  rawBlob: Blob,
  recordedDuration: number,
  /**
   * The take's other parts, when the recorder produced any. Only the
   * separate-tracks mode does — see `core/webcodecs-recorder.ts`.
   */
  companions?: CompanionPart[] | null,
  /**
   * What the take was resolved to be. Optional so the three-argument call still
   * reads, and every field defaults to the modest answer: no microphone,
   * because a default of `true` would be exactly the bug this argument exists to
   * delete, and not separate tracks, because a take nobody said that about is
   * one file.
   */
  captured?: CapturedTake
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
    companions?: CompanionPart[] | null,
    captured: CapturedTake = { micAcquired: false, separateTracks: false }
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
    // The expression itself is `resolveHasAudio`, so the pins on it and this
    // call site cannot drift apart.
    //
    // Neither half is the config's alone, because a toggle only *asks* — but
    // the two halves are not resolved at the same moment, and that is worth
    // being exact about:
    //
    // - `micAcquired` is the controller's answer about the stream it acquired,
    //   resolved when the take started and carried here in `onStop`'s own
    //   closure. It therefore always describes *this* take (ESCSUITE-70).
    // - `systemAudioShared` is read from the store here, at save time. The
    //   controller writes it at take start and resets it only when the *next*
    //   take starts, so it describes this take for as long as no other take
    //   has begun (ESCSUITE-62). The limit that leaves: a recorder that
    //   flushed its last chunk so late that a new take is already running
    //   would pair this take's microphone answer with the new take's system
    //   answer. The cancelled flag drops a stop from a take the user threw
    //   away, but not this one; nothing observed it, and closing it would mean
    //   threading the flag through the save signature as well.
    //
    // Read through `getState()` rather than selected: this hook renders inside
    // `App`, and a subscription here would re-render the whole screen on a
    // field the save path reads once. Still the streams' answer rather than the
    // blob's — reading the file back would mean a decode on the save path.
    const { systemAudioShared } = useRecorderStore.getState();
    const hasAudio = resolveHasAudio(captured, config.systemAudioEnabled, systemAudioShared);

    // A companion take is one take in several files: the primary names it (its
    // own id is the takeId), carries the mixed audio and the overlay geometry,
    // and the companions carry the camera and each audio source the take
    // recorded. The mix staying on the primary is slice 1's rule, and it is why
    // the `hasAudio` above is the *primary's* answer: each audio part carries
    // its own, and the camera's part carries `false`. All of them are written
    // here rather than in two passes so a half-saved take cannot reach the
    // library.
    // Resolved by the controller before the countdown and carried here, rather
    // than inferred from the list that arrived (ESCSUITE-68): every way the
    // recorder can lose *all* of a take's companions delivers the same `null`
    // an ordinary take delivers, and such a take is still a separate-tracks
    // take — its primary is still named by its own `takeId`, still carries the
    // role, and still carries the geometry the camera was framed at, which is
    // the only record of it that survives. `config.separateTracks` would be a
    // different question: what the sidebar asks for now. The companions are
    // still enough on their own — the only caller today always says so, and
    // the arm is kept for a test that hands parts over without the mode.
    const isCompanionTake =
      captured.separateTracks || (companions != null && companions.length > 0);
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

    // A companion may never cost the take another part: the primary's own
    // storeVideo/storeThumbnail already ran above, and each companion is
    // written inside its own try/catch, so a bad decode or a storage write
    // that throws costs exactly the part it happened to and nothing else. One
    // notice covers however many were lost — there is one channel, and which
    // one it was is what the console is for.
    let lostAPart = false;

    // Reverse role order, because `addRecording` prepends: adding system,
    // then mic, then webcam, then the primary leaves the list as
    // [primary, webcam, mic, system] — the order `orderTakes` rebuilds after
    // a reload.
    for (const companion of [...(companions ?? [])].reverse()) {
      const part = COMPANION_PARTS[companion.role];
      try {
        const companionId = uuidv4();
        let companionSourceVideo;
        let companionThumbnail: Blob | null = null;

        if (part.isAudio) {
          // No metadata probe and no thumbnail. `extractVideoMetadata`
          // reports `videoWidth || 1920`, so probing an audio file would
          // store it as 1920x1080, and `generateThumbnail` would decode a
          // file with no picture and land on the placeholder. The length is
          // the recorder's own: every part of a take is the same length by
          // construction — one recorder, one clock, one start, one stop.
          companionSourceVideo = buildSourceVideo({
            id: companionId,
            now,
            blob: companion.blob,
            duration: recordedDuration,
            width: 0,
            height: 0,
            hasAudio: true,
            hasWebcam: false,
            takeId: id,
            role: companion.role,
            startOffset: companion.startOffset,
          });
        } else {
          const companionMetadata = await extractVideoMetadata(companion.blob, recordedDuration);
          // The frame grabbed off the live preview is the *composited*
          // picture, so it is the primary's thumbnail and not this part's.
          // Decode one from the companion's own file, with the same
          // placeholder behind it as the primary's fallback chain.
          try {
            companionThumbnail = await generateThumbnail(companion.blob);
          } catch {
            companionThumbnail = await createPlaceholderThumbnail();
          }
          companionSourceVideo = buildSourceVideo({
            id: companionId,
            now,
            blob: companion.blob,
            duration:
              Number.isFinite(companionMetadata.duration) && companionMetadata.duration > 0
                ? companionMetadata.duration
                : recordedDuration,
            width: companionMetadata.width,
            height: companionMetadata.height,
            // The whole mix stays on the primary output, so the camera's own
            // file has no audio track at all.
            hasAudio: false,
            hasWebcam: true,
            takeId: id,
            role: companion.role,
            startOffset: companion.startOffset,
          });
        }

        await storeVideo(companionId, companion.blob, companionSourceVideo);
        if (companionThumbnail) await storeThumbnail(companionId, companionThumbnail);

        addRecording(buildRecordingEntry({
          sourceVideo: companionSourceVideo,
          now,
          size: companion.blob.size,
          ...(companionThumbnail ? { thumbnailUrl: createBlobUrl(companionThumbnail) } : {}),
          hasWebcam: !part.isAudio,
          hasAudio: part.isAudio,
        }));
      } catch (error) {
        console.warn(`${part.trackLabel} track could not be saved:`, error);
        lostAPart = true;
      }
    }

    if (lostAPart) setNotice(SEPARATE_TRACK_NOT_SAVED);

    addRecording(buildRecordingEntry({
      sourceVideo,
      now,
      size: blob.size,
      thumbnailUrl: createBlobUrl(thumbnail),
      hasWebcam: config.webcamEnabled,
      hasAudio,
    }));
  }, [setState, addRecording, setNotice, config, recorderTypeRef, capturedThumbnailRef]);

  return saveRecording;
}
