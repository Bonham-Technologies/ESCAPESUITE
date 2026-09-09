// Sends a finished recording to ESCAPEARTIST for editing.
// When CRAFT is embedded in a host page, the host owns navigation to its own
// editor URL — CRAFT just announces the recording via postMessage. Otherwise
// CRAFT opens ESCAPEARTIST directly in a new tab/window.

import { isEmbedded, editorUrl, parseHostOrigin } from '@escapesuite/shared/config';
import { analytics } from './analytics';

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
