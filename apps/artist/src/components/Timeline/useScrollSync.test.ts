// The three panes, and what keeps them together.
//
// jsdom performs no layout and no scrolling, but it does store what is assigned
// to scrollLeft/scrollTop, which is all this hook reads and writes — so the
// mirroring can be driven for real here by setting one pane's offset and
// calling the handler the DOM would have called.
//
// The width half needs a ResizeObserver, which jsdom has none of; the recording
// double stands in, and delivers the resize entry a browser would.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrollSync, type ScrollSyncDeps } from './useScrollSync'
import { installResizeObserverDouble, type ResizeObserverDouble } from '../../test/doubles/resizeObserver'

let resizeObserver: ResizeObserverDouble

beforeEach(() => {
  resizeObserver = installResizeObserverDouble()
})

afterEach(() => {
  resizeObserver.uninstall()
  vi.clearAllMocks()
})

/** A div reporting `clientWidth`, which jsdom otherwise pins at 0. */
function pane(clientWidth = 0): HTMLDivElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  return el
}

interface Panes {
  container: HTMLDivElement | null
  ruler: HTMLDivElement | null
  headers: HTMLDivElement | null
}

function mountSync(panes: Partial<Panes> = {}) {
  const container = 'container' in panes ? panes.container! : pane(640)
  const ruler = 'ruler' in panes ? panes.ruler! : pane()
  const headers = 'headers' in panes ? panes.headers! : pane()

  const deps: ScrollSyncDeps = {
    trackContainerRef: { current: container },
    rulerRef: { current: ruler },
    trackHeadersRef: { current: headers },
    onVirtualScroll: vi.fn(),
    setContainerWidth: vi.fn(),
  }

  return { container, ruler, headers, deps, ...renderHook(() => useScrollSync(deps)) }
}

describe('useScrollSync mirroring', () => {
  it('sends the track area’s horizontal offset to the ruler and its vertical one to the headers', () => {
    const { container, ruler, headers, deps, result } = mountSync()
    container!.scrollLeft = 120
    container!.scrollTop = 45

    result.current.handleTrackScroll()

    expect(ruler!.scrollLeft).toBe(120)
    expect(headers!.scrollTop).toBe(45)
    expect(deps.onVirtualScroll).toHaveBeenCalledWith(120)
  })

  it('still tells the virtualiser when the ruler and headers are not mounted', () => {
    const { container, deps, result } = mountSync({ ruler: null, headers: null })
    container!.scrollLeft = 80

    result.current.handleTrackScroll()

    expect(deps.onVirtualScroll).toHaveBeenCalledWith(80)
  })

  it('does nothing at all without a track area', () => {
    const { ruler, deps, result } = mountSync({ container: null })

    result.current.handleTrackScroll()

    expect(ruler!.scrollLeft).toBe(0)
    expect(deps.onVirtualScroll).not.toHaveBeenCalled()
  })

  it('sends the headers’ own scrolling back to the track area', () => {
    const { container, headers, result } = mountSync()
    headers!.scrollTop = 33

    result.current.handleHeadersScroll()

    expect(container!.scrollTop).toBe(33)
  })

  it('ignores a headers scroll when either pane is missing', () => {
    const withoutContainer = mountSync({ container: null })
    withoutContainer.headers!.scrollTop = 12
    withoutContainer.result.current.handleHeadersScroll()

    const withoutHeaders = mountSync({ headers: null })
    withoutHeaders.result.current.handleHeadersScroll()

    expect(withoutHeaders.container!.scrollTop).toBe(0)
  })
})

describe('useScrollSync container width', () => {
  it('reports the track area’s starting width and watches it', () => {
    const { container, deps } = mountSync()

    expect(deps.setContainerWidth).toHaveBeenCalledWith(640)
    expect(resizeObserver.observed).toEqual([container])
  })

  it('reports the width of every entry a resize delivers', () => {
    const { container, deps } = mountSync()

    resizeObserver.emit(container!, { width: 900, height: 200 })

    expect(deps.setContainerWidth).toHaveBeenLastCalledWith(900)
    expect(deps.setContainerWidth).toHaveBeenCalledTimes(2)
  })

  it('stops observing when the timeline unmounts', () => {
    const { unmount } = mountSync()
    expect(resizeObserver.disconnected).toBe(0)

    unmount()

    expect(resizeObserver.disconnected).toBe(1)
  })

  it('observes nothing when there is no track area to measure', () => {
    const { deps } = mountSync({ container: null })

    expect(deps.setContainerWidth).not.toHaveBeenCalled()
    expect(resizeObserver.observed).toEqual([])
  })
})
