// ESCSUITE-176 item 1 (probe), fix round 1. Every path that throws a take
// away — a cancel from a live take, a cancelled countdown, the unmount
// teardown, and the recorder's own onError — has to leave nothing behind in
// `capturedThumbnailRef` for the *next* take to inherit, the same way
// ESCSUITE-114 made them all zero the audio levels. Left stale, the next take
// that ends on its own (the recorder's own onStop, not through
// handleStopRecording — "Stop sharing" is exactly this) is saved with the
// wrong frame, because `useRecordingSave` only clears the ref once a save
// actually runs.
//
// The first case drives the real path end to end (review NIT 11): a deferred
// `drawThumbnail` lets a cancel land strictly between `handleStopRecording`'s
// await and its write (review MINOR 2's exact trigger). The others assign
// the ref directly, which is enough to prove the *clearing* side without
// needing a real grab in flight.
//
// Harness lifted from useRecordingController.test.ts: the recorder factory is
// doubled (jsdom has neither MediaRecorder nor WebCodecs) and the capture side
// arrives as plain functions, exactly as App hands it in from useMediaStreams.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRecordingController, type RecordingControllerDeps } from './useRecordingController'
import type { Compositor } from '../core/compositor'
import { useRecorderStore } from '../store/recorderStore'
import { defaultConfig, type RecordingConfig } from '../store/types'
import {
  allCapabilities,
  allDetailedCapabilities,
  recorderFactory,
  resetAppDoubles,
} from '../test/appDoubles'
import { createStreamDouble, createTrackDouble } from '../test/doubles/mediastream'

vi.mock('../core/recorder-factory', async () => (await import('../test/appDoubles')).recorderFactoryModule)
vi.mock('@vercel/analytics', async () => (await import('../test/appDoubles')).analyticsModule)

const { hasSpaceForRecording } = vi.hoisted(() => ({
  hasSpaceForRecording: vi.fn(async () => true),
}))
vi.mock('../core/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/storage')>()),
  hasSpaceForRecording,
}))

// A controllable stand-in for `drawThumbnail`'s own `canvas.toBlob` hop, so a
// test can land a cancel strictly between `capturePreviewThumbnail`'s await
// and `handleStopRecording`'s write (MINOR 2's exact trigger). Only
// `resolveDraw` is read by tests; the mock factory closes over the setter.
const { setResolveDraw, callResolveDraw } = vi.hoisted(() => {
  let resolve: (blob: Blob | null) => void = () => {}
  return {
    setResolveDraw: (fn: (blob: Blob | null) => void) => { resolve = fn },
    callResolveDraw: (blob: Blob | null) => resolve(blob),
  }
})
vi.mock('../utils/previewThumbnail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/previewThumbnail')>()
  return {
    ...actual,
    drawThumbnail: vi.fn(
      () => new Promise<Blob | null>((resolve) => setResolveDraw(resolve))
    ),
  }
})

interface Harness {
  deps: RecordingControllerDeps
  capturedThumbnailRef: { current: Blob | null }
  acquireStreams: ReturnType<typeof vi.fn>
  stopAllStreams: ReturnType<typeof vi.fn>
  saveRecording: ReturnType<typeof vi.fn>
}

let harness: Harness

function screenStream(): MediaStream {
  return createStreamDouble([createTrackDouble('video', { id: 'screen-video' })])
}

/** A preview <video> with intrinsic dimensions, as a playing one has. */
function previewWithFrames(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true })
  return video
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

function makeHarness(config: Partial<RecordingConfig> = {}): Harness {
  const stream = screenStream()
  const acquireStreams = vi.fn(async () => ({ screen: stream, webcam: null, mic: null }))
  const stopAllStreams = vi.fn()
  const saveRecording = vi.fn(async () => {})
  const capturedThumbnailRef = { current: null as Blob | null }
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
    compositorRef: { current: null as Compositor | null },
    micStreamRef: { current: null },
    previewRef: { current: null },
    setPreviewStream: vi.fn(),
    setIsPiPActive: vi.fn(),
    recorderTypeRef: { current: 'mediarecorder' },
    capturedThumbnailRef,
    saveRecording: saveRecording as unknown as RecordingControllerDeps['saveRecording'],
    setNotice: store.setNotice,
    setSystemAudioShared: store.setSystemAudioShared,
    refreshStorageSpace: vi.fn(async () => {}),
  }

  return { deps, capturedThumbnailRef, acquireStreams, stopAllStreams, saveRecording }
}

function mountController(config: Partial<RecordingConfig> = {}) {
  resetStore(config)
  harness = makeHarness(config)
  return renderHook(() => useRecordingController(harness.deps))
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

describe('PROBE: the preview frame a cancelled take grabbed', () => {
  // MINOR 2's exact trigger: Stop is clicked, capturePreviewThumbnail's own
  // async hop (drawThumbnail -> canvas.toBlob) is still in flight, and Cancel
  // — still on screen, since nothing sets 'saving' until the recorder's own
  // onStop — lands before that hop resolves.
  it('is not left behind for the next take when a cancel lands mid-grab (cancel from a live take)', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    harness.deps.previewRef.current = previewWithFrames()
    await act(async () => { await result.current.handleStartRecording() })

    // handleStopRecording does nothing synchronous before its own await —
    // clearDurationTicker only clears an interval — so this is safe to call
    // outside act(): no render can be pending from it yet.
    let stopSettled = false
    const stopPromise = result.current.handleStopRecording().then(() => { stopSettled = true })

    // The grab is parked on the deferred drawThumbnail; Cancel lands here,
    // strictly between the await and the write.
    act(() => { result.current.handleCancelRecording() })
    expect(harness.capturedThumbnailRef.current).toBeNull()
    expect(stopSettled).toBe(false)

    // The grab finally resolves — this is the write the bug used to make.
    await act(async () => {
      callResolveDraw(new Blob(['take-a-frame']))
      await stopPromise
    })

    expect(harness.capturedThumbnailRef.current).toBeNull()
  })

  it('is not left behind by a cancelled countdown either', async () => {
    const { result } = mountController({ countdownSeconds: 3 })
    await act(async () => { await result.current.handleStartRecording() })

    harness.capturedThumbnailRef.current = new Blob(['take-a-frame'])

    act(() => { result.current.cancelCountdown() })

    expect(harness.capturedThumbnailRef.current).toBeNull()
  })

  it('is not left behind when the screen goes away and the component unmounts', async () => {
    const { result, unmount } = mountController({ countdownSeconds: 0 })
    await act(async () => { await result.current.handleStartRecording() })

    harness.capturedThumbnailRef.current = new Blob(['take-a-frame'])

    unmount()

    expect(harness.capturedThumbnailRef.current).toBeNull()
  })

  // MINOR 3. onError throws a take away without a save ever running — Stop
  // was clicked (the ref already holds a frame), the recorder's finalize or
  // muxer then fails, and onError fires instead of onStop. Nothing on that
  // path cleared the ref before this fix; only the *next* start does, which
  // is what this asserts.
  it('is not inherited by the next take after the recorder fails instead of stopping cleanly (onError)', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    await act(async () => { await result.current.handleStartRecording() })
    const recorderA = recorderFactory.last()

    // Stop already wrote a frame for take A before the muxer gave up.
    harness.capturedThumbnailRef.current = new Blob(['take-a-frame'])
    act(() => { recorderA.failWith(new Error('muxer failed')) })

    // Take B starts. Its own grab has not run yet — this is the clear
    // handleStartRecording does up front, for exactly this discard path.
    await act(async () => { await result.current.handleStartRecording() })

    expect(harness.capturedThumbnailRef.current).toBeNull()
  })
})
