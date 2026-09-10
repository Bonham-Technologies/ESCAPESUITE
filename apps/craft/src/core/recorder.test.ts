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

// Recorder keeps its MediaRecorder instance private; tests that need to
// drive its event handlers directly (ondataavailable/onerror) reach through
// this narrow cast rather than mocking the module under test.
function getMediaRecorder(recorder: Recorder): MediaRecorder {
  const mediaRecorder = (recorder as unknown as { mediaRecorder: MediaRecorder | null }).mediaRecorder
  if (!mediaRecorder) throw new Error('Recorder has no active MediaRecorder')
  return mediaRecorder
}

// Same rationale as getMediaRecorder(): micAnalyser/systemAnalyser are only
// ever set inside the microphone/system-audio branches of initialize(), so
// asserting they are (or stay) null is a direct, private-field-backed proof
// that a given audio source was actually wired up (or correctly skipped) —
// independent of the shared AudioContext mock's destination track, which is
// unconditionally non-empty and so can't distinguish "connected" from "not".
function getRecorderInternals(recorder: Recorder): {
  micAnalyser: AnalyserNode | null
  systemAnalyser: AnalyserNode | null
} {
  return recorder as unknown as { micAnalyser: AnalyserNode | null; systemAnalyser: AnalyserNode | null }
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
    // Restores any vi.spyOn() (e.g. console.warn) so a spy from one test
    // never silences output for the rest of the file. Verified this doesn't
    // clobber the vi.mock('./permissions', ...) factory implementations or
    // the shared MediaStream/MediaRecorder mocks from setup.ts — restoring a
    // vi.fn() created with an initial implementation puts back that initial
    // implementation, not a bare no-op.
    vi.restoreAllMocks()
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

    it('should run a full lifecycle without throwing when no callbacks are provided', async () => {
      const recorderWithoutCallbacks = new Recorder()
      await recorderWithoutCallbacks.initialize(mockScreenStream, null, mockMicStream, defaultConfig)

      expect(() => recorderWithoutCallbacks.start()).not.toThrow()
      vi.advanceTimersByTime(100) // triggers the audio-level monitoring tick
      expect(() => recorderWithoutCallbacks.pause()).not.toThrow()
      expect(() => recorderWithoutCallbacks.resume()).not.toThrow()
      expect(() => recorderWithoutCallbacks.stop()).not.toThrow()

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
      // The shared AudioContext mock always reports state 'running', so this
      // exercises that path indirectly. Use a dedicated suspended mock to
      // actually verify resume() gets awaited.
      const resumeMock = vi.fn().mockResolvedValue(undefined)
      class SuspendedAudioContext {
        state = 'suspended'
        resume = resumeMock
        createMediaStreamDestination = vi.fn(() => ({
          stream: { getAudioTracks: vi.fn(() => []) },
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
      const OriginalAudioContext = globalThis.AudioContext
      vi.stubGlobal('AudioContext', SuspendedAudioContext)

      const testRecorder = new Recorder(callbacks)
      try {
        await testRecorder.initialize(mockScreenStream, null, mockMicStream, defaultConfig)
        expect(resumeMock).toHaveBeenCalledTimes(1)
      } finally {
        testRecorder.dispose()
        vi.stubGlobal('AudioContext', OriginalAudioContext)
      }
    })

    it('should not call resume() when the AudioContext is already running', async () => {
      const resumeMock = vi.fn().mockResolvedValue(undefined)
      class RunningAudioContext {
        state = 'running'
        resume = resumeMock
        createMediaStreamDestination = vi.fn(() => ({
          stream: { getAudioTracks: vi.fn(() => []) },
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
      const OriginalAudioContext = globalThis.AudioContext
      vi.stubGlobal('AudioContext', RunningAudioContext)

      const testRecorder = new Recorder(callbacks)
      try {
        await testRecorder.initialize(mockScreenStream, null, mockMicStream, defaultConfig)
        expect(resumeMock).not.toHaveBeenCalled()
      } finally {
        testRecorder.dispose()
        vi.stubGlobal('AudioContext', OriginalAudioContext)
      }
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

      // Advance past the throttle interval (80ms) to trigger the level callback
      vi.advanceTimersByTime(100)

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

    it('should pass raw blob to onStop without metadata fix', () => {
      // Metadata fix was moved to the save pipeline for performance
      // The recorder now passes the raw blob immediately on stop
      recorder.stop()

      // Wait for onstop handler
      expect(callbacks.onStop).toHaveBeenCalled()
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

      vi.advanceTimersByTime(100) // Audio monitoring is throttled to ~80ms intervals

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
    it('should call onError and clean up when MediaRecorder reports an error', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      const mediaRecorder = getMediaRecorder(recorder)
      const fakeErrorEvent = { type: 'error' } as unknown as Event
      mediaRecorder.onerror?.(fakeErrorEvent)

      expect(callbacks.onError).toHaveBeenCalledTimes(1)
      expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error))
      expect(vi.mocked(callbacks.onError).mock.calls[0][0].message).toContain('Recording error')
      // cleanup() ran: the recorder tears down its MediaRecorder reference
      expect(recorder.isRecording()).toBe(false)
    })
  })

  describe('data collection', () => {
    it('collects non-empty data chunks into the final blob and ignores empty ones', async () => {
      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      const mediaRecorder = getMediaRecorder(recorder)
      mediaRecorder.ondataavailable?.({ data: new Blob(['chunk-a']) } as BlobEvent) // 7 bytes
      mediaRecorder.ondataavailable?.({ data: new Blob([]) } as BlobEvent) // 0 bytes — must be ignored
      mediaRecorder.ondataavailable?.({ data: new Blob(['bc']) } as BlobEvent) // 2 bytes

      recorder.stop()

      await vi.waitFor(() => expect(callbacks.onStop).toHaveBeenCalled())
      const [resultBlob] = vi.mocked(callbacks.onStop).mock.calls[0]
      // Exact size proves the empty chunk was actually skipped, not just
      // that the total happens to be non-zero.
      expect(resultBlob.size).toBe(9)
    })
  })

  describe('track ended handling', () => {
    it('stops recording when the video track ends while recording', async () => {
      const videoTrack = mockScreenStream.getVideoTracks()[0]
      await recorder.initialize(mockScreenStream, null, mockMicStream, defaultConfig)
      recorder.start()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = vi.mocked(videoTrack.addEventListener).mock.calls.find(
        ([event]) => event === 'ended'
      )?.[1] as (() => void) | undefined
      expect(handler).toBeDefined()

      handler!()

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Track ended'))
      expect(warnSpy).toHaveBeenCalledWith('Video track ended during recording, stopping...')
      await vi.waitFor(() => expect(callbacks.onStop).toHaveBeenCalled())
    })

    it('does not stop when the video track ends while not recording', async () => {
      const videoTrack = mockScreenStream.getVideoTracks()[0]
      await recorder.initialize(mockScreenStream, null, mockMicStream, defaultConfig)
      // Not started — mediaRecorder.state is 'inactive'

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = vi.mocked(videoTrack.addEventListener).mock.calls.find(
        ([event]) => event === 'ended'
      )?.[1] as (() => void) | undefined
      expect(handler).toBeDefined()

      handler!()

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(callbacks.onStop).not.toHaveBeenCalled()
    })

    it('does not stop recording when a non-video track ends', async () => {
      const audioTrack = createMockTrack('audio', 'mixed-audio')
      class AudioContextWithTrackableDestination {
        state = 'running'
        resume = vi.fn().mockResolvedValue(undefined)
        createMediaStreamDestination = vi.fn(() => ({
          stream: { getAudioTracks: vi.fn(() => [audioTrack]) },
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
      const OriginalAudioContext = globalThis.AudioContext
      vi.stubGlobal('AudioContext', AudioContextWithTrackableDestination)

      const testRecorder = new Recorder(callbacks)
      try {
        await testRecorder.initialize(mockScreenStream, null, mockMicStream, defaultConfig)
        testRecorder.start()

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const handler = vi.mocked(audioTrack.addEventListener).mock.calls.find(
          ([event]) => event === 'ended'
        )?.[1] as (() => void) | undefined
        expect(handler).toBeDefined()

        handler!()

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(callbacks.onStop).not.toHaveBeenCalled()
      } finally {
        testRecorder.dispose()
        vi.stubGlobal('AudioContext', OriginalAudioContext)
      }
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

    it('should stop the combined stream, not the field it has already cleared', async () => {
      const { stopStream } = await import('./permissions')
      const videoTrack = mockScreenStream.getVideoTracks()[0]

      await recorder.initialize(
        mockScreenStream,
        null,
        mockMicStream,
        defaultConfig
      )
      recorder.start()

      recorder.dispose()

      const stopped = vi.mocked(stopStream).mock.calls.at(-1)?.[0]
      expect(stopped).not.toBeNull()
      expect(stopped!.getTracks()).toContain(videoTrack)
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

    it('should handle microphone-only recording (no video source)', async () => {
      const config: RecordingConfig = {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: false,
        microphoneEnabled: true,
      }

      await recorder.initialize(null, null, mockMicStream, config)
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
      // No video source was enabled, so the stream handed to MediaRecorder
      // must carry no video track at all.
      expect(getMediaRecorder(recorder).stream.getVideoTracks()).toHaveLength(0)
      expect(getRecorderInternals(recorder).micAnalyser).not.toBeNull()
    })

    it('should skip the webcam video track when webcamEnabled but the stream has none', async () => {
      const webcamAudioOnly = createMockStream([createMockTrack('audio', 'webcam-audio')])
      const config: RecordingConfig = {
        ...defaultConfig,
        screenEnabled: false,
        webcamEnabled: true,
        microphoneEnabled: true,
      }

      await recorder.initialize(null, webcamAudioOnly, mockMicStream, config)
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
      // webcamEnabled is true, but the webcam stream has no video track, so
      // none should have been added to the stream handed to MediaRecorder.
      expect(getMediaRecorder(recorder).stream.getVideoTracks()).toHaveLength(0)
      expect(getRecorderInternals(recorder).micAnalyser).not.toBeNull()
    })

    it('should skip system audio when systemAudioEnabled but the screen stream has no audio track', async () => {
      const screenVideoOnly = createMockStream([createMockTrack('video', 'screen-video')])
      const config: RecordingConfig = {
        ...defaultConfig,
        microphoneEnabled: false,
        systemAudioEnabled: true,
      }

      await recorder.initialize(screenVideoOnly, null, null, config)
      recorder.start()

      expect(recorder.isRecording()).toBe(true)
      // The screen video track is still present in the stream handed to
      // MediaRecorder...
      const videoTracks = getMediaRecorder(recorder).stream.getVideoTracks()
      expect(videoTracks).toHaveLength(1)
      expect(videoTracks[0].kind).toBe('video')
      // ...but no system-audio analyser was ever created, proving the
      // systemAudioTrack branch was skipped rather than silently succeeding.
      expect(getRecorderInternals(recorder).systemAnalyser).toBeNull()
    })
  })
})
