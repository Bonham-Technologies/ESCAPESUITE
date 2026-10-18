---
'@escapesuite/artist': patch
---

A restored session keeps its in/out range and markers when an overlay was repaired on the way in

A saved session holding a text overlay with the old wrong trim numbers (the ones ESCSUITE-304 repairs when a project opens) restored the overlay at its dragged length, but the saved in/out points were still clamped against the shorter, unrepaired timeline, so a range near the end of the overlay was cut short or dropped. The range is now clamped against the timeline you actually see after the restore.
