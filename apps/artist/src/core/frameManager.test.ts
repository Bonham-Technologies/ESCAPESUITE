import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cleanupIterationFrames,
  createFrameManager,
  disposeFrameManager,
  getFrameAtTime,
  loadFrameSource,
  type FrameManager,
} from './frameManager'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { VideoFrameDouble, allFramesClosed, resetFrameRegistry } from '../test/doubles/webcodecs'

// The decode manager owns a Web Worker running WebCodecs, neither of which
// exists in jsdom. Stand in for it with a recording double that hands out the
// same VideoFrame doubles the rest of the suite uses, and let the real
// FrameSourceFactory / FrameSource code run against it.
const decoder = vi.hoisted(() => ({
  supported: true,
  loadSourceError: null as Error | null,
  getFrameError: null as Error | null,
  loadedSources: [] as string[],
  disposedSources: [] as string[],
  terminated: 0,
  frames: [] as Array<{ sourceId: string; timestamp: number }>,
  lastInitializeSignal: undefined as AbortSignal | undefined,
}))

vi.mock('./videoDecodeManager', () => ({
  VideoDecodeManager: class {
    static isSupported = () => decoder.supported

    async initialize(signal?: AbortSignal) {
      decoder.lastInitializeSignal = signal
    }

    async loadSource(sourceId: string, _data: ArrayBuffer, _mimeType: string) {
      if (decoder.loadSourceError) throw decoder.loadSourceError
      decoder.loadedSources.push(sourceId)
      return {
        sourceId,
        duration: 10,
        width: 1920,
        height: 1080,
        codec: 'avc1.640028',
        frameCount: 300,
        keyframeCount: 10,
      }
    }

    async getFrame(sourceId: string, timestamp: number) {
      if (decoder.getFrameError) throw decoder.getFrameError
      decoder.frames.push({ sourceId, timestamp })
      // Constructed through the global so it is the very class `instanceof
      // VideoFrame` checks against in the code under test.
      const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
      return new Frame({ timestamp })
    }

    async disposeSource(sourceId: string) {
      decoder.disposedSources.push(sourceId)
    }

    terminate() {
      decoder.terminated += 1
    }
  },
}))

const mp4 = () => new Blob(['mp4-bytes'], { type: 'video/mp4' })

describe('frameManager', () => {
  let media: MediaDoubles
  let previousVideoFrame: unknown

  beforeEach(() => {
    decoder.supported = true
    decoder.loadSourceError = null
    decoder.getFrameError = null
    decoder.loadedSources = []
    decoder.disposedSources = []
    decoder.terminated = 0
    decoder.frames = []
    decoder.lastInitializeSignal = undefined
    resetFrameRegistry()

    previousVideoFrame = (globalThis as unknown as Record<string, unknown>).VideoFrame
    ;(globalThis as unknown as Record<string, unknown>).VideoFrame = VideoFrameDouble
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    ;(globalThis as unknown as Record<string, unknown>).VideoFrame = previousVideoFrame
    media.uninstall()
    resetFrameRegistry()
  })

  describe('createFrameManager', () => {
    it('starts empty with WebCodecs enabled when the decoder supports it', async () => {
      const manager = await createFrameManager(true)

      expect(manager.useWebCodecs).toBe(true)
      expect(manager.sources.size).toBe(0)
      expect(manager.currentFrames.size).toBe(0)
    })

    it('reports WebCodecs disabled when the caller opts out', async () => {
      const manager = await createFrameManager(false)
      expect(manager.useWebCodecs).toBe(false)
    })

    // ESCSUITE-29 Mechanism 2: a cancelled export should not have to wait out
    // the decode manager's full startup timeout, so the signal is forwarded.
    it('forwards the abort signal to the decode manager', async () => {
      const controller = new AbortController()
      await createFrameManager(true, controller.signal)
      expect(decoder.lastInitializeSignal).toBe(controller.signal)
    })

    it('reports WebCodecs disabled when the platform does not support it', async () => {
      decoder.supported = false
      const manager = await createFrameManager(true)
      expect(manager.useWebCodecs).toBe(false)
    })
  })

  describe('loadFrameSource', () => {
    it('registers the source under its id and hands it back', async () => {
      const manager = await createFrameManager(true)

      const source = await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')

      expect(manager.sources.get('clip-a')).toBe(source)
      expect(source.getInfo()).toMatchObject({ sourceId: 'clip-a', width: 1920, height: 1080 })
      expect(decoder.loadedSources).toEqual(['clip-a'])
    })

    it('loads a non-MP4 source through the video element instead', async () => {
      const manager = await createFrameManager(true)

      const source = await loadFrameSource(
        manager,
        'clip-webm',
        new Blob(['webm'], { type: 'video/webm' }),
        'video/webm'
      )

      expect(source.requiresCleanup()).toBe(false)
      expect(decoder.loadedSources).toEqual([])
      expect(media.videos).toHaveLength(1)
    })
  })

  describe('getFrameAtTime', () => {
    it('returns the decoded frame and tracks it for cleanup', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')

      const frame = await getFrameAtTime(manager, 'clip-a', 1.5)

      expect(frame).toBeInstanceOf(VideoFrameDouble)
      expect(decoder.frames).toEqual([{ sourceId: 'clip-a', timestamp: 1.5 }])
      expect(manager.currentFrames.has(frame as VideoFrame)).toBe(true)
    })

    it('returns null for a source that was never loaded', async () => {
      const manager = await createFrameManager(true)
      expect(await getFrameAtTime(manager, 'missing', 0)).toBeNull()
    })

    it('warns and returns null when decoding the frame fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')
      decoder.getFrameError = new Error('decode failed')
      // Since ESCSUITE-254 a worker failure hands the source to a <video>
      // element; this is the case where that fails too.
      media.script({ video: { fail: true } })

      expect(await getFrameAtTime(manager, 'clip-a', 2)).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'Failed to get frame for clip-a at 2:',
        expect.any(Error)
      )
      expect(manager.currentFrames.size).toBe(0)
      warn.mockRestore()
    })

    it('does not track an HTMLVideoElement frame for closing', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-webm', new Blob(['webm'], { type: 'video/webm' }), 'video/webm')

      const frame = await getFrameAtTime(manager, 'clip-webm', 0)

      expect(frame).toBe(media.videos[0])
      expect(manager.currentFrames.size).toBe(0)
    })
  })

  describe('cleanupIterationFrames', () => {
    it('closes every frame fetched this iteration and forgets them', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')
      const first = (await getFrameAtTime(manager, 'clip-a', 0)) as unknown as VideoFrameDouble
      const second = (await getFrameAtTime(manager, 'clip-a', 1)) as unknown as VideoFrameDouble

      cleanupIterationFrames(manager)

      expect(first.closed).toBe(true)
      expect(second.closed).toBe(true)
      expect(manager.currentFrames.size).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })

    // ESCSUITE-123: a media pass and a transition pass can both ask for the
    // same source at the same timestamp in one export frame (the outgoing
    // clip of a whole-clip transition is "active" in its own right too). Both
    // calls must be tracked and closed — losing one is a leaked decoded
    // VideoFrame per affected frame.
    it('tracks and closes both frames when the same (sourceId, timestamp) is fetched twice', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')

      const first = (await getFrameAtTime(manager, 'clip-a', 1.5)) as unknown as VideoFrameDouble
      const second = (await getFrameAtTime(manager, 'clip-a', 1.5)) as unknown as VideoFrameDouble

      expect(first).not.toBe(second)
      expect(manager.currentFrames.size).toBe(2)

      cleanupIterationFrames(manager)

      expect(first.closed).toBe(true)
      expect(second.closed).toBe(true)
      expect(allFramesClosed()).toBe(true)
    })

    it('survives a frame that is already closed', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')
      const frame = (await getFrameAtTime(manager, 'clip-a', 0)) as unknown as VideoFrameDouble
      // A real VideoFrame throws when closed twice.
      frame.close = () => {
        throw new Error('already closed')
      }

      expect(() => cleanupIterationFrames(manager)).not.toThrow()
      expect(manager.currentFrames.size).toBe(0)
    })

    it('is a no-op when nothing was fetched', async () => {
      const manager = await createFrameManager(true)
      expect(() => cleanupIterationFrames(manager)).not.toThrow()
    })
  })

  describe('disposeFrameManager', () => {
    it('closes outstanding frames, disposes every source and tears down the factory', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')
      await loadFrameSource(manager, 'clip-b', mp4(), 'video/mp4')
      const frame = (await getFrameAtTime(manager, 'clip-a', 0)) as unknown as VideoFrameDouble

      await disposeFrameManager(manager)

      expect(frame.closed).toBe(true)
      expect(manager.currentFrames.size).toBe(0)
      expect(manager.sources.size).toBe(0)
      expect(decoder.disposedSources.sort()).toEqual(['clip-a', 'clip-b'])
      expect(decoder.terminated).toBe(1)
      expect(allFramesClosed()).toBe(true)
    })

    it('disposes an empty manager without complaint', async () => {
      const manager: FrameManager = await createFrameManager(false)
      await expect(disposeFrameManager(manager)).resolves.toBeUndefined()
    })

    // Mirrors cleanupIterationFrames' own "survives a frame that is already
    // closed" case: disposeFrameManager's outstanding-frame sweep
    // (cleanupCurrentFrames) must not let one frame's throwing close() stop
    // the rest being closed, or the sources being disposed and the factory
    // torn down.
    it('closes every remaining frame even when one throws while closing, and still disposes the sources', async () => {
      const manager = await createFrameManager(true)
      await loadFrameSource(manager, 'clip-a', mp4(), 'video/mp4')
      const first = (await getFrameAtTime(manager, 'clip-a', 0)) as unknown as VideoFrameDouble
      const second = (await getFrameAtTime(manager, 'clip-a', 1)) as unknown as VideoFrameDouble
      // A real VideoFrame throws when closed twice; stand in for whatever
      // makes one frame's close() throw.
      first.close = () => {
        throw new Error('already closed')
      }

      await expect(disposeFrameManager(manager)).resolves.toBeUndefined()

      expect(second.closed).toBe(true)
      expect(manager.currentFrames.size).toBe(0)
      expect(manager.sources.size).toBe(0)
      expect(decoder.disposedSources).toEqual(['clip-a'])
      expect(decoder.terminated).toBe(1)
    })
  })
})
