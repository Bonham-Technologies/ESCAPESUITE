---
'@escapesuite/artist': patch
---

Undo now steps back a whole gesture everywhere it should. Trimming a clip's edge on
the timeline is one undo step instead of one per frame of the drag, so a single
Ctrl+Z puts the clip's in and out points back where they were before you grabbed
the handle. The Animation and Transition Out duration sliders coalesce the same
way, joining the position, scale, opacity, blur, mask and stroke sliders. And
resetting an overlay's transform from the Transform section header is one step
rather than two, so one Ctrl+Z restores both the transform and the overlay's own
position instead of leaving it half-reset.

Undo history is 50 entries deep, and a drag that filled it with intermediate
values used to evict everything you had done before it — that no longer happens
from any slider or from a trim.
