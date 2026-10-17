// ESCSUITE-313: the in-page MP4 path's `<video>` source, asked for two clips
// of one source in one frame.
//
// `HTMLVideoFrameSource` was one element per source and `getFrame(timestamp)`
// handed that element back: two requests in one frame — a picture-in-picture
// copy of a recording, a split clip crossfading into itself — both got the one
// element, and both were drawn from wherever the second request's seek left
// it. A request now names its slot — the k-th live clip of that source this
// frame — and slot k is a k-th element over the same object URL, created the
// first time it is asked for and kept until the source is disposed.
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { FrameSourceFactory, HTMLVideoFrameSource } from './frameSource'
import { createFrameManager, getFrameAtTime, loadFrameSource } from './frameManager'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'

vi.mock('./workerDecodeEngine', () => ({ isMeasuredWorkerDecodeEngine: () => true }))

// A decode worker that loads every source and then fails its first frame
// request, so the factory's source hands itself over to the `<video>` path.
vi.mock('./videoDecodeManager', () => {
  class FailingDecodeManager {
    static isSupported = () => true
    initialize = vi.fn(async () => undefined)
    loadSource = vi.fn(async (sourceId: string) => ({
      sourceId, duration: 20, width: 640, height: 360, codec: 'avc1.640028', frameCount: 600,
    }))
    getFrame = vi.fn(async () => {
      throw new Error('Decoder stalled: no output for 5000ms')
    })
    disposeSource = vi.fn(async () => undefined)
    terminate = vi.fn()
  }
  return { VideoDecodeManager: FailingDecodeManager }
})

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360, duration: 20 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
})

afterEach(() => {
  media.uninstall()
  warns.mockRestore()
})

const blob = () => new Blob([new Uint8Array(8)], { type: 'video/mp4' })

describe('HTMLVideoFrameSource slots', () => {
  it('serves two requests in one frame from two elements, each at its own time', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())

    const [first, second] = await Promise.all([source.getFrame(0, 0), source.getFrame(10, 1)])

    expect(first).not.toBe(second)
    expect((first as HTMLVideoElement).currentTime).toBeCloseTo(0, 2)
    expect((second as HTMLVideoElement).currentTime).toBeCloseTo(10, 2)
    // One object URL, read by both elements.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(media.videos[1].src).toBe(media.videos[0].src)
  })

  it('serves slot 0 from the element it was created with', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())

    await expect(source.getFrame(1)).resolves.toBe(media.videos[0])
    await expect(source.getFrame(2, 0)).resolves.toBe(media.videos[0])
    expect(media.videos).toHaveLength(1)
  })

  it('creates a slot once, however many requests ask for it', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())

    const [a, b] = await Promise.all([source.getFrame(10, 1), source.getFrame(10, 1)])
    const c = await source.getFrame(10 + 1 / 30, 1)

    expect(a).toBe(b)
    expect(c).toBe(a)
    expect(media.videos).toHaveLength(2)
  })

  it('disposes every element and revokes the shared URL once', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())
    await Promise.all([source.getFrame(0, 0), source.getFrame(10, 1)])
    const [first, second] = media.videos

    await source.dispose()

    expect(first.src).toBe('')
    expect(second.src).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('serves nothing for a slot whose element will not load, says so once, and keeps the URL the first reads', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())
    media.script({ video: { fail: true } })

    // Three frames of the export: the slot is given up on at the first and
    // not retried, and only the first says so.
    for (let frame = 0; frame < 3; frame++) {
      await expect(source.getFrame(10 + frame / 30, 1)).resolves.toBeNull()
    }
    expect(media.videos).toHaveLength(2)
    expect(warns.mock.calls.filter((call: unknown[]) => String(call[0]).includes('second element'))).toHaveLength(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await expect(source.getFrame(1, 0)).resolves.toBe(media.videos[0])
  })

  it('leaves the clip out of every frame without a warning a frame through the frame manager', async () => {
    // The manager tells a decoded VideoFrame from an element with `instanceof`;
    // an export always runs where the class exists.
    // Restored on its own, not with `vi.unstubAllGlobals()`, which would also
    // drop the setup file's `URL` stubs (ESCSUITE-119).
    const real = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame')
    Object.defineProperty(globalThis, 'VideoFrame', { value: class {}, configurable: true, writable: true })
    onTestFinished(() => {
      if (real) Object.defineProperty(globalThis, 'VideoFrame', real)
      else delete (globalThis as { VideoFrame?: unknown }).VideoFrame
    })
    const manager = await createFrameManager(false)
    await loadFrameSource(manager, 'rec', blob(), 'video/mp4')
    media.script({ video: { fail: true } })

    for (let frame = 0; frame < 3; frame++) {
      expect(await getFrameAtTime(manager, 'rec', 10 + frame / 30, 1)).toBeNull()
    }
    expect(warns).toHaveBeenCalledTimes(1)
  })

  it('disposes cleanly while a slot it was asked for never loaded', async () => {
    const source = await HTMLVideoFrameSource.create('rec', blob())
    media.script({ video: { fail: true } })
    await expect(source.getFrame(10, 1)).resolves.toBeNull()

    await expect(source.dispose()).resolves.toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('grows a source made from an existing element over that element\'s own URL', async () => {
    const video = document.createElement('video')
    video.src = 'blob:existing'
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }))
    const source = HTMLVideoFrameSource.fromElement('rec', video)

    const second = await source.getFrame(10, 1)

    expect(second).not.toBe(video)
    expect((second as HTMLVideoElement).src).toBe('blob:existing')
  })
})

describe('a decode-worker source handed over to the <video> path', () => {
  it('keeps each slot on its own element after the handover', async () => {
    const factory = new FrameSourceFactory(true)
    await factory.initialize()
    const source = await factory.createSource('rec', blob(), 'video/mp4')

    const [first, second] = await Promise.all([source.getFrame(0, 0), source.getFrame(10, 1)])

    expect(first).not.toBe(second)
    expect((first as HTMLVideoElement).currentTime).toBeCloseTo(0, 2)
    expect((second as HTMLVideoElement).currentTime).toBeCloseTo(10, 2)
    await source.dispose()
    factory.dispose()
  })
})
