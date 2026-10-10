---
'@escapesuite/artist': patch
---

The paused preview no longer stays black after a clip is added or stepped

The paused preview no longer stays black after a clip is added or stepped: the canvas repaints once when the clip's first frame is decoded, and a frame step paints the frame it lands on.
