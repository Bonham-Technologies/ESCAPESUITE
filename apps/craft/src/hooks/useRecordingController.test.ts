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
import { useRecordingController, type RecordingControllerDeps } from './useRecordingController'
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
    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 9, undefined)
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
    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 8, null)
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

    expect(harness.saveRecording).toHaveBeenCalledWith(recorder.stopBlob, 42, null)
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
    recorder.companionPart = {
      role: 'webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      startOffset: 0,
    }

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      recorder.companionPart
    )
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
})
