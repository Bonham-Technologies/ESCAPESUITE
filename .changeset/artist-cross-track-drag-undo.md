---
'@escapesuite/artist': patch
---

Moving a clip to another track is one undo step

Dragging a clip onto a different track *and* to a different time recorded two
undo steps instead of one, so the first Ctrl+Z left the clip on its new row at
its old time — a position it had never been in — and a second was needed to get
back to where the drag started. One Ctrl+Z now undoes the whole drag, row and
time together.

The clip drag's commit still writes the track and the position separately; the
second write passes the store's trailing `skipHistory` flag, which
`setClipTimelinePosition` grew for it in the same shape `updateClip`,
`updateClipEffects` and `shiftClipsAfter` already carry. A drop that only moved
the clip in time, one that only changed its row, and a bulk move of a
multi-selection are each one undo step exactly as before.
