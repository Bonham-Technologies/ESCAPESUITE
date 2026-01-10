---
"@escapesuite/shared": minor
"@escapesuite/plan": patch
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract theme system to @escapesuite/shared package

- Add @escapesuite/shared/theme module with storage-agnostic theme utilities
- Add ThemeToggle component to shared package
- All apps now use the shared theme module with app-specific storage adapters
- Reduces ~500 lines of duplicated theme code
