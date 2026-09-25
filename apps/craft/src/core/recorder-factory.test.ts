import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRecorder, canUseWebCodecsRecorder, getRecorderType } from './recorder-factory'
import { Recorder } from './recorder'
import { WebCodecsRecorder } from './webcodecs-recorder'

// Mock WebCodecs APIs
const mockVideoEncoder = vi.fn().mockImplementation(() => ({
  configure: vi.fn().mockResolvedValue(undefined),
  encode: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  state: 'configured',
}))

const mockAudioEncoder = vi.fn().mockImplementation(() => ({
  configure: vi.fn().mockResolvedValue(undefined),
  encode: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  state: 'configured',
}))

const mockVideoFrame = vi.fn().mockImplementation(() => ({
  close: vi.fn(),
}))

const mockAudioData = vi.fn().mockImplementation(() => ({
  close: vi.fn(),
}))

vi.stubGlobal('VideoEncoder', mockVideoEncoder)
vi.stubGlobal('AudioEncoder', mockAudioEncoder)
vi.stubGlobal('VideoFrame', mockVideoFrame)
vi.stubGlobal('AudioData', mockAudioData)
// A separate-tracks take needs the track processor as well as WebCodecs — the
// webcam pipeline reads frames from one and has no <video> fallback.
vi.stubGlobal('MediaStreamTrackProcessor', class MediaStreamTrackProcessorStub {})

// Mock webm-duration-fix for Recorder
vi.mock('webm-duration-fix', () => ({
  default: vi.fn((blob: Blob) => Promise.resolve(blob)),
}))

// Mock permissions module
vi.mock('./permissions', () => ({
  getSupportedMimeType: vi.fn(() => 'video/webm;codecs=vp9,opus'),
  stopStream: vi.fn(),
}))

// Mock Mediabunny for WebCodecsRecorder
vi.mock('mediabunny', () => ({
  Output: vi.fn().mockImplementation(() => ({
    addVideoTrack: vi.fn(),
    addAudioTrack: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
  })),
  BufferTarget: vi.fn().mockImplementation(() => ({
    buffer: new ArrayBuffer(100),
  })),
  WebMOutputFormat: vi.fn(),
  EncodedVideoPacketSource: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
  })),
  EncodedAudioPacketSource: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
  })),
  EncodedPacket: {
    fromEncodedChunk: vi.fn((chunk) => chunk),
  },
}))

describe('recorder-factory', () => {
  describe('canUseWebCodecsRecorder', () => {
    it('should return false when isPiP is true', () => {
      expect(canUseWebCodecsRecorder(true)).toBe(false)
    })

    it('should return true when isPiP is false and WebCodecs is available', () => {
      expect(canUseWebCodecsRecorder(false)).toBe(true)
    })

    it('should return true by default (non-PiP)', () => {
      expect(canUseWebCodecsRecorder()).toBe(true)
    })

    it('should return false for an audio-only take, even with WebCodecs present', () => {
      expect(canUseWebCodecsRecorder(false, false)).toBe(false)
    })

    it('lets a PiP take reach WebCodecs when it is recording separate tracks', () => {
      // The compositor's hidden <video> elements are what break WebCodecs frame
      // capture, and a separate-tracks take does not capture through it: the
      // recorder reads the raw screen and webcam tracks, and the compositor
      // only draws the preview.
      expect(canUseWebCodecsRecorder(true, true, true)).toBe(true)
      expect(getRecorderType(true, true, true)).toBe('webcodecs')
    })

    it('still refuses an audio-only take that asks for separate tracks', () => {
      expect(canUseWebCodecsRecorder(false, false, true)).toBe(false)
    })
  })

  describe('getRecorderType', () => {
    it('should return webcodecs for non-PiP mode', () => {
      expect(getRecorderType(false)).toBe('webcodecs')
    })

    it('should return mediarecorder for PiP mode', () => {
      expect(getRecorderType(true)).toBe('mediarecorder')
    })

    it('should return mediarecorder for an audio-only take', () => {
      expect(getRecorderType(false, false)).toBe('mediarecorder')
    })
  })

  describe('createRecorder', () => {
    const callbacks = {
      onStart: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    }

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should create WebCodecsRecorder for non-PiP mode', () => {
      const recorder = createRecorder(callbacks, false)
      expect(recorder).toBeInstanceOf(WebCodecsRecorder)
      recorder.dispose()
    })

    it('should create Recorder (MediaRecorder-based) for PiP mode', () => {
      const recorder = createRecorder(callbacks, true)
      expect(recorder).toBeInstanceOf(Recorder)
      recorder.dispose()
    })

    it('should create Recorder for an audio-only take', () => {
      // Both video sources off: WebCodecsRecorder.initialize() would throw
      // 'No video track available for recording', while MediaRecorder happily
      // records the mixed audio track on its own.
      const recorder = createRecorder(callbacks, false, false)
      expect(recorder).toBeInstanceOf(Recorder)
      recorder.dispose()
    })

    it('should create WebCodecsRecorder for a separate-tracks PiP take', () => {
      const recorder = createRecorder(callbacks, true, true, true)
      expect(recorder).toBeInstanceOf(WebCodecsRecorder)
      recorder.dispose()
    })
  })
})

describe('recorder-factory without MediaStreamTrackProcessor', () => {
  // The real gate, asked of this module rather than of the factory double that
  // the controller suite mocks: a browser can have WebCodecs and still not be
  // able to read a second pipeline, and only `canRecordSeparateTracks()` knows
  // it. Without a test here, the double's hand-copied rule could drift from
  // canUseWebCodecsRecorder and the controller suite would stay green.
  const g = globalThis as { MediaStreamTrackProcessor?: unknown }
  const original = g.MediaStreamTrackProcessor

  beforeEach(() => {
    delete g.MediaStreamTrackProcessor
  })

  afterEach(() => {
    // Put the key back as it was. Assigning `undefined` would leave the key
    // present, and `'MediaStreamTrackProcessor' in globalThis` — which is what
    // canRecordSeparateTracks() asks — would then answer true.
    if (original === undefined) delete g.MediaStreamTrackProcessor
    else g.MediaStreamTrackProcessor = original
  })

  it('refuses separate tracks when WebCodecs is there but the track processor is not', () => {
    // WebCodecs itself is still present, so a single-source take is unaffected:
    // the refusal below is the track processor's absence and nothing else.
    expect(canUseWebCodecsRecorder(false, true)).toBe(true)
    expect(canUseWebCodecsRecorder(true, true, true)).toBe(false)
    expect(getRecorderType(true, true, true)).toBe('mediarecorder')
  })
})

describe('recorder-factory without WebCodecs', () => {
  const originalVideoEncoder = globalThis.VideoEncoder
  const originalVideoFrame = globalThis.VideoFrame
  const originalAudioEncoder = globalThis.AudioEncoder

  beforeEach(() => {
    // Remove WebCodecs APIs to simulate unsupported browser
    // @ts-expect-error - intentionally removing for test
    delete globalThis.VideoEncoder
    // @ts-expect-error - intentionally removing for test
    delete globalThis.VideoFrame
    // @ts-expect-error - intentionally removing for test
    delete globalThis.AudioEncoder
  })

  afterEach(() => {
    // Restore WebCodecs APIs
    globalThis.VideoEncoder = originalVideoEncoder
    globalThis.VideoFrame = originalVideoFrame
    globalThis.AudioEncoder = originalAudioEncoder
  })

  it('should return false for canUseWebCodecsRecorder when WebCodecs is not available', () => {
    expect(canUseWebCodecsRecorder(false)).toBe(false)
  })

  it('should return mediarecorder for getRecorderType when WebCodecs is not available', () => {
    expect(getRecorderType(false)).toBe('mediarecorder')
  })

  it('should create Recorder when WebCodecs is not available', () => {
    const callbacks = {
      onStart: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    }
    const recorder = createRecorder(callbacks, false)
    expect(recorder).toBeInstanceOf(Recorder)
    recorder.dispose()
  })
})
