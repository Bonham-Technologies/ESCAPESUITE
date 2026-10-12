// A playhead drag over a playing project, with the preview's render loop
// running beside the timeline the way the app mounts them (ESCSUITE-246).
//
// The loop writes the playback position into the store while it plays, so a
// scrub that did not pause was overwritten within a few frames of release and
// the playhead snapped back to wherever playback had got to. The scrub pauses
// for its own length and resumes from where the pointer let go.
//
// The track container's left edge is at client X 0 and one second is 50px, so
// client X 300 is 6s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import { PreviewPlayer } from '../Preview/PreviewPlayer'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import { FRAME_MS, installPreviewDoubles, settle, type PreviewDoubles } from '../../test/renderPreview'
import styles from './Timeline.module.css'

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

/** The preview and the timeline together, with the timeline's panes given a layout box. */
async function renderEditor(): Promise<{ playhead: HTMLElement }> {
  const { container } = render(
    <>
      <PreviewPlayer />
      <Timeline />
    </>
  )
  // The preview's media load is async, and its post-load redraw is debounced.
  await settle()
  await settle(60)

  const trackContainer = container.querySelector(`.${styles.trackContainer}`) as HTMLElement
  const ruler = container.querySelector(`.${styles.ruler}`) as HTMLElement
  setRect(trackContainer, { left: 0, top: 0, width: 1000, height: 200 })
  setRect(ruler, { left: 0, top: 0, width: 1000, height: 30 })
  const playhead = container.querySelector('[data-playhead]') as HTMLElement
  return { playhead }
}

describe('Timeline playhead drag during playback', () => {
  it('leaves the playhead where the pointer let go, and plays on from there', async () => {
    addClip('clip1', 0, 10)
    const { playhead } = await renderEditor()

    store().setIsPlaying(true)
    await settle(1000)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeLessThan(1.5)

    fireEvent.mouseDown(playhead)
    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseUp(document)

    // One more animation frame: the loop has run again, and the playhead is
    // still where it was dropped.
    await settle(FRAME_MS)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBe(6)

    // And playback carries on from the drop point rather than from where it
    // was before the drag.
    await settle(300)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeGreaterThanOrEqual(6)
    expect(store().currentTime).toBeLessThan(6.5)
  })

  // ESCSUITE-280: the release resumes playback, and a resume in a gap between
  // clips used to park the playhead on the next clip's start, "playing" and
  // never advancing.
  it('plays on from the next clip when the pointer lets go in a gap', async () => {
    addClip('first', 0, 4)
    addClip('second', 8, 4)
    const { playhead } = await renderEditor()

    store().setIsPlaying(true)
    await settle(1000)

    fireEvent.mouseDown(playhead)
    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseUp(document)

    await settle(500)
    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeGreaterThan(8)
    expect(store().currentTime).toBeLessThan(8.6)
  })

  it('leaves a paused project paused after a drag', async () => {
    addClip('clip1', 0, 10)
    const { playhead } = await renderEditor()

    fireEvent.mouseDown(playhead)
    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseUp(document)
    await settle(300)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(6)
  })
})
