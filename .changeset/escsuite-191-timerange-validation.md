---
'@escapesuite/headless-artist': patch
---

`options.timeRange` now rejects a non-finite bound (`NaN`, `Infinity`) and a negative `start` while the job spec is parsed, instead of letting either through as a plain "number" and only surfacing downstream as an inflated or nonsensical render. Each fails with a message naming the field — `POST /render` answers 400, `render` exits 2 — before Chromium ever launches, the same as every other spec error. This is the validation half of ESCSUITE-191; the render engine's own clamp (ARTIST, released alongside this) handles the other half, a range that is well-formed but falls outside the project's timeline.
