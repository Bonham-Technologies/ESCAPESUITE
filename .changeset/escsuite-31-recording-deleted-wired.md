---
'@escapesuite/craft': patch
---

Deleting a recording from the library now reports a "Recording Deleted"
analytics event (hosted build only) — the event was already declared and unit
tested, but nothing in the app ever called it, so every delete was invisible
in the dashboard. It fires once per row the user deleted, not per companion
file the cascade removed with it, and not at all when the delete fails.
