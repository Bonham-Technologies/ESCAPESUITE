// The preview's geometry on its own: no component, no store, no render loop.
//
// These are the same numbers PreviewPlayer draws and hit-tests with, so the
// expectations here are written out of the inputs — a shape's normalized size
// times the canvas, a text run's measured width times its scale — rather than
// copied off a run.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  contentBox,
  getCanvasPosition,
  getClipType,
  getOverlayBounds,
  hasCustomKeyframes,
  isManipulableClip,
  toLocalPoint,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry'
import {
  makeAnimation,
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
} from '../../test/fixtures/exportPipeline'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { Clip, Keyframe, SourceVideo } from '../../store/types'

/** The project's default resolution, and the canvas every case below draws to. */
const CANVAS_W = 1920
const CANVAS_H = 1080

/** The canvas double reports every string as this wide from measureText(). */
const MEASURED_TEXT_WIDTH = 100

beforeEach(() => {
  installCanvasDouble()
})

afterEach(() => {
  uninstallCanvasDouble()
})

/**
 * A canvas of the given size. `withContext: false` leaves getContext() uncalled
 * so a test can arm failNextGetContext() against it.
 */
function makeCanvas({
  width = CANVAS_W,
  height = CANVAS_H,
  withContext = true,
}: { width?: number; height?: number; withContext?: boolean } = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (withContext) canvas.getContext('2d')
  return canvas
}

const kf = (time: number, value: number): Keyframe => ({ time, value, easing: 'linear' })

const textClip = (overrides: Partial<Clip> = {}, data = {}): Clip =>
  makeClip({
    id: 'text1',
    sourceVideoId: '',
    overlayType: 'text',
    textData: makeTextData(data),
    ...overrides,
  })

const shapeClip = (overrides: Partial<Clip> = {}, data = {}): Clip =>
  makeClip({
    id: 'shape1',
    sourceVideoId: '',
    overlayType: 'shape',
    shapeData: makeShapeData(data),
    ...overrides,
  })

describe('handle constants', () => {
  it('are the sizes the drawing and hit-testing both work from', () => {
    expect(HANDLE_SIZE).toBe(8)
    expect(ROTATION_HANDLE_OFFSET).toBe(25)
  })
})

describe('getOverlayBounds for shape overlays', () => {
  it('scales the shape’s normalized box up to canvas pixels', () => {
    // The default shape sits at (0.5, 0.5) and measures 0.25 x 0.5 of the canvas.
    const bounds = getOverlayBounds(shapeClip(), makeCanvas(), undefined, [])

    expect(bounds).toEqual({
      centerX: 0.5 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: 0.25 * CANVAS_W,
      height: 0.5 * CANVAS_H,
      rotation: 0,
    })
  })

  it('carries the shape’s own rotation through', () => {
    const bounds = getOverlayBounds(shapeClip({}, { rotation: 30 }), makeCanvas(), undefined, [])

    expect(bounds?.rotation).toBe(30)
  })

  it('takes position, scale and rotation from keyframes at the given time', () => {
    const clip = shapeClip({
      duration: 4,
      animation: makeAnimation({
        keyframes: {
          x: [kf(0, 0.25)],
          y: [kf(0, 0.75)],
          scaleX: [kf(0, 2)],
          scaleY: [kf(0, 0.5)],
          rotation: [kf(0, 0), kf(4, 90)],
        },
      }),
    })

    // Halfway through a 4s clip, the linear rotation ramp is at 45 degrees.
    const bounds = getOverlayBounds(clip, makeCanvas(), 2, [])

    expect(bounds).toEqual({
      centerX: 0.25 * CANVAS_W,
      centerY: 0.75 * CANVAS_H,
      width: 0.25 * CANVAS_W * 2,
      height: 0.5 * CANVAS_H * 0.5,
      rotation: 45,
    })
  })

  it('ignores keyframes for a time outside the clip', () => {
    const clip = shapeClip({
      duration: 4,
      animation: makeAnimation({ keyframes: { x: [kf(0, 0.25)] } }),
    })

    // 10s is past the clip's end, so the static shape data stands.
    expect(getOverlayBounds(clip, makeCanvas(), 10, [])?.centerX).toBe(0.5 * CANVAS_W)
  })

  it('ignores the time when the clip has no animation at all', () => {
    expect(getOverlayBounds(shapeClip(), makeCanvas(), 1, [])?.centerX).toBe(0.5 * CANVAS_W)
  })
})

describe('getOverlayBounds for text overlays', () => {
  it('measures the text and uses a 1.2 line height', () => {
    // One line of a 40px font: 100px wide as the double measures it, 48px tall.
    const bounds = getOverlayBounds(textClip(), makeCanvas(), undefined, [])

    expect(bounds).toEqual({
      centerX: 0.5 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: MEASURED_TEXT_WIDTH,
      height: 40 * 1.2,
      rotation: 0,
    })
  })

  it('grows the box by one line height per line', () => {
    const bounds = getOverlayBounds(
      textClip({}, { text: 'one\ntwo\nthree' }),
      makeCanvas(),
      undefined,
      []
    )

    expect(bounds?.height).toBe(3 * 40 * 1.2)
  })

  it('multiplies both dimensions by the text scale', () => {
    const bounds = getOverlayBounds(textClip({}, { scale: 2 }), makeCanvas(), undefined, [])

    expect(bounds?.width).toBe(MEASURED_TEXT_WIDTH * 2)
    expect(bounds?.height).toBe(40 * 1.2 * 2)
  })

  it('shifts the centre by half the run for left- and right-aligned text', () => {
    const left = getOverlayBounds(textClip({}, { textAlign: 'left' }), makeCanvas(), undefined, [])
    const right = getOverlayBounds(textClip({}, { textAlign: 'right' }), makeCanvas(), undefined, [])

    expect(left?.centerX).toBe(0.5 * CANVAS_W + MEASURED_TEXT_WIDTH / 2)
    expect(right?.centerX).toBe(0.5 * CANVAS_W - MEASURED_TEXT_WIDTH / 2)
  })

  it('applies the font style and weight before measuring', () => {
    const canvas = makeCanvas()

    getOverlayBounds(
      textClip({}, { fontStyle: 'italic', fontWeight: 'bold', fontFamily: 'Georgia' }),
      canvas,
      undefined,
      []
    )

    expect(getCanvasContext(canvas)?.stateFor('measureText')[0].font).toBe(
      'italic bold 40px Georgia'
    )
  })

  it('leaves the context’s font as it found it', () => {
    // The context belongs to the preview, which draws through it on the very
    // next frame: a measurement must not leave its own font behind.
    const canvas = makeCanvas()
    const ctx = getCanvasContext(canvas)!
    ctx.font = '12px Courier'

    getOverlayBounds(textClip({}, { fontSize: 40, fontFamily: 'Georgia' }), canvas, undefined, [])

    expect(ctx.font).toBe('12px Courier')
  })

  it('uses the text’s own rotation when there is no animation', () => {
    expect(
      getOverlayBounds(textClip({}, { rotation: 15 }), makeCanvas(), undefined, [])?.rotation
    ).toBe(15)
  })

  it('animates from a base transform built out of the text data', () => {
    // The text sits at x 0.2 with scale 3; only rotation is keyframed, so the
    // other three have to come through the base transform untouched.
    const clip = textClip(
      {
        duration: 2,
        animation: makeAnimation({ keyframes: { rotation: [kf(0, 90)] } }),
      },
      { x: 0.2, scale: 3 }
    )

    const bounds = getOverlayBounds(clip, makeCanvas(), 1, [])

    expect(bounds).toEqual({
      centerX: 0.2 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: MEASURED_TEXT_WIDTH * 3,
      height: 40 * 1.2 * 3,
      rotation: 90,
    })
  })

  it('scales by the larger of the two animated axes', () => {
    const clip = textClip({
      duration: 2,
      animation: makeAnimation({ keyframes: { scaleX: [kf(0, 4)], scaleY: [kf(0, 2)] } }),
    })

    expect(getOverlayBounds(clip, makeCanvas(), 1, [])?.width).toBe(MEASURED_TEXT_WIDTH * 4)
  })

  it('gives up when the canvas has no 2D context to measure with', () => {
    const canvas = makeCanvas({ withContext: false })
    failNextGetContext()

    expect(getOverlayBounds(textClip(), canvas, undefined, [])).toBeNull()
  })
})

describe('getOverlayBounds for media clips', () => {
  const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })

  it('measures a media clip in native source pixels times its scale', () => {
    const clip = makeClip({
      transform: { x: 0.25, y: 0.75, scaleX: 2, scaleY: 0.5, rotation: 10, opacity: 1 },
    })

    expect(getOverlayBounds(clip, makeCanvas(), undefined, [source])).toEqual({
      centerX: 0.25 * CANVAS_W,
      centerY: 0.75 * CANVAS_H,
      width: 400 * 2,
      height: 200 * 0.5,
      rotation: 10,
    })
  })

  it('falls back to the default transform when the clip has none', () => {
    const clip = makeClip({ transform: undefined })

    expect(getOverlayBounds(clip, makeCanvas(), undefined, [source])).toEqual({
      centerX: 0.5 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: 400,
      height: 200,
      rotation: 0,
    })
  })

  it('animates position, scale and rotation off the clip transform', () => {
    const clip = makeClip({
      duration: 4,
      animation: makeAnimation({
        keyframes: { x: [kf(0, 0), kf(4, 1)], scaleX: [kf(0, 3)], rotation: [kf(0, 45)] },
      }),
    })

    const bounds = getOverlayBounds(clip, makeCanvas(), 1, [source])

    expect(bounds).toEqual({
      centerX: 0.25 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: 400 * 3,
      height: 200,
      rotation: 45,
    })
  })

  it('gives up when the clip’s source media is not loaded', () => {
    expect(getOverlayBounds(makeClip(), makeCanvas(), undefined, [])).toBeNull()
  })

  it('gives up on a clip that is neither an overlay nor media', () => {
    expect(getOverlayBounds(makeClip({ sourceVideoId: '' }), makeCanvas(), undefined, [])).toBeNull()
  })

  it('gives up on an overlay clip whose overlay data is missing', () => {
    const clip = makeClip({ sourceVideoId: '', overlayType: 'text', textData: undefined })

    expect(getOverlayBounds(clip, makeCanvas(), undefined, [])).toBeNull()
  })
})

describe('isManipulableClip', () => {
  it('treats every overlay as manipulable', () => {
    expect(isManipulableClip(textClip(), [])).toBe(true)
    expect(isManipulableClip(shapeClip(), [])).toBe(true)
  })

  it('treats video and image clips as manipulable', () => {
    const video = makeSourceVideo()
    const image = makeSourceVideo({ id: 'image1', mediaType: 'image' })

    expect(isManipulableClip(makeClip(), [video])).toBe(true)
    expect(isManipulableClip(makeClip({ sourceVideoId: 'image1' }), [image])).toBe(true)
  })

  it('leaves audio clips alone', () => {
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })

    expect(isManipulableClip(makeClip({ sourceVideoId: 'audio1' }), [audio])).toBe(false)
  })

  it('leaves a clip whose source is not loaded alone', () => {
    // Nothing is known about the media — not its size, not even whether it
    // draws at all — so there is nothing to put handles on. It used to be
    // manipulable by accident: an absent source has no mediaType, and no
    // mediaType is not 'audio'.
    expect(isManipulableClip(makeClip(), [])).toBe(false)
  })

  it('rejects a clip with neither an overlay nor a source', () => {
    expect(isManipulableClip(makeClip({ sourceVideoId: '' }), [])).toBe(false)
  })
})

describe('getClipType', () => {
  it('names each kind of clip', () => {
    const video = makeSourceVideo()
    const image = makeSourceVideo({ id: 'image1', mediaType: 'image' })
    const audio = makeSourceVideo({ id: 'audio1', mediaType: 'audio' })
    const sources = [video, image, audio]

    expect(getClipType(textClip(), sources)).toBe('text')
    expect(getClipType(shapeClip(), sources)).toBe('shape')
    expect(getClipType(makeClip(), sources)).toBe('video')
    expect(getClipType(makeClip({ sourceVideoId: 'image1' }), sources)).toBe('image')
    expect(getClipType(makeClip({ sourceVideoId: 'audio1' }), sources)).toBeNull()
    expect(getClipType(makeClip({ sourceVideoId: '' }), sources)).toBeNull()
  })

  it('names no type for a source that is not loaded', () => {
    expect(getClipType(makeClip(), [])).toBeNull()
  })
})

describe('hasCustomKeyframes', () => {
  it('is false without an animation, and without keyframes in one', () => {
    expect(hasCustomKeyframes(makeClip())).toBe(false)
    expect(hasCustomKeyframes(makeClip({ animation: makeAnimation() }))).toBe(false)
  })

  it('is false for an empty keyframe list', () => {
    expect(hasCustomKeyframes(makeClip({ animation: makeAnimation({ keyframes: { x: [] } }) }))).toBe(
      false
    )
  })

  it('is true once any animatable property carries a keyframe', () => {
    for (const prop of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur'] as const) {
      const clip = makeClip({ animation: makeAnimation({ keyframes: { [prop]: [kf(0, 1)] } }) })

      expect(hasCustomKeyframes(clip)).toBe(true)
    }
  })

  it('ignores volume keyframes, which are not a transform', () => {
    const clip = makeClip({ animation: makeAnimation({ keyframes: { volume: [kf(0, 0.5)] } }) })

    expect(hasCustomKeyframes(clip)).toBe(false)
  })
})

describe('toLocalPoint', () => {
  /** A 200x100 box centred on the canvas, rotated by the given angle. */
  const box = (rotation: number) => ({
    centerX: 960,
    centerY: 540,
    width: 200,
    height: 100,
    rotation,
  })

  it('is an offset from the centre when the box is unrotated', () => {
    expect(toLocalPoint(box(0), 1060, 590)).toEqual({ x: 100, y: 50 })
  })

  it('reports the centre as the origin whatever the rotation', () => {
    expect(toLocalPoint(box(37), 960, 540)).toEqual({ x: 0, y: 0 })
  })

  it('rotates the point backwards for a quarter turn', () => {
    // The box turned 90° clockwise, so a point 100px to its right in screen
    // space is 100px *below* the centre in the box's own frame.
    const local = toLocalPoint(box(90), 1060, 540)

    expect(local.x).toBeCloseTo(0, 10)
    expect(local.y).toBeCloseTo(-100, 10)
  })

  it('rotates the point backwards for an arbitrary angle', () => {
    // 30°: undoing it maps (dx, dy) = (100, 0) to (cos30 * 100, -sin30 * 100).
    const local = toLocalPoint(box(30), 1060, 540)

    expect(local.x).toBeCloseTo(Math.cos(Math.PI / 6) * 100, 10)
    expect(local.y).toBeCloseTo(-Math.sin(Math.PI / 6) * 100, 10)
  })
})

describe('contentBox', () => {
  it('fills the element when the aspect ratios match', () => {
    // 960x540 is exactly half of 1920x1080, so there is no bar on either axis.
    const canvas = makeCanvas()

    expect(contentBox(canvas, { width: 960, height: 540 })).toEqual({
      width: 960,
      height: 540,
      offsetX: 0,
      offsetY: 0,
      scaleX: 0.5,
      scaleY: 0.5,
    })
  })

  it('letterboxes top and bottom when the canvas is wider than its box', () => {
    // 16:9 content in a square box: 800 wide, 450 tall, 175px of bar each side.
    const canvas = makeCanvas()

    expect(contentBox(canvas, { width: 800, height: 800 })).toEqual({
      width: 800,
      height: 450,
      offsetX: 0,
      offsetY: 175,
      scaleX: 800 / 1920,
      scaleY: 450 / 1080,
    })
  })

  it('letterboxes left and right when the canvas is taller than its box', () => {
    // 9:16 content in a square box: 450 wide, 800 tall, 175px of bar each side.
    const canvas = makeCanvas({ width: CANVAS_H, height: CANVAS_W })

    expect(contentBox(canvas, { width: 800, height: 800 })).toEqual({
      width: 450,
      height: 800,
      offsetX: 175,
      offsetY: 0,
      scaleX: 450 / 1080,
      scaleY: 800 / 1920,
    })
  })

  it('measures the element itself when no box is given', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 100, top: 50, width: 800, height: 800 })

    expect(contentBox(canvas)).toEqual({
      width: 800,
      height: 450,
      offsetX: 0,
      offsetY: 175,
      scaleX: 800 / 1920,
      scaleY: 450 / 1080,
    })
  })
})

describe('getCanvasPosition', () => {
  it('normalizes against the element box when nothing is letterboxed', () => {
    // 960x540 is exactly half of 1920x1080, so the content fills the element.
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })

    expect(getCanvasPosition(canvas, { clientX: 480, clientY: 270 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('subtracts the element’s own offset', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 100, top: 50, width: 960, height: 540 })

    expect(getCanvasPosition(canvas, { clientX: 100, clientY: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('skips the top and bottom bars when the canvas is wider than its box', () => {
    // 16:9 content in a square box: 800 wide, 450 tall, 175px of bar each side.
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: 800, height: 800 })

    expect(getCanvasPosition(canvas, { clientX: 400, clientY: 175 })).toEqual({ x: 0.5, y: 0 })
    expect(getCanvasPosition(canvas, { clientX: 400, clientY: 625 })).toEqual({ x: 0.5, y: 1 })
  })

  it('skips the left and right bars when the canvas is taller than its box', () => {
    // 9:16 content in a square box: 450 wide, 800 tall, 175px of bar each side.
    const canvas = makeCanvas({ width: CANVAS_H, height: CANVAS_W })
    setRect(canvas, { left: 0, top: 0, width: 800, height: 800 })

    expect(getCanvasPosition(canvas, { clientX: 175, clientY: 400 })).toEqual({ x: 0, y: 0.5 })
    expect(getCanvasPosition(canvas, { clientX: 625, clientY: 400 })).toEqual({ x: 1, y: 0.5 })
  })

  it('does not clamp, so a drag can run off the canvas', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })

    expect(getCanvasPosition(canvas, { clientX: -480, clientY: 810 })).toEqual({ x: -0.5, y: 1.5 })
  })
})
