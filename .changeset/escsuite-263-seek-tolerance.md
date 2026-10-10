---
'@escapesuite/artist': patch
---

An MP4 export decoded in the page no longer repeats every other frame

When an MP4 export decoded a source in the page (a recording from ESCAPECRAFT, any source in Safari, or one the background decoder could not take), it skipped the seek for a frame that came one frame after the last one and drew the previous frame again, so about every other frame of the video was a repeat, at 30 fps as well as 60. It now seeks unless the request is within half a frame of the frame already showing, so each frame is its own; a 60 fps source or a clip offset by less than one frame is covered by the same rule.
