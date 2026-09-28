---
'@escapesuite/artist': patch
---

Saving and reopening a `.veditor` project no longer drops audio waveforms or a recorded take's identity, and no longer risks an infinitely long clip

A saved project used to carry only a video's bytes and its bare `id`/`name`/`mimeType` — everything else (`waveformData`, `hasAudio`, `takeId`, `role`, `startOffset`, `overlayPlacement`, `hasWebcam`, the real frame rate) was rebuilt from the blob on reopen, which cannot recover any of it: reopening a saved project always drew every audio clip as a bare rectangle, forever, because nothing recomputes a waveform, and always hard-coded `frameRate: 30`. Worse, that rebuild read a video or audio element's raw `duration` with no fallback, so a saved ESCAPECRAFT take whose WebM has no Duration element (the same headerless recording the earlier duration-probe work fixed for import and for the CRAFT-to-ARTIST handoff) came back `Infinity` seconds long after every save/reopen round trip. A saved project file now also writes each video's own metadata alongside its bytes, and reopening it trusts that metadata outright instead of re-deriving it from the blob; a project file saved before this change, or by an older build, still loads exactly as it always has, now routed through the same duration probe every other importer uses so it can no longer come back infinite either.
