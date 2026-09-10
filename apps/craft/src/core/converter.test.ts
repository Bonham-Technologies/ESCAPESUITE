import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  convertToMP4,
  remuxToWebM,
  fixWebMMetadata,
  isMP4ConversionSupported,
  isWebMRemuxSupported,
  ConversionAbortedError,
  type ConversionProgress,
} from './converter'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  lastAudioEncoder,
  getCreatedFrames,
  allFramesClosed,
  AudioEncoderDouble,
  VideoEncoderDouble,
} from '../test/doubles/webcodecs'
import {
  getMediabunnyState,
  lastMediabunnyOutput,
  resetMediabunnyDouble,
} from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  createAudioBufferDouble,
  lastAudioContext,
  type AudioBufferDouble,
  type AudioContextDoubleControl,
} from '../test/doubles/audio'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
  resetVideoElementDouble,
  type VideoElementDouble,
} from '../test/doubles/video'
import {
  getLastCanvasContext,
  resetCanvasContextDouble,
} from '../test/doubles/canvas'

const fixWebmDurationMock = vi.hoisted(() => vi.fn())

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('webm-duration-fix', () => ({ default: fixWebmDurationMock }))

// The rAF fallback path in captureFramesViaPlayback reschedules itself, so the
// double has to hold pending callbacks under test control rather than letting
// them run free against a torn-down environment.
const rafCallbacks = new Map<number, FrameRequestCallback>()
let nextRafHandle = 1
let originalRaf: typeof globalThis.requestAnimationFrame
let originalCancelRaf: typeof globalThis.cancelAnimationFrame

function installRafDouble(): void {
  originalRaf = globalThis.requestAnimationFrame
  originalCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const handle = nextRafHandle++
    rafCallbacks.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    rafCallbacks.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame
}

function uninstallRafDouble(): void {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  rafCallbacks.clear()
}

function tickAnimationFrames(): number {
  const pending = [...rafCallbacks.values()]
  rafCallbacks.clear()
  for (const cb of pending) cb(0)
  return pending.length
}

/** Let real promise jobs (Blob.arrayBuffer, MessageChannel yields) settle. */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

const SOURCE = new Blob(['0123456789'], { type: 'video/webm' })

interface StartOptions {
  width?: number
  height?: number
  duration?: number
  /** Give the element requestVideoFrameCallback (the fast path). */
  rvfc?: boolean
}

interface Started {
  promise: Promise<Blob>
  video: VideoElementDouble
  progress: ConversionProgress[]
  onProgress: ReturnType<typeof vi.fn>
}

function start(
  run: (onProgress: (p: ConversionProgress) => void) => Promise<Blob>,
  options: StartOptions = {}
): Started {
  const progress: ConversionProgress[] = []
  const onProgress = vi.fn((p: ConversionProgress) => {
    progress.push(p)
  })
  const promise = run(onProgress)
  // Rejection is asserted explicitly by the tests that expect one; attaching a
  // benign handler here keeps a not-yet-awaited rejection from being reported
  // as an unhandled rejection while the test is still driving playback.
  promise.catch(() => {})
  // Nothing has awaited yet, so the <video> exists with its handlers attached.
  const video = getLastVideoDouble()!
  if (options.rvfc !== false) video.enableRequestVideoFrameCallback()
  video.setMetadata({
    videoWidth: options.width ?? 1280,
    videoHeight: options.height ?? 720,
    duration: options.duration ?? 0.1,
  })
  video.fireLoadedMetadata()
  return { promise, video, progress, onProgress }
}

/** Present `count` frames through requestVideoFrameCallback, then end the video. */
async function playThroughRvfc(video: VideoElementDouble, count: number): Promise<void> {
  await settle()
  for (let i = 0; i < count; i++) video.presentFrame(i / 30)
  video.fireEnded()
  await settle()
}

function withoutGlobal(name: string, fn: () => void): void {
  const g = globalThis as unknown as Record<string, unknown>
  const saved = g[name]
  delete g[name]
  try {
    fn()
  } finally {
    g[name] = saved
  }
}

describe('converter', () => {
  let audio: AudioContextDoubleControl
  let consoleWarn: ReturnType<typeof vi.spyOn>
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rafCallbacks.clear()
    nextRafHandle = 1
    installRafDouble()
    installWebCodecsDoubles()
    resetWebCodecsDoubles()
    resetMediabunnyDouble()
    resetCanvasContextDouble()
    installVideoElementDouble()
    resetVideoElementDouble()
    audio = installAudioContextDouble()
    fixWebmDurationMock.mockReset()
    vi.mocked(URL.createObjectURL).mockClear()
    vi.mocked(URL.revokeObjectURL).mockClear()
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    uninstallVideoElementDouble()
    uninstallAudioContextDouble()
    uninstallWebCodecsDoubles()
    uninstallRafDouble()
    vi.restoreAllMocks()
  })

  // --- capability probes ---------------------------------------------------

  describe('capability probes', () => {
    it('report support when every WebCodecs global is present', () => {
      expect(isMP4ConversionSupported()).toBe(true)
      expect(isWebMRemuxSupported()).toBe(true)
    })

    it.each(['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioContext'])(
      'report no support when %s is missing',
      name => {
        withoutGlobal(name, () => {
          expect(isMP4ConversionSupported()).toBe(false)
          expect(isWebMRemuxSupported()).toBe(false)
        })
      }
    )

    it('refuses to convert without WebCodecs', async () => {
      const g = globalThis as unknown as Record<string, unknown>
      const saved = g.VideoEncoder
      delete g.VideoEncoder
      try {
        await expect(convertToMP4(SOURCE, vi.fn())).rejects.toThrow(
          'MP4 conversion requires WebCodecs API (Chrome/Edge)'
        )
        await expect(remuxToWebM(SOURCE, 1, vi.fn())).rejects.toThrow(
          'WebM remuxing requires WebCodecs API (Chrome/Edge)'
        )
      } finally {
        g.VideoEncoder = saved
      }
    })
  })

  // --- convertToMP4 happy path --------------------------------------------

  describe('convertToMP4', () => {
    it('produces an MP4 blob from an H.264 + AAC mux', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video, progress } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)

      const blob = await promise
      expect(blob.type).toBe('video/mp4')
      expect(blob.size).toBe(128)

      const state = getMediabunnyState()
      expect(state.formats.map(f => f.name)).toEqual(['mp4'])
      expect(state.formats[0].options).toEqual({ fastStart: 'in-memory' })
      expect(state.videoSources[0].codec).toBe('avc')
      expect(state.audioSources[0].codec).toBe('aac')
      expect(lastMediabunnyOutput().tracks.map(t => t.kind)).toEqual(['video', 'audio'])

      expect(lastVideoEncoder().configureCalls[0]).toEqual({
        codec: 'avc1.640028',
        width: 1280,
        height: 720,
        bitrate: 5_000_000,
        framerate: 30,
      })
      expect(lastAudioEncoder().configureCalls[0]).toEqual({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      })

      expect(progress[progress.length - 1]).toEqual({
        phase: 'finalizing',
        progress: 100,
        message: 'Conversion complete!',
      })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('reports progress that only moves forward, through every phase', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video, progress } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const values = progress.map(p => p.progress)
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
      }
      expect(values[0]).toBe(0)
      expect(values[values.length - 1]).toBe(100)

      const phases = [...new Set(progress.map(p => p.phase))]
      expect(phases).toEqual(['preparing', 'encoding', 'finalizing'])
      expect(progress.some(p => p.message === 'Encoding frame 3 of 3...')).toBe(true)
    })

    it('draws each played frame into a canvas sized to the source video', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { width: 640, height: 480 })
      await playThroughRvfc(video, 3)
      await promise

      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.width).toBe(640)
      expect(ctx.canvas.height).toBe(480)
      expect(ctx.drawImage).toHaveBeenCalledWith(video.element, 0, 0, 640, 480)
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
    })

    it('encodes a keyframe every 30 frames and closes every frame', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { duration: 1.1 })
      await settle()
      for (let i = 0; i < 33; i++) video.presentFrame(i / 30)
      video.fireEnded()
      await settle()
      await promise

      const encodes = lastVideoEncoder().encodes
      expect(encodes).toHaveLength(33)
      expect(encodes.filter((_, i) => i % 30 === 0).every(e => e.options?.keyFrame)).toBe(true)
      expect(encodes[1].options).toEqual({ keyFrame: false })
      expect(encodes.map(e => e.data.timestamp).slice(0, 3)).toEqual([0, 33333, 66666])
      expect(allFramesClosed()).toBe(true)
    })

    it('captures the frames still owed when the video ends early', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { duration: 0.1 })
      await settle()
      video.presentFrame(0)
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      video.fireEnded()
      await settle()
      await promise

      // ceil(0.1 * 30) = 3 frames must be produced whatever the playback did.
      expect(lastVideoEncoder().encodes).toHaveLength(3)
      expect(allFramesClosed()).toBe(true)
    })

    it.each([
      [1920, 1080, 8_000_000],
      [1280, 720, 5_000_000],
      [640, 360, 2_500_000],
    ])('picks the bitrate for %ix%i', async (width, height, bitrate) => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { width, height })
      await playThroughRvfc(video, 3)
      await promise

      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ bitrate })
    })

    it('feeds every encoded chunk to the mediabunny packet sources', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const state = getMediabunnyState()
      expect(state.videoSources[0].packets).toHaveLength(3)
      expect(state.videoSources[0].packets[0].packet).toMatchObject({ type: 'key' })
      expect(state.audioSources[0].packets).toHaveLength(1)
      expect(state.callLog.indexOf('Output.finalize')).toBeGreaterThan(
        state.callLog.indexOf('Output.start')
      )
    })

    it('closes the video encoder before finalizing', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(lastVideoEncoder().flushCalls).toBe(1)
      expect(lastVideoEncoder().closeCalls).toBe(1)
      expect(lastVideoEncoder().state).toBe('closed')
    })
  })

  // --- audio handling ------------------------------------------------------

  describe('audio extraction', () => {
    it('converts without audio when the blob has none to decode', async () => {
      audio.decodeResult = null // decodeAudioData rejects
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(getMediabunnyState().audioSources).toHaveLength(0)
      expect(lastMediabunnyOutput().addAudioTrack).not.toHaveBeenCalled()
      expect(AudioEncoderDouble.instances).toHaveLength(0)
      expect(lastAudioContext().close).toHaveBeenCalled()
    })

    it('converts without audio when AudioContext cannot be created at all', async () => {
      audio.constructorThrows = true
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(getMediabunnyState().audioSources).toHaveLength(0)
    })

    it('drops audio and warns when AAC is unsupported', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      AudioEncoderDouble.supportPlan = false
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(consoleWarn).toHaveBeenCalledWith('AAC not supported, converting without audio')
      expect(getMediabunnyState().audioSources).toHaveLength(0)
      expect(AudioEncoderDouble.instances).toHaveLength(0)
    })

    it('drops audio and warns when the AAC support probe itself fails', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      AudioEncoderDouble.supportPlan = 'throw'
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(consoleWarn).toHaveBeenCalledWith('Failed to check AAC support, converting without audio')
      expect(getMediabunnyState().audioSources).toHaveLength(0)
    })

    it('interleaves stereo samples into planar AudioData chunks', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4, sample: (c, i) => c * 10 + i })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const encodes = lastAudioEncoder().encodes
      expect(encodes).toHaveLength(1)
      const init = encodes[0].data.init!
      expect(init.format).toBe('f32-planar')
      expect(init.numberOfChannels).toBe(2)
      expect(init.numberOfFrames).toBe(4)
      expect(Array.from(init.data as Float32Array)).toEqual([0, 1, 2, 3, 10, 11, 12, 13])
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
    })

    it('duplicates the single channel of a mono source into both outputs', async () => {
      audio.decodeResult = createAudioBufferDouble({
        length: 4,
        numberOfChannels: 1,
        sample: (_c, i) => i,
      })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const init = lastAudioEncoder().encodes[0].data.init!
      expect(Array.from(init.data as Float32Array)).toEqual([0, 1, 2, 3, 0, 1, 2, 3])
    })

    it('resamples a lower-rate source up to 48kHz', async () => {
      audio.decodeResult = createAudioBufferDouble({
        length: 4,
        sampleRate: 24000,
        sample: (c, i) => c * 10 + i,
      })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const init = lastAudioEncoder().encodes[0].data.init!
      expect(init.numberOfFrames).toBe(8)
      expect(Array.from(init.data as Float32Array)).toEqual([
        0, 0, 1, 1, 2, 2, 3, 3,
        10, 10, 11, 11, 12, 12, 13, 13,
      ])
    })

    it('splits long audio into 1024-sample chunks with advancing timestamps', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      const encodes = lastAudioEncoder().encodes
      expect(encodes.map(e => e.data.init!.numberOfFrames)).toEqual([1024, 1024, 352])
      const timestamps = encodes.map(e => e.data.init!.timestamp as number)
      expect(timestamps[0]).toBe(0)
      expect(timestamps[1]).toBeCloseTo((1024 / 48000) * 1_000_000, 5)
      expect(lastAudioEncoder().flushCalls).toBe(1)
      expect(lastAudioEncoder().closeCalls).toBe(1)
    })

    it('waits for the encoder queue to drain before pushing more audio', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      lastAudioEncoder().setQueueScript([25, 22, 5])
      for (let i = 0; i < 3; i++) video.presentFrame(i / 30)
      video.fireEnded()
      await settle(8)
      await promise

      expect(lastAudioEncoder().encodes).toHaveLength(3)
    })
  })

  // --- failure paths -------------------------------------------------------

  describe('failure handling', () => {
    it('rejects when the source video will not load', async () => {
      const progress: ConversionProgress[] = []
      const promise = convertToMP4(SOURCE, p => progress.push(p))
      const video = getLastVideoDouble()!
      video.fireError()

      await expect(promise).rejects.toThrow('Failed to load video')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('rejects when playback errors mid-capture', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      video.presentFrame(0)
      video.fireError()

      await expect(promise).rejects.toThrow('Video playback error')
      expect(video.pause).toHaveBeenCalled()
      expect(allFramesClosed()).toBe(true)
    })

    it('rejects when play() is refused', async () => {
      const progress: ConversionProgress[] = []
      const promise = convertToMP4(SOURCE, p => progress.push(p))
      const video = getLastVideoDouble()!
      video.enableRequestVideoFrameCallback()
      video.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 0.1 })
      video.play.mockRejectedValueOnce(new Error('NotAllowedError'))
      video.fireLoadedMetadata()

      await expect(promise).rejects.toThrow('NotAllowedError')
    })

    it('logs an asynchronous video encoder error', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      lastVideoEncoder().emitError('encoder died')
      video.fireEnded()
      await settle()
      await promise

      expect(consoleError).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
    })

    it('logs an asynchronous audio encoder error', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      lastAudioEncoder().emitError('audio encoder died')
      await playThroughRvfc(video, 3)
      await promise

      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
    })

    it('rejects when the muxer wrote no bytes', async () => {
      getMediabunnyState().producesBuffer = false
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)

      await expect(promise).rejects.toThrow('Conversion failed: no data was written to buffer')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })
  })

  // --- cancellation --------------------------------------------------------

  describe('cancellation', () => {
    it('aborts immediately when the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal))
      await settle()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(video.play).not.toHaveBeenCalled()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('aborts mid-capture, stopping playback and closing every frame', async () => {
      const controller = new AbortController()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal))
      await settle()
      video.presentFrame(0)
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(video.pause).toHaveBeenCalled()
      expect(video.cancelledFrameCallbacks.length).toBeGreaterThan(0)
      expect(allFramesClosed()).toBe(true)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('aborts before the audio pass, leaving the muxer unfinalized', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const controller = new AbortController()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal))
      await settle()
      for (let i = 0; i < 3; i++) video.presentFrame(i / 30)
      // Ending resolves the capture and detaches the abort listener; the next
      // cancellation is caught by the checkAborted() before audio encoding.
      video.fireEnded()
      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(lastAudioEncoder().encodes).toHaveLength(0)
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })

    it('carries the ConversionAbortedError name and message', () => {
      const error = new ConversionAbortedError()
      expect(error.name).toBe('ConversionAbortedError')
      expect(error.message).toBe('Conversion was cancelled')
    })
  })

  // --- requestAnimationFrame fallback --------------------------------------

  describe('requestAnimationFrame fallback (no requestVideoFrameCallback)', () => {
    it('captures frames from currentTime as the video plays', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()
      expect(rafCallbacks.size).toBe(1)

      video.setMetadata({ currentTime: 0.05 })
      tickAnimationFrames()
      expect(lastVideoEncoder().encodes).toHaveLength(2)

      video.setMetadata({ currentTime: 0.1, ended: true })
      tickAnimationFrames()
      await settle()

      const blob = await promise
      expect(blob.type).toBe('video/mp4')
      expect(lastVideoEncoder().encodes).toHaveLength(3)
      expect(allFramesClosed()).toBe(true)
    })

    it('stops requesting frames once every frame has been captured', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()

      video.setMetadata({ currentTime: 1 })
      tickAnimationFrames()
      await settle()
      await promise

      expect(lastVideoEncoder().encodes).toHaveLength(3)
      expect(rafCallbacks.size).toBe(0)
    })

    it('finishes on the ended event when playback stalls short of the frame count', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()

      video.setMetadata({ currentTime: 0.02 })
      tickAnimationFrames()
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      video.fireEnded()
      await settle()
      await promise

      expect(lastVideoEncoder().encodes).toHaveLength(3)
      expect(rafCallbacks.size).toBe(0)
    })

    it('tops up the remaining frames when the video ends part-way through a tick', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()

      // Only frame 0 is due at 0.02s, but the element has already ended, so the
      // tick itself must make up the shortfall rather than wait for more frames.
      video.setMetadata({ currentTime: 0.02, ended: true })
      tickAnimationFrames()
      await settle()
      await promise

      expect(lastVideoEncoder().encodes).toHaveLength(3)
      expect(rafCallbacks.size).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })

    it('rejects on a playback error and cancels the pending animation frame', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()
      expect(rafCallbacks.size).toBe(1)

      video.fireError()

      await expect(promise).rejects.toThrow('Video playback error')
      expect(rafCallbacks.size).toBe(0)
    })

    it('aborts mid-capture', async () => {
      const controller = new AbortController()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal), { rvfc: false })
      await settle()
      video.setMetadata({ currentTime: 0.05 })
      tickAnimationFrames()

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(rafCallbacks.size).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })
  })

  // --- remuxToWebM ---------------------------------------------------------

  describe('remuxToWebM', () => {
    it('produces a WebM blob muxed from VP9 + Opus', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video, progress } = start(p => remuxToWebM(SOURCE, 0.1, p))
      await playThroughRvfc(video, 3)

      const blob = await promise
      expect(blob.type).toBe('video/webm')
      expect(blob.size).toBe(128)

      const state = getMediabunnyState()
      expect(state.formats.map(f => f.name)).toEqual(['webm'])
      expect(state.videoSources[0].codec).toBe('vp9')
      expect(state.audioSources[0].codec).toBe('opus')
      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ codec: 'vp09.00.10.08' })
      expect(lastAudioEncoder().configureCalls[0]).toMatchObject({ codec: 'opus' })
      // Opus needs no isConfigSupported probe — unlike the MP4 path's AAC.
      expect(progress[progress.length - 1]).toEqual({
        phase: 'finalizing',
        progress: 100,
        message: 'WebM ready!',
      })
    })

    it('uses a keyframe every two seconds for seekability', async () => {
      const { promise, video } = start(p => remuxToWebM(SOURCE, 2.2, p), { duration: 2.2 })
      await settle()
      for (let i = 0; i < 66; i++) video.presentFrame(i / 30)
      video.fireEnded()
      await settle()
      await promise

      const encodes = lastVideoEncoder().encodes
      expect(encodes).toHaveLength(66)
      const keyIndexes = encodes.map((e, i) => (e.options?.keyFrame ? i : -1)).filter(i => i >= 0)
      expect(keyIndexes).toEqual([0, 60])
    })

    it('falls back to the supplied duration when the container reports Infinity', async () => {
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.2, p), { duration: Infinity })
      await settle()
      for (let i = 0; i < 6; i++) video.presentFrame(i / 30)
      video.fireEnded()
      await settle()
      await promise

      // ceil(0.2 * 30) = 6 frames, taken from the caller's duration.
      expect(lastVideoEncoder().encodes).toHaveLength(6)
    })

    it('remuxes video-only when there is no decodable audio', async () => {
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(getMediabunnyState().audioSources).toHaveLength(0)
      expect(AudioEncoderDouble.instances).toHaveLength(0)
    })

    it.each([
      [1920, 1080, 8_000_000],
      [1280, 720, 5_000_000],
      [640, 360, 2_500_000],
    ])('picks the bitrate for %ix%i', async (width, height, bitrate) => {
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p), { width, height })
      await playThroughRvfc(video, 3)
      await promise

      expect(lastVideoEncoder().configureCalls[0]).toMatchObject({ bitrate })
    })

    it('rejects when the muxer wrote no bytes', async () => {
      getMediabunnyState().producesBuffer = false
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p))
      await playThroughRvfc(video, 3)

      await expect(promise).rejects.toThrow('Remuxing failed: no data was written to buffer')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('aborts before the audio pass', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const controller = new AbortController()
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p, controller.signal))
      await settle()
      for (let i = 0; i < 3; i++) video.presentFrame(i / 30)
      video.fireEnded()
      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
    })

    it('waits for audio encoder backpressure to clear', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p))
      await settle()
      lastAudioEncoder().setQueueScript([30, 21, 0])
      for (let i = 0; i < 3; i++) video.presentFrame(i / 30)
      video.fireEnded()
      await settle(8)
      await promise

      expect(lastAudioEncoder().encodes).toHaveLength(3)
      expect(getMediabunnyState().audioSources[0].packets).toHaveLength(3)
    })

    it('rejects when the source video will not load', async () => {
      const promise = remuxToWebM(SOURCE, 1, vi.fn())
      getLastVideoDouble()!.fireError()

      await expect(promise).rejects.toThrow('Failed to load video')
    })

    it('logs asynchronous encoder errors from both encoders', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => remuxToWebM(SOURCE, 0.1, p))
      await settle()
      lastVideoEncoder().emitError('vp9 died')
      lastAudioEncoder().emitError('opus died')
      video.fireEnded()
      await settle()
      await promise

      expect(consoleError).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
    })
  })

  // --- fixWebMMetadata -----------------------------------------------------

  describe('fixWebMMetadata', () => {
    it('hands the blob to webm-duration-fix and returns its result', async () => {
      const fixed = new Blob(['fixed'], { type: 'video/webm' })
      fixWebmDurationMock.mockResolvedValue(fixed)

      const result = await fixWebMMetadata(SOURCE)

      expect(fixWebmDurationMock).toHaveBeenCalledWith(SOURCE)
      expect(result).toBe(fixed)
    })

    it('propagates a metadata-fix failure to the caller', async () => {
      fixWebmDurationMock.mockRejectedValue(new Error('corrupt cluster'))

      await expect(fixWebMMetadata(SOURCE)).rejects.toThrow('corrupt cluster')
    })
  })

  it('does not leak encoder instances between conversions', async () => {
    const first = start(p => convertToMP4(SOURCE, p))
    await playThroughRvfc(first.video, 3)
    await first.promise

    const second = start(p => remuxToWebM(SOURCE, 0.1, p))
    await playThroughRvfc(second.video, 3)
    await second.promise

    expect(VideoEncoderDouble.instances).toHaveLength(2)
    expect(VideoEncoderDouble.instances.every(e => e.state === 'closed')).toBe(true)
  })
})

/**
 * `audioBufferToFloat32` and the extraction path are exercised through the
 * public API above; these guard the module's own AudioBuffer double contract
 * so a silently-broken double cannot make those assertions vacuous.
 */
describe('audio buffer double', () => {
  it('produces the declared shape', () => {
    const buffer: AudioBufferDouble = createAudioBufferDouble({ length: 8, numberOfChannels: 2 })
    expect(buffer.duration).toBeCloseTo(8 / 48000, 10)
    expect(buffer.getChannelData(0)).toHaveLength(8)
    expect(() => buffer.getChannelData(5)).toThrow()
  })
})
