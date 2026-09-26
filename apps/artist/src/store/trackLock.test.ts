// The lock's four questions, over the clips and tracks they are handed (ESCSUITE-84).
import { describe, it, expect } from 'vitest'
import { anyClipOnLockedTrack, clipOnLockedTrack, isTrackLocked, lockedTrackIds } from './trackLock'
import type { Clip, Track } from './types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_TRANSITION } from './types'

const track = (id: string, locked: boolean): Track => ({
  id, name: id, index: 0, visible: true, locked, muted: false, volume: 1, height: 60,
})
const clip = (id: string, trackId: string): Clip => ({
  id, sourceVideoId: 'v', name: id, startTime: 0, endTime: 1, duration: 1, trackId,
  timelinePosition: 0, blendMode: 'normal', transform: { ...DEFAULT_TRANSFORM },
  effects: { ...DEFAULT_EFFECTS }, transition: { ...DEFAULT_TRANSITION },
})
const tracks = [track('free', false), track('held', true)]
const clips = [clip('a', 'free'), clip('b', 'held')]

describe('lockedTrackIds', () => {
  it('names the locked tracks and nothing else', () => {
    expect([...lockedTrackIds(tracks)]).toEqual(['held'])
  })
})

describe('isTrackLocked', () => {
  it('is true for a locked track', () => { expect(isTrackLocked(tracks, 'held')).toBe(true) })
  it('is false for an unlocked track', () => { expect(isTrackLocked(tracks, 'free')).toBe(false) })
  it('is false for a track that is not on the timeline', () => { expect(isTrackLocked(tracks, 'gone')).toBe(false) })
  it('is false for no track at all', () => { expect(isTrackLocked(tracks, undefined)).toBe(false) })
})

describe('clipOnLockedTrack', () => {
  it('is true for a clip on a locked track', () => { expect(clipOnLockedTrack(clips, tracks, 'b')).toBe(true) })
  it('is false for a clip on an unlocked track', () => { expect(clipOnLockedTrack(clips, tracks, 'a')).toBe(false) })
  it('is false for a clip that is not on the timeline', () => { expect(clipOnLockedTrack(clips, tracks, 'zz')).toBe(false) })
})

describe('anyClipOnLockedTrack', () => {
  it('is true when one of the clips is on a locked track', () => {
    expect(anyClipOnLockedTrack(clips, tracks, ['a', 'b'])).toBe(true)
  })
  it('is false when none is', () => { expect(anyClipOnLockedTrack(clips, tracks, ['a'])).toBe(false) })
  it('is false for no clips', () => { expect(anyClipOnLockedTrack(clips, tracks, [])).toBe(false) })
  it('takes a Set as well as an array', () => {
    expect(anyClipOnLockedTrack(clips, tracks, new Set(['b']))).toBe(true)
  })
})
