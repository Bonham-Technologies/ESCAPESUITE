---
'@escapesuite/artist': patch
---

Recover the duration of a headerless audio file on import. An ESCAPECRAFT take
recorded with no camera is raw MediaRecorder Opus in a WebM with no Duration
element, and the audio importer trusted the `Infinity` (or `0`) the browser
reported, building an infinitely long audio clip. It now runs the same
seek-to-end probe the video importer has used since the last release — one
shared implementation, so the two cannot drift apart.
