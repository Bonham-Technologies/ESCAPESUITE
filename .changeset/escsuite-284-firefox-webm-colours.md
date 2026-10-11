---
'@escapesuite/artist': patch
---

A WebM exported from Firefox now plays back in the colours you exported, in every player.

Firefox's VP9 and VP8 encoders convert each frame with one colour formula (BT.601) but label the video as using another (BT.709). Players believe the label, so a WebM exported from Firefox came back with its colours off by up to about a tenth of a channel's range, enough that some frames no longer matched what was on the timeline. The editor now corrects the label on Firefox before writing the file, so Chrome, Firefox and tools such as ffmpeg all show the colours that were drawn. Exports made in Chrome, MP4 exports and GIFs were already right and are unchanged.
