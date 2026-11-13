---
'@escapesuite/artist': patch
---

Exports no longer sometimes repeat a frame after a cut or trim. WebM and GIF exports, and MP4 exports in Safari, now wait for each frame of a video to be shown before they draw it, so the picture from just before a cut or a trim point no longer slips into the file.
