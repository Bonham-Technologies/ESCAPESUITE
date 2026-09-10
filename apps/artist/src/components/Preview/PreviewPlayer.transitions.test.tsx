// The nine transition types PreviewPlayer composites between two adjacent
// clips, and how it chooses the clip a transition runs into.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  FRAME_MS,
  installPreviewDoubles,
  last,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { TransitionType } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('PreviewPlayer transitions', () => {
  /** Two adjacent clips on one track, the first transitioning into the second. */
  const twoClips = (type: TransitionType) => {
    const trackId = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, trackId)
    addClip('b', 2, 2, trackId)
    store().updateClipTransition('a', { type, duration: 1 })
  }

  it('crossfades the outgoing and incoming clips over the transition window', async () => {
    twoClips('fade')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('runs the crossfade from fully outgoing to fully incoming', async () => {
    twoClips('fade')

    const preview = await renderPreview()

    preview.clearCalls()
    store().setCurrentTime(1)
    await settle(FRAME_MS)
    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([1, 0])

    preview.clearCalls()
    store().setCurrentTime(1.999)
    await settle(FRAME_MS)
    const [out, incoming] = preview.frame().of('drawImage').map((c) => c.state.globalAlpha)
    expect(out).toBeCloseTo(0.001, 3)
    expect(incoming).toBeCloseTo(0.999, 3)
  })

  it('wraps a dissolve in its own blurred save/restore', async () => {
    twoClips('dissolve')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)
    const frame = preview.frame()

    // sin(0.5π) * 3 = 3px, set on the outer save() that wraps both draws.
    expect(frame.of('save')).toHaveLength(3)
    expect(frame.of('restore')).toHaveLength(3)
    expect(frame.of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('splits the canvas between the clips for a wipe', async () => {
    twoClips('wipe-left')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.25)
    await settle(FRAME_MS)
    const frame = preview.frame()

    expect(frame.argsFor('rect')).toEqual([
      [0, 0, 1440, 1080],
      [1440, 0, 480, 1080],
    ])
    expect(frame.of('clip')).toHaveLength(2)
  })

  it('splits the canvas the other way for wipe-right', async () => {
    twoClips('wipe-right')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.25)
    await settle(FRAME_MS)

    expect(preview.frame().argsFor('rect')).toEqual([
      [480, 0, 1440, 1080],
      [0, 0, 480, 1080],
    ])
  })

  it('wipes vertically for wipe-up and wipe-down', async () => {
    twoClips('wipe-up')
    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.25)
    await settle(FRAME_MS)
    expect(preview.frame().argsFor('rect')).toEqual([
      [0, 0, 1920, 810],
      [0, 810, 1920, 270],
    ])

    store().updateClipTransition('a', { type: 'wipe-down' })
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME_MS)
    expect(preview.frame().argsFor('rect')).toEqual([
      [0, 540, 1920, 540],
      [0, 0, 1920, 540],
    ])
  })

  it('offsets both clips horizontally for a slide', async () => {
    twoClips('slide-left')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    // offsetX -960 for the outgoing clip, +960 for the incoming one.
    expect(preview.frame().argsFor('drawImage').map((args) => args[1])).toEqual([-960, 960])
  })

  it('offsets both clips vertically for slide-up', async () => {
    twoClips('slide-up')

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    expect(preview.frame().argsFor('drawImage').map((args) => args[2])).toEqual([-540, 540])
  })

  it('slides the other way for slide-right and slide-down', async () => {
    twoClips('slide-right')
    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME_MS)
    expect(preview.frame().argsFor('drawImage').map((args) => args[1])).toEqual([960, -960])

    store().updateClipTransition('a', { type: 'slide-down' })
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME_MS)
    expect(preview.frame().argsFor('drawImage').map((args) => args[2])).toEqual([540, -540])
  })

  it('draws both clips untouched when the transition type is unknown', async () => {
    twoClips('none')
    store().updateClipTransition('a', { type: 'iris' as TransitionType, duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    const draws = preview.frame().of('drawImage')
    expect(draws).toHaveLength(2)
    expect(draws.map((d) => d.state.globalAlpha)).toEqual([1, 1])
  })

  it('transitions into the top-most clip on another track when the track has none', async () => {
    const lower = store().project.timeline.tracks[0].id
    const upper = store().addTrack('Upper').id
    addClip('a', 0, 2, upper)
    addClip('b', 0, 4, lower)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([0.5, 0.5])
  })

  it('takes the earliest of the clips queued behind the outgoing one', async () => {
    const track = store().project.timeline.tracks[0].id
    addClip('a', 0, 2, track)
    addClip('b', 2, 2, track)
    addClip('c', 4, 2, track)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    store().updateClipTransform('b', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    // b, drawn at half size, is the incoming clip — not the later c.
    expect(preview.frame().argsFor('drawImage').map((args) => args[3])).toEqual([1920, 960])
  })

  it('takes the top-most of the clips visible on other tracks', async () => {
    const low = store().project.timeline.tracks[0].id
    const mid = store().addTrack('Mid').id
    const high = store().addTrack('High').id
    addClip('a', 0, 2, high)
    addClip('low', 0, 4, low)
    addClip('mid', 0, 4, mid)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })
    store().updateClipTransform('mid', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    // The clip on the higher of the two remaining tracks wins the transition,
    // and is the half-size one drawn last.
    expect(last(preview.frame().argsFor('drawImage'))[3]).toBe(960)
  })

  it('ignores a transition with no clip to transition into', async () => {
    addClip('a', 0, 2)
    store().updateClipTransition('a', { type: 'fade', duration: 1 })

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    expect(preview.frame().of('drawImage').map((c) => c.state.globalAlpha)).toEqual([1])
  })
})
