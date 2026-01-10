---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract shared types to @escapesuite/shared package

- Add @escapesuite/shared/types module with:
  - MediaType, MediaSource types
  - WaveformPeak interface
  - SourceVideo interface
- craft/artist now import shared types from shared package
