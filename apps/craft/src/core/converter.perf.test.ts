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
import { convertToMP4, convertToM4A, type ConversionProgress } from './converter'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  lastAudioEncoder,
  getCreatedFrames,
  allFramesClosed,
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
