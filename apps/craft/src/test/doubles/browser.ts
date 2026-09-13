// Test doubles for the browser behaviours jsdom leaves unimplemented on the
// prototypes themselves: HTMLMediaElement playback, navigation from an anchor
// click, and window.open. Each one logs a "Not implemented" error in jsdom
// rather than doing anything, so every suite that renders a player, a download
// button or the header's "Open Editor" needs them standing up.
//
// This is the counterpart to `video.ts`, which doubles the *elements* code
// under test creates; these are prototype-level stubs that apply to every
// element the render produced, including the ones React made.
import { vi } from 'vitest'

/** One `<a download>` click the app made, as the anchor described it. */
export interface DownloadAttempt {
  href: string
  download: string
}

export interface BrowserStubs {
  /** Every <a download> the app clicked. */
  readonly downloads: DownloadAttempt[]
  /** window.open spy — the header's "Open Editor" button. */
  readonly open: ReturnType<typeof vi.spyOn>
  restore(): void
}

/**
 * jsdom implements neither HTMLMediaElement playback, nor navigation from an
 * anchor click, nor window.open — each one logs a "Not implemented" error
 * instead. Stand them all up, recording what the app asked for.
 */
export function installBrowserStubs(): BrowserStubs {
  const downloads: DownloadAttempt[] = []

  const mediaDescriptors: Record<string, PropertyDescriptor | undefined> = {}
  for (const name of ['play', 'pause', 'load'] as const) {
    mediaDescriptors[name] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name)
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() })

  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })

  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

  return {
    downloads,
    open: openSpy,
    restore() {
      for (const [name, descriptor] of Object.entries(mediaDescriptors)) {
        if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, name, descriptor)
        else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[name]
      }
      clickSpy.mockRestore()
      openSpy.mockRestore()
    },
  }
}
