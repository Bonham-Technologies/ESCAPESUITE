// A take's parts, and the order they stack in (ESCSUITE-14).
//
// The mirror of ESCAPECRAFT's `utils/takeOrder.ts`: a take is named by its
// primary, so a part belongs to it when `part.takeId === primary.id`. Pure over
// the metadata list, so the grouping is asserted without storage —
// `app/takeImport.ts` is the only caller.
import { describe, it, expect } from 'vitest'
import { orderTakeParts, partRoleRank, isPlaceableRole } from './takeParts'
import type { SourceVideo } from '../store/types'

function part(id: string, extra: Partial<SourceVideo> = {}): SourceVideo {
  return {
    id,
    name: id,
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    ...extra,
  }
}

const primary = part('take-1', { takeId: 'take-1', role: 'screen' })

describe('orderTakeParts', () => {
  it('returns the primary alone when nothing else belongs to the take', () => {
    expect(orderTakeParts(primary, [primary, part('other')]).map((p) => p.id)).toEqual(['take-1'])
  })

  it('stacks the take by role: screen, webcam, mic, system', () => {
    const all = [
      part('sys', { takeId: 'take-1', role: 'system' }),
      part('cam', { takeId: 'take-1', role: 'webcam' }),
      primary,
      part('mic', { takeId: 'take-1', role: 'mic' }),
    ]

    // Storage order is whatever `getAll` returns, and the parts are written
    // within a millisecond or two of each other, so neither can decide the
    // stack. The role does: the camera goes over the screen, the audio above
    // that, and slice 3's parts need no change here to land in the right place.
    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual(['take-1', 'cam', 'mic', 'sys'])
  })

  it('ignores a part that belongs to another take', () => {
    const all = [primary, part('cam', { takeId: 'take-1', role: 'webcam' }), part('cam-2', { takeId: 'take-2', role: 'webcam' })]

    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual(['take-1', 'cam'])
  })

  it('puts a role this build does not know last, by id', () => {
    const all = [
      part('z-future', { takeId: 'take-1', role: 'hologram' as never }),
      part('a-future', { takeId: 'take-1', role: 'hologram' as never }),
      primary,
      part('cam', { takeId: 'take-1', role: 'webcam' }),
    ]

    // IndexedDB is not type-checked: a record written by a newer ESCAPECRAFT
    // has a role this build has never heard of. It still belongs to the take
    // and is still listed; where it ranks is decided rather than arbitrary.
    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual([
      'take-1',
      'cam',
      'a-future',
      'z-future',
    ])
  })

  it('never lists the primary twice, whatever storage holds', () => {
    expect(orderTakeParts(primary, [primary, primary]).map((p) => p.id)).toEqual(['take-1'])
  })
})

describe('isPlaceableRole', () => {
  it.each(['screen', 'webcam', 'mic', 'system'])('places a %s part', (role) => {
    expect(isPlaceableRole(role)).toBe(true)
    expect(Number.isFinite(partRoleRank(role))).toBe(true)
  })

  it.each([
    ['a role this build does not know', 'hologram'],
    ['no role at all', undefined],
  ])('does not place %s', (_label, role) => {
    expect(isPlaceableRole(role)).toBe(false)
    expect(partRoleRank(role)).toBe(Number.POSITIVE_INFINITY)
  })
})
