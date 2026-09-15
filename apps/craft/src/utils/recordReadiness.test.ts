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
} from './recordReadiness'
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

describe('recordBlockedReason before detection lands', () => {
  it('blocks the button while the capabilities are still being detected', () => {
    expect(recordBlockedReason(false, config(), caps())).toBe(CHECKING_CAPABILITIES)
  })

  it('stops blocking as soon as detection has answered', () => {
    expect(recordBlockedReason(true, config(), caps())).toBeNull()
  })
})

describe('recordBlockedReason with nothing to capture', () => {
  it('blocks when every source is switched off', () => {
    const off = config({ screenEnabled: false, webcamEnabled: false, microphoneEnabled: false })
    expect(recordBlockedReason(true, off, caps())).toBe(NO_SOURCE_ENABLED)
  })

  it('blocks when every enabled source is one this browser cannot capture', () => {
    const on = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true })
    const none = caps({ screenCapture: false, webcam: false, microphone: false })
    expect(recordBlockedReason(true, on, none)).toBe(NO_SOURCE_AVAILABLE)
  })

  it('blocks when the only enabled source is an unavailable screen', () => {
    const screenOnly = config({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: false })
    expect(recordBlockedReason(true, screenOnly, caps({ screenCapture: false }))).toBe(NO_SOURCE_AVAILABLE)
  })

  it('does not count system audio as a source of its own — it rides on the screen capture', () => {
    const systemOnly = config({
      screenEnabled: false,
      webcamEnabled: false,
      microphoneEnabled: false,
      systemAudioEnabled: true,
    })
    expect(recordBlockedReason(true, systemOnly, caps())).toBe(NO_SOURCE_ENABLED)
  })
})

describe('recordBlockedReason with one usable source', () => {
  it('allows a screen-only take', () => {
    const screenOnly = config({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: false })
    expect(recordBlockedReason(true, screenOnly, caps())).toBeNull()
  })

  it('allows a webcam-only take when the screen is unavailable', () => {
    const webcamOnly = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: false })
    expect(recordBlockedReason(true, webcamOnly, caps({ screenCapture: false }))).toBeNull()
  })

  it('allows an audio-only take when neither video source is available', () => {
    const everything = config({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true })
    const audioOnly = caps({ screenCapture: false, webcam: false })
    expect(recordBlockedReason(true, everything, audioOnly)).toBeNull()
  })
})
