// ESCSUITE-255: the store refuses a transform that is not finite — the second
// line of defence behind the importer's media-type probe. A 0x0 "video"'s
// Fit to Canvas used to write scaleX: Infinity, which the autosave kept and
// the saved file serialised as null.
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'

const clipTransform = (id: string) =>
  store().project.timeline.clips.find((c) => c.id === id)!.transform

describe('updateClipTransform refuses a transform that is not finite (ESCSUITE-255)', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('c1', 0)
  })

  it.each([
    ['Infinity scaleX', { scaleX: Infinity }],
    ['NaN scaleY', { scaleY: NaN }],
    ['zero scaleX', { scaleX: 0 }],
    ['negative scaleY', { scaleY: -1 }],
    ['non-finite x', { x: Infinity }],
    ['NaN rotation', { rotation: NaN }],
    ['non-finite opacity', { opacity: -Infinity }],
    ['a finite field beside a bad one', { x: 0.2, scaleX: Infinity }],
  ])('returns false, writes nothing and adds no undo entry for %s', (_label, update) => {
    const before = clipTransform('c1')
    const pastLength = useEditorStore.getState().history.past.length

    const result = store().updateClipTransform('c1', update)

    expect(result).toBe(false)
    expect(clipTransform('c1')).toEqual(before)
    expect(useEditorStore.getState().history.past).toHaveLength(pastLength)
  })

  it('still lands a finite write, scaleLocked included', () => {
    const pastLength = useEditorStore.getState().history.past.length

    const result = store().updateClipTransform('c1', { scaleX: 0.5, scaleY: 0.5, scaleLocked: false })

    expect(result).toBe(true)
    expect(clipTransform('c1')).toMatchObject({ scaleX: 0.5, scaleY: 0.5, scaleLocked: false })
    expect(useEditorStore.getState().history.past).toHaveLength(pastLength + 1)
  })

  it('lets a write that leaves a field undefined through the guard', () => {
    expect(store().updateClipTransform('c1', { x: 0.25, y: undefined })).toBe(true)
    expect(clipTransform('c1').x).toBe(0.25)
  })
})

describe('updateClip refuses a non-finite transform (ESCSUITE-255)', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('c1', 0)
  })

  it.each([
    ['Infinity scale', { x: 0.5, y: 0.5, scaleX: Infinity, scaleY: 1, rotation: 0, opacity: 1 }],
    ['zero scale', { x: 0.5, y: 0.5, scaleX: 1, scaleY: 0, rotation: 0, opacity: 1 }],
    ['NaN position', { x: NaN, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }],
  ])('returns false and writes nothing for %s', (_label, transform) => {
    const before = clipTransform('c1')
    const pastLength = useEditorStore.getState().history.past.length

    const result = store().updateClip('c1', { transform })

    expect(result).toBe(false)
    expect(clipTransform('c1')).toEqual(before)
    expect(useEditorStore.getState().history.past).toHaveLength(pastLength)
  })

  it('lands a finite transform, and an update that carries no transform at all', () => {
    const good = { x: 0.1, y: 0.2, scaleX: 2, scaleY: 2, rotation: 10, opacity: 0.5 }

    expect(store().updateClip('c1', { transform: good })).toBe(true)
    expect(clipTransform('c1')).toEqual(good)
    expect(store().updateClip('c1', { name: 'renamed' })).toBe(true)
  })
})
