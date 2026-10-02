---
'@escapesuite/artist': patch
---

Added the `gifenc` dependency (pinned exactly at 1.0.3) and a `core/gifEncoder.ts` wrapper
around it, as the first step of GIF export (ESCSUITE-34). `gifenc` ships no type declarations,
so `src/types/gifenc.d.ts` declares just the surface the wrapper uses. Nothing in the product is
user-visible yet — the wrapper is the one module allowed to import `gifenc`, giving the upcoming
export pipeline a single module boundary to build against (and later, to mock in its own tests)
instead of a third-party package.
