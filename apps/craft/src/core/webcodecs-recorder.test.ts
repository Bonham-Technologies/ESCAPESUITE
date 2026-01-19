import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebCodecsRecorder, isWebCodecsRecordingSupported, type WebCodecsRecorderCallbacks } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'

// Mock WebCodecs APIs
class MockVideoEncoder {
  state = 'configured'
  configure = vi.fn().mockResolvedValue(undefined)
  encode = vi.fn()
  flush = vi.fn().mockResolvedValue(undefined)
  close = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(init: { output: () => void; error: () => void }) {}
}

class MockAudioEncoder {
  state = 'configured'
  configure = vi.fn().mockResolvedValue(undefined)
  encode = vi.fn()
  flush = vi.fn().mockResolvedValue(undefined)
  close = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(init: { output: () => void; error: () => void }) {}
}

class MockVideoFrame {
  close = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(source: HTMLCanvasElement, init: { timestamp: number; duration: number }) {}
}

class MockAudioData {
  close = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(init: { format: string; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) {}
}

vi.stubGlobal('VideoEncoder', MockVideoEncoder)
vi.stubGlobal('AudioEncoder', MockAudioEncoder)
vi.stubGlobal('VideoFrame', MockVideoFrame)
vi.stubGlobal('AudioData', MockAudioData)

// Mock Mediabunny
vi.mock('mediabunny', () => {
  class MockOutput {
    addVideoTrack = vi.fn()
    addAudioTrack = vi.fn()
    start = vi.fn().mockResolvedValue(undefined)
    finalize = vi.fn().mockResolvedValue(undefined)
  }

  class MockBufferTarget {
    buffer = new ArrayBuffer(100)
  }

  class MockWebMOutputFormat {}

  class MockEncodedVideoPacketSource {
    add = vi.fn().mockResolvedValue(undefined)
  }

  class MockEncodedAudioPacketSource {
    add = vi.fn().mockResolvedValue(undefined)
  }

  return {
    Output: MockOutput,
    BufferTarget: MockBufferTarget,
    WebMOutputFormat: MockWebMOutputFormat,
    EncodedVideoPacketSource: MockEncodedVideoPacketSource,
    EncodedAudioPacketSource: MockEncodedAudioPacketSource,
    EncodedPacket: {
      fromEncodedChunk: vi.fn((chunk) => chunk),
    },
  }
})

// Helper to create mock MediaStreamTrack
function createMockTrack(kind: 'video' | 'audio', id: string = 'mock-track'): MediaStreamTrack {
  return {
    id,
    kind,
    label: `Mock ${kind} track`,
    enabled: true,
    muted: false,
    readyState: 'live' as const,
    contentHint: '',
    getSettings: vi.fn(() => ({ width: 1920, height: 1080 })),
    getCapabilities: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    applyConstraints: vi.fn(),
    clone: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onended: null,
    onmute: null,
    onunmute: null,
  } as unknown as MediaStreamTrack
}

// Helper to create mock MediaStream
function createMockStream(videoTracks: MediaStreamTrack[] = [], audioTracks: MediaStreamTrack[] = []): MediaStream {
  return {
    id: 'mock-stream',
    active: true,
    getVideoTracks: vi.fn(() => videoTracks),
    getAudioTracks: vi.fn(() => audioTracks),
    getTracks: vi.fn(() => [...videoTracks, ...audioTracks]),
    getTrackById: vi.fn(),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream
}

describe('isWebCodecsRecordingSupported', () => {
  it('should return true when WebCodecs APIs are available', () => {
    // The test environment has WebCodecs mocked
    expect(isWebCodecsRecordingSupported()).toBe(true)
  })
})

describe('WebCodecsRecorder', () => {
  let recorder: WebCodecsRecorder
  let callbacks: WebCodecsRecorderCallbacks
  let screenStream: MediaStream
  let webcamStream: MediaStream
  const defaultConfig: RecordingConfig = {
    screenEnabled: true,
    webcamEnabled: false,
    microphoneEnabled: false,
    systemAudioEnabled: false,
    countdownSeconds: 0,
    webcamPosition: 'bottom-right',
    webcamSize: 'medium',
    webcamShape: 'circle',
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    callbacks = {
      onStart: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
      onAudioLevels: vi.fn(),
    }

    const videoTrack = createMockTrack('video')
    const audioTrack = createMockTrack('audio')

    screenStream = createMockStream([videoTrack], [audioTrack])
    webcamStream = createMockStream([createMockTrack('video', 'webcam-video')], [createMockTrack('audio', 'webcam-audio')])

    recorder = new WebCodecsRecorder(callbacks)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    recorder.dispose()
  })

  describe('constructor', () => {
    it('should create a recorder with callbacks', () => {
      expect(recorder).toBeDefined()
    })

    it('should create a recorder without callbacks', () => {
      const recorderNoCallbacks = new WebCodecsRecorder()
      expect(recorderNoCallbacks).toBeDefined()
      recorderNoCallbacks.dispose()
    })
  })

  describe('initialize', () => {
    it('should initialize with screen stream', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      expect(recorder).toBeDefined()
    })

    it('should initialize with webcam stream when screen is disabled', async () => {
      await recorder.initialize(null, webcamStream, null, {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: true,
      })
      expect(recorder).toBeDefined()
    })

    it('should throw error when no video track is available', async () => {
      await expect(
        recorder.initialize(null, null, null, defaultConfig)
      ).rejects.toThrow('No video track available')
    })
  })

  describe('start', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('should start recording', () => {
      recorder.start()
      expect(callbacks.onStart).toHaveBeenCalled()
      expect(recorder.isRecording()).toBe(true)
    })

    it('should throw error if not initialized', () => {
      const freshRecorder = new WebCodecsRecorder(callbacks)
      expect(() => freshRecorder.start()).toThrow('Recorder not initialized')
      freshRecorder.dispose()
    })
  })

  describe('pause and resume', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()
    })

    it('should pause recording', () => {
      recorder.pause()
      expect(callbacks.onPause).toHaveBeenCalled()
      expect(recorder.isPaused()).toBe(true)
      expect(recorder.isRecording()).toBe(false)
    })

    it('should resume recording', () => {
      recorder.pause()
      recorder.resume()
      expect(callbacks.onResume).toHaveBeenCalled()
      expect(recorder.isPaused()).toBe(false)
      expect(recorder.isRecording()).toBe(true)
    })
  })

  describe('stop', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()
    })

    it('should stop recording and produce a blob', async () => {
      await recorder.stop()
      expect(callbacks.onStop).toHaveBeenCalled()
      const blob = (callbacks.onStop as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('video/webm')
    })
  })

  describe('getDuration', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('should return 0 when not started', () => {
      expect(recorder.getDuration()).toBe(0)
    })

    it('should track duration during recording', () => {
      recorder.start()
      vi.advanceTimersByTime(2000)
      const duration = recorder.getDuration()
      expect(duration).toBeGreaterThanOrEqual(1.9)
      expect(duration).toBeLessThanOrEqual(2.1)
    })

    it('should not count paused time', () => {
      recorder.start()
      vi.advanceTimersByTime(1000)
      recorder.pause()
      vi.advanceTimersByTime(1000)
      recorder.resume()
      vi.advanceTimersByTime(1000)
      const duration = recorder.getDuration()
      expect(duration).toBeGreaterThanOrEqual(1.9)
      expect(duration).toBeLessThanOrEqual(2.1)
    })
  })

  describe('isRecording and isPaused', () => {
    beforeEach(async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
    })

    it('should return correct state before starting', () => {
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(false)
    })

    it('should return correct state while recording', () => {
      recorder.start()
      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)
    })

    it('should return correct state while paused', () => {
      recorder.start()
      recorder.pause()
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(true)
    })
  })

  describe('dispose', () => {
    it('should clean up resources', async () => {
      await recorder.initialize(screenStream, null, null, defaultConfig)
      recorder.start()
      recorder.dispose()
      expect(recorder.isRecording()).toBe(false)
    })

    it('should be safe to call multiple times', () => {
      expect(() => {
        recorder.dispose()
        recorder.dispose()
      }).not.toThrow()
    })
  })
})
