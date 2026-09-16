---
'@escapesuite/shared': patch
---

The offline single-file builds no longer include the analytics runtime at all, so no analytics call can leave an offline build. `trackEvent()` returns before it reaches Vercel Analytics in a standalone build, and the gate is written so the bundler drops the library from the bundle rather than shipping it inert.
