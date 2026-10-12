// Every way of pausing playback lands on the frame the preview was showing
// (ESCSUITE-281), with the preview, the transport and the timeline mounted
// together the way the app mounts them.
//
// The render loop writes the playback position into the store only every
// 200 ms, and pausing wrote no position at all, so Space, the Pause button and
// a grab of the playhead (ESCSUITE-246) each resumed from up to 200 ms plus a
// frame behind what the readout showed. The loop now publishes the last frame
// it drew once, as it stops. A pause that comes with a seek — a ruler click,
// Home — keeps the seek's target.
//
// The track container's and the ruler's left edges are at client X 0 and one
// second is 50px, so client X 300 is 6s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PreviewPlayer } from './PreviewPlayer'
import { PlaybackControls } from './PlaybackControls'
import { Timeline } from '../Timeline/Timeline'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import { FRAME_MS, installPreviewDoubles, settle, type PreviewDoubles } from '../../test/renderPreview'
import styles from '../Timeline/Timeline.module.css'

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(async () => {
  // Stop the animation loop before unmounting, so no frame is left in flight.
  if (store().isPlaying) {
    store().setIsPlaying(false)
    await settle(20)
  }
  cleanup()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** One frame at the fastest rate the preview targets. */
const ONE_FRAME_S = 1 / 60

interface Editor {
  playhead: HTMLElement
  ruler: HTMLElement
  getByTitle: (title: string) => HTMLElement
}

/** The preview, the transport and the timeline, with the timeline's panes given a layout box. */
async function renderEditor(): Promise<Editor> {
  const view = render(
    <>
      <PreviewPlayer />
      <PlaybackControls />
      <Timeline />
    </>
  )
  // The preview's media load is async, and its post-load redraw is debounced.
  await settle()
  await settle(60)

  const { container } = view
  const trackContainer = container.querySelector(`.${styles.trackContainer}`) as HTMLElement
  const ruler = container.querySelector(`.${styles.ruler}`) as HTMLElement
  setRect(trackContainer, { left: 0, top: 0, width: 1000, height: 200 })
  setRect(ruler, { left: 0, top: 0, width: 1000, height: 30 })
  const playhead = container.querySelector('[data-playhead]') as HTMLElement
  return { playhead, ruler, getByTitle: view.getByTitle }
}

/**
 * Play from 0 for 1.15 s of wall clock. With the harness's 16 ms frames the
 * loop's 200 ms store writes land at 0.208, 0.416, … 1.04 and next at 1.248,
 * so at 1.15 s the old store value is 1.04 — about 0.1 s behind the frame.
 */
async function playFor1150ms(): Promise<void> {
  store().setIsPlaying(true)
  await settle(1150)
  expect(store().isPlaying).toBe(true)
}

/** Within one frame of 1.15 s, and not ahead of it. */
function expectWithinOneFrameOf1150ms(): void {
  expect(store().currentTime).toBeGreaterThanOrEqual(1.15 - ONE_FRAME_S)
  expect(store().currentTime).toBeLessThanOrEqual(1.15)
}

describe('pausing lands on the frame shown (ESCSUITE-281)', () => {
  it('Space', async () => {
    addClip('clip1', 0, 10)
    await renderEditor()
    await playFor1150ms()

    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    await settle(0)

    expect(store().isPlaying).toBe(false)
    expectWithinOneFrameOf1150ms()
  })

  it('the Pause button', async () => {
    addClip('clip1', 0, 10)
    const { getByTitle } = await renderEditor()
    await playFor1150ms()

    fireEvent.click(getByTitle('Pause (Space)'))
    await settle(0)

    expect(store().isPlaying).toBe(false)
    expectWithinOneFrameOf1150ms()
  })

  it('a grab of the playhead, and a release with no move resumes from there', async () => {
    addClip('clip1', 0, 10)
    const { playhead } = await renderEditor()
    await playFor1150ms()

    fireEvent.mouseDown(playhead)
    await settle(0)

    expect(store().isPlaying).toBe(false)
    expectWithinOneFrameOf1150ms()
    const grabbedAt = store().currentTime

    fireEvent.mouseUp(document)
    await settle(0)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBe(grabbedAt)
  })

  it('a ruler click during playback lands exactly on the clicked time', async () => {
    addClip('clip1', 0, 10)
    const { ruler } = await renderEditor()
    await playFor1150ms()

    fireEvent.click(ruler, { clientX: 300 })
    await settle(100)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(6)
  })

  it('Home during playback lands exactly on 0', async () => {
    addClip('clip1', 0, 10)
    await renderEditor()
    await playFor1150ms()

    fireEvent.keyDown(window, { code: 'Home', key: 'Home' })
    await settle(100)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(0)
  })
})

// ESCSUITE-287: the loop's pause write yielded to a same-batch seek only when
// the seek changed the store's value. A seek to the value the store already
// holds — inside the loop's 200 ms throttle window, where the store still has
// the position playback started from or looped back to — looked like a plain
// pause, and the frame time overwrote it. Every seeker now counts itself in
// the store's seek sequence, and the pause write yields to any seek at all.
describe('a seek to the time the store already holds still lands (ESCSUITE-287)', () => {
  it('Home within the first 200 ms of playing from 0 lands on 0', async () => {
    addClip('clip1', 0, 10)
    await renderEditor()
    store().setIsPlaying(true)
    await settle(100)
    // The loop has drawn ahead of 0 but not yet written the store.
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBe(0)

    fireEvent.keyDown(window, { code: 'Home', key: 'Home' })
    await settle(100)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(0)
  })

  it('a marker on the in point, clicked within 200 ms of a loop-back, lands on the in point', async () => {
    addClip('clip1', 0, 10)
    store().setLoopPlayback(true)
    store().setInPoint(1)
    store().setOutPoint(2)
    store().addMarker(1)
    store().setCurrentTime(1.9)
    await renderEditor()
    store().setIsPlaying(true)
    // 1.9 + 7 frames of 16 ms crosses the out point and loops back to 1; the
    // frames after it run on to about 1.09, short of the next 200 ms write.
    await settle(FRAME_MS * 7 + 90)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /^Marker / }))
    await settle(100)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(1)
  })
})
