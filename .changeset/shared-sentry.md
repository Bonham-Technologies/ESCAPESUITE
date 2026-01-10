---
"@escapesuite/shared": minor
"@escapesuite/plan": patch
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract Sentry configuration to @escapesuite/shared package

- Add @escapesuite/shared/sentry module with shared initSentry function
- Support product tagging via options parameter
- All apps now import from shared package with app-specific product tags
