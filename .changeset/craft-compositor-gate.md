---
'@escapesuite/craft': patch
---

Composite picture-in-picture frames at the target rate, and never store a non-finite duration.

The PiP compositor's render loop gated on `now - lastFrameTime < 1000 / targetFrameRate`
and snapped `lastFrameTime` to the drawing frame's own clock. `1000 / 30` is bit-for-bit
`2 * (1000 / 60)`, so two 60 Hz animation frames cleared a 30 fps gate with **zero** margin:
any dispatch jitter below the ideal refused the second frame and the draw waited for a
third, 50 ms after the last one instead of 33 ms. Real takes composited 22.4–22.8 fps
against a 30 fps target. The gate is now a deadline with a 4 ms tolerance, advanced on the
schedule rather than from the drawing frame's clock, with a resync so a stalled tab catches
up instead of bursting. A PiP recording gets the frames it was always supposed to.

`useRecordingSave` also hardens its duration guard. `metadata.duration > 0` on its own would
accept the `Infinity` an unrepaired MediaRecorder WebM reports for its duration; nothing
delivers that today — the metadata helper already maps a non-finite duration to the timed
one — but the hook should not depend on it, so the guard is now
`Number.isFinite(metadata.duration) && metadata.duration > 0`, falling back to the recorded
duration as before. No behaviour change on any recording you can currently make.
