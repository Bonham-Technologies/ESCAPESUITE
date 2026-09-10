import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Compositor } from './compositor'
import {
  getCanvasContext,
  installCanvasCaptureStreamDouble,
  uninstallCanvasCaptureStreamDouble,
  getCapturedCanvasStreams,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getVideoDoubles,
  getLastVideoDouble,
  type VideoElementDouble,
} from '../test/doubles/video'

// The render loop reschedules itself on every tick, so cancelAnimationFrame
// has to genuinely clear the pending callback — a no-op cancel would leave the
// loop drawing into a torn-down environment after the test that started it.
const rafCallbacks = new Map<number, FrameRequestCallback>()
let nextRafHandle = 1
let originalRaf: typeof globalThis.requestAnimationFrame
let originalCancelRaf: typeof globalThis.cancelAnimationFrame

function installRafDouble(): void {
  originalRaf = globalThis.requestAnimationFrame
  originalCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const handle = nextRafHandle++
    rafCallbacks.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    rafCallbacks.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame
}

function uninstallRafDouble(): void {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  rafCallbacks.clear()
}

/** Run every currently-pending rAF callback exactly once. */
function tickAnimationFrames(): number {
  const pending = [...rafCallbacks.entries()]
  rafCallbacks.clear()
  for (const [, cb] of pending) cb(0)
  return pending.length
}

function pendingFrameCount(): number {
  return rafCallbacks.size
}

let now = 0

function ctxOf(compositor: Compositor): RecordingCanvasRenderingContext2D {
  const ctx = getCanvasContext(compositor.getCanvas())
  if (!ctx) throw new Error('compositor canvas has no recording context')
  return ctx
}

function methodsOf(ctx: RecordingCanvasRenderingContext2D): string[] {
  return ctx.calls.map(c => c.method)
}

/** Attach a ready screen stream and return the <video> double it created. */
function attachScreen(compositor: Compositor): VideoElementDouble {
  compositor.setScreenStream(new MediaStream())
  const double = getLastVideoDouble()!
  double.setMetadata({ readyState: 4, videoWidth: 1920, videoHeight: 1080 })
  return double
}

function attachWebcam(
  compositor: Compositor,
  metadata: { videoWidth: number; videoHeight: number } = { videoWidth: 640, videoHeight: 480 }
): VideoElementDouble {
  compositor.setWebcamStream(new MediaStream())
  const double = getLastVideoDouble()!
  double.setMetadata({ readyState: 4, ...metadata })
  return double
}

describe('Compositor', () => {
  beforeEach(() => {
    now = 100_000
    rafCallbacks.clear()
    nextRafHandle = 1
    installRafDouble()
    installVideoElementDouble()
    installCanvasCaptureStreamDouble()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    uninstallCanvasCaptureStreamDouble()
    uninstallVideoElementDouble()
    uninstallRafDouble()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('caps the compositing canvas at 720p and keeps the aspect ratio', () => {
      const compositor = new Compositor(1920, 1080)
      expect(compositor.getCanvas().width).toBe(1280)
      expect(compositor.getCanvas().height).toBe(720)
    })

    it('caps a 4K source to the same 1280px width', () => {
      const compositor = new Compositor(3840, 2160)
      expect(compositor.getCanvas().width).toBe(1280)
      expect(compositor.getCanvas().height).toBe(720)
    })

    it('leaves a source at or below the cap untouched', () => {
      const compositor = new Compositor(800, 600)
      expect(compositor.getCanvas().width).toBe(800)
      expect(compositor.getCanvas().height).toBe(600)
    })

    it('throws when the browser gives back no 2D context', () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
      expect(() => new Compositor(1280, 720)).toThrow('Failed to get 2D context')
    })
  })

  describe('start / stop lifecycle', () => {
    it('returns null from getOutputStream() before start()', () => {
      const compositor = new Compositor(1280, 720)
      expect(compositor.getOutputStream()).toBeNull()
    })

    it('captures the canvas at the requested frame rate and exposes that stream', () => {
      const compositor = new Compositor(1280, 720)
      const stream = compositor.start(24)

      const captured = getCapturedCanvasStreams()
      expect(captured).toHaveLength(1)
      expect(captured[0].canvas).toBe(compositor.getCanvas())
      expect(captured[0].frameRate).toBe(24)
      expect(compositor.getOutputStream()).toBe(stream)
      expect(stream.getVideoTracks()).toHaveLength(1)

      compositor.stop()
    })

    it('stops the render loop so nothing is drawn after stop()', () => {
      const compositor = new Compositor(1280, 720)
      compositor.start(30)
      expect(pendingFrameCount()).toBe(1)

      compositor.stop()

      expect(pendingFrameCount()).toBe(0)
      expect(compositor.getOutputStream()).toBeNull()

      const drawsAfterStop = tickAnimationFrames()
      expect(drawsAfterStop).toBe(0)
    })

    it('is safe to stop twice and to stop without starting', () => {
      const compositor = new Compositor(1280, 720)
      expect(() => compositor.stop()).not.toThrow()
      compositor.start(30)
      compositor.stop()
      expect(() => compositor.stop()).not.toThrow()
      expect(compositor.getOutputStream()).toBeNull()
    })

    it('dispose() tears down the same way stop() does', () => {
      const compositor = new Compositor(1280, 720)
      compositor.start(30)
      attachScreen(compositor)

      compositor.dispose()

      expect(pendingFrameCount()).toBe(0)
      expect(compositor.getOutputStream()).toBeNull()
      expect(document.body.querySelector('video')).toBeNull()
    })
  })

  describe('render loop throttling', () => {
    it('skips frames that arrive faster than the target frame rate', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)

      // start() renders immediately; performance.now() is far past lastFrameTime.
      compositor.start(30)
      const drawsAfterStart = ctx.calls.filter(c => c.method === 'fillRect').length
      expect(drawsAfterStart).toBe(1)

      // 10ms later — inside the 33.3ms budget for 30fps — nothing is drawn.
      now += 10
      tickAnimationFrames()
      expect(ctx.calls.filter(c => c.method === 'fillRect')).toHaveLength(1)

      // 40ms after the last drawn frame, the budget has elapsed.
      now += 30
      tickAnimationFrames()
      expect(ctx.calls.filter(c => c.method === 'fillRect')).toHaveLength(2)

      compositor.stop()
    })

    it('honours a lower target frame rate', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)

      compositor.start(10) // 100ms budget
      expect(ctx.calls.filter(c => c.method === 'fillRect')).toHaveLength(1)

      now += 50
      tickAnimationFrames()
      expect(ctx.calls.filter(c => c.method === 'fillRect')).toHaveLength(1)

      now += 60
      tickAnimationFrames()
      expect(ctx.calls.filter(c => c.method === 'fillRect')).toHaveLength(2)

      compositor.stop()
    })

    it('keeps rescheduling itself while running', () => {
      const compositor = new Compositor(1280, 720)
      compositor.start(30)

      for (let i = 0; i < 3; i++) {
        now += 40
        expect(tickAnimationFrames()).toBe(1)
      }
      expect(pendingFrameCount()).toBe(1)

      compositor.stop()
    })
  })

  describe('drawing the screen layer', () => {
    it('clears to black before drawing anything', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)

      compositor.start(30)

      expect(ctx.fillStyle).toBe('#000')
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720)
      compositor.stop()
    })

    it('does not draw a screen video that has no frame yet (readyState < 2)', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      compositor.setScreenStream(new MediaStream())
      getLastVideoDouble()!.setMetadata({ readyState: 1 })

      compositor.start(30)

      expect(ctx.drawImage).not.toHaveBeenCalled()
      compositor.stop()
    })

    it('stretches the screen video across the whole canvas once it has data', () => {
      const compositor = new Compositor(1920, 1080)
      const ctx = ctxOf(compositor)
      const screen = attachScreen(compositor)

      compositor.start(30)

      expect(ctx.drawImage).toHaveBeenCalledWith(screen.element, 0, 0, 1280, 720)
      compositor.stop()
    })

    it('replaces the previous screen video when a new stream is set', () => {
      const compositor = new Compositor(1280, 720)
      const first = attachScreen(compositor)
      expect(document.body.contains(first.element)).toBe(true)

      const second = attachScreen(compositor)

      expect(first.element.srcObject).toBeNull()
      expect(document.body.contains(first.element)).toBe(false)
      expect(document.body.contains(second.element)).toBe(true)
      expect(second.play).toHaveBeenCalled()

      compositor.stop()
    })
  })

  describe('webcam overlay', () => {
    it.each([
      ['top-left', 20, 20],
      ['top-right', 1280 - 256 - 20, 20],
      ['bottom-left', 20, 720 - 144 - 20],
      ['bottom-right', 1280 - 256 - 20, 720 - 144 - 20],
    ] as const)('positions a %s rectangular overlay at (%i, %i)', (webcamPosition, x, y) => {
      const compositor = new Compositor(1280, 720, {
        webcamPosition,
        webcamShape: 'rectangle',
        webcamSize: 0.2,
        padding: 20,
      })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)

      // 256 = 1280 * 0.2, 144 = 256 * 9/16
      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, x, y, 256, 144)
      expect(ctx.roundRect).toHaveBeenCalledWith(x, y, 256, 144, 8)
      compositor.stop()
    })

    it('clips the rectangular overlay before drawing it and strokes the border after', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'rectangle' })
      const ctx = ctxOf(compositor)
      attachWebcam(compositor)

      compositor.start(30)

      const order = methodsOf(ctx)
      const clip = order.indexOf('clip')
      const draw = order.lastIndexOf('drawImage')
      const stroke = order.indexOf('stroke')
      expect(clip).toBeGreaterThan(-1)
      expect(clip).toBeLessThan(draw)
      expect(draw).toBeLessThan(stroke)
      expect(ctx.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
      expect(ctx.lineWidth).toBe(3)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      compositor.stop()
    })

    it('centre-crops a landscape webcam into the circular overlay', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'circle', webcamSize: 0.2, padding: 20 })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor, { videoWidth: 640, videoHeight: 480 })

      compositor.start(30)

      // radius = min(256,144)/2 = 72; centre = (1004+128, 556+72)
      expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
      // landscape source is cropped to a 480x480 square, horizontally centred
      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, 80, 0, 480, 480, 1060, 556, 144, 144)
      compositor.stop()
    })

    it('centre-crops a portrait webcam into the circular overlay', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'circle', webcamSize: 0.2, padding: 20 })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor, { videoWidth: 480, videoHeight: 640 })

      compositor.start(30)

      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, 0, 80, 480, 480, 1060, 556, 144, 144)
      compositor.stop()
    })

    it('scales the overlay with webcamSize', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'rectangle', webcamSize: 0.4, padding: 10 })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)

      // 512 = 1280 * 0.4, 288 = 512 * 9/16
      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, 1280 - 512 - 10, 720 - 288 - 10, 512, 288)
      compositor.stop()
    })

    it('honours a zero padding, drawing the overlay flush against the edge', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'rectangle', webcamSize: 0.4, padding: 0 })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)

      // bottom-right with no padding sits exactly on the canvas edge
      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, 1280 - 512, 720 - 288, 512, 288)
      compositor.stop()
    })

    it('draws a zero-padded top-left overlay at the canvas origin', () => {
      const compositor = new Compositor(1280, 720, {
        webcamShape: 'rectangle',
        webcamPosition: 'top-left',
        padding: 0,
      })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)

      expect(ctx.drawImage).toHaveBeenCalledWith(webcam.element, 0, 0, 256, 144)
      expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 256, 144, 8)
      compositor.stop()
    })

    it('honours a zero padding applied through updateConfig()', () => {
      const compositor = new Compositor(1280, 720, {
        webcamShape: 'rectangle',
        webcamPosition: 'top-left',
        padding: 20,
      })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)
      expect(ctx.drawImage).toHaveBeenLastCalledWith(webcam.element, 20, 20, 256, 144)

      compositor.updateConfig({ padding: 0 })
      now += 40
      tickAnimationFrames()

      expect(ctx.drawImage).toHaveBeenLastCalledWith(webcam.element, 0, 0, 256, 144)
      compositor.stop()
    })

    it('defaults to a 20%, circular, bottom-right overlay', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      attachWebcam(compositor)

      compositor.start(30)

      expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
      compositor.stop()
    })

    it('applies updateConfig() to the next rendered frame', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'rectangle', padding: 20 })
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)
      expect(ctx.drawImage).toHaveBeenLastCalledWith(webcam.element, 1004, 556, 256, 144)

      compositor.updateConfig({ webcamPosition: 'top-left' })
      now += 40
      tickAnimationFrames()

      expect(ctx.drawImage).toHaveBeenLastCalledWith(webcam.element, 20, 20, 256, 144)
      compositor.stop()
    })

    it('does not draw a webcam that has no frame yet', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      compositor.setWebcamStream(new MediaStream())
      getLastVideoDouble()!.setMetadata({ readyState: 0 })

      compositor.start(30)

      expect(ctx.drawImage).not.toHaveBeenCalled()
      expect(ctx.arc).not.toHaveBeenCalled()
      compositor.stop()
    })

    it('removes the webcam element when the stream is cleared', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      const webcam = attachWebcam(compositor)

      compositor.setWebcamStream(null)

      expect(webcam.element.srcObject).toBeNull()
      expect(document.body.contains(webcam.element)).toBe(false)
      expect(getVideoDoubles()).toHaveLength(1)

      compositor.start(30)
      expect(ctx.drawImage).not.toHaveBeenCalled()
      compositor.stop()
    })

    it('draws the screen first and the overlay on top', () => {
      const compositor = new Compositor(1280, 720, { webcamShape: 'rectangle' })
      const ctx = ctxOf(compositor)
      const screen = attachScreen(compositor)
      const webcam = attachWebcam(compositor)

      compositor.start(30)

      const drawTargets = ctx.calls.filter(c => c.method === 'drawImage').map(c => c.args[0])
      expect(drawTargets).toEqual([screen.element, webcam.element])
      compositor.stop()
    })
  })

  it('detaches both hidden video elements from the DOM on stop()', () => {
    const compositor = new Compositor(1280, 720)
    const screen = attachScreen(compositor)
    const webcam = attachWebcam(compositor)
    compositor.start(30)

    compositor.stop()

    expect(document.body.contains(screen.element)).toBe(false)
    expect(document.body.contains(webcam.element)).toBe(false)
    expect(screen.element.srcObject).toBeNull()
    expect(webcam.element.srcObject).toBeNull()
  })
})
