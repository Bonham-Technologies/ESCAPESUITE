// The crop chrome, drawn straight onto a recording canvas (ESCSUITE-157).
//
// Two halves: `cropTarget`, which is the one answer to "is crop mode on, and on
// what", and `drawCropOverlay`, which dims everything outside the kept region.
// The numbers are built from the clip's own box rather than pasted in, and the
// call counts at the end are conservation laws — the crop chrome is not a
// per-frame path, so what it costs is pinned here instead of in a
// `*.perf.test.ts` file (see the plan's constraint 6).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CROP_DIM_ALPHA,
  CROP_FRAME_COLOR,
  CROP_HANDLE_MODES,
  CROP_VEIL_FILL,
  cropFrameBox,
  cropTarget,
  drawCropOverlay,
  fullSourceBox,
  visibleCropTarget,
  type CropOverlayScene,
} from './cropOverlay'
import { contentBox } from './previewGeometry'
import { CROP_HANDLES } from '../../core/cropDrag'
import { makeClip, makeSourceVideo } from '../../test/fixtures/clipFixtures'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { Clip, SourceVideo } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

/** A 400x200 source centred on the canvas: the kept region is 400x200 at scale 1. */
const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })

let canvas: HTMLCanvasElement
let ctx: RecordingCanvasRenderingContext2D

beforeEach(() => {
  installCanvasDouble()
  canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  canvas.getContext('2d')
  ctx = getCanvasContext(canvas)!
})

afterEach(() => {
  uninstallCanvasDouble()
})

const mediaClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({ id: 'clip1', duration: 4, ...overrides })

function scene(overrides: Partial<CropOverlayScene> = {}): CropOverlayScene {
  return {
    clips: [mediaClip()],
    sourceVideos: [source],
    cropClipId: 'clip1',
    selectedClipId: 'clip1',
    isPlaying: false,
    ...overrides,
  }
}

/** An element the dim pass can draw: its identity is all the double records. */
const element = document.createElement('video')

describe('cropTarget', () => {
  it('resolves the clip and its source when crop mode is on', () => {
    expect(cropTarget(scene())).toEqual({ clip: mediaClip(), source })
  })

  it('is null with crop mode off', () => {
    expect(cropTarget(scene({ cropClipId: null }))).toBeNull()
  })

  it('is null while the latch names anything but the selected clip', () => {
    // Nothing clears the latch, so this is how every selection change, delete,
    // project load and undo leaves crop mode (ESCSUITE-157).
    expect(cropTarget(scene({ selectedClipId: 'clip2' }))).toBeNull()
  })

  it('is null during playback', () => {
    expect(cropTarget(scene({ isPlaying: true }))).toBeNull()
  })

  it('is null for a latch naming a clip that has left the timeline', () => {
    expect(cropTarget(scene({ clips: [] }))).toBeNull()
  })

  it('is null for a clip whose source is not in the library — an overlay included', () => {
    // An overlay carries sourceVideoId: '', so it fails this lookup and needs no
    // condition of its own.
    expect(cropTarget(scene({ sourceVideos: [] }))).toBeNull()
    expect(
      cropTarget(scene({ clips: [mediaClip({ overlayType: 'text', sourceVideoId: '' })] }))
    ).toBeNull()
  })
})

describe('visibleCropTarget', () => {
  // The one answer both layers gate from: the chrome below AND `PreviewPlayer`'s
  // decision to mount the eight DOM handles. `cropTarget` knows nothing about
  // time, so before this existed the handles outlived the chrome — eight live,
  // draggable buttons over a frame the cropped clip is not even in.
  it('is the target while the playhead is inside the clip', () => {
    expect(visibleCropTarget(scene(), 1)).toEqual({ clip: mediaClip(), source })
  })

  it('is null once the playhead has left the clip', () => {
    // The clip spans 0-4, and its end is exclusive, exactly as the chrome's own
    // guard and `selectionOverlay`'s have always been.
    expect(visibleCropTarget(scene(), 4)).toBeNull()
    expect(visibleCropTarget(scene(), 9)).toBeNull()
  })

  it('is null before the clip starts', () => {
    expect(
      visibleCropTarget(scene({ clips: [mediaClip({ timelinePosition: 4 })] }), 1)
    ).toBeNull()
  })

  it('is null for every reason `cropTarget` is', () => {
    // It is `cropTarget` plus the window, not a second copy of it.
    expect(visibleCropTarget(scene({ cropClipId: null }), 1)).toBeNull()
    expect(visibleCropTarget(scene({ isPlaying: true }), 1)).toBeNull()
    expect(visibleCropTarget(scene({ sourceVideos: [] }), 1)).toBeNull()
  })
})

describe('fullSourceBox', () => {
  const bounds = { centerX: 960, centerY: 540, width: 300, height: 200, rotation: 0 }

  it('is the kept region itself when the clip has no crop', () => {
    // 400x200 source, kept region 400x200 — so the full box is the kept box,
    // offset to the centre the chrome has already translated to.
    expect(
      fullSourceBox(
        { ...bounds, width: 400, height: 200 },
        undefined,
        { width: 400, height: 200 }
      )
    ).toEqual({ x: -200, y: -100, width: 400, height: 200 })
  })

  it('reaches out past the kept region by the part the crop hides', () => {
    // 25% off the left of a 400px source is 100 source pixels; the kept region
    // is 300 wide and drawn 300 wide, so the scale is 1 and the full box starts
    // 100px left of the kept box's own left edge (-150).
    expect(fullSourceBox(bounds, { left: 0.25, top: 0, right: 0, bottom: 0 }, {
      width: 400,
      height: 200,
    })).toEqual({ x: -250, y: -100, width: 400, height: 200 })
  })

  it('takes the clip\'s scale from the bounds it is given', () => {
    // The same crop drawn at 2x: everything doubles, including the reach.
    expect(
      fullSourceBox({ ...bounds, width: 600, height: 400 }, {
        left: 0.25,
        top: 0,
        right: 0,
        bottom: 0,
      }, { width: 400, height: 200 })
    ).toEqual({ x: -500, y: -200, width: 800, height: 400 })
  })
})

describe('cropFrameBox', () => {
  it('maps the kept region into the element\'s own CSS pixels', () => {
    // 960x540 box over a 1920x1080 project: half size, nothing letterboxed.
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })
    const content = contentBox(canvas, canvas.getBoundingClientRect(), {
      width: CANVAS_W,
      height: CANVAS_H,
    })

    expect(
      cropFrameBox({ centerX: 960, centerY: 540, width: 400, height: 200, rotation: 30 }, content)
    ).toEqual({ left: 380, top: 220, width: 200, height: 100, rotation: 30 })
  })

  it('carries the letterbox offset', () => {
    // 960x600 box: 960x540 of content with 30px of letterbox above it.
    setRect(canvas, { left: 0, top: 0, width: 960, height: 600 })
    const content = contentBox(canvas, canvas.getBoundingClientRect(), {
      width: CANVAS_W,
      height: CANVAS_H,
    })

    expect(
      cropFrameBox({ centerX: 960, centerY: 540, width: 400, height: 200, rotation: 0 }, content)
    ).toMatchObject({ left: 380, top: 250 })
  })
})

describe('drawCropOverlay', () => {
  it('dims the whole source outside the kept region, in one drawImage', () => {
    drawCropOverlay(canvas, 1, scene({ clips: [mediaClip({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } })] }), element)

    const [args] = ctx.argsFor('drawImage')
    // The kept region is 300x200 at scale 1, so the full source is drawn 400
    // wide starting 100px left of the kept box's left edge.
    expect(args).toEqual([element, -250, -100, 400, 200])
    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBe(CROP_DIM_ALPHA)
  })

  it('punches the kept region out of it, so the frame\'s own picture stays bright', () => {
    // A CROPPED scene, so the two rectangles differ and the even-odd region is
    // a real ring: the full source reaches 100px further left (25% of 400) than
    // the 300-wide kept box, and the dim covers exactly that strip.
    drawCropOverlay(
      canvas,
      1,
      scene({ clips: [mediaClip({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } })] }),
      element
    )

    const rects = ctx.argsFor('rect')
    expect(rects).toEqual([
      [-250, -100, 400, 200],
      [-150, -100, 300, 200],
    ])
    expect(rects[0]).not.toEqual(rects[1])
    expect(ctx.argsFor('clip')).toEqual([['evenodd']])
  })

  it('draws the degenerate ring for a clip with no crop, and still clips evenodd', () => {
    // No crop at all: the full source box IS the kept box, so the even-odd
    // region is empty and the paint dims nothing. The call shape is the same
    // either way — the chrome has no "is there anything to dim" branch, because
    // crop mode is worth entering on an uncropped clip.
    drawCropOverlay(canvas, 1, scene(), element)

    expect(ctx.argsFor('rect')).toEqual([
      [-200, -100, 400, 200],
      [-200, -100, 400, 200],
    ])
    expect(ctx.argsFor('clip')).toEqual([['evenodd']])
  })

  it('strokes the kept region\'s edge at a constant size on screen', () => {
    drawCropOverlay(canvas, 1, scene(), element, canvas, 4)

    expect(ctx.argsFor('strokeRect')).toEqual([[-200, -100, 400, 200]])
    expect(ctx.stateFor('strokeRect')[0].strokeStyle).toBe(CROP_FRAME_COLOR)
    expect(ctx.stateFor('strokeRect')[0].lineWidth).toBe(4)
  })

  it('rotates with the clip', () => {
    drawCropOverlay(
      canvas,
      1,
      scene({ clips: [mediaClip({ transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 } })] }),
      element
    )

    expect(ctx.argsFor('translate')).toEqual([[960, 540]])
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('veils the ring instead when the media element is not loaded yet', () => {
    drawCropOverlay(canvas, 1, scene(), undefined)

    expect(ctx.argsFor('drawImage')).toEqual([])
    expect(ctx.argsFor('fillRect')).toEqual([[-200, -100, 400, 200]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe(CROP_VEIL_FILL)
  })

  it('draws nothing at all with crop mode off', () => {
    drawCropOverlay(canvas, 1, scene({ cropClipId: null }), element)

    expect(ctx.calls).toEqual([])
  })

  it('draws nothing while the clip is off screen at this time', () => {
    drawCropOverlay(canvas, 9, scene(), element)

    expect(ctx.calls).toEqual([])
  })

  it('draws nothing before the clip starts either', () => {
    // The other side of the same guard: a clip that has not begun yet, rather
    // than one that has ended.
    drawCropOverlay(canvas, 1, scene({ clips: [mediaClip({ timelinePosition: 4 })] }), element)

    expect(ctx.calls).toEqual([])
  })

  it('draws nothing on a canvas with no 2D context', () => {
    const el = document.createElement('canvas')
    el.width = CANVAS_W
    el.height = CANVAS_H
    failNextGetContext()

    expect(() => drawCropOverlay(el, 1, scene(), element)).not.toThrow()
  })

  it('draws nothing for a clip `getOverlayBounds` will not measure', () => {
    // An overlay kind with no data for it, on a source that IS in the library:
    // not a shape the app produces, but the chrome must never draw a rectangle
    // `getOverlayBounds` would not vouch for, and this is the one way to ask it
    // for a box and be told no.
    drawCropOverlay(
      canvas,
      1,
      scene({ clips: [mediaClip({ overlayType: 'text' })] }),
      element
    )

    expect(ctx.argsFor('drawImage')).toEqual([])
    expect(ctx.argsFor('strokeRect')).toEqual([])
  })

  it('costs exactly one dim, one clip and one stroke, with its state put back', () => {
    drawCropOverlay(canvas, 1, scene(), element)

    const count = (method: string) => ctx.calls.filter((c) => c.method === method).length
    expect(count('drawImage')).toBe(1)
    expect(count('clip')).toBe(1)
    expect(count('translate')).toBe(1)
    expect(count('rotate')).toBe(1)
    expect(count('save')).toBe(count('restore'))
    expect(ctx.globalAlpha).toBe(1)
  })
})

describe('CROP_HANDLE_MODES', () => {
  it('names a resize mode for every handle, so the cursors come from one table', () => {
    for (const handle of CROP_HANDLES) {
      expect(CROP_HANDLE_MODES[handle]).toBe(`resize-${handle}`)
    }
  })
})
