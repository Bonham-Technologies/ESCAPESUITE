---
'@escapesuite/shared': patch
---

The shared recordings database reopens itself after the browser closes it (clearing site data, a storage eviction) instead of failing every save until the page is reloaded, opens one connection instead of two on startup, and steps aside for a database upgrade or deletion from another tab.

Two parts of the app asking for the database at the same moment now share one connection; the first save after the browser clears site data reopens the database and recreates its stores; and a tab that has it open closes its connection when another tab deletes or upgrades it, where it used to hold that up for as long as the tab stayed open.
