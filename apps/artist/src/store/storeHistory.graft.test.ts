import { describe, it, expect } from 'vitest'
import { graftAddedSource } from './storeHistory'
import { createEmptyProject } from './projectFactory'
import type { SourceVideo, UndoableState } from './types'

// ESCSUITE-244: the inverse of scrubRemovedSources.
const make = (id: string, extra: Partial<SourceVideo> = {}): SourceVideo => ({
  id, name: `${id}.mp4`, duration: 10, width: 1920, height: 1080,
  frameRate: 30, mimeType: 'video/mp4', size: 1000, ...extra,
})
const snap = (...sourceVideos: SourceVideo[]): UndoableState => ({
  project: createEmptyProject(),
  sourceVideos,
})

describe('graftAddedSource', () => {
  it('returns the same history object when there is nothing on the stack', () => {
    const history = { past: [], future: [] }
    expect(graftAddedSource(history, make('a'))).toBe(history)
  })

  it('appends to every past snapshot', () => {
    const history = { past: [snap(), snap(make('x'))], future: [] }
    const out = graftAddedSource(history, make('a'))
    expect(out.past.map((s) => s.sourceVideos.map((v) => v.id))).toEqual([['a'], ['x', 'a']])
    expect(out.future).toEqual([])
  })

  it('appends to every future snapshot', () => {
    const history = { past: [], future: [snap(), snap(make('x'))] }
    const out = graftAddedSource(history, make('a'))
    expect(out.future.map((s) => s.sourceVideos.map((v) => v.id))).toEqual([['a'], ['x', 'a']])
    expect(out.past).toEqual([])
  })

  it('reaches both stacks at once', () => {
    const out = graftAddedSource({ past: [snap()], future: [snap()] }, make('a'))
    expect(out.past[0].sourceVideos).toHaveLength(1)
    expect(out.future[0].sourceVideos).toHaveLength(1)
  })

  it('replaces an id a snapshot already holds, in place, and leaves order alone', () => {
    const out = graftAddedSource(
      { past: [snap(make('a', { name: 'old.mp4' }), make('b'))], future: [] },
      make('a', { name: 'new.mp4' })
    )
    expect(out.past[0].sourceVideos.map((v) => v.name)).toEqual(['new.mp4', 'b.mp4'])
  })

  it('returns the same history object when every snapshot already holds an equal entry', () => {
    const history = { past: [snap(make('a'))], future: [snap(make('a'))] }
    expect(graftAddedSource(history, make('a'))).toBe(history)
  })

  it('keeps the identity of a snapshot it did not change', () => {
    const untouched = snap(make('a'))
    const out = graftAddedSource({ past: [untouched, snap()], future: [] }, make('a'))
    expect(out.past[0]).toBe(untouched)
    expect(out.past[1].sourceVideos).toHaveLength(1)
  })
})
