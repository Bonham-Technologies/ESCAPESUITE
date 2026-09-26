// Recording double for the recorder produced by core/recorder-factory.
//
// The real Recorder / WebCodecsRecorder wrap MediaRecorder or WebCodecs, both
// of which jsdom lacks entirely. This double keeps the same surface and the
// same state machine (start → pause → resume → stop, callbacks fired from the
// transitions) so a consumer such as App.tsx can be driven through a whole
// recording without any real media, while every call it made stays inspectable.
import { vi } from 'vitest'
import type { CompanionPart, RecordingConfig } from '../../store/types'

export interface RecorderCallbacksLike {
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: (blob: Blob, companions?: CompanionPart[] | null) => void
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
  /** Whether the take had a video source at all (false = audio-only). */
  readonly hasVideoSource: boolean
  /** Whether the take records the webcam as its own file. */
  readonly separateTracks: boolean
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
  /** The companions handed to onStop, or null for a single-file take. */
  companionParts: CompanionPart[] | null
  /** What getDuration() reports. */
  duration: number
  /** When set, the next initialize() rejects with it. */
  initializeError: Error | null
  /**
   * When set, initialize() awaits it before resolving — so a test can hold a
   * take's setup open, do something to the component (unmount it, say) and
   * then let the setup finish, the way a real recorder's several awaits let a
   * dispose() land in the middle of one.
   */
  initializeGate: Promise<void> | null
  /** Fire onError as the real recorder does when encoding fails. */
  failWith(error: Error): void
  /** Fire onAudioLevels as the level monitor does. */
  emitAudioLevels(levels: { microphone: number; system: number }): void
}

function createRecorderDouble(
  callbacks: RecorderCallbacksLike,
  isPiP: boolean,
  hasVideoSource: boolean,
  separateTracks: boolean
): RecorderDouble {
  let recording = false
  let paused = false

  const double: RecorderDouble = {
    callbacks,
    isPiP,
    hasVideoSource,
    separateTracks,
    initializeCalls: [],
    stopBlob: new Blob(['recorded-bytes'], { type: 'video/webm' }),
    companionParts: null,
    duration: 0,
    initializeError: null,
    initializeGate: null,

    initialize: vi.fn(
      async (
        screen: MediaStream | null,
        webcam: MediaStream | null,
        mic: MediaStream | null,
        config: RecordingConfig
      ) => {
        double.initializeCalls.push({ screen, webcam, mic, config })
        if (double.initializeGate) await double.initializeGate
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
      callbacks.onStop?.(double.stopBlob, double.companionParts)
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
  /** What getRecorderType() reports for a take that can use WebCodecs. */
  recorderType: 'webcodecs' | 'mediarecorder'
  /**
   * Whether the browser can serve two video pipelines at once.
   *
   * The real gate is `canRecordSeparateTracks()` — WebCodecs *plus*
   * `MediaStreamTrackProcessor` — which is a second, stricter question than
   * `recorderType`: Chrome answers yes to both, and a browser with WebCodecs
   * but no track processor answers yes to the first and no to this one. It
   * defaults to false, as jsdom's own answer is.
   */
  canRecordSeparateTracks: boolean
  /** When set, the next recorder handed out rejects its first initialize(). */
  nextInitializeError: Error | null
  /** When set, the next recorder handed out parks its first initialize() on it. */
  nextInitializeGate: Promise<void> | null
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
    canRecordSeparateTracks: false,
    nextInitializeError: null,
    nextInitializeGate: null,

    last() {
      const recorder = recorders[recorders.length - 1]
      if (!recorder) throw new Error('createRecorder() has not been called yet')
      return recorder
    },

    createRecorder: vi.fn((
      callbacks: RecorderCallbacksLike,
      isPiP: boolean = false,
      hasVideoSource: boolean = true,
      separateTracks: boolean = false
    ) => {
      const recorder = createRecorderDouble(callbacks, isPiP, hasVideoSource, separateTracks)
      recorder.initializeError = factory.nextInitializeError
      factory.nextInitializeError = null
      recorder.initializeGate = factory.nextInitializeGate
      factory.nextInitializeGate = null
      recorders.push(recorder)
      return recorder
    }),

    // Honours its arguments the way the real factory does, so a test can prove
    // that an audio-only or PiP take is labelled 'mediarecorder' — the label
    // useRecordingSave keys the fixWebMMetadata repair off — even on a machine
    // (or in a test) where WebCodecs is otherwise available.
    getRecorderType: vi.fn((
      isPiP: boolean = false,
      hasVideoSource: boolean = true,
      separateTracks: boolean = false
    ) =>
      !hasVideoSource || (isPiP && !separateTracks) ? 'mediarecorder' : factory.recorderType
    ),

    // The real rule, with the two capability questions behind the two knobs: a
    // separate-tracks take asks canRecordSeparateTracks(), everything else asks
    // isWebCodecsRecordingSupported(). Arguments omitted (the single-source
    // default) answer off `recorderType`, exactly as before.
    canUseWebCodecsRecorder: vi.fn((
      isPiP: boolean = false,
      hasVideoSource: boolean = true,
      separateTracks: boolean = false
    ) => {
      if (!hasVideoSource) return false
      if (isPiP && !separateTracks) return false
      return separateTracks ? factory.canRecordSeparateTracks : factory.recorderType === 'webcodecs'
    }),

    reset() {
      recorders.length = 0
      factory.recorderType = 'mediarecorder'
      factory.canRecordSeparateTracks = false
      factory.nextInitializeError = null
      factory.nextInitializeGate = null
      factory.createRecorder.mockClear()
      factory.getRecorderType.mockClear()
      factory.canUseWebCodecsRecorder.mockClear()
    },
  }

  return factory
}
