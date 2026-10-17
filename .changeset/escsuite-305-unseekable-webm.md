---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

A recording Firefox cannot seek no longer exports as a black video, and no longer hangs its import

On Firefox, exporting an ESCAPECRAFT picture-in-picture recording to WebM or GIF used to run for minutes and then report "Export complete!" with a black picture, and importing such a recording could sit on "Processing…" for ever. Those recordings were saved with an empty seek index, and Firefox never finishes seeking into one. ESCAPEARTIST now repairs the file when it comes in — from the media library or from ESCAPECRAFT's Send to Editor, where it rewrites ESCAPECRAFT's own stored copy in place, with the same audio and video and a working seek index — so Firefox can seek it. If a recording still cannot be seeked, the export stops after three frames and says so by name ("This browser cannot read … frame by frame") instead of producing a black file — and does not suggest trying the other video format, which would fail the same way — and the thumbnail gives up after five seconds instead of holding the import. The headless kit treats that refusal (`SOURCE_NOT_SEEKABLE`) as a permanent failure of the job: exit 2, or 400 under `serve`.
