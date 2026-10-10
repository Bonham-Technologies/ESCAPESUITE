---
'@escapesuite/shared': patch
---

The shared recordings database reopens itself after the browser closes it instead of failing every save until the page is reloaded.

The shared recordings database reopens itself after the browser closes it (clearing site data, a storage eviction) instead of failing every save until the page is reloaded, opens one connection instead of two on startup, and steps aside for a database upgrade or deletion from another tab.
