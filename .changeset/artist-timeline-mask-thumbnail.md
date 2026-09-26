---
'@escapesuite/artist': patch
---

**A masked clip now looks masked on the timeline.** A video or image clip shows a small picture
of itself at its left edge, clipped to whatever shape you gave the clip — so a clip you made
circular is a circle on the timeline, not a rectangle you have to remember is a circle. It
follows the mask: change the shape or take it off and the clip on the timeline changes with it.
A webcam clip handed over from ESCAPECRAFT arrives showing the circle it was recorded in.

Two things it deliberately does not do. The clip's **border** is not drawn on the timeline
picture — the picture is there to show the shape, and the border is in the frame. And the
**selection box in the preview stays a rectangle**: a circular clip is still selected, moved and
resized by the box around it, which is the handle you already know. The thumbnail in your media
library is unchanged too, because that one belongs to the file rather than to one clip of it, and
two clips of the same file can have different shapes.

One other visible change came with it, on audio clips. Making room for the picture meant giving
the clip's content box a position of its own, and that reversed a paint order that had been the
wrong way round: a clip's name and duration now draw **over** its waveform instead of under it.
Small, and arguably how it should always have looked, but it is a difference you can see.
