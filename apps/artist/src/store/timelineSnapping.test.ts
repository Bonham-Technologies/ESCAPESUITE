import { describe, it, expect } from 'vitest'
import { getSnapPoints, findNearestSnapPoint, wouldOverlap } from './timelineSnapping'
import type { Clip } from './types'

describe('timelineSnapping helper functions', () => {
  const createMockClip = (id: string, trackId: string, position: number, duration: number): Clip => ({
    id,
    sourceVideoId: 'video1',
    name: `Clip ${id}`,
    startTime: 0,
    endTime: duration,
    duration,
    trackId,
    timelinePosition: position,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
  })

  describe('getSnapPoints', () => {
    it('returns snap points from clip edges', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 10, 3),
      ]

      const points = getSnapPoints(clips)

      expect(points).toContain(0) // Always includes 0
      expect(points).toContain(5) // End of c1
      expect(points).toContain(10) // Start of c2
      expect(points).toContain(13) // End of c2
    })

    it('excludes specified clip', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 10, 3),
      ]

      const points = getSnapPoints(clips, 'c1')

      expect(points).not.toContain(5) // c1 end excluded
      expect(points).toContain(10) // c2 still included
    })
  })

  describe('findNearestSnapPoint', () => {
    it('finds the nearest snap point within threshold', () => {
      const snapPoints = [0, 5, 10, 15]

      expect(findNearestSnapPoint(4.8, snapPoints, 1)).toBe(5)
      expect(findNearestSnapPoint(10.2, snapPoints, 1)).toBe(10)
    })

    it('returns null if no point within threshold', () => {
      const snapPoints = [0, 10, 20]

      expect(findNearestSnapPoint(5, snapPoints, 1)).toBeNull()
    })
  })

  describe('wouldOverlap', () => {
    it('detects overlap with existing clips', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)] // 5-10

      expect(wouldOverlap(clips, 't1', 3, 5)).toBe(true) // 3-8 overlaps
      expect(wouldOverlap(clips, 't1', 8, 5)).toBe(true) // 8-13 overlaps
      expect(wouldOverlap(clips, 't1', 6, 2)).toBe(true) // 6-8 inside
    })

    it('allows non-overlapping placement', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)] // 5-10

      expect(wouldOverlap(clips, 't1', 0, 5)).toBe(false) // 0-5 adjacent
      expect(wouldOverlap(clips, 't1', 10, 5)).toBe(false) // 10-15 adjacent
      expect(wouldOverlap(clips, 't1', 15, 5)).toBe(false) // 15-20 separated
    })

    it('ignores clips on different tracks', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)]

      expect(wouldOverlap(clips, 't2', 5, 5)).toBe(false)
    })

    it('excludes specified clip from check', () => {
      const clips = [createMockClip('c1', 't1', 5, 5)]

      // Same position as c1 but excluding c1 from check
      expect(wouldOverlap(clips, 't1', 5, 5, 'c1')).toBe(false)
    })
  })
})
