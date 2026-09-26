// Per-frame work ceilings for the MP4 converter.
//
// The converter is the other loop that runs once per frame for as long as a
// recording lasts, and the one that holds GPU memory while it does: every
// presented frame becomes a `VideoFrame`, and a frame that is not closed again
// is memory the browser cannot reclaim. `converter.test.ts` asserts that no
// frame leaks in each of its scenarios; what is pinned here is the accounting
// over a *run of frames* — created, closed, encoded and drawn all equal, and
// one canvas draw per frame rather than a second pass over the same pixels.
//
// Ceilings are 2x the measured value rounded up, with the measurement and its
// date beside them; the conservation laws (created == closed == encoded) are
// exact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  convertToMP4,
  convertToM4A,
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
  getCreatedEncoders,
  allFramesClosed,
  allEncodersClosed,
  AudioEncoderDouble,
  VideoEncoderDouble,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  createAudioBufferDouble,
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
import { getLastCanvasContext, resetCanvasContextDouble } from '../test/doubles/canvas'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('webm-duration-fix', () => ({ default: vi.fn() }))

/** One second of 30 fps recording. */
const FRAMES = 30

const SOURCE = new Blob(['0123456789'], { type: 'video/webm' })

let audio: AudioContextDoubleControl
let raf: RafDouble
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  raf = installRafDouble()
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  resetCanvasContextDouble()
  installVideoElementDouble()
  resetVideoElementDouble()
  audio = installAudioContextDouble()
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  uninstallVideoElementDouble()
  uninstallAudioContextDouble()
  uninstallWebCodecsDoubles()
  raf.uninstall()
  warns.mockRestore()
  errors.mockRestore()
  vi.restoreAllMocks()
})

/** Let real promise jobs (Blob.arrayBuffer, MessageChannel yields) settle. */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

/** Convert a recording whose playback presents `count` frames, and wait for it. */
async function convert(count: number): Promise<void> {
  const progress: ConversionProgress[] = []
  const promise = convertToMP4(SOURCE, (p) => progress.push(p))
  promise.catch(() => {})

  const video = getLastVideoDouble() as VideoElementDouble
  video.enableRequestVideoFrameCallback()
  video.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: count / 30 })
  video.fireLoadedMetadata()

  await settle()
  for (let i = 0; i < count; i++) video.presentFrame(i / 30)
  video.fireEnded()
  await settle()

  await promise
}

describe('converter per-frame work', () => {
  it('creates, closes and encodes exactly one frame per presented frame', async () => {
    await convert(FRAMES)

    const frames = getCreatedFrames('VideoFrame')
    // Exact: a conversion that dropped a close() would hold every decoded
    // frame's pixels until the tab went away.
    expect(frames).toHaveLength(FRAMES)
    expect(frames.filter((f) => f.closed)).toHaveLength(FRAMES)
    expect(allFramesClosed()).toBe(true)
    // Exact: one encode() per presented frame, and one flush() for the run.
    expect(lastVideoEncoder().encodes).toHaveLength(FRAMES)
    expect(lastVideoEncoder().flushCalls).toBe(1)
  })

  it('draws each frame to the capture canvas exactly once', async () => {
    await convert(FRAMES)

    const ctx = getLastCanvasContext()!
    const draws = ctx.calls.filter((c) => c.method === 'drawImage')

    // Exact: the frame is drawn once and captured; a second pass over the same
    // 1280x720 pixels would double the conversion's per-frame cost.
    expect(draws).toHaveLength(FRAMES)
    // Measured 2026-09-12: 1 canvas call per frame — the drawImage and nothing
    // else. No clear, no save/restore, no filter.
    expect(ctx.calls.length / FRAMES).toBeLessThanOrEqual(2)
  })

  it('leaves nothing scheduled when the conversion finishes', async () => {
    await convert(FRAMES)

    // The rVFC fast path should never fall back to the rAF loop, and whichever
    // ran must not still be queued once the blob is handed back.
    expect(raf.pending()).toBe(0)
    expect(audio.contexts.every((c) => c.state === 'closed')).toBe(true)
  })
})

// The audio-only (M4A) conversion has no per-frame half at all: no playback,
// no canvas, no VideoFrame. What it does have is the same 1024-sample AAC loop
// the MP4 conversion runs at the end, and the same conservation laws apply to
// it — one encode per chunk, one flush for the run, every AudioData closed.
describe('audio-only (M4A) per-chunk work', () => {
  /** Two seconds of 48 kHz audio, which is 96,000 samples per channel. */
  const AUDIO_SAMPLES = 96_000
  /** …and 94 chunks of 1024, the last one short. */
  const CHUNKS = Math.ceil(AUDIO_SAMPLES / 1024)

  async function convertAudio(): Promise<void> {
    audio.decodeResult = createAudioBufferDouble({ length: AUDIO_SAMPLES })
    await convertToM4A(SOURCE, () => {})
  }

  it('encodes exactly one AAC chunk per 1024 samples, and flushes once', async () => {
    await convertAudio()

    // Exact: a chunk encoded twice is a doubled file, and a dropped flush is
    // a truncated one.
    expect(lastAudioEncoder().encodes).toHaveLength(CHUNKS)
    expect(lastAudioEncoder().flushCalls).toBe(1)
    expect(getCreatedFrames('AudioData')).toHaveLength(CHUNKS)
    expect(allFramesClosed()).toBe(true)
  })

  it('does no video work at all', async () => {
    await convertAudio()

    // Exact: the point of the format. A VideoEncoder configured here, or a
    // canvas drawn to, would be the whole cost of an MP4 conversion spent on
    // a file with no picture in it.
    expect(VideoEncoderDouble.instances).toHaveLength(0)
    expect(getCreatedFrames('VideoFrame')).toHaveLength(0)
    expect(getLastCanvasContext()).toBeNull()
    expect(audio.contexts.every((c) => c.state === 'closed')).toBe(true)
  })
})

// The composite path's per-frame work (ESCSUITE-14 slice 4).
//
// A composite frame is the plain frame plus one overlay: one more `drawImage`,
// one clip path, one balanced save/restore and one border stroke. The
// conservation laws here are the ones that would let the composite quietly cost
// twice what it should — a second pass over the same screen pixels, an overlay
// drawn more than once, a save() the stroke never restores — and they are
// exact. The one ceiling that is a cost rather than a law is 2x the measured
// value, as everywhere else.
describe('composite (screen + webcam) per-frame work', () => {
  const COMPANION = new Blob(['webcam-bytes'], { type: 'video/webm' })
  const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  /** Convert a companion take whose screen half presents `count` frames. */
  async function convertComposite(count: number): Promise<void> {
    const promise = convertToMP4(SOURCE, () => {}, undefined, {
      companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 },
    })
    promise.catch(() => {})

    const [screen, webcam] = getVideoDoubles()
    screen.enableRequestVideoFrameCallback()
    screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: count / 30 })
    screen.fireLoadedMetadata()
    webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: count / 30 })
    webcam.fireLoadedMetadata()

    await settle()
    for (let i = 0; i < count; i++) screen.presentFrame(i / 30)
    screen.fireEnded()
    await settle()

    await promise
  }

  it('creates, closes and encodes exactly one frame per presented frame', async () => {
    await convertComposite(FRAMES)

    const frames = getCreatedFrames('VideoFrame')
    // Exact, and the same law the plain path is held to: one composited frame
    // is one `VideoFrame`, and a frame that is not closed again is pixels the
    // browser cannot reclaim until the tab goes away. Two video elements do not
    // make two frames.
    expect(frames).toHaveLength(FRAMES)
    expect(frames.filter((f) => f.closed)).toHaveLength(FRAMES)
    expect(allFramesClosed()).toBe(true)
    expect(lastVideoEncoder().encodes).toHaveLength(FRAMES)
    expect(lastVideoEncoder().flushCalls).toBe(1)
  })

  it('draws the screen once and the camera once per encoded frame', async () => {
    await convertComposite(FRAMES)

    const ctx = getLastCanvasContext()!
    const draws = ctx.calls.filter((c) => c.method === 'drawImage')

    // Exact: two draws a frame and not three. A third would mean the screen was
    // passed over twice, which at 1280x720 is the single most expensive thing
    // this loop could do twice.
    expect(draws).toHaveLength(FRAMES * 2)
    // One canvas, not one per layer: a second canvas would be a second
    // full-frame allocation and a blit between them.
    expect(ctx.canvas.width).toBe(1280)
    expect(ctx.canvas.height).toBe(720)
    // Exact: the screen frame covers the canvas, so nothing clears it first.
    expect(ctx.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0)
  })

  it('balances every save with a restore, and stays inside its per-frame ceiling', async () => {
    await convertComposite(FRAMES)

    const ctx = getLastCanvasContext()!
    const count = (method: string) => ctx.calls.filter((c) => c.method === method).length

    // Exact: one save and one restore per frame. The overlay strokes its border
    // *outside* the clip, so the restore comes before the stroke and the pair
    // has to stay balanced — an extra restore() would pop a state this loop's
    // caller pushed.
    expect(count('save')).toBe(FRAMES)
    expect(count('restore')).toBe(FRAMES)
    // Exact: one clip path established per frame, and one only.
    expect(count('clip')).toBe(FRAMES)
    // Measured 2026-09-25: 11 canvas calls per composite frame — the screen
    // draw, then save, beginPath, arc, closePath, clip, the camera draw,
    // restore, beginPath, arc, stroke. (The live compositor measures 12 for the
    // same overlay: it clears to black first, and the composite has no reason
    // to, because the screen frame covers the canvas.)
    expect(ctx.calls.length / FRAMES).toBeLessThanOrEqual(22)
  })

  it('leaves neither element playing and nothing scheduled', async () => {
    await convertComposite(FRAMES)

    const [screen, webcam] = getVideoDoubles()
    expect(screen.pause).toHaveBeenCalled()
    expect(webcam.pause).toHaveBeenCalled()
    // The rVFC fast path must not have fallen back to the rAF loop, and one
    // AudioContext was opened and closed — the camera part is never decoded for
    // audio, because the primary's track already is the mix.
    expect(raf.pending()).toBe(0)
    expect(audio.contexts).toHaveLength(1)
    expect(audio.contexts.every((c) => c.state === 'closed')).toBe(true)
  })
})

// The encoder accounting (ESCSUITE-74).
//
// A `VideoEncoder`/`AudioEncoder` is a hardware encode session, and `close()` is
// the only way to give one back. The success path was never the interesting one:
// the `close()` calls sat on it, after the flush, so a conversion that was
// cancelled or whose codec died left a session open for as long as the tab did —
// and a user who cancels an MP4 is usually a user who is about to start another
// one.
//
// So this counts encoders built against encoders released, on all three outcomes
// of all three conversions. It is **exact rather than a ceiling**, because there
// is no "about right" number of open encode sessions. An encoder that reported
// its own asynchronous failure closed *itself*, exactly as the real API does, so
// the law is in two halves: none of them is left open (`allEncodersClosed`), and
// the conversion asked at most once (`closeCalls`, which is 0 for the encoder
// that closed itself — the guard the one release point is written with). The
// other half of "at most once" is enforced by the double, whose `close()` throws
// on an already-closed encoder the way the real API does.
describe('encoder release', () => {
  const COMPANION = new Blob(['webcam-bytes'], { type: 'video/webm' })
  const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  interface Running {
    promise: Promise<Blob>
    video: VideoElementDouble
  }

  /** Start a conversion of a take *with* audio, so two encoders are in play. */
  function startPlain(signal?: AbortSignal): Running {
    audio.decodeResult = createAudioBufferDouble({ length: 2400 })
    const promise = convertToMP4(SOURCE, () => {}, signal)
    promise.catch(() => {})
    const video = getLastVideoDouble() as VideoElementDouble
    video.enableRequestVideoFrameCallback()
    video.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 1 })
    video.fireLoadedMetadata()
    return { promise, video }
  }

  /** The same, as a composite of a separate-tracks take. */
  function startComposite(signal?: AbortSignal): Running {
    audio.decodeResult = createAudioBufferDouble({ length: 2400 })
    const promise = convertToMP4(SOURCE, () => {}, signal, {
      companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 },
    })
    promise.catch(() => {})
    const [screen, webcam] = getVideoDoubles()
    screen.enableRequestVideoFrameCallback()
    screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 1 })
    screen.fireLoadedMetadata()
    webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: 1 })
    webcam.fireLoadedMetadata()
    return { promise, video: screen }
  }

  /** Play a conversion to its end and let it finish. */
  async function finish({ promise, video }: Running): Promise<void> {
    await settle()
    for (let i = 0; i < FRAMES; i++) video.presentFrame(i / 30)
    video.fireEnded()
    await settle()
    await promise
  }

  /** Cancel a conversion one frame in. */
  async function cancel(running: Running, controller: AbortController): Promise<void> {
    await settle()
    running.video.presentFrame(0)
    controller.abort()
    await expect(running.promise).rejects.toBeInstanceOf(ConversionAbortedError)
  }

  /** The encoders' close() counts, in the order they were constructed. */
  const closeCalls = (): number[] => getCreatedEncoders().map((e) => e.closeCalls)

  describe.each([
    ['plain MP4', startPlain],
    ['composite MP4', startComposite],
  ])('%s', (_name, begin) => {
    it('closes both encoders exactly once when it succeeds', async () => {
      await finish(begin())

      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([1, 1])
    })

    it('closes both encoders exactly once when it is cancelled', async () => {
      const controller = new AbortController()
      await cancel(begin(controller.signal), controller)

      // The point of the ticket: the two `close()` calls used to sit after the
      // flush, which a cancellation never reaches.
      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([1, 1])
    })

    it('leaves nothing open when an encoder fails asynchronously', async () => {
      VideoEncoderDouble.failNextAt = 'encode'
      const running = begin()
      await settle()
      running.video.presentFrame(0)

      await expect(running.promise).rejects.toThrow('VideoEncoder encoding error')
      // The video encoder closed itself when it failed, so the conversion must
      // not close it again — an InvalidStateError from the release would be
      // thrown out of the `finally` and replace the codec's own message.
      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([0, 1])
    })
  })

  describe('M4A', () => {
    it('closes its one encoder exactly once when it succeeds', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      await convertToM4A(SOURCE, () => {})

      expect(getCreatedEncoders()).toHaveLength(1)
      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([1])
    })

    it('closes its one encoder exactly once when it is cancelled', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      const controller = new AbortController()
      controller.abort()

      await expect(convertToM4A(SOURCE, () => {}, controller.signal)).rejects.toBeInstanceOf(
        ConversionAbortedError
      )
      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([1])
    })

    it('leaves nothing open when its encoder fails asynchronously', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 2400 })
      AudioEncoderDouble.failNextAt = 'encode'

      await expect(convertToM4A(SOURCE, () => {})).rejects.toThrow('AudioEncoder encoding error')
      expect(allEncodersClosed()).toBe(true)
      expect(closeCalls()).toEqual([0])
    })
  })
})
