---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Add app bootstrap utility for consistent initialization

- Add `@escapesuite/shared/bootstrap` with `bootstrapApp()` function
- Handles SaaS vs Standalone mode detection and auth wrapping
- Dynamic loading of Clerk and Sentry (excludes from standalone bundle)
- Simplifies main.tsx in craft and artist from ~53 lines to ~14 lines
