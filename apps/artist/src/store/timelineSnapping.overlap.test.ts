// A pre-existing overlap is not the gesture's doing (ESCSUITE-308).
//
// `addCaptionCues` (ESCSUITE-293) keeps a caption file's cues in file order on
// the one Captions track, so two cues whose times overlap in the file overlap
// on the row. The trim clamp (ESCSUITE-161) and the drag veto (`wouldOverlap`
// through `canMoveSelectedClips`) both assumed a row never holds such a pair:
// the clamp took the inner cue's start as the long cue's end limit, so the
// first move of a 1-10 s cue's end handle cut it to 1 s, and the veto read the
// pair as already colliding and refused every drag of either. The rule now is
// that a clip which already overlapped the one being moved **when the gesture
// began** is not a neighbour of it — a gesture may keep or change an overlap
// it found, but may not make one it did not.
import { describe, it, expect } from 'vitest'
import {
  canMoveSelectedClips,
  clampTrimToNeighbours,
  overlapsSpan,
  preexistingOverlaps,
  wouldOverlap,
} from './timelineSnapping'
import type { Clip, Track } from './types'

const clipAt = (id: string, trackId: string, position: number, duration: number): Clip => ({
  id,
  sourceVideoId: '',
  name: id,
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

const originOf = (clip: Clip) => ({
  startTime: clip.startTime,
  endTime: clip.endTime,
  timelinePosition: clip.timelinePosition,
  animation: undefined,
})

const tracks: Track[] = [
  { id: 'cap', name: 'Captions', index: 0, muted: false, locked: false, visible: true, volume: 1, height: 60 },
  { id: 'other', name: 'Track 2', index: 1, muted: false, locked: false, visible: true, volume: 1, height: 60 },
]

/** A 1-10 s cue with a 2-3 s cue inside it, the shape a caption file can hand the importer. */
const long = clipAt('long', 'cap', 1, 9)
const inner = clipAt('inner', 'cap', 2, 1)

describe('overlapsSpan and preexistingOverlaps (ESCSUITE-308)', () => {
  it('names every clip on the same row that already overlaps the clip', () => {
    const clips = [long, inner, clipAt('after', 'cap', 12, 1), clipAt('elsewhere', 'other', 2, 1)]

    expect(preexistingOverlaps(long, clips)).toEqual(new Set(['inner']))
    expect(preexistingOverlaps(inner, clips)).toEqual(new Set(['long']))
  })

  it('answers the same question wouldOverlap asks, over a span', () => {
    expect(overlapsSpan(inner, 1, 10)).toBe(true)
    expect(overlapsSpan(inner, 3, 4)).toBe(false)
    expect(overlapsSpan(inner, 0, 2)).toBe(false)
    expect(wouldOverlap([inner], 'cap', 1, 9)).toBe(overlapsSpan(inner, 1, 10))
  })

  // The tie falls on the touching side, the same side `wouldOverlap` puts it:
  // a pair meeting within OVERLAP_EPSILON (1e-9 s) is butted, not overlapping.
  // It has to be — a clamped end trim lands up to 3.55e-15 s past the
  // neighbour's start (ESCSUITE-161 / 162 review), and reading that miss as a
  // pre-existing overlap would exempt the neighbour from the clip's NEXT trim
  // and let it run straight over it.
  it('reads a pair that meets within OVERLAP_EPSILON as touching, not overlapping', () => {
    const butted = clipAt('butted', 'cap', 3, 2 + 3.55e-15)
    const next = clipAt('next', 'cap', 5, 1)

    expect(preexistingOverlaps(butted, [butted, next]).size).toBe(0)
  })

  it('reads a pair that meets by more than OVERLAP_EPSILON as overlapping', () => {
    const into = clipAt('into', 'cap', 3, 2 + 1e-6)
    const next = clipAt('next', 'cap', 5, 1)

    expect(preexistingOverlaps(into, [into, next])).toEqual(new Set(['next']))
  })
})

describe('clampTrimToNeighbours with a pre-existing overlap (ESCSUITE-308)', () => {
  it('lets the long cue’s end run past the cue inside it', () => {
    const clips = [long, inner]

    expect(clampTrimToNeighbours(clips, long, 'end', originOf(long), 10.5)).toBe(10.5)
  })

  it('lets the long cue’s start run back past the cue inside it', () => {
    const clips = [long, inner]

    expect(clampTrimToNeighbours(clips, long, 'start', originOf(long), 0.5)).toBe(0.5)
  })

  it('still stops the end at a clip beyond it that it did not overlap', () => {
    const clips = [long, inner, clipAt('after', 'cap', 12, 1)]

    expect(clampTrimToNeighbours(clips, long, 'end', originOf(long), 14)).toBe(12)
  })

  it('still stops the start at a clip before it that it did not overlap', () => {
    const clips = [long, inner, clipAt('before', 'cap', 0, 0.5)]

    expect(clampTrimToNeighbours(clips, long, 'start', originOf(long), 0.2)).toBe(0.5)
  })

  it('still stops a butted clip at its neighbour, whose edge it meets within OVERLAP_EPSILON', () => {
    const butted = clipAt('butted', 'cap', 3, 2 + 3.55e-15)
    const clips = [butted, clipAt('next', 'cap', 5, 1)]

    expect(clampTrimToNeighbours(clips, butted, 'end', originOf(butted), 7)).toBe(5)
  })

  it('lets a clip that reached more than OVERLAP_EPSILON into its neighbour keep going', () => {
    const into = clipAt('into', 'cap', 3, 2 + 1e-6)
    const clips = [into, clipAt('next', 'cap', 5, 1)]

    expect(clampTrimToNeighbours(clips, into, 'end', originOf(into), 7)).toBe(7)
  })

  it('measures the overlap from the gesture’s origin, not the clip as the trim has left it', () => {
    // Mid-gesture the long cue has been shortened to 1-1.5 s and no longer
    // reaches the inner one; the trim began with it reaching, so the inner
    // cue is still not a neighbour and the end can come back out past it.
    const shortened = { ...long, duration: 0.5, endTime: 0.5 }

    expect(clampTrimToNeighbours([shortened, inner], shortened, 'end', originOf(long), 10)).toBe(10)
  })
})

describe('canMoveSelectedClips with a pre-existing overlap (ESCSUITE-308)', () => {
  const third = clipAt('third', 'cap', 12, 2)
  const loose = clipAt('loose', 'other', 20, 1)

  it('moves the two overlapping cues together', () => {
    expect(
      canMoveSelectedClips({
        clips: [long, inner, third],
        tracks,
        selectedClipIds: new Set(['long', 'inner']),
        deltaTime: 0.5,
        deltaTrack: 0,
      })
    ).toBe(true)
  })

  it('moves the two overlapping cues together onto another row', () => {
    expect(
      canMoveSelectedClips({
        clips: [long, inner],
        tracks,
        selectedClipIds: new Set(['long', 'inner']),
        deltaTime: 0,
        deltaTrack: 1,
      })
    ).toBe(true)
  })

  it('moves the long cue across the inner one it already overlapped', () => {
    expect(
      canMoveSelectedClips({
        clips: [long, inner, loose],
        tracks,
        selectedClipIds: new Set(['long', 'loose']),
        deltaTime: 1,
        deltaTrack: 0,
      })
    ).toBe(true)
  })

  it('still refuses to move the long cue onto a clip it did not overlap', () => {
    expect(
      canMoveSelectedClips({
        clips: [long, inner, third, loose],
        tracks,
        selectedClipIds: new Set(['long', 'loose']),
        deltaTime: 3,
        deltaTrack: 0,
      })
    ).toBe(false)
  })
})
