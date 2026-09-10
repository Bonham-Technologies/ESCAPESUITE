import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDocumentListener, useDragListeners, useWindowListener } from './useDocumentListener'

/** Fire a real mouse event at the document, the way a drag would. */
function mouseAt(type: string, clientX = 0, clientY = 0): MouseEvent {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true })
  document.dispatchEvent(event)
  return event
}

describe('useDocumentListener', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('delivers matching document events to the handler', () => {
    const handler = vi.fn()
    renderHook(() => useDocumentListener('mousemove', handler))

    const event = mouseAt('mousemove', 10, 20)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBe(event)
  })

  it('ignores other event types', () => {
    const handler = vi.fn()
    renderHook(() => useDocumentListener('mousemove', handler))

    mouseAt('mouseup')

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not subscribe while disabled, and subscribes when enabled', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useDocumentListener('mousemove', handler, enabled),
      { initialProps: { enabled: false } }
    )

    mouseAt('mousemove')
    expect(handler).not.toHaveBeenCalled()

    rerender({ enabled: true })
    mouseAt('mousemove')
    expect(handler).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })
    mouseAt('mousemove')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('uses the latest handler without resubscribing', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = renderHook(
      ({ handler }) => useDocumentListener('mousemove', handler),
      { initialProps: { handler: first } }
    )
    const subscriptionsAfterMount = add.mock.calls.filter((c) => c[0] === 'mousemove').length

    rerender({ handler: second })
    mouseAt('mousemove')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(add.mock.calls.filter((c) => c[0] === 'mousemove')).toHaveLength(subscriptionsAfterMount)
  })

  it('removes the listener on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useDocumentListener('mousemove', handler))

    unmount()
    mouseAt('mousemove')

    expect(handler).not.toHaveBeenCalled()
  })

  it('passes listener options through to add and remove', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const options = { capture: true }
    const handler = vi.fn()

    const { unmount } = renderHook(() => useDocumentListener('mousemove', handler, true, options))

    const added = add.mock.calls.find((c) => c[0] === 'mousemove')!
    expect(added[2]).toBe(options)

    unmount()
    const removed = remove.mock.calls.find((c) => c[0] === 'mousemove')!
    expect(removed[1]).toBe(added[1])
    expect(removed[2]).toBe(options)
  })
})

describe('useDragListeners', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const handlers = () => ({
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    onKeyDown: vi.fn(),
  })

  it('is silent until startListening is called', () => {
    const h = handlers()
    renderHook(() => useDragListeners(h))

    mouseAt('mousemove')
    mouseAt('mouseup')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(h.onMouseMove).not.toHaveBeenCalled()
    expect(h.onMouseUp).not.toHaveBeenCalled()
    expect(h.onKeyDown).not.toHaveBeenCalled()
  })

  it('routes move, up and keydown once listening', () => {
    const h = handlers()
    const { result } = renderHook(() => useDragListeners(h))

    act(() => result.current.startListening())

    const move = mouseAt('mousemove', 5, 6)
    const up = mouseAt('mouseup', 7, 8)
    const key = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(key)

    expect(h.onMouseMove).toHaveBeenCalledWith(move)
    expect(h.onMouseUp).toHaveBeenCalledWith(up)
    expect(h.onKeyDown).toHaveBeenCalledWith(key)
  })

  it('subscribes only to the handlers that were supplied', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const onMouseMove = vi.fn()
    const { result } = renderHook(() => useDragListeners({ onMouseMove }))

    act(() => result.current.startListening())

    const types = add.mock.calls.map((c) => c[0])
    expect(types).toContain('mousemove')
    expect(types).not.toContain('mouseup')
    expect(types).not.toContain('keydown')
  })

  it('ignores a second startListening so handlers do not double-fire', () => {
    const h = handlers()
    const { result } = renderHook(() => useDragListeners(h))

    act(() => {
      result.current.startListening()
      result.current.startListening()
    })
    mouseAt('mousemove')

    expect(h.onMouseMove).toHaveBeenCalledTimes(1)
  })

  it('stops routing events after stopListening', () => {
    const h = handlers()
    const { result } = renderHook(() => useDragListeners(h))

    act(() => result.current.startListening())
    act(() => result.current.stopListening())
    mouseAt('mousemove')
    mouseAt('mouseup')

    expect(h.onMouseMove).not.toHaveBeenCalled()
    expect(h.onMouseUp).not.toHaveBeenCalled()
  })

  it('ignores stopListening when it was never started', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { result } = renderHook(() => useDragListeners(handlers()))

    act(() => result.current.stopListening())

    expect(remove.mock.calls.filter((c) => c[0] === 'mousemove')).toHaveLength(0)
  })

  it('uses the latest handlers without restarting the drag', () => {
    const first = handlers()
    const second = handlers()
    const { result, rerender } = renderHook(({ h }) => useDragListeners(h), {
      initialProps: { h: first },
    })

    act(() => result.current.startListening())
    rerender({ h: second })
    mouseAt('mousemove')

    expect(first.onMouseMove).not.toHaveBeenCalled()
    expect(second.onMouseMove).toHaveBeenCalledTimes(1)
  })

  it('reports whether it is listening', () => {
    const { result, rerender } = renderHook(() => useDragListeners(handlers()))

    expect(result.current.isListening).toBe(false)
    act(() => result.current.startListening())
    rerender()
    expect(result.current.isListening).toBe(true)
  })

  it('detaches an active drag on unmount', () => {
    const h = handlers()
    const { result, unmount } = renderHook(() => useDragListeners(h))

    act(() => result.current.startListening())
    unmount()
    mouseAt('mousemove')
    mouseAt('mouseup')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

    expect(h.onMouseMove).not.toHaveBeenCalled()
    expect(h.onMouseUp).not.toHaveBeenCalled()
    expect(h.onKeyDown).not.toHaveBeenCalled()
  })

  it('leaves nothing to detach when unmounted without a drag', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useDragListeners(handlers()))

    unmount()

    expect(remove.mock.calls.filter((c) => c[0] === 'mousemove')).toHaveLength(0)
  })
})

describe('useWindowListener', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('delivers window events to the handler', () => {
    const handler = vi.fn()
    renderHook(() => useWindowListener('resize', handler))

    const event = new Event('resize')
    window.dispatchEvent(event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  it('does not subscribe while disabled', () => {
    const handler = vi.fn()
    renderHook(() => useWindowListener('resize', handler, false))

    window.dispatchEvent(new Event('resize'))

    expect(handler).not.toHaveBeenCalled()
  })

  it('uses the latest handler without resubscribing', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = renderHook(({ handler }) => useWindowListener('resize', handler), {
      initialProps: { handler: first },
    })
    const subscriptions = add.mock.calls.filter((c) => c[0] === 'resize').length

    rerender({ handler: second })
    window.dispatchEvent(new Event('resize'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(add.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(subscriptions)
  })

  it('passes options through and removes the listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const options = { passive: true }
    const handler = vi.fn()

    const { unmount } = renderHook(() => useWindowListener('resize', handler, true, options))
    const added = add.mock.calls.find((c) => c[0] === 'resize')!
    expect(added[2]).toBe(options)

    unmount()
    window.dispatchEvent(new Event('resize'))

    expect(handler).not.toHaveBeenCalled()
    const removed = remove.mock.calls.find((c) => c[0] === 'resize')!
    expect(removed[1]).toBe(added[1])
    expect(removed[2]).toBe(options)
  })
})
