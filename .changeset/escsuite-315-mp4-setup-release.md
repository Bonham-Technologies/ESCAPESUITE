---
'@escapesuite/artist': patch
---

An MP4 export that fails while it is setting up no longer leaves its decoder holding memory

If an MP4 export failed after your videos had loaded but before the first frame was encoded — the encoder refusing its settings, say — the background decoder it had started kept up to 512 MB of memory until you closed the tab; it is now released with the rest of the export, as WebM and GIF exports already were.
