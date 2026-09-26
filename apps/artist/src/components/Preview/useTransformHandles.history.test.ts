// What a preview drag leaves on the undo stack.
//
// A gesture is one edit, so it is one history entry, and that entry has to hold
// the state from *before* the drag — `pushToHistory` snapshots the state it is
// handed, so the write that pushes must be the first one of the gesture, not
// the last. The sibling files cover the numbers a drag writes; this one covers
// only how many entries it leaves behind and what undoing one of them restores.
//
// The canvas is the default 1920x1080 project resolution laid out in a 960x540
// box, so a canvas pixel is half a client pixel and nothing is letterboxed. A
// default shape overlay is 0.2 x 0.2 of the canvas — 384 x 216 px around
// (960, 540).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type Preview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { Clip, ShapeOverlayData, TextOverlayData } from '../../store/types'

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

const clipOf = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

const past = (): number => store().history.past.length

const addShape = (data: Partial<ShapeOverlayData> = {}): Clip => {
  const clip = store().addShapeOverlayClip(data, undefined, 0, 4)!
  store().setSelectedClipId(clip.id)
  return clip
}

const addText = (data: Partial<TextOverlayData> = {}): Clip => {
  const clip = store().addTextOverlayClip(data, undefined, 0, 4)!
  store().setSelectedClipId(clip.id)
  return clip
}

const inKeyframeMode = (clip: Clip) => {
  store().setSelectedClipId(clip.id)
  store().setKeyframePanelOpen(true)
}

/** One step of the drags below, in canvas pixels: 1% of the frame's width. */
const STEP = 19.2

/**
 * A move drag rightwards from `startX` on the vertical centre line, in `steps`
 * moves of `STEP` px.
 *
 * Every move gets its own animation frame, so the throttled updaters each
 * reach the store once per step — which is the whole point: a long drag is
 * many store writes and still has to be one undo entry.
 */
async function dragFrom(preview: Preview, startX: number, steps = 10): Promise<void> {
  fireEvent.mouseDown(preview.canvas, preview.at(startX, 540))
  await settle()
  for (let step = 1; step <= steps; step++) {
    fireEvent.mouseMove(window, preview.at(startX + step * STEP, 540))
    await settle(FRAME_MS)
  }
  fireEvent.mouseUp(window)
  await settle(FRAME_MS)
}

/** The same, from the centre of an untouched clip. */
const dragFromCentre = (preview: Preview, steps = 10): Promise<void> =>
  dragFrom(preview, 960, steps)

describe('preview drags and the undo stack', () => {
  it('leaves one entry for a keyframe-mode drag, however many moves it took', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    const before = past()
    await dragFromCentre(preview)

    expect(clipOf(shape.id).animation!.keyframes!.x).toBeDefined()
    expect(past()).toBe(before + 1)
  })

  it('undoes a keyframe-mode drag back to the keyframes the clip started with', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await dragFromCentre(preview)

    store().undo()

    expect(clipOf(shape.id).animation?.keyframes?.x).toBeUndefined()
  })

  it('leaves one entry for a shape drag and undoes it to the pre-drag position', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    const before = past()
    await dragFromCentre(preview)

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.6, 5)
    expect(past()).toBe(before + 1)

    store().undo()

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.5, 5)
    expect(clipOf(shape.id).shapeData!.y).toBeCloseTo(0.5, 5)
  })

  it('leaves one entry for a text drag and undoes it to the pre-drag position', async () => {
    const text = addText()

    const preview = await renderPreview()
    const before = past()
    await dragFromCentre(preview)

    expect(clipOf(text.id).textData!.x).toBeCloseTo(0.6, 5)
    expect(past()).toBe(before + 1)

    store().undo()

    expect(clipOf(text.id).textData!.x).toBeCloseTo(0.5, 5)
    expect(clipOf(text.id).textData!.y).toBeCloseTo(0.5, 5)
  })

  it('leaves one entry for a media-clip drag and undoes it to the pre-drag transform', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    const before = past()
    await dragFromCentre(preview)

    expect(clipOf('clip1').transform.x).toBeCloseTo(0.6, 5)
    expect(past()).toBe(before + 1)

    store().undo()

    expect(clipOf('clip1').transform.x).toBeCloseTo(0.5, 5)
    expect(clipOf('clip1').transform.y).toBeCloseTo(0.5, 5)
  })

  // The invariant the whole scheme rests on: the `skipHistory` flag belongs to
  // the write that reaches the store, not to the mousemove that asked for one.
  // The throttler keeps only the newest closure per frame, so a flag read at
  // schedule time is consumed by a move whose closure is then thrown away —
  // and a gesture whose moves all outran the frame (the normal case in a real
  // browser, and the reason every other test here spends a frame per move)
  // would push nothing at all, leaving the next undo to eat the edit before it.
  it('pushes one entry when a single frame swallows several moves', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    const before = past()

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseMove(window, preview.at(1000, 540))
    fireEvent.mouseMove(window, preview.at(1100, 540))
    fireEvent.mouseMove(window, preview.at(1152, 540))
    await settle(FRAME_MS)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(clipOf('clip1').transform.x).toBeCloseTo(0.6, 5)
    expect(past()).toBe(before + 1)

    store().undo()

    expect(clipOf('clip1').transform.x).toBeCloseTo(0.5, 5)
  })

  it('leaves nothing behind for a press released without a move', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    const before = past()

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(clipOf(shape.id).shapeData!.x).toBe(0.5)
    expect(past()).toBe(before)
  })

  it('leaves nothing behind for a press released without a move in keyframe mode', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    const before = past()

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(clipOf(shape.id).animation?.keyframes?.x).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('gives two consecutive drags an entry each', async () => {
    addShape()

    const preview = await renderPreview()
    const before = past()
    await dragFrom(preview, 960, 3)
    // The clip has moved three steps right, so the second press starts there.
    await dragFrom(preview, 960 + 3 * STEP, 3)

    expect(past()).toBe(before + 2)
  })

  it('gives two consecutive keyframe-mode drags an entry each', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    const before = past()
    await dragFrom(preview, 960, 3)
    await dragFrom(preview, 960 + 3 * STEP, 3)

    expect(past()).toBe(before + 2)
  })
})
