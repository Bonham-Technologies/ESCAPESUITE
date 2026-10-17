// `assignElementSlots` (ESCSUITE-313): which of its source's `<video>` elements
// each live clip draws from. The composer, the in-page MP4 path and the
// preview all ask it, so its rules are pinned here once.
import { describe, it, expect } from 'vitest'
import { assignElementSlots, videoForSlot } from './elementSlots'
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
