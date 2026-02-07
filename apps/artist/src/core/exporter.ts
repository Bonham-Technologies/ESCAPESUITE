// Video export engine - barrel re-export module
// Split into focused modules for maintainability:
//   exportTypes.ts    - Shared types, constants, utility functions
//   canvasRenderer.ts - Canvas drawing (clips, overlays, transitions)
//   frameManager.ts   - WebCodecs frame management for MP4 export
//   audioMixer.ts     - Audio extraction and mixing
//   exportWebM.ts     - WebM export (VP9 + Opus)
//   exportMP4.ts      - MP4 export (H.264 + AAC)

// Public API - export functions
export { exportToWebM } from './exportWebM';
export { exportToMP4 } from './exportMP4';

// Public API - capability checks
export { isMP4ExportSupported, isWebMExportSupported } from './exportTypes';

// Public API - error class
export { ExportAbortedError } from './exportTypes';

// Public API - testing utilities
export { clearSeekPositions, getSeekPositionsCount } from './exportTypes';
