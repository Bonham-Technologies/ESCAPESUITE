---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

A damaged project file, host message or render job is now refused with a reason instead of failing with an error

Opening a `.veditor` file, or a host sending `LOAD_PROJECT`, with a broken track list or broken legacy text and shape overlays used to fail with a bare TypeError, and a host got no reply at all; the editor now refuses it and names the field (`timeline.tracks[0] must be an object`, `timeline.textOverlays[0].text must be a string`), and the host gets its `INVALID_PROJECT` error. In the headless kit, a project with a null clip is refused naming the clip's index instead of crashing, a manifest source's `name` and `mimeType` must be non-empty strings when given, and a webhook sink's `headers` values must be strings, all refused before a render starts.
