---
'@escapesuite/artist': patch
---

Paste now lands where the playhead actually is, even at 0 — and it can no longer put a clip on a track that isn't there anymore

Pasting used to skip the playhead whenever it sat at exactly 0 s, so pressing Home and then Ctrl+V pasted a clip copied from 3 s back at 3.5 s instead of 0 s. Paste now always lands at the playhead. Separately, if the track a copied clip came from had since been deleted, paste could add a clip that belonged to no row on the timeline — invisible, unselectable, but still counted in the project's length and its export. Deleting a track or removing a source video now clears any copied clips that pointed at it, and as a last resort paste itself refuses the whole operation (with a "Nothing to paste here" notice) rather than create an orphaned clip.
