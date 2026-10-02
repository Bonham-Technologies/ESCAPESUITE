import { describe, it, expect } from 'vitest'
import {
  getSnapPoints,
  findNearestSnapPoint,
  wouldOverlap,
  trackIndexDelta,
  canMoveSelectedClips,
  clampTrimToNeighbours,
  firstFreeGroupStart,
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
  // ESCSUITE-161: the end of the trim gesture's arithmetic. The invariant is
  // that one track never holds two overlapping clips; the clamp is how a trim
  // keeps it, in the same way `wouldOverlap` is how a drop keeps it.
  describe('clampTrimToNeighbours', () => {
    /** clip `c2`'s origin: it sits at 10s and plays 5s of its source. */
    const origin = (position: number, duration: number) => ({
      startTime: 0,
      endTime: duration,
      timelinePosition: position,
      animation: undefined,
    })

    it('stops an end trim at the next clip on the row', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 8, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(0, 5), 12)
      ).toBe(8)
    })

    it('leaves an end trim alone when it stays short of the next clip', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 8, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(0, 5), 7)
      ).toBe(7)
    })

    it('leaves an end trim alone when there is nothing in front of it', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(0, 5), 40)
      ).toBe(40)
    })

    it('stops a start trim at the end of the clip behind it', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 8, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[1], 'start', origin(8, 3), 2)
      ).toBe(5)
    })

    it('leaves a start trim alone when it stays clear of the clip behind it', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 8, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[1], 'start', origin(8, 3), 6)
      ).toBe(6)
    })

    it('leaves a start trim alone when there is nothing behind it', () => {
      const clips = [createMockClip('c2', 't1', 8, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'start', origin(8, 3), -4)
      ).toBe(-4)
    })

    it('ignores the clips on every other row', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('other', 't2', 6, 3)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(0, 5), 12)
      ).toBe(12)
    })

    it('is never in its own way', () => {
      // The clip being trimmed is in `clips` — it always is, the hook hands
      // the whole timeline — and the limit it reads must skip it, or an end
      // trim would clamp to the clip's own start.
      const clips = [createMockClip('c1', 't1', 4, 5)]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(4, 5), 12)
      ).toBe(12)
      expect(
        clampTrimToNeighbours(clips, clips[0], 'start', origin(4, 5), 1)
      ).toBe(1)
    })

    it('reads the nearest of several clips in front of the end edge', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 2),
        createMockClip('far', 't1', 20, 2),
        createMockClip('near', 't1', 9, 2),
      ]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'end', origin(0, 2), 30)
      ).toBe(9)
    })

    it('reads the nearest of several clips behind the start edge', () => {
      const clips = [
        createMockClip('c1', 't1', 20, 5),
        createMockClip('far', 't1', 0, 2),
        createMockClip('near', 't1', 9, 2),
      ]

      expect(
        clampTrimToNeighbours(clips, clips[0], 'start', origin(20, 5), 1)
      ).toBe(11)
    })
  })

  // ESCSUITE-162: where a pasted group lands. `duplicateClip` has walked its
  // row past a collision since the beginning; this is the same rule for a
  // whole group, and the group moves as one so its members keep their offsets.
  describe('firstFreeGroupStart', () => {
    /** One clone of a one-clip group on `t1`. */
    const alone = (duration: number) => [{ trackId: 't1', offset: 0, duration }]

    it('leaves a group that fits where it was asked for', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(firstFreeGroupStart(clips, alone(5), 10)).toBe(10)
    })

    it('leaves a group that fits in a gap between two clips', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 20, 5)]

      expect(firstFreeGroupStart(clips, alone(5), 6)).toBe(6)
    })

    it('moves a group off a clip it would land on, to that clip’s end', () => {
      const clips = [createMockClip('c1', 't1', 0, 5)]

      expect(firstFreeGroupStart(clips, alone(5), 2)).toBe(5)
    })

    it('walks on past a run of clips with no room in it', () => {
      const clips = [
        createMockClip('c1', 't1', 0, 5),
        createMockClip('c2', 't1', 5, 5),
        createMockClip('c3', 't1', 10, 5),
      ]

      expect(firstFreeGroupStart(clips, alone(5), 2)).toBe(15)
    })

    it('never moves a group earlier than it was asked for', () => {
      // There is room at 0 and the group is asked for 12: the answer is where
      // it fits at or after 12, not the earliest hole on the row.
      const clips = [createMockClip('c1', 't1', 10, 5)]

      expect(firstFreeGroupStart(clips, alone(2), 12)).toBe(15)
    })

    it('ignores the clips on rows the group is not landing on', () => {
      const clips = [createMockClip('elsewhere', 't2', 0, 20)]

      expect(firstFreeGroupStart(clips, alone(5), 2)).toBe(2)
    })

    it('moves a multi-member group as one, so its members keep their offsets', () => {
      const clips = [createMockClip('c1', 't1', 0, 5), createMockClip('c2', 't1', 8, 5)]
      const members = [
        { trackId: 't1', offset: 0, duration: 5 },
        { trackId: 't1', offset: 8, duration: 5 },
      ]

      // At 0 the first member lands on c1; at 5 the second lands on c2; 13 is
      // the first start where neither does.
      expect(firstFreeGroupStart(clips, members, 0)).toBe(13)
    })

    it('reads a member’s own row, not the row of the member before it', () => {
      const clips = [createMockClip('busy', 't2', 0, 20)]
      const members = [
        { trackId: 't1', offset: 0, duration: 5 },
        { trackId: 't2', offset: 0, duration: 5 },
      ]

      expect(firstFreeGroupStart(clips, members, 2)).toBe(20)
    })

    it('answers the preferred start for a group with no members at all', () => {
      expect(firstFreeGroupStart([createMockClip('c1', 't1', 0, 5)], [], 2)).toBe(2)
    })
  })
})
