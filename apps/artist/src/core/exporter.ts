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
export {
  isMP4ExportSupported,
  isWebMExportSupported,
  EXPORT_NO_WEBCODECS_REASON,
  WEBM_NO_CODEC_REASON,
} from './exportTypes';

// Public API - error classes
export { ExportAbortedError, ExportError } from './exportTypes';
export type { ExportLogEntry } from './exportTypes';
