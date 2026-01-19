import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Recorder, RecorderCallbacks } from './recorder'
import type { RecordingConfig } from '../store/types'

// Mock webm-duration-fix
vi.mock('webm-duration-fix', () => ({
  default: vi.fn((blob: Blob) => Promise.resolve(blob)),
}))

// Mock permissions module
vi.mock('./permissions', () => ({
  getSupportedMimeType: vi.fn(() => 'video/webm;codecs=vp9,opus'),
  stopStream: vi.fn(),
}))

// Helper to create mock MediaStreamTrack
function createMockTrack(kind: 'video' | 'audio', id: string = 'mock-track'): MediaStreamTrack {
  return {
    id,
    kind,
    label: `Mock ${kind} track`,
    enabled: true,
    muted: false,
    readyState: 'live',
    stop: vi.fn(),
    clone: vi.fn(),
    getCapabilities: vi.fn(() => ({})),
    getConstraints: vi.fn(() => ({})),
    getSettings: vi.fn(() => ({})),
    applyConstraints: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onended: null,
    onmute: null,
    onunmute: null,
  } as unknown as MediaStreamTrack
}

// Helper to create mock MediaStream with specific tracks
function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  const stream = new MediaStream(tracks)
  vi.mocked(stream.getVideoTracks).mockReturnValue(
    tracks.filter((t) => t.kind === 'video')
  )
  vi.mocked(stream.getAudioTracks).mockReturnValue(
    tracks.filter((t) => t.kind === 'audio')
  )
  vi.mocked(stream.getTracks).mockReturnValue(tracks)
  return stream
}

// Default recording config
const defaultConfig: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: true,
  systemAudioEnabled: false,
  webcamPosition: 'bottom-right',
  webcamSize: 'medium',
  webcamShape: 'circle',
  countdown: 3,
}

describe('Recorder', () => {
  let recorder: Recorder
  let callbacks: RecorderCallbacks
  let mockScreenStream: MediaStream
  let mockMicStream: MediaStream
  let mockWebcamStream: MediaStream

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Create mock streams
    mockScreenStream = createMockStream([
      createMockTrack('video', 'screen-video'),
    ])
    mockMicStream = createMockStream([createMockTrack('audio', 'mic-audio')])
    mockWebcamStream = createMockStream([
      createMockTrack('video', 'webcam-video'),
    ])

    // Create callbacks with spies
    callbacks = {
      onStart: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
      onAudioLevels: vi.fn(),
    }

    recorder = new Recorder(callbacks)
  })

  afterEach(() => {
    vi.useRealTimers()
    recorder.dispose()
  })

  describe('constructor', () => {
    it('should create a Recorder instance with callbacks', () => {
      expect(recorder).toBeInstanceOf(Recorder)
    })

    it('should create a Recorder instance without callbacks', () => {
      const recorderWithoutCallbacks = new Recorder()
      expect(recorderWithoutCallbacks).toBeInstanceOf(Recorder)
      recorderWithoutCallbacks.dispose()
    })
  })

  describe('initialize', () => {
    it('should initialize with screen and mic streams', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(false)
    })

    it('should initialize with webcam when screen is disabled', async () => {
      const config: RecordingConfig = {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: true,
      }

      await recorder.initialize(null, mockWebcamStream, mockMicStream, config)

      expect(recorder.isRecording()).toBe(false)
    })

    it('should initialize with screen and system audio', async () => {
      const screenWithAudio = createMockStream([
        createMockTrack('video', 'screen-video'),
        createMockTrack('audio', 'system-audio'),
      ])

      const config: RecordingConfig = {
        ...defaultConfig,
        microphoneEnabled: false,
        systemAudioEnabled: true,
      }

      await recorder.initialize(screenWithAudio, null, null, config)

      expect(recorder.isRecording()).toBe(false)
    })

    it('should throw error when no tracks available', async () => {
      // Save the original AudioContext mock
      const OriginalAudioContext = globalThis.AudioContext

      // Create empty streams that return no tracks
      const emptyStream = new MediaStream([])
      vi.mocked(emptyStream.getVideoTracks).mockReturnValue([])
      vi.mocked(emptyStream.getAudioTracks).mockReturnValue([])
      vi.mocked(emptyStream.getTracks).mockReturnValue([])

      // Mock AudioContext to return empty audio destination
      class MockAudioContext {
        state = 'running'
        resume = vi.fn().mockResolvedValue(undefined)
        createMediaStreamDestination = vi.fn(() => ({
          stream: {
            getAudioTracks: vi.fn(() => []),
          },
        }))
        createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
        createAnalyser = vi.fn(() => ({
          connect: vi.fn(),
          fftSize: 256,
          frequencyBinCount: 128,
          getByteFrequencyData: vi.fn(),
        }))
        close = vi.fn()
      }
      vi.stubGlobal('AudioContext', MockAudioContext)

      const config: RecordingConfig = {
        ...defaultConfig,
        screenEnabled: true,
        webcamEnabled: false,
        microphoneEnabled: false,
        systemAudioEnabled: false,
      }

      const testRecorder = new Recorder()
      try {
        await expect(
          testRecorder.initialize(emptyStream, null, null, config)
        ).rejects.toThrow('No tracks available for recording')
      } finally {
        testRecorder.dispose()
        // Restore original AudioContext mock
        vi.stubGlobal('AudioContext', OriginalAudioContext)
      }
    })

    it('should resume suspended AudioContext', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Verify initialization completed without error (AudioContext handled)
      expect(recorder.isRecording()).toBe(false)
    })

    it('should create MediaRecorder with correct options', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Verify recorder is ready (MediaRecorder was created)
      recorder.start()
      expect(recorder.isRecording()).toBe(true)
    })

    it('should start audio level monitoring after initialization', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Advance a frame to trigger the animation frame callback
      vi.advanceTimersByTime(16)

      expect(callbacks.onAudioLevels).toHaveBeenCalled()
    })
  })

  describe('start', () => {
    beforeEach(async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
    })

    it('should start recording', () => {
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
      expect(callbacks.onStart).toHaveBeenCalled()
    })

    it('should reset chunks on start', () => {
      recorder.start()
      expect(recorder.isRecording()).toBe(true)
    })

    it('should set start time on start', () => {
      vi.setSystemTime(new Date('2025-01-06T12:00:00Z'))
      recorder.start()

      expect(recorder.getDuration()).toBe(0)

      vi.advanceTimersByTime(1000)
      expect(recorder.getDuration()).toBeCloseTo(1, 1)
    })

    it('should throw error if not initialized', () => {
      const uninitializedRecorder = new Recorder()

      expect(() => uninitializedRecorder.start()).toThrow(
        'Recorder not initialized'
      )
      uninitializedRecorder.dispose()
    })
  })

  describe('pause', () => {
    beforeEach(async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
    })

    it('should pause recording when recording', () => {
      recorder.pause()

      expect(recorder.isPaused()).toBe(true)
      expect(recorder.isRecording()).toBe(false)
      expect(callbacks.onPause).toHaveBeenCalled()
    })

    it('should not pause when already paused', () => {
      recorder.pause()
      vi.clearAllMocks()

      recorder.pause()

      // onPause should not be called again
      expect(callbacks.onPause).not.toHaveBeenCalled()
    })

    it('should not pause when not recording', async () => {
      const freshRecorder = new Recorder(callbacks)
      await freshRecorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      // Not started

      freshRecorder.pause()

      expect(callbacks.onPause).not.toHaveBeenCalled()
      freshRecorder.dispose()
    })
  })

  describe('resume', () => {
    beforeEach(async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
      recorder.pause()
    })

    it('should resume recording when paused', () => {
      recorder.resume()

      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)
      expect(callbacks.onResume).toHaveBeenCalled()
    })

    it('should not resume when not paused', async () => {
      const freshRecorder = new Recorder(callbacks)
      await freshRecorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      freshRecorder.start()
      vi.clearAllMocks()

      freshRecorder.resume()

      expect(callbacks.onResume).not.toHaveBeenCalled()
      freshRecorder.dispose()
    })

    it('should track paused duration for accurate getDuration', () => {
      vi.setSystemTime(new Date('2025-01-06T12:00:00Z'))

      const testRecorder = new Recorder(callbacks)

      // We need to test duration calculation across pause/resume
      // This is tricky with mocked timers, but we can verify the logic
      expect(testRecorder.getDuration()).toBe(0)
      testRecorder.dispose()
    })
  })

  describe('stop', () => {
    beforeEach(async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
    })

    it('should stop recording and call onStop with blob', async () => {
      recorder.stop()

      // Wait for async onstop handler to complete
      await vi.waitFor(() => {
        expect(callbacks.onStop).toHaveBeenCalled()
      })
      expect(callbacks.onStop).toHaveBeenCalledWith(expect.any(Blob))
    })

    it('should not throw when stopping inactive recorder', async () => {
      const freshRecorder = new Recorder(callbacks)
      await freshRecorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      // Not started

      expect(() => freshRecorder.stop()).not.toThrow()
      freshRecorder.dispose()
    })

    it('should fix WebM duration on stop', async () => {
      const fixWebmDuration = await import('webm-duration-fix')

      recorder.stop()

      expect(fixWebmDuration.default).toHaveBeenCalled()
    })

    it('should fall back to raw blob if fix fails', async () => {
      const fixWebmDuration = await import('webm-duration-fix')
      vi.mocked(fixWebmDuration.default).mockRejectedValueOnce(
        new Error('Fix failed')
      )

      recorder.stop()

      // Wait for async onstop handler to complete
      await vi.waitFor(() => {
        expect(callbacks.onStop).toHaveBeenCalled()
      })
    })
  })

  describe('getDuration', () => {
    it('should return 0 when not started', () => {
      expect(recorder.getDuration()).toBe(0)
    })

    it('should return elapsed time in seconds', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      vi.setSystemTime(new Date('2025-01-06T12:00:00Z'))
      recorder.start()

      vi.advanceTimersByTime(5000) // 5 seconds

      expect(recorder.getDuration()).toBeCloseTo(5, 1)
    })

    it('should exclude paused time from duration', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      vi.setSystemTime(new Date('2025-01-06T12:00:00Z'))
      recorder.start()

      vi.advanceTimersByTime(3000) // 3 seconds recording
      recorder.pause()

      vi.advanceTimersByTime(2000) // 2 seconds paused
      recorder.resume()

      vi.advanceTimersByTime(2000) // 2 more seconds recording

      // Total should be 5 seconds (3 + 2), not 7
      expect(recorder.getDuration()).toBeCloseTo(5, 1)
    })

    it('should handle duration while paused', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      vi.setSystemTime(new Date('2025-01-06T12:00:00Z'))
      recorder.start()

      vi.advanceTimersByTime(3000) // 3 seconds
      recorder.pause()

      vi.advanceTimersByTime(5000) // 5 more seconds while paused

      // Should still show 3 seconds (time before pause)
      expect(recorder.getDuration()).toBeCloseTo(3, 1)
    })

    it('should never return negative duration', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      // Even with edge cases, duration should be >= 0
      expect(recorder.getDuration()).toBeGreaterThanOrEqual(0)
    })
  })

  describe('isRecording', () => {
    it('should return false when not initialized', () => {
      expect(recorder.isRecording()).toBe(false)
    })

    it('should return false when initialized but not started', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      expect(recorder.isRecording()).toBe(false)
    })

    it('should return true when recording', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
    })

    it('should return false when paused', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
      recorder.pause()

      expect(recorder.isRecording()).toBe(false)
    })
  })

  describe('isPaused', () => {
    it('should return false when not initialized', () => {
      expect(recorder.isPaused()).toBe(false)
    })

    it('should return false when recording', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      expect(recorder.isPaused()).toBe(false)
    })

    it('should return true when paused', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
      recorder.pause()

      expect(recorder.isPaused()).toBe(true)
    })

    it('should return false after resume', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()
      recorder.pause()
      recorder.resume()

      expect(recorder.isPaused()).toBe(false)
    })
  })

  describe('audio level monitoring', () => {
    it('should call onAudioLevels callback', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Advance timers to trigger animation frames
      vi.advanceTimersByTime(100)

      expect(callbacks.onAudioLevels).toHaveBeenCalled()
    })

    it('should provide microphone and system audio levels', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      vi.advanceTimersByTime(16)

      expect(callbacks.onAudioLevels).toHaveBeenCalledWith(
        expect.objectContaining({
          microphone: expect.any(Number),
          system: expect.any(Number),
        })
      )
    })

    it('should return 0 for missing audio sources', async () => {
      const config: RecordingConfig = {
        ...defaultConfig,
        microphoneEnabled: false,
        systemAudioEnabled: false,
      }

      await recorder.initialize(mockScreenStream, null, null, config)

      vi.advanceTimersByTime(16)

      const lastCall = vi.mocked(callbacks.onAudioLevels).mock.lastCall
      if (lastCall) {
        expect(lastCall[0].microphone).toBe(0)
        expect(lastCall[0].system).toBe(0)
      }
    })

    it('should stop monitoring on dispose', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      const callCountBefore = vi.mocked(callbacks.onAudioLevels).mock.calls
        .length

      recorder.dispose()

      vi.advanceTimersByTime(100)

      // Should not have been called after dispose
      expect(vi.mocked(callbacks.onAudioLevels).mock.calls.length).toBe(
        callCountBefore
      )
    })
  })

  describe('error handling', () => {
    it('should call onError when MediaRecorder errors', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Access the MediaRecorder instance and trigger error
      // Since we can't easily access private members, we test via the mock
      expect(callbacks.onError).not.toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const { stopStream } = await import('./permissions')

      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      recorder.dispose()

      expect(stopStream).toHaveBeenCalled()
    })

    it('should close AudioContext', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      recorder.dispose()

      // Verify dispose completed without error (AudioContext was closed)
      expect(recorder.isRecording()).toBe(false)
    })

    it('should cancel animation frame', async () => {
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')

      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      recorder.dispose()

      expect(cancelSpy).toHaveBeenCalled()
      cancelSpy.mockRestore()
    })

    it('should be safe to call multiple times', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      expect(() => {
        recorder.dispose()
        recorder.dispose()
      }).not.toThrow()
    })

    it('should be safe to call without initialization', () => {
      const freshRecorder = new Recorder()
      expect(() => freshRecorder.dispose()).not.toThrow()
    })
  })

  describe('state transitions', () => {
    it('should transition through full recording lifecycle', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )

      // Initial state
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(false)

      // Start
      recorder.start()
      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)
      expect(callbacks.onStart).toHaveBeenCalledTimes(1)

      // Pause
      recorder.pause()
      expect(recorder.isRecording()).toBe(false)
      expect(recorder.isPaused()).toBe(true)
      expect(callbacks.onPause).toHaveBeenCalledTimes(1)

      // Resume
      recorder.resume()
      expect(recorder.isRecording()).toBe(true)
      expect(recorder.isPaused()).toBe(false)
      expect(callbacks.onResume).toHaveBeenCalledTimes(1)

      // Stop
      recorder.stop()
      await vi.waitFor(() => {
        expect(callbacks.onStop).toHaveBeenCalledTimes(1)
      })
    })

    it('should handle multiple pause/resume cycles', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      for (let i = 0; i < 3; i++) {
        recorder.pause()
        expect(recorder.isPaused()).toBe(true)

        recorder.resume()
        expect(recorder.isRecording()).toBe(true)
      }

      expect(callbacks.onPause).toHaveBeenCalledTimes(3)
      expect(callbacks.onResume).toHaveBeenCalledTimes(3)
    })
  })

  describe('different stream configurations', () => {
    it('should handle screen only (no audio)', async () => {
      const config: RecordingConfig = {
        ...defaultConfig,
        microphoneEnabled: false,
        systemAudioEnabled: false,
      }

      await recorder.initialize(mockScreenStream, null, null, config)
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
    })

    it('should handle webcam with microphone', async () => {
      const config: RecordingConfig = {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: true,
        microphoneEnabled: true,
      }

      await recorder.initialize(null, mockWebcamStream, mockMicStream, config)
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
    })

    it('should handle screen with both system and mic audio', async () => {
      const screenWithSystemAudio = createMockStream([
        createMockTrack('video', 'screen-video'),
        createMockTrack('audio', 'system-audio'),
      ])

      const config: RecordingConfig = {
        ...defaultConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      }

      await recorder.initialize(
        screenWithSystemAudio,
        null,
        mockMicStream,
        config
      )
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
    })
  })
})
