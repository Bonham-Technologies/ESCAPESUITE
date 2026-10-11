---
'@escapesuite/artist': patch
---

Each editor tab keeps its own recovery session, so a tab that crashes can be resumed later even after another tab has kept editing.

Every ESCAPEARTIST tab now autosaves to a session of its own instead of one shared by every tab, so when a tab closes or crashes, the next tab you work in no longer saves over what it left behind. A reload, or a tab your browser brings back after a crash, is offered its own session back first; a new tab is offered the most recent session whose tab is gone — never one that is still open in another tab — and restoring it makes it that tab's own. Start Fresh discards only the session it was offered, New Project clears only its own tab's session, and a session nobody comes back to is cleared after 30 days. The "Another ESCAPEARTIST tab is open" notice is gone, because a second tab can now save its own work.
