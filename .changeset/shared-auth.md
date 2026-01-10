---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract auth utilities to @escapesuite/shared package

- Add @escapesuite/shared/auth module with:
  - Config utilities (BUILD_MODE, isSaaSMode, isStandaloneMode)
  - AuthContext and useAuth hook
  - License validation with product parameter
  - Subscription API client
- craft/artist now import from shared package
