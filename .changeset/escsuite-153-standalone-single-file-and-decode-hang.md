---
'@escapesuite/artist': patch
---

The offline (standalone) ESCAPEARTIST is one file again and an MP4 export whose
decoder cannot start fails with a message instead of hanging. The standalone
build used to ship an `index.html` plus a second worker file that the GitHub
Release never attached, so a downloaded build had no decode worker at all and
its MP4 exports parked at "Loading media files…" forever with no error and no
way to cancel. The standalone build now inlines its worker the same way the
headless render bundle already did, and the exporter now notices a decode
worker that fails to start — for any reason, not just a missing file — and
falls back to decoding with a plain `<video>` element instead of hanging or
failing the export.
