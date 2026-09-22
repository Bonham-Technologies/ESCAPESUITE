---
"@escapesuite/craft": patch
---

`Compositor.start()` on a running compositor now replaces its render loop instead of orphaning the first one, so a later `stop()` stops everything (ESCSUITE-58; defensive — nothing in the app starts a compositor twice).
