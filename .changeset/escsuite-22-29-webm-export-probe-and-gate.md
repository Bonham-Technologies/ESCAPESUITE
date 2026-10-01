---
'@escapesuite/artist': patch
---

Exporting to WebM probes the codec first, fails with a message instead of
silently, and a browser without WebCodecs is told so up front. The WebM
exporter used to hard-code a VP9 configuration with no
`isConfigSupported()` check at all and never read its own encoder's `error:`
callback, so a browser that could not actually encode VP9 — or hit a
mid-export encoder failure — passed every up-front check and then failed
opaquely partway through, or produced nothing. It now probes VP9, falls back
to VP8 (every Matroska-capable browser still has it), probes Opus
independently (dropping audio rather than refusing the export when it is
missing), and surfaces any failure as the same kind of diagnosed error MP4
exports already show, with a one-click alternative when the other format is
available. The export dialog's own WebM support check is a real probe now
too, not a stand-in for "does this browser have WebCodecs at all" — so a
browser that cannot export anything is told so up front, in the dialog's main
body, instead of offering a "Download WebM" button that was never going to
work; a browser that can manage only one format keeps that one enabled and
says why the other is not offered.
