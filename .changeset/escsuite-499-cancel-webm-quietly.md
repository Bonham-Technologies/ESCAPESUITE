---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

Cancelling a WebM export that is saving to a slow file no longer leaves a "Cannot write to a closing writable stream" error behind in the browser console. And if an MP4 or WebM export ever produces a frame or a stretch of sound that the video file refuses to take, the export now stops and shows the reason, instead of finishing as if all was well with that part missing from the file. The same goes for the headless render kit.
