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
  const parts =
    metadata.takeId === undefined
      ? [metadata]
      : orderTakeParts(metadata, await getAllVideoMetadata());

  // The stored duration is trusted unless it is unusable — a CRAFT take whose
  // WebM lost its Duration element is stored as Infinity — in which case the
  // length is recovered from the blob.
  const takeDuration = await resolveStoredDuration(primary.blob, metadata);

  const clipParts: TakeClipPart[] = [];
  const thumbnailUrls: string[] = [];
  let missingParts = 0;

  for (const part of parts) {
    const isPrimary = part.id === metadata.id;
    let duration = takeDuration;

    if (!isPrimary) {
      const stored = await getVideo(part.id);
      if (!stored) {
        // The take names a part storage no longer holds — cleared between the
        // two writes, or deleted by hand. Say so, and carry on: the screen
        // recording is the take's point.
        missingParts += 1;
        continue;
      }
      duration = await resolvePartDuration(stored.blob, part, takeDuration);
    }

    const thumbnailBlob = await getThumbnail(part.id);
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

  return { clipParts, thumbnailUrls, missingParts };
}
