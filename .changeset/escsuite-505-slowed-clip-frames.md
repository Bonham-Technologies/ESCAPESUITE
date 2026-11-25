---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

Exports of slowed-down clips no longer repeat the previous frame in place of some frames. A clip slowed to 0.25× or about 0.4×, especially one from a 50, 60 or 120 fps video, could show a frame of the video twice and skip the next one. Every frame of the video now appears in its turn. This applies to WebM and GIF exports, to in-page MP4 exports of videos imported in Chrome or Edge, and to the headless render kit.
