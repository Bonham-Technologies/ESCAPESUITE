import { describe, it, expect } from 'vitest'
import {
  SEPARATE_TRACKS_NO_SPACE_REASON,
  SEPARATE_TRACKS_NO_WEBCODECS_REASON,
  separateTracksBlockedReason,
} from './separateTracksReadiness'

describe('separateTracksBlockedReason', () => {
  it('is null when the browser can serve it and there is room', () => {
    expect(separateTracksBlockedReason(true, true)).toBeNull()
  })

  it('blames the browser first — that is the fact the user cannot act on', () => {
    expect(separateTracksBlockedReason(false, false)).toBe(SEPARATE_TRACKS_NO_WEBCODECS_REASON)
  })

  it('blames storage when the browser could have served it', () => {
    expect(separateTracksBlockedReason(true, false)).toBe(SEPARATE_TRACKS_NO_SPACE_REASON)
  })
})
