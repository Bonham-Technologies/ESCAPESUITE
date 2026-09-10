// Picking things up in the preview: what a click selects, what the marquee
// catches, what the cursor says, and what a double-click opens.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  audioSource,
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type Preview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { Clip, ShapeOverlayData, TextOverlayData } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const addText = (data: Partial<TextOverlayData> = {}, duration = 4): Clip =>
  store().addTextOverlayClip(data, undefined, 0, duration)

const addShape = (data: Partial<ShapeOverlayData> = {}, duration = 4): Clip =>
  store().addShapeOverlayClip(data, undefined, 0, duration)

/**
 * A default text overlay measures 100x57.6 canvas pixels around its centre —
 * the double reports every string as 100px wide, and the line height is
 * fontSize * 1.2. A default shape measures 384x216.
 */
const TEXT = { halfW: 50, halfH: 28.8 }
const SHAPE = { halfW: 192, halfH: 108 }

/** Press, drag through the given canvas points, release. */
async function drag(preview: Preview, points: Array<[number, number]>): Promise<void> {
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

describe('PreviewPlayer click selection', () => {
  it('selects the media clip under the pointer', async () => {
    addClip('clip1', 0, 4)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe('clip1')
    fireEvent.mouseUp(window)
    await settle()
  })

  it('picks the overlay over the media clip beneath it', async () => {
    addClip('clip1', 0, 4)
    const shape = addShape()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe(shape.id)
    fireEvent.mouseUp(window)
    await settle()
  })

  it('picks a text overlay over a shape overlay in the same place', async () => {
    const shape = addShape()
    const text = addText()
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe(text.id)
    expect(store().selectedClipId).not.toBe(shape.id)
    fireEvent.mouseUp(window)
    await settle()
  })

  it('picks the clip on the higher track when two media clips overlap', async () => {
    const bottom = store().project.timeline.tracks[0].id
    const top = store().addTrack('Top').id
    addClip('lower', 0, 4, bottom)
    addClip('upper', 0, 4, top)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe('upper')
    fireEvent.mouseUp(window)
    await settle()
  })

  it('never selects an audio clip', async () => {
    store().addSourceVideo(audioSource)
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 4, duration: 4 },
      store().project.timeline.tracks[0].id,
      0
    )

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    fireEvent.mouseUp(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBeNull()
  })

  it('clears the selection when the click lands on empty canvas', async () => {
    const shape = addShape()
    store().selectClipsInRange([shape.id])

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(100, 100))
    fireEvent.mouseUp(preview.canvas, preview.at(100, 100))
    await settle()

    expect(store().selectedClipId).toBeNull()
    expect(store().selectedClipIds.size).toBe(0)
  })

  it('ignores a click that lands outside a clip whose time has passed', async () => {
    addShape({}, 1)
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    store().setCurrentTime(2)
    await settle(FRAME_MS)

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    fireEvent.mouseUp(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBeNull()
  })

  it('does nothing at all while the timeline is playing', async () => {
    addClip('clip1', 0, 4)
    const preview = await renderPreview()

    store().setIsPlaying(true)
    await settle(FRAME_MS)
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBeNull()
    store().setIsPlaying(false)
    await settle(FRAME_MS)
  })
})

describe('PreviewPlayer marquee selection', () => {
  /** Two shapes side by side: the left one at x 0.25, the right one at 0.75. */
  const twoShapes = () => {
    const left = addShape({ x: 0.25 })
    const right = addShape({ x: 0.75 })
    store().setSelectedClipId(null)
    return { left, right }
  }

  it('selects every clip the marquee box covers', async () => {
    const { left, right } = twoShapes()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(400, 400))
    await settle()
    fireEvent.mouseUp(preview.canvas, preview.atCss(400, 400))
    await settle()

    expect([...store().selectedClipIds]).toEqual([left.id])
    expect(store().selectedClipIds.has(right.id)).toBe(false)
  })

  it('draws the marquee box while the drag is in flight', async () => {
    twoShapes()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 120))
    fireEvent.mouseMove(preview.canvas, preview.atCss(300, 220))
    await settle()

    const marquee = preview.view.container.querySelector('div[style*="width"]') as HTMLElement
    expect(marquee.style.left).toBe('100px')
    expect(marquee.style.top).toBe('120px')
    expect(marquee.style.width).toBe('200px')
    expect(marquee.style.height).toBe('100px')

    fireEvent.mouseUp(preview.canvas, preview.atCss(300, 220))
    await settle()
  })

  it('adds to the existing selection when ctrl is held', async () => {
    const { left, right } = twoShapes()
    store().selectClipsInRange([right.id])

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(400, 400))
    await settle()
    fireEvent.mouseUp(preview.canvas, { ...preview.atCss(400, 400), ctrlKey: true })
    await settle()

    expect([...store().selectedClipIds].sort()).toEqual([right.id, left.id].sort())
  })

  it('replaces the existing selection when no modifier is held', async () => {
    const { left, right } = twoShapes()
    store().selectClipsInRange([right.id])

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(400, 400))
    await settle()
    fireEvent.mouseUp(preview.canvas, preview.atCss(400, 400))
    await settle()

    expect([...store().selectedClipIds]).toEqual([left.id])
  })

  it('treats a drag under the threshold as a plain click', async () => {
    const { left } = twoShapes()
    store().selectClipsInRange([left.id])

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(102, 102))
    await settle()

    expect(preview.view.container.querySelector('div[style*="width"]')).toBeNull()

    fireEvent.mouseUp(preview.canvas, preview.atCss(102, 102))
    await settle()

    expect(store().selectedClipIds.size).toBe(0)
  })

  it('abandons a half-started marquee when the pointer leaves the canvas', async () => {
    twoShapes()

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(400, 400))
    await settle()
    expect(preview.view.container.querySelector('div[style*="width"]')).not.toBeNull()

    fireEvent.mouseLeave(preview.canvas)
    await settle()

    expect(preview.view.container.querySelector('div[style*="width"]')).toBeNull()
  })

  it('draws a dashed box around every extra clip in a multi-selection', async () => {
    const { left, right } = twoShapes()
    store().setSelectedClipId(left.id)

    const preview = await renderPreview()
    preview.clearCalls()
    store().selectClipsInRange([left.id, right.id])
    await settle(60)

    const dashes = preview.calls('setLineDash').map((c) => c.args[0])
    expect(dashes).toContainEqual([6, 4])
    // The extra clip gets a box, the primary one keeps its full handles.
    const boxes = preview.argsFor('strokeRect')
    expect(boxes).toContainEqual([-192, -108, 384, 216])
    expect(store().selectedClipIds.size).toBe(2)
  })

  it('leaves a clip out of the multi-select boxes once its time has passed', async () => {
    const early = addShape({ x: 0.25 }, 1)
    const late = addShape({ x: 0.75 }, 4)
    store().setSelectedClipId(late.id)
    store().selectClipsInRange([early.id, late.id])

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(2)
    await settle(60)

    expect(preview.calls('setLineDash').map((c) => c.args[0])).not.toContainEqual([6, 4])
  })
})

describe('PreviewPlayer selection handles', () => {
  it('draws the box, eight handles and the rotation grip for the selected clip', async () => {
    const shape = addShape()
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()
    const frame = preview.frame()

    // The bounding box plus four corner and four side handles.
    expect(frame.argsFor('strokeRect')).toEqual([
      [-192, -108, 384, 216],
      [-196, -112, 8, 8],
      [188, -112, 8, 8],
      [-196, 104, 8, 8],
      [188, 104, 8, 8],
      [-3.2, -111.2, 6.4, 6.4],
      [-3.2, 104.8, 6.4, 6.4],
      [-195.2, -3.2, 6.4, 6.4],
      [188.8, -3.2, 6.4, 6.4],
    ])
    // The rotation grip sits 25px above the top edge, on a dashed leader line.
    expect(frame.argsFor('arc')).toEqual([[0, -133, 8, 0, Math.PI * 2]])
    expect(frame.argsFor('setLineDash')).toContainEqual([[4, 4]])
  })

  it('rotates the handle overlay with the clip', async () => {
    const shape = addShape({ rotation: 90 })
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()

    expect(preview.frame().argsFor('rotate')).toContainEqual([Math.PI / 2])
  })

  it('draws no handles while playing', async () => {
    const shape = addShape()
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()
    preview.clearCalls()
    store().setIsPlaying(true)
    await settle(FRAME_MS)

    expect(preview.calls('arc')).toHaveLength(0)
    store().setIsPlaying(false)
    await settle(FRAME_MS)
  })

  it('draws no handles for a clip whose custom keyframes lock it', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()

    expect(preview.frame().of('arc')).toHaveLength(0)
  })

  it('draws the handles again once the keyframe panel is open', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()
    preview.clearCalls()
    store().setKeyframePanelOpen(true)
    await settle(60)

    expect(preview.calls('arc')).not.toHaveLength(0)
  })

  it('draws no handles when the selected clip is not at the playhead', async () => {
    const shape = addShape({}, 1)
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()
    preview.clearCalls()
    store().setCurrentTime(2)
    await settle(FRAME_MS)

    expect(preview.calls('arc')).toHaveLength(0)
  })
})

describe('PreviewPlayer cursor', () => {
  const selectedShape = async () => {
    const shape = addShape()
    store().setSelectedClipId(shape.id)
    const preview = await renderPreview()
    return { shape, preview }
  }

  const hover = async (preview: Preview, x: number, y: number) => {
    fireEvent.mouseMove(preview.canvas, preview.at(x, y))
    await settle()
    return preview.canvas.style.cursor
  }

  it('finds left-aligned text by the box that hangs to its right', async () => {
    const text = addText({ textAlign: 'left' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    // A left-aligned run of 100px starts at the anchor, so its centre is 50px
    // to the right of it.
    fireEvent.mouseDown(preview.canvas, preview.at(960 + 45, 540))
    await settle()

    expect(store().selectedClipId).toBe(text.id)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)
  })

  it('offers move over the body of the clip', async () => {
    const { preview } = await selectedShape()
    expect(await hover(preview, 960, 540)).toBe('move')
  })

  it('offers the diagonal resize cursors at the corners', async () => {
    const { preview } = await selectedShape()
    expect(await hover(preview, 960 - SHAPE.halfW, 540 - SHAPE.halfH)).toBe('nwse-resize')
    expect(await hover(preview, 960 + SHAPE.halfW, 540 + SHAPE.halfH)).toBe('nwse-resize')
    expect(await hover(preview, 960 + SHAPE.halfW, 540 - SHAPE.halfH)).toBe('nesw-resize')
    expect(await hover(preview, 960 - SHAPE.halfW, 540 + SHAPE.halfH)).toBe('nesw-resize')
  })

  it('offers the axis resize cursors along the edges', async () => {
    const { preview } = await selectedShape()
    expect(await hover(preview, 960, 540 - SHAPE.halfH)).toBe('ns-resize')
    expect(await hover(preview, 960, 540 + SHAPE.halfH)).toBe('ns-resize')
    expect(await hover(preview, 960 - SHAPE.halfW, 540)).toBe('ew-resize')
    expect(await hover(preview, 960 + SHAPE.halfW, 540)).toBe('ew-resize')
  })

  it('offers a crosshair on the rotation grip', async () => {
    const { preview } = await selectedShape()
    expect(await hover(preview, 960, 540 - SHAPE.halfH - 25)).toBe('crosshair')
  })

  it('falls back to the default cursor over empty canvas', async () => {
    const { preview } = await selectedShape()
    expect(await hover(preview, 100, 100)).toBe('default')
  })

  it('keeps the drag cursor for the whole gesture', async () => {
    const { preview } = await selectedShape()

    fireEvent.mouseDown(preview.canvas, preview.at(960 + SHAPE.halfW, 540))
    await settle()
    fireEvent.mouseMove(preview.canvas, preview.at(100, 100))
    await settle()

    expect(preview.canvas.style.cursor).toBe('ew-resize')

    fireEvent.mouseUp(window)
    await settle(FRAME_MS)
  })

  it('shows the default cursor while playing', async () => {
    const { preview } = await selectedShape()
    store().setIsPlaying(true)
    await settle(FRAME_MS)

    expect(await hover(preview, 960, 540)).toBe('default')

    store().setIsPlaying(false)
    await settle(FRAME_MS)
  })
})

describe('PreviewPlayer keyframe-mode interaction', () => {
  it('never grabs another clip while the keyframe panel is open', async () => {
    const other = addShape({ x: 0.2 })
    const selected = addShape({ x: 0.8 })
    store().setSelectedClipId(selected.id)
    store().setKeyframePanelOpen(true)

    const preview = await renderPreview()
    // Straight onto the middle of the *other* shape, then a nudge that would
    // have moved it had the press grabbed anything.
    fireEvent.mouseDown(preview.canvas, preview.at(0.2 * 1920, 540))
    await settle()
    fireEvent.mouseMove(window, preview.at(0.2 * 1920 + 200, 540))
    await settle(FRAME_MS)
    fireEvent.mouseUp(preview.canvas, preview.at(0.2 * 1920, 540))
    await settle(FRAME_MS)

    const untouched = store().project.timeline.clips.find((c) => c.id === other.id)!
    expect(untouched.shapeData!.x).toBe(0.2)
    expect(untouched.animation?.keyframes).toBeUndefined()
    // The click counted as one on empty canvas, so it cleared the selection.
    expect(store().selectedClipId).toBeNull()
    expect(selected.shapeData!.x).toBe(0.8)
  })

  it('still grabs the selected clip through its own handles in keyframe mode', async () => {
    const selected = addShape({ x: 0.5 })
    store().setSelectedClipId(selected.id)
    store().setKeyframePanelOpen(true)

    const preview = await renderPreview()
    await drag(preview, [
      [960 + SHAPE.halfW, 540],
      [960 + SHAPE.halfW + 96, 540],
    ])

    const clip = store().project.timeline.clips.find((c) => c.id === selected.id)!
    expect(clip.animation?.keyframes?.scaleX?.length).toBeGreaterThan(0)
  })

  it('lets a clip be grabbed again once its keyframes are all removed', async () => {
    const shape = addShape({ x: 0.5 })
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().clearClipKeyframes(shape.id, 'x')
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe(shape.id)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)
  })

  it('ignores a clip that has custom keyframes while the panel is closed', async () => {
    const keyed = addShape({ x: 0.5 })
    store().setClipKeyframe(keyed.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    fireEvent.mouseUp(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBeNull()
  })
})

describe('PreviewPlayer inline text editing', () => {
  const openEditor = async () => {
    const clip = addText({ text: 'Before' })
    store().setSelectedClipId(null)
    const preview = await renderPreview()
    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME_MS)
    return { clip, preview, textarea: preview.view.container.querySelector('textarea')! }
  }

  it('opens an editor on the text it was double-clicked on', async () => {
    const { clip, textarea } = await openEditor()

    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('Before')
    expect(store().selectedClipId).toBe(clip.id)
  })

  it('places the editor over the text it replaces', async () => {
    const { textarea } = await openEditor()

    // 100x57.6 canvas px, centre-aligned at (960, 540), halved for the element.
    expect(textarea.style.left).toBe(`${455 - 24 * 0.15}px`)
    expect(textarea.style.top).toBe(`${255.6 - 24 * 0.15}px`)
    expect(textarea.style.fontSize).toBe('24px')
  })

  it('places the editor over right-aligned text on a pillarboxed canvas', async () => {
    addText({ text: 'Before', textAlign: 'right' })
    store().setSelectedClipId(null)
    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 960, height: 600 } })

    fireEvent.doubleClick(preview.canvas, preview.at(960 - 25, 540))
    await settle(FRAME_MS)

    const textarea = preview.view.container.querySelector('textarea')!
    // Right-aligned text hangs left of its anchor: (960 - 100) / 2 in element
    // pixels, plus the 30px letterbox at the top.
    expect(textarea.style.left).toBe(`${430 - 24 * 0.15}px`)
    expect(textarea.style.top).toBe(`${30 + 255.6 - 24 * 0.15}px`)
  })

  it('writes the edited text back to the clip when the editor is left', async () => {
    const { clip, textarea } = await openEditor()

    fireEvent.change(textarea, { target: { value: 'After' } })
    fireEvent.blur(textarea)
    await settle(FRAME_MS)

    expect(store().project.timeline.clips.find((c) => c.id === clip.id)!.textData!.text).toBe('After')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('leaves the text alone when the edit is cancelled', async () => {
    const { clip, textarea } = await openEditor()

    fireEvent.change(textarea, { target: { value: 'Discarded' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    await settle(FRAME_MS)

    expect(store().project.timeline.clips.find((c) => c.id === clip.id)!.textData!.text).toBe('Before')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('closes the editor when playback starts', async () => {
    const { preview } = await openEditor()
    expect(preview.view.container.querySelector('textarea')).not.toBeNull()

    store().setIsPlaying(true)
    await settle(FRAME_MS)

    expect(preview.view.container.querySelector('textarea')).toBeNull()
    store().setIsPlaying(false)
    await settle(FRAME_MS)
  })

  it('ignores a double-click that misses every text clip', async () => {
    addText({ text: 'Before' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.doubleClick(preview.canvas, preview.at(100, 100))
    await settle(FRAME_MS)

    expect(preview.view.container.querySelector('textarea')).toBeNull()
  })

  it('ignores a double-click on a shape', async () => {
    addShape()
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME_MS)

    expect(preview.view.container.querySelector('textarea')).toBeNull()
  })

  it('ignores a double-click while playing', async () => {
    addText({ text: 'Before' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    store().setIsPlaying(true)
    await settle(FRAME_MS)
    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME_MS)

    expect(preview.view.container.querySelector('textarea')).toBeNull()
    store().setIsPlaying(false)
    await settle(FRAME_MS)
  })

  it('cancels a drag that the first click of the double-click started', async () => {
    const clip = addText({ text: 'Before' })
    store().setSelectedClipId(clip.id)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.doubleClick(preview.canvas, preview.at(960, 540))
    await settle(FRAME_MS)

    // The editor is open and no drag survived to move the text on the next move.
    expect(preview.view.container.querySelector('textarea')).not.toBeNull()
    fireEvent.mouseMove(window, preview.at(1400, 540))
    await settle(FRAME_MS)
    expect(store().project.timeline.clips.find((c) => c.id === clip.id)!.textData!.x).toBe(0.5)
  })

  it('stops handing the canvas mouse events while the editor is open', async () => {
    const { preview, clip } = await openEditor()

    fireEvent.mouseDown(preview.canvas, preview.at(100, 100))
    fireEvent.mouseUp(preview.canvas, preview.at(100, 100))
    await settle()

    expect(store().selectedClipId).toBe(clip.id)
  })
})

describe('PreviewPlayer hit testing through the letterbox', () => {
  it('finds the clip under a click on a pillarboxed canvas', async () => {
    addClip('clip1', 0, 4)
    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 1000, height: 540 } })

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe('clip1')
    fireEvent.mouseUp(window)
    await settle()
  })

  it('finds the clip under a click on a letterboxed canvas', async () => {
    addClip('clip1', 0, 4)
    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 960, height: 600 } })

    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe('clip1')
    fireEvent.mouseUp(window)
    await settle()
  })

  it('catches a marquee drawn on a pillarboxed canvas', async () => {
    const shape = addShape({ x: 0.5 })
    store().setSelectedClipId(null)
    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 960, height: 600 } })

    fireEvent.mouseDown(preview.canvas, preview.atCss(300, 200))
    fireEvent.mouseMove(preview.canvas, preview.atCss(660, 400))
    await settle()
    fireEvent.mouseUp(preview.canvas, preview.atCss(660, 400))
    await settle()

    expect([...store().selectedClipIds]).toEqual([shape.id])
  })

  it('takes the canvas offset into account', async () => {
    const text = addText()
    store().setSelectedClipId(null)
    const preview = await renderPreview({ rect: { left: 200, top: 80, width: 960, height: 540 } })

    fireEvent.mouseDown(preview.canvas, preview.at(960 - TEXT.halfW + 5, 540))
    await settle()

    expect(store().selectedClipId).toBe(text.id)
    fireEvent.mouseUp(window)
    await settle()
  })
})
