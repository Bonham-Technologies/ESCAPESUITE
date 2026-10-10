import { describe, it, expect } from 'vitest'
import { scrubDeadThumbnails, scrubRemovedSources } from './storeHistory'
import { createEmptyProject } from './projectFactory'
import { makeClip } from '../test/fixtures/clipFixtures'
import type { Clip, SourceVideo, UndoableState } from './types'

// ESCSUITE-244: the scrub helpers' no-op and clip-only arms, reached directly.
const make = (id: string, extra: Partial<SourceVideo> = {}): SourceVideo => ({
  id, name: `${id}.mp4`, duration: 10, width: 1920, height: 1080,
  frameRate: 30, mimeType: 'video/mp4', size: 1000, ...extra,
})
const snap = (sourceVideos: SourceVideo[], clips: Clip[] = []): UndoableState => {
  const project = createEmptyProject()
  return {
    project: { ...project, timeline: { ...project.timeline, clips } },
    sourceVideos,
  }
}

describe('scrubDeadThumbnails', () => {
  it('clears a dead URL and returns a snapshot carrying a live one untouched', () => {
    const dead = snap([make('a', { thumbnailUrl: 'blob:dead' })])
    const live = snap([make('b', { thumbnailUrl: 'blob:live' })])
    const out = scrubDeadThumbnails({ past: [dead, live], future: [] }, ['blob:dead'])
    expect(out.past[0].sourceVideos[0].thumbnailUrl).toBeUndefined()
    expect(out.past[1]).toBe(live)
  })
})

describe('scrubRemovedSources', () => {
  it('drops the id from sourceVideos and its clips', () => {
    const s = snap([make('a')], [makeClip({ id: 'c1', sourceVideoId: 'a' })])
    const out = scrubRemovedSources({ past: [s], future: [] }, ['a'])
    expect(out.past[0].sourceVideos).toEqual([])
    expect(out.past[0].project.timeline.clips).toEqual([])
  })

  it('reaches a snapshot only through a clip, dropping it and recomputing duration', () => {
    const s = snap(
      [make('other')],
      [
        makeClip({ id: 'gone', sourceVideoId: 'a', duration: 8, endTime: 8, timelinePosition: 0 }),
        makeClip({ id: 'kept', sourceVideoId: 'other', duration: 3, endTime: 3, timelinePosition: 0 }),
      ]
    )
    const out = scrubRemovedSources({ past: [], future: [s] }, ['a'])
    const t = out.future[0].project.timeline
    expect(t.clips.map((c) => c.id)).toEqual(['kept'])
    expect(t.duration).toBe(3)
    expect(out.future[0].sourceVideos.map((v) => v.id)).toEqual(['other'])
  })

  it('returns the identical snapshot, and history, when nothing names the id', () => {
    const s = snap([make('x')], [makeClip({ sourceVideoId: 'x' })])
    const history = { past: [s], future: [] }
    const out = scrubRemovedSources(history, ['a'])
    expect(out).toBe(history)
    expect(out.past[0]).toBe(s)
  })

  it('keeps a clip with no sourceVideoId beside a removed clip', () => {
    const overlay = makeClip({ id: 'overlay', sourceVideoId: undefined })
    const s = snap([], [makeClip({ id: 'gone', sourceVideoId: 'a' }), overlay])
    const out = scrubRemovedSources({ past: [s], future: [] }, ['a'])
    expect(out.past[0].project.timeline.clips.map((c) => c.id)).toEqual(['overlay'])
  })
})
