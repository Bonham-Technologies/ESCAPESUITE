---
'@escapesuite/artist': patch
---

Dragging a slider in the clip inspector is now one undo step.

Position, scale, opacity, blur, corner radius and stroke width each wrote to the undo stack on
every step of the drag — a blur drag alone was around a hundred entries, which is twice the
whole history stack — so one drag threw away everything you had done before it and Ctrl+Z
stepped back half a pixel at a time. A drag now records a single entry, taken before the drag
starts, so one undo puts the slider back where it was.
