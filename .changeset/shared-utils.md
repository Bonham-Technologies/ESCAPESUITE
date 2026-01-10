---
"@escapesuite/shared": minor
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Extract time utilities and watermark module to shared package

- Add @escapesuite/shared/utils with time formatting functions (formatTimecode, formatTime, formatDuration, parseTimecode, etc.)
- Add @escapesuite/shared/watermark with drawWatermark function and StreamWatermarker class
- Apps now re-export from shared, reducing duplication
- Removes ~200 lines of duplicated code
