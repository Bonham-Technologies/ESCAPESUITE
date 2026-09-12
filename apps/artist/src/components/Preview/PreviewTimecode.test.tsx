// The readout renders what it is told, when it is told, and lets go on unmount.
//
// The throttle itself lives in the render loop (see usePreviewRenderLoop.test),
// so what is left to prove here is the subscription contract: it paints the
// published position, it repaints on a notification, it does not repaint
// without one, and it removes its listener when it goes away — a listener left
// behind would keep a dead component's setState alive for the whole session.
import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PreviewTimecode } from './PreviewTimecode'

/** The smallest thing shaped like the render loop's display-time publisher. */
function publisher(initial = 0) {
  const listeners = new Set<() => void>()
  let time = initial
  return {
    listenerCount: () => listeners.size,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getTime: () => time,
    /** Move the playhead without telling anyone — the un-notified case. */
    set(next: number) {
      time = next
    },
    publish(next: number) {
      time = next
      act(() => {
        for (const listener of listeners) listener()
      })
    },
  }
}

describe('PreviewTimecode', () => {
  it('shows the published position as a timecode', () => {
    const source = publisher(1.5)

    render(<PreviewTimecode subscribe={source.subscribe} getTime={source.getTime} />)

    expect(screen.getByText('00:01.500')).toBeInTheDocument()
  })

  it('repaints when the loop publishes a new position', () => {
    const source = publisher(0)

    render(<PreviewTimecode subscribe={source.subscribe} getTime={source.getTime} />)
    source.publish(2.25)

    expect(screen.getByText('00:02.250')).toBeInTheDocument()
  })

  it('takes the class name it is given', () => {
    const source = publisher(0)

    render(
      <PreviewTimecode subscribe={source.subscribe} getTime={source.getTime} className="tc" />
    )

    expect(screen.getByText('00:00.000')).toHaveClass('tc')
  })

  it('unsubscribes on unmount', () => {
    const source = publisher(0)

    const { unmount } = render(
      <PreviewTimecode subscribe={source.subscribe} getTime={source.getTime} />
    )
    expect(source.listenerCount()).toBe(1)

    unmount()

    expect(source.listenerCount()).toBe(0)
    // And a later publish reaches nobody.
    source.set(3)
    expect(source.listenerCount()).toBe(0)
  })
})
