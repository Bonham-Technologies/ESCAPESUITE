---
'@escapesuite/artist': patch
---

Removing a file from the media library can no longer be undone into a file with no bytes

The media library's per-item Remove button deleted a file's bytes from storage and then made an undoable edit, so pressing undo afterwards could put a tile back in your library that had nothing behind it — it couldn't be played, placed on the timeline, or exported. Remove now deletes that way for good, the same as Clear Unused and Clear All already do, and undo no longer restores it. The confirm prompt also says how many clips go with it, instead of always warning about "any clips" whether or not there are any.
