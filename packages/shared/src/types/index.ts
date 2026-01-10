// Shared types between ESCAPECRAFT and ESCAPEARTIST

/**
 * Media type classification
 */
export type MediaType = 'video' | 'image' | 'audio'

/**
 * How the media was added to the library
 */
export type MediaSource = 'upload' | 'recording'

/**
 * Waveform data for audio visualization
 */
export interface WaveformPeak {
  min: number  // -1 to 1
  max: number  // -1 to 1
}

/**
 * Source video metadata - shared between recorder and editor
 * Stored in IndexedDB with the video blob
 */
export interface SourceVideo {
  id: string
  name: string
  duration: number
  width: number
  height: number
  frameRate: number
  mimeType: string
  size: number
  thumbnailUrl?: string
  mediaType?: MediaType
  source?: MediaSource
  recordedAt?: number
  waveformData?: WaveformPeak[]
  hasAudio?: boolean
}
