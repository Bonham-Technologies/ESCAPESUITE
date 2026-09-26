// Clip compositing: the geometry, blend mode, alpha, blur and clip region a
// media clip is drawn with, and the source-selection rules the two dispatchers
// (`drawMediaWithModifiers`, `drawMediaWithFrame`) apply. The real animation
// engine computes the values; only the drawing surface and the media elements
// are doubles.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawMediaWithFrame,
  drawMediaWithModifiers,
} from './canvasRenderer'
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { VideoFrameDouble, resetFrameRegistry } from '../test/doubles/webcodecs'
import { makeClip } from '../test/fixtures/clipFixtures'
import type { Clip, ClipMask, ClipStroke } from '../store/types'
import type { DrawableMediaSource, MediaDrawOptions, TransitionModifiers } from './exportTypes'

const W = 1920
const H = 1080

let ctx: RecordingCanvasRenderingContext2D
let media: MediaDoubles

const asCtx = () => ctx as unknown as CanvasRenderingContext2D

beforeEach(() => {
  resetFrameRegistry()
  ctx = createRecordingContext()
  media = installMediaElementDoubles()
})

afterEach(() => {
  media.uninstall()
})

/** A <video> the double has already "loaded" at the given size. */
function loadedVideo(width: number, height: number, readyState = 4): HTMLVideoElement {
  media.script({ video: { videoWidth: width, videoHeight: height, readyState } })
  return document.createElement('video')
}

function loadedImage(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  media.script({ image: { naturalWidth, naturalHeight } })
  return document.createElement('img')
}

const frame = (displayWidth = 640, displayHeight = 360) =>
  new VideoFrameDouble({ displayWidth, displayHeight }) as unknown as DrawableMediaSource

describe('drawClipToCanvas', () => {
  const draw = (
    source: DrawableMediaSource,
    clip: Clip = makeClip(),
    clipTime = 0,
    modifiers?: TransitionModifiers
  ) => drawClipToCanvas(asCtx(), source, clip, clipTime, W, H, modifiers)

  it('draws the source at native pixel size, centred on the animated position', () => {
    draw(frame(640, 360))

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([640, 360, 640, 360])
    expect(ctx.calls[0].method).toBe('save')
    expect(ctx.calls[ctx.calls.length - 1].method).toBe('restore')
  })

  it('scales the native size by the clip transform', () => {
    const clip = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 2, scaleY: 0.5, rotation: 0, opacity: 1 },
    })

    draw(frame(640, 360), clip)

    // 1280 x 180 centred on (960, 540)
    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([320, 450, 1280, 180])
  })

  it('positions the clip from its normalised transform position', () => {
    const clip = makeClip({
      transform: { x: 0.25, y: 0.75, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    })

    draw(frame(640, 360), clip)

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([480 - 320, 810 - 180, 640, 360])
  })

  it('falls back to the canvas size for a source with no dimensions', () => {
    draw(frame(0, 0))

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([0, 0, W, H])
  })

  it('reads dimensions from a video element', () => {
    draw(loadedVideo(1280, 720))

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([320, 180, 1280, 720])
  })

  it('maps the clip blend mode onto the canvas composite operation', () => {
    draw(frame(), makeClip({ blendMode: 'add' }))

    expect(ctx.stateFor('drawImage')[0].globalCompositeOperation).toBe('lighter')
  })

  it('falls back to source-over for an unrecognised blend mode', () => {
    draw(frame(), makeClip({ blendMode: 'not-a-mode' as Clip['blendMode'] }))

    expect(ctx.stateFor('drawImage')[0].globalCompositeOperation).toBe('source-over')
  })

  it('multiplies the clip opacity by the transition opacity', () => {
    const clip = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 },
    })

    draw(frame(), clip, 0, { opacity: 0.4 })

    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBeCloseTo(0.2, 6)
  })

  it('uses the clip opacity alone when there is no transition', () => {
    const clip = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 },
    })

    draw(frame(), clip)

    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBe(0.5)
  })

  it('applies the clip blur effect as a filter', () => {
    draw(frame(), makeClip({ effects: { blur: 3 } }))

    expect(ctx.stateFor('drawImage')[0].filter).toBe('blur(3px)')
  })

  it('leaves the filter alone when there is no blur', () => {
    draw(frame())

    expect(ctx.stateFor('drawImage')[0].filter).toBe('none')
  })

  it('clips to the transition region before drawing', () => {
    draw(frame(), makeClip(), 0, { clipRegion: { x: 10, y: 20, width: 300, height: 400 } })

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'beginPath',
      'rect',
      'clip',
      'drawImage',
      'restore',
    ])
    expect(ctx.argsFor('rect')[0]).toEqual([10, 20, 300, 400])
  })

  it('rotates about the clip centre', () => {
    const clip = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
    })

    draw(frame(), clip)

    expect(ctx.argsFor('translate')).toEqual([[960, 540], [-960, -540]])
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('offsets the draw position by the transition offset', () => {
    draw(frame(640, 360), makeClip(), 0, { offsetX: -100, offsetY: 50 })

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([540, 410, 640, 360])
  })

  it('records exactly what it always has for a clip with neither mask nor stroke', () => {
    draw(frame(640, 360))

    // ESCSUITE-65's load-bearing pin. Not "a rect and a clip that happen to be
    // no-ops" — literally the three calls this function made before the mask
    // existed, which is what the per-frame ceilings in
    // `components/Preview/drawFrame.perf.test.ts` and `core/exportMP4.perf.test.ts`
    // rest on, and what a project saved before ESCSUITE-65 draws as.
    expect(ctx.calls.map((c) => c.method)).toEqual(['save', 'drawImage', 'restore'])
  })
})

describe('drawImageToCanvasWithModifiers', () => {
  const draw = (
    image: HTMLImageElement,
    clip: Clip = makeClip(),
    modifiers?: TransitionModifiers
  ) => drawImageToCanvasWithModifiers(asCtx(), image, clip, 0, W, H, modifiers)

  it('draws the image at its natural size, centred', () => {
    draw(loadedImage(800, 600))

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([560, 240, 800, 600])
  })

  it('falls back to the canvas size for an image with no natural size', () => {
    draw(loadedImage(0, 0))

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([0, 0, W, H])
  })

  it('applies blend mode, opacity, blur and rotation like a video clip', () => {
    const clip = makeClip({
      blendMode: 'screen',
      effects: { blur: 2 },
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 180, opacity: 0.5 },
    })

    draw(loadedImage(800, 600), clip, { opacity: 0.5 })

    const state = ctx.stateFor('drawImage')[0]
    expect(state.globalCompositeOperation).toBe('screen')
    expect(state.globalAlpha).toBeCloseTo(0.25, 6)
    expect(state.filter).toBe('blur(2px)')
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI]])
  })

  it('falls back to source-over for an unrecognised blend mode', () => {
    draw(loadedImage(800, 600), makeClip({ blendMode: 'bogus' as Clip['blendMode'] }))

    expect(ctx.stateFor('drawImage')[0].globalCompositeOperation).toBe('source-over')
  })

  it('clips to the transition region', () => {
    draw(loadedImage(800, 600), makeClip(), { clipRegion: { x: 0, y: 0, width: 960, height: H } })

    expect(ctx.argsFor('rect')[0]).toEqual([0, 0, 960, H])
    expect(ctx.argsFor('clip')).toHaveLength(1)
  })

  it('offsets the draw position by the transition offset', () => {
    draw(loadedImage(800, 600), makeClip(), { offsetX: 40, offsetY: -40 })

    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([600, 200, 800, 600])
  })

  it('records exactly what it always has for a clip with neither mask nor stroke', () => {
    draw(loadedImage(800, 600))

    expect(ctx.calls.map((c) => c.method)).toEqual(['save', 'drawImage', 'restore'])
  })
})

describe('drawMediaWithModifiers', () => {
  it('prefers a video whose first frame has arrived', () => {
    const video = loadedVideo(1280, 720, 1)
    const image = loadedImage(800, 600)
    const clip = makeClip()

    const drew = drawMediaWithModifiers(
      asCtx(),
      new Map([[clip.sourceVideoId, video]]),
      new Map([[clip.sourceVideoId, image]]),
      clip,
      0,
      W,
      H
    )

    expect(drew).toBe(true)
    expect(ctx.argsFor('drawImage')[0][0]).toBe(video)
  })

  it('falls back to the image when the video has no metadata yet', () => {
    const video = loadedVideo(1280, 720, 0)
    const image = loadedImage(800, 600)
    const clip = makeClip()

    const drew = drawMediaWithModifiers(
      asCtx(),
      new Map([[clip.sourceVideoId, video]]),
      new Map([[clip.sourceVideoId, image]]),
      clip,
      0,
      W,
      H
    )

    expect(drew).toBe(true)
    expect(ctx.argsFor('drawImage')[0][0]).toBe(image)
  })

  it('draws an image-only source', () => {
    const image = loadedImage(800, 600)
    const clip = makeClip()

    const drew = drawMediaWithModifiers(
      asCtx(),
      new Map(),
      new Map([[clip.sourceVideoId, image]]),
      clip,
      0,
      W,
      H
    )

    expect(drew).toBe(true)
    expect(ctx.argsFor('drawImage')[0][0]).toBe(image)
  })

  it('draws nothing and reports failure when the source is loaded in neither map', () => {
    const drew = drawMediaWithModifiers(asCtx(), new Map(), new Map(), makeClip(), 0, W, H)

    expect(drew).toBe(false)
    expect(ctx.calls).toEqual([])
  })
})

describe('MediaDrawOptions', () => {
  /** The same clip id and clip time, drawn twice with a transform change between. */
  const drawTwiceAcrossAnEdit = (options?: MediaDrawOptions) => {
    const before = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    })
    const after = makeClip({
      transform: { x: 0.5, y: 0.5, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 },
    })

    drawClipToCanvas(asCtx(), frame(640, 360), before, 0, W, H, undefined, options)
    drawClipToCanvas(asCtx(), frame(640, 360), after, 0, W, H, undefined, options)

    return ctx.argsFor('drawImage').map((args) => args[3])
  }

  it('recomputes the animated values on every draw', () => {
    // There is no memo cache: the same clip id and clip time, drawn again after
    // a transform edit, comes out at the new size.
    expect(drawTwiceAcrossAnEdit()).toEqual([640, 1280])
  })

  it('leaves an inherited filter alone by default', () => {
    ctx.filter = 'blur(3px)'
    drawClipToCanvas(asCtx(), frame(), makeClip(), 0, W, H)

    expect(ctx.stateFor('drawImage')[0].filter).toBe('blur(3px)')
  })

  it('reaches the image path through the dispatcher', () => {
    // filterScale is the observable one: a blurred clip drawn through the
    // dispatcher comes out with a halved blur only if the option travelled all
    // the way down to the image draw.
    const image = loadedImage(800, 600)
    const clip = makeClip({ effects: { blur: 4 } })
    const images = new Map([[clip.sourceVideoId, image]])

    drawMediaWithModifiers(asCtx(), new Map(), images, clip, 0, W, H, undefined, {
      filterScale: 0.5,
    })

    expect(ctx.stateFor('drawImage')[0].filter).toBe('blur(2px)')
  })
})

describe('drawMediaWithFrame', () => {
  it('reports failure for a missing frame without touching the context', () => {
    expect(drawMediaWithFrame(asCtx(), null, makeClip(), 0, W, H)).toBe(false)
    expect(ctx.calls).toEqual([])
  })

  it('draws an HTMLImageElement through the image path', () => {
    const image = loadedImage(800, 600)

    expect(drawMediaWithFrame(asCtx(), image, makeClip(), 0, W, H)).toBe(true)
    expect(ctx.argsFor('drawImage')[0]).toEqual([image, 560, 240, 800, 600])
  })

  it('draws a VideoFrame through the clip path', () => {
    const f = frame(640, 360)

    expect(drawMediaWithFrame(asCtx(), f, makeClip(), 0, W, H)).toBe(true)
    expect(ctx.argsFor('drawImage')[0]).toEqual([f, 640, 360, 640, 360])
  })

  it('passes the transition modifiers through to the frame draw', () => {
    drawMediaWithFrame(asCtx(), frame(640, 360), makeClip(), 0, W, H, { opacity: 0.25 })

    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBe(0.25)
  })
})

// ESCSUITE-65: the mask and the stroke are drawn in these two functions and
// nowhere else, so every claim below is made twice — once per function. The
// shared helper in `core/clipMask.ts` guards against the two disagreeing about
// the *geometry*; these guard against one of them simply not having been
// edited, which is the spec's own named risk.
const CIRCLE: ClipMask = { kind: 'circle' }
const ROUNDED: ClipMask = { kind: 'rounded', radius: 0.25 }
const STROKE: ClipStroke = { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1920 }

describe('drawClipToCanvas with a mask and a stroke', () => {
  const draw = (
    clip: Clip,
    modifiers?: TransitionModifiers
  ) => drawClipToCanvas(asCtx(), frame(640, 360), clip, 0, W, H, modifiers)

  it('clips to the mask after the rotation and before the image', () => {
    draw(
      makeClip({
        mask: CIRCLE,
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
      })
    )

    // After the rotation so the mask turns with the clip; before drawImage so
    // it is a clip region and not a shape painted over the picture.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'translate',
      'rotate',
      'translate',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
  })

  it('inscribes the circle in the drawn box', () => {
    draw(makeClip({ mask: CIRCLE }))

    // 640x360 at scale 1, centred on a 1920x1080 canvas: the box is
    // (640, 360)-(1280, 720), so the centre is (960, 540) and the inscribed
    // radius is 360/2 = 180.
    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([640, 360, 640, 360])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 180, 180, 0, 0, Math.PI * 2])
  })

  it('reads the rounded radius as a fraction of the drawn box shorter side', () => {
    draw(makeClip({ mask: ROUNDED }))

    // 0.25 x min(640, 360) = 90 canvas pixels, at this scale. Doubling the clip
    // would double the rounding, which is the point of a fraction.
    expect(ctx.argsFor('roundRect')[0]).toEqual([640, 360, 640, 360, 90])
  })

  it('strokes the outline after the image, outside the clip region', () => {
    draw(makeClip({ mask: CIRCLE, stroke: STROKE }))

    // The inner save/restore pair is the whole cost of a stroke: it exists so
    // the clip region is gone while the rotation is kept, which is how
    // ESCAPECRAFT draws the same border (overlayGeometry.ts:182-187). Without it
    // the mask would eat the inner half of every line.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
      'beginPath',
      'ellipse',
      'stroke',
      'restore',
    ])
    const [state] = ctx.stateFor('stroke')
    expect(state.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
    // 3/1920 of a 1920-wide frame is 3 canvas pixels.
    expect(state.lineWidth).toBeCloseTo(3, 10)
  })

  it('strokes the picture rectangle when the clip has no mask', () => {
    draw(makeClip({ stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'drawImage',
      'restore',
      'beginPath',
      'rect',
      'stroke',
      'restore',
    ])
    expect(ctx.argsFor('rect')[0]).toEqual([640, 360, 640, 360])
  })

  it('records two clips for a masked clip inside a wipe', () => {
    draw(makeClip({ mask: CIRCLE }), { clipRegion: { x: 10, y: 20, width: 300, height: 400 } })

    // The wipe's region and the mask intersect, which is the correct
    // composition: a half-revealed circular clip is a circle with a straight
    // edge, not a whole circle and not a whole rectangle.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'beginPath',
      'rect',
      'clip',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
    expect(ctx.argsFor('rect')[0]).toEqual([10, 20, 300, 400])
  })

  it.each([
    ['neither', undefined, undefined, 0, 0],
    ['a mask only', CIRCLE, undefined, 3, 0],
    ['a stroke only', undefined, STROKE, 5, 1],
    ['both', CIRCLE, STROKE, 8, 1],
  ])(
    'balances save and restore and adds a fixed cost for %s',
    (_label, mask, stroke, extraCalls, extraSaves) => {
      ctx = createRecordingContext()
      const plain = (() => {
        drawClipToCanvas(asCtx(), frame(640, 360), makeClip(), 0, W, H)
        return { calls: ctx.calls.length, saves: ctx.argsFor('save').length }
      })()

      ctx = createRecordingContext()
      drawClipToCanvas(asCtx(), frame(640, 360), makeClip({ mask, stroke }), 0, W, H)

      // Exact, not a ceiling: this is the arithmetic the per-frame ceilings in
      // Task 4 are derived from. A mask is beginPath + shape + clip, so 3; a
      // stroke is save + restore + beginPath + shape + stroke, so 5 — the
      // save/restore pair is counted here as well as in extraSaves, because
      // ctx.calls records them like any other call. lineWidth and strokeStyle
      // are property assignments, which the recording double does not count as
      // calls — see its `record()` helper and the note on `FrameMeasurement` in
      // `components/Preview/drawFrame.perf.test.ts`. The totals are exactly the
      // lengths of the call sequences enumerated above: 3, 6, 8 and 11.
      expect(ctx.calls.length).toBe(plain.calls + extraCalls)
      expect(ctx.argsFor('save').length).toBe(plain.saves + extraSaves)
      expect(ctx.argsFor('save').length).toBe(ctx.argsFor('restore').length)
    }
  )
})

describe('drawImageToCanvasWithModifiers with a mask and a stroke', () => {
  const draw = (clip: Clip, modifiers?: TransitionModifiers) =>
    drawImageToCanvasWithModifiers(asCtx(), loadedImage(800, 600), clip, 0, W, H, modifiers)

  it('clips to the mask after the rotation and before the image', () => {
    draw(
      makeClip({
        mask: CIRCLE,
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 180, opacity: 1 },
      })
    )

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'translate',
      'rotate',
      'translate',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
  })

  it('inscribes the circle in the drawn box', () => {
    draw(makeClip({ mask: CIRCLE }))

    // 800x600 centred on 1920x1080: the box is (560, 240)-(1360, 840), centre
    // (960, 540), inscribed radius 600/2 = 300.
    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([560, 240, 800, 600])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 300, 300, 0, 0, Math.PI * 2])
  })

  it('reads the rounded radius as a fraction of the drawn box shorter side', () => {
    draw(makeClip({ mask: ROUNDED }))

    // 0.25 x min(800, 600) = 150.
    expect(ctx.argsFor('roundRect')[0]).toEqual([560, 240, 800, 600, 150])
  })

  it('strokes the outline after the image, outside the clip region', () => {
    draw(makeClip({ mask: ROUNDED, stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'beginPath',
      'roundRect',
      'clip',
      'drawImage',
      'restore',
      'beginPath',
      'roundRect',
      'stroke',
      'restore',
    ])
    expect(ctx.stateFor('stroke')[0].lineWidth).toBeCloseTo(3, 10)
  })

  it('strokes the picture rectangle when the clip has no mask', () => {
    draw(makeClip({ stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'drawImage',
      'restore',
      'beginPath',
      'rect',
      'stroke',
      'restore',
    ])
  })

  it('records two clips for a masked clip inside a wipe', () => {
    draw(makeClip({ mask: CIRCLE }), { clipRegion: { x: 0, y: 0, width: 960, height: H } })

    expect(ctx.argsFor('clip')).toHaveLength(2)
    expect(ctx.argsFor('rect')[0]).toEqual([0, 0, 960, H])
  })

  it.each([
    ['neither', undefined, undefined, 0, 0],
    ['a mask only', CIRCLE, undefined, 3, 0],
    ['a stroke only', undefined, STROKE, 5, 1],
    ['both', CIRCLE, STROKE, 8, 1],
  ])(
    'balances save and restore and adds a fixed cost for %s',
    (_label, mask, stroke, extraCalls, extraSaves) => {
      ctx = createRecordingContext()
      drawImageToCanvasWithModifiers(asCtx(), loadedImage(800, 600), makeClip(), 0, W, H)
      const plain = { calls: ctx.calls.length, saves: ctx.argsFor('save').length }

      ctx = createRecordingContext()
      drawImageToCanvasWithModifiers(
        asCtx(),
        loadedImage(800, 600),
        makeClip({ mask, stroke }),
        0,
        W,
        H
      )

      expect(ctx.calls.length).toBe(plain.calls + extraCalls)
      expect(ctx.argsFor('save').length).toBe(plain.saves + extraSaves)
      expect(ctx.argsFor('save').length).toBe(ctx.argsFor('restore').length)
    }
  )
})
