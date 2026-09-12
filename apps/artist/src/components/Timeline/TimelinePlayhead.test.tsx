// The playhead line, and the reason it is a component of its own.
//
// Playback writes `currentTime` to the store about every 200 ms. TimelinePlayhead
// and TimelineTimeReadout subscribe to it themselves so that those writes repaint
// two small elements instead of the whole timeline; the last describe here is the
// test that holds that property in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimelinePlayhead } from './TimelinePlayhead'
import { Timeline } from './Timeline'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { installResizeObserverDouble, type ResizeObserverDouble } from '../../test/doubles/resizeObserver'
import * as virtualized from '../../hooks/useVirtualizedTimeline'
import styles from './Timeline.module.css'

const playhead = (root: ParentNode) => root.querySelector('[data-playhead]') as HTMLElement

describe('TimelinePlayhead', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('positions itself at currentTime × pixelsPerSecond', () => {
    store().setCurrentTime(3)
    const { container } = render(
      <TimelinePlayhead pixelsPerSecond={50} height={120} onMouseDown={() => {}} />
    )

    expect(playhead(container).style.left).toBe('150px')
  })

  it('scales with pixelsPerSecond', () => {
    store().setCurrentTime(3)
    const { container } = render(
      <TimelinePlayhead pixelsPerSecond={200} height={120} onMouseDown={() => {}} />
    )

    expect(playhead(container).style.left).toBe('600px')
  })

  it('spans the height it is given', () => {
    const { container } = render(
      <TimelinePlayhead pixelsPerSecond={50} height={264} onMouseDown={() => {}} />
    )

    expect(playhead(container).style.height).toBe('264px')
  })

  it('carries the playhead class and its head and line', () => {
    const { container } = render(
      <TimelinePlayhead pixelsPerSecond={50} height={120} onMouseDown={() => {}} />
    )

    const el = playhead(container)
    expect(el.className).toBe(styles.playhead)
    expect(el.querySelector(`.${styles.playheadHead}`)).not.toBeNull()
    expect(el.querySelector(`.${styles.playheadLine}`)).not.toBeNull()
  })

  it("moves when the store's playhead moves, with no new props", () => {
    const { container } = render(
      <TimelinePlayhead pixelsPerSecond={50} height={120} onMouseDown={() => {}} />
    )
    expect(playhead(container).style.left).toBe('0px')

    store().setCurrentTime(7)

    expect(playhead(container).style.left).toBe('350px')
  })
})

describe('a playback tick re-renders the playhead and the readout, not the timeline', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 10)
  })

  afterEach(() => {
    resizeObserver.uninstall()
    vi.restoreAllMocks()
  })

  it('runs the Timeline body at most once across ten setCurrentTime writes', () => {
    // useVirtualizedTimeline is called once per Timeline render and by nothing
    // else in this tree, so a pass-through spy on it counts Timeline renders.
    // (A React Profiler cannot: it reports every commit in its subtree, which
    // includes the playhead's own.)
    const timelineRenders = vi.spyOn(virtualized, 'useVirtualizedTimeline')
    const { container } = render(<Timeline />)
    const mountRenders = timelineRenders.mock.calls.length

    for (let i = 1; i <= 10; i++) {
      store().setCurrentTime(i * 0.2)
    }

    expect(timelineRenders.mock.calls.length - mountRenders).toBeLessThanOrEqual(1)
    // …and the two subscribed elements did follow the playhead.
    expect(playhead(container).style.left).toBe('100px')
    expect(screen.getByText(/0:02 \/ 0:10/)).toBeInTheDocument()
  })

  it('does re-render the Timeline body when something it reads changes', () => {
    const timelineRenders = vi.spyOn(virtualized, 'useVirtualizedTimeline')
    render(<Timeline />)
    const mountRenders = timelineRenders.mock.calls.length

    store().setZoom(2)

    expect(timelineRenders.mock.calls.length).toBeGreaterThan(mountRenders)
  })
})
