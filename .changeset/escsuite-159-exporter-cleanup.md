---
'@escapesuite/artist': patch
---

A WebM export that fails mid-way now cancels its muxer; a failed completion callback no longer releases the export's media twice; the seek wait leaves no timer behind

An export that fell over after its muxer had started used to walk away from it, leaving the
half-written output file's writer and its target held until the tab was closed; the muxer is
now cancelled on the way out — after the export's own encoders are closed, so nothing they
had queued arrives at a muxer that has stopped accepting it — and left alone when the file
was already written. A callback that threw as the export reported itself complete used to free
every loaded video and image a second time on the error path. And each frame that seeked a
video left a half-second timer behind to resolve a wait that had already finished, or, when
a slow seek gave up, a listener on an element the export was about to discard.
