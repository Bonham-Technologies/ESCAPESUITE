import { describe, it, expect } from 'vitest'
import {
  shouldAnnounceProgress,
  ANNOUNCE_STEP_PERCENT,
  ANNOUNCE_INTERVAL_MS,
} from './progressAnnouncement'

// ESCSUITE-215. The export's own progress callback fires once per encoded
// frame — dozens of times a second for minutes — and a live region fed from it
// unthrottled is a screen reader talking over itself for the whole export. The
// rule the dialog announces by is this one function, so it can be reasoned
// about (and mutated) without driving an export.
describe('shouldAnnounceProgress', () => {
  it('announces the first report of a run, whatever it says', () => {
    expect(shouldAnnounceProgress(null, 0, 0)).toBe(true)
    expect(shouldAnnounceProgress(null, 73.5, 1_700_000_000_000)).toBe(true)
  })

  it('announces once a new ten-point band is reached', () => {
    // 9.9 and 4 are the same band as 0 — nothing to say yet.
    expect(shouldAnnounceProgress({ progress: 0, atMs: 1000 }, 4, 1100)).toBe(false)
    expect(shouldAnnounceProgress({ progress: 0, atMs: 1000 }, 9.9, 1100)).toBe(false)
    // 10 is the next band, and so is anything above it.
    expect(shouldAnnounceProgress({ progress: 0, atMs: 1000 }, 10, 1100)).toBe(true)
    expect(shouldAnnounceProgress({ progress: 9.9, atMs: 1000 }, 10.1, 1100)).toBe(true)
    expect(shouldAnnounceProgress({ progress: 42, atMs: 1000 }, 50, 1100)).toBe(true)
  })

  it('stays quiet inside a band even when the band was entered long ago', () => {
    // The same band, the same second: the common case, once per frame.
    expect(shouldAnnounceProgress({ progress: 41, atMs: 1000 }, 41.2, 1001)).toBe(false)
    expect(shouldAnnounceProgress({ progress: 41, atMs: 1000 }, 49.99, 4999)).toBe(false)
  })

  it('announces anyway once five seconds have passed, however slow the band is', () => {
    // A 4K export can sit inside one band for minutes; the clock is the floor
    // under "am I still being told anything at all".
    expect(shouldAnnounceProgress({ progress: 41, atMs: 1000 }, 41.2, 6000)).toBe(true)
    // Exactly the interval counts — the boundary is inclusive.
    expect(shouldAnnounceProgress({ progress: 41, atMs: 1000 }, 41.2, 1000 + ANNOUNCE_INTERVAL_MS)).toBe(true)
    expect(shouldAnnounceProgress({ progress: 41, atMs: 1000 }, 41.2, 999 + ANNOUNCE_INTERVAL_MS)).toBe(false)
  })

  it('says nothing for progress that goes backwards inside the interval', () => {
    // Not a case any exporter produces, but the band test is a comparison and
    // not a difference: a lower band must not read as a new one.
    expect(shouldAnnounceProgress({ progress: 50, atMs: 1000 }, 20, 1100)).toBe(false)
  })

  it('states the band and the interval it throttles by', () => {
    expect(ANNOUNCE_STEP_PERCENT).toBe(10)
    expect(ANNOUNCE_INTERVAL_MS).toBe(5000)
  })
})
