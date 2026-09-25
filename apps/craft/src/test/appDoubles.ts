// Collaborator doubles for the ESCAPECRAFT App tests.
//
// This module is a leaf on purpose: it imports no application code at runtime,
// so a `vi.mock` factory can pull it in while the module it stands in for is
// still being mocked. Each App test file wires it up like this:
//
//   vi.mock('./core/recorder-factory', async () =>
//     (await import('./test/appDoubles')).recorderFactoryModule)
//
// Everything here is a boundary the browser owns (screen/camera capture,
// WebCodecs muxing, thumbnail decoding, opening the editor, analytics
// delivery). App's own orchestration is never mocked.
import { vi } from 'vitest'
import { createRecorderFactoryDouble } from './doubles/recorder'
import type {
  EnvironmentCapabilities,
  DetailedCapabilities,
  OverlayPlacement,
} from '../store/types'

export interface CapabilityDetectionResultLike {
  capabilities: EnvironmentCapabilities
  detailed: DetailedCapabilities
}

/** All five capabilities present, as a Chrome tab on HTTPS reports them. */
export function allCapabilities(): EnvironmentCapabilities {
  return {
    screenCapture: true,
    webcam: true,
    microphone: true,
    systemAudio: true,
    mediaRecorder: true,
  }
}

export function allDetailedCapabilities(): DetailedCapabilities {
  return {
    screenCapture: { available: true },
    webcam: { available: true },
    microphone: { available: true },
    systemAudio: { available: true },
    mediaRecorder: { available: true },
  }
}

export function detectionResult(
  overrides: Partial<EnvironmentCapabilities> = {},
  detailedOverrides: Partial<DetailedCapabilities> = {}
): CapabilityDetectionResultLike {
  return {
    capabilities: { ...allCapabilities(), ...overrides },
    detailed: { ...allDetailedCapabilities(), ...detailedOverrides },
  }
}

// --- core/recorder-factory --------------------------------------------------

export const recorderFactory = createRecorderFactoryDouble()

// The whole public surface of core/recorder-factory, so a future import from
// App cannot silently resolve to undefined.
export const recorderFactoryModule = {
  createRecorder: recorderFactory.createRecorder,
  getRecorderType: recorderFactory.getRecorderType,
  canUseWebCodecsRecorder: recorderFactory.canUseWebCodecsRecorder,
}

// --- core/permissions (only the capture entry points) -----------------------

export const permissionsOverrides = {
  detectCapabilities: vi.fn(async () => detectionResult()),
  requestScreenCapture: vi.fn<(withSystemAudio: boolean) => Promise<MediaStream>>(),
  requestWebcam: vi.fn<() => Promise<MediaStream>>(),
  requestMicrophone: vi.fn<() => Promise<MediaStream>>(),
}

// --- core/thumbnailGenerator ------------------------------------------------

export const thumbnailModule = {
  generateThumbnail: vi.fn(async () => new Blob(['generated-thumb'], { type: 'image/jpeg' })),
  extractVideoMetadata: vi.fn(async (_blob: Blob, knownDuration?: number) => ({
    duration: knownDuration ?? 0,
    width: 1920,
    height: 1080,
  })),
  generateStreamThumbnail: vi.fn(),
}

// --- core/converter ---------------------------------------------------------

/**
 * Stand-in for the real `ConversionAbortedError`.
 *
 * It has to be declared here rather than imported: this module is pulled in by
 * the `vi.mock('./core/converter')` factory itself, so importing the real class
 * would resolve to the mocked module and come back undefined — and the
 * `instanceof` check in `useMp4Download` would then treat a cancellation as a
 * failure. The app only ever sees whichever class the module it imports
 * exports, so this one is the one its `instanceof` is against.
 */
export class ConversionAbortedError extends Error {
  constructor() {
    super('Conversion was cancelled')
    this.name = 'ConversionAbortedError'
  }
}

export interface ConversionProgressLike {
  phase: 'preparing' | 'encoding' | 'finalizing'
  progress: number
  message: string
}

/**
 * `convertToMP4`'s fourth argument: the camera half of a separate-tracks take
 * and where to draw it (ESCSUITE-14). Described here rather than imported for
 * the same reason as everything else in this module — it must stay a leaf — and
 * it is on the *type* rather than the double because what the tests check is
 * what the hook passed, not what a double did with it.
 */
export interface CompositeOptionsLike {
  companion: { blob: Blob; placement: OverlayPlacement; startOffset: number }
  onCompanionSkipped?: () => void
}

/** What the hook calls, arity included, so a test can read the fourth argument. */
export type ConvertToMP4Like = (
  blob: Blob,
  onProgress: (progress: ConversionProgressLike) => void,
  signal?: AbortSignal,
  composite?: CompositeOptionsLike
) => Promise<Blob>

/**
 * The happy path, start to finish in one turn: two progress reports and an MP4.
 * A test that wants to watch a conversion mid-flight replaces it.
 *
 * It takes no composite argument: a double that ignored one would look like a
 * conversion that dropped the camera, and the four tests about the camera each
 * supply their own implementation.
 */
async function convertToMP4Double(
  blob: Blob,
  onProgress: (progress: ConversionProgressLike) => void,
  signal?: AbortSignal
): Promise<Blob> {
  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing conversion...' })
  if (signal?.aborted) throw new ConversionAbortedError()
  onProgress({ phase: 'encoding', progress: 50, message: 'Encoding video...' })
  return new Blob([blob], { type: 'video/mp4' })
}

/**
 * The audio-only happy path: the same shape, an `audio/mp4` blob at the end.
 */
async function convertToM4ADouble(
  blob: Blob,
  onProgress: (progress: ConversionProgressLike) => void,
  signal?: AbortSignal
): Promise<Blob> {
  onProgress({ phase: 'preparing', progress: 0, message: 'Extracting audio…' })
  if (signal?.aborted) throw new ConversionAbortedError()
  onProgress({ phase: 'encoding', progress: 50, message: 'Encoding audio…' })
  return new Blob([blob], { type: 'audio/mp4' })
}

export interface Mp4SupportProbeLike {
  supported: boolean
  /** False when the browser has no AAC encoder: the MP4 is offered, silent. */
  audio: boolean
  /** Why an MP4 cannot be written. */
  reason?: string
  /** Why it will have no sound — the AAC answer's own sentence. */
  audioReason?: string
}

export const converterModule = {
  fixWebMMetadata: vi.fn(async (blob: Blob) => new Blob([blob], { type: 'video/webm' })),
  isMP4ConversionSupported: vi.fn(() => true),
  /**
   * The codec probe, answering yes. A test about a browser that cannot encode
   * MP4 says so here; one about the moment before the answer arrives returns a
   * promise it never settles.
   */
  probeMP4Support: vi.fn<() => Promise<Mp4SupportProbeLike>>(async () => ({
    supported: true,
    audio: true,
  })),
  convertToMP4: vi.fn<ConvertToMP4Like>(convertToMP4Double),
  convertToM4A: vi.fn(convertToM4ADouble),
  ConversionAbortedError,
}

// --- utils/sendToEditor -----------------------------------------------------

export const sendToEditorModule = {
  sendToEditor: vi.fn<(id: string) => 'posted' | 'opened'>(() => 'opened'),
}

// --- @vercel/analytics ------------------------------------------------------

export const analyticsModule = {
  track: vi.fn(),
}

/** Put every double back to its default behaviour and forget past calls. */
export function resetAppDoubles(): void {
  recorderFactory.reset()

  permissionsOverrides.detectCapabilities.mockReset()
  permissionsOverrides.detectCapabilities.mockImplementation(async () => detectionResult())
  permissionsOverrides.requestScreenCapture.mockReset()
  permissionsOverrides.requestWebcam.mockReset()
  permissionsOverrides.requestMicrophone.mockReset()

  thumbnailModule.generateThumbnail.mockReset()
  thumbnailModule.generateThumbnail.mockImplementation(
    async () => new Blob(['generated-thumb'], { type: 'image/jpeg' })
  )
  thumbnailModule.extractVideoMetadata.mockReset()
  thumbnailModule.extractVideoMetadata.mockImplementation(async (_blob, knownDuration) => ({
    duration: knownDuration ?? 0,
    width: 1920,
    height: 1080,
  }))

  converterModule.fixWebMMetadata.mockReset()
  converterModule.fixWebMMetadata.mockImplementation(
    async (blob: Blob) => new Blob([blob], { type: 'video/webm' })
  )
  converterModule.isMP4ConversionSupported.mockReset()
  converterModule.isMP4ConversionSupported.mockReturnValue(true)
  converterModule.probeMP4Support.mockReset()
  converterModule.probeMP4Support.mockResolvedValue({ supported: true, audio: true })
  converterModule.convertToMP4.mockReset()
  converterModule.convertToMP4.mockImplementation(convertToMP4Double)
  converterModule.convertToM4A.mockReset()
  converterModule.convertToM4A.mockImplementation(convertToM4ADouble)

  sendToEditorModule.sendToEditor.mockReset()
  sendToEditorModule.sendToEditor.mockReturnValue('opened')

  analyticsModule.track.mockReset()
}
