// `assignElementSlots` (ESCSUITE-313) and the preview's sticky assigner
// (ESCSUITE-323): which of its source's `<video>` elements each live clip
// draws from. The composer, the in-page MP4 path and the preview all ask
// them, so their rules are pinned here once.
import { describe, it, expect } from 'vitest'
import { assignElementSlots, createStickySlotAssigner, videoForSlot } from './elementSlots'
import { makeClip } from '../test/fixtures/clipFixtures'
import type { Clip } from '../store/types'

const live = (...clips: Clip[]) => clips.map((clip) => ({ clip }))

function slotsOf(activeClips: Array<{ clip: Clip }>, transition: Parameters<typeof assignElementSlots>[1] = null) {
  const out = new Map<string, number>()
  assignElementSlots(activeClips, transition, out)
  return Object.fromEntries(out)
}

describe('assignElementSlots', () => {
  it('numbers the live clips of one source in the order given — track order', () => {
    const a = makeClip({ id: 'a', sourceVideoId: 'v1' })
    const b = makeClip({ id: 'b', sourceVideoId: 'v1' })
    const c = makeClip({ id: 'c', sourceVideoId: 'v1' })

    expect(slotsOf(live(a, b, c))).toEqual({ a: 0, b: 1, c: 2 })
    expect(slotsOf(live(c, a, b))).toEqual({ c: 0, a: 1, b: 2 })
  })

  it('numbers each source on its own', () => {
    const a = makeClip({ id: 'a', sourceVideoId: 'v1' })
    const b = makeClip({ id: 'b', sourceVideoId: 'v2' })
    const c = makeClip({ id: 'c', sourceVideoId: 'v1' })

    expect(slotsOf(live(a, b, c))).toEqual({ a: 0, b: 0, c: 1 })
  })

  it('gives an overlay no slot', () => {
    const text = makeClip({ id: 't', sourceVideoId: '', overlayType: 'text' })
    const a = makeClip({ id: 'a', sourceVideoId: 'v1' })

    expect(slotsOf(live(text, a))).toEqual({ a: 0 })
  })

  it('keeps a transition\'s live outgoing side where it is and gives the incoming side the next free slot', () => {
    const outgoing = makeClip({ id: 'out', sourceVideoId: 'v1' })
    const pip = makeClip({ id: 'pip', sourceVideoId: 'v1' })
    const incoming = makeClip({ id: 'in', sourceVideoId: 'v1' })

    expect(slotsOf(live(outgoing, pip), { outgoingClip: outgoing, incomingClip: incoming })).toEqual({
      out: 0,
      pip: 1,
      in: 2,
    })
  })

  it('gives an incoming side of another source that source\'s first slot', () => {
    const outgoing = makeClip({ id: 'out', sourceVideoId: 'v1' })
    const incoming = makeClip({ id: 'in', sourceVideoId: 'v2' })

    expect(slotsOf(live(outgoing), { outgoingClip: outgoing, incomingClip: incoming })).toEqual({ out: 0, in: 0 })
  })

  it('refills the map it is handed, dropping the last frame\'s clips', () => {
    const out = new Map<string, number>([['gone', 3]])
    assignElementSlots(live(makeClip({ id: 'a', sourceVideoId: 'v1' })), null, out)

    expect(Object.fromEntries(out)).toEqual({ a: 0 })
  })
})

describe('videoForSlot', () => {
  const own = {} as HTMLVideoElement
  const second = {} as HTMLVideoElement
  const videos = new Map([['v1', own]])

  it('answers slot 0 with the source\'s own element and slot k with its k-th further one', () => {
    const extras = new Map([['v1', [second]]])

    expect(videoForSlot(videos, extras, 'v1', 0)).toBe(own)
    expect(videoForSlot(videos, extras, 'v1', 1)).toBe(second)
  })

  it('answers undefined for a slot with no element, one that would not load, or no further elements at all', () => {
    expect(videoForSlot(videos, new Map([['v1', [second]]]), 'v1', 2)).toBeUndefined()
    expect(videoForSlot(videos, new Map([['v1', [null]]]), 'v1', 1)).toBeUndefined()
    expect(videoForSlot(videos, new Map(), 'v1', 1)).toBeUndefined()
    expect(videoForSlot(videos, undefined, 'v1', 1)).toBeUndefined()
  })
})

// ESCSUITE-323: the preview's elements are playing playheads, so a live clip
// keeps the slot it had for as long as it stays live, and a newcomer takes the
// lowest slot of its source no live clip holds.
describe('createStickySlotAssigner', () => {
  const u = makeClip({ id: 'u', sourceVideoId: 'v1' })
  const l = makeClip({ id: 'l', sourceVideoId: 'v1' })
  const n = makeClip({ id: 'n', sourceVideoId: 'v1' })

  function framesOf(assigner: ReturnType<typeof createStickySlotAssigner>) {
    const out = new Map<string, number>()
    return (activeClips: Array<{ clip: Clip }>, transition: Parameters<typeof assignElementSlots>[1] = null) => {
      assigner.assign(activeClips, transition, out)
      return Object.fromEntries(out)
    }
  }

  it('keeps a live clip on its slot when another clip of its source starts below it', () => {
    const frame = framesOf(createStickySlotAssigner())

    expect(frame(live(u))).toEqual({ u: 0 })
    // `l` is first in track order, and the stateless rule would give it 0.
    expect(frame(live(l, u))).toEqual({ l: 1, u: 0 })
    // `u` has left: `l` stays where it is rather than being re-packed to 0.
    expect(frame(live(l))).toEqual({ l: 1 })
    // A newcomer takes the lowest slot no live clip holds.
    expect(frame(live(l, n))).toEqual({ l: 1, n: 0 })
  })

  it('agrees with the stateless rule on a first frame', () => {
    const other = makeClip({ id: 'o', sourceVideoId: 'v2' })
    const text = makeClip({ id: 't', sourceVideoId: '', overlayType: 'text' })
    const frame = framesOf(createStickySlotAssigner())

    expect(frame(live(text, l, other, u))).toEqual(slotsOf(live(text, l, other, u)))
  })

  it('keeps the slot a held incoming side was given once it is live, and the outgoing side\'s through the transition', () => {
    const a = makeClip({ id: 'a', sourceVideoId: 'v1' })
    const b = makeClip({ id: 'b', sourceVideoId: 'v1' })
    const fade = { outgoingClip: a, incomingClip: b }
    const frame = framesOf(createStickySlotAssigner())

    // Before the cut: `b` is held on the next free slot.
    expect(frame(live(a), fade)).toEqual({ a: 0, b: 1 })
    // Synthetic: a transition's window ends at its outgoing clip's end, so the
    // editor never names `a` as the outgoing side once only `b` is live. The
    // frame pins the rule for a side that is not live: it keeps its slot.
    // Here `b` is live and keeps 1, `a` keeps 0 as the outgoing side.
    expect(frame(live(b), fade)).toEqual({ a: 0, b: 1 })
    // The transition is over: `a` is let go, `b` stays.
    expect(frame(live(b))).toEqual({ b: 1 })
    expect(frame(live(b, n))).toEqual({ b: 1, n: 0 })
  })

  it('numbers each source on its own and gives an overlay no slot', () => {
    const other = makeClip({ id: 'o', sourceVideoId: 'v2' })
    const text = makeClip({ id: 't', sourceVideoId: '', overlayType: 'text' })
    const frame = framesOf(createStickySlotAssigner())

    expect(frame(live(u))).toEqual({ u: 0 })
    expect(frame(live(text, l, other, u))).toEqual({ l: 1, o: 0, u: 0 })
  })

  it('forgets every clip on reset', () => {
    const assigner = createStickySlotAssigner()
    const frame = framesOf(assigner)
    frame(live(u))
    frame(live(l, u))

    assigner.reset()

    expect(frame(live(l, u))).toEqual({ l: 0, u: 1 })
  })

  it('refills the map it is handed, dropping clips it did not assign this call', () => {
    const out = new Map<string, number>([['gone', 3]])
    createStickySlotAssigner().assign(live(u), null, out)

    expect(Object.fromEntries(out)).toEqual({ u: 0 })
  })
})
