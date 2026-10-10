---
'@escapesuite/artist': patch
---

Dragging a track's volume, typing a caption or sweeping a colour picker is one undo step per gesture

Dragging a track's volume, typing a caption or sweeping a colour picker now costs one undo step per gesture instead of one per event, so a long drag no longer pushes earlier edits out of the undo history. Typing that stops for more than about half a second, or moves to another field, starts a new undo step, and Undo takes the text back to where that stretch of typing began.
