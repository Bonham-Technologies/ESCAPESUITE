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

const addShape = (data: Partial<ShapeOverlayData> = {}): Clip => {
  const clip = store().addShapeOverlayClip(data, undefined, 0, 4)
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
    // ROTATION_HANDLE_OFFSET px above the top edge.
    expect(await cursorAt(960, 540 - SHAPE.halfH - 25)).toBe('crosshair')
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

  it('keeps the drag cursor once a gesture is under way', async () => {
    addShape()
    const { result } = mountHandles()

    await act(async () => result.current.handleMouseDown(at(960 - SHAPE.halfW, 540 - SHAPE.halfH)))
    // Away from every handle, but the drag is what the cursor answers for now.
    await act(async () => result.current.handleMouseMoveForCursor(at(100, 100)))

    expect(result.current.cursor).toBe('nwse-resize')
  })
})
