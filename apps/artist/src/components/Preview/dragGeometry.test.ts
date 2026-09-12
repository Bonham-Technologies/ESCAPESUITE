// The measurements a pointer gesture takes, with no pointer in sight.
//
// `dragGeometry` is pure — canvas, clips and a time in, numbers out — so it is
// exercised directly here rather than through the hook that calls it. The
// canvas double stands in for the 2D context jsdom does not implement, and
// reports every string as 100px wide from measureText().
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { measureDragStart } from './dragGeometry'
import { makeClip, makeTextData } from '../../test/fixtures/exportPipeline'
import {
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
} from '../../test/doubles/canvas'
import type { Clip } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

beforeEach(() => {
  installCanvasDouble()
})

afterEach(() => {
  uninstallCanvasDouble()
})

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  canvas.getContext('2d')
  return canvas
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
})
