// `updateTrack`'s undo contract (ESCSUITE-242).
//
// The track header's volume slider writes on every `input` event, and
// `updateTrack` used to push an undo entry on every call — so one drag filled
// the 50-entry history with its own intermediate volumes. It now takes the
// trailing `skipHistory` flag every other gesture-driven action takes, and
// reports whether it wrote (the ESCSUITE-87 boolean), so the slider can run its
// writes through `useSliderGesture`'s `commit`.
import { describe, it, expect, beforeEach } from 'vitest'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'

const past = () => store().history.past.length
const firstTrack = () => store().project.timeline.tracks[0]

describe('updateTrack and the undo stack', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('pushes one entry and reports the write without the flag', () => {
    const before = past()

    const wrote = store().updateTrack(firstTrack().id, { volume: 0.4 })

    expect(wrote).toBe(true)
    expect(firstTrack().volume).toBe(0.4)
    expect(past() - before).toBe(1)
  })

  it('pushes one entry when the flag is false', () => {
    const before = past()

    expect(store().updateTrack(firstTrack().id, { volume: 0.4 }, false)).toBe(true)

    expect(past() - before).toBe(1)
  })

  it('writes without a history entry when told to skip it', () => {
    const before = past()

    const wrote = store().updateTrack(firstTrack().id, { volume: 0.3 }, true)

    expect(wrote).toBe(true)
    expect(firstTrack().volume).toBe(0.3)
    expect(past() - before).toBe(0)
  })

  it('refuses an id that names no track: no write, no entry, false', () => {
    const before = past()
    const projectBefore = store().project

    const wrote = store().updateTrack('no-such-track', { volume: 0.2 })

    expect(wrote).toBe(false)
    expect(store().project).toBe(projectBefore)
    expect(past() - before).toBe(0)
  })

  it('undoes a pushed write back to the state before it', () => {
    const id = firstTrack().id
    const original = firstTrack().volume

    store().updateTrack(id, { volume: 0.4 })
    store().updateTrack(id, { volume: 0.5 }, true)
    store().updateTrack(id, { volume: 0.6 }, true)
    store().undo()

    expect(firstTrack().volume).toBe(original)
  })
})
