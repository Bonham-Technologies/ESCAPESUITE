---
'@escapesuite/headless-artist': patch
---

A render refused because a clip's source has no stored bytes (`code: "SOURCE_MISSING"`) is now a permanent failure: exit 2, or 400 under `serve`, instead of a retryable one.
