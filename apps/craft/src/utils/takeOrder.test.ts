// The order the library shows takes in.
//
// A take can be several rows now (ESCSUITE-14), and a row's neighbours are
// what say so: the webcam half is meaningful directly under its primary and
// meaningless three takes away. The ordering is pure over the list so it can be
// asserted without storage — `loadRecordings` is the only caller.
import { describe, it, expect } from 'vitest'
import { orderTakes } from './takeOrder'
import type { Recording } from '../store/types'

function row(id: string, createdAt: number, extra: Partial<Recording> = {}): Recording {
  return {
    id,
    name: id,
    duration: 6,
    createdAt,
    size: 1024,
    hasWebcam: false,
    hasAudio: true,
    ...extra,
  }
}

describe('orderTakes', () => {
  it('keeps newest-first when every take is a single file', () => {
    expect(orderTakes([row('older', 1000), row('newer', 3000)]).map(r => r.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('puts a companion directly under its primary, wherever the primary sorts', () => {
    const ordered = orderTakes([
      row('webcam-of-old', 1001, { takeId: 'old', role: 'webcam', hasWebcam: true }),
      row('newest', 5000),
      row('old', 1000, { takeId: 'old', role: 'screen', hasWebcam: true }),
    ])

    // The companion follows its primary rather than its own timestamp: it was
    // saved a moment after the primary, so by date alone it would sort above it.
    expect(ordered.map(r => r.id)).toEqual(['newest', 'old', 'webcam-of-old'])
  })

  it('demotes a primary whose companion is gone, without touching it', () => {
    const ordered = orderTakes([row('take', 2000, { takeId: 'take', role: 'screen', hasWebcam: true })])

    // Deleting the companion alone leaves the primary's own takeId in place;
    // with nothing grouped under it the row is a plain take again, so nothing
    // has to rewrite stored metadata on a delete.
    expect(ordered.map(r => r.id)).toEqual(['take'])
  })

  it('still shows an orphan companion, newest-first, after the takes', () => {
    const ordered = orderTakes([
      row('orphan', 4000, { takeId: 'deleted-primary', role: 'webcam', hasWebcam: true }),
      row('take', 2000),
    ])

    // A companion whose primary is missing — storage cleared mid-take, or a
    // half-saved take — is a row rather than a hidden file the user cannot
    // delete.
    expect(ordered.map(r => r.id)).toEqual(['take', 'orphan'])
  })

  it('orders two companions of the same take oldest-first under their primary', () => {
    // Two companions sharing one takeId, so both the "a group already exists"
    // branch and the companions' own sort comparator actually run.
    const ordered = orderTakes([
      row('second-companion', 1002, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('first-companion', 1001, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual(['take', 'first-companion', 'second-companion'])
  })

  it('sorts multiple orphan companions newest-first', () => {
    // Two orphans, so the orphan sort's comparator actually runs (Array.sort
    // never calls a comparator for a single-element array).
    const ordered = orderTakes([
      row('older-orphan', 1000, { takeId: 'gone-1', role: 'webcam', hasWebcam: true }),
      row('newer-orphan', 2000, { takeId: 'gone-2', role: 'webcam', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual(['newer-orphan', 'older-orphan'])
  })

  it('orders a take three companions deep by role, not by the order storage returned', () => {
    // Every part of a take is saved with one `now`, so `createdAt` cannot order
    // them and `getRecordingsMetadata()` returns key order, which is uuid order
    // — a coin toss. The role is what says which track is which.
    const ordered = orderTakes([
      row('system-part', 1000, { takeId: 'take', role: 'system', hasAudio: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
      row('mic-part', 1000, { takeId: 'take', role: 'mic', hasAudio: true }),
      row('webcam-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual([
      'take',
      'webcam-part',
      'mic-part',
      'system-part',
    ])
  })

  it('falls back to the id for two companions of one role saved in one millisecond', () => {
    // Rank and date both tie, so something has to decide, and it must not be
    // whatever the engine's sort happened to do.
    const ordered = orderTakes([
      row('b-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('a-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual(['take', 'a-part', 'b-part'])
  })

  it('sorts a companion whose role is missing or unrecognised after the roles it knows', () => {
    // IndexedDB is not type-checked, so "is this a role we know?" is a runtime
    // question: a row can carry a takeId with no role at all, and a build newer
    // than this one could store a role this one has never heard of. Both sort
    // last rather than first, so an unknown part cannot push the webcam row off
    // the top of its own take.
    const ordered = orderTakes([
      row('roleless-part', 1000, { takeId: 'take' }),
      row('mystery-part', 1000, { takeId: 'take', role: 'haptics' as unknown as Recording['role'] }),
      row('webcam-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual([
      'take',
      'webcam-part',
      'mystery-part',
      'roleless-part',
    ])
  })
})
