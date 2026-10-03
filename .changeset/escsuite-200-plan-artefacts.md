---
'@escapesuite/plan': patch
---

Deleted two stray files from `apps/plan/public/` that `pnpm build:deploy` was copying straight onto the live `escapesuite.io` origin: `CNAME` (`escapesuite.io`), a leftover from a GitHub Pages era whose content contradicted the app's own canonical-host comment, and `og-image.png` (143 KB), an unreferenced social-share image that every page replaced with `og.png` some time ago. Neither file has any reference left anywhere in the app. Both paths now fall through to the same SPA page any unknown URL on this site does, instead of serving the stray file's own bytes.
