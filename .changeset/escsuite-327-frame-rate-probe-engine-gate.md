---
'@escapesuite/artist': patch
---

Importing a video in Firefox stores 30 fps as an assumption instead of a wrong "measured" rate

The import-time frame-rate probe now measures only in Chromium, the one engine its frame-callback readings were characterised on, and answers nothing elsewhere so the source is stored at 30 fps labelled assumed. Run against nine test videos in Firefox 157, it had stored two wrong measured rates: a 120 fps MP4 as 124.62 and a 30 fps WebM as 34.33. The picture was never affected, since an over-read only narrows the export's seek window, but the stored rate and its "measured" label were wrong. Measuring Firefox properly, rate by rate and container by container, is the follow-up before it is admitted; the decode worker's own Firefox allow-list is unchanged, because its parity with Firefox's video element was measured.
