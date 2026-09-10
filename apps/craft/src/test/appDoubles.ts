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
import type { EnvironmentCapabilities, DetailedCapabilities } from '../store/types'

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

export const recorderFactoryModule = {
  createRecorder: recorderFactory.createRecorder,
  getRecorderType: recorderFactory.getRecorderType,
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

export const converterModule = {
  fixWebMMetadata: vi.fn(async (blob: Blob) => new Blob([blob], { type: 'video/webm' })),
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

  sendToEditorModule.sendToEditor.mockReset()
  sendToEditorModule.sendToEditor.mockReturnValue('opened')

  analyticsModule.track.mockReset()
}
