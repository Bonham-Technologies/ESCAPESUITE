// ESCSUITE-176 item 1 (probe). Every path that throws a take away — a cancel
// from a live take, a cancelled countdown, and the unmount teardown — has to
// clear `capturedThumbnailRef` the same way ESCSUITE-114 made them all zero
// the audio levels. Left uncleared, the *next* take that ends on its own (the
// recorder's own onStop, not through handleStopRecording — "Stop sharing" is
// exactly this) is saved with the thrown-away take's frame, because
// `useRecordingSave` only clears the ref once a save actually runs.
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
  it('is not left behind for the next take (cancel from a live take)', async () => {
    const { result } = mountController({ countdownSeconds: 0 })
    await act(async () => { await result.current.handleStartRecording() })

    // The take grabbed a frame before Stop finished landing — exactly what
    // handleStopRecording does, captured here directly since the recorder
    // double never calls it on its own.
    harness.capturedThumbnailRef.current = new Blob(['take-a-frame'])

    act(() => { result.current.handleCancelRecording() })

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
})
