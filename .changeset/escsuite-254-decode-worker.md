---
'@escapesuite/artist': patch
---

MP4 exports decode in the Web Worker, and say so when a source cannot.

MP4 exports now actually decode in the Web Worker: the worker armed mp4box's sample extraction after the file had already been parsed, so every source fell back to in-page decoding and background-tab encoding never held. A source the worker cannot handle now says so in the export progress.
