---
'@escapesuite/artist': patch
---

Undo can no longer bring back a source after Clear Unused or Clear All removes it from the
media library. Both buttons delete the file's bytes from storage, and until now an undo
right afterwards would still hand the tile back — it showed up again in the library, but
its video was gone, so it could not be played, placed on the timeline or exported. Clearing
storage is now treated as permanent rather than as an editable step: it records no undo
entry, and any undo/redo step already on the stack that would have restored one of those
sources (or a clip built from it) is cleaned up too, so there is no way to wind back into a
broken tile. Removing a single file from the media library's own "Remove" button is
unaffected and stays undoable, as before. Clear All's confirmation now also mentions that it
can remove a clip still using the file, since clearing storage can take more than the file
itself with it.
