---
'@escapesuite/artist': patch
---

Adding a keyframe at the time of an Animate In/Out handle is refused with a notice instead of silently replacing the preset's handle with a custom keyframe.

The keyframe panel's "Add Keyframe at Playhead", the graph's Enter and a row's or the graph's double-click all check the playhead against the clip's Animate In/Out handle times first. Landing on one — within the same tolerance that already selects an existing keyframe — writes nothing, spends no undo step, and the panel's live region says "That time belongs to the Animate In/Out preset". Before this a custom ease-in-out keyframe replaced the handle, changing the preset's easing, and because it was no longer a generated keyframe it survived the transition suppression ESCSUITE-139 added, so an incoming clip under a transition could hold at opacity 0 again. To key a value at a handle's time, change the preset or set it to None.
