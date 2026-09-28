---
'@escapesuite/artist': patch
'@escapesuite/headless-artist': patch
---

The export dialog's Resolution presets now show their actual output size, and the unreachable 'original' resolution is gone

Every option in the export dialog's Resolution dropdown — "Project", "1080p", "720p" and "480p" — now prints its real output dimensions right in the label, e.g. "1080p — 1920×1080". Since a preset's width already followed the project's own aspect ratio, a bare "1080p" on a portrait project was misleading: it actually exported 608×1080, narrower than a full 1080p frame, with nothing in the dropdown to say so. Separately, the 'original' resolution option — never offered anywhere in the app, reachable only by hand-writing a headless render job spec — has been removed. It was the one setting that ignored the project's shape entirely and sized the export to the bottom clip's own source dimensions instead, which is exactly the surprising, inconsistent behaviour the rest of this change is about avoiding. A headless job spec that asks for `resolution: "original"` now fails with a clear validation error instead of silently doing something different from every other resolution.
