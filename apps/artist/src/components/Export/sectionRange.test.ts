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

describe('sectionPastEndReason (ESCSUITE-519)', () => {
  it('names where the section starts, where the timeline ends, and the way out', () => {
    expect(sectionPastEndReason({ start: 2, end: 4.5 }, 1.25)).toBe(
      'Cannot export the section: it starts at 0:02 and the timeline ends at 0:01. Set the in point before the end, or export the full video'
    )
  })
})
