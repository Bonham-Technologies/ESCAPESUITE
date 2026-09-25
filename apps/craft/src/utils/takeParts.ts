// Reading a take's parts back out of storage.
//
// A take is several files since ESCSUITE-14, and two things need them back: the
// MP4 conversion, which re-composites the screen and the camera into one file
// (decision 3), and "Upload to host", which hands the embedding page every part
// in one message (decision 4). Both are the same storage question — which
// records share this `takeId`, in what order, and which of them still have
// bytes — so both live here rather than in the hook and the poster.
//
// The take is named by its primary: a primary's `takeId` is its own id (see
// `utils/recordingMetadata.ts`), so grouping is one equality and no part needs
// a second identifier.
import { getAllVideoMetadata, getVideoBlob } from '../core/storage';
import { companionRank } from './companionParts';
import type { CompositeCompanion } from '../core/converter';
import type { RecordingRole, SourceVideo } from '../store/types';

/**
 * What a take's camera half turned out to be — three answers, because two of
 * them are not the same fact.
 *
 * `'none'` is an *absence*: a plain take, a take recorded before ESCSUITE-14,
 * or a take whose camera row was deleted on its own — which demotes it to a
 * plain take by construction (`utils/takeOrder.ts`). Nothing is left out of the
 * MP4, so nothing is worth saying about it.
 *
 * `'unavailable'` is a *loss*: the camera part is listed and its bytes are not
 * readable. The MP4 is still worth writing, and the caller is what tells the
 * user the file is missing something they recorded.
 */
export type WebcamCompanionLookup =
  | { kind: 'none' }
  | { kind: 'ready'; companion: CompositeCompanion }
  | { kind: 'unavailable' };

/**
 * The camera half of `primary`'s take, ready for `convertToMP4`.
 *
 * The placement comes from the **primary**, which is where it is stored: it is
 * the take's geometry, written once at save time from the recording config, and
 * the camera part carries none of its own. Without it there is nowhere to put
 * the camera, and nothing claiming the take ever had one, so that is an absence
 * rather than a loss.
 */
export async function loadWebcamCompanion(
  primary: SourceVideo
): Promise<WebcamCompanionLookup> {
  // A plain take: no storage read at all, which is what keeps a conversion of
  // an ordinary recording exactly as cheap as it was before this existed.
  if (primary.takeId === undefined || primary.overlayPlacement === undefined) {
    return { kind: 'none' };
  }

  const part = (await getAllVideoMetadata()).find(
    (metadata) => metadata.takeId === primary.takeId && metadata.role === 'webcam'
  );
  if (!part) return { kind: 'none' };

  const blob = await getVideoBlob(part.id);
  if (!blob) return { kind: 'unavailable' };

  return {
    kind: 'ready',
    companion: {
      blob,
      placement: primary.overlayPlacement,
      // 0 for every take this recorder writes — both halves come from one
      // `start()` on one clock — and read back rather than assumed, because it
      // is stored per part.
      startOffset: part.startOffset ?? 0,
    },
  };
}

/** One part of a take, as `UPLOAD_RECORDING.parts` lists it. */
export interface UploadPart {
  id: string;
  role: RecordingRole;
  name: string;
  blob: Blob;
  startOffset: number;
}

/** Where a part sits in the take's list: the primary, then its companions in role order. */
function partRank(role: string | undefined): number {
  // -1 rather than 0: the primary comes before `companionRank`'s first entry
  // without that function having to know the primary exists.
  return role === undefined || role === 'screen' ? -1 : companionRank(role);
}

/**
 * Every part of the take named by `takeId`, primary first, each with its bytes
 * — or an empty list when this take is one file.
 *
 * Empty for a single-file take on purpose: `parts` exists to name files the
 * host would not otherwise know about, and a list holding only the blob already
 * on `payload.blob` names none of them.
 */
export async function loadTakeParts(
  takeId: string,
  /**
   * Bytes the caller already has, so they are not read a second time.
   *
   * `uploadToHost` holds the primary's blob before it asks for the take — it
   * needs it to decide there is anything to post at all — and the primary is
   * one of the take's records, so without this the take's largest file is read
   * twice. A real IndexedDB read deserialises a *fresh* `Blob` every call, so
   * the second read is not just wasted work: the message would carry the
   * primary's bytes as two unrelated objects rather than one handle in two
   * places.
   */
  inHand?: { primaryBlob?: Blob }
): Promise<UploadPart[]> {
  const records = (await getAllVideoMetadata()).filter(
    (metadata) => metadata.takeId === takeId
  );
  if (records.length < 2) return [];

  // Role order, and the id as the tie-break so the answer never depends on what
  // the engine's sort happened to do: every part of a take shares one
  // `recordedAt`, so the timestamp cannot order them and `getAll` returns them
  // in uuid order.
  const ordered = [...records].sort(
    (a, b) => partRank(a.role) - partRank(b.role) || a.id.localeCompare(b.id)
  );

  const parts: UploadPart[] = [];
  for (const record of ordered) {
    // The primary is the take: its id *is* the takeId, which is also what makes
    // it the one record a caller can already be holding.
    const blob =
      (record.id === takeId ? inHand?.primaryBlob : undefined) ??
      (await getVideoBlob(record.id));
    // A part whose bytes are gone is left out rather than listed with nothing
    // in it: a host reading `parts` iterates blobs, and an entry it cannot read
    // is worse than an entry that is not there.
    if (!blob) continue;
    parts.push({
      id: record.id,
      // A record with no role is the take itself — the shape every recording
      // made before ESCSUITE-14 has.
      role: record.role ?? 'screen',
      name: record.name,
      blob,
      startOffset: record.startOffset ?? 0,
    });
  }
  return parts;
}
