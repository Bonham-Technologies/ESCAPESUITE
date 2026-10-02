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
  getClipOpacity,
  getClipType,
  getOverlayBounds,
  hasCustomKeyframes,
  isManipulableClip,
  projectSizeOf,
  toLocalPoint,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
} from './previewGeometry'
import {
  makeAnimation,
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
  makeTransitionInfo,
} from '../../test/fixtures/clipFixtures'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { TransitionInfo } from '../../core/exportTypes'
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

  it('rotates the alignment offset with the box, so the chrome sits on a rotated run (ESCSUITE-128)', () => {
    // Left-aligned text is anchored at its left edge, so the box's unrotated
    // centre sits textWidth/2 to the *right* of the anchor. The renderer
    // rotates about the anchor, so a box rotated about its own centre by the
    // same angle lands somewhere else entirely unless the offset itself is
    // rotated first. At 90 degrees the offset that was purely horizontal
    // becomes purely vertical: the centre keeps the anchor's x and moves down
    // by half the measured width.
    const bounds = getOverlayBounds(
      textClip({}, { textAlign: 'left', rotation: 90 }),
      makeCanvas(),
      undefined,
      []
    )

    expect(bounds?.centerX).toBe(0.5 * CANVAS_W)
    expect(bounds?.centerY).toBe(0.5 * CANVAS_H + MEASURED_TEXT_WIDTH / 2)
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

  it('measures the cropped region, not the whole source (ESCSUITE-6)', () => {
    // The clip shows the right half of a 400x200 source: 200x200 at scale 1.
    // The centre does not move — a crop shrinks the picture in place — so the
    // box the chrome draws and the box the renderer fills are the same box.
    const clip = makeClip({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } })

    expect(getOverlayBounds(clip, makeCanvas(), undefined, [source])).toEqual({
      centerX: 0.5 * CANVAS_W,
      centerY: 0.5 * CANVAS_H,
      width: 200,
      height: 200,
      rotation: 0,
    })
  })

  it('scales the cropped region by the clip transform', () => {
    const clip = makeClip({
      crop: { left: 0.25, top: 0.25, right: 0.25, bottom: 0.25 },
      transform: { x: 0.5, y: 0.5, scaleX: 2, scaleY: 3, rotation: 0, opacity: 1 },
    })

    // The middle half of 400x200 is 200x100; doubled and tripled, 400x300.
    expect(getOverlayBounds(clip, makeCanvas(), undefined, [source])).toMatchObject({
      width: 400,
      height: 300,
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

describe('getClipOpacity', () => {
  it('reads the static transform.opacity when the clip has no animation', () => {
    const clip = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.4 },
    })

    expect(getClipOpacity(clip, 1)).toBe(0.4)
  })

  it('treats a missing transform as fully opaque, the same default getOverlayBounds falls back to', () => {
    expect(getClipOpacity(makeClip({ transform: undefined }), 1)).toBe(1)
  })

  it('interpolates opacity from keyframes at the given time', () => {
    // Opacity ramps 1 -> 0 over the 4s clip; at time 1 (a quarter through) it
    // is a quarter of the way there: 0.75.
    const clip = makeClip({
      duration: 4,
      animation: makeAnimation({ keyframes: { opacity: [kf(0, 1), kf(4, 0)] } }),
    })

    expect(getClipOpacity(clip, 1)).toBe(0.75)
  })

  it('interpolates over the default transform and effects when a keyframed clip carries neither', () => {
    // The same `|| DEFAULT_*` fallbacks getOverlayBounds makes, on the animated
    // path this time: a clip restored without a transform or effects block
    // still evaluates its keyframes over the defaults (opacity 1) rather than
    // throwing on `undefined.opacity`.
    const clip = makeClip({
      duration: 4,
      transform: undefined,
      effects: undefined,
      animation: makeAnimation({ keyframes: { opacity: [kf(0, 1), kf(4, 0)] } }),
    })

    expect(getClipOpacity(clip, 1)).toBe(0.75)
  })
})

describe('getOverlayBounds during a transition (ESCSUITE-147)', () => {
  const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })

  /**
   * A clip whose last second slides out to the left, and a clip on the track
   * above whose first second slides in from the right. The transition window is
   * the outgoing clip's last second, and at 3.5s both presets are exactly
   * halfway: the outgoing clip's own x reads 0.25 and the incoming clip's 0.75,
   * while the renderer — which suppresses the side the transition owns — draws
   * both at the base 0.5.
   */
  const outgoing = makeClip({
    id: 'out1',
    duration: 4,
    animation: makeAnimation({ out: { type: 'slide-left', duration: 1, easing: 'linear' } }),
  })
  const incoming = makeClip({
    id: 'in1',
    trackId: 'track2',
    duration: 4,
    timelinePosition: 3,
    animation: makeAnimation({ in: { type: 'slide-left', duration: 1, easing: 'linear' } }),
  })
  const transition = makeTransitionInfo({ outgoingClip: outgoing, incomingClip: incoming })

  /** The clip's box at 3.5s, with the canvas as its own project. */
  const centerXAt = (
    clip: Clip,
    options?: { transition?: TransitionInfo | null }
  ): number | undefined => {
    const canvas = makeCanvas()
    return getOverlayBounds(clip, canvas, 3.5, [source], canvas, options)?.centerX
  }

  it('reports the outgoing clip where the picture is, not where its out-preset would put it', () => {
    expect(centerXAt(outgoing, { transition })).toBe(0.5 * CANVAS_W)
  })

  it('reports the incoming clip where the picture is, not where its in-preset would put it', () => {
    expect(centerXAt(incoming, { transition })).toBe(0.5 * CANVAS_W)
  })

  it('applies both presets when no transition is handed over', () => {
    expect(centerXAt(outgoing)).toBe(0.25 * CANVAS_W)
    expect(centerXAt(incoming)).toBe(0.75 * CANVAS_W)
  })

  it('reads a null transition as no transition at all', () => {
    expect(centerXAt(outgoing, { transition: null })).toBe(0.25 * CANVAS_W)
  })

  it('leaves an overlay’s own preset alone, because the renderer never suppresses it', () => {
    // `drawFrame.ts` draws an overlay through `drawOverlayClip`, before the
    // transition skip and with no modifiers, so a text or shape overlay that
    // carries a transition keeps its out-preset whatever the transition says.
    // The box has to say the same, or it is wrong in the one configuration it
    // used to be right about.
    const overlay = shapeClip({
      id: 'overlay1',
      duration: 4,
      animation: makeAnimation({ out: { type: 'slide-left', duration: 1, easing: 'linear' } }),
    })
    const overlayTransition = makeTransitionInfo({ outgoingClip: overlay, incomingClip: incoming })

    expect(centerXAt(overlay, { transition: overlayTransition })).toBe(0.25 * CANVAS_W)
  })

  it('leaves a clip the transition does not name alone', () => {
    // A third clip with the same out-preset, running at the same time on a
    // track of its own: the transition owns neither of its sides.
    expect(centerXAt(makeClip({ ...outgoing, id: 'other' }), { transition })).toBe(0.25 * CANVAS_W)
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
    // space is 100px *above* the centre in the box's own frame (negative y).
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

    expect(getCanvasPosition(canvas, { clientX: 480, clientY: 270 }))
      .toEqual({ x: 0.5, y: 0.5, scale: 0.5 })
  })

  it('subtracts the element’s own offset', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 100, top: 50, width: 960, height: 540 })

    expect(getCanvasPosition(canvas, { clientX: 100, clientY: 50 }))
      .toEqual({ x: 0, y: 0, scale: 0.5 })
  })

  it('skips the top and bottom bars when the canvas is wider than its box', () => {
    // 16:9 content in a square box: 800 wide, 450 tall, 175px of bar each side.
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: 800, height: 800 })

    const scale = 800 / CANVAS_W
    expect(getCanvasPosition(canvas, { clientX: 400, clientY: 175 }))
      .toEqual({ x: 0.5, y: 0, scale })
    expect(getCanvasPosition(canvas, { clientX: 400, clientY: 625 }))
      .toEqual({ x: 0.5, y: 1, scale })
  })

  it('skips the left and right bars when the canvas is taller than its box', () => {
    // 9:16 content in a square box: 450 wide, 800 tall, 175px of bar each side.
    const canvas = makeCanvas({ width: CANVAS_H, height: CANVAS_W })
    setRect(canvas, { left: 0, top: 0, width: 800, height: 800 })

    const scale = 450 / CANVAS_H
    expect(getCanvasPosition(canvas, { clientX: 175, clientY: 400 }))
      .toEqual({ x: 0, y: 0.5, scale })
    expect(getCanvasPosition(canvas, { clientX: 625, clientY: 400 }))
      .toEqual({ x: 1, y: 0.5, scale })
  })

  // ESCSUITE-90: the pointer handlers need the scale as well as the point — the
  // selection chrome is drawn at a constant size on screen, so its hit zones are
  // sized by it — and reading the element's rect twice per pointer move would be
  // a second forced layout for a number this call already has.
  it('carries the CSS-pixels-per-project-pixel scale out with the point', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: CANVAS_W / 4, height: CANVAS_H / 4 })

    expect(getCanvasPosition(canvas, { clientX: 0, clientY: 0 }).scale).toBe(0.25)
    expect(getCanvasPosition(canvas, { clientX: 0, clientY: 0 }, { width: 3840, height: 2160 })
      .scale).toBe(0.125)
  })

  it('does not clamp, so a drag can run off the canvas', () => {
    const canvas = makeCanvas()
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })

    expect(getCanvasPosition(canvas, { clientX: -480, clientY: 810 }))
      .toEqual({ x: -0.5, y: 1.5, scale: 0.5 })
  })
})

describe('projectSizeOf', () => {
  it('is the project resolution', () => {
    expect(projectSizeOf({ width: 3840, height: 2160 })).toEqual({ width: 3840, height: 2160 })
  })

  it('falls back to the default project size when there is no resolution', () => {
    // Never to the canvas: since the preview rasterises at its displayed size,
    // the canvas' backing store is not the project's pixel grid.
    const fallback = { width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT }

    expect(projectSizeOf(undefined)).toEqual(fallback)
    expect(projectSizeOf(null)).toEqual(fallback)
  })

  it('falls back per axis for a resolution with a missing or zero side', () => {
    expect(projectSizeOf({ width: 0, height: 720 })).toEqual({
      width: DEFAULT_PROJECT_WIDTH,
      height: 720,
    })
    expect(projectSizeOf({ width: 1280 })).toEqual({
      width: 1280,
      height: DEFAULT_PROJECT_HEIGHT,
    })
  })
})
