// The one visibility question every reader of a track asks, over the tracks
// (and, for isVisibleTrack, the lookup result) it is handed (ESCSUITE-178).
import { describe, it, expect } from 'vitest'
import { isTrackVisible, isVisibleTrack } from './trackVisibility'
import type { Track } from './types'

const track = (id: string, visible: boolean): Track => ({
  id, name: id, index: 0, visible, locked: false, muted: false, volume: 1, height: 60,
})
const tracks = [track('shown', true), track('hidden', false)]

describe('isVisibleTrack', () => {
  it('is true for a visible track', () => {
    expect(isVisibleTrack(tracks[0])).toBe(true)
  })
  it('is false for a hidden track, and for no track at all', () => {
    expect(isVisibleTrack(tracks[1])).toBe(false)
    expect(isVisibleTrack(undefined)).toBe(false)
  })
})

describe('isTrackVisible', () => {
  it('is true for a visible track', () => { expect(isTrackVisible(tracks, 'shown')).toBe(true) })
  it('is false for a hidden track', () => { expect(isTrackVisible(tracks, 'hidden')).toBe(false) })
  it('is false for a track that is not on the timeline', () => { expect(isTrackVisible(tracks, 'gone')).toBe(false) })
  it('is false for no track at all', () => { expect(isTrackVisible(tracks, undefined)).toBe(false) })
})
