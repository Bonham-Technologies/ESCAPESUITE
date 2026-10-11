---
'@escapesuite/headless-artist': patch
---

The verification manifest's durationSec matches the delivered file to the frame for every format.

For MP4 and WebM the manifest used to report the requested time range — 0.75 s, say — while the file held 23 whole frames at 30 fps, 0.766667 s, so a consumer comparing `durationSec` to the file within a millisecond rejected a valid render. It now reports the frames encoded times the frame period, as it already did for GIF, and the README says a consumer may compare it to the file within one millisecond.
