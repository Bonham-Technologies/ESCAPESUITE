// The transition lookup the preview draws through. It is the export pipeline's
// own, re-exported: these cases pin the behaviour the preview depends on, and
// the identity check pins that there is still only one implementation of it.
import { describe, it, expect } from 'vitest'
import { getActiveTransition } from './transitions'
import { getActiveTransition as exporterGetActiveTransition } from '../../core/exportTypes'
import type { Clip, Track, TransitionType } from '../../store/types'

const track = (id: string, index: number, visible = true): Track =>
  ({ id, name: id, index, visible, locked: false, muted: false, volume: 1, height: 60 }) as Track

const clip = (
  id: string,
  trackId: string,
  timelinePosition: number,
  duration: number,
  transition: { type: TransitionType; duration: number } = { type: 'none', duration: 0 }
): Clip =>
  ({
    id,
    sourceVideoId: 'source',
    trackId,
    timelinePosition,
    duration,
    transition,
  }) as unknown as Clip

const tracks = [track('lower', 0), track('upper', 1)]

describe('getActiveTransition', () => {
  it('is the exporter’s implementation, not a copy of it', () => {
    expect(getActiveTransition).toBe(exporterGetActiveTransition)
  })

  it('finds nothing on an empty timeline', () => {
    expect(getActiveTransition([], tracks, 0)).toBeNull()
  })

  it('finds nothing when the adjacent clips have no transition between them', () => {
    const clips = [clip('a', 'lower', 0, 2), clip('b', 'lower', 2, 2)]
    expect(getActiveTransition(clips, tracks, 1.5)).toBeNull()
  })

  it('pairs adjacent clips once the playhead enters the transition window', () => {
    const clips = [clip('a', 'lower', 0, 2, { type: 'fade', duration: 1 }), clip('b', 'lower', 2, 2)]

    expect(getActiveTransition(clips, tracks, 0.9)).toBeNull()
    const active = getActiveTransition(clips, tracks, 1.5)
    expect(active).toMatchObject({ type: 'fade', progress: 0.5 })
    expect(active!.outgoingClip.id).toBe('a')
    expect(active!.incomingClip.id).toBe('b')
  })

  it('runs progress from 0 at the window’s start to 1 at the cut, exclusive of the cut', () => {
    const clips = [clip('a', 'lower', 0, 2, { type: 'wipe-left', duration: 1 }), clip('b', 'lower', 2, 2)]

    expect(getActiveTransition(clips, tracks, 1)!.progress).toBe(0)
    expect(getActiveTransition(clips, tracks, 1.999)!.progress).toBeCloseTo(0.999, 3)
    expect(getActiveTransition(clips, tracks, 2)).toBeNull()
  })

  it('transitions into the top-most visible clip when the outgoing track has no successor', () => {
    const clips = [
      clip('a', 'upper', 0, 2, { type: 'fade', duration: 1 }),
      clip('under', 'lower', 0, 4),
    ]
    expect(getActiveTransition(clips, tracks, 1.5)!.incomingClip.id).toBe('under')
  })

  it('ignores a clip whose own track is hidden', () => {
    const hidden = [track('lower', 0, false), track('upper', 1)]
    const clips = [clip('a', 'lower', 0, 2, { type: 'fade', duration: 1 }), clip('b', 'lower', 2, 2)]
    expect(getActiveTransition(clips, hidden, 1.5)).toBeNull()
  })
})
