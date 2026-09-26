---
'@escapesuite/artist': patch
---

Dragging several selected clips to another track moves all of them, or none

A multi-selection dragged onto a different track left most of itself behind.
Dropped on a new row at the same time, only the clip the pointer was holding
moved and the rest of the selection stayed where it was — the group silently
split. Dragged diagonally, to a new row *and* a new time, every clip moved in
time and none of them changed row at all. The whole selection now travels
together, in time, across rows, or both, and it is still a single undo step.

A drop the selection cannot take is now refused whole rather than half-made: if
any clip in the group would land past the top or the bottom of the track stack,
or on top of a clip that is not moving with it, nothing moves and the group
springs back to where it was picked up. That is the veto a single dragged clip
already had, and like that one it is silent. A selection sliding along ground
one of its own members is vacating is not a collision and is allowed, as before.
