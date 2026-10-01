---
'@escapesuite/artist': patch
---

Clicking an animated clip in the preview selects it instead of the clip beneath it.
A clip carrying custom keyframes used to be invisible to the pointer while the
keyframe panel was closed: a click on it fell through to whatever clip was on the
track below, or, with nothing behind it, started a marquee whose release cleared
the selection. It is now picked the same way a clip on a locked track is — selected
and inspectable, with the cursor reading "not-allowed" — so it can no longer be
dragged, resized or rotated from the canvas outside the keyframe panel, but it is
never skipped over either.
