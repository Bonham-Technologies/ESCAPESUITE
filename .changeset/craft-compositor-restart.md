---
"@escapesuite/craft": patch
---

`Compositor.start()` on a running compositor now replaces its render loop instead of orphaning the first one, so a later `stop()` ends the loop rather than only the newest chain (ESCSUITE-58; defensive — nothing in the app starts a compositor twice). The previous `captureStream()` stays with whoever was handed it.
