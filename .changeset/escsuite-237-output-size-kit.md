---
'@escapesuite/headless-artist': patch
---

A render refused because its output size is too small for H.264 exits 2 (400 under serve) as a permanent input error instead of exit 1.

An MP4 job whose output size the H.264 encoder refuses — 64×8, say — will be refused every time it is run, but it used to exit 1, the code that tells a broker to retry. It now exits 2 from `render` and answers 400 from `serve`, the same as an invalid job spec, and the outcome carries `"code": "OUTPUT_SIZE_UNSUPPORTED"` beside the reason, so it can go straight to a dead-letter queue. Every other failed render is unchanged.
