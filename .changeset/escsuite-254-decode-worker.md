---
'@escapesuite/artist': patch
---

MP4 exports decode in the Web Worker, and say so when a source cannot.

MP4 exports now actually decode in the Web Worker: the worker armed mp4box's sample extraction after the file had already been parsed, so every source fell back to in-page decoding and background-tab encoding never held. A source the worker cannot handle now says so in the export progress. The worker is used in Chromium and Firefox, for H.264 MP4 sources up to 512 MB per export; anything else keeps decoding in the page, and the export progress says so.
