---
'@escapesuite/artist': patch
---

Delete track, Delete clip, New Project and the media library's Remove, Clear Unused and Clear All now ask in the editor's own dialog instead of the browser's pop-up, with the same question as before. Cancel or Escape keeps everything. In a page that embeds the editor in a sandboxed frame without pop-ups allowed, those buttons used to do nothing at all; they now work there too.
