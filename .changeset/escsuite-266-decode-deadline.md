---
'@escapesuite/artist': patch
---

An MP4 export no longer hangs when the browser kills its decode worker

An MP4 export no longer waits forever on a decode worker the browser killed: a frame the worker has not answered in 15 s falls that source back to the in-page decoder and the export continues.
