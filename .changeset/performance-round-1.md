---
"@escapesuite/artist": patch
"@escapesuite/craft": patch
---

Preview playback does far less work per frame: the preview canvas is rasterised at its displayed size (a 4K project now plays at full frame rate instead of ~12 fps), the timecode and timeline playhead no longer re-render the editor each tick, and scrubbing with several clips on one source no longer composites twice.

The picture-in-picture compositor no longer restores its canvas state twice per frame.
