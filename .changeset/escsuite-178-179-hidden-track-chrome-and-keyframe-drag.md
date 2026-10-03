---
'@escapesuite/artist': patch
---

The preview's selection box and handles now follow a hidden track, and dragging a keyframe onto a neighbour in the graph no longer destroys it

Selecting a clip and then hiding its track used to leave the selection box, the resize handles and a marquee's reach over it exactly as if the clip were still showing — a picture that was no longer drawn stayed draggable and selectable all the same. Hiding the track now takes the chrome, the live handles and the marquee with it, the same way the clip's own picture already disappeared, and showing the track again brings all of it straight back; the selection itself never changes, so a clip picked before its track is hidden is still the one picked after it is shown again. Separately, dragging a point on the keyframe graph onto a time within a hair's breadth of another keyframe used to silently delete that other keyframe — now the drop is refused outright, the dragged keyframe stays put, and the graph says why, the same refusal the keyboard's arrow-key nudge already makes.
