// Hands a finished recording's bytes to the page embedding ESCAPECRAFT.
//
// The shared IndexedDB is enough when the host's editor is same-origin — that
// is what `sendToEditor` relies on — but a host that wants the file itself
// (to upload it, to attach it, to keep it) cannot reach into another origin's
// database. So this posts the blob out: `UPLOAD_RECORDING` carries the stored
// `Blob` by structured clone, which is how a `Blob` crosses a postMessage
// boundary without `arrayBuffer()` copying a gigabyte take into the heap
// twice.
//
// Since ESCSUITE-14 a take can be several files, and the primary row's message
// carries all of them at once as `payload.parts` — see the adoption note in the
// root `CLAUDE.md`. `payload.blob`, `payload.id` and `payload.name` are the
// primary's, unchanged, so a host that knows nothing of takes receives exactly
// what it always received.
//
// Only an embedded CRAFT can do this — there is no one to post to otherwise —
// but the decision is the caller's: `RecordingsListPanel` asks `isEmbedded()`
// and only then offers the button. No analytics event: what a host does with
// its own recordings is the host's business.

import { parseHostOrigin } from '@escapesuite/shared/config';
import { getVideoBlob } from '../core/storage';
import { loadTakeParts } from './takeParts';
import type { UploadPart } from './takeParts';
import type { RecordingRole } from '../store/types';

export const uploadToHost = async (
  id: string,
  name: string,
  /**
   * Which half of which take this row is, when it is one.
   *
   * Two things follow from it. `role` and `takeId` are added to the payload,
   * so a host can say what it is holding — added only when the row has them, so
   * a plain take's payload is byte-for-byte what it was before this feature
   * existed. And when `takeId` is the row's **own** id the row *is* the take
   * (a primary carries its own id as its `takeId`, see
   * `utils/recordingMetadata.ts`), which is what makes this message the one
   * that carries every part.
   */
  part?: { role?: RecordingRole; takeId?: string }
): Promise<'posted' | 'missing'> => {
  const blob = await getVideoBlob(id);
  // The row is drawn from store metadata, which can outlive the blob — a
  // failed save, or storage cleared under the tab. Nothing is posted then;
  // the caller says so through the app's one notice channel.
  if (!blob) return 'missing';

  // Every part of the take, in one message, when this row names the take.
  // A companion row's `takeId` names a different record, so it posts itself
  // alone exactly as it has since slice 1 — which is still the only way a host
  // that has not adopted `parts` can be handed one specific part.
  let parts: UploadPart[] = [];
  if (part?.takeId === id) {
    try {
      parts = await loadTakeParts(id);
    } catch (error) {
      // A companion never costs the primary. The row's own bytes are already in
      // hand, so a second read that fails downgrades this message to the one
      // slice 1 sent rather than losing the upload the user asked for.
      console.warn('Could not read the take’s other parts; posting the primary alone', error);
    }
  }

  // A host that named itself with `?hostOrigin=` gets the post addressed to
  // that origin; otherwise it goes to whoever is framing us.
  const targetOrigin = parseHostOrigin() ?? '*';
  window.parent.postMessage(
    {
      type: 'UPLOAD_RECORDING',
      payload: {
        id,
        name,
        blob,
        ...(part?.role !== undefined ? { role: part.role } : {}),
        ...(part?.takeId !== undefined ? { takeId: part.takeId } : {}),
        // Absent for a take that is one file: a list holding only the blob
        // already above it names nothing the host does not have.
        ...(parts.length > 0 ? { parts } : {}),
      },
    },
    targetOrigin
  );
  return 'posted';
};
