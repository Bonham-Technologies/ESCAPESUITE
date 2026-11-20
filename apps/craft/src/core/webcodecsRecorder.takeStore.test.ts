// ESCSUITE-466: a WebCodecs take kept on the device as it records.
//
// When its take store is ready, every output the recorder builds muxes into
// a `StreamTarget` over the store instead of a `BufferTarget`, so the take
// never sits in the page's memory, and Stop delivers each part's file read
// back from disk — copied off it, because IndexedDB would otherwise keep a
// reference to a file the save then deletes. Where the store is not ready the
// take is muxed into memory exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import { TakeStorageError, type TakeJournal } from './takeStore'
import type { RecorderStopCallback, RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  VideoFrameDouble,
} from '../test/doubles/webcodecs'
import { getMediabunnyState, resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  enableAudioWorkletDouble,
  lastAudioContext,
} from '../test/doubles/audio'
import {
  createTrackDouble,
  createStreamDouble,
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
  type TrackProcessorControl,
} from '../test/doubles/mediastream'
import { createTakeStoreFactoryDouble, type TakeStoreDouble } from '../test/doubles/takeStore'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

const CONFIG: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: true,
  microphoneEnabled: true,
  systemAudioEnabled: true,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  separateTracks: true,
}

const JOURNAL = { takeId: 'take-1' } as TakeJournal

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

let processor: TrackProcessorControl
let factory: ReturnType<typeof createTakeStoreFactoryDouble>
let store: TakeStoreDouble
let recorder: WebCodecsRecorder
let callbacks: { onStop: Mock<RecorderStopCallback>; onError: Mock<(error: Error) => void> }

function newRecorder(available = true): void {
  factory.available = available
  store = factory.createTakeStore(JOURNAL) as TakeStoreDouble
  recorder = new WebCodecsRecorder(callbacks, { takeStore: store })
}

let separate = true

async function initialize(separateTracks = true): Promise<void> {
  separate = separateTracks
  await recorder.initialize(
    createStreamDouble([
      createTrackDouble('video', { id: 'screen-video' }),
      createTrackDouble('audio', { id: 'system' }),
    ]),
    createStreamDouble([
      createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
    ]),
    createStreamDouble([createTrackDouble('audio', { id: 'mic', label: 'Headset' })]),
    { ...CONFIG, separateTracks }
  )
}

async function record(): Promise<void> {
  recorder.start()
  processor.pushFrameTo('screen-video', new VideoFrameDouble('s', { timestamp: 0 }))
  if (separate) processor.pushFrameTo('webcam-video', new VideoFrameDouble('w', { timestamp: 0 }))
  for (let i = 0; i < 4; i++) {
    lastAudioContext().render(4096)
    await flush(2)
  }
}

const file = (bytes: number[], name: string) => new File([new Uint8Array(bytes)], name)
const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())]

beforeEach(() => {
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  installAudioContextDouble()
  enableAudioWorkletDouble()
  processor = installTrackProcessorDouble()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  callbacks = { onStop: vi.fn(), onError: vi.fn() }
  factory = createTakeStoreFactoryDouble()
})

afterEach(() => {
  recorder.dispose()
  uninstallTrackProcessorDouble()
  uninstallAudioContextDouble()
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
})

describe('a take kept on the device', () => {
  it('muxes every part into the store, and delivers each file copied off the disk', async () => {
    newRecorder()
    await initialize()
    const mb = getMediabunnyState()
    expect(mb.targets).toHaveLength(0)
    expect(mb.streamTargets).toHaveLength(4)
    await record()
    store.files = {
      primary: file([1, 2, 3], 'primary.webm'),
      webcam: file([4], 'webcam.webm'),
      mic: file([5], 'mic.webm'),
      system: file([6], 'system.webm'),
    }
    await recorder.stop()

    // Every finalized output wrote into the store, part by part.
    expect(new Set(store.writes.map((w) => w.part))).toEqual(new Set(['primary', 'webcam', 'mic', 'system']))
    expect(store.writes.every((w) => w.position === 0)).toBe(true)
    expect(store.finish).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
    const [blob, parts] = callbacks.onStop.mock.calls[0]
    expect(blob).not.toBe(store.files.primary)
    expect(blob.type).toBe('video/webm')
    expect(await bytesOf(blob)).toEqual([1, 2, 3])
    const byRole = Object.fromEntries(parts!.map((p) => [p.role, p]))
    expect(byRole.webcam.blob.type).toBe('video/webm')
    expect(byRole.mic.blob.type).toBe('audio/webm')
    expect(await bytesOf(byRole.system.blob)).toEqual([6])
    // The recorder neither keeps nor deletes the files: the controller does.
    expect(store.release).not.toHaveBeenCalled()
    expect(store.discard).not.toHaveBeenCalled()
  })

  it('leaves out a part the store could not hand back, or handed back empty', async () => {
    newRecorder()
    await initialize()
    await record()
    store.files = { primary: file([1], 'primary.webm'), mic: file([], 'mic.webm'), system: file([2], 'system.webm') }
    await recorder.stop()
    expect(callbacks.onStop.mock.calls[0][1]?.map((p) => p.role)).toEqual(['system'])
  })

  it('a store that has no files at Stop ends the take with a storage error, leaving it for recovery', async () => {
    newRecorder()
    await initialize(false)
    await record()
    store.files = null
    await recorder.stop()
    expect(callbacks.onStop).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(TakeStorageError))
  })

  it('a store with no primary file at Stop is a take with no data', async () => {
    newRecorder()
    await initialize(false)
    await record()
    store.files = {}
    await recorder.stop()
    expect(callbacks.onError.mock.calls[0][0].message).toBe('Recording failed: no data was written')
  })

  it('a write that fails mid-take ends it', async () => {
    newRecorder()
    await initialize(false)
    await record()
    const error = new TakeStorageError('QuotaExceededError')
    store.failWith(error)
    expect(callbacks.onError).toHaveBeenCalledWith(error)
  })

  it('a write that fails before the take starts ends it too', async () => {
    newRecorder()
    await initialize(false)
    store.failWith(new TakeStorageError('x'))
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })

  it('a failure once the take is stopping or disposed is not reported', async () => {
    newRecorder()
    await initialize(false)
    await record()
    store.files = { primary: file([1], 'primary.webm') }
    await recorder.stop()
    store.failWith(new TakeStorageError('late'))
    expect(callbacks.onError).not.toHaveBeenCalled()

    newRecorder()
    await initialize(false)
    recorder.dispose()
    store.failWith(new TakeStorageError('late'))
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('a take disposed while the store is still deciding builds no output', async () => {
    newRecorder()
    let decide!: (kept: boolean) => void
    ;(store as { ready: Promise<boolean> }).ready = new Promise((resolve) => (decide = resolve))
    const initializing = initialize(false)
    await flush(20)
    recorder.dispose()
    decide(true)
    await initializing.catch(() => {})
    expect(getMediabunnyState().outputs).toHaveLength(0)
  })
})

describe('a take the store could not keep', () => {
  it('muxes into memory exactly as before, and never asks the store for files', async () => {
    newRecorder(false)
    await initialize()
    const mb = getMediabunnyState()
    expect(mb.streamTargets).toHaveLength(0)
    expect(mb.targets).toHaveLength(4)
    await record()
    await recorder.stop()
    expect(store.finish).not.toHaveBeenCalled()
    expect(store.writes).toEqual([])
    const [blob, parts] = callbacks.onStop.mock.calls[0]
    expect(blob.size).toBe(128)
    expect(parts).toHaveLength(3)
    // Nothing listens for a failure of a store that is not writing.
    store.failWith(new TakeStorageError('x'))
    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
