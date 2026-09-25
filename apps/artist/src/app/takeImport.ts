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
//     that part its picture and nothing else. A thumbnail is cosmetic;
//   * a `getAllVideoMetadata` that rejects costs the take its *companions*,
//     not the take: the scan is only how siblings are found, so a take whose
//     library cannot be read degrades to the single file every
//     pre-ESCSUITE-14 recording already is.
//
// The primary's own path is untouched by both: its blob is already in hand, and
// a primary whose length cannot be resolved still throws, because that is the
// take failing rather than a part of it.
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage';
import { resolveStoredDuration } from '../core/videoProcessor';
import { isPlaceableRole, orderTakeParts } from '../utils/takeParts';
import type { SourceVideo, TakeClipPart } from '../store/types';

/** What the handoff produced: what to place, what to revoke, what was lost. */
export interface ImportedTake {
  /** Every part that can be placed, primary first. */
  clipParts: TakeClipPart[];
  /** The blob URLs made for the parts' thumbnails. The caller owns revoking them. */
  thumbnailUrls: string[];
  /** Parts the take names whose blob is no longer in storage. */
  missingParts: number;
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
 * Add every part of a take to the media library and describe what to place.
 *
 * The primary's blob is already in hand (the caller fetched it to know the take
 * exists at all); each companion is fetched here. A companion whose blob is
 * gone is **skipped and counted** — it never costs the take its screen
 * recording — while a primary that cannot be measured throws, because that is
 * the take failing and the caller already reports it.
 */
export async function importTake(
  primary: { blob: Blob; metadata: SourceVideo },
  addSourceVideo: (video: SourceVideo) => void
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
        duration = await resolvePartDuration(stored.blob, part, takeDuration);
      }

      // Cosmetic, so never fatal: a part with no picture is still a part.
      const thumbnailBlob = await getThumbnail(part.id).catch(() => undefined);
      const thumbnailUrl = thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : undefined;
      if (thumbnailUrl) thumbnailUrls.push(thumbnailUrl);

      addSourceVideo({ ...part, duration, thumbnailUrl });

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

  return { clipParts, thumbnailUrls, missingParts };
}
