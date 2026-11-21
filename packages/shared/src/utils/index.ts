// Shared utility functions

export {
  formatTimecode,
  formatTime,
  formatDuration,
  parseTimecode,
  clamp,
  roundTo,
  pixelsToTime,
  timeToPixels,
  formatFileSize,
} from './time'

export {
  createVp9ColourSpaceStamper,
  vp9ColourSpaceBitOffset,
  withVp9ColourSpace,
  type Vp9ChunkMetadataLike,
  type Vp9PacketLike,
} from './vp9ColourSpace'

export { isFirefoxEngine, relabelFirefoxVpxMeta } from './firefoxVpxColour'

export { holdScreenAwake, type ScreenAwakeHold, type HoldScreenAwakeOptions } from './screenWakeLock'
