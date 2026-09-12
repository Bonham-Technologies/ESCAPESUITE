// What size the preview actually rasterises at, and what that does to the maths.
//
// The preview's backing store follows the element's displayed size rather than
// the project resolution, so a 4K project no longer paints 8.3 megapixels into
// a 380 px box. Everything the preview computes — where a clip's box is, what
// the pointer is over, where the inline editor goes — stays in *project* space,
// and one scale transform per frame carries it onto the smaller raster.
//
// These tests pin both halves: the raster size itself (a pure function of the
// box, the project and the device pixel ratio), and the fact that the scene
// maths is untouched by it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { previewRaster } from './previewGeometry'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  DEFAULT_RECT,
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type Preview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { ShapeOverlayData } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

/** The default project, and the box every preview test lays it out in. */
const PROJECT = { width: 1920, height: 1080 }

describe('previewRaster', () => {
  it('rasterises at the displayed size in device pixels', () => {
    expect(previewRaster(PROJECT, { width: 960, height: 540 }, 1)).toEqual({
      width: 960,
      height: 540,
      scale: 0.5,
    })
  })

  it('multiplies the box by the device pixel ratio', () => {
    expect(previewRaster(PROJECT, { width: 600, height: 400 }, 2)).toEqual({
      width: 1200,
      height: 675,
      scale: 0.625,
    })
  })

  it('fits inside a box that is taller than the project, as object-fit does', () => {
    // 480 x 540 is narrower than 16:9, so the width is what runs out first and
    // the raster is letterboxed top and bottom exactly as the CSS box shows it.
    expect(previewRaster(PROJECT, { width: 480, height: 540 }, 1)).toEqual({
      width: 480,
      height: 270,
      scale: 0.25,
    })
  })

  it('fits inside a box that is wider than the project', () => {
    expect(previewRaster(PROJECT, { width: 1920, height: 270 }, 1)).toEqual({
      width: 480,
      height: 270,
      scale: 0.25,
    })
  })

  it('never rasterises larger than the project', () => {
    // A small project in a big box on a retina screen: CSS still scales it up,
    // and drawing more pixels than the project has would be both slower than
    // today and sharper than the project — a different picture, not the same one.
    expect(previewRaster({ width: 640, height: 360 }, { width: 1280, height: 720 }, 2)).toEqual({
      width: 640,
      height: 360,
      scale: 1,
    })
  })

  it('falls back to the project size until the box is known', () => {
    expect(previewRaster(PROJECT, null, 2)).toEqual({ width: 1920, height: 1080, scale: 1 })
    expect(previewRaster(PROJECT, { width: 0, height: 0 }, 1)).toEqual({
      width: 1920,
      height: 1080,
      scale: 1,
    })
  })
})

describe('PreviewPlayer raster', () => {
  let doubles: PreviewDoubles

  beforeEach(() => {
    vi.useFakeTimers()
    doubles = installPreviewDoubles()
    resetStoreForTest()
    resetFrameCache()
  })

  afterEach(() => {
    doubles.uninstall()
    resetFrameCache()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const addShape = (data: Partial<ShapeOverlayData> = {}) =>
    store().addShapeOverlayClip(data, undefined, 0, 4)

  /** The box the harness lays the canvas out in, delivered as a resize. */
  const DISPLAY_BOX = { width: DEFAULT_RECT.width!, height: DEFAULT_RECT.height! }

  it('draws at the project size until it knows how big it is displayed', async () => {
    addShape()
    const preview = await renderPreview()

    expect(preview.canvas.width).toBe(1920)
    expect(preview.canvas.height).toBe(1080)
    expect(preview.frame().argsFor('setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('sizes its backing store to the displayed box', async () => {
    addShape()
    const preview = await renderPreview()

    preview.resize(DISPLAY_BOX)

    expect(preview.canvas.width).toBe(960)
    expect(preview.canvas.height).toBe(540)
  })

  it('sizes its backing store in device pixels', async () => {
    addShape()
    const preview = await renderPreview({ dpr: 2 })

    preview.resize({ width: 600, height: 400 })

    expect(preview.canvas.width).toBe(1200)
    expect(preview.canvas.height).toBe(675)
  })

  it('scales each frame onto the raster and draws it in project space', async () => {
    addShape()
    const preview = await renderPreview()
    preview.resize(DISPLAY_BOX)

    preview.clearCalls()
    store().setCurrentTime(1)
    await settle(FRAME_MS)

    const frame = preview.frame()
    // One transform per frame, and it is the raster scale.
    expect(frame.argsFor('setTransform')[0]).toEqual([0.5, 0, 0, 0.5, 0, 0])
    // Everything drawn under it is still measured in project pixels.
    expect(frame.argsFor('fillRect')[0]).toEqual([0, 0, 1920, 1080])
  })

  it('re-sizes and redraws once when the element is resized', async () => {
    addShape()
    const preview = await renderPreview()
    preview.resize(DISPLAY_BOX)

    preview.clearCalls()
    preview.resize({ width: 480, height: 270 })

    expect(preview.canvas.width).toBe(480)
    expect(preview.canvas.height).toBe(270)
    expect(preview.frames()).toHaveLength(1)
    expect(preview.frame().argsFor('setTransform')[0]).toEqual([0.25, 0, 0, 0.25, 0, 0])
    expect(preview.frame().argsFor('fillRect')[0]).toEqual([0, 0, 1920, 1080])
  })

  it('asks for a blur in the device pixels the project blur covers', async () => {
    // `ctx.filter` lengths are output-bitmap pixels and the current transform
    // does not touch them, so a blur shape's 10 project px on a half-size
    // raster has to be asked for as 5 — or the editor would blur harder than
    // the file it exports.
    addShape({ type: 'blur' })
    const preview = await renderPreview()

    preview.clearCalls()
    preview.resize(DISPLAY_BOX)

    const captured = preview.frame().of('drawImage')
    expect(captured[captured.length - 1].state.filter).toBe('blur(5px)')
  })

  it('draws a cached frame at the project size, under the raster transform', async () => {
    addShape()
    const preview = await renderPreview()
    preview.resize(DISPLAY_BOX)
    const bitmap = { width: 960, height: 540, close: vi.fn() } as unknown as ImageBitmap
    const { getFrameCache } = await import('../../core/frameCache')
    getFrameCache().set(0, bitmap)

    // Renaming a track re-runs the redraw effects without changing anything
    // the cache key covers; the debounced redraw 50ms later finds the frame
    // still cached and serves it.
    store().updateTrack(store().project.timeline.tracks[0].id, { name: 'Renamed' })
    await settle()
    preview.clearCalls()
    await settle(60)

    // The cached bitmap, then the selected shape's handles over it — no
    // recomposition of the frame itself.
    expect(preview.methods().slice(0, 2)).toEqual(['setTransform', 'drawImage'])
    expect(preview.calls('drawImage')[0].args).toEqual([bitmap, 0, 0, 1920, 1080])
    expect(preview.calls('setTransform')[0].args).toEqual([0.5, 0, 0, 0.5, 0, 0])
  })

  it('still hits the handle a project coordinate points at', async () => {
    // A default shape overlay is 0.2 x 0.2 of the project around its centre:
    // 384 x 216 project px at (960, 540), so its SE corner handle sits at
    // (1152, 648) in project space whatever the raster size is.
    const clip = addShape()
    store().setSelectedClipId(clip.id)
    const preview = await renderPreview()
    preview.resize(DISPLAY_BOX)

    await dragOn(preview, [[1152, 648], [1344, 756]])

    // The corner went out by half the box on each axis, so the box grew.
    const shape = store().project.timeline.clips.find((c) => c.id === clip.id)?.shapeData
    expect(shape?.width).toBeGreaterThan(0.2)
    expect(shape?.height).toBeGreaterThan(0.2)
  })

  it('maps a client point to the same project coordinate at any raster size', async () => {
    addShape()
    const preview = await renderPreview()

    const before = [preview.at(960, 540), preview.at(0, 0), preview.at(1920, 1080)]
    preview.resize(DISPLAY_BOX)

    expect([preview.at(960, 540), preview.at(0, 0), preview.at(1920, 1080)]).toEqual(before)
    expect(preview.at(960, 540)).toEqual({ clientX: 480, clientY: 270 })
  })
})

/** Press at the first project-space point, move through the rest, release. */
async function dragOn(preview: Preview, points: Array<[number, number]>) {
  const [start, ...rest] = points
  fireEvent.mouseDown(preview.canvas, preview.at(...start))
  await settle()
  for (const point of rest) {
    fireEvent.mouseMove(window, preview.at(...point))
    await settle(FRAME_MS)
  }
  fireEvent.mouseUp(window)
  await settle(FRAME_MS)
}
