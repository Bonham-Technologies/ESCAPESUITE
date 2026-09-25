// Bringing a handed-over take into the media library (ESCSUITE-14).
//
// `?loadVideo=<id>` names a take's **primary** part. Since ESCAPECRAFT can
// record the webcam as its own track, a take can be several `SourceVideo`s
// sharing a `takeId` — so the id is resolved to its parts here, each part is
// added to the library, and what comes back is the list the store places.
//
// It lives beside the hook rather than inside it for two reasons: the hook's
// effect is already the app's longest, and this is the half with the storage
// reads and the failure arms worth testing on their own.
//
// Two rules about storage failing, both deliberate, because how a part was lost
// is not the take's business — only that it was:
//
//   * a companion whose `getVideo` **rejects** is treated exactly as one that
//     resolves `undefined`: skipped and counted, never fatal. The alternative
//     is a half-imported take — the primary already in the media library,
//     nothing on the timeline and a failure toast — which is worse than a take
//     that arrived a track short and said so;
//   * a `getThumbnail` that rejects, for any part including the primary, costs
//     that part its picture and nothing else. A thumbnail is cosmetic, and so
//     is the waveform read beside it;
//   * a `getAllVideoMetadata` that rejects costs the take its *companions*,
//     not the take: the scan is only how siblings are found, so a take whose
//     library cannot be read degrades to the single file every
//     pre-ESCSUITE-14 recording already is.
//
// The primary's own path is untouched by both: its blob is already in hand, and
// a primary whose length cannot be resolved still throws, because that is the
// take failing rather than a part of it.
//
// One more rule, and the reason the library is a *parameter* here: a take any
// part of which the library already holds is refused whole, before the first
// write. `isInLibrary` is how the caller lends this module that question.
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage';
import { resolveStoredDuration } from '../core/videoProcessor';
import { isPlaceableRole, orderTakeParts } from '../utils/takeParts';
import { extractWaveformData } from '../utils/waveform';
import type { SourceVideo, TakeClipPart } from '../store/types';

/** What the handoff produced: what to place, what to revoke, what was lost. */
export interface ImportedTake {
  /** Every part that can be placed, primary first. */
  clipParts: TakeClipPart[];
  /** The blob URLs made for the parts' thumbnails. The caller owns revoking them. */
  thumbnailUrls: string[];
  /** Parts the take names whose blob is no longer in storage. */
  missingParts: number;
  /**
   * The library already held one of the take's parts, so **nothing** was
   * imported: no part added, no clip to place, no thumbnail made. The caller
   * says nothing about it either — see `importTake`.
   */
  alreadyInLibrary: boolean;
}

/**
 * The length to give a companion.
 *
 * Every part of a take is the same length by construction — one recorder, one
 * clock, one start, one stop — so a companion whose own file cannot be measured
 * borrows the take's length rather than being left off the timeline.
 */
async function resolvePartDuration(
  blob: Blob,
  part: SourceVideo,
  takeDuration: number
): Promise<number> {
  try {
    const duration = await resolveStoredDuration(blob, part);
    return Number.isFinite(duration) && duration > 0 ? duration : takeDuration;
  } catch {
    return takeDuration;
  }
}

/**
 * The waveform to give a part, and what it says about `hasAudio`.
 *
 * The media library computes one for every file it imports — `processVideoFile`
 * and `processAudioFile` both call `extractWaveformData` before the entry
 * reaches the store (`core/videoProcessor.ts`) — so the handoff has to as well,
 * or a take's audio parts sit on the timeline as bare rectangles until
 * something else asks for one (ESCSUITE-71). The same function, so there is one
 * waveform implementation; at the same point in the sequence, so the peaks
 * arrive with the library entry rather than after the clip.
 *
 * Three rules:
 *
 *   * a part ESCAPECRAFT recorded with **no audio** is not decoded at all. Its
 *     `hasAudio: false` is the capture's own answer (ESCSUITE-60/62) — the
 *     webcam half of a separate-tracks take has no audio track by construction,
 *     the whole mix staying on the primary — and decoding a video file to be
 *     told that is the one cost worth refusing;
 *   * `hasAudio` is only ever turned **on**. ESCAPECRAFT's flag says whether
 *     audio was captured, while the extractor's is a silence heuristic (peaks
 *     over 0.001), so letting it answer would have a take recorded in a quiet
 *     room lose the flag slice 3 went to the trouble of persisting. It does
 *     fill one in where there is none — a recording stored before ESCSUITE-60
 *     — because `TimelineTrack` needs the flag *and* the peaks, so a waveform
 *     computed without it would never be drawn;
 *   * a waveform that cannot be read costs the part its waveform and nothing
 *     else, exactly like a thumbnail. `extractWaveformData` already answers a
 *     file with no decodable audio with no peaks rather than throwing, so this
 *     arm is for the caller's side of the boundary — a blob whose bytes cannot
 *     be read into memory at all.
 */
async function resolvePartWaveform(
  blob: Blob,
  part: SourceVideo
): Promise<Pick<SourceVideo, 'waveformData' | 'hasAudio'> | undefined> {
  if (part.hasAudio === false) return undefined;

  const { peaks, hasAudio } = await extractWaveformData(blob).catch((error) => {
    console.warn('Could not read the waveform for a take part:', error);
    return { peaks: [], hasAudio: false };
  });
  // No peaks rather than an empty array: nothing downstream has to tell a
  // waveform that could not be read from one that is zero samples long.
  if (peaks.length === 0) return undefined;

  return { waveformData: peaks, hasAudio: hasAudio || part.hasAudio };
}

/**
 * Add every part of a take to the media library and describe what to place.
 *
 * The primary's blob is already in hand (the caller fetched it to know the take
 * exists at all); each companion is fetched here. A companion whose blob is
 * gone is **skipped and counted** — it never costs the take its screen
 * recording — while a primary that cannot be measured throws, because that is
 * the take failing and the caller already reports it.
 *
 * `isInLibrary` answers "does the media library already hold this id?". If it
 * says yes to **any** of the take's parts the take is refused whole and
 * `alreadyInLibrary` comes back true, with nothing added and nothing to place —
 * which is the caller's cue to say nothing at all. It defaults to "no", so a
 * caller with no library to consult imports unconditionally.
 */
export async function importTake(
  primary: { blob: Blob; metadata: SourceVideo },
  addSourceVideo: (video: SourceVideo) => void,
  isInLibrary: (id: string) => boolean = () => false
): Promise<ImportedTake> {
  const { metadata } = primary;
  // Only a take that says it has parts costs a second storage read: a plain
  // take is every recording made before ESCSUITE-14 and every composited PiP
  // take after it.
  //
  // `orderTakeParts` trusts that what it is handed is a take's *primary* — it
  // groups on `part.takeId === primary.id`. This is its only caller, and what
  // it passes is the `?loadVideo=` record, which is the primary by definition;
  // keep it that way.
  //
  // A scan that fails is answered the same way a missing companion is: the
  // primary's blob is already in hand, so refusing the whole take over a
  // *metadata* read would be the half-state this module exists to avoid.
  const parts =
    metadata.takeId === undefined
      ? [metadata]
      : orderTakeParts(
          metadata,
          await getAllVideoMetadata().catch((error) => {
            console.warn('Could not scan the library for the take companions:', error);
            return [];
          })
        );

  // A take already in the library is skipped **whole**: no re-add, no second
  // placement, no notice. Every part is checked, not only the primary, because
  // the two can be held separately — delete the primary from the library and
  // re-send the take from ESCAPECRAFT and the companion is the only part still
  // there. Re-adding a part is idempotent by id, but *placing* one is not: the
  // companion would arrive on the timeline a second time, on a second new
  // track. The check is here rather than in the caller because here is the
  // first place the take's parts are known, and it has to land before the
  // first write.
  if (parts.some((part) => isInLibrary(part.id))) {
    return { clipParts: [], thumbnailUrls: [], missingParts: 0, alreadyInLibrary: true };
  }

  // The stored duration is trusted unless it is unusable — a CRAFT take whose
  // WebM lost its Duration element is stored as Infinity — in which case the
  // length is recovered from the blob.
  const takeDuration = await resolveStoredDuration(primary.blob, metadata);

  const clipParts: TakeClipPart[] = [];
  const thumbnailUrls: string[] = [];
  let missingParts = 0;

  try {
    for (const part of parts) {
      const isPrimary = part.id === metadata.id;
      // The primary's bytes are already in hand; a companion's are the ones
      // storage hands back below. Both are needed twice over — for the length
      // and for the waveform — so the blob is carried rather than re-read.
      let blob = primary.blob;
      let duration = takeDuration;

      if (!isPrimary) {
        // A rejection here is a storage error — an aborted transaction, a
        // corrupt row — and is answered the same way as a row that is simply
        // gone, because the take cannot tell the difference and neither can
        // the user.
        const stored = await getVideo(part.id).catch(() => undefined);
        if (!stored) {
          // The take names a part storage no longer holds — cleared between the
          // two writes, or deleted by hand. Say so, and carry on: the screen
          // recording is the take's point.
          missingParts += 1;
          continue;
        }
        blob = stored.blob;
        duration = await resolvePartDuration(stored.blob, part, takeDuration);
      }

      // Cosmetic, so never fatal: a part with no picture is still a part.
      const thumbnailBlob = await getThumbnail(part.id).catch(() => undefined);
      const thumbnailUrl = thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : undefined;
      if (thumbnailUrl) thumbnailUrls.push(thumbnailUrl);

      // Cosmetic in the same way, and computed here so it arrives with the
      // library entry — which is where the media library's own import path puts
      // it (ESCSUITE-71).
      const waveform = await resolvePartWaveform(blob, part);

      addSourceVideo({ ...part, duration, thumbnailUrl, ...waveform });

      // A companion with a role this build does not know is in the library, where
      // it can be seen and deleted, and nowhere else: where it belongs on the
      // timeline is not a question this build can answer.
      if (!isPrimary && !isPlaceableRole(part.role)) continue;

      clipParts.push({
        sourceVideoId: part.id,
        name: part.name,
        duration,
        startOffset: part.startOffset ?? 0,
        width: part.width,
        height: part.height,
        // "This part has no picture", which is what the store needs to give an
        // audio clip no picture transform and to keep one out of the rectangle
        // the webcam corner is measured against (ESCSUITE-71). Carried as the
        // stored `mediaType` rather than as the role, so the store stays free of
        // roles, and absent on a part that *has* a picture, the way `role` and
        // `takeId` are absent on a single-file take.
        ...(part.mediaType === 'audio' ? { mediaType: 'audio' as const } : {}),
        // The overlay geometry is stored on the take's primary and applies to its
        // camera, so it travels onto that part here — which is what lets the
        // store place a take without knowing what a role is.
        ...(part.role === 'webcam' && metadata.overlayPlacement !== undefined
          ? { overlayPlacement: metadata.overlayPlacement }
          : {}),
      });
    }
  } catch (error) {
    // The URLs escape only on the success path, so a throw is the last moment
    // anything can see them: the caller revokes what it was returned, and a
    // rejected import returns nothing. (The hook this was lifted out of kept
    // its one URL in an effect-scoped variable its cleanup always saw; this is
    // what replaces that.)
    for (const url of thumbnailUrls) URL.revokeObjectURL(url);
    throw error;
  }

  return { clipParts, thumbnailUrls, missingParts, alreadyInLibrary: false };
}
