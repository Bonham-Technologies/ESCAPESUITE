// Text and shape overlay drawing. These are pure 2D-context functions, so the
// recording canvas double's ordered call log — with the drawing state captured
// at each call — is the whole observable behaviour: what was drawn, in what
// order, under which transform, alpha, blend and filter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drawShapeOverlayToCanvasAnimated, drawTextOverlayToCanvasAnimated } from './canvasRenderer'
import {
  createRecordingContext,
  getLastCanvasContext,
  getLastOffscreenContext,
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { makeAnimated, makeShapeData, makeTextData } from '../test/fixtures/exportPipeline'

const W = 1920
const H = 1080

let ctx: RecordingCanvasRenderingContext2D
const methods = () => ctx.calls.map((c) => c.method)

beforeEach(() => {
  ctx = createRecordingContext()
})

// The renderer assertions below read the drawing state captured at each call,
// which is only meaningful if the double's save()/restore() behave like a real
// context's. These pin that down directly.
describe('recording canvas double (canary)', () => {
  it('restores the state a save() captured', () => {
    const c = createRecordingContext()
    const draw = c as unknown as CanvasRenderingContext2D
    c.globalAlpha = 1
    c.filter = 'none'

    draw.save()
    c.globalAlpha = 0.25
    c.filter = 'blur(4px)'
    draw.fillRect(0, 0, 1, 1)
    draw.restore()
    draw.fillRect(0, 0, 1, 1)

    // The first rect was drawn under the pushed state, the second under the
    // restored one — the double does not leak state past a restore().
    expect(c.stateFor('fillRect')[0]).toMatchObject({ globalAlpha: 0.25, filter: 'blur(4px)' })
    expect(c.stateFor('fillRect')[1]).toMatchObject({ globalAlpha: 1, filter: 'none' })
    expect(c.globalAlpha).toBe(1)
    expect(c.filter).toBe('none')
  })

  it('restores every tracked property, and nests', () => {
    const c = createRecordingContext()
    const draw = c as unknown as CanvasRenderingContext2D
    draw.save()
    c.fillStyle = '#111111'
    c.strokeStyle = '#222222'
    c.lineWidth = 3
    c.font = '10px Arial'
    c.textAlign = 'end'
    c.textBaseline = 'top'
    c.globalCompositeOperation = 'screen'

    draw.save()
    c.fillStyle = '#333333'
    draw.restore()
    expect(c.fillStyle).toBe('#111111')

    draw.restore()
    expect(c).toMatchObject({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalCompositeOperation: 'source-over',
    })
  })

  it('treats an unbalanced restore() as a no-op', () => {
    const c = createRecordingContext()
    c.globalAlpha = 0.5

    ;(c as unknown as CanvasRenderingContext2D).restore()

    expect(c.globalAlpha).toBe(0.5)
  })

  it('keeps an OffscreenCanvas out of getLastCanvasContext()', () => {
    installCanvasDouble()
    const offscreenDouble = installOffscreenCanvasDouble()
    try {
      const onscreen = document.createElement('canvas').getContext('2d')
      const scratch = new OffscreenCanvas(10, 10).getContext('2d')

      expect(getLastCanvasContext()).toBe(onscreen)
      expect(offscreenDouble.instances).toHaveLength(1)
      expect(getLastOffscreenContext()).toBe(scratch)
      expect(offscreenDouble.lastContext).toBe(offscreenDouble.instances[0].context)
    } finally {
      offscreenDouble.uninstall()
      uninstallCanvasDouble()
    }
  })
})

describe('drawTextOverlayToCanvasAnimated', () => {
  const draw = (
    text = makeTextData(),
    animated = makeAnimated(),
  ) => drawTextOverlayToCanvasAnimated(ctx as unknown as CanvasRenderingContext2D, text, W, H, animated)

  it('brackets every draw in save/restore', () => {
    draw()

    expect(methods()[0]).toBe('save')
    expect(methods()[methods().length - 1]).toBe('restore')
  })

  it('draws the text at the animated position, not the overlay position', () => {
    draw(makeTextData({ x: 0.1, y: 0.1 }), makeAnimated({ x: 0.25, y: 0.75 }))

    expect(ctx.argsFor('fillText')[0]).toEqual(['Hello', 480, 810])
  })

  it('applies the animated opacity to the text', () => {
    draw(makeTextData(), makeAnimated({ opacity: 0.4 }))

    expect(ctx.stateFor('fillText')[0].globalAlpha).toBe(0.4)
  })

  it('applies a blur filter only when the animated blur is positive', () => {
    draw(makeTextData(), makeAnimated({ blur: 6 }))
    expect(ctx.stateFor('fillText')[0].filter).toBe('blur(6px)')

    ctx = createRecordingContext()
    draw()
    expect(ctx.stateFor('fillText')[0].filter).toBe('none')
  })

  it('rotates about the text position in radians', () => {
    draw(makeTextData(), makeAnimated({ rotation: 90 }))

    expect(ctx.argsFor('translate')).toEqual([[960, 540], [-960, -540]])
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('does not rotate or scale when the animated values are neutral', () => {
    draw()

    expect(ctx.argsFor('rotate')).toEqual([])
    expect(ctx.argsFor('scale')).toEqual([])
  })

  it('scales uniformly by the larger of scaleX and scaleY', () => {
    draw(makeTextData(), makeAnimated({ scaleX: 1.5, scaleY: 2.5 }))

    expect(ctx.argsFor('scale')).toEqual([[2.5, 2.5]])
  })

  it('builds the font string from style, weight, size and family', () => {
    draw(makeTextData({ fontStyle: 'italic', fontWeight: 'bold', fontSize: 32, fontFamily: 'Inter' }))

    expect(ctx.stateFor('fillText')[0].font).toBe('italic bold 32px Inter')
  })

  it('omits style and weight prefixes when they are the defaults', () => {
    draw(makeTextData({ fontSize: 20, fontFamily: 'Courier' }))

    expect(ctx.stateFor('fillText')[0].font).toBe('20px Courier')
  })

  it('draws with the requested alignment on a middle baseline', () => {
    draw(makeTextData({ textAlign: 'right' }))

    const state = ctx.stateFor('fillText')[0]
    expect(state.textAlign).toBe('right')
    expect(state.textBaseline).toBe('middle')
  })

  it('draws the background behind the text, in the background colour', () => {
    ctx.measuredTextWidth = 200
    draw(makeTextData({ backgroundColor: '#000000cc', fontSize: 40 }))

    expect(methods().indexOf('fillRect')).toBeLessThan(methods().indexOf('fillText'))
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#000000cc')
    expect(ctx.stateFor('fillText')[0].fillStyle).toBe('#ffffff')
  })

  it('centres the background box on the text for centred text', () => {
    ctx.measuredTextWidth = 200
    // padding = 40 * 0.3 = 12, so the box is 224 x 72 around (960, 540).
    draw(makeTextData({ backgroundColor: '#000000cc', fontSize: 40, textAlign: 'center' }))

    expect(ctx.argsFor('fillRect')[0]).toEqual([960 - 112, 540 - 36, 224, 72])
  })

  it('left-aligns the background box for left-aligned text', () => {
    ctx.measuredTextWidth = 200
    draw(makeTextData({ backgroundColor: '#000000cc', fontSize: 40, textAlign: 'left' }))

    expect(ctx.argsFor('fillRect')[0]).toEqual([960 - 12, 540 - 36, 224, 72])
  })

  it('right-aligns the background box for right-aligned text', () => {
    ctx.measuredTextWidth = 200
    draw(makeTextData({ backgroundColor: '#000000cc', fontSize: 40, textAlign: 'right' }))

    expect(ctx.argsFor('fillRect')[0]).toEqual([960 - 224 + 12, 540 - 36, 224, 72])
  })

  it('draws no background for a fully transparent background colour', () => {
    draw(makeTextData({ backgroundColor: '#00000000' }))

    expect(ctx.argsFor('fillRect')).toEqual([])
  })

  it('draws no background when the background colour is empty', () => {
    draw(makeTextData({ backgroundColor: '' }))

    expect(ctx.argsFor('fillRect')).toEqual([])
  })
})

describe('drawShapeOverlayToCanvasAnimated', () => {
  const draw = (
    shape = makeShapeData(),
    animated = makeAnimated(),
    canvas?: HTMLCanvasElement
  ) =>
    drawShapeOverlayToCanvasAnimated(
      ctx as unknown as CanvasRenderingContext2D,
      shape,
      W,
      H,
      animated,
      canvas
    )

  it('fills and strokes a rectangle sized by the animated scale', () => {
    // 0.25 * 1920 * 2 = 960 wide, 0.5 * 1080 * 0.5 = 270 tall, centred at (960, 540).
    draw(makeShapeData(), makeAnimated({ scaleX: 2, scaleY: 0.5 }))

    expect(ctx.argsFor('fillRect')).toEqual([[480, 405, 960, 270]])
    expect(ctx.argsFor('strokeRect')).toEqual([[480, 405, 960, 270]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#ff0000ff')
    expect(ctx.stateFor('strokeRect')[0].strokeStyle).toBe('#0000ffff')
    expect(ctx.stateFor('strokeRect')[0].lineWidth).toBe(4)
  })

  it('skips the fill for a fully transparent fill colour', () => {
    draw(makeShapeData({ fillColor: '#ff000000' }))

    expect(ctx.argsFor('fillRect')).toEqual([])
    expect(ctx.argsFor('strokeRect')).toHaveLength(1)
  })

  it('fills a six-digit colour whose blue channel happens to be 00', () => {
    // #ff0000 is pure red at full opacity: only an eight-digit colour carries
    // an alpha, and only an alpha of 00 means "no fill".
    draw(makeShapeData({ fillColor: '#ff0000' }))

    expect(ctx.argsFor('fillRect')).toHaveLength(1)
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#ff0000')
  })

  it('fills every six-digit colour that ends in a zero channel', () => {
    for (const fillColor of ['#00ff00', '#ffff00', '#ff8800', '#000000']) {
      ctx = createRecordingContext()
      draw(makeShapeData({ fillColor, type: 'ellipse' }))

      expect(ctx.argsFor('fill'), fillColor).toHaveLength(1)
    }
  })

  it('skips the stroke when the stroke width is zero', () => {
    draw(makeShapeData({ strokeWidth: 0 }))

    expect(ctx.argsFor('strokeRect')).toEqual([])
    expect(ctx.argsFor('fillRect')).toHaveLength(1)
  })

  it('draws an ellipse as a path, filled then stroked', () => {
    draw(makeShapeData({ type: 'ellipse' }))

    expect(methods()).toEqual([
      'save',
      'beginPath',
      'ellipse',
      'fill',
      'stroke',
      'restore',
    ])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 240, 270, 0, 0, Math.PI * 2])
  })

  it('draws a line across the shape width at its centre', () => {
    draw(makeShapeData({ type: 'line' }))

    expect(ctx.argsFor('moveTo')).toEqual([[720, 540]])
    expect(ctx.argsFor('lineTo')).toEqual([[1200, 540]])
    expect(ctx.argsFor('stroke')).toHaveLength(1)
  })

  it('draws an arrow as a shaft plus a filled head', () => {
    // arrowSize = min(480, 540) * 0.2 = 96
    draw(makeShapeData({ type: 'arrow' }))

    expect(methods()).toEqual([
      'save',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'restore',
    ])
    expect(ctx.argsFor('moveTo')).toEqual([[720, 540], [1200, 540]])
    expect(ctx.argsFor('lineTo')).toEqual([
      [1104, 540],
      [1104, 492],
      [1104, 588],
    ])
  })

  it('draws neither fill nor stroke for a blur shape', () => {
    draw(makeShapeData({ type: 'blur' }))

    expect(methods()).toEqual(['save', 'restore'])
  })

  it('applies the animated opacity and blur to the shape', () => {
    draw(makeShapeData(), makeAnimated({ opacity: 0.3, blur: 8 }))

    const state = ctx.stateFor('fillRect')[0]
    expect(state.globalAlpha).toBe(0.3)
    expect(state.filter).toBe('blur(8px)')
  })

  it('rotates about the shape centre', () => {
    draw(makeShapeData(), makeAnimated({ rotation: 180 }))

    expect(ctx.argsFor('translate')).toEqual([[960, 540], [-960, -540]])
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI]])
  })
})

describe('drawShapeOverlayToCanvasAnimated with a blur region', () => {
  let offscreen: OffscreenCanvasDouble
  let source: HTMLCanvasElement

  beforeEach(() => {
    offscreen = installOffscreenCanvasDouble()
    source = document.createElement('canvas')
    ctx = createRecordingContext()
  })

  afterEach(() => {
    offscreen.uninstall()
  })

  const draw = (shape = makeShapeData({ type: 'blur' }), animated = makeAnimated()) =>
    drawShapeOverlayToCanvasAnimated(
      ctx as unknown as CanvasRenderingContext2D,
      shape,
      W,
      H,
      animated,
      source
    )

  it('captures the frame so far and draws it back through the shape as a clip', () => {
    draw(makeShapeData({ type: 'blur', blurAmount: 12 }))

    expect(offscreen.instances[0]).toMatchObject({ width: W, height: H })
    // The capture goes into the offscreen canvas...
    expect(offscreen.instances[0].context.argsFor('drawImage')).toEqual([[source, 0, 0]])
    // ...and comes back out through the clipped, blurred main context.
    expect(methods()).toEqual([
      'save',
      'beginPath',
      'ellipse', // a blur shape is elliptical, like the 'ellipse' type
      'clip',
      'setTransform',
      'drawImage',
      'restore',
      'save',
      'restore',
    ])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 240, 270, 0, 0, Math.PI * 2])
    expect(ctx.argsFor('setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
    const state = ctx.stateFor('drawImage')[0]
    expect(state.filter).toBe('blur(12px)')
  })

  it('defaults a blur shape with no blur amount to 10px', () => {
    draw()

    expect(ctx.stateFor('drawImage')[0].filter).toBe('blur(10px)')
  })

  it('applies the animated opacity to the blurred capture', () => {
    draw(makeShapeData({ type: 'blur' }), makeAnimated({ opacity: 0.6 }))

    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBe(0.6)
  })

  it('clips a rectangle blur to a rectangular path', () => {
    draw(makeShapeData({ type: 'rectangle', blurAmount: 5 }))

    expect(ctx.argsFor('rect')[0]).toEqual([720, 270, 480, 540])
    expect(methods().indexOf('clip')).toBeGreaterThan(methods().indexOf('rect'))
  })

  it('rotates the clip region without rotating the captured content', () => {
    draw(makeShapeData({ type: 'blur', blurAmount: 4, rotation: 45 }), makeAnimated({ rotation: 45 }))

    // The rotation is applied before the clip path, then reset by setTransform
    // so the blurred capture is drawn upright.
    const order = methods()
    expect(order.indexOf('rotate')).toBeLessThan(order.indexOf('clip'))
    expect(order.indexOf('setTransform')).toBeGreaterThan(order.indexOf('clip'))
    expect(ctx.argsFor('rotate')[0]).toEqual([Math.PI / 4])
  })

  it('draws no blur capture when the browser cannot give it a 2D context', () => {
    offscreen.failGetContext = true

    draw(makeShapeData({ type: 'blur', blurAmount: 12 }))

    expect(offscreen.instances).toHaveLength(1)
    expect(ctx.argsFor('drawImage')).toEqual([])
  })

  it('draws no blur capture for a shape type that cannot carry one', () => {
    draw(makeShapeData({ type: 'arrow', blurAmount: 12 }))

    expect(offscreen.instances).toHaveLength(0)
  })

  it('draws no blur capture when no source canvas is supplied', () => {
    drawShapeOverlayToCanvasAnimated(
      ctx as unknown as CanvasRenderingContext2D,
      makeShapeData({ type: 'blur', blurAmount: 12 }),
      W,
      H,
      makeAnimated()
    )

    expect(offscreen.instances).toHaveLength(0)
  })

  describe('with a scratch canvas', () => {
    // A caller that redraws continuously (the preview) hands in one canvas to
    // capture into, instead of paying for a full-size allocation every frame.
    let scratch: HTMLCanvasElement

    beforeEach(() => {
      installCanvasDouble()
      scratch = document.createElement('canvas')
      scratch.width = W
      scratch.height = H
    })

    afterEach(() => {
      uninstallCanvasDouble()
    })

    const drawWithScratch = (shape = makeShapeData({ type: 'blur', blurAmount: 12 })) =>
      drawShapeOverlayToCanvasAnimated(
        ctx as unknown as CanvasRenderingContext2D,
        shape,
        W,
        H,
        makeAnimated(),
        source,
        scratch
      )

    it('captures into the scratch canvas and allocates nothing', () => {
      drawWithScratch()

      expect(offscreen.instances).toHaveLength(0)
      const scratchCtx = getLastCanvasContext()!
      expect(scratchCtx.canvas).toBe(scratch)
      // Cleared first: the scratch still holds the previous frame's capture.
      expect(scratchCtx.calls.map((c) => c.method)).toEqual(['clearRect', 'drawImage'])
      expect(scratchCtx.argsFor('clearRect')).toEqual([[0, 0, W, H]])
      expect(scratchCtx.argsFor('drawImage')).toEqual([[source, 0, 0]])
    })

    it('draws the same scratch canvas back through the clipped path', () => {
      drawWithScratch()

      expect(methods()).toEqual([
        'save',
        'beginPath',
        'ellipse',
        'clip',
        'setTransform',
        'drawImage',
        'restore',
        'save',
        'restore',
      ])
      expect(ctx.argsFor('drawImage')[0]).toEqual([scratch, 0, 0])
      expect(ctx.stateFor('drawImage')[0].filter).toBe('blur(12px)')
    })

    it('reuses the one canvas across frames', () => {
      drawWithScratch()
      drawWithScratch()

      expect(offscreen.instances).toHaveLength(0)
      expect(getLastCanvasContext()!.argsFor('drawImage')).toEqual([
        [source, 0, 0],
        [source, 0, 0],
      ])
    })
  })
})
