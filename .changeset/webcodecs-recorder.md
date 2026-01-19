---
"@escapesuite/craft": minor
---

Add WebCodecs-based recorder for proper WebM container output

- New `WebCodecsRecorder` class using WebCodecs API and Mediabunny for muxing
- Produces properly structured WebM files that work in Windows Media Player
- Falls back to MediaRecorder-based recorder when WebCodecs is not available
- Added `recorder-factory.ts` for automatic recorder selection based on browser support
- VP9 video encoding at 2.5 Mbps, Opus audio encoding at 128 kbps
- Preserves all existing recorder functionality (pause/resume, duration tracking, audio levels)
