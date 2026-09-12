// The measurements a pointer gesture takes, with no pointer in sight.
//
// `dragGeometry` is pure — canvas, clips and a time in, numbers out — so it is
// exercised directly here rather than through the hook that calls it. The
// canvas double stands in for the 2D context jsdom does not implement, and
// reports every string as 100px wide from measureText().
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clipsIntersectingMarquee, measureDragStart, textClipAtPoint } from './dragGeometry'
import {
  makeClip,
  makeShapeData,
  makeSourceVideo,
  makeTextData,
  makeTrack,
} from '../../test/fixtures/exportPipeline'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { Clip } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

beforeEach(() => {
  installCanvasDouble()
})

afterEach(() => {
  uninstallCanvasDouble()
})

/**
 * A canvas at the project resolution, laid out at exactly half that size, so
 * canvas pixels are client pixels doubled and nothing is letterboxed.
 * `withContext: false` leaves getContext() uncalled for failNextGetContext().
 */
function makeCanvas({ withContext = true }: { withContext?: boolean } = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  setRect(canvas, { left: 0, top: 0, width: CANVAS_W / 2, height: CANVAS_H / 2 })
  if (withContext) canvas.getContext('2d')
  return canvas
}

const shapeClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({
    id: 'shape1',
    sourceVideoId: '',
    overlayType: 'shape',
    shapeData: makeShapeData(),
    ...overrides,
  })

/** A marquee swept across the whole canvas, in the element's own CSS pixels. */
const WHOLE_CANVAS = {
  start: { x: 0, y: 0 },
  current: { x: CANVAS_W / 2, y: CANVAS_H / 2 },
}

const textClip = (data = {}): Clip =>
  makeClip({
    id: 'text1',
    sourceVideoId: '',
    overlayType: 'text',
    textData: makeTextData(data),
  })

describe('measureDragStart', () => {
  it('leaves the context’s font as it found it', () => {
    // The context belongs to the preview, which draws through it on the very
    // next frame: a measurement must not leave its own font behind.
    const canvas = makeCanvas()
    const ctx = getCanvasContext(canvas)!
    ctx.font = '12px Courier'

    measureDragStart(textClip({ fontSize: 40, fontFamily: 'Georgia' }), 'text', canvas, 0, true, [])

    expect(ctx.font).toBe('12px Courier')
  })

  it('falls back to the text’s own scale when the canvas has no 2D context', () => {
    // getOverlayBounds needs the context to measure with; the scale the drag
    // starts from is worked out from a second measurement, and a context that
    // has gone by then leaves the clip's own scale as the answer.
    const canvas = makeCanvas()
    const live = canvas.getContext('2d')
    const getContext = vi.spyOn(canvas, 'getContext')
    getContext.mockReturnValueOnce(live).mockReturnValueOnce(null)

    const measured = measureDragStart(textClip({ scale: 3 }), 'text', canvas, 0, true, [])

    expect(measured.startScaleX).toBe(3)
    expect(measured.startScaleY).toBe(3)
  })
})

describe('clipsIntersectingMarquee', () => {
  it('sweeps up the clips under the rectangle', () => {
    const clip = shapeClip()

    expect(
      clipsIntersectingMarquee(makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], 0, [])
    ).toEqual(['shape1'])
  })

  it('passes over a clip the playhead is not inside', () => {
    // The marquee covers the whole canvas; the clip runs from 10s to 15s.
    const clip = shapeClip({ timelinePosition: 10, duration: 5 })

    expect(
      clipsIntersectingMarquee(makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], 0, [])
    ).toEqual([])
  })

  it('passes over a clip whose media is not loaded', () => {
    // A media clip with no source in the list has no size, so it has no box
    // for the marquee to intersect.
    const clip = makeClip({ id: 'orphan', sourceVideoId: 'missing' })

    expect(
      clipsIntersectingMarquee(makeCanvas(), WHOLE_CANVAS.start, WHOLE_CANVAS.current, [clip], 0, [
        makeSourceVideo(),
      ])
    ).toEqual([])
  })
})

describe('textClipAtPoint', () => {
  const tracks = [makeTrack()]

  it('finds the text under the point', () => {
    const clip = textClip()

    expect(textClipAtPoint(CANVAS_W / 2, CANVAS_H / 2, makeCanvas(), [clip], tracks, 0, [])).toBe(
      clip
    )
  })

  it('finds nothing when the text cannot be measured', () => {
    // No 2D context, so no bounds, so nothing to be inside.
    const canvas = makeCanvas({ withContext: false })
    failNextGetContext()

    expect(
      textClipAtPoint(CANVAS_W / 2, CANVAS_H / 2, canvas, [textClip()], tracks, 0, [])
    ).toBeNull()
  })
})
