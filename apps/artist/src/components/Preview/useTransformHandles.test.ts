// The gesture's edges: what the hook attaches to the window, when it takes it
// back, and what the pointer says it will do before the button goes down.
//
// The component tests already prove the numbers a drag leaves on a clip. These
// watch the hook's own lifecycle instead — a drag that survives the pointer
// leaving the canvas needs window listeners, and window listeners that outlive
// the editor are a leak — plus the cursor, which is the only part of the state
// machine with no effect on the store at all.
//
// The canvas is the default 1920x1080 project resolution laid out in a 960x540
// box, so a canvas pixel is half a client pixel and nothing is letterboxed. A
// default shape overlay is 0.2 x 0.2 of the canvas — 384 x 216 px around
// (960, 540).
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTransformHandles, type TransformHandlesDeps } from './useTransformHandles'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { DEFAULT_RECT, installPreviewDoubles, settle, type PreviewDoubles } from '../../test/renderPreview'
import { setRect } from '../../test/doubles/layout'
import type { Clip, ShapeOverlayData } from '../../store/types'

let doubles: PreviewDoubles
let addListener: MockInstance
let removeListener: MockInstance

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  addListener = vi.spyOn(window, 'addEventListener')
  removeListener = vi.spyOn(window, 'removeEventListener')
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Half the width and height of a default shape overlay, in canvas pixels. */
const SHAPE = { halfW: 192, halfH: 108 }
/**
 * The rotation grip's distance above the top edge, in canvas pixels:
 * ROTATION_HANDLE_OFFSET is 25 pixels *on screen* (ESCSUITE-90) and the box is
 * half the canvas on both axes.
 */
const GRIP = 50

const addShape = (data: Partial<ShapeOverlayData> = {}): Clip => {
  const clip = store().addShapeOverlayClip(data, undefined, 0, 4)!
  store().setSelectedClipId(clip.id)
  return clip
}

/** Mount the hook against a canvas with a real layout box. */
function mountHandles() {
  const canvas = document.createElement('canvas')
  canvas.width = 1920
  canvas.height = 1080
  setRect(canvas, DEFAULT_RECT)

  const deps: TransformHandlesDeps = {
    canvasRef: { current: canvas },
    setEditingTextClipId: vi.fn(),
    drawFrame: vi.fn(),
    drawSelectionHandles: vi.fn(),
    drawMultiSelectHandles: vi.fn(),
  }

  return { deps, ...renderHook(() => useTransformHandles(deps)) }
}

/** A mouse event at a point given in canvas pixels. */
function at(canvasX: number, canvasY: number, init: object = {}) {
  return {
    clientX: canvasX / 2,
    clientY: canvasY / 2,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  } as unknown as React.MouseEvent<HTMLCanvasElement>
}

/** The mouse event types the hook has bound to (or unbound from) the window. */
const dragTypes = (spy: MockInstance): string[] =>
  spy.mock.calls
    .map((call) => call[0] as string)
    .filter((type) => type === 'mousemove' || type === 'mouseup')

describe('useTransformHandles drag listeners', () => {
  it('binds mousemove and mouseup to the window when a drag starts', async () => {
    addShape()
    const { result } = mountHandles()

    expect(dragTypes(addListener)).toEqual([])

    await act(async () => result.current.handleMouseDown(at(960, 540)))

    expect(dragTypes(addListener)).toEqual(['mousemove', 'mouseup'])
    expect(dragTypes(removeListener)).toEqual([])
  })

  it('unbinds them when the button is released', async () => {
    addShape()
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))
    await act(async () => result.current.handleMouseUp())

    expect(dragTypes(removeListener)).toEqual(['mousemove', 'mouseup'])
  })

  it('unbinds them on unmount mid-drag', async () => {
    addShape()
    const { result, unmount } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))
    act(() => unmount())

    expect(dragTypes(removeListener)).toEqual(['mousemove', 'mouseup'])
  })

  it('binds nothing when the press lands on empty canvas', async () => {
    addShape()
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(100, 100)))

    expect(dragTypes(addListener)).toEqual([])
    expect(result.current.marqueeStart).toEqual({ x: 50, y: 50 })
    expect(result.current.marqueeActive).toBe(false)
  })

  // ESCSUITE-178: a clip on a hidden track is not in the picture, so a press
  // over it is indistinguishable from a press on empty canvas. The press is
  // aimed at the ROTATION HANDLE specifically — the second pass'
  // getClipsAtTime already filters a hidden track out of the body-hit pass,
  // so only the first pass (the selected clip's own handle cascade) can mask
  // this gap: it fed hitHandlesOnClip the selected clip directly, with no
  // track check of its own.
  it('binds nothing for a selected clip’s handle on a hidden track, and starts a marquee instead', async () => {
    const shape = addShape() // selects it
    store().updateTrack(shape.trackId, { visible: false })
    const { result } = mountHandles()

    await act(async () =>
      result.current.handleMouseDown(at(960, 540 - SHAPE.halfH - GRIP))
    )

    expect(dragTypes(addListener)).toEqual([])
    expect(result.current.marqueeStart).not.toBeNull()
  })

  // ESCSUITE-88. A press on a clip whose row is locked selects it — so the
  // inspector can show it, and say why it is read-only — and stops there: no
  // undo bookkeeping, no drag state, and nothing bound to the window, so the
  // clip cannot be moved, resized or rotated.
  it('selects a clip on a locked track without starting a gesture', async () => {
    const shape = addShape()
    store().updateTrack(shape.trackId, { locked: true })
    store().setSelectedClipId(null)
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))

    expect(store().selectedClipId).toBe(shape.id)
    expect(dragTypes(addListener)).toEqual([])
    expect(result.current.marqueeStart).toBeNull()

    // And there is no drag state to answer for the cursor: away from the clip it
    // is the default again, where a live gesture would still say 'move'.
    await act(async () => result.current.handleMouseMoveForCursor(at(100, 100)))
    await settle()
    expect(result.current.cursor).toBe('default')
  })

  // ESCSUITE-3. A clip carrying custom keyframes is picked like a clip on a
  // locked track — selected, with no gesture, so it cannot be dragged, resized
  // or rotated from the canvas while the panel is closed — rather than being
  // treated as if the pixels it is drawn at were empty.
  it('selects a clip with custom keyframes without starting a gesture', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setSelectedClipId(null)
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))

    expect(store().selectedClipId).toBe(shape.id)
    expect(dragTypes(addListener)).toEqual([])
    expect(result.current.marqueeStart).toBeNull()
  })

  // The flip side: inside keyframe mode, for the clip the panel has open, a
  // drag is exactly how a keyframe gets set, so it is not refused.
  it('still starts a gesture on a keyframed clip once the keyframe panel is open for it', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setKeyframePanelOpen(true)
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))

    expect(dragTypes(addListener)).toEqual(['mousemove', 'mouseup'])
  })

  it('binds nothing while the transport is playing', async () => {
    addShape()
    store().setIsPlaying(true)
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))

    expect(dragTypes(addListener)).toEqual([])
    expect(result.current.marqueeStart).toBeNull()
  })
})

describe('useTransformHandles cursor', () => {
  /** Hover a point and read back the cursor the hook settled on. */
  async function cursorAt(canvasX: number, canvasY: number): Promise<string> {
    const { result } = mountHandles()
    await act(async () => result.current.handleMouseMoveForCursor(at(canvasX, canvasY)))
    await settle()
    return result.current.cursor
  }

  it('offers move over the body of a clip', async () => {
    addShape()
    expect(await cursorAt(960, 540)).toBe('move')
  })

  it('offers a diagonal resize over a corner handle', async () => {
    addShape()
    expect(await cursorAt(960 - SHAPE.halfW, 540 - SHAPE.halfH)).toBe('nwse-resize')
    expect(await cursorAt(960 + SHAPE.halfW, 540 - SHAPE.halfH)).toBe('nesw-resize')
  })

  it('offers an axis resize over an edge', async () => {
    addShape()
    expect(await cursorAt(960, 540 - SHAPE.halfH)).toBe('ns-resize')
    expect(await cursorAt(960 - SHAPE.halfW, 540)).toBe('ew-resize')
  })

  it('offers a crosshair over the rotation handle', async () => {
    addShape()
    // ROTATION_HANDLE_OFFSET screen px above the top edge.
    expect(await cursorAt(960, 540 - SHAPE.halfH - GRIP)).toBe('crosshair')
  })

  // ESCSUITE-88: the pointer's promise has to match what a press would do, and
  // on a locked row a press does nothing but select.
  it('offers not-allowed over a clip on a locked track', async () => {
    const shape = addShape()
    store().updateTrack(shape.trackId, { locked: true })

    expect(await cursorAt(960, 540)).toBe('not-allowed')
    expect(await cursorAt(960 - SHAPE.halfW, 540 - SHAPE.halfH)).toBe('not-allowed')
    expect(await cursorAt(960, 540 - SHAPE.halfH - GRIP)).toBe('not-allowed')
    // Empty canvas is still empty canvas — the marquee is unaffected.
    expect(await cursorAt(100, 100)).toBe('default')
  })

  // ESCSUITE-178: unlike a locked track's, which still promises not-allowed
  // for a press that would select, a hidden track's clip is simply not there
  // to hover — the pointer sees the same canvas it would see over empty space.
  it('offers the default cursor over a clip on a hidden track', async () => {
    const shape = addShape()
    store().updateTrack(shape.trackId, { visible: false })

    expect(await cursorAt(960, 540)).toBe('default')
    expect(await cursorAt(960 - SHAPE.halfW, 540 - SHAPE.halfH)).toBe('default')
  })

  // ESCSUITE-3: the same promise as a locked row's — a press over a keyframed
  // clip, panel closed, selects it and does nothing else.
  it('offers not-allowed over a clip with custom keyframes, panel closed', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })

    expect(await cursorAt(960, 540)).toBe('not-allowed')
    // Empty canvas is still empty canvas.
    expect(await cursorAt(100, 100)).toBe('default')
  })

  // The flip side: once the keyframe panel is open for that clip, a drag is
  // how a keyframe gets set, so the cursor goes back to promising one.
  it('offers the ordinary drag cursors once the keyframe panel is open for it', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setKeyframePanelOpen(true)

    expect(await cursorAt(960, 540)).toBe('move')
    expect(await cursorAt(960, 540 - SHAPE.halfH - GRIP)).toBe('crosshair')
  })

  // ESCSUITE-3 review round 1, NIT-2: `isKeyframeMode`'s `hit.clipId ===
  // selectedClipId` operand exercised false with the panel open — nothing is
  // selected, so the clip the pointer is over is never "the one the panel has
  // open", and it reads not-allowed exactly as it does with the panel closed.
  it('offers not-allowed over a keyframed clip with the panel open but nothing selected', async () => {
    const shape = addShape()
    store().setClipKeyframe(shape.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    store().setKeyframePanelOpen(true)
    store().setSelectedClipId(null)

    expect(await cursorAt(960, 540)).toBe('not-allowed')
  })

  it('offers the default cursor over empty canvas', async () => {
    addShape()
    expect(await cursorAt(100, 100)).toBe('default')
  })

  it('offers the default cursor while the transport is playing', async () => {
    addShape()
    store().setIsPlaying(true)
    expect(await cursorAt(960, 540)).toBe('default')
  })

  // The other half of the same promise: a row locked with the button already
  // down is the one way a gesture can still be under way over a locked clip, and
  // from that moment every write it makes is refused.
  it('switches to not-allowed when the row is locked mid-gesture', async () => {
    const shape = addShape()
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960, 540)))
    await act(async () => result.current.handleMouseMoveForCursor(at(960 + 10, 540)))
    await settle()
    expect(result.current.cursor).toBe('move')

    store().updateTrack(shape.trackId, { locked: true })
    await act(async () => result.current.handleMouseMoveForCursor(at(960 + 20, 540)))
    await settle()

    expect(result.current.cursor).toBe('not-allowed')
  })

  it('keeps the drag cursor once a gesture is under way', async () => {
    addShape()
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960 - SHAPE.halfW, 540 - SHAPE.halfH)))
    // Away from every handle, but the drag is what the cursor answers for now.
    await act(async () => result.current.handleMouseMoveForCursor(at(100, 100)))

    expect(result.current.cursor).toBe('nwse-resize')
  })
})
