---
'@escapesuite/artist': patch
---

Play on a pause in Remove silences now always plays that pause with a second either side, even with loop playback on: a pause near the end of the timeline no longer wraps round to the start, a pause past the out point no longer jumps back to the in point, and playback stops at the end of the timeline instead of past it. Your loop setting and in/out points are left as they were.
