---
'@escapesuite/artist': patch
---

The headless render's reported duration is the encoded length — whole frames at the export's frame rate — for MP4 and WebM, as it already was for GIF.

A video export encodes whole frames at 30 fps, so a 0.75-second range becomes 23 frames and plays for 0.766667 seconds. The headless render used to report the 0.75 it was asked for, and anything that checked that figure against the file to within a millisecond turned down a perfectly good render. Every export now reports how many frames it encoded, and the headless render's duration is that count times one frame's length.
