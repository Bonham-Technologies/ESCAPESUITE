---
'@escapesuite/artist': patch
---

Restoring a saved session no longer leaves every media thumbnail broken

`buildSessionSnapshot` used to write each source video's `thumbnailUrl` verbatim into the autosaved session — but that field is only ever an `URL.createObjectURL` handle, and those handles die the moment the page unloads. Reload the editor and pick "Restore", and every media-library card and every timeline clip thumbnail showed a broken image, permanently, because the very next autosave wrote the same dead handle straight back. The autosave no longer persists `thumbnailUrl` at all, and restoring now rebuilds each source's thumbnail from its actual stored picture — the same picture a freshly opened `.veditor` project file gets its thumbnails from — with a source that has no stored thumbnail simply restoring with none, instead of a broken one. An older saved session that still has the stale `blob:` string in it restores fine; the field is just ignored.
