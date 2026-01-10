---
"@escapesuite/shared": minor
"@escapesuite/plan": patch
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract analytics trackEvent to @escapesuite/shared package

- Add @escapesuite/shared/analytics module with shared trackEvent function
- All apps now import trackEvent from shared package
- App-specific analytics events remain in each app
