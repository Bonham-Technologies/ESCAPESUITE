---
'@escapesuite/artist': patch
---

Pressing Home or clicking a marker in the first fraction of a second of playback now lands exactly there.

Pausing playback lands on the frame the preview was showing, unless the pause came with a jump — a ruler click, Home or End, a step, a marker. A jump to the time the editor was already holding used to be mistaken for a plain pause: pressing Home within the first fifth of a second of playing from the start, or clicking a marker on the in point just after a loop came round, left the playhead a few frames past where you sent it. Every jump of the playhead is now recognised as one, whatever time it lands on.
