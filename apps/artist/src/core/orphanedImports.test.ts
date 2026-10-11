import { describe, it, expect } from 'vitest'
import { orphanedImports, editorSourceIds, totalBytes } from './orphanedImports'
import type { SourceVideo } from '@escapesuite/shared/types'

// ESCSUITE-268: rows in the shared `videos` store that no project in this
// editor references and that ESCAPECRAFT does not own — the imports ESCSUITE-244
// stopped orphaning, from sessions before it.

const row = (id: string, extra: Partial<SourceVideo> = {}): SourceVideo => ({
  id,
  name: `${id}.mp4`,
  duration: 1,
  width: 640,
  height: 360,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 100,
  ...extra,
})

const none: ReadonlySet<string> = new Set()

describe('orphanedImports', () => {
  it('offers an import nothing references', () => {
    expect(orphanedImports([row('a')], none).map((r) => r.id)).toEqual(['a'])
  })

  it('never offers a row this project references', () => {
    expect(orphanedImports([row('a'), row('b')], new Set(['a'])).map((r) => r.id)).toEqual(['b'])
  })

  it('never offers an ESCAPECRAFT recording, whatever its age', () => {
    expect(orphanedImports([row('take', { source: 'recording' })], none)).toEqual([])
  })

  it("never offers a row sharing a recording's takeId (a take's companion)", () => {
    const rows = [
      row('primary', { source: 'recording', takeId: 'primary' }),
      row('companion', { takeId: 'primary', role: 'webcam' }),
    ]
    expect(orphanedImports(rows, none)).toEqual([])
  })

  it("never offers a row whose takeId is a recording's own id, when that recording carries none", () => {
    const rows = [row('take', { source: 'recording' }), row('part', { takeId: 'take' })]
    expect(orphanedImports(rows, none)).toEqual([])
  })

  it("never offers a row whose takeId matches a recording companion's takeId whose primary is gone", () => {
    const rows = [
      row('webcam', { source: 'recording', takeId: 'gone-primary', role: 'webcam' }),
      row('mic', { takeId: 'gone-primary', role: 'mic' }),
    ]
    expect(orphanedImports(rows, none)).toEqual([])
  })

  it('offers a row with a takeId no recording names', () => {
    const rows = [row('take', { source: 'recording' }), row('stray', { takeId: 'other' })]
    expect(orphanedImports(rows, none).map((r) => r.id)).toEqual(['stray'])
  })
})

describe('editorSourceIds', () => {
  it('is the live library plus every source an undo or redo snapshot holds', () => {
    const ids = editorSourceIds([row('live')], [
      { sourceVideos: [row('past')] },
      { sourceVideos: [row('future'), row('live')] },
    ])
    expect([...ids].sort()).toEqual(['future', 'live', 'past'])
  })
})

describe('totalBytes', () => {
  it('sums the stored sizes', () => {
    expect(totalBytes([row('a', { size: 3 }), row('b', { size: 4 })])).toBe(7)
  })

  it('is 0 for nothing', () => {
    expect(totalBytes([])).toBe(0)
  })
})
