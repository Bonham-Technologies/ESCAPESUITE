---
'@escapesuite/artist': patch
---

A diagonal keyframe drag is one undo step, and a diamond drop never deletes the keyframe it lands on

A diagonal drag in the keyframe graph (changing a keyframe's time and value together) is one undo step again, instead of two with a setTimeout race between them — one Ctrl+Z now restores both halves. Dragging a diamond on a property's row onto another keyframe, or onto the playhead where one sits, no longer silently deletes it: the drag refuses the drop and says why, the same way the keyboard nudge already did. A double-click on a property's row now adds the keyframe at the value the curve already holds there, instead of jumping to the clip's static default.
