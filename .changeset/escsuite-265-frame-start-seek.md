---
'@escapesuite/artist': patch
---

Some exports no longer repeat one frame in three in place of the frame that should be there

When an export drew a source through the page's own video element — every WebM and GIF export, and an MP4 export of an ESCAPECRAFT recording, of any source in Safari, or of one the background decoder could not take — it asked for each frame at the exact moment that frame starts. Chrome and Firefox both round that moment to the microsecond, and on one frame start in three the rounding fell just before the frame, so the previous frame was drawn again in its place: at 30 fps a third of the exported frames were a repeat and the frame that should have been there was missing. Each frame is now asked for a tenth of a millisecond after its start, inside the frame in both browsers, so every exported frame is its own.
