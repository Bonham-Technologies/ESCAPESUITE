import { describe, it, expect } from 'vitest'
import { getBaseDimensions } from './exportTypes'
import type { Clip, Track, SourceVideo } from '../store/types'

const track = (id: string, index: number): Track =>
  ({ id, name: id, index, visible: true, locked: false, muted: false, volume: 1, height: 60 })
const clip = (id: string, sourceVideoId: string, trackId: string, extra: Partial<Clip> = {}): Clip =>
  ({ id, sourceVideoId, trackId, ...extra } as unknown as Clip)
const src = (id: string, width: number, height: number): SourceVideo =>
  ({ id, width, height } as unknown as SourceVideo)

describe('getBaseDimensions', () => {
  it('uses the bottom-most media clip by track index, not clip order', () => {
    const tracks = [track('top', 2), track('bottom', 0)]
    const clips = [clip('c-top', 'hd', 'top'), clip('c-bottom', 'sd', 'bottom')]
    const sources = [src('hd', 1920, 1080), src('sd', 640, 360)]
    expect(getBaseDimensions(clips, tracks, sources)).toEqual({ width: 640, height: 360 })
  })

  it('skips overlay clips and sources without dimensions', () => {
    const tracks = [track('t0', 0), track('t1', 1)]
    const clips = [
      clip('text', '', 't0', { overlayType: 'text' }),
      clip('nodims', 'nodims', 't0'),
      clip('video', 'v', 't1'),
    ]
    const sources = [src('nodims', 0, 0), src('v', 1280, 720)]
    expect(getBaseDimensions(clips, tracks, sources)).toEqual({ width: 1280, height: 720 })
  })

  it('falls back to 1080p for overlay-only timelines', () => {
    expect(getBaseDimensions([clip('text', '', 't0', { overlayType: 'text' })], [track('t0', 0)], [])).toEqual({ width: 1920, height: 1080 })
  })
})
