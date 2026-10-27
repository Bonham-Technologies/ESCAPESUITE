// ESCSUITE-305 × ESCSUITE-313 on the in-page MP4 path: `HTMLVideoFrameSource`
// serves slot 0 from the element it was created with and slot k from a k-th
// element over the same object URL, and its wedge count is kept per element.
// The pair below is one source's two clips in one export frame, fetched
// together the way `exportMP4.ts`'s frame loop gathers them; one element is
// stuck on a seek that never completes while the other seeks normally.
//
// As in `elementFrames.slotWedge.test.ts`, the late-landing cases are the ones
// that tell a per-element count from one shared by the source. A healthy seek
// that lands after the 500 ms fallback is still in flight when the 100 ms
// readiness wait ends, so it counts one for its own request and is cleared at
// the next request's start. When its count is written after the stuck slot's —
// slot 1 healthy and late, slot 0 stuck — a shared count was pulled back to 1
// on every frame and the source was never refused.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HTMLVideoFrameSource } from './frameSource'
import { SEEK_IN_FLIGHT_GRACE_MS, SourceNotSeekableError } from './seekWedge'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'

const SOURCE_NAME = 'zoomed-take.webm'
/** After the stuck element's own waits (500 ms seek fallback + 100 ms readiness). */
const LATE_MS = 650

let media: MediaDoubles

beforeEach(() => {
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360, duration: 20 } })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  media.uninstall()
})

/** Slot 0 is asked for source time < 10, slot 1 for ≥ 10. The load's own time 0 is left alone. */
const isSlot0 = (t: number) => t > 0 && t < 10
const isSlot1 = (t: number) => t >= 10

const blob = () => new Blob([new Uint8Array(8)], { type: 'video/webm' })

/**
 * Fetch both slots for frames 1, 2, 3, … at 30 fps together, each frame given a
 * second of fake time, until one rejects or `count` frames have run. Resolves
 * to the rejection, or null when every frame completed.
 */
async function run(source: HTMLVideoFrameSource, count: number): Promise<unknown> {
  for (let i = 1; i <= count; i++) {
    const t = i / 30
    const pending = Promise.all([source.getFrame(t, 0), source.getFrame(10 + t, 1)])
    pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(1_000 + SEEK_IN_FLIGHT_GRACE_MS)
    const error = await pending.then(
      () => null,
      (e: unknown) => e
    )
    if (error) return error
  }
  return null
}

describe('HTMLVideoFrameSource: a seek wedge on one of a source\'s two slots', () => {
  it('fails by name when slot 1 wedges and slot 0 seeks normally', async () => {
    media.script({ video: { wedgeSeekAt: isSlot1 } })
    const source = await HTMLVideoFrameSource.create('v1', blob(), undefined, 30, SOURCE_NAME)

    const thrown = await run(source, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect((thrown as Error).message).toContain(`"${SOURCE_NAME}"`)
  })

  it('fails by name when slot 1 wedges and slot 0\'s seeks land after its waits', async () => {
    media.script({ video: { wedgeSeekAt: isSlot1, seekLandsAfterMsAt: (t) => (isSlot0(t) ? LATE_MS : undefined) } })
    const source = await HTMLVideoFrameSource.create('v1', blob(), undefined, 30, SOURCE_NAME)

    const thrown = await run(source, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect((thrown as Error).message).toContain(`"${SOURCE_NAME}"`)
  })

  it('fails by name when slot 0 wedges and slot 1\'s seeks land after its waits', async () => {
    // The case a per-source count got wrong (see the header).
    media.script({ video: { wedgeSeekAt: isSlot0, seekLandsAfterMsAt: (t) => (isSlot1(t) ? LATE_MS : undefined) } })
    const source = await HTMLVideoFrameSource.create('v1', blob(), undefined, 30, SOURCE_NAME)

    const thrown = await run(source, 10)

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
  })

  it('never refuses the source when both slots seek normally', async () => {
    const source = await HTMLVideoFrameSource.create('v1', blob(), undefined, 30, SOURCE_NAME)

    expect(await run(source, 10)).toBeNull()
    expect(media.videos).toHaveLength(2)
  })
})
