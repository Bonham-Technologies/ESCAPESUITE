// Whether the Record button can do anything yet, and what it says when it
// cannot.
//
// A pure function over the two store slices the button depends on, so the
// tests are a table of configurations rather than a rendered app.
import { describe, it, expect } from 'vitest'
import {
  recordBlockedReason,
  CHECKING_CAPABILITIES,
  NO_SOURCE_ENABLED,
  NO_SOURCE_AVAILABLE,
  NO_STORAGE_SPACE,
} from './recordReadiness'
import { SEPARATE_TRACKS_NO_SPACE_REASON } from './separateTracksReadiness'
import { defaultConfig, type EnvironmentCapabilities, type RecordingConfig } from '../store/types'

function caps(overrides: Partial<EnvironmentCapabilities> = {}): EnvironmentCapabilities {
  return {
    screenCapture: true,
    webcam: true,
    microphone: true,
    systemAudio: true,
    mediaRecorder: true,
    ...overrides,
  }
}

function config(overrides: Partial<RecordingConfig> = {}): RecordingConfig {
  return { ...defaultConfig, ...overrides }
}

/** The five inputs, with "there is room to store a take" as the default for both. */
function blocked(
  capabilitiesReady: boolean,
  cfg: RecordingConfig,
  capabilities: EnvironmentCapabilities,
  hasStorageSpace = true,
  hasSeparateTracksSpace = true
): string | null {
  return recordBlockedReason(
    capabilitiesReady,
    cfg,
    capabilities,
    hasStorageSpace,
    hasSeparateTracksSpace
  )
}

describe('recordBlockedReason before detection lands', () => {
  it('blocks the button while the capabilities are still being detected', () => {
    expect(blocked(false, config(), caps())).toBe(CHECKING_CAPABILITIES)
  })

  it('stops blocking as soon as detection has answered', () => {
    expect(blocked(true, config(), caps())).toBeNull()
  })
})

describe('recordBlockedReason with nothing to capture', () => {
  it('blocks when every source is switched off', () => {
    const off = config({ screenEnabled: false, webcamEnabled: false, microphoneEnabled: false })
    expect(blocked(true, off, caps())).toBe(NO_SOURCE_ENABLED)
  })

  it('blocks when every enabled source is one this browser cannot capture', () => {
    const on = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true })
    const none = caps({ screenCapture: false, webcam: false, microphone: false })
    expect(blocked(true, on, none)).toBe(NO_SOURCE_AVAILABLE)
  })

  it('blocks when the only enabled source is an unavailable screen', () => {
    const screenOnly = config({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: false })
    expect(blocked(true, screenOnly, caps({ screenCapture: false }))).toBe(NO_SOURCE_AVAILABLE)
  })

  it('does not count system audio as a source of its own — it rides on the screen capture', () => {
    const systemOnly = config({
      screenEnabled: false,
      webcamEnabled: false,
      microphoneEnabled: false,
      systemAudioEnabled: true,
    })
    expect(blocked(true, systemOnly, caps())).toBe(NO_SOURCE_ENABLED)
  })
})

describe('recordBlockedReason with one usable source', () => {
  it('allows a screen-only take', () => {
    const screenOnly = config({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: false })
    expect(blocked(true, screenOnly, caps())).toBeNull()
  })

  it('allows a webcam-only take when the screen is unavailable', () => {
    const webcamOnly = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: false })
    expect(blocked(true, webcamOnly, caps({ screenCapture: false }))).toBeNull()
  })

  it('allows an audio-only take when neither video source is available', () => {
    const everything = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true })
    const audioOnly = caps({ screenCapture: false, webcam: false })
    expect(blocked(true, everything, audioOnly)).toBeNull()
  })
})

describe('recordBlockedReason with nowhere to put the take', () => {
  it('blocks when storage has no room left, before the click rather than after it', () => {
    expect(blocked(true, config(), caps(), false)).toBe(NO_STORAGE_SPACE)
  })

  it('reports the missing source first — that is the one the user just changed', () => {
    const off = config({ screenEnabled: false, webcamEnabled: false, microphoneEnabled: false })
    expect(blocked(true, off, caps(), false)).toBe(NO_SOURCE_ENABLED)
  })
})

// ESCSUITE-176 (probe m3). Before this, the separate-tracks headroom check
// (`hasSeparateTracksSpace`, roughly double a plain take) only ever reached
// the toggle — which can refuse switching the mode *on*, but not a take
// already configured for it, so the Record button stayed live and the take
// started at double the size it had room for.
describe('recordBlockedReason with the separate-tracks mode on', () => {
  function pipConfig(overrides: Partial<RecordingConfig> = {}): RecordingConfig {
    return config({
      screenEnabled: true,
      webcamEnabled: true,
      microphoneEnabled: false,
      separateTracks: true,
      ...overrides,
    })
  }

  it('refuses the take, with the toggle\'s own reason, when there is room for only one track', () => {
    expect(blocked(true, pipConfig(), caps(), true, false)).toBe(SEPARATE_TRACKS_NO_SPACE_REASON)
  })

  it('allows the take when there is room for both tracks', () => {
    expect(blocked(true, pipConfig(), caps(), true, true)).toBeNull()
  })

  it('does not ask the question for a take with the mode off', () => {
    expect(blocked(true, pipConfig({ separateTracks: false }), caps(), true, false)).toBeNull()
  })

  it('does not ask the question for a take that is not PiP (webcam off)', () => {
    expect(blocked(true, pipConfig({ webcamEnabled: false }), caps(), true, false)).toBeNull()
  })

  it('does not ask the question for a take that is not PiP (screen off)', () => {
    expect(blocked(true, pipConfig({ screenEnabled: false }), caps(), true, false)).toBeNull()
  })

  it('reports the plain storage reason first when there is no room at all', () => {
    expect(blocked(true, pipConfig(), caps(), false, false)).toBe(NO_STORAGE_SPACE)
  })
})
