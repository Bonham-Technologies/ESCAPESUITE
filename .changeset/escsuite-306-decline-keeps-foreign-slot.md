---
'@escapesuite/artist': patch
---

Start Fresh no longer deletes another tab's saved session

When a new ESCAPEARTIST tab — one opened by ESCAPECRAFT's "Send to Editor", say — offered you a session another tab had saved and you chose Start Fresh, that session was deleted. But the other tab may not have been closed at all: Chrome's Memory Saver (on by default) unloads background tabs to save memory, and when you clicked back into that tab it came back to an empty editor. Start Fresh now leaves another tab's saved session where it is, so that tab finds its work when it reloads, and the tab you answered in does not ask you about it again. Start Fresh on your own tab's session after a reload still clears it, as before.
