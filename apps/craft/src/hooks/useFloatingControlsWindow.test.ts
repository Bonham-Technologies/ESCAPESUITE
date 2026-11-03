// The "Float controls" window's lifecycle (ESCSUITE-400): whether it can be
// offered at all, what it is opened with, what its document is given, and what
// closing it does — and does not do.
//
// The Document Picture-in-Picture API is the browser's boundary, so it is the
// one thing doubled (`test/doubles/documentPictureInPicture.ts`, real jsdom
// iframes underneath); the hook itself runs for real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  canFloatControls,
  useFloatingControlsWindow,
  FLOATING_WINDOW_SIZE,
  FLOATING_WINDOW_TITLE,
} from './useFloatingControlsWindow'
import {
  installDocumentPictureInPicture,
  type DocumentPictureInPictureDouble,
} from '../test/doubles/documentPictureInPicture'

let pip: DocumentPictureInPictureDouble | null = null

beforeEach(() => {
  pip = null
})

afterEach(() => {
  pip?.restore()
  document.head.querySelectorAll('[data-test-style]').forEach((node) => node.remove())
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.lang = ''
  vi.restoreAllMocks()
})

async function openWindow(result: { current: ReturnType<typeof useFloatingControlsWindow> }) {
  act(() => result.current.toggle())
  await waitFor(() => expect(result.current.floatingWindow).not.toBeNull())
  return pip!.last()
}

describe('canFloatControls', () => {
  it('is false where the browser has no Document Picture-in-Picture', () => {
    expect('documentPictureInPicture' in window).toBe(false)
    expect(canFloatControls()).toBe(false)
    const { result } = renderHook(() => useFloatingControlsWindow())
    expect(result.current.supported).toBe(false)
  })

  it('is true at the top level of a browser that has it', () => {
    pip = installDocumentPictureInPicture()
    expect(canFloatControls()).toBe(true)
  })

  it('is false inside an iframe, where requestWindow() would throw', () => {
    pip = installDocumentPictureInPicture()
    const originalParent = window.parent
    Object.defineProperty(window, 'parent', { value: {}, configurable: true })
    try {
      expect(canFloatControls()).toBe(false)
    } finally {
      Object.defineProperty(window, 'parent', { value: originalParent, configurable: true })
    }
  })
})

describe('useFloatingControlsWindow', () => {
  it('asks for a window no bigger than 360x160', async () => {
    pip = installDocumentPictureInPicture()
    const { result } = renderHook(() => useFloatingControlsWindow())
    expect(result.current.supported).toBe(true)
    expect(result.current.floatingWindow).toBeNull()

    const opened = await openWindow(result)

    expect(FLOATING_WINDOW_SIZE).toEqual({ width: 360, height: 160 })
    expect(pip.requestWindow).toHaveBeenCalledTimes(1)
    expect(pip.requestWindow).toHaveBeenCalledWith({ width: 360, height: 160 })
    expect(result.current.floatingWindow).toBe(opened.window)
  })

  it("gives the window the page's stylesheets, in order, plus a language and a title", async () => {
    const style = document.createElement('style')
    style.dataset.testStyle = ''
    style.textContent = '.a { color: red; }'
    const link = document.createElement('link')
    link.dataset.testStyle = ''
    link.rel = 'stylesheet'
    link.href = 'data:text/css,.b%7Bcolor:blue%7D'
    document.head.append(style, link)
    pip = installDocumentPictureInPicture()
    const { result } = renderHook(() => useFloatingControlsWindow())

    const opened = await openWindow(result)

    const copied = [...opened.document.head.querySelectorAll('style, link[rel="stylesheet"]')]
    const own = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
    expect(copied.map((node) => node.outerHTML)).toEqual(own.map((node) => node.outerHTML))
    expect(copied.some((node) => node.textContent === '.a { color: red; }')).toBe(true)
    expect(copied.every((node) => node.ownerDocument === opened.document)).toBe(true)
    expect(opened.document.documentElement.lang).toBe('en')
    expect(opened.document.title).toBe(FLOATING_WINDOW_TITLE)
  })

  it("uses the page's own language when it has one", async () => {
    document.documentElement.lang = 'fr'
    pip = installDocumentPictureInPicture()
    const { result } = renderHook(() => useFloatingControlsWindow())

    const opened = await openWindow(result)

    expect(opened.document.documentElement.lang).toBe('fr')
  })

  it("follows the page's theme while it is open", async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    pip = installDocumentPictureInPicture()
    const { result } = renderHook(() => useFloatingControlsWindow())

    const opened = await openWindow(result)
    const root = opened.document.documentElement
    expect(root.getAttribute('data-theme')).toBe('light')

    document.documentElement.removeAttribute('data-theme')
    await waitFor(() => expect(root.hasAttribute('data-theme')).toBe(false))

    document.documentElement.setAttribute('data-theme', 'light')
    await waitFor(() => expect(root.getAttribute('data-theme')).toBe('light'))
  })

  it('closes the window when toggled again, and hands focus back to the page', async () => {
    pip = installDocumentPictureInPicture()
    const focus = pip.pageFocus
    const { result } = renderHook(() => useFloatingControlsWindow())
    const opened = await openWindow(result)

    act(() => result.current.toggle())

    expect(opened.close).toHaveBeenCalled()
    expect(opened.closed).toBe(true)
    expect(result.current.floatingWindow).toBeNull()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(pip.requestWindow).toHaveBeenCalledTimes(1)
  })

  it("lets go of the window when it is closed from its own close button", async () => {
    pip = installDocumentPictureInPicture()
    const focus = pip.pageFocus
    const { result } = renderHook(() => useFloatingControlsWindow())
    const opened = await openWindow(result)

    act(() => opened.close())

    expect(result.current.floatingWindow).toBeNull()
    expect(focus).toHaveBeenCalledTimes(1)

    // And it can be floated again.
    const reopened = await openWindow(result)
    expect(reopened).not.toBe(opened)
    expect(pip.requestWindow).toHaveBeenCalledTimes(2)
  })

  it('stops following the theme once the window is gone', async () => {
    pip = installDocumentPictureInPicture()
    const { result } = renderHook(() => useFloatingControlsWindow())
    const opened = await openWindow(result)
    act(() => opened.close())

    document.documentElement.setAttribute('data-theme', 'light')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(opened.document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('stays closed, and says why in the console, when the browser refuses the window', async () => {
    pip = installDocumentPictureInPicture()
    const refusal = new DOMException('no user activation', 'NotAllowedError')
    pip.requestWindow.mockRejectedValueOnce(refusal)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useFloatingControlsWindow())

    act(() => result.current.toggle())

    await waitFor(() => expect(warn).toHaveBeenCalledWith('Could not open the floating controls window', refusal))
    expect(result.current.floatingWindow).toBeNull()
  })

  it('closes the window when the app unmounts', async () => {
    pip = installDocumentPictureInPicture()
    const { result, unmount } = renderHook(() => useFloatingControlsWindow())
    const opened = await openWindow(result)

    unmount()

    expect(opened.closed).toBe(true)
  })

  it('closes a window that finishes opening after the app has unmounted', async () => {
    pip = installDocumentPictureInPicture()
    let resolveWindow: (value: Window) => void = () => {}
    const realRequest = pip.requestWindow.getMockImplementation()!
    pip.requestWindow.mockImplementationOnce(
      () => new Promise<Window>((resolve) => (resolveWindow = resolve))
    )
    const { result, unmount } = renderHook(() => useFloatingControlsWindow())

    act(() => result.current.toggle())
    unmount()
    const late = await realRequest({ width: 360, height: 160 })
    await act(async () => resolveWindow(late))

    expect(pip.last().closed).toBe(true)
    expect(pip.last().document.head.childElementCount).toBe(0)
  })
})
