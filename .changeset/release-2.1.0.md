---
"@escapesuite/plan": minor
"@escapesuite/craft": minor
"@escapesuite/artist": minor
---

- Moved CI to a Node 24 baseline and cleared the outstanding `fast-uri` security advisories via a pnpm override.
- MP4 export now works correctly above 1080p, falling back to H.264 Level 5.1 for 4K/1440p sources; headless render metadata is now accurate, and missing source files fail loudly instead of silently producing a broken export.
- Shipped headless render bundle v2: sources stream in via file input and results stream out via download, with metadata probing for accurate render info.
- Accessibility fixes across ESCAPECRAFT and ESCAPEARTIST, plus new demo media in the README.
