---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract IndexedDB storage operations to @escapesuite/shared package

- Add @escapesuite/shared/storage module with:
  - Shared database configuration (DB_NAME, DB_VERSION)
  - Common video/thumbnail operations
  - Settings operations
  - Storage utilities
- craft/artist now import from shared package
- App-specific operations remain in each app
