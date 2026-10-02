// Video export engine - barrel re-export module
// Split into focused modules for maintainability:
//   exportTypes.ts    - Shared types, constants, utility functions
//   canvasRenderer.ts - Canvas drawing (clips, overlays, transitions)
//   frameManager.ts   - WebCodecs frame management for MP4 export
//   audioMixer.ts     - Audio extraction and mixing
//   exportWebM.ts     - WebM export (VP9 + Opus)
//   exportMP4.ts      - MP4 export (H.264 + AAC)
//   exportGIF.ts      - GIF export (gifenc, no WebCodecs)
//   elementFrames.ts  - the per-frame machinery exportWebM.ts and exportGIF.ts share
//   gifEncoder.ts     - the one importer of `gifenc`

// Public API - export functions
export { exportToWebM } from './exportWebM';
export { exportToMP4 } from './exportMP4';
export { exportToGIF, estimateGifBytes } from './exportGIF';

// Public API - the GIF frame delay a file stores, which a duration is derived from
export { gifFrameDelayMs } from './exportTypes';

// Public API - capability checks
export {
  isMP4ExportSupported,
  isWebMExportSupported,
  isGIFExportSupported,
  EXPORT_NO_WEBCODECS_REASON,
  WEBM_NO_CODEC_REASON,
  GIF_ALWAYS_AVAILABLE_NOTE,
} from './exportTypes';

// Public API - error classes
export { ExportAbortedError, ExportError } from './exportTypes';
export type { ExportLogEntry } from './exportTypes';
