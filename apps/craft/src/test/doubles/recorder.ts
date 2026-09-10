// Recording double for the recorder produced by core/recorder-factory.
//
// The real Recorder / WebCodecsRecorder wrap MediaRecorder or WebCodecs, both
// of which jsdom lacks entirely. This double keeps the same surface and the
// same state machine (start → pause → resume → stop, callbacks fired from the
// transitions) so a consumer such as App.tsx can be driven through a whole
// recording without any real media, while every call it made stays inspectable.
import { vi } from 'vitest'
import type { RecordingConfig } from '../../store/types'

export interface RecorderCallbacksLike {
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: (blob: Blob) => void
  onError?: (error: Error) => void
  onAudioLevels?: (levels: { microphone: number; system: number }) => void
}

export interface InitializeCall {
  screen: MediaStream | null
  webcam: MediaStream | null
  mic: MediaStream | null
  config: RecordingConfig
}

export interface RecorderDouble {
  readonly callbacks: RecorderCallbacksLike
  readonly isPiP: boolean
  /** Arguments of every initialize() call, oldest first. */
  readonly initializeCalls: InitializeCall[]
  readonly initialize: ReturnType<typeof vi.fn>
  readonly start: ReturnType<typeof vi.fn>
  readonly pause: ReturnType<typeof vi.fn>
  readonly resume: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  readonly dispose: ReturnType<typeof vi.fn>
  readonly getDuration: ReturnType<typeof vi.fn>
  isRecording(): boolean
  isPaused(): boolean
  /** Blob handed to onStop. */
  stopBlob: Blob
  /** What getDuration() reports. */
  duration: number
  /** When set, the next initialize() rejects with it. */
  initializeError: Error | null
  /** Fire onError as the real recorder does when encoding fails. */
  failWith(error: Error): void
  /** Fire onAudioLevels as the level monitor does. */
  emitAudioLevels(levels: { microphone: number; system: number }): void
}

function createRecorderDouble(callbacks: RecorderCallbacksLike, isPiP: boolean): RecorderDouble {
  let recording = false
  let paused = false

  const double: RecorderDouble = {
    callbacks,
    isPiP,
    initializeCalls: [],
    stopBlob: new Blob(['recorded-bytes'], { type: 'video/webm' }),
    duration: 0,
    initializeError: null,

    initialize: vi.fn(
      async (
        screen: MediaStream | null,
        webcam: MediaStream | null,
        mic: MediaStream | null,
        config: RecordingConfig
      ) => {
        double.initializeCalls.push({ screen, webcam, mic, config })
        if (double.initializeError) throw double.initializeError
      }
    ),

    start: vi.fn(() => {
      if (recording) return
      recording = true
      paused = false
      callbacks.onStart?.()
    }),

    pause: vi.fn(() => {
      if (!recording || paused) return
      paused = true
      callbacks.onPause?.()
    }),

    resume: vi.fn(() => {
      if (!recording || !paused) return
      paused = false
      callbacks.onResume?.()
    }),

    stop: vi.fn(async () => {
      if (!recording) return
      recording = false
      paused = false
      callbacks.onStop?.(double.stopBlob)
    }),

    dispose: vi.fn(() => {
      recording = false
      paused = false
    }),

    getDuration: vi.fn(() => double.duration),

    isRecording: () => recording,
    isPaused: () => paused,

    failWith(error: Error) {
      recording = false
      paused = false
      callbacks.onError?.(error)
    },

    emitAudioLevels(levels) {
      callbacks.onAudioLevels?.(levels)
    },
  }

  return double
}

export interface RecorderFactoryDouble {
  /** Every recorder handed out, oldest first. */
  readonly recorders: RecorderDouble[]
  /** The recorder most recently handed out. Throws if there is none. */
  last(): RecorderDouble
  /** What getRecorderType() reports; also decides the recorder's own label. */
  recorderType: 'webcodecs' | 'mediarecorder'
  readonly createRecorder: ReturnType<typeof vi.fn>
  readonly getRecorderType: ReturnType<typeof vi.fn>
  readonly canUseWebCodecsRecorder: ReturnType<typeof vi.fn>
  reset(): void
}

/**
 * A stand-in for the whole core/recorder-factory module. Pass
 * `factory.module()` from a vi.mock factory, then inspect `factory.last()`.
 */
export function createRecorderFactoryDouble(): RecorderFactoryDouble {
  const recorders: RecorderDouble[] = []

  const factory: RecorderFactoryDouble = {
    recorders,
    recorderType: 'mediarecorder',

    last() {
      const recorder = recorders[recorders.length - 1]
      if (!recorder) throw new Error('createRecorder() has not been called yet')
      return recorder
    },

    createRecorder: vi.fn((callbacks: RecorderCallbacksLike, isPiP: boolean = false) => {
      const recorder = createRecorderDouble(callbacks, isPiP)
      recorders.push(recorder)
      return recorder
    }),

    getRecorderType: vi.fn(() => factory.recorderType),

    canUseWebCodecsRecorder: vi.fn(() => factory.recorderType === 'webcodecs'),

    reset() {
      recorders.length = 0
      factory.recorderType = 'mediarecorder'
      factory.createRecorder.mockClear()
      factory.getRecorderType.mockClear()
      factory.canUseWebCodecsRecorder.mockClear()
    },
  }

  return factory
}
