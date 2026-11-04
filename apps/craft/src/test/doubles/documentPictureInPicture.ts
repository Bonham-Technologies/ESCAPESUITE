// Document Picture-in-Picture double (`window.documentPictureInPicture`), which
// jsdom does not have — and neither do Firefox or Safari, which is the case the
// app's own "API absent" branch covers by simply not installing this.
//
// Each window `requestWindow()` hands back is backed by a real jsdom iframe, so
// it has a real, separate `Document` that React can portal into and Testing
// Library can query, and a real `EventTarget` whose `keydown` and `pagehide`
// listeners genuinely fire. `close()` fires `pagehide` the way a browser does
// when a Picture-in-Picture window goes away, once.
//
// The page's own `window.focus()` — what the app calls to take focus back when
// the floating window closes — is a "Not implemented" in jsdom, so it is
// replaced with a counted no-op for as long as the double is installed.
import { vi, type Mock, type MockInstance } from 'vitest'

export interface FloatingWindowDouble {
  /** What `requestWindow()` resolved to — what the app holds. */
  readonly window: Window
  /** That window's document. */
  readonly document: Document
  /** Counted; fires `pagehide` the first time. */
  readonly close: Mock<() => void>
  /** True once `close()` has run. */
  readonly closed: boolean
  /** Press a key inside the window. */
  keydown(key: string): void
}

export interface DocumentPictureInPictureDouble {
  readonly requestWindow: Mock<(options: { width: number; height: number }) => Promise<Window>>
  /** Every window opened, oldest first. */
  readonly windows: FloatingWindowDouble[]
  last(): FloatingWindowDouble
  /** The page's `window.focus()`, counted. */
  readonly pageFocus: MockInstance<() => void>
  /** Remove the API and every iframe it created. */
  restore(): void
}

type WindowWithPip = Window & { documentPictureInPicture?: unknown }

export function installDocumentPictureInPicture(): DocumentPictureInPictureDouble {
  const windows: FloatingWindowDouble[] = []
  const frames: HTMLIFrameElement[] = []

  const requestWindow = vi.fn(async () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    frames.push(frame)
    // The iframe's own realm, so its events are its own `Event` / `KeyboardEvent`.
    const inner = frame.contentWindow! as Window & typeof globalThis
    let closed = false
    const close = vi.fn(() => {
      if (closed) return
      closed = true
      inner.dispatchEvent(new inner.Event('pagehide'))
    })
    const pipWindow = {
      document: inner.document,
      addEventListener: inner.addEventListener.bind(inner),
      removeEventListener: inner.removeEventListener.bind(inner),
      close,
    } as unknown as Window
    windows.push({
      window: pipWindow,
      document: inner.document,
      close,
      get closed() {
        return closed
      },
      keydown(key: string) {
        inner.dispatchEvent(new inner.KeyboardEvent('keydown', { key, bubbles: true }))
      },
    })
    return pipWindow
  })

  const pageFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})

  Object.defineProperty(window, 'documentPictureInPicture', {
    value: { requestWindow },
    configurable: true,
  })

  return {
    requestWindow,
    windows,
    last: () => windows[windows.length - 1],
    pageFocus,
    restore() {
      pageFocus.mockRestore()
      delete (window as WindowWithPip).documentPictureInPicture
      for (const frame of frames) frame.remove()
    },
  }
}
