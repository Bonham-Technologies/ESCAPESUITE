---
'@escapesuite/artist': patch
---

Dragging a clip or overlay in the preview is one undo step, with or without the keyframe panel open; with the panel open, a drag no longer fills the undo history. Undoing a drag now also puts the clip back where it started — it previously landed on the position the drag had just produced, because the entry was recorded on release rather than before the first move.
