---
'@escapesuite/artist': patch
---

An MP4 export no longer hangs when the browser kills its decode worker mid-load

An MP4 export no longer waits forever on a decode worker the browser killed while a source was still loading: a load that has not finished within a budget scaled to the file's size falls every source back to the in-page decoder and the export continues.
