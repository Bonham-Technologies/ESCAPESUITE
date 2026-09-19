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
import { installRafDouble, type RafDouble } from '../test/doubles/raf'

// The render loop reschedules itself on every tick, so cancelAnimationFrame
// has to genuinely clear the pending callback — a no-op cancel would leave the
// loop drawing into a torn-down environment after the test that started it.
// That is what the shared rAF double gives us.
let raf: RafDouble

const tickAnimationFrames = (): number => raf.tick()
const pendingFrameCount = (): number => raf.pending()

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
    raf = installRafDouble()
    installVideoElementDouble()
    installCanvasCaptureStreamDouble()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    uninstallCanvasCaptureStreamDouble()
    uninstallVideoElementDouble()
    raf.uninstall()
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

    // ESCSUITE-54. The gate used to be `now - lastFrameTime < 1000 / 30` with
    // `lastFrameTime` snapped to the drawing tick's own clock. `1000 / 30` is
    // bit-for-bit `2 * (1000 / 60)`, so two 60Hz ticks clear it with *zero*
    // margin: a pair that measures a nanosecond short waits for a third tick,
    // and the miss is charged forward because the deadline moves with the late
    // draw. Real takes composited 22.4-22.8 fps against a 30 fps target.
    //
    // A ±0.5 ms alternation does not reproduce it — every adjacent pair of an
    // alternating jitter sums back to exactly two ideal ticks — so the jitter
    // below runs on a three-tick cycle instead. Its mean is exactly 1000 / 60,
    // no delta is more than 1 ms off ideal, and no two consecutive deltas sum
    // to 1000 / 30.
    const RAF_INTERVAL_MS = 1000 / 60
    const JITTER_CYCLE_MS = [RAF_INTERVAL_MS - 0.5, RAF_INTERVAL_MS + 1, RAF_INTERVAL_MS - 0.5]

    it('still draws 30 frames a second when 60Hz ticks jitter around the ideal interval', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      const draws = () => ctx.calls.filter(c => c.method === 'fillRect').length

      compositor.start(30)
      expect(draws()).toBe(1)

      for (let tick = 0; tick < 60; tick++) {
        now += JITTER_CYCLE_MS[tick % JITTER_CYCLE_MS.length]
        tickAnimationFrames()
      }

      // One second of jittered 60Hz frames is 30 composited ones, on top of
      // the frame start() paints immediately. The old gate drew 20.
      expect(draws()).toBe(1 + 30)

      compositor.stop()
    })

    it('never draws on two consecutive ticks', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      const draws = () => ctx.calls.filter(c => c.method === 'fillRect').length

      compositor.start(30)
      let drawn = draws()
      // start() drew on the tick before the loop's first.
      let drewLastTick = true

      for (let tick = 0; tick < 60; tick++) {
        now += RAF_INTERVAL_MS
        tickAnimationFrames()
        const drewThisTick = draws() > drawn
        // The tolerance that absorbs jitter must not be wide enough to let a
        // tick run a frame that is a whole tick away from being due.
        expect(drewThisTick && drewLastTick).toBe(false)
        drawn = draws()
        drewLastTick = drewThisTick
      }

      compositor.stop()
    })

    it('resyncs after a stall instead of bursting to catch up', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      const draws = () => ctx.calls.filter(c => c.method === 'fillRect').length

      compositor.start(30)
      expect(draws()).toBe(1)

      // A hidden tab, or a long GC pause: no animation frame for half a second.
      now += 500
      tickAnimationFrames()
      expect(draws()).toBe(2)

      // The fifteen frames that stall "owed" are never drawn: advancing the
      // deadline by one interval at a time would burst here, so a gap longer
      // than a frame resyncs the schedule to now instead. The loop goes
      // straight back to one draw every other tick.
      const expectedAfterStall = [2, 3, 3, 4, 4, 5]
      for (const expected of expectedAfterStall) {
        now += RAF_INTERVAL_MS
        tickAnimationFrames()
        expect(draws()).toBe(expected)
      }

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

    it('defaults to a 20%, circular, bottom-right overlay', () => {
      const compositor = new Compositor(1280, 720)
      const ctx = ctxOf(compositor)
      attachWebcam(compositor)

      compositor.start(30)

      expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
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
