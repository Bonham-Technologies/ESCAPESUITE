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
import type { Clip, ShapeOverlayData, TextOverlayData } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const clipOf = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

const addText = (data: Partial<TextOverlayData> = {}, duration = 4): Clip =>
  store().addTextOverlayClip(data, undefined, 0, duration)!

const addShape = (data: Partial<ShapeOverlayData> = {}, duration = 4): Clip =>
  store().addShapeOverlayClip(data, undefined, 0, duration)!

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

  it('adds to the existing selection when the meta key is held', async () => {
    const { left, right } = twoShapes()
    store().selectClipsInRange([right.id])

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.atCss(100, 100))
    fireEvent.mouseMove(preview.canvas, preview.atCss(400, 400))
    await settle()
    fireEvent.mouseUp(preview.canvas, { ...preview.atCss(400, 400), metaKey: true })
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

  // ESCSUITE-155 (the ESCSUITE-3 review's MINOR-4): a keyframed clip's chrome
  // used to vanish entirely outside keyframe mode, the one asymmetry with a
  // locked track's — whose full box and handles are drawn and simply inert.
  // It now draws just the same, whether or not the keyframe panel is open.
  it('still draws the handles for a clip whose custom keyframes lock it', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(shape.id)

    const preview = await renderPreview()

    expect(preview.frame().of('arc')).not.toHaveLength(0)
  })

  it('keeps drawing the handles once the keyframe panel is open', async () => {
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
    // The grip's 25px offset is 25 pixels *on screen* (ESCSUITE-90), and this
    // box is half the project on both axes.
    expect(await hover(preview, 960, 540 - SHAPE.halfH - 50)).toBe('crosshair')
  })

  // ESCSUITE-88: a locked row refuses the gesture at the press, so the canvas
  // says so before the press.
  it('offers not-allowed over a clip on a locked track', async () => {
    const { shape, preview } = await selectedShape()
    store().updateTrack(clipOf(shape.id).trackId, { locked: true })

    expect(await hover(preview, 960, 540)).toBe('not-allowed')
  })

  // ESCSUITE-3: the same promise as a locked row's — a press here selects and
  // starts nothing, so the cursor says so before the press.
  it('offers not-allowed over a clip with custom keyframes, panel closed', async () => {
    const { shape, preview } = await selectedShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })

    expect(await hover(preview, 960, 540)).toBe('not-allowed')
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

    expect(clipOf(other.id).shapeData!.x).toBe(0.2)
    expect(clipOf(other.id).animation?.keyframes).toBeUndefined()
    // The click counted as one on empty canvas, so it cleared the selection.
    expect(store().selectedClipId).toBeNull()
    expect(clipOf(selected.id).shapeData!.x).toBe(0.8)
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

  // ESCSUITE-3: a keyframed clip used to be invisible to the pointer while
  // the panel is closed — not just unmovable, but a click through it that
  // landed on empty canvas (and cleared the selection) or on whatever clip
  // was underneath. It is picked like a clip on a locked track instead: the
  // press selects it and starts no gesture, so nothing about it moves.
  it('selects a clip with custom keyframes while the panel is closed, without moving it', async () => {
    const keyed = addShape({ x: 0.5 })
    store().setClipKeyframe(keyed.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()
    fireEvent.mouseMove(window, preview.at(960 + 200, 540))
    await settle(FRAME_MS)
    fireEvent.mouseUp(window)
    await settle(FRAME_MS)

    expect(store().selectedClipId).toBe(keyed.id)
    expect(clipOf(keyed.id).shapeData!.x).toBe(0.5)
  })

  it('does not fall through a keyframed clip to the plain clip beneath it', async () => {
    addClip('clip1', 0, 4)
    const keyed = addShape({ x: 0.5 })
    store().setClipKeyframe(keyed.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    await settle()

    expect(store().selectedClipId).toBe(keyed.id)
    fireEvent.mouseUp(window)
    await settle()
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

  it('places the editor over right-aligned text on a letterboxed canvas', async () => {
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

  it('catches a marquee drawn on a letterboxed canvas', async () => {
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

// ESCSUITE-90: the chrome used to be drawn and hit-tested in project pixels, so
// a 4K project in a small preview got handles a pixel and a half wide. The
// preview now hands both the project pixels per CSS pixel of the box it is laid
// out in, so the chrome is a constant size on screen — which in project pixels
// means it grows with the resolution.
describe('handles at a constant screen size (ESCSUITE-90)', () => {
  /** The canvas' CSS box throughout: 16:9, so no case below letterboxes. */
  const BOX = { width: 640, height: 360 }
  const RECT = { left: 0, top: 0, ...BOX }

  /**
   * A selected default shape in a project of the given size, laid out in BOX.
   * The default shape is a fifth of the frame each way, so its half-extents are
   * a tenth of the project.
   */
  const shapeIn = async (width: number, height: number) => {
    const shape = addShape()
    store().setSelectedClipId(shape.id)
    store().setProjectResolution(width, height)
    const preview = await renderPreview({ rect: RECT })
    preview.clearCalls()
    preview.resize(BOX)
    await settle(FRAME_MS)
    return { shape, preview, halfW: width / 10, halfH: height / 10 }
  }

  it('draws a 4K project a handle six times the size, on the same corners', async () => {
    const { preview, halfW, halfH } = await shapeIn(3840, 2160)

    // 3840 project px across a 640px box: six project px per CSS px, so an
    // 8px-on-screen handle is 48 project px wide.
    const handle = 48
    const side = handle * 0.8
    expect(preview.frame().argsFor('strokeRect')).toEqual([
      [-halfW, -halfH, halfW * 2, halfH * 2],
      [-halfW - handle / 2, -halfH - handle / 2, handle, handle],
      [halfW - handle / 2, -halfH - handle / 2, handle, handle],
      [-halfW - handle / 2, halfH - handle / 2, handle, handle],
      [halfW - handle / 2, halfH - handle / 2, handle, handle],
      [-side / 2, -halfH - side / 2, side, side],
      [-side / 2, halfH - side / 2, side, side],
      [-halfW - side / 2, -side / 2, side, side],
      [halfW - side / 2, -side / 2, side, side],
    ])
    // The grip keeps its 25 CSS px of air above the box: 150 project px.
    expect(preview.frame().argsFor('arc')).toEqual([[0, -halfH - 150, handle, 0, Math.PI * 2]])
  })

  it('draws the handles at their plain size when the box is the project', async () => {
    const { preview, halfW, halfH } = await shapeIn(BOX.width, BOX.height)

    expect(preview.frame().argsFor('strokeRect').slice(0, 2)).toEqual([
      [-halfW, -halfH, halfW * 2, halfH * 2],
      [-halfW - 4, -halfH - 4, 8, 8],
    ])
    expect(preview.frame().argsFor('arc')).toEqual([[0, -halfH - 25, 8, 0, Math.PI * 2]])
  })

  it('falls back to the plain size when the box has collapsed to nothing', async () => {
    // A preview in a panel that has been dragged shut reports a 0x0 box, and
    // the scale is project pixels *per CSS pixel* — dividing by zero would put
    // an infinity into every handle rectangle.
    const shape = addShape()
    store().setSelectedClipId(shape.id)
    store().setProjectResolution(3840, 2160)
    const preview = await renderPreview({ rect: RECT })
    preview.clearCalls()
    preview.resize({ width: 0, height: 0 })
    await settle(FRAME_MS)

    expect(preview.frame().argsFor('arc')).toEqual([[0, -216 - 25, 8, 0, Math.PI * 2]])
  })

  it('reaches the corner of a 4K project from 30 project px away', async () => {
    const { preview, halfW, halfH } = await shapeIn(3840, 2160)

    // 8 * 1.5 * 6 = 72 project px of tolerance, so 30 is well inside it.
    fireEvent.mouseMove(preview.canvas, preview.at(1920 - halfW - 30, 1080 - halfH))
    await settle()

    expect(preview.canvas.style.cursor).toBe('nwse-resize')
  })

  it('does not reach it from 30 project px away at 720p in the same box', async () => {
    const { preview, halfW, halfH } = await shapeIn(1280, 720)

    // Two project px per CSS px there, so the tolerance is 24 and 30 misses.
    fireEvent.mouseMove(preview.canvas, preview.at(640 - halfW - 30, 360 - halfH))
    await settle()

    expect(preview.canvas.style.cursor).toBe('default')
  })
})
