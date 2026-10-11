---
'@escapesuite/shared': patch
---

The shared storage can list every setting under a key prefix

`listSettings(prefix)` returns every row of the `settings` store whose key starts with the prefix, with its key — what ESCAPEARTIST uses to find each tab's saved session.
