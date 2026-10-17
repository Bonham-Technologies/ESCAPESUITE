---
'@escapesuite/artist': patch
---

A long caption with a shorter one inside it can be trimmed and dragged again

A caption file can hold two cues whose times overlap, and the importer keeps them where the file put them on the Captions track. The timeline used to treat the shorter cue as a wall: grabbing the long cue's end handle cut it short to where the inner cue began, its start handle stopped where the inner one ended, and neither cue could be dragged at all. Now an overlap a cue already had is left alone — the long cue trims out past the one inside it, either cue can be dragged, and the two move together as a selection — while a clip a cue did not already overlap still stops a trim and refuses a drop, as before.
