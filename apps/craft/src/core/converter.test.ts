import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  convertToMP4,
  convertToM4A,
  fixWebMMetadata,
  isMP4ConversionSupported,
  probeMP4Support,
  ConversionAbortedError,
  M4A_NO_AUDIO_MESSAGE,
  MP4_NO_WEBCODECS_REASON,
  MP4_NO_H264_REASON,
  MP4_NO_AUDIO_REASON,
  MP4_PROBE_FAILED_REASON,
  type CompositeCompanion,
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
  allEncodersClosed,
  webcodecsCallLog,
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
  getVideoDoubles,
  resetVideoElementDouble,
  type VideoElementDouble,
} from '../test/doubles/video'
import {
  getLastCanvasContext,
  resetCanvasContextDouble,
} from '../test/doubles/canvas'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'

const fixWebmDurationMock = vi.hoisted(() => vi.fn())

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('webm-duration-fix', () => ({ default: fixWebmDurationMock }))

// The rAF fallback path in captureFramesViaPlayback reschedules itself, so the
// double has to hold pending callbacks under test control rather than letting
// them run free against a torn-down environment.
let raf: RafDouble

const tickAnimationFrames = (): number => raf.tick()
const pendingFrameCount = (): number => raf.pending()

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

/**
 * The 'abort' listeners added and removed from the moment this is installed.
 *
 * `captureFramesViaPlayback` listens for its cancellation on the signal
 * `convertToMP4` builds for it (`conversionEncoders().signal`), which no test
 * can reach: it is not the caller's own signal, and the conversion's `finally`
 * detaches the caller's listener whether or not the capture detached its own.
 * So the question "did the capture stop listening when it left?" is asked at
 * the one place every signal goes through, `AbortSignal.prototype` — and not
 * at `EventTarget.prototype`, because under jsdom the `AbortSignal` the code
 * gets is Node's, whose `EventTarget` is a different class from the global
 * one this environment defines. Spied rather than replaced — the original
 * still runs — so nothing about the conversion changes by being counted.
 *
 * With no caller signal in play the conversion adds exactly one 'abort'
 * listener, so `added === removed` is the whole assertion.
 */
function trackAbortListeners(): { added: () => number; removed: () => number } {
  const added = vi.spyOn(AbortSignal.prototype, 'addEventListener')
  const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
  const count = (spy: typeof added): number =>
    spy.mock.calls.filter(([type]) => type === 'abort').length
  return { added: () => count(added), removed: () => count(removed) }
}

/**
 * Every encoder flush happened before the muxer was finalized.
 *
 * The invariant that decides whether a converted file is complete: packets
 * still sitting inside an encoder when `finalize()` runs are packets the muxer
 * never writes, so a conversion that flushed late would hand over a file
 * missing its tail — and no count of calls can see that. Both doubles push into
 * one ordered log (`webcodecsCallLog`, whose own comment names this as what it
 * is for), which is the only way to ask about order across the two of them.
 */
function expectEveryFlushBeforeFinalize(): void {
  const finalize = webcodecsCallLog.indexOf('Output.finalize')
  expect(finalize).toBeGreaterThan(-1)
  const flushes = webcodecsCallLog.flatMap((call, index) =>
    call.endsWith('.flush') ? [index] : []
  )
  // Never vacuous: a conversion that flushed nothing would otherwise pass.
  expect(flushes.length).toBeGreaterThan(0)
  expect(Math.max(...flushes)).toBeLessThan(finalize)
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
    raf = installRafDouble()
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
    raf.uninstall()
    vi.restoreAllMocks()
  })

  // --- capability probes ---------------------------------------------------

  describe('capability probes', () => {
    it('report support when every WebCodecs global is present', () => {
      expect(isMP4ConversionSupported()).toBe(true)
    })

    it.each(['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioContext'])(
      'report no support when %s is missing',
      name => {
        withoutGlobal(name, () => {
          expect(isMP4ConversionSupported()).toBe(false)
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
      } finally {
        g.VideoEncoder = saved
      }
    })
  })

  // --- probeMP4Support -----------------------------------------------------

  describe('probeMP4Support', () => {
    /**
     * A converter module whose probe has not been asked yet.
     *
     * `probeMP4Support()` memoises its answer for the life of the page — the
     * UI asks once — so a second probe is arranged by taking a fresh module
     * instance rather than by shipping a reset hook in production code. Only
     * the probe is taken from it: it touches the WebCodecs globals and nothing
     * else, so it needs none of the module doubles the conversion tests reach
     * through their own static import.
     */
    async function freshProbe(): Promise<typeof probeMP4Support> {
      vi.resetModules()
      return (await import('./converter')).probeMP4Support
    }

    it('reports support, audio included, when the browser can encode both H.264 and AAC', async () => {
      const probe = await freshProbe()

      await expect(probe()).resolves.toEqual({ supported: true, audio: true })
    })

    it('asks about the same H.264 and AAC configuration the conversion configures', async () => {
      // The whole point of the probe: a question about a *different* config
      // than `convertToMP4` will configure answers a different question than
      // the button is gating on.
      const videoAsked = vi.spyOn(VideoEncoderDouble, 'isConfigSupported')
      const audioAsked = vi.spyOn(AudioEncoderDouble, 'isConfigSupported')
      const probe = await freshProbe()

      await probe()

      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(videoAsked.mock.calls[0][0]).toEqual(lastVideoEncoder().configureCalls[0])
      // `convertToMP4` asks about AAC itself before adding the track; the
      // probe's question is the first one, and it is the same question.
      expect(audioAsked.mock.calls[0][0]).toEqual(lastAudioEncoder().configureCalls[0])
    })

    // ESCSUITE-61. Two encoders, two questions, two answers. The AAC answer is
    // not the H.264 answer's consequence: the M4A download needs only AAC, so
    // collapsing them disabled that button in a browser that could have written
    // the file, and titled it with a sentence about video.
    it('refuses, naming H.264, when the video encoder will not take that config — and still says AAC is there', async () => {
      VideoEncoderDouble.supportPlan = false
      const probe = await freshProbe()

      await expect(probe()).resolves.toEqual({
        supported: false,
        audio: true,
        reason: MP4_NO_H264_REASON,
        audioReason: undefined,
      })
    })

    it('answers no to both, with a sentence each, when neither encoder is there', async () => {
      VideoEncoderDouble.supportPlan = false
      AudioEncoderDouble.supportPlan = false
      const probe = await freshProbe()

      await expect(probe()).resolves.toEqual({
        supported: false,
        audio: false,
        reason: MP4_NO_H264_REASON,
        audioReason: MP4_NO_AUDIO_REASON,
      })
    })

    it('still offers the conversion, warning it will be silent, when only AAC is missing', async () => {
      // `convertToMP4` treats a missing AAC encoder as non-fatal — it drops the
      // audio and produces a working silent MP4 ("drops audio and warns when
      // AAC is unsupported", below). The probe has to agree with it: refusing
      // here would disable a button that works.
      AudioEncoderDouble.supportPlan = false
      const probe = await freshProbe()

      // `reason` is the MP4 verdict and there is nothing wrong with it; the
      // missing sound is `audioReason`, which is what the M4A gate and the
      // silent-file note read.
      await expect(probe()).resolves.toEqual({
        supported: true,
        audio: false,
        reason: undefined,
        audioReason: MP4_NO_AUDIO_REASON,
      })
    })

    it('refuses rather than rejecting when asking itself fails', async () => {
      // A probe that threw would leave the button stuck on "Checking...".
      VideoEncoderDouble.supportPlan = 'throw'
      const probe = await freshProbe()

      // Neither question got an answer, so both carry the same sentence — the
      // M4A button must not be left titled with silence.
      await expect(probe()).resolves.toEqual({
        supported: false,
        audio: false,
        reason: MP4_PROBE_FAILED_REASON,
        audioReason: MP4_PROBE_FAILED_REASON,
      })
    })

    it('refuses, naming WebCodecs, where the API is not there to ask', async () => {
      const g = globalThis as unknown as Record<string, unknown>
      const saved = g.VideoEncoder
      delete g.VideoEncoder
      try {
        const probe = await freshProbe()

        await expect(probe()).resolves.toEqual({
          supported: false,
          audio: false,
          reason: MP4_NO_WEBCODECS_REASON,
          audioReason: MP4_NO_WEBCODECS_REASON,
        })
      } finally {
        g.VideoEncoder = saved
      }
    })

    it('asks the browser once a page load, however many callers ask it', async () => {
      const videoAsked = vi.spyOn(VideoEncoderDouble, 'isConfigSupported')
      const probe = await freshProbe()

      const first = probe()
      const second = probe()

      expect(second).toBe(first)
      await expect(second).resolves.toEqual({ supported: true, audio: true })
      await probe()
      expect(videoAsked).toHaveBeenCalledTimes(1)
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

    it('flushes and closes the video encoder exactly once', async () => {
      // Both encoders are released in the conversion's one `finally`
      // (ESCSUITE-74), which runs after `finalize()` — so what has to be pinned
      // is not where the close sits but that the **flush** came first, which is
      // the half the file depends on.
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)
      await promise

      expect(lastVideoEncoder().flushCalls).toBe(1)
      expect(lastVideoEncoder().closeCalls).toBe(1)
      expect(lastVideoEncoder().state).toBe('closed')
      expect(lastAudioEncoder().flushCalls).toBe(1)
      expect(lastAudioEncoder().closeCalls).toBe(1)
      expectEveryFlushBeforeFinalize()
    })
  })

  // The composite: one MP4 from a take's two video files (ESCSUITE-14 decision
  // 3). What is asserted is that the camera goes back exactly where the live
  // compositor had it — the numbers come from `core/overlayGeometry.test.ts`,
  // which pins the same ones the preview is pinned at — that the take's audio
  // is the primary's and only the primary's, and that a camera part that
  // cannot be read costs the overlay and not the file.
  describe('convertToMP4 for a take with a webcam companion', () => {
    const COMPANION = new Blob(['webcam'], { type: 'video/webm' })

    const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

    interface StartedComposite {
      promise: Promise<Blob>
      screen: VideoElementDouble
      webcam: VideoElementDouble
      progress: ConversionProgress[]
      onCompanionSkipped: ReturnType<typeof vi.fn>
    }

    /**
     * Start a composite conversion and hand back both elements.
     *
     * The screen element is created first and the camera second, so
     * `getVideoDoubles()` is [screen, camera] — which is why the plain path's
     * own `start()` helper above, which reaches for the *last* element, still
     * addresses the right one for a three-argument call.
     */
    function startComposite(
      options: {
        startOffset?: number
        placement?: CompositeCompanion['placement']
        width?: number
        height?: number
        duration?: number
        onCompanionSkipped?: false
      } = {}
    ): StartedComposite {
      const progress: ConversionProgress[] = []
      const onCompanionSkipped = vi.fn()
      const promise = convertToMP4(
        SOURCE,
        (p) => progress.push(p),
        undefined,
        {
          companion: {
            blob: COMPANION,
            placement: options.placement ?? PLACEMENT,
            startOffset: options.startOffset ?? 0,
          },
          // `false` drops the callback entirely, which is the shape a caller
          // that does not want to be told takes.
          onCompanionSkipped:
            options.onCompanionSkipped === false ? undefined : onCompanionSkipped,
        }
      )
      promise.catch(() => {})

      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({
        videoWidth: options.width ?? 1280,
        videoHeight: options.height ?? 720,
        duration: options.duration ?? 0.1,
      })
      screen.fireLoadedMetadata()
      return { promise, screen, webcam, progress, onCompanionSkipped }
    }

    /** Give the camera element a decoded frame and let its metadata land. */
    function readyWebcam(webcam: VideoElementDouble): void {
      webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: 0.1 })
      webcam.fireLoadedMetadata()
    }

    it('draws the screen, then the camera through the take\'s stored placement', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // The screen fills the frame, once per captured frame, exactly as the
      // plain conversion does.
      expect(ctx.drawImage).toHaveBeenCalledWith(composite.screen.element, 0, 0, 1280, 720)
      // …and the camera lands in the circle the take was recorded with: radius
      // min(256,144)/2 = 72, centre (1132, 628), a landscape source cropped to
      // 480x480. The same numbers `overlayGeometry.test.ts` pins, which are the
      // same numbers `compositor.test.ts` pins for the live preview.
      expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
      expect(ctx.drawImage).toHaveBeenCalledWith(
        composite.webcam.element,
        80,
        0,
        480,
        480,
        1060,
        556,
        144,
        144
      )
    })

    it('scales the recorded 20px inset to the frame it is encoding', async () => {
      const composite = startComposite({
        width: 1920,
        height: 1080,
        placement: { position: 'top-left', size: 0.2, shape: 'rectangle' },
      })
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // 384 = 1920 * 0.2, 216 = 384 * 9/16, and the inset is 30 rather than 20
      // because the preview measured 20 against a canvas capped at 1280 — see
      // `overlayPaddingFor`.
      expect(ctx.drawImage).toHaveBeenCalledWith(composite.webcam.element, 30, 30, 384, 216)
    })

    it('plays both halves from the same moment and says it is loading the camera', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Started together, from zero, and played rather than seeked: both run at
      // 1x off the same wall clock, which is what keeps the two pictures
      // together without a seek per frame.
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
      expect(composite.webcam.element.currentTime).toBe(0)
      expect(composite.progress.map((p) => p.message)).toContain('Loading the webcam track…')
    })

    it('holds the camera back until the screen reaches its startOffset', async () => {
      const composite = startComposite({ startOffset: 0.5, duration: 1 })
      readyWebcam(composite.webcam)
      await settle()
      const ctx = getLastCanvasContext()!

      // Fifteen frames takes the screen to 14/30 = 0.466s — not yet.
      for (let i = 0; i < 15; i++) composite.screen.presentFrame(i / 30)
      expect(composite.webcam.play).not.toHaveBeenCalled()
      // …and not drawn either. `preload='auto'` gets the element to
      // `readyState >= 2` well before anything plays it, so a guard that asked
      // only about readiness would composite the camera's frozen *first* frame
      // over every screen frame before the offset — the one thing the offset
      // exists to prevent. Fifteen screen draws, no overlay work at all.
      expect(ctx.drawImage).toHaveBeenCalledTimes(15)
      expect(ctx.save).not.toHaveBeenCalled()

      // The sixteenth is 0.5s exactly, which is where this part begins.
      composite.screen.presentFrame(15 / 30)
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
      // …and from that frame on the camera is composited: the sixteenth frame
      // is the first with two draws in it.
      expect(ctx.save).toHaveBeenCalledTimes(1)
      expect(ctx.drawImage).toHaveBeenCalledTimes(17)

      composite.screen.fireEnded()
      await settle()
      await composite.promise
      // Started once, not once per frame.
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
      // 30 frames owed: 15 screen-only, then 15 with the camera on them.
      expect(ctx.drawImage).toHaveBeenCalledTimes(45)
      expect(ctx.save).toHaveBeenCalledTimes(15)
    })

    it('draws no camera on a frame it has no picture for yet', async () => {
      const composite = startComposite()
      // Metadata, but no decoded frame: readyState stays 0.
      composite.webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 0 })
      composite.webcam.fireLoadedMetadata()
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // The screen frames are still encoded — a screen-only frame is better
      // than a throw, and the same `readyState >= 2` guard `Compositor.drawFrame`
      // applies to the live overlay.
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
      expect(ctx.save).not.toHaveBeenCalled()
    })

    it('takes its audio from the primary alone — that file already is the mix', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Exactly one decode, of the primary's ten bytes. The mic and system
      // parts are a *second tap* on tracks the mix already read
      // (`core/webcodecs-recorder.ts`), so the primary's track is the mix —
      // decoding them would re-derive a buffer that is already in the file.
      expect(audio.contexts).toHaveLength(1)
      expect(audio.contexts[0].decodedByteLengths).toEqual([SOURCE.size])
    })

    it('writes the screen alone, and says so, when the camera part will not load', async () => {
      const composite = startComposite()
      composite.webcam.fireError()
      await playThroughRvfc(composite.screen, 3)

      const blob = await composite.promise
      // The file is still written: minutes of encoding must not be thrown away
      // because one of two files would not decode.
      expect(blob.type).toBe('video/mp4')
      const ctx = getLastCanvasContext()!
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
      expect(ctx.save).not.toHaveBeenCalled()
      // …and the caller is told, because the file is not what was asked for.
      expect(composite.onCompanionSkipped).toHaveBeenCalledTimes(1)
    })

    it('writes the screen alone for a caller that passed no callback at all', async () => {
      const composite = startComposite({ onCompanionSkipped: false })
      composite.webcam.fireError()
      await playThroughRvfc(composite.screen, 3)

      // `onCompanionSkipped` is optional: a caller that does not want to be
      // told still gets its screen-only MP4 rather than a TypeError.
      const blob = await composite.promise
      expect(blob.type).toBe('video/mp4')
      expect(composite.onCompanionSkipped).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The webcam track could not be read; converting the screen alone:',
        expect.any(Error)
      )
    })

    // The failure the header read cannot see. `loadedmetadata` fires for a
    // container whose pictures never decode, so the load promise resolves with
    // `null` and the skip report does not fire; the element's own `error` after
    // that point resolves an already-settled promise, i.e. says nothing either.
    // A frame count is the only honest question — and this was reaching the user
    // as a camera-less MP4 with nothing said about it.
    it('says so when the camera part parses but never decodes a frame', async () => {
      const composite = startComposite()
      // Metadata lands; `readyState` never reaches 2, so the per-frame guard
      // never draws.
      composite.webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 0 })
      composite.webcam.fireLoadedMetadata()
      await playThroughRvfc(composite.screen, 3)

      const blob = await composite.promise
      // Still a real file, exactly as when the header itself failed.
      expect(blob.type).toBe('video/mp4')
      const ctx = getLastCanvasContext()!
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
      expect(ctx.save).not.toHaveBeenCalled()
      // …and the caller is told, which is the whole point: the take's camera is
      // not in the file the user just asked for.
      expect(composite.onCompanionSkipped).toHaveBeenCalledTimes(1)
    })

    it('says it exactly once when the camera part errors after its header landed', async () => {
      const composite = startComposite()
      composite.webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 0 })
      composite.webcam.fireLoadedMetadata()
      // The decode failure arrives after the load promise settled, so the
      // load-failure path cannot report it — and the frame count must not report
      // it twice.
      composite.webcam.fireError()
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      expect(composite.onCompanionSkipped).toHaveBeenCalledTimes(1)
    })

    it('writes the screen alone for a caller with no callback when nothing decodes', async () => {
      const composite = startComposite({ onCompanionSkipped: false })
      composite.webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 0 })
      composite.webcam.fireLoadedMetadata()
      await playThroughRvfc(composite.screen, 3)

      // The same optionality the load-failure path has: nothing to tell, and no
      // TypeError for not having anyone to tell.
      const blob = await composite.promise
      expect(blob.type).toBe('video/mp4')
      expect(composite.onCompanionSkipped).not.toHaveBeenCalled()
    })

    it('releases both object URLs however it leaves', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Two elements, two blob URLs, two revokes: the camera's is created
      // outside the try so the finally can release it whatever happened.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(2)
    })

    it('swallows the camera play() that cancelling interrupts', async () => {
      // `cleanup()` pauses the camera element, and a pause() that lands while
      // play() is still resolving rejects that play() promise with AbortError —
      // which is exactly what a cancelled composite conversion does. The screen
      // element's play() is already `.catch`ed; the camera's must be too, or
      // every cancelled take leaves an unhandled rejection in the page.
      //
      // What is asserted is that a rejection *handler is attached*, not that no
      // unhandled rejection was reported: under vitest's worker pool a discarded
      // rejection reaches neither `process.on('unhandledRejection')` nor the
      // reporter, so the consequence is unobservable here and the cause is. The
      // doubles' play() resolves by default, which is the other half of why this
      // had to be asked for explicitly.
      const handlers: string[] = []
      const interruptedPlay = {
        then(): unknown {
          handlers.push('then')
          return interruptedPlay
        },
        catch(onRejected?: (reason: unknown) => void): unknown {
          handlers.push('catch')
          // Hand the handler the rejection a real interrupted play() would, so
          // what is pinned is that the converter swallows it rather than merely
          // that it asked for it.
          onRejected?.(
            new DOMException('The play() request was interrupted by a call to pause().', 'AbortError')
          )
          return interruptedPlay
        },
        finally(): unknown {
          handlers.push('finally')
          return interruptedPlay
        },
      }

      const controller = new AbortController()
      const promise = convertToMP4(SOURCE, () => {}, controller.signal, {
        companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 },
      })
      promise.catch(() => {})
      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 1 })
      screen.fireLoadedMetadata()
      readyWebcam(webcam)
      webcam.play.mockReturnValueOnce(interruptedPlay)

      await settle()
      expect(webcam.play).toHaveBeenCalledTimes(1)
      // Attached before the cancellation, because the rejection can arrive the
      // moment pause() does.
      expect(handlers).toContain('catch')

      controller.abort()
      // The cancellation is still the only thing the caller hears about.
      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(webcam.pause).toHaveBeenCalled()
    })

    it('stops the camera element when the conversion is cancelled', async () => {
      const controller = new AbortController()
      const progress: ConversionProgress[] = []
      const promise = convertToMP4(
        SOURCE,
        (p) => progress.push(p),
        controller.signal,
        { companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 } }
      )
      promise.catch(() => {})
      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 1 })
      screen.fireLoadedMetadata()
      readyWebcam(webcam)
      await settle()
      screen.presentFrame(0)

      controller.abort()
      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)

      // A cancelled conversion leaves neither element playing: the camera is
      // paused with the screen, in the one cleanup both go through.
      expect(screen.pause).toHaveBeenCalled()
      expect(webcam.pause).toHaveBeenCalled()
    })

    it('flushes the encoder before the muxer is finalized', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      expectEveryFlushBeforeFinalize()
    })

    // ESCSUITE-81. The camera element is started before the branch that plays
    // the screen (`startOverlayIfDue(0)`), so a screen that will not play is
    // the one failure that could leave a second <video> decoding behind a row
    // that has gone back to idle — and, with no frame drawn, the take's camera
    // is missing from a file the user never gets told about.
    it('stops the camera element too, and says so, when the screen will not play', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      composite.screen.play.mockRejectedValueOnce(new Error('NotAllowedError'))

      await expect(composite.promise).rejects.toThrow('NotAllowedError')
      // The camera was started — that is the point — and stopped with the
      // screen, in the one cleanup both go through.
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
      expect(composite.screen.pause).toHaveBeenCalledTimes(1)
      expect(composite.webcam.pause).toHaveBeenCalledTimes(1)
      // …and the report a camera part that drew nothing owes the caller is
      // made exactly once, as it is on every other way out.
      expect(composite.onCompanionSkipped).toHaveBeenCalledTimes(1)
      expect(allEncodersClosed()).toBe(true)
    })

    it('stops both elements, and says what the encoder said, when the encoder fails', async () => {
      // The composite is the path with two <video> elements decoding at once,
      // so an encoder failure that is not noticed is two decodes left running
      // for the rest of the take as well as an encode session held open
      // (ESCSUITE-74).
      VideoEncoderDouble.failNextAt = 'encode'
      const composite = startComposite({ duration: 1 })
      readyWebcam(composite.webcam)
      await settle()
      composite.screen.presentFrame(0)

      await expect(composite.promise).rejects.toThrow('VideoEncoder encoding error')
      expect(composite.screen.pause).toHaveBeenCalled()
      expect(composite.webcam.pause).toHaveBeenCalled()
      expect(lastVideoEncoder().state).toBe('closed')
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
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

      const encoder = lastAudioEncoder()
      expect(encoder.encodes).toHaveLength(3)
      // 2400 samples = 3 chunks. The first chunk sees 25 then 22 (both over the
      // limit, so it yields twice) before 5 lets it through; the remaining two
      // chunks each read an empty queue once. Without the drain loop the
      // caller would never read encodeQueueSize at all.
      expect(encoder.queueReads).toEqual([25, 22, 5, 0, 0])
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

    // ESCSUITE-81. A refused `play()` used to reject the capture promise
    // directly, without the `fail()` exit ESCSUITE-78 gave every other
    // failure. Nothing hung — the promise settled, so the conversion's one
    // `finally` still released the encoders and revoked the URLs — but the
    // capture left by no door at all: on the rVFC path the frame callback
    // registered immediately before `play()` stayed live, in both paths the
    // abort listener stayed attached and the element was left unpaused, and a
    // composite left the camera element playing with nothing said about it.
    // The whole teardown is asserted here because the rejection on its own
    // never saw any of it.
    it('rejects when play() is refused, tearing the capture down like any other failure', async () => {
      const listeners = trackAbortListeners()
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      video.play.mockRejectedValueOnce(new Error('NotAllowedError'))

      // The play error itself, not the abort the teardown runs through.
      await expect(promise).rejects.toThrow('NotAllowedError')
      // The frame callback is requested on the line above `play()`, so a
      // refusal is the one failure that can strand one: handle 1 is the only
      // one this capture ever asked for, and it was given back.
      expect(video.cancelledFrameCallbacks).toEqual([1])
      expect(video.hasPendingFrameCallback()).toBe(false)
      expect(video.pause).toHaveBeenCalledTimes(1)
      // …and nothing is still listening for a cancellation that can no longer
      // matter.
      expect(listeners.added()).toBe(1)
      expect(listeners.removed()).toBe(1)
      // The law the rest of the failure paths keep: every encoder built was
      // released, and none of them twice.
      expect(allEncodersClosed()).toBe(true)
    })

    // ESCSUITE-74. An encoder that fails does so through its `error:`
    // callback, which is on no await path at all: until this, the callback
    // only wrote a console line, the conversion carried on feeding a dead
    // codec, and what the user was told was whatever the flush afterwards
    // happened to do — in a real browser, an InvalidStateError about a
    // closed encoder, and here, a finished MP4 muxed from the packets that
    // had made it. The codec's own words are the useful half, and they are
    // what `mp4ConversionFailed()` now carries.
    it('rejects with the video encoder\'s own message when it fails asynchronously', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      lastVideoEncoder().emitError('encoder died')

      await expect(promise).rejects.toThrow('encoder died')
      // Still logged: the console line is where the browser's own stack
      // survives, and it is the only record when the rejection is swallowed.
      expect(consoleError).toHaveBeenCalledWith('Video encoder error:', expect.any(Error))
      // …and the capture stopped rather than spending the rest of the
      // recording drawing frames for a file that cannot be written.
      expect(video.pause).toHaveBeenCalled()
      expect(lastVideoEncoder().state).toBe('closed')
    })

    it('rejects with the audio encoder\'s own message, stopping the frame capture too', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      lastAudioEncoder().emitError('audio encoder died')

      await expect(promise).rejects.toThrow('audio encoder died')
      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
      // The failure was the *audio* encoder's, and the video half is what was
      // in flight: one failed encoder ends the conversion, because the file it
      // would write is not the one that was asked for.
      expect(video.pause).toHaveBeenCalled()
      // Neither encoder is left holding an encode session. The one that failed
      // closed itself, as the real API does; the other is released by the
      // conversion's one `finally`.
      expect(lastVideoEncoder().state).toBe('closed')
      expect(lastAudioEncoder().state).toBe('closed')
    })

    it('refuses to mux a file when an encoder failed after the last frame', async () => {
      // The failure that arrives between the last abort check and the muxer:
      // the AAC encoder reports it from inside the encode it could not do, and
      // there are too few chunks left for the every-hundredth check to see it.
      // A file muxed from a dead encoder's packets is truncated, and handing
      // one over silently is the whole bug.
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      AudioEncoderDouble.failNextAt = 'encode'
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await playThroughRvfc(video, 3)

      await expect(promise).rejects.toThrow('AudioEncoder encoding error')
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
      expect(lastVideoEncoder().state).toBe('closed')
      expect(lastAudioEncoder().state).toBe('closed')
    })

    it('stays a cancellation when the user cancels and an encoder then fails', async () => {
      // Precedence, and it matters: `useMp4Download` says nothing about a
      // conversion the user cancelled, and raises a notice for anything else.
      // An encoder that dies as the conversion is torn down must not turn a
      // cancel into "Conversion failed: …".
      const controller = new AbortController()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal))
      await settle()
      video.presentFrame(0)
      controller.abort()
      lastVideoEncoder().emitError('encoder died')

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
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
      // The encoder was configured and never flushed; cancelling must still
      // release it rather than leave a live encoder behind.
      expect(lastVideoEncoder().closeCalls).toBe(1)
      expect(lastVideoEncoder().state).toBe('closed')
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
      // The video encoder closed on the normal path; the audio encoder had
      // only been configured, and must not be left open by the abort.
      expect(lastVideoEncoder().closeCalls).toBe(1)
      expect(lastAudioEncoder().closeCalls).toBe(1)
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
      expect(pendingFrameCount()).toBe(1)

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
      expect(pendingFrameCount()).toBe(0)
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
      expect(pendingFrameCount()).toBe(0)
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
      expect(pendingFrameCount()).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })

    it('rejects on a playback error and cancels the pending animation frame', async () => {
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()
      expect(pendingFrameCount()).toBe(1)

      video.fireError()

      await expect(promise).rejects.toThrow('Video playback error')
      expect(pendingFrameCount()).toBe(0)
    })

    // ESCSUITE-81, the other branch. There is no frame callback to strand
    // here — `rafHandle` is only assigned inside the `then()` a refused
    // `play()` never reaches — so what this asks is that the rest of the exit
    // still happens: nothing scheduled, the element paused, the abort listener
    // dropped.
    it('tears down when play() is refused, with no animation frame to cancel', async () => {
      const listeners = trackAbortListeners()
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      video.play.mockRejectedValueOnce(new Error('NotAllowedError'))

      await expect(promise).rejects.toThrow('NotAllowedError')
      // Nothing is pending — and, the stronger half, nothing was ever asked
      // for: `pendingFrameCount()` alone reads 0 both for a loop that was
      // never started and for one that was started and cancelled, which is
      // the distinction `scheduled()` exists to make.
      expect(raf.scheduled()).toBe(0)
      expect(pendingFrameCount()).toBe(0)
      expect(video.pause).toHaveBeenCalledTimes(1)
      expect(listeners.added()).toBe(1)
      expect(listeners.removed()).toBe(1)
      expect(allEncodersClosed()).toBe(true)
    })

    it('aborts mid-capture', async () => {
      const controller = new AbortController()
      const { promise, video } = start(p => convertToMP4(SOURCE, p, controller.signal), { rvfc: false })
      await settle()
      video.setMetadata({ currentTime: 0.05 })
      tickAnimationFrames()

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      expect(pendingFrameCount()).toBe(0)
      expect(allFramesClosed()).toBe(true)
    })
  })

  // --- a throw inside a capture callback -----------------------------------

  // ESCSUITE-78. Every frame of a conversion is drawn from a browser callback
  // — a video-frame callback, an animation frame, an `ended` listener — and
  // the browser *swallows* a throw out of one of those: it is reported to the
  // page, and nothing else happens. The next frame is never requested, neither
  // `resolve` nor `reject` is ever reached, the capture promise stays pending
  // for the life of the tab, the conversion's one `finally` never runs, and
  // the recording row never leaves "Converting…" while every encoder it built
  // is still holding an encode session. `new VideoFrame()` on a zero-sized
  // canvas, a `drawImage` from an element that has errored, a frame that is
  // already closed: all raise exactly that, and ESCSUITE-74 fixed only the one
  // case that was reachable in practice (a dead encoder's `encode()`).
  //
  // So these arms raise the throw the way the browser delivers it — swallowed
  // at the dispatcher, never handed back to whatever presented the frame — and
  // ask the only question that matters: did the conversion settle, with the
  // error that stopped it? The one-second timeout is deliberate: a regression
  // here is a hang, and a hang should fail in a second rather than at the
  // runner's five.
  //
  // `convertToM4A` has no arm here because it has no callback to throw out of:
  // no <video>, no playback and no canvas — its whole loop is awaited, and
  // `converter.perf.test.ts` pins that it does no video work at all.
  describe('a throw inside a capture callback (ESCSUITE-78)', () => {
    const DRAW_FAILED = 'drawImage failed: the element is gone'
    const OVERLAY_FAILED = 'the camera element is gone'

    /**
     * Present a frame the way the browser's callback dispatcher does: a throw
     * out of the callback goes to the page's error handler, not back to
     * whatever presented the frame. Swallowing it here is what makes these
     * tests ask whether the conversion settles, instead of catching the throw
     * on the conversion's behalf and proving nothing.
     */
    function presentFrameAsBrowser(video: VideoElementDouble, mediaTime: number): void {
      try {
        video.presentFrame(mediaTime)
      } catch {
        // The dispatcher swallows it. So does this.
      }
    }

    /** The same, for the animation-frame dispatcher. */
    function tickAnimationFramesAsBrowser(): void {
      try {
        tickAnimationFrames()
      } catch {
        // The dispatcher swallows it. So does this.
      }
    }

    /** Make the next canvas draw throw, as a draw from a dead element does. */
    function breakNextDraw(): void {
      getLastCanvasContext()!.drawImage.mockImplementationOnce(() => {
        throw new Error(DRAW_FAILED)
      })
    }

    it('rejects with the drawing error when the frame callback throws', { timeout: 1000 }, async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      video.presentFrame(0)
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      breakNextDraw()
      presentFrameAsBrowser(video, 1 / 30)

      await expect(promise).rejects.toThrow(DRAW_FAILED)
      // The capture left by the abort path's door: the loop is stopped, the
      // element is paused, and nothing asked for another frame.
      expect(video.pause).toHaveBeenCalled()
      expect(video.hasPendingFrameCallback()).toBe(false)
      expect(video.cancelledFrameCallbacks.length).toBeGreaterThan(0)
      // …and the frame that was drawn before it, and both encoders, were let
      // go — which is what the conversion's one `finally` does, and which a
      // promise that never settles never reaches.
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
      // The `ended` listener is inert afterwards: a late end event must not
      // top up frames into an encoder that has already been released.
      video.fireEnded()
      expect(lastVideoEncoder().encodes).toHaveLength(1)
    })

    it('rejects with the drawing error when the animation-frame fallback throws', { timeout: 1000 }, async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()
      video.setMetadata({ currentTime: 0.02 })
      tickAnimationFrames()
      expect(lastVideoEncoder().encodes).toHaveLength(1)

      breakNextDraw()
      video.setMetadata({ currentTime: 0.05 })
      tickAnimationFramesAsBrowser()

      await expect(promise).rejects.toThrow(DRAW_FAILED)
      expect(video.pause).toHaveBeenCalled()
      expect(pendingFrameCount()).toBe(0)
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })

    it('rejects when the ended handler throws topping up the last frames', { timeout: 1000 }, async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      video.presentFrame(0)

      // Two of the three frames are still owed, so ending the video runs the
      // top-up loop — the second place in this path a draw can throw, and the
      // one whose throw the `ended` dispatcher swallows.
      breakNextDraw()
      video.fireEnded()

      await expect(promise).rejects.toThrow(DRAW_FAILED)
      expect(video.pause).toHaveBeenCalled()
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })

    it('rejects when the ended handler throws on the animation-frame fallback', { timeout: 1000 }, async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise, video } = start(p => convertToMP4(SOURCE, p), { rvfc: false })
      await settle()
      video.setMetadata({ currentTime: 0.02 })
      tickAnimationFrames()

      breakNextDraw()
      video.fireEnded()

      await expect(promise).rejects.toThrow(DRAW_FAILED)
      expect(video.pause).toHaveBeenCalled()
      expect(pendingFrameCount()).toBe(0)
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })

    it('rejects with the overlay error when a composite frame callback throws', { timeout: 1000 }, async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const promise = convertToMP4(SOURCE, () => {}, undefined, {
        companion: {
          blob: new Blob(['webcam'], { type: 'video/webm' }),
          placement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
          startOffset: 0,
        },
      })
      promise.catch(() => {})
      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 0.1 })
      screen.fireLoadedMetadata()
      webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: 0.1 })
      webcam.fireLoadedMetadata()
      await settle()
      screen.presentFrame(0)

      // The camera draw alone, by element identity: the screen half of the
      // same frame still has to succeed, or this would be the plain path's arm
      // over again rather than the overlay's.
      getLastCanvasContext()!.drawImage.mockImplementation((source: unknown) => {
        if (source === webcam.element) throw new Error(OVERLAY_FAILED)
      })
      presentFrameAsBrowser(screen, 1 / 30)

      await expect(promise).rejects.toThrow(OVERLAY_FAILED)
      // Both elements are stopped: the composite is the path with two <video>s
      // decoding at once, and a hang here leaves both of them running.
      expect(screen.pause).toHaveBeenCalled()
      expect(webcam.pause).toHaveBeenCalled()
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })

    it('closes the frame the encoder threw on, and rejects with what it said', { timeout: 1000 }, async () => {
      // The throw `guarded` was written for, raised from the one line of the
      // capture that is holding a `VideoFrame` when it happens: a codec that
      // has died throws out of `encode()` (ESCSUITE-74's shape), and the frame
      // two lines above it is 1280x720 of pixels nothing else will release.
      // Settling the conversion is only half the job if the frame leaks.
      VideoEncoderDouble.failNextAt = 'encodeThrow'
      const { promise, video } = start(p => convertToMP4(SOURCE, p))
      await settle()
      presentFrameAsBrowser(video, 0)

      await expect(promise).rejects.toThrow('VideoEncoder encode failed')
      expect(getCreatedFrames('VideoFrame')).toHaveLength(1)
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })

    it('rejects with the error that stopped it when the overlay report throws', { timeout: 1000 }, async () => {
      // `cleanup()` calls back into the caller — `onCompanionSkipped`, for a
      // camera part that parsed and never decoded a frame — and that callback
      // is the caller's code, so it can throw. It runs *inside* the failure
      // exit, so a throw there used to re-create the whole bug one level down:
      // `reject` was never reached and the conversion hung again.
      //
      // What the caller hears is the error that **stopped the conversion**,
      // not the one its own report raised: the draw that failed is the useful
      // half, and the report's throw is the caller's own bug, which goes on to
      // the page's error handler the way it would from any callback.
      const reportFailed = new Error('onCompanionSkipped threw')
      const onCompanionSkipped = vi.fn(() => {
        throw reportFailed
      })
      const promise = convertToMP4(SOURCE, () => {}, undefined, {
        companion: {
          blob: new Blob(['webcam'], { type: 'video/webm' }),
          placement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
          startOffset: 0,
        },
        onCompanionSkipped,
      })
      promise.catch(() => {})
      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 0.1 })
      screen.fireLoadedMetadata()
      // The camera part's header parses — so an overlay *is* built, and the
      // load-failure report never fires — but no frame of it ever decodes, so
      // the only report left is the frame count `cleanup()` takes.
      webcam.setMetadata({ videoWidth: 640, videoHeight: 480, duration: 0.1 })
      webcam.fireLoadedMetadata()
      await settle()
      screen.presentFrame(0)
      expect(onCompanionSkipped).not.toHaveBeenCalled()

      breakNextDraw()
      presentFrameAsBrowser(screen, 1 / 30)

      await expect(promise).rejects.toThrow(DRAW_FAILED)
      expect(onCompanionSkipped).toHaveBeenCalledTimes(1)
      expect(screen.pause).toHaveBeenCalled()
      expect(webcam.pause).toHaveBeenCalled()
      expect(allFramesClosed()).toBe(true)
      expect(allEncodersClosed()).toBe(true)
    })
  })


  // --- convertToM4A --------------------------------------------------------

  describe('convertToM4A', () => {
    /** Run an audio-only conversion, collecting every progress report. */
    function convertAudio(signal?: AbortSignal): {
      promise: Promise<Blob>
      progress: ConversionProgress[]
    } {
      const progress: ConversionProgress[] = []
      const promise = convertToM4A(SOURCE, p => progress.push(p), signal)
      promise.catch(() => {})
      return { promise, progress }
    }

    it('produces an audio/mp4 blob with an audio track and no video track at all', async () => {
      // The whole point of the format: an M4A is the take's sound, in a
      // container audio tools recognise. A video track — even an empty one —
      // would make it a video file again.
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise } = convertAudio()

      const blob = await promise
      expect(blob.type).toBe('audio/mp4')
      expect(blob.size).toBe(128)

      const state = getMediabunnyState()
      expect(state.formats.map(f => f.name)).toEqual(['mp4'])
      expect(state.formats[0].options).toEqual({ fastStart: 'in-memory' })
      expect(state.audioSources.map(s => s.codec)).toEqual(['aac'])
      expect(state.videoSources).toHaveLength(0)
      expect(lastMediabunnyOutput().addVideoTrack).not.toHaveBeenCalled()
      expect(lastMediabunnyOutput().addAudioTrack).toHaveBeenCalledTimes(1)
      // No frames are captured, so nothing plays and nothing is drawn.
      expect(VideoEncoderDouble.instances).toHaveLength(0)
      expect(getCreatedFrames('VideoFrame')).toHaveLength(0)
    })

    it('encodes the AAC configuration the codec probe asked about', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise } = convertAudio()
      await promise

      expect(lastAudioEncoder().configureCalls[0]).toEqual({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      })
    })

    it('splits the audio into 1024-sample chunks, flushes once and muxes every packet', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise } = convertAudio()
      await promise

      const encoder = lastAudioEncoder()
      expect(encoder.encodes.map(e => e.data.init!.numberOfFrames)).toEqual([1024, 1024, 352])
      expect(encoder.flushCalls).toBe(1)
      expect(encoder.closeCalls).toBe(1)
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
      expect(getMediabunnyState().audioSources[0].packets).toHaveLength(3)
      expect(lastMediabunnyOutput().finalizeCalls).toBe(1)
    })

    it('flushes the encoder before the muxer is finalized', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise } = convertAudio()
      await promise

      // The whole file is the audio here, so a late flush would lose the last
      // chunks of the only track there is.
      expectEveryFlushBeforeFinalize()
    })

    it('reports progress that only moves forward, through every phase, to 100', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const { promise, progress } = convertAudio()
      await promise

      expect(progress[0]).toEqual({
        phase: 'preparing',
        progress: 0,
        message: 'Extracting audio…',
      })
      // Every phase is visited, and none is revisited once it is left.
      const order = ['preparing', 'encoding', 'finalizing']
      const phases = progress.map(p => p.phase)
      expect([...new Set(phases)]).toEqual(order)
      expect(phases.map(phase => order.indexOf(phase))).toEqual(
        [...phases.map(phase => order.indexOf(phase))].sort((a, b) => a - b)
      )
      // The encoding pass is what the user watches, so it reports per chunk.
      expect(progress.filter(p => p.phase === 'encoding')).toHaveLength(3)
      expect(progress.every(p => p.message.length > 0)).toBe(true)
      for (let i = 1; i < progress.length; i++) {
        expect(progress[i].progress).toBeGreaterThanOrEqual(progress[i - 1].progress)
      }
      expect(progress[progress.length - 1].progress).toBe(100)
    })

    it('refuses a take that has no audio to extract, saying so', async () => {
      // A screen-only take. `convertToMP4` would convert it happily; there is
      // no audio file to be made of it, and the button is disabled for exactly
      // this reason — this is the defence behind that gate.
      audio.decodeResult = null // decodeAudioData rejects
      const { promise } = convertAudio()

      await expect(promise).rejects.toThrow(M4A_NO_AUDIO_MESSAGE)
      expect(getMediabunnyState().outputs).toHaveLength(0)
      expect(AudioEncoderDouble.instances).toHaveLength(0)
    })

    it('refuses, in the probe\'s own words, where the browser has no AAC encoder', async () => {
      // Unlike an MP4, which is muxed silent when AAC is missing, an M4A with
      // no audio codec is nothing at all. One wording for the one fact, shared
      // with the button's reason.
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      AudioEncoderDouble.supportPlan = false
      const { promise } = convertAudio()

      await expect(promise).rejects.toThrow(MP4_NO_AUDIO_REASON)
      expect(getMediabunnyState().outputs).toHaveLength(0)
      // …and refuses before decoding anything: the codec question is a
      // microsecond, the decode is the whole file.
      expect(audio.contexts).toHaveLength(0)
    })

    it('refuses the same way when asking about AAC throws', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      AudioEncoderDouble.supportPlan = 'throw'
      const { promise } = convertAudio()

      await expect(promise).rejects.toThrow(MP4_NO_AUDIO_REASON)
    })

    it('aborts on a cancelled signal, closing the encoder it had opened', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const controller = new AbortController()
      controller.abort()
      const { promise } = convertAudio(controller.signal)

      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)
      // The encoder is configured before the first chunk, so the abort leaves
      // one open unless the finally releases it.
      expect(lastAudioEncoder().state).toBe('closed')
      expect(lastAudioEncoder().encodes).toHaveLength(0)
      expect(lastMediabunnyOutput().finalize).not.toHaveBeenCalled()
    })

    it('rejects when the muxer wrote no bytes', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      getMediabunnyState().producesBuffer = false
      const { promise } = convertAudio()

      await expect(promise).rejects.toThrow('Conversion failed: no data was written to buffer')
    })

    it('logs an asynchronous audio encoder error', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const { promise } = convertAudio()
      await promise

      lastAudioEncoder().emitError('AAC encoder died')

      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
    })

    it('rejects with the encoder\'s own message when the AAC encoder fails mid-conversion', async () => {
      // Armed on the class because this conversion builds its encoder for
      // itself, part-way through an await chain no test can interleave with —
      // the encoder is only reachable once it is over (ESCSUITE-74).
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      AudioEncoderDouble.failNextAt = 'encode'
      const { promise } = convertAudio()

      await expect(promise).rejects.toThrow('AudioEncoder encoding error')
      expect(consoleError).toHaveBeenCalledWith('Audio encoder error:', expect.any(Error))
      // No file, and no encode session left open: the encoder that failed
      // closed itself, which is why the release below it is guarded.
      expect(lastMediabunnyOutput().finalizeCalls).toBe(0)
      expect(lastAudioEncoder().state).toBe('closed')
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

    const second = start(p => convertToMP4(SOURCE, p))
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
