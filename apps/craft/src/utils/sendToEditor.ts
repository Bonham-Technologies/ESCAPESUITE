// Sends a finished recording to ESCAPEARTIST for editing.
// When CRAFT is embedded in a host page, the host owns navigation to its own
// editor URL — CRAFT just announces the recording via postMessage. Otherwise
// CRAFT opens ESCAPEARTIST directly in a new tab/window.

import { isEmbedded, editorUrl, parseHostOrigin } from '@escapesuite/shared/config';
import { analytics } from './analytics';

/**
 * Said, as a disabled editor button's title and visible description, when the
 * app was opened from disk (`file:`). The released single-file CRAFT has no
 * editor at a URL it can reach — `/artist/` resolves to `file:///artist/` — and
 * the downloaded ESCAPEARTIST file's name is the user's, so there is nothing
 * to navigate to (ESCSUITE-221). The recording is in the shared IndexedDB
 * either way; the sentence names the way across.
 */
export const EDITOR_FILE_ORIGIN_REASON =
  "Download this recording's WebM and import it into the offline ESCAPEARTIST file.";

export const sendToEditor = (id: string): 'posted' | 'opened' => {
  analytics.recordingSentToEditor();

  if (isEmbedded()) {
    // A host that named itself with `?hostOrigin=` gets the post addressed to
    // that origin; otherwise it goes to whoever is framing us.
    const targetOrigin = parseHostOrigin() ?? '*';
    window.parent.postMessage({ type: 'SEND_TO_EDITOR', payload: { id } }, targetOrigin);
    return 'posted';
  }

  window.open(editorUrl({ loadVideo: id }), 'escapeartist');
  return 'opened';
};
