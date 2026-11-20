---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

Exports of 30 fps WebM videos, such as ESCAPECRAFT recordings, no longer repeat the previous frame in place of some frames (every third one, in a video recorded at a steady 30 fps). WebM stores frame times rounded to the millisecond, and the export now looks far enough past each frame's start to find it. This applies to WebM, GIF and in-page MP4 exports, and to the headless render kit.
