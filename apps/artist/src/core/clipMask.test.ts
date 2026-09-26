// The mask and stroke geometry, on its own (ESCSUITE-65).
//
// Everything here is arithmetic over a drawn rectangle, so it is tested without
// a clip, without a renderer and without a store — `core/canvasRenderer.ts` is
// the only caller, and Task 3's tests assert that it calls these in the right
// place. The context is the recording double, reached directly rather than
// through a canvas element, because these functions take a context and create
// nothing.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyClipMask,
  applyClipStroke,
  drawWithMaskAndStroke,
  maskPathFor,
  visibleClipStroke,
} from './clipMask'
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import type { ClipMask, ClipStroke } from '../store/types'

/** The drawn box every case below masks: 200x100 at (50, 30), so min = 100. */
const BOX = { x: 50, y: 30, width: 200, height: 100 } as const

let ctx: RecordingCanvasRenderingContext2D

const asCtx = () => ctx as unknown as CanvasRenderingContext2D

beforeEach(() => {
  ctx = createRecordingContext()
})

describe('maskPathFor', () => {
  it('inscribes the circle in the box, centred on it', () => {
    // Decision 1: min(w, h) / 2, the circle the user saw in ESCAPECRAFT
    // (overlayGeometry.ts:143-145). Not a box-filling ellipse — a separate
    // 'ellipse' kind can be added later if that is ever wanted.
    expect(maskPathFor('circle', undefined, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'circle',
      centreX: 150,
      centreY: 80,
      radius: 50,
    })
  })

  it('reads the rounded radius as a fraction of the shorter side', () => {
    // 0.2 x min(200, 100) = 20 canvas pixels. A fraction rather than pixels
    // because ARTIST can change a project's resolution under a clip.
    expect(maskPathFor('rounded', 0.2, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'rounded',
      x: 50,
      y: 30,
      width: 200,
      height: 100,
      radius: 20,
    })
  })

  it('clamps the rounded radius at half the shorter side', () => {
    // Half the shorter side is a stadium; past it a real roundRect throws
    // IndexSizeError, which inside a preview frame would kill the frame.
    expect(maskPathFor('rounded', 4, BOX.x, BOX.y, BOX.width, BOX.height)).toMatchObject({
      shape: 'rounded',
      radius: 50,
    })
  })

  it.each([
    ['no mask at all', 'none' as const, 0.2],
    ['a rounded mask whose radius is zero', 'rounded' as const, 0],
    ['a rounded mask with no radius stored', 'rounded' as const, undefined],
    ['a rounded mask with a negative radius', 'rounded' as const, -0.5],
  ])('answers the plain rectangle for %s', (_label, kind, radius) => {
    // The rectangle *is* the drawn box, which is how this says "nothing to
    // mask" — and it is also exactly the outline a stroke on an unmasked clip
    // needs to trace, so there is one rule here and not two.
    expect(maskPathFor(kind, radius, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'rect',
      x: 50,
      y: 30,
      width: 200,
      height: 100,
    })
  })

  it.each([
    ['no width', 0, 100],
    ['no height', 200, 0],
    ['a negative width', -200, 100],
  ])('answers the plain rectangle for a box with %s', (_label, width, height) => {
    // A clip at scale 0 has no outline. A circle of radius 0 would clip the
    // whole frame away, which looks like the renderer breaking rather than like
    // a clip nobody can see.
    expect(maskPathFor('circle', undefined, BOX.x, BOX.y, width, height)).toMatchObject({
      shape: 'rect',
    })
  })
})

describe('applyClipMask', () => {
  it('issues exactly beginPath, ellipse and clip for a circle', () => {
    applyClipMask(asCtx(), { kind: 'circle' }, BOX.x, BOX.y, BOX.width, BOX.height)

    // Three calls, and no closePath(): clip() closes the path implicitly, so a
    // fourth call per masked clip per frame would buy nothing. ESCAPECRAFT's own
    // draw does call it; that is a cost worth not copying.
    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'ellipse', 'clip'])
    expect(ctx.argsFor('ellipse')[0]).toEqual([150, 80, 50, 50, 0, 0, Math.PI * 2])
  })

  it('issues exactly beginPath, roundRect and clip for a rounded mask', () => {
    applyClipMask(asCtx(), { kind: 'rounded', radius: 0.2 }, BOX.x, BOX.y, BOX.width, BOX.height)

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'roundRect', 'clip'])
    expect(ctx.argsFor('roundRect')[0]).toEqual([50, 30, 200, 100, 20])
  })

  it.each([
    ['an absent mask', undefined],
    ['a mask of kind none', { kind: 'none' as const }],
    ['a rounded mask with no radius', { kind: 'rounded' as const }],
  ])('touches the context not at all for %s', (_label, mask) => {
    applyClipMask(asCtx(), mask, BOX.x, BOX.y, BOX.width, BOX.height)

    // Not "issues a rect and clips to it": a clip with no mask must record
    // exactly what it recorded before ESCSUITE-65 existed, which is what the
    // canvasRenderer tests and the perf ceilings both hold to.
    expect(ctx.calls).toEqual([])
  })

  it('touches the context not at all for a box with no area', () => {
    applyClipMask(asCtx(), { kind: 'circle' }, BOX.x, BOX.y, 0, 0)

    // maskPathFor's zero-area arm, reached through the call site rather than
    // asserted on in isolation: a circle inscribed in nothing has radius 0, and
    // clipping to that would take the whole frame away.
    expect(ctx.calls).toEqual([])
  })

  it('builds the rounded path from arcTo when the browser has no roundRect', () => {
    // Safari gained roundRect in 16.4 and `pnpm test:e2e:browsers` runs WebKit.
    // A throw inside a preview frame kills the whole frame, not just the mask,
    // so this is a correctness path rather than an optimisation — and it costs
    // five calls instead of one, which is why the perf ceilings are measured
    // with roundRect present.
    //
    // A second double of its own, rather than a spread copy of `ctx`: a spread
    // only records into `ctx.calls` because the double happens to be a plain
    // object literal sharing that array by reference, which would break
    // confusingly the day the double grows a class or an accessor.
    const withoutRoundRect = createRecordingContext()
    delete (withoutRoundRect as unknown as Record<string, unknown>).roundRect

    applyClipMask(
      withoutRoundRect as unknown as CanvasRenderingContext2D,
      { kind: 'rounded', radius: 0.2 },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height
    )

    expect(withoutRoundRect.calls.map((c) => c.method)).toEqual([
      'beginPath',
      'moveTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'clip',
    ])
    // Clockwise from the top edge, each corner turning into the next: the same
    // rectangle roundRect(50, 30, 200, 100, 20) describes.
    expect(withoutRoundRect.argsFor('moveTo')[0]).toEqual([70, 30])
    expect(withoutRoundRect.argsFor('arcTo')).toEqual([
      [250, 30, 250, 130, 20],
      [250, 130, 50, 130, 20],
      [50, 130, 50, 30, 20],
      [50, 30, 250, 30, 20],
    ])
  })
})

describe('visibleClipStroke', () => {
  it.each([
    ['no stroke', undefined],
    ['a stroke of zero width', { color: '#ffffff', width: 0 }],
    ['a stroke of negative width', { color: '#ffffff', width: -1 }],
  ])('answers undefined for %s', (_label, stroke) => {
    expect(visibleClipStroke(stroke)).toBeUndefined()
  })

  it('answers the stroke itself when it has width', () => {
    const stroke = { color: '#ff0000', width: 0.002 }
    expect(visibleClipStroke(stroke)).toBe(stroke)
  })
})

describe('applyClipStroke', () => {
  it('traces the mask outline and strokes it, in frame-width pixels', () => {
    applyClipStroke(
      asCtx(),
      { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
      { kind: 'circle' },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'ellipse', 'stroke'])
    // ESCAPECRAFT's 3 px is 3 px of a 1280-wide canvas, so the fraction resolves
    // to exactly 3 at 1280 and scales with the project from there.
    const [state] = ctx.stateFor('stroke')
    expect(state.lineWidth).toBe(3)
    expect(state.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
  })

  it('scales the line width with the frame', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 3 / 1280 },
      undefined,
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1920
    )

    expect(ctx.stateFor('stroke')[0].lineWidth).toBeCloseTo(4.5, 10)
  })

  it('traces the plain rectangle when the clip has no mask', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 0.01 },
      undefined,
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    // Decision 6: the stroke goes on the mask's outline, or on the picture's own
    // rectangle when there is no mask. A border round an unmasked clip is a
    // feature in its own right, not a fallback.
    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'rect', 'stroke'])
    expect(ctx.argsFor('rect')[0]).toEqual([50, 30, 200, 100])
  })

  it('traces the rounded outline for a rounded mask', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 0.01 },
      { kind: 'rounded', radius: 0.2 },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'roundRect', 'stroke'])
    expect(ctx.argsFor('roundRect')[0]).toEqual([50, 30, 200, 100, 20])
  })

  it.each([
    ['no stroke', undefined],
    ['a stroke of zero width', { color: '#ffffff', width: 0 }],
  ])('touches the context not at all for %s', (_label, stroke) => {
    applyClipStroke(asCtx(), stroke, { kind: 'circle' }, BOX.x, BOX.y, BOX.width, BOX.height, 1280)

    expect(ctx.calls).toEqual([])
  })

  it('touches the context not at all for a box with no area', () => {
    applyClipStroke(asCtx(), { color: '#ffffff', width: 0.01 }, { kind: 'circle' }, BOX.x, BOX.y, 0, 0, 1280)

    // maskPathFor answers a zero-area rectangle here, and stroking that would
    // paint a line where the user sees nothing at all.
    expect(ctx.calls).toEqual([])
  })
})

describe('drawWithMaskAndStroke', () => {
  /**
   * The one place the mask/draw/stroke order lives, so the two near-duplicate
   * functions in `core/canvasRenderer.ts` cannot disagree about it. The
   * canvasRenderer suite proves each of them *calls* this; these cases are the
   * sequence itself, read directly.
   */
  const SOURCE = {} as unknown as CanvasImageSource
  const drawTheBox = () => asCtx().drawImage(SOURCE, BOX.x, BOX.y, BOX.width, BOX.height)

  const run = (mask: ClipMask | undefined, stroke: ClipStroke | undefined) => {
    let drew = 0
    drawWithMaskAndStroke(
      asCtx(),
      mask,
      stroke,
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280,
      () => {
        drew += 1
        drawTheBox()
      }
    )
    return drew
  }

  const CIRCLE: ClipMask = { kind: 'circle' }
  const STROKE: ClipStroke = { color: '#ffffff', width: 3 / 1280 }

  it('draws the picture and nothing else for a clip with neither', () => {
    // The load-bearing case: no mask and no stroke must cost not one extra
    // context call, because that is what every per-frame ceiling in the repo
    // measures and what a project saved before ESCSUITE-65 draws as.
    expect(run(undefined, undefined)).toBe(1)
    expect(ctx.calls.map((c) => c.method)).toEqual(['drawImage'])
  })

  it('clips before the picture and takes no save for a mask alone', () => {
    // The caller's own save()/restore() pair already covers the mask, so a
    // masked-but-unstroked clip adds three calls and no state operations.
    expect(run(CIRCLE, undefined)).toBe(1)
    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'ellipse', 'clip', 'drawImage'])
  })

  it('wraps the picture in a save/restore and strokes the box after it', () => {
    expect(run(undefined, STROKE)).toBe(1)
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'drawImage',
      'restore',
      'beginPath',
      'rect',
      'stroke',
    ])
  })

  it('strokes the mask outline outside the clip region when it has both', () => {
    // The restore() between drawImage and the stroke is the whole point: the
    // clip region has to be gone while the caller's rotation stays, or the mask
    // eats the inner half of every line.
    expect(run(CIRCLE, STROKE)).toBe(1)
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
      'beginPath',
      'ellipse',
      'stroke',
    ])
    // One save, one restore — and no trailing restore, because the outer pair
    // belongs to the caller, not to this helper.
    expect(ctx.argsFor('save')).toHaveLength(ctx.argsFor('restore').length)
  })

  it('pays no save for a stroke that would not be visible', () => {
    // One definition of "visible", read here rather than duplicated: a stored
    // stroke of zero width is not a stroke, so it buys no save and no restore.
    expect(run(undefined, { color: '#ffffff', width: 0 })).toBe(1)
    expect(ctx.calls.map((c) => c.method)).toEqual(['drawImage'])
  })
})
