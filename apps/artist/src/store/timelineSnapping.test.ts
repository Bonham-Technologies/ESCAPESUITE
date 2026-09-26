import { describe, it, expect } from 'vitest'
import {
  getSnapPoints,
  findNearestSnapPoint,
  wouldOverlap,
  trackIndexDelta,
  canMoveSelectedClips,
} from './timelineSnapping'
import type { Clip, Track } from './types'

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

  // ESCSUITE-80: the two questions a multi-selection's drop asks before it
  // commits. Both work in `selectionSlice.moveSelectedClips`' own index space —
  // tracks sorted by ascending `index`, which is bottom-to-top on screen.
  const createMockTrack = (id: string, index: number): Track => ({
    id,
    name: `Track ${index}`,
    index,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
  })

  /** Three rows, deliberately handed over out of order. */
  const tracks = [
    createMockTrack('t2', 1),
    createMockTrack('t3', 2),
    createMockTrack('t1', 0),
  ]

  describe('trackIndexDelta', () => {
    it('is zero for a drop back onto the row the drag started on', () => {
      expect(trackIndexDelta(tracks, 't2', 't2')).toBe(0)
    })

    it('counts rows in ascending index order, whatever order the tracks arrive in', () => {
      expect(trackIndexDelta(tracks, 't1', 't3')).toBe(2)
      expect(trackIndexDelta(tracks, 't3', 't2')).toBe(-1)
    })

    it('answers null when the row the drag started on is gone', () => {
      expect(trackIndexDelta(tracks, 'gone', 't1')).toBeNull()
    })

    it('answers null when the row it was dropped on is gone', () => {
      expect(trackIndexDelta(tracks, 't1', 'gone')).toBeNull()
    })
  })

  describe('canMoveSelectedClips', () => {
    const move = (
      clips: Clip[],
      selected: string[],
      deltaTime: number,
      deltaTrack: number
    ): boolean =>
      canMoveSelectedClips({
        clips,
        tracks,
        selectedClipIds: new Set(selected),
        deltaTime,
        deltaTrack,
      })

    it('allows a move in time alone onto free ground', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(move(clips, ['c1'], 10, 0)).toBe(true)
    })

    it('allows a move onto a row with nothing on it', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(move(clips, ['c1'], 0, 1)).toBe(true)
    })

    it('lets the selection slide over ground its own members are vacating', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 5, 5),
      ]

      // c1 lands where c2 stands, and c2 is moving out of it in the same write.
      expect(move(clips, ['c1', 'c2'], 5, 0)).toBe(true)
    })

    it('refuses the move when a member would land past the top of the stack', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't3', 0, 5),
      ]

      expect(move(clips, ['c1', 'c2'], 0, 1)).toBe(false)
    })

    it('refuses the move when a member would land below the bottom of the stack', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't3', 0, 5),
      ]

      expect(move(clips, ['c1', 'c2'], 0, -1)).toBe(false)
    })

    it('refuses the move when a member is on a row that is not on the timeline', () => {
      const clips = [createMockClip('c1', 'gone', 0, 5)]

      expect(move(clips, ['c1'], 1, 0)).toBe(false)
    })

    it('refuses the move when a member would land on a clip that is not moving', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 2, 5),
      ]

      expect(move(clips, ['c1'], 0, 1)).toBe(false)
    })

    // ESCSUITE-82: a locked row takes part in no move — neither as somewhere a
    // member sits nor as somewhere one would land. `handleClipMouseDown` refuses
    // to *start* on a locked row, but a selection can hold a clip on one (ctrl+
    // click adds it) while the pointer holds a clip that is free to drag.
    const withLocked = (lockedId: string): Track[] =>
      tracks.map((track) => (track.id === lockedId ? { ...track, locked: true } : track))

    it('refuses the move when a member would land on a locked row', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(
        canMoveSelectedClips({
          clips,
          tracks: withLocked('t2'),
          selectedClipIds: new Set(['c1']),
          deltaTime: 0,
          deltaTrack: 1,
        })
      ).toBe(false)
    })

    it('refuses the move when a member is sitting on a locked row', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't2', 0, 5),
      ]

      // c1 is free to move and nothing is in either clip's way; c2 is on the
      // locked row, and the move would carry it off.
      expect(
        canMoveSelectedClips({
          clips,
          tracks: withLocked('t2'),
          selectedClipIds: new Set(['c1', 'c2']),
          deltaTime: 10,
          deltaTrack: 0,
        })
      ).toBe(false)
    })

    it('refuses the move when clamping at zero would stack two members', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 5, 5),
      ]

      // Both members are pulled back past the start of the timeline, where the
      // store's own `Math.max(0, …)` would pile them on top of each other.
      expect(move(clips, ['c1', 'c2'], -10, 0)).toBe(false)
    })
  })
})
