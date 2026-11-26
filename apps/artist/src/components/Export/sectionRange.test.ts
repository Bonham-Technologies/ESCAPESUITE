import { describe, it, expect } from 'vitest'
import { sectionOnTimeline, sectionPastEndReason } from './sectionRange'

// ESCSUITE-519: an edit that shortens the timeline (a clip sped up, a clip
// removed) leaves the in and out points where they were, so the section the
// export dialog offers can lie partly or wholly past the timeline's end.
describe('sectionOnTimeline (ESCSUITE-519)', () => {
  it('leaves a section inside the timeline as it is', () => {
    expect(sectionOnTimeline({ start: 1, end: 4 }, 5)).toEqual({ start: 1, end: 4 })
  })

  it('leaves a section that ends exactly at the end as it is', () => {
    expect(sectionOnTimeline({ start: 1, end: 5 }, 5)).toEqual({ start: 1, end: 5 })
  })

  it('clamps a section that straddles the end to the end', () => {
    expect(sectionOnTimeline({ start: 1, end: 4.5 }, 1.25)).toEqual({ start: 1, end: 1.25 })
  })

  it('has nothing to export for a section that starts past the end', () => {
    expect(sectionOnTimeline({ start: 2, end: 4.5 }, 1.25)).toBeNull()
  })

  it('has nothing to export for a section that starts exactly at the end', () => {
    expect(sectionOnTimeline({ start: 1.25, end: 4.5 }, 1.25)).toBeNull()
  })

  it('keeps a zero-length section inside the timeline, for the length check to refuse', () => {
    expect(sectionOnTimeline({ start: 3, end: 3 }, 5)).toEqual({ start: 3, end: 3 })
  })

  it('has nothing to export on a timeline with no length', () => {
    expect(sectionOnTimeline({ start: 0, end: 3 }, 0)).toBeNull()
    expect(sectionOnTimeline({ start: 0, end: 3 }, Number.NaN)).toBeNull()
  })
})

// ESCSUITE-526: at 1.5x a 5 s clip ends at 3.333... s, which is no whole
// number of frames. An in point a rounding error before that end left a
// section of less than a frame on the timeline, and the dialog offered it.
describe('sectionOnTimeline at a fractional end (ESCSUITE-526)', () => {
  const end = 5 / 1.5
  const hairBefore = 3.333333333333333

  it('has nothing to export when less than one output frame reaches the end', () => {
    expect(hairBefore).toBeLessThan(end)
    expect(sectionOnTimeline({ start: hairBefore, end: 5 }, end, 30)).toBeNull()
    expect(sectionOnTimeline({ start: end - 0.02, end: 5 }, end, 30)).toBeNull()
  })

  it('counts the frame at the rate it is given, and at the video exporters\' 30 fps by default', () => {
    expect(sectionOnTimeline({ start: end - 0.05, end: 5 }, end, 10)).toBeNull()
    expect(sectionOnTimeline({ start: end - 0.05, end: 5 }, end, 30)).toEqual({ start: end - 0.05, end })
    expect(sectionOnTimeline({ start: hairBefore, end: 5 }, end)).toBeNull()
  })

  it('refuses a sub-frame section that ends exactly at the end too', () => {
    expect(sectionOnTimeline({ start: hairBefore, end }, end, 30)).toBeNull()
  })

  it('keeps a section of a frame or more that reaches the end', () => {
    expect(sectionOnTimeline({ start: 3, end: 5 }, end, 30)).toEqual({ start: 3, end })
    expect(sectionOnTimeline({ start: 3.25, end: 5 }, 3.5, 4)).toEqual({ start: 3.25, end: 3.5 })
  })

  it('leaves a short section wholly inside the timeline to the length checks', () => {
    expect(sectionOnTimeline({ start: 1, end: 1.01 }, end, 30)).toEqual({ start: 1, end: 1.01 })
  })

  it('gives the same reason line as a section that starts at the end', () => {
    expect(sectionPastEndReason({ start: hairBefore, end: 5 }, end)).toBe(
      'Cannot export the section: it starts at 0:03, where the timeline ends. Set the in point before the end, or export the full video'
    )
  })
})

describe('sectionPastEndReason (ESCSUITE-519)', () => {
  it('names where the section starts, where the timeline ends, and the way out', () => {
    expect(sectionPastEndReason({ start: 2, end: 4.5 }, 1.25)).toBe(
      'Cannot export the section: it starts at 0:02 and the timeline ends at 0:01. Set the in point before the end, or export the full video'
    )
  })

  it('does not contradict itself when the start and the end show as the same second', () => {
    const reason = 'Cannot export the section: it starts at 0:01, where the timeline ends. Set the in point before the end, or export the full video'
    expect(sectionPastEndReason({ start: 1.25, end: 4.5 }, 1.25)).toBe(reason)
    expect(sectionPastEndReason({ start: 1.5, end: 4.5 }, 1.25)).toBe(reason)
  })
})
