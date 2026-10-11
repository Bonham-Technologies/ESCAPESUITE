---
'@escapesuite/artist': patch
---

Starting playback with the playhead in a gap between clips plays on from the next clip instead of freezing in a playing state.

Pressing Space or Play with the playhead between clips, or letting go of a dragged playhead in a gap while the timeline was playing, used to move the playhead to the start of the next clip and leave it there: the button showed Pause but nothing moved. Playback now carries on from that clip. With no clip after the gap, playback still stops at the end of the timeline.
