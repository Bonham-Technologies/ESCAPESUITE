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
 * Which capture one stored part of a take came from.
 *
 * A take used to be exactly one file, so nothing needed saying. A
 * separate-tracks take (ESCSUITE-14) is several files sharing a `takeId`, and
 * this is what tells the screen half from the webcam half. `'mic'` and
 * `'system'` are here because the audio companions (slice 3) will use them and
 * a reader written now should not have to be widened then.
 */
export type RecordingRole = 'screen' | 'webcam' | 'mic' | 'system'

/** Where a `SourceVideo.frameRate` came from. See that field. */
export type FrameRateSource = 'measured' | 'assumed' | 'configured'

/**
 * Where the webcam overlay sat while a take was recorded — written on the
 * take's primary part only.
 *
 * It is stored because the picture no longer carries it: a composited take has
 * the camera burned into the frame, while a separate-tracks take has it in a
 * second file that has to be put back somewhere. ESCAPEARTIST seeds the webcam
 * clip's transform from this (slice 2) and CRAFT's composite MP4 draws through
 * it (slice 4).
 *
 * The unions are spelled out here rather than imported from ESCAPECRAFT's
 * `WebcamPosition`/`WebcamShape`: this package is shared and must not depend on
 * an app. They are structurally identical, which is what lets the recorder hand
 * its config values straight over.
 */
export interface OverlayPlacement {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Fraction of the frame's width the overlay occupied, 0.1–0.4. */
  size: number
  shape: 'circle' | 'rectangle'
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
  /**
   * Frames per second. 0 for audio, 1 for a still image. How much to trust it
   * is `frameRateSource`.
   */
  frameRate: number
  /**
   * Where `frameRate` came from (ESCSUITE-276): `'measured'` from the file's
   * own presented frames at import (ESCAPEARTIST), `'configured'` from the
   * rate the recorder captured at (ESCAPECRAFT), `'assumed'` for a fallback
   * value nothing measured — 30 for a video, 1 for an image, 0 for audio.
   * Absent on every record written before the field existed, which reads the
   * same as `'assumed'`: its rate was always a placeholder.
   */
  frameRateSource?: FrameRateSource
  mimeType: string
  size: number
  thumbnailUrl?: string
  mediaType?: MediaType
  source?: MediaSource
  recordedAt?: number
  waveformData?: WaveformPeak[]
  hasAudio?: boolean
  /**
   * The take this file is one part of. Absent on a single-file take, which is
   * every recording made before ESCSUITE-14 and every composited PiP take
   * after it. The take's primary part carries its own id here, so grouping is
   * `part.takeId === primary.id` and nothing needs a second identifier.
   */
  takeId?: string
  /** Which half of the take this is. Absent whenever `takeId` is. */
  role?: RecordingRole
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset?: number
  /** Primary part only: where the webcam overlay sat while recording. */
  overlayPlacement?: OverlayPlacement
  /**
   * Whether the take captured the webcam at all. Written since ESCSUITE-14 the
   * way `hasAudio` has been written since ESCSUITE-60; a recording stored
   * before it has no field and is read back as `false`, which is the answer it
   * has always been given.
   */
  hasWebcam?: boolean
}
