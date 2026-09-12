// Per-second and per-frame work ceilings for the PiP compositor.
//
// The compositor is the one thing in ESCAPECRAFT that runs on every animation
// frame for the whole length of a recording, on whatever machine the user has.
// Two properties keep it cheap, and both are asserted here rather than assumed:
// it draws at its target frame rate no matter how often the browser offers it a
// frame, and one composited frame is a fixed, small number of canvas calls.
//
// Measured through the same doubles the compositor's behaviour tests use, with
// a hand-driven rAF and a scripted `performance.now()`, so the numbers are
// exact counts and do not depend on the runner's speed. Ceilings are 2x the
// measured value rounded up, with the measurement and its date beside them;
// "at most the target frame rate" is exact, because it is the throttle's whole
// job.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Compositor } from './compositor'
import {
  getCanvasContext,
  installCanvasCaptureStreamDouble,
  uninstallCanvasCaptureStreamDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
} from '../test/doubles/video'
import { installRafDouble, type RafDouble } from '../test/doubles/raf'

/** A browser offering frames at 60Hz. */
const RAF_INTERVAL_MS = 1000 / 60
const TICKS_PER_SECOND = 60
/** What the compositor is asked to produce — captureStream() runs at this rate. */
const TARGET_FPS = 30

let raf: RafDouble
let now = 0

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

function ctxOf(compositor: Compositor): RecordingCanvasRenderingContext2D {
  const ctx = getCanvasContext(compositor.getCanvas())
  if (!ctx) throw new Error('compositor canvas has no recording context')
  return ctx
}

/** A screen share and a webcam, both with a frame ready to draw. */
function attachPictureInPicture(compositor: Compositor): void {
  compositor.setScreenStream(new MediaStream())
  getLastVideoDouble()!.setMetadata({ readyState: 4, videoWidth: 1920, videoHeight: 1080 })
  compositor.setWebcamStream(new MediaStream())
  getLastVideoDouble()!.setMetadata({ readyState: 4, videoWidth: 640, videoHeight: 480 })
}

/** Offer the compositor a second's worth of 60Hz animation frames. */
function playOneSecond(): void {
  for (let tick = 0; tick < TICKS_PER_SECOND; tick++) {
    now += RAF_INTERVAL_MS
    raf.tick()
  }
}

/** Composited frames in the recording: each one clears the canvas first. */
function drawnFrames(ctx: RecordingCanvasRenderingContext2D): number {
  return ctx.calls.filter((c) => c.method === 'fillRect').length
}

describe('compositor per-second work', () => {
  it('never draws more often than the target frame rate', () => {
    const compositor = new Compositor(1920, 1080)
    const ctx = ctxOf(compositor)
    attachPictureInPicture(compositor)

    // start() draws once immediately, then the loop takes over.
    compositor.start(TARGET_FPS)
    playOneSecond()
    compositor.stop()

    // Exact: 60 offered frames, 30 drawn ones plus the one start() paints
    // immediately. Half of what the browser offered was dropped by the
    // throttle, which is its whole point — captureStream() samples the canvas
    // 30 times a second, so drawing 60 would be half the work thrown away.
    expect(drawnFrames(ctx)).toBe(TARGET_FPS + 1)
  })

  it('stops drawing the moment it is stopped', () => {
    const compositor = new Compositor(1920, 1080)
    const ctx = ctxOf(compositor)
    attachPictureInPicture(compositor)

    compositor.start(TARGET_FPS)
    playOneSecond()
    const drawnWhileRunning = drawnFrames(ctx)

    compositor.stop()
    playOneSecond()

    // Exact: a stopped compositor costs nothing at all — no draw, and nothing
    // left scheduled to draw later.
    expect(drawnFrames(ctx)).toBe(drawnWhileRunning)
    expect(raf.pending()).toBe(0)
  })

  it('composites a picture-in-picture frame within its per-frame ceilings', () => {
    const compositor = new Compositor(1920, 1080)
    const ctx = ctxOf(compositor)
    attachPictureInPicture(compositor)

    compositor.start(TARGET_FPS)
    const firstFrame = [...ctx.calls]
    compositor.stop()

    const count = (method: string) => firstFrame.filter((c) => c.method === method).length

    // Measured 2026-09-12: 13 calls — clear, screen draw, then save, the
    // circular clip path, the webcam draw, restore, and the border stroke.
    expect(firstFrame.length).toBeLessThanOrEqual(26)
    expect(count('drawImage')).toBeLessThanOrEqual(4)
    // Exact: one clear per frame, not one per layer.
    expect(count('fillRect')).toBe(1)
    // Exact: `drawWebcamOverlay` saves once and restores once. It used to
    // restore twice — once before stroking the border, once more on the way
    // out — so every PiP frame popped a state stack it never pushed. On a real
    // canvas an unbalanced restore() is a no-op, which is why nothing looked
    // wrong, but it was a stack operation per frame for nothing and it would
    // silently undo a save() made by any future caller that wrapped the
    // overlay draw.
    expect(count('save')).toBe(1)
    expect(count('restore')).toBe(count('save'))
  })
})
