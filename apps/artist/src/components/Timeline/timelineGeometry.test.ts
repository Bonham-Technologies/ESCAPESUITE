// The timeline's geometry on its own: no component, no store, no DOM.
//
// These are the same numbers the ruler draws and the drag handlers commit, so
// the expectations are written out of the inputs and the module's own constants
// — a tick every RULER_MINOR_INTERVAL seconds, a split refused within
// MIN_SPLIT_DISTANCE of an edge — rather than copied off a run.
import { describe, it, expect } from 'vitest'
import {
  clampTime,
  clipsIntersectingRange,
  computeTrimUpdate,
  exceedsMarqueeThreshold,
  getRulerTicks,
  getSplitOffset,
  isExtendableClip,
  marqueeTimeRange,
  marqueeYRange,
  pointerTime,
  snapDragPosition,
  trackSpansMarquee,
  MARQUEE_DRAG_THRESHOLD,
  MIN_CLIP_DURATION,
  MIN_SPLIT_DISTANCE,
  RULER_MAJOR_INTERVAL,
  RULER_MINOR_INTERVAL,
} from './timelineGeometry'
import { makeClip, makeSourceVideo } from '../../test/fixtures/clipFixtures'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50

describe('getRulerTicks', () => {
  it('places a tick every minor interval, up to and including the end', () => {
    const ticks = getRulerTicks(10, PPS)

    expect(ticks).toHaveLength(10 / RULER_MINOR_INTERVAL + 1)
    expect(ticks[0]).toEqual({ time: 0, x: 0, isMajor: true })
    expect(ticks[ticks.length - 1]).toEqual({ time: 10, x: 10 * PPS, isMajor: true })
  })

  it('labels every major interval and leaves the rest bare', () => {
    const ticks = getRulerTicks(10, PPS)

    expect(ticks.filter((t) => t.isMajor).map((t) => t.time)).toEqual([0, 5, 10])
    for (const tick of ticks) {
      expect(tick.isMajor).toBe(tick.time % RULER_MAJOR_INTERVAL === 0)
    }
  })

  it('rounds a fractional duration up to the next whole tick', () => {
    const ticks = getRulerTicks(2.5, PPS)

    expect(ticks.map((t) => t.time)).toEqual([0, 1, 2, 3])
  })

  it('scales tick positions with the zoom', () => {
    const ticks = getRulerTicks(2, PPS * 2)

    expect(ticks.map((t) => t.x)).toEqual([0, 100, 200])
  })
})

describe('pointerTime', () => {
  it('measures from the element edge, counting what is scrolled out of view', () => {
    expect(pointerTime(250, 0, 0, PPS)).toBe(5)
    expect(pointerTime(250, 100, 0, PPS)).toBe(3)
    expect(pointerTime(250, 0, 100, PPS)).toBe(7)
  })

  it('goes negative to the left of the element', () => {
    expect(pointerTime(0, 100, 0, PPS)).toBe(-2)
  })
})

describe('clampTime', () => {
  it('holds a time inside [0, max]', () => {
    expect(clampTime(5, 10)).toBe(5)
    expect(clampTime(-3, 10)).toBe(0)
    expect(clampTime(42, 10)).toBe(10)
  })
})

describe('snapDragPosition', () => {
  const points = [0, 4, 12]

  it('snaps the clip start to a point within the threshold', () => {
    expect(snapDragPosition(3.9, 2, points, 0.5)).toEqual({ position: 4, snappedPosition: 4 })
  })

  it('snaps the clip end, moving the start back by the clip duration', () => {
    // Start (10) is 2s from every point; end (12) is exactly on one.
    expect(snapDragPosition(10, 2, points, 0.5)).toEqual({ position: 10, snappedPosition: 12 })
  })

  it('prefers the start edge when both edges are in range', () => {
    // Start is 0.1 from 4, end is 0.1 from 12 — the start wins.
    expect(snapDragPosition(4.1, 7.8, points, 0.5)).toEqual({ position: 4, snappedPosition: 4 })
  })

  it('leaves the position alone when nothing is within the threshold', () => {
    expect(snapDragPosition(7, 1, points, 0.5)).toEqual({ position: 7, snappedPosition: null })
  })
})

describe('getSplitOffset', () => {
  it('returns the offset from the clip start for a click inside the clip', () => {
    expect(getSplitOffset(7, 5, 4)).toBe(2)
  })

  it('refuses a split within the minimum distance of either edge', () => {
    expect(getSplitOffset(5 + MIN_SPLIT_DISTANCE, 5, 4)).toBeNull()
    expect(getSplitOffset(9 - MIN_SPLIT_DISTANCE, 5, 4)).toBeNull()
    expect(getSplitOffset(4, 5, 4)).toBeNull()
    expect(getSplitOffset(10, 5, 4)).toBeNull()
  })

  it('allows a split just inside the minimum distance', () => {
    expect(getSplitOffset(5 + MIN_SPLIT_DISTANCE * 2, 5, 4)).toBeCloseTo(MIN_SPLIT_DISTANCE * 2, 10)
  })
})

describe('isExtendableClip', () => {
  const video = makeSourceVideo()
  const image = makeSourceVideo({ mediaType: 'image' })

  it('is true for overlays whatever their source', () => {
    expect(isExtendableClip({ overlayType: 'text' }, undefined)).toBe(true)
    expect(isExtendableClip({ overlayType: 'shape' }, video)).toBe(true)
  })

  it('is true for an image clip', () => {
    expect(isExtendableClip({ overlayType: undefined }, image)).toBe(true)
  })

  it('is false for a video clip and for a clip with no source at all', () => {
    expect(isExtendableClip({ overlayType: undefined }, video)).toBe(false)
    expect(isExtendableClip({ overlayType: undefined }, undefined)).toBe(false)
  })
})

describe('computeTrimUpdate', () => {
  const origin = { startTime: 2, endTime: 7, timelinePosition: 10 }
  const video = makeSourceVideo({ duration: 30 })
  const image = makeSourceVideo({ mediaType: 'image' })

  describe('the start edge of an extendable clip', () => {
    const clip = makeClip({ overlayType: 'text', timelinePosition: 10, startTime: 0 })

    it('moves the clip and stretches it back to its original end', () => {
      // Original end is 10 + (7 - 2) = 15.
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: 12, clip, sourceVideo: undefined, origin })
      ).toEqual({ timelinePosition: 12, duration: 3, endTime: 3 })
    })

    it('never moves the clip before zero', () => {
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: -4, clip, sourceVideo: undefined, origin })
      ).toEqual({ timelinePosition: 0, duration: 15, endTime: 15 })
    })

    it('refuses a drag that would leave less than the minimum duration', () => {
      const mouseTime = 15 - MIN_CLIP_DURATION / 2
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime, clip, sourceVideo: undefined, origin })
      ).toBeNull()
    })
  })

  describe('the start edge of a video clip', () => {
    const clip = makeClip({ timelinePosition: 10, startTime: 2 })

    it('trims into the source and shifts the clip by the same amount', () => {
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: 13, clip, sourceVideo: video, origin })
      ).toEqual({ startTime: 5, timelinePosition: 13 })
    })

    it('stops at the start of the source', () => {
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: 0, clip, sourceVideo: video, origin })
      ).toEqual({ startTime: 0, timelinePosition: 8 })
    })

    it('leaves at least the minimum duration in the clip', () => {
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: 100, clip, sourceVideo: video, origin })
      ).toEqual({
        startTime: origin.endTime - MIN_CLIP_DURATION,
        timelinePosition: 10 + (origin.endTime - MIN_CLIP_DURATION - origin.startTime),
      })
    })

    it('does nothing when the clip has no source to trim into', () => {
      expect(
        computeTrimUpdate({ edge: 'start', mouseTime: 13, clip, sourceVideo: undefined, origin })
      ).toBeNull()
    })
  })

  describe('the end edge of an extendable clip', () => {
    const clip = makeClip({ timelinePosition: 10, startTime: 0 })

    it('stretches an image clip past its source duration', () => {
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime: 40, clip, sourceVideo: image, origin })
      ).toEqual({ duration: 30, endTime: 30 })
    })

    it('refuses a drag back past the minimum duration', () => {
      const mouseTime = 10 + MIN_CLIP_DURATION / 2
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime, clip, sourceVideo: image, origin })
      ).toBeNull()
    })
  })

  describe('the end edge of a video clip', () => {
    const clip = makeClip({ timelinePosition: 10, startTime: 2 })

    it('trims the end point within the source', () => {
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime: 15, clip, sourceVideo: video, origin })
      ).toEqual({ endTime: 7 })
    })

    it('stops at the end of the source', () => {
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime: 1000, clip, sourceVideo: video, origin })
      ).toEqual({ endTime: video.duration })
    })

    it('keeps at least the minimum duration', () => {
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime: 10, clip, sourceVideo: video, origin })
      ).toEqual({ endTime: clip.startTime + MIN_CLIP_DURATION })
    })

    it('does nothing when the clip has no source', () => {
      expect(
        computeTrimUpdate({ edge: 'end', mouseTime: 15, clip, sourceVideo: undefined, origin })
      ).toBeNull()
    })
  })
})

describe('exceedsMarqueeThreshold', () => {
  it('is true once the pointer has travelled the threshold in any direction', () => {
    expect(exceedsMarqueeThreshold(MARQUEE_DRAG_THRESHOLD, 0)).toBe(true)
    expect(exceedsMarqueeThreshold(0, -MARQUEE_DRAG_THRESHOLD)).toBe(true)
    // Diagonally too: the threshold is a distance, not a per-axis budget.
    expect(exceedsMarqueeThreshold(MARQUEE_DRAG_THRESHOLD * 0.6, MARQUEE_DRAG_THRESHOLD * 0.8)).toBe(true)
  })

  it('is false for a press that barely moved', () => {
    expect(exceedsMarqueeThreshold(MARQUEE_DRAG_THRESHOLD - 1, 0)).toBe(false)
    expect(exceedsMarqueeThreshold(0, 0)).toBe(false)
  })
})

describe('marqueeTimeRange', () => {
  it('reads left to right whichever way the marquee was dragged', () => {
    expect(marqueeTimeRange(100, 300, 0, PPS)).toEqual({ startTime: 2, endTime: 6 })
    expect(marqueeTimeRange(300, 100, 0, PPS)).toEqual({ startTime: 2, endTime: 6 })
  })

  it('counts the pixels scrolled out of view to the left', () => {
    expect(marqueeTimeRange(100, 300, 50, PPS)).toEqual({ startTime: 3, endTime: 7 })
  })
})

describe('marqueeYRange', () => {
  it('reads top to bottom whichever way the marquee was dragged', () => {
    expect(marqueeYRange(20, 80)).toEqual({ topPx: 20, bottomPx: 80 })
    expect(marqueeYRange(80, 20)).toEqual({ topPx: 20, bottomPx: 80 })
  })
})

describe('trackSpansMarquee', () => {
  it('is true for a track that overlaps the band', () => {
    expect(trackSpansMarquee(0, 60, 20, 80)).toBe(true)
    expect(trackSpansMarquee(30, 40, 20, 80)).toBe(true)
  })

  it('is false for a track that only touches the band or misses it', () => {
    expect(trackSpansMarquee(80, 120, 20, 80)).toBe(false)
    expect(trackSpansMarquee(0, 20, 20, 80)).toBe(false)
    expect(trackSpansMarquee(200, 260, 20, 80)).toBe(false)
  })
})

describe('clipsIntersectingRange', () => {
  const clips = [
    makeClip({ id: 'a', trackId: 'track1', timelinePosition: 0, duration: 4 }),
    makeClip({ id: 'b', trackId: 'track1', timelinePosition: 6, duration: 4 }),
    makeClip({ id: 'c', trackId: 'track2', timelinePosition: 0, duration: 4 }),
  ]

  it('takes every clip on a spanned track that overlaps the range', () => {
    expect(clipsIntersectingRange(clips, new Set(['track1', 'track2']), 2, 7)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('ignores tracks the marquee did not span', () => {
    expect(clipsIntersectingRange(clips, new Set(['track2']), 2, 7)).toEqual(['c'])
  })

  it('does not count a clip that only touches the range at one instant', () => {
    expect(clipsIntersectingRange(clips, new Set(['track1']), 4, 6)).toEqual([])
  })

  it('is empty when nothing was spanned', () => {
    expect(clipsIntersectingRange(clips, new Set(), 0, 100)).toEqual([])
  })
})
