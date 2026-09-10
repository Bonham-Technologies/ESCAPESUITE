import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDraggablePanel } from './useDraggablePanel'

const STORAGE_KEY = 'keyframePanelLayout'
const STORAGE_VERSION = 2

const INITIAL_POSITION = { x: 100, y: 50 }
const INITIAL_SIZE = { width: 600, height: 600 }

/** A React.MouseEvent stand-in carrying the two things the hook reads. */
function mouseDown(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> }
}

function moveMouse(clientX: number, clientY: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
  })
}

function releaseMouse() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

function render(
  onPositionChange?: (p: { x: number; y: number }) => void,
  onSizeChange?: (s: { width: number; height: number }) => void
) {
  return renderHook(() =>
    useDraggablePanel(INITIAL_POSITION, INITIAL_SIZE, onPositionChange, onSizeChange)
  )
}

describe('useDraggablePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('persisted layout', () => {
    it('starts at the supplied position and size when nothing is saved', () => {
      const { result } = render()

      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(result.current.size).toEqual(INITIAL_SIZE)
    })

    it('saves the layout with its version as soon as it mounts', () => {
      render()

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
        position: INITIAL_POSITION,
        size: INITIAL_SIZE,
        version: STORAGE_VERSION,
      })
    })

    it('restores a saved layout of the current version', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ position: { x: 10, y: 20 }, size: { width: 700, height: 800 }, version: STORAGE_VERSION })
      )

      const { result } = render()

      expect(result.current.position).toEqual({ x: 10, y: 20 })
      expect(result.current.size).toEqual({ width: 700, height: 800 })
    })

    it('raises a saved size that is below the minimum', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, version: STORAGE_VERSION })
      )

      const { result } = render()

      expect(result.current.size).toEqual({ width: 500, height: 500 })
    })

    it('falls back to the defaults when the saved entry has no position or size', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION }))

      const { result } = render()

      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(result.current.size).toEqual(INITIAL_SIZE)
    })

    it('discards a layout saved by an older version', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ position: { x: 10, y: 20 }, size: { width: 700, height: 800 }, version: 1 })
      )

      const { result } = render()

      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(result.current.size).toEqual(INITIAL_SIZE)
      // Rewritten at the current version.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(STORAGE_VERSION)
    })

    it('ignores an unparseable saved layout', () => {
      localStorage.setItem(STORAGE_KEY, 'not json')

      const { result } = render()

      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(result.current.size).toEqual(INITIAL_SIZE)
    })

    it('carries on when storage refuses the write', () => {
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      try {
        const { result } = render()

        expect(result.current.position).toEqual(INITIAL_POSITION)
        expect(setItem).toHaveBeenCalled()
      } finally {
        setItem.mockRestore()
      }
    })
  })

  describe('dragging the title bar', () => {
    it('moves the panel by the mouse delta and reports the new position', () => {
      const onPositionChange = vi.fn()
      const { result } = render(onPositionChange)

      act(() => result.current.onTitleBarMouseDown(mouseDown(200, 200)))
      moveMouse(230, 260)

      expect(result.current.position).toEqual({ x: 130, y: 110 })
      expect(onPositionChange).toHaveBeenLastCalledWith({ x: 130, y: 110 })
    })

    it('suppresses the browser default so no text is selected', () => {
      const { result } = render()
      const event = mouseDown(200, 200)

      act(() => result.current.onTitleBarMouseDown(event))

      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('keeps the panel inside the viewport', () => {
      const { result } = render()

      act(() => result.current.onTitleBarMouseDown(mouseDown(0, 0)))
      // Far past the bottom-right corner.
      moveMouse(5000, 5000)

      expect(result.current.position).toEqual({
        x: window.innerWidth - INITIAL_SIZE.width,
        y: window.innerHeight - INITIAL_SIZE.height,
      })

      // And past the top-left corner.
      moveMouse(-5000, -5000)
      expect(result.current.position).toEqual({ x: 0, y: 0 })
    })

    it('ignores mouse moves before a drag starts', () => {
      const onPositionChange = vi.fn()
      const { result } = render(onPositionChange)

      moveMouse(500, 500)

      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(onPositionChange).not.toHaveBeenCalled()
    })

    it('stops following the mouse once the button is released', () => {
      const { result } = render()

      act(() => result.current.onTitleBarMouseDown(mouseDown(200, 200)))
      moveMouse(210, 210)
      const afterDrag = result.current.position

      releaseMouse()
      moveMouse(400, 400)

      expect(result.current.position).toEqual(afterDrag)
    })
  })

  describe('resizing', () => {
    const startResize = (
      result: { current: ReturnType<typeof useDraggablePanel> },
      edge: string,
      x = 500,
      y = 500
    ) => {
      const event = mouseDown(x, y)
      act(() => result.current.onResizeMouseDown(event, edge))
      return event
    }

    it('suppresses default and stops the event reaching the title bar', () => {
      const { result } = render()
      const event = startResize(result, 'e')

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('grows to the east and reports the new size', () => {
      const onSizeChange = vi.fn()
      const { result } = render(undefined, onSizeChange)

      startResize(result, 'e')
      moveMouse(600, 500)

      expect(result.current.size).toEqual({ width: 700, height: 600 })
      expect(result.current.position).toEqual(INITIAL_POSITION)
      expect(onSizeChange).toHaveBeenLastCalledWith({ width: 700, height: 600 })
    })

    it('grows to the south', () => {
      const { result } = render()

      startResize(result, 's')
      moveMouse(500, 650)

      expect(result.current.size).toEqual({ width: 600, height: 750 })
    })

    it('grows to the west by moving the left edge left', () => {
      const { result } = render()

      startResize(result, 'w')
      moveMouse(450, 500)

      expect(result.current.size).toEqual({ width: 650, height: 600 })
      expect(result.current.position).toEqual({ x: 50, y: 50 })
    })

    it('grows to the north by moving the top edge up', () => {
      const { result } = render()

      startResize(result, 'n')
      moveMouse(500, 460)

      expect(result.current.size).toEqual({ width: 600, height: 640 })
      expect(result.current.position).toEqual({ x: 100, y: 10 })
    })

    it('resizes both axes at once from a corner', () => {
      const { result } = render()

      startResize(result, 'se')
      moveMouse(560, 570)

      expect(result.current.size).toEqual({ width: 660, height: 670 })
    })

    it('never shrinks below the minimum size', () => {
      const { result } = render()

      startResize(result, 'se')
      moveMouse(0, 0)

      expect(result.current.size).toEqual({ width: 500, height: 500 })
    })

    it('stops the west edge once the minimum width is reached', () => {
      const { result } = render()

      startResize(result, 'nw')
      // Dragging far to the bottom-right would collapse the panel; the west and
      // north edges stop at the minimum and the origin moves no further.
      moveMouse(5000, 5000)

      expect(result.current.size).toEqual({ width: 500, height: 500 })
      expect(result.current.position).toEqual({ x: 200, y: 150 })
    })

    it('stops resizing once the button is released', () => {
      const { result } = render()

      startResize(result, 'e')
      moveMouse(600, 500)
      const afterResize = result.current.size

      releaseMouse()
      moveMouse(900, 500)

      expect(result.current.size).toEqual(afterResize)
    })
  })

  describe('window resize', () => {
    it('pulls the panel back inside a shrunken viewport', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ position: { x: 400, y: 150 }, size: INITIAL_SIZE, version: STORAGE_VERSION })
      )
      const { result } = render()
      expect(result.current.position).toEqual({ x: 400, y: 150 })

      act(() => {
        window.innerWidth = 700
        window.innerHeight = 620
        window.dispatchEvent(new Event('resize'))
      })

      expect(result.current.position).toEqual({ x: 100, y: 20 })
    })
  })

  describe('teardown', () => {
    it('stops listening to the window on unmount', () => {
      const onPositionChange = vi.fn()
      const { result, unmount } = render(onPositionChange)

      act(() => result.current.onTitleBarMouseDown(mouseDown(200, 200)))
      unmount()

      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 400 }))
      window.dispatchEvent(new Event('resize'))

      expect(onPositionChange).not.toHaveBeenCalled()
    })
  })

  describe('imperative setters', () => {
    it('lets the caller place and size the panel directly, and persists it', () => {
      const { result } = render()

      act(() => {
        result.current.setPosition({ x: 5, y: 6 })
        result.current.setSize({ width: 900, height: 700 })
      })

      expect(result.current.position).toEqual({ x: 5, y: 6 })
      expect(result.current.size).toEqual({ width: 900, height: 700 })
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
        position: { x: 5, y: 6 },
        size: { width: 900, height: 700 },
        version: STORAGE_VERSION,
      })
    })
  })
})
