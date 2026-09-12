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
import { convertToMP4, type ConversionProgress } from './converter'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  getCreatedFrames,
  allFramesClosed,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
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
