// The webcam overlay's geometry, on its own.
//
// Every number here is a number `compositor.test.ts` already asserts, and that
// is the point of the file: the live compositor now *calls* `drawOverlay`, so a
// change that moved the circle in a downloaded MP4 would move it in the preview
// too and fail there as well. Before this module existed the composite would
// have been a second copy of the arc, the crop and the clip, and the difference
// would only ever have shown up in a file somebody downloaded.
//
// The canvas context is the recording double `src/test/setup.ts` installs
// globally, reached through a real <canvas>; the camera is a real <video> with
// its intrinsic size forced on, because that is all `drawOverlay` reads of it.
import { describe, it, expect } from 'vitest'
import {
  COMPOSITOR_MAX_WIDTH,
  DEFAULT_OVERLAY_PADDING,
  drawOverlay,
  overlayGeometryFor,
  overlayPaddingFor,
  type OverlayGeometry,
} from './overlayGeometry'
import { getCanvasContext, type RecordingCanvasRenderingContext2D } from '../test/doubles/canvas'

function ctxFor(width: number, height: number): RecordingCanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')
  const ctx = getCanvasContext(canvas)
  if (!ctx) throw new Error('the canvas double is not installed')
  return ctx
}

/** A camera element with an intrinsic size — the only two fields read of it. */
function webcamElement(videoWidth = 640, videoHeight = 480): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: videoWidth, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: videoHeight, configurable: true })
  return video
}

const RECTANGLE: OverlayGeometry = {
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'rectangle',
  padding: 20,
}
const CIRCLE: OverlayGeometry = { ...RECTANGLE, webcamShape: 'circle' }

describe('overlayPaddingFor', () => {
  it('is the recorded 20px for a frame the preview was never capped for', () => {
    // The compositor's canvas *is* the source below the cap, so the preview's
    // inset and the recording's are the same pixels.
    expect(overlayPaddingFor(COMPOSITOR_MAX_WIDTH)).toBe(DEFAULT_OVERLAY_PADDING)
    expect(overlayPaddingFor(640)).toBe(DEFAULT_OVERLAY_PADDING)
  })

  it('grows with the frame, so a 1080p composite has the inset the preview showed', () => {
    // The preview was 1280 wide with a 20px inset — 1.5625% of the width. The
    // recording is 1920 wide, so the same fraction is 30px. A flat 20 would put
    // the camera visibly closer to the edge than the user saw it.
    expect(overlayPaddingFor(1920)).toBe(30)
    expect(overlayPaddingFor(2560)).toBe(40)
  })

  it('answers the default for a frame with no width at all', () => {
    // A source with no picture has no corners. The conversion fails on its own
    // 0x0 encoder configuration a moment later; this stays total rather than
    // handing NaN coordinates to a canvas.
    expect(overlayPaddingFor(0)).toBe(DEFAULT_OVERLAY_PADDING)
  })
})

describe('overlayGeometryFor', () => {
  it('turns a stored placement into the geometry, padding scaled to the frame', () => {
    expect(
      overlayGeometryFor({ position: 'top-left', size: 0.3, shape: 'rectangle' }, 1920)
    ).toEqual({
      webcamPosition: 'top-left',
      webcamSize: 0.3,
      webcamShape: 'rectangle',
      padding: 30,
    })
  })
})

describe('drawOverlay', () => {
  it.each([
    ['top-left', 20, 20],
    ['top-right', 1280 - 256 - 20, 20],
    ['bottom-left', 20, 720 - 144 - 20],
    ['bottom-right', 1280 - 256 - 20, 720 - 144 - 20],
  ] as const)('positions a %s rectangular overlay at (%i, %i)', (webcamPosition, x, y) => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement()

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, {
      ...RECTANGLE,
      webcamPosition,
    })

    // 256 = 1280 * 0.2, 144 = 256 * 9/16 — the same four positions
    // compositor.test.ts pins for the live overlay.
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, x, y, 256, 144)
    expect(ctx.roundRect).toHaveBeenCalledWith(x, y, 256, 144, 8)
  })

  it('centre-crops a landscape camera into the circular overlay', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement(640, 480)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, CIRCLE)

    // radius = min(256,144)/2 = 72; centre = (1004+128, 556+72)
    expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
    // a landscape source is cropped to a 480x480 square, horizontally centred
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 80, 0, 480, 480, 1060, 556, 144, 144)
  })

  it('centre-crops a portrait camera into the circular overlay', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement(480, 640)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, CIRCLE)

    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 0, 80, 480, 480, 1060, 556, 144, 144)
  })

  it('clips before it draws and strokes the border after, outside the clip', () => {
    const ctx = ctxFor(1280, 720)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcamElement(), ctx.canvas, RECTANGLE)

    const order = ctx.calls.map((call) => call.method)
    expect(order.indexOf('clip')).toBeLessThan(order.lastIndexOf('drawImage'))
    expect(order.lastIndexOf('drawImage')).toBeLessThan(order.indexOf('stroke'))
    expect(order.indexOf('restore')).toBeLessThan(order.indexOf('stroke'))
    expect(ctx.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
    expect(ctx.lineWidth).toBe(3)
  })

  it('leaves the context stack exactly as it found it', () => {
    const ctx = ctxFor(1280, 720)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcamElement(), ctx.canvas, CIRCLE)

    // Exact: one save, one restore. An extra restore() is a no-op on a real
    // canvas, which is why nothing looked wrong when this drew two — but it
    // would silently undo a save() made by a caller that wrapped this draw,
    // and `convertToMP4` is now exactly such a caller.
    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })

  it('scales the overlay with the size, and honours a zero padding', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement()

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, {
      ...RECTANGLE,
      webcamSize: 0.4,
      padding: 0,
    })

    // 512 = 1280 * 0.4, 288 = 512 * 9/16; bottom-right with no padding sits
    // exactly on the frame's edge.
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 1280 - 512, 720 - 288, 512, 288)
  })
})
