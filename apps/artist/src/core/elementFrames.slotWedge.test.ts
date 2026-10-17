// ESCSUITE-305 × ESCSUITE-313: a seek wedge on one of a source's two elements.
//
// Since ESCSUITE-313 a source with two clips live in one frame — the same
// recording on a track above as a zoom, a split clip crossfading into itself —
// is drawn from two `<video>` elements, one per slot, each with a playhead of
// its own. ESCSUITE-305's wedge count is therefore kept per element, not per
// source: one element can be stuck on a seek that never completes while the
// other seeks normally, and the healthy one's landed seeks must not keep
// starting the stuck one's run again. Each case below is that pair, both ways
// round; the refusal still names the source.
//
// Why the late-landing cases exist: the composer seeks both elements together
// and writes each one's count when its own waits are over, slot 0's first. A
// healthy seek that lands at once ends its waits early, so the stuck
// element's increment is the frame's last write either way round, and a count
// shared by the source would still refuse it — by accident. A healthy seek
// that lands *late* — after the 500 ms fallback, so its element is still
// seeking when the 300 ms readiness wait ends — counts one for its own frame
// and is cleared at the next frame's start, so its write is a small number.
// When that write comes after the stuck element's (the extra slot healthy and
// late, slot 0 stuck) a shared count is pulled back to 1 every frame and never
// reaches `WEDGED_SEEK_FRAMES`: the export completed with slot 0 black. That
// case is the one a per-source count fails; the per-element count refuses the
// source in all four.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFrameComposer, loadElementSources, rewindElementSources } from './elementFrames'
import { SourceNotSeekableError, WEDGED_SEEK_FRAMES } from './seekWedge'
import { storeVideo } from './storage'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip } from '../store/types'

const PROJECT = { width: 640, height: 360 }
const TWO_TRACKS = [makeTrack({ id: 'tA', index: 0 }), makeTrack({ id: 'tB', index: 1 })]
const SOURCE_NAME = 'zoomed-take.webm'
/** After the stuck element's own waits (500 ms seek fallback + 300 ms readiness). */
const LATE_MS = 850

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>
let rafs: Map<number, FrameRequestCallback>
let realRaf: typeof globalThis.requestAnimationFrame
let realCancel: typeof globalThis.cancelAnimationFrame

beforeEach(() => {
  installCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360, duration: 20 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // The readiness poll never answers here, so its 300 ms fallback is what
  // settles a wait for frame data — as in `elementFrames.test.ts`'s seek-wedge cases.
  rafs = new Map()
  realRaf = globalThis.requestAnimationFrame
  realCancel = globalThis.cancelAnimationFrame
  let next = 1
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const handle = next++
    rafs.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    rafs.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame
})

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCancel
  vi.useRealTimers()
  media.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
})

/** Clip A (slot 0) shows the source from 0 s; clip B (slot 1), on the track above, from 10 s. */
function zoomedPair(): Clip[] {
  return [
    makeClip({ id: 'A', sourceVideoId: 'v1', trackId: 'tA', startTime: 0, endTime: 1, duration: 1 }),
    makeClip({ id: 'B', sourceVideoId: 'v1', trackId: 'tB', startTime: 10, endTime: 11, duration: 1 }),
  ]
}

/** Slot 0's seeks target source time < 10, slot 1's ≥ 10. The rewind's seek to 0 is left alone. */
const isSlot0 = (t: number) => t > 0 && t < 10
const isSlot1 = (t: number) => t >= 10

async function composer() {
  await storeVideo('v1', new Blob([new Uint8Array(8)], { type: 'video/webm' }), makeSourceVideo({ id: 'v1' }))
  const clips = zoomedPair()
  const sources = await loadElementSources(
    clips,
    new Map([['v1', makeSourceVideo({ id: 'v1', name: SOURCE_NAME, duration: 20 })]]),
    []
  )
  const playbackState = rewindElementSources(sources)
  const canvas = document.createElement('canvas')
  canvas.width = PROJECT.width
  canvas.height = PROJECT.height
  canvas.getContext('2d', { alpha: false })
  const ctx = getLastCanvasContext() as RecordingCanvasRenderingContext2D
  const composeFrame = createFrameComposer({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    canvas,
    clips,
    tracks: TWO_TRACKS,
    sources,
    playbackState,
    projectSize: PROJECT,
    outputSize: PROJECT,
    drawOptions: { filterScale: 1 },
    frameRate: 30,
  })
  return { composeFrame, ctx }
}

/**
 * Compose frames 0, 1, 2, … at 30 fps, each given a second of fake time — long
 * enough for every wait and for a late seek to land before the next frame —
 * until one rejects or `count` frames have run. Resolves to the rejection, or
 * null when every frame completed.
 */
async function run(composeFrame: (t: number) => Promise<void>, count: number): Promise<unknown> {
  for (let i = 0; i < count; i++) {
    const pending = composeFrame(i / 30)
    pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(1_000)
    const error = await pending.then(
      () => null,
      (e: unknown) => e
    )
    if (error) return error
  }
  return null
}

const REFUSAL = `This browser cannot read "${SOURCE_NAME}" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.`

describe('createFrameComposer: a seek wedge on one of a source\'s two elements', () => {
  it('fails by name when the extra slot wedges and slot 0 seeks normally', async () => {
    media.script({ video: { wedgeSeekAt: isSlot1 } })
    const { composeFrame } = await composer()

    // The extra element is made on frame 0 and seeked to 10: wedged #1, #2, #3.
    const thrown = await run(composeFrame, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect(thrown).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', message: REFUSAL })
    expect(WEDGED_SEEK_FRAMES).toBe(3)
  })

  it('fails by name when the extra slot wedges and slot 0\'s seeks land after its waits', async () => {
    // Slot 0's healthy seeks outlast the seek fallback, so each counts one for
    // its own frame — and is cleared at the next frame's start, since it has
    // landed by then. The stuck element's run is its own.
    media.script({ video: { wedgeSeekAt: isSlot1, seekLandsAfterMsAt: (t) => (isSlot0(t) ? LATE_MS : undefined) } })
    const { composeFrame, ctx } = await composer()

    const thrown = await run(composeFrame, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect(thrown).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', message: REFUSAL })
    // Only slot 0's frame 0, already at its time, had a picture to draw.
    expect(ctx.argsFor('drawImage')).toHaveLength(1)
  })

  it('fails by name when slot 0 wedges and the extra slot seeks normally', async () => {
    media.script({ video: { wedgeSeekAt: isSlot0 } })
    const { composeFrame } = await composer()

    // Slot 0 needs no seek on frame 0 (the rewind left it there): wedged on 1, 2, 3.
    const thrown = await run(composeFrame, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect(thrown).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', message: REFUSAL })
  })

  it('fails by name when slot 0 wedges and the extra slot\'s seeks land after its waits', async () => {
    // The case a per-source count got wrong: the extra slot's count is written
    // after slot 0's, every frame, and pulled the shared run back to 1.
    media.script({ video: { wedgeSeekAt: isSlot0, seekLandsAfterMsAt: (t) => (isSlot1(t) ? LATE_MS : undefined) } })
    const { composeFrame } = await composer()

    const thrown = await run(composeFrame, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect(thrown).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', message: REFUSAL })
  })

  it('never refuses the source when both elements seek normally', async () => {
    const { composeFrame, ctx } = await composer()

    expect(await run(composeFrame, 10)).toBeNull()
    // Both clips drawn on every frame, from two elements.
    expect(ctx.argsFor('drawImage')).toHaveLength(20)
    expect(media.videos).toHaveLength(2)
  })
})
