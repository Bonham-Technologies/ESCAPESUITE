---
'@escapesuite/artist': patch
---

The in-page video decoder no longer repeats a frame on 60 fps sources

An export of a 60 fps source, or of a clip offset by less than one frame, no longer repeats a frame: the in-page decoder decides whether to seek from the source's own frame rate instead of assuming 30 fps.
