// The take: countdown, tickers, the recorder's six callbacks, and the teardown.
//
// The recorder factory is doubled (MediaRecorder and WebCodecs are both absent
// from jsdom) and analytics delivery with it; everything else the hook does is
// run for real against the real store. The capture side arrives as plain
// functions, because App hands it in from useMediaStreams — which is why the
// teardown is asserted through the mirror ref rather than through a stream.
//
// Only the interval timers are faked, exactly as the App recording suite fakes
// them: the countdown and the duration ticker are the app's own, while
// setTimeout stays real so promise chains still settle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  CAPTURE_TIMEOUT_MS,
  useRecordingController,
  type RecordingController,
  type RecordingControllerDeps,
} from './useRecordingController'
import type { Compositor } from '../core/compositor'
import { useRecorderStore } from '../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../store/types'
import {
  allCapabilities,
  allDetailedCapabilities,
  analyticsModule,
  recorderFactory,
  resetAppDoubles,
} from '../test/appDoubles'
import {
  installCanvasCaptureStreamDouble,
  uninstallCanvasCaptureStreamDouble,
} from '../test/doubles/canvas'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'
import { createStreamDouble, createTrackDouble } from '../test/doubles/mediastream'
import { CAPTURE_UNANSWERED, SEPARATE_TRACK_NOT_SAVED } from '../utils/notices'
// The save path's own expression, not a copy of it: if `resolveHasAudio`
// changed, the agreement table below would change with it.
import { resolveHasAudio, type CapturedTake } from '../utils/recordingMetadata'

/**
 * What `captured` carries beyond `micAcquired`/`separateTracks` for a take
 * started from `defaultConfig` (ESCSUITE-104): System Audio and the webcam
 * both off, and the overlay geometry nobody moved. Spread into a `toEqual`
 * alongside the two audio fields a test actually varies, rather than repeated
 * at every call site.
 */
const CAPTURED_DEFAULTS = {
  systemAudioEnabled: false,
  webcamEnabled: false,
  overlayPlacement: { position: 'bottom-right' as const, size: 0.2, shape: 'circle' as const },
  // `defaultConfig.screenEnabled` is true, so every test that spreads this in
  // without overriding screen/webcam is a take with a picture (ESCSUITE-143).
  hasVideoSource: true,
}

vi.mock('../core/recorder-factory', async () => (await import('../test/appDoubles')).recorderFactoryModule)
vi.mock('@vercel/analytics', async () => (await import('../test/appDoubles')).analyticsModule)

// Storage headroom is a browser fact (navigator.storage), so it is doubled.
// The controller must not touch it on the click path — see the "no await
// before getDisplayMedia" test — so this double is here to prove it is never
// awaited, not to steer a decision.
const { hasSpaceForRecording } = vi.hoisted(() => ({
  hasSpaceForRecording: vi.fn(async () => true),
}))
vi.mock('../core/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/storage')>()),
  hasSpaceForRecording,
}))

interface AcquiredDoubles {
  screen: MediaStream | null
  webcam: MediaStream | null
  mic: MediaStream | null
}

interface Harness {
  deps: RecordingControllerDeps
  /** What acquireStreams hands back — the streams the take is built from. */
  streams: AcquiredDoubles
  acquireStreams: ReturnType<typeof vi.fn>
  stopAllStreams: ReturnType<typeof vi.fn>
  saveRecording: ReturnType<typeof vi.fn>
  setPreviewStream: ReturnType<typeof vi.fn>
  setIsPiPActive: ReturnType<typeof vi.fn>
  refreshStorageSpace: ReturnType<typeof vi.fn>
}

let harness: Harness

function screenStream(): MediaStream {
  return createStreamDouble([createTrackDouble('video', { id: 'screen-video' })])
}

/** A display capture that came back with the system-audio track ticked on. */
function screenStreamWithAudio(): MediaStream {
  return createStreamDouble([
    createTrackDouble('video', { id: 'screen-video' }),
    createTrackDouble('audio', { id: 'screen-audio' }),
  ])
}

function webcamStream(): MediaStream {
  return createStreamDouble([createTrackDouble('video', { id: 'webcam-video' })])
}

/** A microphone capture with a live audio track, as `requestMicrophone` returns. */
function micStreamWithTrack(): MediaStream {
  return createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
}

function resetStore(config: Partial<RecordingConfig> = {}): void {
  useRecorderStore.setState({
    state: 'idle',
    config: { ...defaultConfig, ...config },
    capabilities: allCapabilities(),
    detailedCapabilities: allDetailedCapabilities(),
    recordings: [],
    currentDuration: 0,
    countdownValue: 0,
    audioLevels: { microphone: 0, system: 0 },
    screenStream: null,
    webcamStream: null,
    notice: null,
    systemAudioShared: true,
    hasStorageSpace: true,
  })
}

/** Build the controller's inputs, with the capture side as plain doubles. */
function makeHarness(config: Partial<RecordingConfig> = {}, acquired?: Partial<AcquiredDoubles>): Harness {
  const streams: AcquiredDoubles = { screen: screenStream(), webcam: null, mic: null, ...acquired }
  const acquireStreams = vi.fn(async () => streams)
  const stopAllStreams = vi.fn()
  const saveRecording = vi.fn(async () => {})
  const setPreviewStream = vi.fn()
  const setIsPiPActive = vi.fn()
  const refreshStorageSpace = vi.fn(async () => {})
  const store = useRecorderStore.getState()

  const deps: RecordingControllerDeps = {
    config: { ...defaultConfig, ...config },
    setState: store.setState,
    setCountdown: store.setCountdown,
    setCurrentDuration: store.setCurrentDuration,
    setAudioLevels: store.setAudioLevels,
    setStreams: store.setStreams,
    acquireStreams: acquireStreams as unknown as RecordingControllerDeps['acquireStreams'],
    stopAllStreams,
    stopAllStreamsRef: { current: stopAllStreams },
    compositorRef: { current: null },
    micStreamRef: { current: null },
    previewRef: { current: null },
    setPreviewStream,
    setIsPiPActive,
    recorderTypeRef: { current: 'mediarecorder' },
    capturedThumbnailRef: { current: null },
    saveRecording: saveRecording as unknown as RecordingControllerDeps['saveRecording'],
    setNotice: store.setNotice,
    setSystemAudioShared: store.setSystemAudioShared,
    refreshStorageSpace,
  }

  return {
    deps,
    streams,
    acquireStreams,
    stopAllStreams,
    saveRecording,
    setPreviewStream,
    setIsPiPActive,
    refreshStorageSpace,
  }
}

function mountController(config: Partial<RecordingConfig> = {}, acquired?: Partial<AcquiredDoubles>) {
  resetStore(config)
  harness = makeHarness(config, acquired)
  return renderHook(() => useRecordingController(harness.deps))
}

async function startTake(result: { current: ReturnType<typeof useRecordingController> }): Promise<void> {
  await act(async () => {
    await result.current.handleStartRecording()
  })
}

/** Mount, start with no countdown, and hand back the recorder now running. */
async function startLiveTake() {
  const view = mountController({ countdownSeconds: 0 })
  await startTake(view.result)
  return { ...view, recorder: recorderFactory.last() }
}

function state(): string {
  return useRecorderStore.getState().state
}

/** A preview <video> with intrinsic dimensions, as a playing one has. */
function previewWithFrames(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true })
  return video
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  resetAppDoubles()
  hasSpaceForRecording.mockReset()
  hasSpaceForRecording.mockResolvedValue(true)
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRecordingController the click path', () => {
  // getDisplayMedia needs the click's user activation. Anything awaited
  // between the click and the capture request can spend it — WebKit forwards
  // a gesture across promises only briefly — and the rejection that follows
  // lands in the outer catch, which is exactly the silent failure this work
  // exists to delete. So: nothing is awaited in front of acquireStreams().
  it('reaches the capture request without awaiting the storage estimate', async () => {
    hasSpaceForRecording.mockImplementation(() => new Promise<boolean>(() => {}))
    const { result } = mountController({ countdownSeconds: 0 })

    await startTake(result)

    expect(harness.acquireStreams).toHaveBeenCalledTimes(1)
    expect(state()).toBe('recording')
    expect(hasSpaceForRecording).not.toHaveBeenCalled()
  })

  it('refreshes the storage headroom after a take is saved, not before one starts', async () => {
    const { recorder } = await startLiveTake()

    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob) })

    expect(harness.refreshStorageSpace).toHaveBeenCalledTimes(1)
  })

  it('refreshes it after a save that failed too — the take took no room', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = await startLiveTake()
    harness.saveRecording.mockRejectedValue(new Error('QuotaExceededError'))

    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob) })

    expect(harness.refreshStorageSpace).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
  })

  it('says something when the browser refuses the capture outright', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 0 })
    const refused = new Error('Permission denied')
    refused.name = 'NotAllowedError'
    harness.acquireStreams.mockRejectedValue(refused)

    await startTake(result)

    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error))
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().notice).toBe(
      'The browser refused the capture — nothing was recorded.'
    )
  })

  it('says something when a take fails for any other reason', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 0 })
    harness.acquireStreams.mockRejectedValue(new Error('Camera in use'))

    await startTake(result)

    expect(consoleError).toHaveBeenCalled()
    expect(useRecorderStore.getState().notice).toBe('The recording could not be started.')
  })
})

describe('useRecordingController notices', () => {
  it('reports a save that failed instead of returning to idle as if it had worked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = await startLiveTake()
    // Set after the mount: startLiveTake builds the harness this reaches for.
    harness.saveRecording.mockRejectedValue(new Error('QuotaExceededError'))

    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob) })

    expect(consoleError).toHaveBeenCalledWith('Failed to save recording:', expect.any(Error))
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().notice).toBe(
      'The recording could not be saved — it is not in your library.'
    )
  })

  it('clears the standing notice when the next take starts', async () => {
    useRecorderStore.getState().setNotice('something went wrong last time')
    const { result } = mountController({ countdownSeconds: 0 })

    await startTake(result)

    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('puts the System meter back before it can be seen again', async () => {
    useRecorderStore.getState().setSystemAudioShared(false)
    // System audio off, so nothing recomputes the flag after acquisition: the
    // reset at the start of the take is the only thing that can clear it.
    const { result } = mountController({ countdownSeconds: 0 })

    await startTake(result)

    expect(useRecorderStore.getState().systemAudioShared).toBe(true)
  })
})

describe('useRecordingController system audio', () => {
  it('warns, and greys the meter, when the display capture carried no audio track', async () => {
    const { result } = mountController({ systemAudioEnabled: true, countdownSeconds: 0 })

    await startTake(result)

    expect(state()).toBe('recording')
    expect(useRecorderStore.getState().systemAudioShared).toBe(false)
    expect(useRecorderStore.getState().notice).toBe(
      "System audio was not shared — tick 'Share system audio' in the browser dialog."
    )
  })

  it('says nothing when the audio track did arrive', async () => {
    const { result } = mountController(
      { systemAudioEnabled: true, countdownSeconds: 0 },
      { screen: screenStreamWithAudio() }
    )

    await startTake(result)

    expect(useRecorderStore.getState().systemAudioShared).toBe(true)
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('does not blame the share dialog when there was no display capture at all', async () => {
    const { result } = mountController(
      { screenEnabled: false, webcamEnabled: true, systemAudioEnabled: true, countdownSeconds: 0 },
      { screen: null, webcam: webcamStream() }
    )

    await startTake(result)

    expect(useRecorderStore.getState().systemAudioShared).toBe(false)
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('leaves the meter live for a take with system audio switched off', async () => {
    const { result } = mountController({ countdownSeconds: 0 })

    await startTake(result)

    expect(useRecorderStore.getState().systemAudioShared).toBe(true)
  })
})

describe('useRecordingController starting a take', () => {
  it('acquires, previews and initializes a screen-only take, then starts it', async () => {
    const { result } = mountController({ countdownSeconds: 0 })

    await startTake(result)

    expect(harness.acquireStreams).toHaveBeenCalledTimes(1)
    expect(useRecorderStore.getState().screenStream).toBe(harness.streams.screen)
    expect(harness.setPreviewStream).toHaveBeenCalledWith(harness.streams.screen)
    expect(harness.setIsPiPActive).not.toHaveBeenCalled()
    expect(recorderFactory.createRecorder).toHaveBeenCalledWith(expect.any(Object), false, true, false)
    expect(recorderFactory.last().start).toHaveBeenCalledTimes(1)
    expect(state()).toBe('recording')
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Started', undefined)
    expect(harness.deps.recorderTypeRef.current).toBe('mediarecorder')
  })

  it('previews a webcam-only take from the webcam stream', async () => {
    const webcam = webcamStream()
    const { result } = mountController({ screenEnabled: false, webcamEnabled: true, countdownSeconds: 0 }, { screen: null, webcam })

    await startTake(result)

    expect(harness.setPreviewStream).toHaveBeenCalledWith(webcam)
    expect(recorderFactory.last().initializeCalls[0]).toMatchObject({ screen: null, webcam })
  })

  it('records an audio-only take through the MediaRecorder path', async () => {
    // Both video sources off is a shape SourceToggles allows. The WebCodecs
    // recorder has no video track to encode and would throw, so the factory
    // must be told there is no video source and hand back a MediaRecorder.
    const mic = createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
    const { result } = mountController(
      { screenEnabled: false, webcamEnabled: false, microphoneEnabled: true, countdownSeconds: 0 },
      { screen: null, webcam: null, mic }
    )
    recorderFactory.recorderType = 'webcodecs'

    await startTake(result)

    expect(recorderFactory.createRecorder).toHaveBeenCalledWith(expect.any(Object), false, false, false)
    expect(recorderFactory.last().hasVideoSource).toBe(false)
    // The label useRecordingSave keys the WebM metadata repair off: a
    // MediaRecorder take needs it even on a WebCodecs-capable machine.
    expect(harness.deps.recorderTypeRef.current).toBe('mediarecorder')
    expect(recorderFactory.last().initializeCalls[0]).toMatchObject({ screen: null, webcam: null, mic })
    expect(harness.setPreviewStream).not.toHaveBeenCalled()
    expect(state()).toBe('recording')
  })

  it('holds the microphone stream in the ref the release path reads', async () => {
    const mic = createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
    const { result } = mountController({ countdownSeconds: 0 }, { mic })

    await startTake(result)

    expect(harness.deps.micStreamRef.current).toBe(mic)
  })

  it('disposes the recorder when the take fails to initialize', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 0 })
    // A take with every source switched off reaches the MediaRecorder path,
    // which builds its AudioContext before discovering it has no tracks. The
    // failed attempt has to hand that back like any other exit.
    recorderFactory.nextInitializeError = new Error('No tracks available for recording')

    await startTake(result)

    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error))
    expect(recorderFactory.last().dispose).toHaveBeenCalledTimes(1)
    expect(state()).toBe('idle')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
  })

  it('reports a refused capture and goes back to idle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 0 })
    harness.acquireStreams.mockRejectedValue(new Error('Permission denied'))

    await startTake(result)

    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error))
    expect(state()).toBe('idle')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(recorderFactory.createRecorder).not.toHaveBeenCalled()
  })

  it('takes a fresh start after one that failed', async () => {
    // A failure is not a latch either. The attempt's gate is dropped in the
    // `finally`, which the failing path runs through as well, so the click that
    // answers the notice is a take and not a no-op.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 3 })
    harness.acquireStreams.mockRejectedValueOnce(new Error('Camera in use'))

    await startTake(result)
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().notice).not.toBeNull()
    expect(recorderFactory.recorders).toHaveLength(0)

    await startTake(result)

    expect(recorderFactory.recorders).toHaveLength(1)
    expect(state()).toBe('countdown')
    // ...and the next take clears what the last one had to report.
    expect(useRecorderStore.getState().notice).toBeNull()
    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error))
  })
})

describe('useRecordingController countdown', () => {
  it('counts down one second at a time and starts the recorder at zero', async () => {
    const { result } = mountController({ countdownSeconds: 3 })

    await startTake(result)

    expect(state()).toBe('countdown')
    expect(useRecorderStore.getState().countdownValue).toBe(3)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(useRecorderStore.getState().countdownValue).toBe(2)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(useRecorderStore.getState().countdownValue).toBe(1)
    expect(recorderFactory.last().start).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(recorderFactory.last().start).toHaveBeenCalledTimes(1)
    expect(state()).toBe('recording')
  })

  it('drops the countdown and releases the capture when it is cancelled', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    await startTake(result)
    const recorder = recorderFactory.last()

    act(() => { result.current.cancelCountdown() })

    expect(state()).toBe('idle')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    // The recorder is already initialize()d by the time the countdown starts —
    // AudioContext, level monitor and, on the fallback path, a <video>. Esc has
    // to hand all of that back, or six cancelled takes exhaust the AudioContexts.
    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(recorderFactory.last().start).not.toHaveBeenCalled()
  })

  it('abandons the countdown when the capture dies before the take starts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 3 })
    await startTake(result)
    const recorder = recorderFactory.last()

    // The user stops sharing while the countdown is on screen. The recorder
    // reports it on the only channel it has — onError.
    act(() => { recorder.failWith(new Error('Capture ended before recording started')) })

    expect(consoleError).toHaveBeenCalledWith('Recording error:', expect.any(Error))
    expect(state()).toBe('idle')
    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    // The ticker must be gone too, or it reaches zero and starts a take with
    // no source behind it.
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no countdown to cancel', () => {
    const { result } = mountController({ countdownSeconds: 0 })

    act(() => { result.current.cancelCountdown() })

    expect(state()).toBe('idle')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
  })
})

describe('useRecordingController running a take', () => {
  it('ticks the elapsed time from the recorder every tenth of a second', async () => {
    const { recorder } = await startLiveTake()

    recorder.duration = 1.2
    act(() => { vi.advanceTimersByTime(100) })
    expect(useRecorderStore.getState().currentDuration).toBe(1.2)

    recorder.duration = 62
    act(() => { vi.advanceTimersByTime(100) })
    expect(useRecorderStore.getState().currentDuration).toBe(62)
  })

  it('pauses and resumes through the recorder', async () => {
    const { result, recorder } = await startLiveTake()

    act(() => { result.current.handlePauseRecording() })
    expect(recorder.pause).toHaveBeenCalledTimes(1)
    expect(state()).toBe('paused')

    act(() => { result.current.handleResumeRecording() })
    expect(recorder.resume).toHaveBeenCalledTimes(1)
    expect(state()).toBe('recording')
  })

  it('does nothing on pause, resume or stop when no recorder was ever made', async () => {
    const { result } = mountController({ countdownSeconds: 0 })

    act(() => {
      result.current.handlePauseRecording()
      result.current.handleResumeRecording()
    })
    await act(async () => { await result.current.handleStopRecording() })

    expect(recorderFactory.recorders).toHaveLength(0)
    expect(state()).toBe('idle')
  })

  it('stops the elapsed-time ticker when the recorder stops on its own', async () => {
    const { recorder } = await startLiveTake()
    recorder.duration = 9
    act(() => { vi.advanceTimersByTime(100) })
    expect(vi.getTimerCount()).toBe(1)

    // The capture died and the recorder finished the take itself — nobody went
    // through handleStopRecording, so nothing else clears the ticker.
    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob) })

    // The MediaRecorder path calls onStop with the blob alone, so the save gets
    // no companion argument at all — which it reads as a single-part take.
    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 9, undefined, {
      micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS,
    })
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('feeds the audio meters straight through to the store', async () => {
    const { recorder } = await startLiveTake()

    act(() => { recorder.emitAudioLevels({ microphone: 0.4, system: 0 }) })

    expect(useRecorderStore.getState().audioLevels).toEqual({ microphone: 0.4, system: 0 })
  })

  it('surfaces a recorder failure and releases the capture', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = await startLiveTake()

    act(() => { recorder.failWith(new Error('encoder died')) })

    expect(consoleError).toHaveBeenCalledWith('Recording error:', expect.any(Error))
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
  })
})

describe('useRecordingController stopping a take', () => {
  async function startLiveTake(preview?: HTMLVideoElement) {
    const view = mountController({ countdownSeconds: 0 })
    harness.deps.previewRef.current = preview ?? null
    await startTake(view.result)
    return { ...view, recorder: recorderFactory.last() }
  }

  it('grabs a thumbnail off the live preview, stops, saves and returns to idle', async () => {
    const { result, recorder } = await startLiveTake(previewWithFrames())
    recorder.duration = 8

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.deps.capturedThumbnailRef.current).toBeInstanceOf(Blob)
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Completed', { duration: 8 })
    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 8, null, {
      micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS,
    })
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(state()).toBe('idle')
  })

  it('grabs the thumbnail off the compositor canvas when one is running', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const { result, recorder } = await startLiveTake(previewWithFrames())
    harness.deps.compositorRef.current = { getCanvas: () => canvas } as unknown as Compositor
    recorder.duration = 5

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.deps.capturedThumbnailRef.current).toBeInstanceOf(Blob)
  })

  it('falls back to the file when the compositor has drawn nothing yet', async () => {
    const blank = document.createElement('canvas')
    blank.width = 0
    const { result, recorder } = await startLiveTake()
    harness.deps.compositorRef.current = { getCanvas: () => blank } as unknown as Compositor
    recorder.duration = 5

    await act(async () => { await result.current.handleStopRecording() })

    // No preview element either, so there is nothing to grab: the save decodes
    // its own thumbnail from the blob instead.
    expect(harness.deps.capturedThumbnailRef.current).toBeNull()
  })

  it('falls through to the preview element when the compositor frame cannot be drawn', async () => {
    // A tainted compositor canvas throws on drawImage; the video element is
    // the fallback, and it still has frames.
    const tainted = document.createElement('canvas')
    tainted.width = 1280
    const realGetContext = HTMLCanvasElement.prototype.getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      const ctx = (realGetContext as (...a: unknown[]) => unknown).apply(this, args) as CanvasRenderingContext2D | null
      if (!ctx) return ctx
      return new Proxy(ctx, {
        get(target, property, receiver) {
          if (property === 'drawImage') {
            return (source: CanvasImageSource, ...rest: number[]) => {
              if (source instanceof HTMLCanvasElement) throw new Error('SecurityError: tainted canvas')
              return target.drawImage(source, ...(rest as [number, number, number, number]))
            }
          }
          return Reflect.get(target, property, receiver)
        },
      })
    } as unknown as typeof HTMLCanvasElement.prototype.getContext)

    const { result } = await startLiveTake(previewWithFrames())
    harness.deps.compositorRef.current = { getCanvas: () => tainted } as unknown as Compositor

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.deps.capturedThumbnailRef.current).toBeInstanceOf(Blob)
  })

  it('captures nothing when the preview never produced a frame', async () => {
    const blank = document.createElement('video')
    Object.defineProperty(blank, 'videoWidth', { value: 0, configurable: true })
    const { result } = await startLiveTake(blank)

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.deps.capturedThumbnailRef.current).toBeNull()
  })

  it('captures nothing when the frame cannot be drawn', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { result } = await startLiveTake(previewWithFrames())

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.deps.capturedThumbnailRef.current).toBeNull()
  })

  it('falls back to the ticked duration when the recorder has forgotten it', async () => {
    const { result, recorder } = await startLiveTake()
    recorder.duration = 42
    act(() => { vi.advanceTimersByTime(100) })
    recorder.duration = 0

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 42, null, {
      micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS,
    })
  })

  it('reports a save that failed and still returns to idle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, recorder } = await startLiveTake()
    recorder.duration = 4
    harness.saveRecording.mockRejectedValue(new Error('quota exceeded'))

    await act(async () => { await result.current.handleStopRecording() })

    expect(consoleError).toHaveBeenCalledWith('Failed to save recording:', expect.any(Error))
    expect(state()).toBe('idle')
  })
})

// ESCSUITE-114. Neither recorder's monitor ever emits a zero on its own (a
// take with nothing to measure sends one hard-coded {0, 0} at start and then
// stops, and a take that IS measuring something just keeps emitting whatever
// it last read) — so without a write here, the store keeps a finished take's
// last level forever, and the next take's meter — SourceToggles' `showMeters`
// gate makes it visible for 'countdown', 'recording' and 'paused' — opens on
// a stale, frozen bar instead of a silent one.
describe('useRecordingController audio levels', () => {
  function levels(): { microphone: number; system: number } {
    return useRecorderStore.getState().audioLevels
  }

  it('reports the levels the recorder emits while the take is live', async () => {
    const { recorder } = await startLiveTake()

    act(() => { recorder.emitAudioLevels({ microphone: 0.6, system: 0.2 }) })

    expect(levels()).toEqual({ microphone: 0.6, system: 0.2 })
  })

  it('zeroes the levels once the take stops, whether the stop was asked for or the recorder finished on its own', async () => {
    const { result, recorder } = await startLiveTake()
    act(() => { recorder.emitAudioLevels({ microphone: 0.6, system: 0.2 }) })
    expect(levels()).toEqual({ microphone: 0.6, system: 0.2 })

    await act(async () => { await result.current.handleStopRecording() })

    expect(levels()).toEqual({ microphone: 0, system: 0 })
  })

  it('zeroes the levels for a stop the recorder fires on its own, not through handleStopRecording', async () => {
    // The video track ending mid-take is exactly this: the recorder calls its
    // own stop() and fires onStop without anyone having gone through
    // handleStopRecording, so a write placed there alone would miss it.
    const { recorder } = await startLiveTake()
    act(() => { recorder.emitAudioLevels({ microphone: 0.6, system: 0.2 }) })

    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob) })

    expect(levels()).toEqual({ microphone: 0, system: 0 })
  })

  it('leaves nothing stale for the next take to show the moment its countdown opens', async () => {
    const { result, recorder } = await startLiveTake()
    act(() => { recorder.emitAudioLevels({ microphone: 0.9, system: 0.7 }) })
    await act(async () => { await result.current.handleStopRecording() })
    expect(levels()).toEqual({ microphone: 0, system: 0 })

    // Start the next take with a countdown this time. `'preparing'` is not
    // the state that would show a stale bar — `showMeters` (App.tsx) is false
    // there — `'countdown'` is: the recorder is already initialize()d, its
    // monitor already running, and the meter already visible, all before the
    // countdown's own first reading arrives.
    harness.deps.config.countdownSeconds = 3
    await startTake(result)

    expect(state()).toBe('countdown')
    expect(levels()).toEqual({ microphone: 0, system: 0 })
  })

  // `dispose()` — what both cancel paths and the unmount teardown call
  // instead of `stop()` — cancels the monitor's rAF loop without emitting,
  // so `onStop` never fires for a cancelled take and a write placed only
  // there would never run. Cancel raises `cancelledRef` and disposes the
  // recorder synchronously, so there is no `onStop` to observe here either;
  // each of these mirrors the *other* two paths' own "throws the take away,
  // disposes the recorder" tests, adding only the levels assertion.
  it('zeroes the levels when a live take is cancelled', async () => {
    const { result, recorder } = await startLiveTake()
    act(() => { recorder.emitAudioLevels({ microphone: 0.5, system: 0.4 }) })
    expect(levels()).toEqual({ microphone: 0.5, system: 0.4 })

    act(() => { result.current.handleCancelRecording() })

    expect(levels()).toEqual({ microphone: 0, system: 0 })
  })

  it('zeroes the levels when a countdown is cancelled', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    await startTake(result)
    const recorder = recorderFactory.last()
    act(() => { recorder.emitAudioLevels({ microphone: 0.5, system: 0.4 }) })
    expect(levels()).toEqual({ microphone: 0.5, system: 0.4 })

    act(() => { result.current.cancelCountdown() })

    expect(levels()).toEqual({ microphone: 0, system: 0 })
  })
})

describe('useRecordingController cancelling a take', () => {
  it('throws the take away, disposes the recorder and stops the ticker', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    await startTake(result)
    const recorder = recorderFactory.last()
    recorder.duration = 12
    act(() => { vi.advanceTimersByTime(100) })

    act(() => { result.current.handleCancelRecording() })

    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(recorder.stop).not.toHaveBeenCalled()
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops a chunk that arrives after the take was thrown away', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    await startTake(result)
    const recorder = recorderFactory.last()

    act(() => { result.current.handleCancelRecording() })

    // A recorder that had already flushed its last chunk calls back after
    // dispose(). Nothing may be saved.
    await act(async () => {
      recorder.callbacks.onStop?.(recorder.stopBlob)
    })

    expect(harness.saveRecording).not.toHaveBeenCalled()
    expect(state()).toBe('idle')
  })
})

// ESCSUITE-118. The recorder's callbacks used to act on whatever the refs held
// when they fired, not on the recorder they were created for: a late onStop or
// onError from take A, arriving after A was cancelled and disposed and take B
// is already live, tore down or saved over B instead of being ignored. Each
// callback now closes over the exact instance it was built for (`me`) and
// returns early once `recorderRef.current` has moved on — see the `me` comment
// above the createRecorder call.
describe('useRecordingController callback identity (ESCSUITE-118)', () => {
  /** Cancel take A and start take B through to 'recording'. Hands back both recorders. */
  async function cancelThenStartAnother(result: { current: RecordingController }) {
    await startTake(result)
    const a = recorderFactory.last()
    act(() => { result.current.handleCancelRecording() })
    expect(a.dispose).toHaveBeenCalledTimes(1)

    await startTake(result)
    const b = recorderFactory.last()
    expect(b).not.toBe(a)
    return { a, b }
  }

  it("a late onError from a disposed recorder leaves the live take alone", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountController({ countdownSeconds: 0 })
    const { a, b } = await cancelThenStartAnother(result)
    b.duration = 7
    const stopAllStreamsCalls = harness.stopAllStreams.mock.calls.length

    act(() => { a.callbacks.onError?.(new Error('late')) })

    // The console still hears about it — that part of onError runs before the
    // identity guard — but nothing that belongs to B is touched.
    expect(consoleError).toHaveBeenCalledWith('Recording error:', expect.any(Error))
    expect(b.dispose).not.toHaveBeenCalled()
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(stopAllStreamsCalls)
    expect(state()).toBe('recording')

    act(() => { vi.advanceTimersByTime(100) })
    expect(useRecorderStore.getState().currentDuration).toBe(7)
  })

  it('a late onStop from a disposed recorder saves nothing', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    const { a, b } = await cancelThenStartAnother(result)
    const stopAllStreamsCalls = harness.stopAllStreams.mock.calls.length

    await act(async () => { a.callbacks.onStop?.(a.stopBlob, []) })

    expect(harness.saveRecording).not.toHaveBeenCalled()
    expect(state()).toBe('recording')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(stopAllStreamsCalls)
    // B's own recorder is untouched — the late stop was A's alone.
    expect(b.stop).not.toHaveBeenCalled()
    expect(b.dispose).not.toHaveBeenCalled()
  })

  // The existing behaviour, pinned so the identity guard above cannot be
  // inverted: a recorder's own failure still tears its own take down. See
  // 'useRecordingController running a take' > 'surfaces a recorder failure and
  // releases the capture' for the fuller assertion (console, state, streams);
  // this one also checks dispose, which that test does not.
  it("a live recorder's own onError still tears it down", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = await startLiveTake()

    act(() => { recorder.failWith(new Error('encoder died')) })

    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(state()).toBe('idle')
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
  })

  it('a stale onStart does not start a second ticker', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    const { a } = await cancelThenStartAnother(result)

    expect(vi.getTimerCount()).toBe(1)

    act(() => { a.callbacks.onStart?.() })

    expect(vi.getTimerCount()).toBe(1)
    expect(state()).toBe('recording')
  })

  it('a stale onPause does not pause the live take', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    const { a } = await cancelThenStartAnother(result)
    expect(state()).toBe('recording')

    act(() => { a.callbacks.onPause?.() })

    expect(state()).toBe('recording')
  })

  it('a stale onResume does not resume over the live pause', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    const { a, b } = await cancelThenStartAnother(result)

    act(() => { result.current.handlePauseRecording() })
    expect(state()).toBe('paused')
    expect(b.pause).toHaveBeenCalledTimes(1)

    act(() => { a.callbacks.onResume?.() })

    expect(state()).toBe('paused')
  })

  // ESCSUITE-118 fix round 1. The identity guard also catches a recorder whose
  // OWN onError disposed it and nulled the ref — nothing raises cancelledRef on
  // that path, so the old onStop guard alone would not have stopped this.
  // MediaRecorder can call onstop with whatever it had recorded after an
  // onerror (core/recorder.ts), so a take reported as failed used to be saved
  // anyway. Dropping it is correct: the user was already told the take failed.
  it("a recorder's own late onStop, after its own onError disposed it, saves nothing", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = await startLiveTake()

    act(() => { recorder.failWith(new Error('encoder died')) })
    expect(state()).toBe('idle')

    await act(async () => { recorder.callbacks.onStop?.(recorder.stopBlob, []) })

    expect(harness.saveRecording).not.toHaveBeenCalled()
    expect(state()).toBe('idle')
  })
})

describe('useRecordingController picture-in-picture', () => {
  let raf: RafDouble

  beforeEach(() => {
    installCanvasCaptureStreamDouble()
    raf = installRafDouble()
    // The compositor mirrors each source into a <video>; jsdom implements no
    // media playback and logs "not implemented" for every play() call.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    raf.uninstall()
    uninstallCanvasCaptureStreamDouble()
  })

  it('composites screen and webcam, and records the composited stream', async () => {
    const screen = createStreamDouble([
      createTrackDouble('video', { id: 'screen-video', settings: { width: 1920, height: 1080 } }),
      createTrackDouble('audio', { id: 'screen-audio' }),
    ])
    const webcam = webcamStream()
    const { result } = mountController(
      { screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 },
      { screen, webcam }
    )

    await startTake(result)

    const compositor = harness.deps.compositorRef.current!
    expect(compositor).toBeTruthy()
    expect(compositor.getCanvas().width).toBe(1280)
    expect(harness.setIsPiPActive).toHaveBeenCalledWith(true)
    expect(recorderFactory.createRecorder).toHaveBeenCalledWith(
      expect.any(Object),
      true,
      true,
      false
    )

    // The recorder gets the composited video plus the screen's own audio.
    const initialized = recorderFactory.last().initializeCalls[0]
    expect(initialized.screen).not.toBe(screen)
    expect(initialized.screen!.getVideoTracks()[0].id).toBe('canvas-video-track')
    expect(initialized.screen!.getAudioTracks()).toEqual(screen.getAudioTracks())

    act(() => { result.current.handleCancelRecording() })
    compositor.dispose()
  })

  it('falls back to 1080p when the screen track reports no dimensions', async () => {
    const screen = createStreamDouble([createTrackDouble('video', { id: 'screen-video', settings: {} })])
    const { result } = mountController(
      { screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 },
      { screen, webcam: webcamStream() }
    )

    await startTake(result)

    const compositor = harness.deps.compositorRef.current!
    expect(compositor.getCanvas().width).toBe(1280)
    expect(compositor.getCanvas().height).toBe(720)

    act(() => { result.current.handleCancelRecording() })
    compositor.dispose()
  })
})

// ESCSUITE-70. The save path used to answer "did this take capture audio?"
// from the config, which only says what was *asked* for. The controller is the
// layer that knows what arrived, so it resolves the microphone half once, when
// the take starts, and hands it over with the blob.
describe('useRecordingController what the take captured', () => {
  /**
   * Run a take to its save, and hand back the fourth argument whole — so a
   * field added to what the take carries (ESCSUITE-68's `separateTracks`) shows
   * up here rather than being silently ignored by a narrower assertion.
   */
  async function capturedAudioOf(
    config: Partial<RecordingConfig>,
    acquired?: Partial<AcquiredDoubles>
  ): Promise<CapturedTake> {
    const { result } = mountController({ countdownSeconds: 0, ...config }, acquired)
    await startTake(result)
    const recorder = recorderFactory.last()

    await act(async () => { await result.current.handleStopRecording() })

    const [, , , captured] = harness.saveRecording.mock.calls[0] as [
      Blob, number, unknown, CapturedTake,
    ]
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    return captured
  }

  it('says a microphone was captured when one really was acquired', async () => {
    expect(
      await capturedAudioOf({ microphoneEnabled: true }, { mic: micStreamWithTrack() })
    ).toEqual({ micAcquired: true, separateTracks: false, ...CAPTURED_DEFAULTS })
  })

  // The toggle is on and the machine has no microphone, so `acquireStreams`
  // came back without one. Nothing recorded a microphone, and the stored
  // recording must not claim it did.
  it('says none when the microphone the toggle asked for never arrived', async () => {
    expect(await capturedAudioOf({ microphoneEnabled: true }, { mic: null })).toEqual({
      micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS,
    })
  })

  // The same pair the recorder asks when it wires the mix: a stream is not a
  // track. A capture that came back with its audio track already gone records
  // nothing either.
  it('says none for a microphone stream with no track in it', async () => {
    expect(
      await capturedAudioOf({ microphoneEnabled: true }, { mic: createStreamDouble([]) })
    ).toEqual({ micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS })
  })

  it('says none when the microphone was never asked for', async () => {
    expect(
      await capturedAudioOf({ microphoneEnabled: false }, { mic: micStreamWithTrack() })
    ).toEqual({ micAcquired: false, separateTracks: false, ...CAPTURED_DEFAULTS })
  })

  // ESCSUITE-143. Screen and webcam both off is the one shape that leaves the
  // take with no picture at all — the save path's own `hasVideoSource` is what
  // tells `buildSourceVideo` to store it the way an audio companion already is
  // rather than inventing a 1920x1080 frame rate for a file that has none.
  it('says there is no video source for a take with both video sources off', async () => {
    expect(
      await capturedAudioOf(
        { screenEnabled: false, webcamEnabled: false, microphoneEnabled: true },
        { screen: null, webcam: null, mic: micStreamWithTrack() }
      )
    ).toEqual({
      micAcquired: true,
      separateTracks: false,
      ...CAPTURED_DEFAULTS,
      hasVideoSource: false,
    })
  })
})

describe('a separate-tracks take', () => {
  let raf: RafDouble

  beforeEach(() => {
    installCanvasCaptureStreamDouble()
    raf = installRafDouble()
    // The compositor mirrors each source into a <video>; jsdom implements no
    // media playback and logs "not implemented" for every play() call.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    harness.deps.compositorRef.current?.dispose()
    raf.uninstall()
    uninstallCanvasCaptureStreamDouble()
  })

  /** The take the toggle asks for: screen + webcam, separateTracks on. */
  function separateHarness(extra: Partial<RecordingConfig> = {}): Harness {
    // A browser that can serve two pipelines: WebCodecs (recorderType) *and*
    // MediaStreamTrackProcessor (canRecordSeparateTracks), which is the
    // stricter of the two questions the real factory asks.
    recorderFactory.recorderType = 'webcodecs'
    recorderFactory.canRecordSeparateTracks = true
    return makeHarness(
      { screenEnabled: true, webcamEnabled: true, separateTracks: true, ...extra },
      { screen: screenStreamWithAudio(), webcam: webcamStream() }
    )
  }

  it('hands the recorder the raw screen and webcam tracks', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    const recorder = recorderFactory.last()
    expect(recorder.separateTracks).toBe(true)
    const [call] = recorder.initializeCalls
    // The raw display capture, not the compositor's canvas track: the whole
    // point of the mode is that the webcam is never drawn into the recording.
    expect(call.screen).toBe(harness.streams.screen)
    expect(call.webcam).toBe(harness.streams.webcam)
    expect(call.config.separateTracks).toBe(true)
  })

  it('runs the compositor for the preview only', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    // The canvas is still the preview (useMediaStreams appends it), so PiP is
    // still "active" — but nothing captures a stream off it.
    expect(harness.setIsPiPActive).toHaveBeenCalledWith(true)
    expect(harness.deps.compositorRef.current!.getOutputStream()).toBeNull()
    expect(harness.setPreviewStream).toHaveBeenCalledWith(harness.streams.screen)
  })

  it('labels the take webcodecs, so the save path repairs nothing', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    expect(harness.deps.recorderTypeRef.current).toBe('webcodecs')
  })

  it('passes the companion through to the save', async () => {
    // No countdown, so the take is running the moment the click returns.
    harness = separateHarness({ countdownSeconds: 0 })
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    expect(recorder.isRecording()).toBe(true)
    recorder.companionParts = [{
      role: 'webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      startOffset: 0,
    }]

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      recorder.companionParts,
      { micAcquired: false, separateTracks: true, ...CAPTURED_DEFAULTS, webcamEnabled: true }
    )
  })

  // Three of the four ways the camera half can be lost happen *inside* the
  // recorder — no frame was encoded, the pipeline gave up, `finalize()` threw —
  // and all three are delivered as `companion: null`, which the save hook
  // cannot tell from "this take never asked for one". The controller is the one
  // layer that still knows the mode the take was resolved on, so it is what
  // says so; the save hook keeps saying the same sentence for a companion lost
  // in storage.
  it('says the webcam track was lost when the recorder delivers no companion', async () => {
    harness = separateHarness({ countdownSeconds: 0 })
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    // The double's default, and what finalizeCompanion() returns for all three
    // of the recorder-side losses.
    expect(recorder.companionParts).toBeNull()

    await act(async () => { await result.current.handleStopRecording() })

    // Once, and not as a side effect of the start-of-take clear.
    expect(
      setNotice.mock.calls.filter(([notice]) => notice === SEPARATE_TRACK_NOT_SAVED)
    ).toHaveLength(1)
    expect(useRecorderStore.getState().notice).toBe(SEPARATE_TRACK_NOT_SAVED)
    // ...and the screen recording is still saved, exactly as it is today.
    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      null,
      { micAcquired: false, separateTracks: true, ...CAPTURED_DEFAULTS, webcamEnabled: true }
    )
  })

  // ESCSUITE-68 / ESCSUITE-104. The mode — and, since ESCSUITE-104, System
  // Audio, the webcam toggle and the overlay geometry — is resolved once,
  // before the countdown, and handed to everything that has to agree about it:
  // the save path could previously only *infer* the mode, from the companions
  // that happened to arrive, and read the other three straight off live
  // `config`. This pins the fact travelling: the settings panels are disabled
  // for as long as the take is live, but the store behind them is not, and the
  // take must be saved the way it was started rather than the way the sidebar
  // reads when it ends — or the way it reads later still, while the save is
  // awaiting its container repair, its metadata probe, its thumbnail decode
  // and its two IndexedDB writes.
  it('saves the take as it was started when the mode is switched off mid-take', async () => {
    harness = separateHarness({ countdownSeconds: 0 })
    const { result, rerender } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    expect(recorder.separateTracks).toBe(true)

    // The take is running and every one of the four settings moves under it.
    harness.deps = {
      ...harness.deps,
      config: {
        ...harness.deps.config,
        separateTracks: false,
        systemAudioEnabled: true,
        webcamEnabled: false,
        webcamPosition: 'top-left',
        webcamSize: 0.4,
        webcamShape: 'rectangle',
      },
    }
    rerender()

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      null,
      // Every field is the take's own, from before the setting moved — none of
      // the four mutations above show up here.
      { micAcquired: false, separateTracks: true, ...CAPTURED_DEFAULTS, webcamEnabled: true }
    )
  })

  it('says nothing when a composited take delivers no companion', async () => {
    harness = separateHarness({ countdownSeconds: 0 })
    // The mode was refused before the countdown, so this is an ordinary
    // composited take: a null companion there means there never was one, and
    // the user asked for nothing that could have been lost.
    recorderFactory.canRecordSeparateTracks = false
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })

    await act(async () => { await result.current.handleStopRecording() })

    expect(setNotice).not.toHaveBeenCalledWith(SEPARATE_TRACK_NOT_SAVED)
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('composites into MediaRecorder when the browser cannot serve two tracks', async () => {
    harness = separateHarness()
    // WebCodecs is there, the track processor is not — Firefox and Safari, and
    // jsdom itself. The real gate answers no, so the mode is refused.
    recorderFactory.canRecordSeparateTracks = false
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    const recorder = recorderFactory.last()
    // The mode is resolved ONCE and handed to everything: the factory, the
    // recorder type and the config the recorder initializes with. A config that
    // still said `true` here would have the recorder building a pipeline the
    // browser cannot read.
    expect(recorder.separateTracks).toBe(false)
    expect(recorder.initializeCalls[0].config.separateTracks).toBe(false)
    expect(harness.deps.recorderTypeRef.current).toBe('mediarecorder')
    // ...and the compositor is back in the recording path, as today.
    expect(recorder.initializeCalls[0].screen).not.toBe(harness.streams.screen)
  })

  it('says a separate track was lost when the recorder delivers fewer than the take asked for', async () => {
    // Screen, webcam and a microphone that really was acquired: three
    // companions' worth of sources, so a list of one is two tracks short.
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    harness.streams.mic = micStreamWithTrack()
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    // The recorder cannot report this: `null` and a short list are what an
    // ordinary take delivers too. Only this closure still knows how many
    // companions the take asked for.
    expect(
      setNotice.mock.calls.filter(([notice]) => notice === SEPARATE_TRACK_NOT_SAVED)
    ).toHaveLength(1)
  })

  it('says nothing when every companion the take asked for arrived', async () => {
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    harness.streams.mic = micStreamWithTrack()
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
      { role: 'mic', blob: new Blob(['mic'], { type: 'audio/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(setNotice).not.toHaveBeenCalledWith(SEPARATE_TRACK_NOT_SAVED)
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('does not count a microphone the take never got', async () => {
    // The toggle is on and `acquireStreams` came back without one — a device
    // that would not open. The take asks for one companion, gets one, and
    // says nothing.
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(setNotice).not.toHaveBeenCalledWith(SEPARATE_TRACK_NOT_SAVED)
  })

  it('says it once for a take that lost two of the three parts it asked for', async () => {
    // A microphone that opened and a share dialog that ticked system audio, so
    // the take asks for three companions and gets one. One sentence covers
    // both losses: there is one notice channel, and which tracks they were is
    // what the console carries.
    harness = separateHarness({
      countdownSeconds: 0,
      microphoneEnabled: true,
      systemAudioEnabled: true,
    })
    harness.streams.mic = micStreamWithTrack()
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(
      setNotice.mock.calls.filter(([notice]) => notice === SEPARATE_TRACK_NOT_SAVED)
    ).toHaveLength(1)
  })

  it('counts the system audio the share dialog did tick, with no microphone in the take', async () => {
    // The case that can only pass if the system term is counted: no microphone
    // at all, so the take asks for exactly two parts — the camera and the
    // system audio — and one delivered is one short. Drop the system term from
    // `expectedCompanions` and this becomes 1 < 1, which says nothing.
    harness = separateHarness({
      countdownSeconds: 0,
      microphoneEnabled: false,
      systemAudioEnabled: true,
    })
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(
      setNotice.mock.calls.filter(([notice]) => notice === SEPARATE_TRACK_NOT_SAVED)
    ).toHaveLength(1)
  })
  // ESCSUITE-70. Two answers to one question — "did this take capture any
  // sound?" — are resolved here from the same two facts, four lines apart: how
  // many companions the take is counted as asking for, and the `micAcquired`
  // the save path turns into the stored `hasAudio` (its other half, the system
  // one, is the store flag this hook wrote at take start). They used to be
  // computed from different things, so they could disagree — a microphone
  // toggle with no device behind it was correctly counted as asking for no
  // companion and still stored as audible. This walks all sixteen combinations
  // of the four inputs and asserts they agree: the take asks for an audio part
  // exactly when the recording claims audio.
  const AUDIO_COMBINATIONS = [false, true].flatMap(micEnabled =>
    [false, true].flatMap(micArrived =>
      [false, true].flatMap(systemEnabled =>
        [false, true].map(systemShared => ({
          micEnabled,
          micArrived,
          systemEnabled,
          systemShared,
        }))
      )
    )
  )

  type AudioCombination = (typeof AUDIO_COMBINATIONS)[number]

  /** The roles a take can deliver, in the order the recorder builds them. */
  const COMPANION_ROLES = ['webcam', 'mic', 'system'] as const

  /**
   * One separate-tracks take built from a combination, delivering exactly
   * `companionCount` parts — so the caller can put the take's own count either
   * side of the number and read the notice for the answer.
   */
  async function runSeparateTake(combination: AudioCombination, companionCount: number) {
    harness = separateHarness({
      countdownSeconds: 0,
      microphoneEnabled: combination.micEnabled,
      systemAudioEnabled: combination.systemEnabled,
    })
    harness.streams.screen = combination.systemShared ? screenStreamWithAudio() : screenStream()
    harness.streams.mic = combination.micArrived ? micStreamWithTrack() : null
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result, unmount } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = COMPANION_ROLES.slice(0, companionCount).map(role => ({
      role,
      blob: new Blob([role], { type: role === 'webcam' ? 'video/webm' : 'audio/webm' }),
      startOffset: 0,
    }))

    await act(async () => { await result.current.handleStopRecording() })

    const [, , , captured] = harness.saveRecording.mock.calls[0] as [
      Blob,
      number,
      unknown,
      CapturedTake,
    ]
    const result_ = {
      captured,
      systemAudioShared: useRecorderStore.getState().systemAudioShared,
      lossesReported: setNotice.mock.calls.filter(
        ([notice]) => notice === SEPARATE_TRACK_NOT_SAVED
      ).length,
    }
    harness.deps.compositorRef.current?.dispose()
    unmount()
    return result_
  }

  for (const combination of AUDIO_COMBINATIONS) {
    const expectsMic = combination.micEnabled && combination.micArrived
    const expectsSystem = combination.systemEnabled && combination.systemShared
    const audioParts = (expectsMic ? 1 : 0) + (expectsSystem ? 1 : 0)
    const description =
      `microphone ${combination.micEnabled ? 'on' : 'off'} and ` +
      `${combination.micArrived ? 'acquired' : 'absent'}, ` +
      `system audio ${combination.systemEnabled ? 'on' : 'off'} and ` +
      `${combination.systemShared ? 'shared' : 'silent'}`

    it(`counts ${audioParts} audio part(s) and stores the same answer — ${description}`, async () => {
      // One short of what the take asked for, then exactly what it asked for:
      // between them they pin the count rather than bounding it on one side.
      const short = await runSeparateTake(combination, audioParts)
      const whole = await runSeparateTake(combination, audioParts + 1)

      expect(short.lossesReported).toBe(1)
      expect(whole.lossesReported).toBe(0)

      // What the save path is handed, and the `hasAudio` the save path derives
      // from it — through the same function it calls, so this cannot agree with
      // a rule the app no longer follows.
      expect(whole.captured.micAcquired).toBe(expectsMic)
      const hasAudio = resolveHasAudio(
        whole.captured,
        combination.systemEnabled,
        whole.systemAudioShared
      )
      expect(hasAudio).toBe(audioParts > 0)
    })
  }
})

describe('useRecordingController teardown', () => {
  it('abandons a countdown left running when the screen goes away', async () => {
    const { result, unmount } = mountController({ countdownSeconds: 3 })
    await startTake(result)
    expect(state()).toBe('countdown')

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(recorderFactory.last().start).not.toHaveBeenCalled()
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(useRecorderStore.getState().countdownValue).toBe(0)
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(state()).toBe('idle')
  })

  it('disposes the recorder and releases the capture when it goes away mid-take', async () => {
    const { result, unmount } = mountController({ countdownSeconds: 0 })
    await startTake(result)
    const recorder = recorderFactory.last()
    recorder.duration = 12
    act(() => { vi.advanceTimersByTime(100) })
    expect(useRecorderStore.getState().currentDuration).toBe(12)

    unmount()

    expect(recorder.dispose).toHaveBeenCalledTimes(1)
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(useRecorderStore.getState().currentDuration).toBe(0)
    expect(state()).toBe('idle')
  })

  it('drops a chunk that arrives after the screen went away', async () => {
    const { result, unmount } = mountController({ countdownSeconds: 0 })
    await startTake(result)
    const recorder = recorderFactory.last()

    unmount()

    await act(async () => {
      recorder.callbacks.onStop?.(recorder.stopBlob)
    })

    expect(harness.saveRecording).not.toHaveBeenCalled()
  })

  it('leaves nothing running when the screen goes away with no take at all', () => {
    const { unmount } = mountController({ countdownSeconds: 0 })

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
    expect(state()).toBe('idle')
  })
  // The recorder is created and initialize()d before the countdown starts, and
  // initialize() awaits several times over — so the teardown genuinely lands
  // while a take is still being set up: disposeRecorder() runs synchronously
  // underneath a handleStartRecording that is parked (ESCSUITE-73). The take
  // that resumes afterwards belongs to nobody.
  describe('when a take is thrown away mid-start', () => {
    /** A recorder whose initialize() is held open until the test lets go. */
    function parkedInitialize(): () => void {
      let release!: () => void
      recorderFactory.nextInitializeGate = new Promise<void>(resolve => {
        release = resolve
      })
      return release
    }

    it('starts no countdown for a take that was thrown away mid-initialize', async () => {
      const release = parkedInitialize()
      const { result, unmount } = mountController({ countdownSeconds: 3 })
      let start!: Promise<void>
      await act(async () => {
        start = result.current.handleStartRecording()
      })
      // Parked inside initialize(), with the recorder already built.
      expect(recorderFactory.recorders).toHaveLength(1)
      expect(recorderFactory.last().initializeCalls).toHaveLength(1)

      unmount()
      release()
      await act(async () => {
        await start
      })

      // The teardown disposed it; the resuming start must not raise it again.
      expect(recorderFactory.last().dispose).toHaveBeenCalledTimes(1)
      expect(recorderFactory.last().start).not.toHaveBeenCalled()
      // Nothing ticking, and the store left exactly as the teardown left it —
      // not 'countdown' with a countdown running over a disposed recorder.
      expect(vi.getTimerCount()).toBe(0)
      expect(state()).toBe('idle')
      expect(useRecorderStore.getState().countdownValue).toBe(0)
      // ...and nothing said about a recording the user never saw.
      expect(useRecorderStore.getState().notice).toBeNull()
    })

    it('starts no countdown when the capture ends mid-initialize', async () => {
      // The other way a take is disposed underneath a parked initialize(), and
      // the one `cancelledRef` cannot see: the video track's 'ended' listener
      // is installed before `Output.start()`, so a user who stops sharing while
      // setup is still running reaches the recorder's own `onError`, which
      // clears the countdown ticker, disposes the recorder and returns to idle
      // — and raises no cancelled flag, because nobody cancelled anything. The
      // guard has to ask the recorder ref, which every disposal nulls.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const release = parkedInitialize()
      const { result } = mountController({ countdownSeconds: 3 })
      let start!: Promise<void>
      await act(async () => {
        start = result.current.handleStartRecording()
      })
      const recorder = recorderFactory.last()

      await act(async () => {
        recorder.callbacks.onError?.(new Error('Capture ended before recording started'))
      })
      release()
      await act(async () => {
        await start
      })

      expect(recorder.dispose).toHaveBeenCalledTimes(1)
      expect(recorder.start).not.toHaveBeenCalled()
      // No 3-2-1 over a recorder that is gone: idle, nothing ticking, no
      // countdown left in the store for the next mount to come up inside.
      expect(state()).toBe('idle')
      expect(useRecorderStore.getState().countdownValue).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      // ESCAPECRAFT says nothing for a capture that ended before it started —
      // the console carries it, and that is the behaviour to keep.
      expect(useRecorderStore.getState().notice).toBeNull()
      expect(consoleError).toHaveBeenCalledWith('Recording error:', expect.any(Error))
    })

    it('says nothing when such a take fails as it is abandoned', async () => {
      // The recorder resolves a disposal quietly, but a browser can still
      // reject out of a half-torn-down setup — an AudioContext closed under a
      // pending resume(), say. The notice lives in the module-singleton store,
      // so it would be read out on the next mount.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const release = parkedInitialize()
      recorderFactory.nextInitializeError = new Error('InvalidStateError')
      const { result, unmount } = mountController({ countdownSeconds: 0 })
      let start!: Promise<void>
      await act(async () => {
        start = result.current.handleStartRecording()
      })

      unmount()
      release()
      await act(async () => {
        await start
      })

      expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error))
      expect(useRecorderStore.getState().notice).toBeNull()
      expect(state()).toBe('idle')
    })

    // ESCSUITE-109, fix round 1: the same supersession one `await` later. A
    // cancel frees Record while `initialize()` is still parked, so the next take
    // can have acquired its capture and built *its* recorder by the time the
    // older setup resumes — and `recorderRef`, the store's streams and
    // `stopAllStreams` all belong to that newer take by then. The ESCSUITE-73
    // guard tears down what it finds, which was right while the only way to
    // reach it was a take that had already been torn down, and is the newer
    // take's recorder and capture now. A superseded attempt must touch nothing:
    // its own everything was released by the cancel that superseded it.
    describe('when a newer take is already being set up', () => {
      /** A capture of its own per request, so the store can be read back. */
      function acquirePerAttempt(): AcquiredDoubles[] {
        const acquired: AcquiredDoubles[] = []
        harness.acquireStreams.mockImplementation(async () => {
          const streams: AcquiredDoubles = { screen: screenStream(), webcam: null, mic: null }
          acquired.push(streams)
          return streams
        })
        return acquired
      }

      it('touches nothing of it when the older setup resumes', async () => {
        const releaseFirst = parkedInitialize()
        const { result } = mountController({ countdownSeconds: 3 })
        const acquired = acquirePerAttempt()

        let first!: Promise<void>
        await act(async () => { first = result.current.handleStartRecording() })
        // Parked inside the first initialize(), with its recorder built.
        expect(recorderFactory.recorders).toHaveLength(1)

        // Escape in 'preparing' disposes that recorder and frees Record.
        act(() => { result.current.handleCancelRecording() })
        expect(recorderFactory.last().dispose).toHaveBeenCalledTimes(1)
        expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)

        // The next take gets all the way to its own parked initialize().
        const releaseSecond = parkedInitialize()
        let second!: Promise<void>
        await act(async () => { second = result.current.handleStartRecording() })
        expect(recorderFactory.recorders).toHaveLength(2)
        const newer = recorderFactory.last()
        expect(useRecorderStore.getState().screenStream).toBe(acquired[1].screen)

        // Now the abandoned setup resumes.
        releaseFirst()
        await act(async () => { await first })

        // It disposed the newer take's recorder and released its capture — the
        // sharing bar going out mid-take — and then the newer take's own resume
        // found a null recorder ref and returned without a state, leaving the UI
        // stuck in 'preparing': no Record button, no Cancel button, nothing but a
        // reload.
        expect(newer.dispose).not.toHaveBeenCalled()
        expect(harness.stopAllStreams).toHaveBeenCalledTimes(1)
        expect(useRecorderStore.getState().screenStream).toBe(acquired[1].screen)
        for (const track of acquired[1].screen?.getTracks() ?? []) {
          expect(track.stop).not.toHaveBeenCalled()
        }
        expect(state()).toBe('preparing')

        // ...and the newer take goes on to run, exactly as if the older one had
        // never resumed at all.
        releaseSecond()
        await act(async () => { await second })

        expect(state()).toBe('countdown')
        act(() => { vi.advanceTimersByTime(3000) })
        expect(newer.start).toHaveBeenCalledTimes(1)
        expect(recorderFactory.recorders).toHaveLength(2)
      })
    })

    // ESCSUITE-93. The window *before* `recorderRef.current` is assigned — and
    // the one a cancel cannot clean up after, because `stopAllStreams()` reads
    // the streams out of the store and the start has not put them there yet.
    // The picker is on screen, or the camera prompt is; Escape raises the flag
    // and returns the app to idle; and the start that resumes afterwards used
    // to go on and do all of it — set the live streams, start the compositor,
    // build a recorder and initialize it — before reaching the ESCSUITE-73
    // guard, which returned without disposing any of it. The sharing bar and
    // the camera light then stayed on for the rest of the session behind a UI
    // that said idle.
    describe('while the capture request is still outstanding', () => {
      let raf: RafDouble

      beforeEach(() => {
        // A start that walks past the cancel builds a compositor and starts it,
        // so the doubles are installed here to keep a failure reading as the
        // assertion it is rather than as jsdom refusing captureStream().
        installCanvasCaptureStreamDouble()
        raf = installRafDouble()
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      })

      afterEach(() => {
        raf.uninstall()
        uninstallCanvasCaptureStreamDouble()
      })

      /** An acquireStreams held open, as a picker waiting on the user is. */
      function parkedAcquire(): () => void {
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        harness.acquireStreams.mockImplementation(async () => {
          await gate
          return harness.streams
        })
        return release
      }

      /** Every track of every capture the request handed back. */
      function acquiredTracks(): MediaStreamTrack[] {
        const { screen, webcam, mic } = harness.streams
        return [screen, webcam, mic].flatMap(stream => stream?.getTracks() ?? [])
      }

      /**
       * Nothing live, and nothing built on the far side of the cancel: the
       * earliest exit is the one that leaves no compositor to dispose and no
       * recorder to orphan, so the law here is that neither was ever made.
       */
      function expectNothingLive(): void {
        expect(recorderFactory.recorders).toHaveLength(0)
        expect(harness.deps.compositorRef.current).toBeNull()
        expect(harness.setIsPiPActive).not.toHaveBeenCalled()
        expect(harness.setPreviewStream).not.toHaveBeenCalled()
        // The store never sees the streams, so no render mirrors a capture that
        // is already being thrown away.
        expect(useRecorderStore.getState().screenStream).toBeNull()
        expect(useRecorderStore.getState().webcamStream).toBeNull()
        expect(harness.deps.micStreamRef.current).toBeNull()
        // ...and every track the request did hand back is stopped, which is the
        // sharing bar and the camera light going out.
        for (const track of acquiredTracks()) {
          expect(track.stop).toHaveBeenCalledTimes(1)
        }
        expect(state()).toBe('idle')
        expect(vi.getTimerCount()).toBe(0)
        expect(useRecorderStore.getState().notice).toBeNull()
      }

      /** A screen+webcam+mic take parked on its capture request. */
      function mountParked() {
        const view = mountController(
          {
            screenEnabled: true,
            webcamEnabled: true,
            microphoneEnabled: true,
            countdownSeconds: 3,
          },
          { screen: screenStream(), webcam: webcamStream(), mic: micStreamWithTrack() }
        )
        return { ...view, release: parkedAcquire() }
      }

      it('releases the capture for a take cancelled before it arrived', async () => {
        const { result, release } = mountParked()
        let start!: Promise<void>
        await act(async () => {
          start = result.current.handleStartRecording()
        })
        // Parked on the request: nothing built yet, and nothing in the store
        // for a cancel to find.
        expect(state()).toBe('preparing')
        expect(recorderFactory.recorders).toHaveLength(0)

        // Escape in 'preparing' is handleCancelRecording — see
        // useKeyboardShortcuts: only 'countdown' goes to cancelCountdown.
        act(() => { result.current.handleCancelRecording() })
        expect(state()).toBe('idle')

        release()
        await act(async () => { await start })

        expectNothingLive()

        // ...and Record still works. The cancel drops the attempt token, and
        // the `finally` of the attempt drops it too if it is still its own: a
        // gate left closed would brick the button for the rest of the session,
        // say nothing about it, and leave every other assertion in this file
        // green.
        harness.acquireStreams.mockResolvedValue(harness.streams)
        await startTake(result)
        expect(recorderFactory.recorders).toHaveLength(1)
        expect(state()).toBe('countdown')
      })

      it('releases the capture when the screen goes away before it arrived', async () => {
        const { result, unmount, release } = mountParked()
        let start!: Promise<void>
        await act(async () => {
          start = result.current.handleStartRecording()
        })

        unmount()
        release()
        await act(async () => { await start })

        expectNothingLive()
      })

      // ESCSUITE-109. The cancel above frees Record the instant it happens,
      // but the request it abandoned is still outstanding — a picker still on
      // screen, a camera prompt nobody has answered — so the *next* take is
      // started while the first request is still in the air. ESCSUITE-93's
      // boolean could not allow that: it was dropped only when the abandoned
      // request settled, which for a picker nobody answers is never, so Record
      // was silently dead with no notice. An attempt token frees the gate at
      // cancel time without letting the abandoned attempt walk on: the start
      // that resumes finds a token that is no longer its own, releases what it
      // was handed and touches nothing of the take that is now live.
      describe('and the next take is started before it arrives', () => {
        /**
         * One held-open request per call, each with captures of its own, so a
         * test can say *which* attempt's tracks were stopped.
         */
        function queuedAcquires(): Array<{ streams: AcquiredDoubles; release: () => void }> {
          const requests: Array<{ streams: AcquiredDoubles; release: () => void }> = []
          harness.acquireStreams.mockImplementation(() => {
            const streams: AcquiredDoubles = {
              screen: screenStream(),
              webcam: webcamStream(),
              mic: micStreamWithTrack(),
            }
            let release!: () => void
            const gate = new Promise<void>(resolve => { release = resolve })
            requests.push({ streams, release })
            return gate.then(() => streams)
          })
          return requests
        }

        function tracksOf(streams: AcquiredDoubles): MediaStreamTrack[] {
          return [streams.screen, streams.webcam, streams.mic].flatMap(s => s?.getTracks() ?? [])
        }

        /** Mount a screen+webcam+mic take whose every request is held open. */
        function mountQueued() {
          const view = mountController({
            screenEnabled: true,
            webcamEnabled: true,
            microphoneEnabled: true,
            countdownSeconds: 3,
          })
          return { ...view, requests: queuedAcquires() }
        }

        /** Start, cancel underneath the parked request, start again. */
        async function cancelAndRestart(result: { current: RecordingController }) {
          let first!: Promise<void>
          await act(async () => { first = result.current.handleStartRecording() })
          expect(state()).toBe('preparing')

          act(() => { result.current.handleCancelRecording() })
          expect(state()).toBe('idle')

          let second!: Promise<void>
          await act(async () => { second = result.current.handleStartRecording() })
          return { first, second }
        }

        it('takes the second take, and releases the first request when it answers last', async () => {
          const { result, requests } = mountQueued()
          const { first, second } = await cancelAndRestart(result)

          // Record was not inert behind the abandoned request: the second take
          // asked for its own capture.
          expect(requests).toHaveLength(2)
          expect(state()).toBe('preparing')

          // The second take's own request answers, and it is the one that runs.
          requests[1].release()
          await act(async () => { await second })
          expect(recorderFactory.recorders).toHaveLength(1)
          expect(state()).toBe('countdown')

          // ...and only then does the first picker finally get an answer.
          requests[0].release()
          await act(async () => { await first })

          for (const track of tracksOf(requests[0].streams)) {
            expect(track.stop).toHaveBeenCalledTimes(1)
          }
          // Nothing of the live take is touched: its tracks, its recorder and
          // its countdown are all exactly as the second start left them.
          for (const track of tracksOf(requests[1].streams)) {
            expect(track.stop).not.toHaveBeenCalled()
          }
          expect(recorderFactory.recorders).toHaveLength(1)
          expect(recorderFactory.last().dispose).not.toHaveBeenCalled()
          expect(state()).toBe('countdown')
          expect(useRecorderStore.getState().screenStream).toBe(requests[1].streams.screen)
        })

        it('releases the first request when it answers first, and still runs the second', async () => {
          const { result, requests } = mountQueued()
          const { first, second } = await cancelAndRestart(result)
          expect(requests).toHaveLength(2)

          // The abandoned picker answers while the second take is still
          // waiting on its own: nothing is built, and nothing of the second
          // take's is disturbed.
          requests[0].release()
          await act(async () => { await first })

          for (const track of tracksOf(requests[0].streams)) {
            expect(track.stop).toHaveBeenCalledTimes(1)
          }
          expect(recorderFactory.recorders).toHaveLength(0)
          expect(harness.deps.compositorRef.current).toBeNull()
          expect(useRecorderStore.getState().screenStream).toBeNull()
          expect(state()).toBe('preparing')
          expect(useRecorderStore.getState().notice).toBeNull()

          requests[1].release()
          await act(async () => { await second })

          for (const track of tracksOf(requests[1].streams)) {
            expect(track.stop).not.toHaveBeenCalled()
          }
          expect(recorderFactory.recorders).toHaveLength(1)
          expect(state()).toBe('countdown')
        })
      })
    })
  })
})

// ESCSUITE-93, the second door to the same leak. Nothing but the rendered
// `state` stood between two fast clicks — or two R presses — and two
// overlapping starts, and the second `recorderRef.current =` orphaned the
// first recorder: an AudioContext, an rAF level monitor and a muxer with
// nothing left that could ever dispose them. The state is the *rendered*
// truth, one render behind; a ref is the synchronous one.
describe('useRecordingController two starts at once', () => {
  it('builds one recorder for two starts in the same tick', async () => {
    const { result } = mountController({ countdownSeconds: 3 })

    await act(async () => {
      await Promise.all([
        result.current.handleStartRecording(),
        result.current.handleStartRecording(),
      ])
    })

    // One capture request, one recorder, one setup — and one countdown.
    expect(harness.acquireStreams).toHaveBeenCalledTimes(1)
    expect(recorderFactory.recorders).toHaveLength(1)
    expect(recorderFactory.last().initializeCalls).toHaveLength(1)
    expect(state()).toBe('countdown')
  })

  it('takes a second start once the first has finished setting up', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    await startTake(result)
    expect(recorderFactory.recorders).toHaveLength(1)

    act(() => { result.current.cancelCountdown() })
    await startTake(result)

    // The guard is per attempt, not a latch that closes the app for good.
    expect(recorderFactory.recorders).toHaveLength(2)
    expect(state()).toBe('countdown')
  })
})

// ESCSUITE-109. A share picker nobody answers, a camera permission prompt left
// on screen, a microphone driver wedged so that getUserMedia never settles:
// `acquireStreams()` then never resolves and never rejects. The app sat in
// 'preparing' with no way out but a reload, and Record — gated on a start being
// on its way — was dead for the rest of the session with nothing said about it.
// The browser APIs take no AbortController, so a deadline is what gives the
// user the app back.
describe('useRecordingController a capture request the browser never answers', () => {
  beforeEach(() => {
    // The deadline is a setTimeout, which this file deliberately leaves real so
    // promise chains settle — so fake it here, and only here, alongside the
    // interval tickers the rest of the file drives.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  })

  /** A request that answers only when the test says so, as a picker does. */
  function parkedAcquire(): () => void {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    harness.acquireStreams.mockImplementation(() => gate.then(() => harness.streams))
    return release
  }

  /**
   * A request that answers only when the test says so, but reports `partial`
   * through `onPartial` the moment it is called — as a picker answered but a
   * camera prompt left sitting does (ESCSUITE-116) — and resolves to `final`
   * once released.
   */
  function parkedAcquireWithPartial(partial: AcquiredDoubles, final: AcquiredDoubles = partial): () => void {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    harness.acquireStreams.mockImplementation((onPartial?: (p: AcquiredDoubles) => void) => {
      onPartial?.(partial)
      return gate.then(() => final)
    })
    return release
  }

  /**
   * A request that never settles at all — nothing else is ever coming — but
   * hands back a way to call its `onPartial` reporter whenever the test
   * likes, before or after the deadline, to pin exactly when a landed stage
   * is released (ESCSUITE-116).
   */
  function parkedAcquireCapturingCallback(): { report: (p: AcquiredDoubles) => void } {
    let onPartialFn: ((p: AcquiredDoubles) => void) | undefined
    const forever = new Promise<never>(() => {})
    harness.acquireStreams.mockImplementation((onPartial?: (p: AcquiredDoubles) => void) => {
      onPartialFn = onPartial
      return forever
    })
    return { report: (p) => onPartialFn?.(p) }
  }

  /** Every track the parked request would eventually hand over. */
  function acquiredTracks(): MediaStreamTrack[] {
    const { screen, webcam, mic } = harness.streams
    return [screen, webcam, mic].flatMap(stream => stream?.getTracks() ?? [])
  }

  /** Let the chain behind a released request run to its end. */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  /**
   * Start a take and leave it parked on its request. The promise comes back
   * wrapped, because an async function that returns one hands back what it
   * resolves to — and this one never resolves until the clock runs out.
   */
  async function startParked(result: { current: RecordingController }): Promise<{ start: Promise<void> }> {
    let start!: Promise<void>
    await act(async () => { start = result.current.handleStartRecording() })
    expect(state()).toBe('preparing')
    return { start }
  }

  it('gives up on the request, says so, and returns the app to idle', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    const release = parkedAcquire()
    const { start } = await startParked(result)

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)
    // Nothing was built on top of a capture that never arrived.
    expect(recorderFactory.recorders).toHaveLength(0)
    expect(harness.setPreviewStream).not.toHaveBeenCalled()
    expect(useRecorderStore.getState().screenStream).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    // ...and the capture the browser eventually hands over is released, rather
    // than left running behind a UI that says idle.
    release()
    await settle()
    for (const track of acquiredTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves Record working', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    parkedAcquire()
    const { start } = await startParked(result)

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    // The gate is per attempt: one left raised on this path would brick the
    // button for the rest of the session, which is half of what this fixes.
    harness.acquireStreams.mockResolvedValue(harness.streams)
    await startTake(result)

    expect(recorderFactory.recorders).toHaveLength(1)
    expect(state()).toBe('countdown')
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('says nothing about a take the user had already thrown away', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    const release = parkedAcquire()
    const { start } = await startParked(result)

    // Escape in 'preparing' — the user gave up long before the clock did.
    act(() => { result.current.handleCancelRecording() })
    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    // The notice lives in the module-singleton store, so one raised here would
    // be read out on the next mount about a take nobody was waiting for.
    expect(useRecorderStore.getState().notice).toBeNull()
    expect(state()).toBe('idle')

    release()
    await settle()
    for (const track of acquiredTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('releases what had already landed even for a take thrown away before the deadline (ESCSUITE-116)', async () => {
    // releaseAcquired(partial) sits before the `abandoned` guard that decides
    // whether to say anything — a cancelled take still gets its live screen
    // share stopped at the deadline, it just does so silently.
    const { result } = mountController({ countdownSeconds: 3, webcamEnabled: true })
    const screen = harness.streams.screen!
    const release = parkedAcquireWithPartial({ screen, webcam: null, mic: null })
    const { start } = await startParked(result)

    act(() => { result.current.handleCancelRecording() })
    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    for (const track of screen.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
    expect(useRecorderStore.getState().notice).toBeNull()
    expect(state()).toBe('idle')

    release()
    await settle()
  })

  it('stays quiet when the request it gave up on fails later', async () => {
    // The other way a request the clock gave up on can end: the picker is
    // finally dismissed, or the camera prompt is denied, and it rejects. There
    // is nothing to release and nothing to say — the user was told when the
    // clock ran out, and a second sentence about it would be about a take they
    // have already moved on from. What must not happen is an unhandled
    // rejection out of a promise nobody is awaiting any more.
    const { result } = mountController({ countdownSeconds: 3 })
    let refuse!: (error: Error) => void
    const gate = new Promise<never>((_resolve, reject) => { refuse = reject })
    harness.acquireStreams.mockImplementation(() => gate)
    const { start } = await startParked(result)

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })
    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)

    const refused = new DOMException('Permission denied', 'NotAllowedError')
    await act(async () => { refuse(refused) })
    await settle()

    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)
    expect(state()).toBe('idle')
    expect(recorderFactory.recorders).toHaveLength(0)
  })

  it('stops the display capture at the deadline, before the parked webcam ever answers (ESCSUITE-116)', async () => {
    const { result } = mountController({ countdownSeconds: 3, webcamEnabled: true })
    const screen = harness.streams.screen!
    const release = parkedAcquireWithPartial({ screen, webcam: null, mic: null })
    const { start } = await startParked(result)

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    // The share bar comes down the moment the clock runs out — not whenever
    // the parked camera prompt is finally settled.
    for (const track of screen.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
    expect(state()).toBe('idle')
    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)

    release()
    await settle()
  })

  it('releases the webcam too once it settles after the deadline, on top of the screen already stopped', async () => {
    const { result } = mountController({ countdownSeconds: 3, webcamEnabled: true })
    const screen = harness.streams.screen!
    const webcam = webcamStream()
    const release = parkedAcquireWithPartial(
      { screen, webcam: null, mic: null },
      { screen, webcam, mic: null }
    )
    const { start } = await startParked(result)

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })
    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)

    release()
    await settle()

    for (const track of webcam.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
    // The screen was already stopped at the deadline; the late-arrival release
    // stops it a second time, which the comment beside it says is a harmless
    // no-op — pin the exact count rather than merely "at least once".
    for (const track of screen.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(2)
    }
  })

  it('only releases a stage once it has actually landed, not the instant the clock runs out (ESCSUITE-116)', async () => {
    const { result } = mountController({ countdownSeconds: 3, webcamEnabled: true })
    const screen = harness.streams.screen!
    const { report } = parkedAcquireCapturingCallback()
    const { start } = await startParked(result)

    // The screen lands well before the deadline. Reported through
    // `onPartial`, but the clock has not run out yet — nothing is released
    // just because a stage arrived.
    report({ screen, webcam: null, mic: null })
    for (const track of screen.getTracks()) {
      expect(track.stop).not.toHaveBeenCalled()
    }

    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })

    // Now the clock has run out, and the screen — the only stage reported so
    // far — is released.
    for (const track of screen.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('releases a stage that lands only after the deadline, without ever waiting for the rest of the request (ESCSUITE-116)', async () => {
    const { result } = mountController({ countdownSeconds: 3, webcamEnabled: true })
    const screen = harness.streams.screen!
    const webcam = webcamStream()
    const { report } = parkedAcquireCapturingCallback()
    const { start } = await startParked(result)

    report({ screen, webcam: null, mic: null })
    await act(async () => { vi.advanceTimersByTime(CAPTURE_TIMEOUT_MS) })
    await act(async () => { await start })
    expect(useRecorderStore.getState().notice).toBe(CAPTURE_UNANSWERED)

    // The camera prompt is finally answered a minute after the deadline. This
    // request never settles on its own — nothing else is ever coming — so
    // `onPartial` reporting the webcam once `expired` is the only way it is
    // ever released; without it, the camera light would stay on forever.
    report({ screen, webcam, mic: null })

    for (const track of webcam.getTracks()) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('never starts the clock for a request that answers at once', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    await startTake(result)

    // Exactly one timer is left running, and it is the countdown ticker: the
    // deadline is cleared by the request settling, whichever way it settled,
    // because a 60-second timer left armed behind every take is a leak.
    expect(vi.getTimerCount()).toBe(1)
    expect(state()).toBe('countdown')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(recorderFactory.last().start).toHaveBeenCalledTimes(1)
  })
})
