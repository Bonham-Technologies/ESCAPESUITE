---
'@escapesuite/artist': patch
---

Dragging the playhead while the video plays now pauses it for the drag and resumes where you let go, instead of snapping back; a loop region shorter than one frame stops playback at its end instead of spinning in place.

Before this, grabbing the timeline's playhead during playback moved it only until the next frame of playback wrote the old position back, so the playhead jumped to where the video had got to the moment you let go. The drag now pauses playback when you grab the playhead and starts it again from the point you dropped it — and if the video was paused when you grabbed it, it stays paused. Separately, with loop playback on and the in and out points set to the same time, pressing play used to jump back to the in point every frame while appearing to play, keeping the editor busy for nothing; playback now stops at the out point, the same way it stops at the end of the timeline when looping is off.
