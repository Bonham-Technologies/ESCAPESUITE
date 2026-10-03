---
'@escapesuite/artist': patch
---

Editing a clip that has already left the timeline no longer spends an undo entry on nothing

`updateClip` and eleven of its siblings — the move, transform, effects, transition, animation and keyframe writes, and the two overlay-data writes — used to run anyway when handed an id no clip on the timeline holds any more, stamping the project as modified and pushing an undo entry that undid nothing. The clearest way to hit it: drag a crop handle, delete the clip mid-drag, and the gesture's own cleanup would still "write" against the gone clip. Each of these now refuses the write and reports it, the same way deleting a clip with an unknown id has refused since ESCSUITE-115.
