---
'@escapesuite/headless-artist': patch
---

A render job's clips must carry their trim points.

Every clip in a job's project — overlay clips included — must now have a `startTime` that is a number of at least 0 and an `endTime` after it; a clip missing either, or with an inverted pair, fails the job before any frame is drawn with `Invalid project: Clip "<id>" has an invalid startTime` (or `endTime`), the same check the editor runs on a project file. Every clip ESCAPEARTIST writes already carries both; only a hand-built job spec that left them off an overlay clip is affected.
