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
// Only an embedded CRAFT can do this — there is no one to post to otherwise —
// but the decision is the caller's: `RecordingsListPanel` asks `isEmbedded()`
// and only then offers the button. No analytics event: what a host does with
// its own recordings is the host's business.

import { parseHostOrigin } from '@escapesuite/shared/config';
import { getVideoBlob } from '../core/storage';
import type { RecordingRole } from '../store/types';

export const uploadToHost = async (
  id: string,
  name: string,
  /**
   * Which half of which take this row is, when it is one.
   *
   * Slice 1 keeps the message per row: each row posts its own bytes, and these
   * two optional fields say what the host is holding. A host that knows nothing
   * of takes receives exactly the payload it always did, because the fields are
   * only added when the row has them. `payload.parts` — one message listing
   * every part — is slice 4, with its own adoption note.
   */
  part?: { role?: RecordingRole; takeId?: string }
): Promise<'posted' | 'missing'> => {
  const blob = await getVideoBlob(id);
  // The row is drawn from store metadata, which can outlive the blob — a
  // failed save, or storage cleared under the tab. Nothing is posted then;
  // the caller says so through the app's one notice channel.
  if (!blob) return 'missing';

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
      },
    },
    targetOrigin
  );
  return 'posted';
};
