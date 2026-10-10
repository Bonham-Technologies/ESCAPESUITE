---
'@escapesuite/headless-artist': patch
---

Reference container: Chromium helper cleanup, correct uid, and an up-front output check

The reference container reaps Chromium's helper processes under `serve` (tini is PID 1), every document says the image runs as uid 1001 rather than 1000, and a job whose output directory the container cannot write to is refused before the browser starts (exit 2 / 400) instead of after a full render.
