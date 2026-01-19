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
    it('should return true when WebCodecs is available', () => {
      // In test environment, WebCodecs APIs are mocked
      expect(canUseWebCodecsRecorder()).toBe(true)
    })
  })

  describe('getRecorderType', () => {
    it('should return webcodecs when WebCodecs is available', () => {
      expect(getRecorderType()).toBe('webcodecs')
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

    it('should create WebCodecsRecorder when WebCodecs is available', () => {
      const recorder = createRecorder(callbacks)
      expect(recorder).toBeInstanceOf(WebCodecsRecorder)
      recorder.dispose()
    })

    it('should create a recorder with the provided callbacks', () => {
      const recorder = createRecorder(callbacks)
      expect(recorder).toBeDefined()
      recorder.dispose()
    })
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
    expect(canUseWebCodecsRecorder()).toBe(false)
  })

  it('should return mediarecorder for getRecorderType when WebCodecs is not available', () => {
    expect(getRecorderType()).toBe('mediarecorder')
  })

  it('should create Recorder when WebCodecs is not available', () => {
    const callbacks = {
      onStart: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    }
    const recorder = createRecorder(callbacks)
    expect(recorder).toBeInstanceOf(Recorder)
    recorder.dispose()
  })
})
