---
'@escapesuite/artist': patch
---

Opening a project from disk is one gesture, not four: loading its sources used to leave four separate undo entries, so a single Ctrl+Z right after an open landed on the freshly loaded project with part of its media library missing instead of restoring whatever was open before. Opening a file is a new document, not an edit, so it is no longer undoable at all. Dragging the timeline's in-point marker past the out point (or the out point past the in point) no longer collapses the selected range to a sliver that chases the pointer — crossing now hands the drag to the other handle and keeps the far point where it was.
