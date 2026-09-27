---
'@escapesuite/artist': patch
---

Undo/redo, Delete, Mute and Unmute no longer push undo entries for edits that never happened

Paste, then Ctrl+Z, then Delete used to leave the redo stack broken: undoing the paste removed the new clip from the timeline but left it "selected," so pressing Delete found nothing to remove, deleted nothing — and still recorded an undo step, which wiped out the redo you'd just earned and made the next Ctrl+Z look like it did nothing. Any action that could remove a clip from the timeline (a track or a source video being deleted, a split, an undo or a redo) now clears that clip out of the selection at the same time, so a later action can't be fooled into "editing" a clip that's already gone. Delete, keyframe removal, and Mute/Unmute on a selection that would change nothing now simply do nothing — no undo entry, no notification — instead of cluttering your undo history with edits that never actually happened.
