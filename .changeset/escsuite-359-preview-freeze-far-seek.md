---
'@escapesuite/artist': patch
---

The preview no longer freezes after you jump far into a long WebM. Seeking a re-indexed recording could leave the picture stuck while the playhead moved; the seek index ESCAPEARTIST writes on import now points only at frames the browser can start from.
