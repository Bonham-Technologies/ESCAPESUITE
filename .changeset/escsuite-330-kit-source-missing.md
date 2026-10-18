---
'@escapesuite/headless-artist': patch
---

A render refused because a clip's source has no stored bytes now reports `code: "SOURCE_MISSING"` and is treated as a permanent failure: exit 2, or 400 under `serve`.
