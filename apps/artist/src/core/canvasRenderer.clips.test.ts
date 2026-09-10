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
import { clearAnimationCache } from '../utils/animation'
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { VideoFrameDouble, resetFrameRegistry } from '../test/doubles/webcodecs'
import { makeClip } from '../test/fixtures/exportPipeline'
import type { Clip } from '../store/types'
import type { DrawableMediaSource, TransitionModifiers } from './exportTypes'

const W = 1920
const H = 1080

let ctx: RecordingCanvasRenderingContext2D
let media: MediaDoubles

const asCtx = () => ctx as unknown as CanvasRenderingContext2D

beforeEach(() => {
  clearAnimationCache()
  resetFrameRegistry()
  ctx = createRecordingContext()
  media = installMediaElementDoubles()
})

afterEach(() => {
  media.uninstall()
  clearAnimationCache()
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
