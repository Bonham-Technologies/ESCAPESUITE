---
"@escapesuite/artist": patch
---

A source video's thumbnail no longer leaks its object URL when it leaves the media library.

Removing a source, starting a new project, loading a `.veditor`, restoring an autosaved session, and the media library's Clear All / Clear Unused all used to drop a `SourceVideo`'s `thumbnailUrl` on the floor without ever calling `URL.revokeObjectURL` on it — every import, project load and restore minted one more handle that lived for the rest of the tab's life. Each of those paths now frees the handle the moment the source it belongs to leaves the library (loading a project or restoring a session frees the outgoing library's handles before minting the incoming ones), through one function, `revokeSourceThumbnails`, that lives beside the mint side (`resolveThumbnailUrl`) in storage. Undo and redo still never revoke on their own — a source coming back via redo still needs a working URL — but undoing back past a removal or a reset no longer hands a source a thumbnail URL that was already revoked out from under it: it comes back with no thumbnail instead, the same as a source that never had one, and picks up a live thumbnail again the next time it is genuinely reloaded.
