// `seekTo` and the seek sequence (ESCSUITE-287).
//
// The render loop publishes the frame it last drew when a pause stops it
// (ESCSUITE-281), unless a seek arrived in the same batch. It used to tell a
// seek apart from a plain pause by the store's value alone, which a seek to the
// value already held — Home within the first 200 ms of playing from 0 — does
// not change. Every seeker now goes through `seekTo`, which counts itself in
// `seekSequence`; `setCurrentTime` stays the render loop's own writer and
// counts nothing.
import { describe, it, expect, beforeEach } from 'vitest'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'

const sequence = () => store().seekSequence

describe('seekTo', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('writes the time and counts the seek once', () => {
    const before = sequence()

    store().seekTo(3.5)

    expect(store().currentTime).toBe(3.5)
    expect(sequence()).toBe(before + 1)
  })

  it('counts a seek to the time already held', () => {
    store().seekTo(2)
    const before = sequence()

    store().seekTo(2)
    store().seekTo(2)

    expect(store().currentTime).toBe(2)
    expect(sequence()).toBe(before + 2)
  })

  it('pushes no undo entry', () => {
    addClip('clip1', 0, 4)
    const past = store().history.past.length

    store().seekTo(1)

    expect(store().history.past.length).toBe(past)
  })

  it('leaves the sequence alone for the render loop\'s own writes', () => {
    const before = sequence()

    store().setCurrentTime(1.25)

    expect(store().currentTime).toBe(1.25)
    expect(sequence()).toBe(before)
  })
})

describe('the other playhead jumps count as seeks', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('a jump to the next or previous marker counts once', () => {
    store().addMarker(1)
    store().addMarker(3)
    store().seekTo(2)
    const before = sequence()

    store().goToNextMarker()
    expect(store().currentTime).toBe(3)
    expect(sequence()).toBe(before + 1)

    store().goToPreviousMarker()
    expect(store().currentTime).toBe(1)
    expect(sequence()).toBe(before + 2)
  })

  it('a marker jump with no marker to go to moves nothing and counts nothing', () => {
    store().addMarker(1)
    store().seekTo(1)
    const before = sequence()

    store().goToNextMarker()
    store().goToPreviousMarker()

    expect(store().currentTime).toBe(1)
    expect(sequence()).toBe(before)
  })

  it('a project reset counts as a seek to 0', () => {
    store().seekTo(4)
    const before = sequence()

    store().resetProject()

    expect(store().currentTime).toBe(0)
    expect(sequence()).toBe(before + 1)
  })
})
