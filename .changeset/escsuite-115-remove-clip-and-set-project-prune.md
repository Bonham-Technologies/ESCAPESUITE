---
"@escapesuite/artist": patch
---

Deleting a clip that is already gone no longer records a phantom undo step, and loading a project no longer leaves a ghost clip "selected".

`removeClipFromTimeline` used to filter the clip list, bump the project's modified time and push an undo entry even for a clip id that named nothing — a stray Delete keypress after the clip was already gone some other way could quietly pile up undo entries that did nothing, and one more Ctrl+Z was needed to undo the edit that actually happened. It now recognises "nothing to remove" the same way ripple-delete already did and does nothing at all in that case; the Delete key stays silent rather than toasting "Clip deleted" for an edit that never happened. Separately, loading a project, receiving one from a host, or restoring an autosaved session could leave the previous project's selection pointing at a clip id the new project doesn't have — the selection is now reconciled against the incoming project the same way every other way a clip can disappear already is.
