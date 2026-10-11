---
'@escapesuite/artist': patch
---

An output size too small for H.264 is reported as such — "MP4 needs at least 16×16; WebM and GIF are unaffected" — instead of claiming the browser cannot encode H.264.

A project can be any size from 2 to 7680 pixels a side, and the browser's H.264 encoder refuses some of those — 64×8, 2×2, 3840×2 — while encoding H.264 perfectly well at every normal size. The export dialog and the MP4 export used to blame the browser for that ("This browser cannot encode H.264"). When MP4 is refused, the editor now checks whether H.264 works at an ordinary 1280×720; if it does, it says the output size is the problem and that WebM and GIF still work. Nothing extra is checked for an export that succeeds.
