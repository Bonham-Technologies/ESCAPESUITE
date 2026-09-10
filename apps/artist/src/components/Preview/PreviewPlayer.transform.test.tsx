// Dragging the transform handles in the preview: the numbers each gesture
// leaves on the clip, derived from the canvas geometry the component documents.
//
// The canvas is the default 1920x1080 project resolution laid out in a 960x540
// box, so a canvas pixel is half a client pixel and nothing is letterboxed.
// A default shape overlay is 0.2 x 0.2 of the canvas — 384 x 216 px around
// (960, 540) — and a default text overlay measures 100 x 57.6 px, because the
// canvas double reports every string as 100px wide and the line height is
// fontSize * 1.2.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  FRAME_MS,
  installPreviewDoubles,
  last,
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

/** Half the width and height of a default shape overlay, in canvas pixels. */
const SHAPE = { halfW: 192, halfH: 108 }
/** The same for a default 48px text overlay. */
const TEXT = { halfW: 50, halfH: 28.8 }

const clipOf = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

const addShape = (data: Partial<ShapeOverlayData> = {}): Clip => {
  const clip = store().addShapeOverlayClip(data, undefined, 0, 4)
  store().setSelectedClipId(clip.id)
  return clip
}

const addText = (data: Partial<TextOverlayData> = {}): Clip => {
  const clip = store().addTextOverlayClip(data, undefined, 0, 4)
  store().setSelectedClipId(clip.id)
  return clip
}

/** Press at the first canvas point, move through the rest, release. */
async function drag(preview: Preview, points: Array<[number, number]>, init: object = {}) {
  const [start, ...rest] = points
  fireEvent.mouseDown(preview.canvas, { ...preview.at(...start), ...init })
  await settle()
  for (const point of rest) {
    fireEvent.mouseMove(window, { ...preview.at(...point), ...init })
    await settle(FRAME_MS)
  }
  fireEvent.mouseUp(window)
  await settle(FRAME_MS)
}

describe('PreviewPlayer move drags', () => {
  it('moves a shape overlay by the distance dragged', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1152, 648],
    ])

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.6, 5)
    expect(clipOf(shape.id).shapeData!.y).toBeCloseTo(0.6, 5)
  })

  it('moves a text overlay by the distance dragged', async () => {
    const text = addText()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [768, 432],
    ])

    expect(clipOf(text.id).textData!.x).toBeCloseTo(0.4, 5)
    expect(clipOf(text.id).textData!.y).toBeCloseTo(0.4, 5)
  })

  it('moves a media clip by writing its transform', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1344, 540],
    ])

    expect(clipOf('clip1').transform.x).toBeCloseTo(0.7, 5)
    expect(clipOf('clip1').transform.y).toBeCloseTo(0.5, 5)
  })

  it('clamps a move to the edges of the frame', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [-3840, -2160],
    ])

    expect(clipOf(shape.id).shapeData!.x).toBe(0)
    expect(clipOf(shape.id).shapeData!.y).toBe(0)
  })

  it('coalesces a burst of moves into the last position', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseMove(window, preview.at(1000, 540))
    fireEvent.mouseMove(window, preview.at(1100, 540))
    fireEvent.mouseMove(window, preview.at(1152, 540))
    await settle(FRAME_MS)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.6, 5)
  })

  it('leaves the drag running when the pointer leaves the canvas', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseLeave(preview.canvas)
    await settle()
    fireEvent.mouseMove(window, preview.at(1152, 540))
    await settle(FRAME_MS)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.6, 5)
  })

  it('stops following the pointer once the button is released', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1152, 540],
    ])
    fireEvent.mouseMove(window, preview.at(1900, 540))
    await settle(FRAME_MS)

    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.6, 5)
  })
})

describe('PreviewPlayer rotate drags', () => {
  it('rotates a shape overlay to the angle the pointer stands at', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH - 25],
      [1500, 540],
    ])

    // Grabbed straight above the centre, released straight to its right.
    expect(clipOf(shape.id).shapeData!.rotation).toBeCloseTo(90, 5)
  })

  it('rotates a text overlay', async () => {
    const text = addText()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - TEXT.halfH - 25],
      [200, 540],
    ])

    // The angle is accumulated, not wrapped: grabbing the grip above the text
    // and releasing to its left is a three-quarter turn, not a quarter back.
    expect(clipOf(text.id).textData!.rotation).toBeCloseTo(270, 5)
  })

  it('rotates a media clip', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - 540 - 25],
      [1500, 540],
    ])

    expect(clipOf('clip1').transform.rotation).toBeCloseTo(90, 5)
  })

  it('adds the drag to the rotation the clip already had', async () => {
    // A square project, because the angle is measured in normalised canvas
    // coordinates: on a 16:9 frame the same visual angle reads differently on
    // each axis, and only a square canvas makes the arithmetic exact.
    store().setProjectResolution(1080, 1080)
    const shape = addShape({ rotation: 45 })

    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 540, height: 540 } })
    // The grip travels with the box, so grab it where the rotation puts it.
    const radius = 108 + 25
    await drag(preview, [
      [540 + radius * Math.SQRT1_2, 540 - radius * Math.SQRT1_2],
      [1000, 540],
    ])

    expect(clipOf(shape.id).shapeData!.rotation).toBeCloseTo(90, 5)
  })
})

describe('PreviewPlayer corner resize drags', () => {
  it('scales a shape uniformly from a corner when the aspect is locked', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540 + SHAPE.halfH],
      [960 + SHAPE.halfW + 192, 540 + SHAPE.halfH + 54],
    ])

    // width +0.1 (ratio 1.5), height +0.05 (ratio 1.25): the larger wins both.
    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.3, 5)
    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.3, 5)
  })

  it('scales a shape freely from a corner when shift unlocks the aspect', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(
      preview,
      [
        [960 + SHAPE.halfW, 540 + SHAPE.halfH],
        [960 + SHAPE.halfW + 192, 540 + SHAPE.halfH + 54],
      ],
      { shiftKey: true }
    )

    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.3, 5)
    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.25, 5)
  })

  it('scales a shape freely when the clip itself has the aspect unlocked', async () => {
    const shape = addShape()
    store().updateClipTransform(shape.id, { scaleLocked: false })

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540 + SHAPE.halfH],
      [960 + SHAPE.halfW + 192, 540 + SHAPE.halfH + 54],
    ])

    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.3, 5)
    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.25, 5)
  })

  it('recentres a shape dragged by its north-west corner', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960 - SHAPE.halfW, 540 - SHAPE.halfH],
      [960 - SHAPE.halfW - 192, 540 - SHAPE.halfH - 108],
    ])

    // The far edges stay put, so the centre moves by half the growth.
    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.45, 5)
    expect(clipOf(shape.id).shapeData!.y).toBeCloseTo(0.45, 5)
  })

  it('never shrinks a shape below the minimum size', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540 + SHAPE.halfH],
      [0, 0],
    ])

    expect(clipOf(shape.id).shapeData!.width).toBe(0.02)
    expect(clipOf(shape.id).shapeData!.height).toBe(0.02)
  })

  it('scales text by the larger of the two corner ratios', async () => {
    const text = addText()

    const preview = await renderPreview()
    await drag(preview, [
      [960 + TEXT.halfW, 540 + TEXT.halfH],
      [960 + TEXT.halfW + 100, 540 + TEXT.halfH],
    ])

    // The text is 100 canvas px wide, so +100 doubles it.
    expect(clipOf(text.id).textData!.scale).toBeCloseTo(2, 5)
  })

  it('scales a media clip uniformly from a corner', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [1920, 1080],
      [1920 + 192, 1080 + 108],
    ])

    expect(clipOf('clip1').transform.scaleX).toBeCloseTo(1.1, 5)
    expect(clipOf('clip1').transform.scaleY).toBeCloseTo(1.1, 5)
  })

  it('scales a media clip freely from a corner with shift held', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(
      preview,
      [
        [1920, 1080],
        [1920 + 192, 1080 + 54],
      ],
      { shiftKey: true }
    )

    expect(clipOf('clip1').transform.scaleX).toBeCloseTo(1.1, 5)
    expect(clipOf('clip1').transform.scaleY).toBeCloseTo(1.05, 5)
  })
})

describe('PreviewPlayer edge resize drags', () => {
  it('widens a shape from its east edge without moving the centre', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540],
      [960 + SHAPE.halfW + 192, 540],
    ])

    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.3, 5)
    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.2, 5)
    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.5, 5)
  })

  it('widens a shape from its west edge and shifts the centre half way', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960 - SHAPE.halfW, 540],
      [960 - SHAPE.halfW - 96, 540],
    ])

    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.25, 5)
    expect(clipOf(shape.id).shapeData!.x).toBeCloseTo(0.475, 5)
  })

  it('grows a shape from its south edge', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 + SHAPE.halfH],
      [960, 540 + SHAPE.halfH + 108],
    ])

    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.3, 5)
    expect(clipOf(shape.id).shapeData!.y).toBeCloseTo(0.5, 5)
  })

  it('grows a shape from its north edge and shifts the centre half way', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH],
      [960, 540 - SHAPE.halfH - 54],
    ])

    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.25, 5)
    expect(clipOf(shape.id).shapeData!.y).toBeCloseTo(0.475, 5)
  })

  it('scales text from a side handle by that side ratio alone', async () => {
    const text = addText()

    const preview = await renderPreview()
    await drag(preview, [
      [960 + TEXT.halfW, 540],
      [960 + TEXT.halfW + 100, 540],
    ])

    expect(clipOf(text.id).textData!.scale).toBeCloseTo(2, 5)
  })

  it('scales text from the bottom handle by the height ratio', async () => {
    const text = addText()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 + TEXT.halfH],
      [960, 540 + TEXT.halfH + 57.6],
    ])

    // The text is 57.6 canvas px tall, so +57.6 doubles it.
    expect(clipOf(text.id).textData!.scale).toBeCloseTo(2, 5)
  })

  it('leaves the width alone when a north-edge drag wanders sideways', async () => {
    const shape = addShape()

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH],
      [960 + 192, 540 - SHAPE.halfH - 54],
    ])

    expect(clipOf(shape.id).shapeData!.height).toBeCloseTo(0.25, 5)
    expect(clipOf(shape.id).shapeData!.width).toBeCloseTo(0.2, 5)
  })

  it('leaves the other axis alone when an east-edge drag wanders down', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [1920, 540],
      [1920 + 192, 540 + 108],
    ])

    expect(clipOf('clip1').transform.scaleX).toBeCloseTo(1.1, 5)
    expect(clipOf('clip1').transform.scaleY).toBe(1)
  })

  it('scales only one axis of a media clip from a side handle', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [1920, 540],
      [1920 + 192, 540],
    ])

    expect(clipOf('clip1').transform.scaleX).toBeCloseTo(1.1, 5)
    expect(clipOf('clip1').transform.scaleY).toBe(1)
  })

  it('scales the other axis of a media clip from the bottom handle', async () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')

    const preview = await renderPreview()
    await drag(preview, [
      [960, 1080],
      [960, 1080 + 108],
    ])

    expect(clipOf('clip1').transform.scaleX).toBe(1)
    expect(clipOf('clip1').transform.scaleY).toBeCloseTo(1.1, 5)
  })
})

describe('PreviewPlayer keyframe-mode drags', () => {
  const inKeyframeMode = (clip: Clip) => {
    store().setSelectedClipId(clip.id)
    store().setKeyframePanelOpen(true)
  }

  it('writes x and y keyframes at the playhead instead of moving the shape', async () => {
    const shape = addShape()
    inKeyframeMode(shape)
    store().setCurrentTime(1)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1152, 648],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    // The store anchors a new track at time 0 with the value it had before.
    expect(keyframes.x).toEqual([
      { time: 0, value: 0.5, easing: 'ease-out' },
      { time: 1, value: expect.closeTo(0.6, 5), easing: 'ease-in-out' },
    ])
    expect(last(keyframes.y!)).toEqual({
      time: 1,
      value: expect.closeTo(0.6, 5),
      easing: 'ease-in-out',
    })
    // The overlay's own position is left exactly as it was.
    expect(clipOf(shape.id).shapeData!.x).toBe(0.5)
  })

  it('writes a rotation keyframe instead of rotating the shape', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH - 25],
      [1500, 540],
    ])

    const [keyframe] = clipOf(shape.id).animation!.keyframes!.rotation!
    expect(keyframe.value).toBeCloseTo(90, 5)
    expect(clipOf(shape.id).shapeData!.rotation).toBe(0)
  })

  it('writes uniform scale keyframes from a locked corner', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540 + SHAPE.halfH],
      [960 + SHAPE.halfW + 192, 540 + SHAPE.halfH + 54],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(keyframes.scaleX![0].value).toBeCloseTo(1.5, 5)
    expect(keyframes.scaleY![0].value).toBeCloseTo(1.5, 5)
    expect(clipOf(shape.id).shapeData!.width).toBe(0.2)
  })

  it('writes independent scale keyframes when shift unlocks the corner', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(
      preview,
      [
        [960 + SHAPE.halfW, 540 + SHAPE.halfH],
        [960 + SHAPE.halfW + 192, 540 + SHAPE.halfH + 54],
      ],
      { shiftKey: true }
    )

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(keyframes.scaleX![0].value).toBeCloseTo(1.5, 5)
    expect(keyframes.scaleY![0].value).toBeCloseTo(1.25, 5)
  })

  it('writes only the dragged axis from a side handle', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540],
      [960 + SHAPE.halfW + 192, 540 + 108],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(last(keyframes.scaleX!).value).toBeCloseTo(1.5, 5)
    expect(keyframes.scaleY).toBeUndefined()
  })

  it('writes the vertical axis from the bottom handle', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 + SHAPE.halfH],
      [960 + 192, 540 + SHAPE.halfH + 108],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(last(keyframes.scaleY!).value).toBeCloseTo(1.5, 5)
    expect(keyframes.scaleX).toBeUndefined()
  })

  it('writes a scale keyframe from the west edge and moves the centre with it', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960 - SHAPE.halfW, 540],
      [960 - SHAPE.halfW - 192, 540],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(last(keyframes.scaleX!).value).toBeCloseTo(1.5, 5)
    expect(last(keyframes.x!).value).toBeCloseTo(0.45, 5)
  })

  it('writes a scale keyframe from the north edge', async () => {
    const shape = addShape()
    inKeyframeMode(shape)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH],
      [960, 540 - SHAPE.halfH - 108],
    ])

    const keyframes = clipOf(shape.id).animation!.keyframes!
    expect(last(keyframes.scaleY!).value).toBeCloseTo(1.5, 5)
    expect(last(keyframes.y!).value).toBeCloseTo(0.45, 5)
  })

  it('writes a rotation keyframe from the grip of a keyframed clip', async () => {
    const shape = addShape()
    inKeyframeMode(shape)
    store().setClipKeyframe(shape.id, 'rotation', { time: 0, value: 0, easing: 'linear' })

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540 - SHAPE.halfH - 25],
      [1500, 540],
    ])

    expect(last(clipOf(shape.id).animation!.keyframes!.rotation!).value).toBeCloseTo(90, 5)
  })

  it('keyframes a media clip from its animated scale', async () => {
    addClip('clip1', 0, 4)
    store().updateClipTransform('clip1', { scaleX: 0.5, scaleY: 0.5 })
    inKeyframeMode(clipOf('clip1'))

    const preview = await renderPreview()
    // Half-scale bounds are 960x540 around the centre.
    await drag(preview, [
      [960 + 480, 540 + 270],
      [960 + 480 + 96, 540 + 270 + 54],
    ])

    const keyframes = clipOf('clip1').animation!.keyframes!
    expect(keyframes.scaleX![0].value).toBeCloseTo(0.55, 5)
    expect(clipOf('clip1').transform.scaleX).toBe(0.5)
  })

  it('keyframes a text overlay from its measured size', async () => {
    const text = addText()
    inKeyframeMode(text)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1152, 540],
    ])

    const keyframes = clipOf(text.id).animation!.keyframes!
    expect(keyframes.x![0].value).toBeCloseTo(0.6, 5)
    expect(clipOf(text.id).textData!.x).toBe(0.5)
  })

  it('follows the animated position when the drag starts mid-tween', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.25, easing: 'linear' })
    store().setClipKeyframe(shape.id, 'x', { time: 4, value: 0.75, easing: 'linear' })
    inKeyframeMode(shape)
    store().setCurrentTime(2)

    const preview = await renderPreview()
    await drag(preview, [
      [960, 540],
      [1152, 540],
    ])

    const written = clipOf(shape.id).animation!.keyframes!.x!.find((k) => k.time === 2)!
    expect(written.value).toBeCloseTo(0.6, 5)
  })
})
