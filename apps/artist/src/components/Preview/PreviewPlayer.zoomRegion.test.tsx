// Zoom to region through the real preview (ESCSUITE-475).
//
// `utils/zoomToRegion.test.ts` owns the arithmetic; this file owns the wiring:
// the box on the picture and the four fields are one box, Apply writes the
// whole zoom as one undo step, a refusal says why and writes nothing, and the
// tool closes the ways it should.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { imageSource, installPreviewDoubles, renderPreview, type PreviewDoubles } from '../../test/renderPreview'
import { zoomRegionTarget, regionCssBox } from './zoomRegionTarget'
import type { Clip } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** A 10 s media clip on the default 1920x1080 source, selected, with the tool open, the playhead at 2 s. */
function zoomingClip(): Clip {
  const clip = addClip('clip1', 0, 10)
  store().setSelectedClipId(clip.id)
  store().setCurrentTime(2)
  store().setZoomRegionClipId(clip.id)
  return clip
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const values = () => ['Region X', 'Region Y', 'Region width', 'Region height'].map((n) => Number(field(n).value))
const picker = () => screen.getByTestId('zoom-region-picker')
const box = () => picker().firstElementChild as HTMLElement

function commit(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } })
  fireEvent.keyDown(field(name), { key: 'Enter' })
}

/**
 * The preview with its canvas laid out at 960x540, half the project — told to
 * the picker's own ResizeObserver, as a browser would.
 */
async function openPreview() {
  const preview = await renderPreview()
  preview.resize({ width: 960, height: 540 })
  return preview
}

const keyframes = () => store().project.timeline.clips[0].animation?.keyframes

describe('Zoom to region on the preview', () => {
  it('opens with half the frame, centred, shown on the picture and in the fields', async () => {
    zoomingClip()
    await openPreview()

    expect(screen.getByRole('heading', { name: 'Zoom to region' })).toBeInTheDocument()
    expect(values()).toEqual([480, 270, 960, 540])
    // The canvas is laid out at 960x540, half the project: the box is in CSS pixels.
    expect(box().style.left).toBe('240px')
    expect(box().style.width).toBe('480px')
  })

  it('sets the box with the four fields, keeping the output aspect ratio', async () => {
    zoomingClip()
    await openPreview()

    commit('Region width', '640')
    expect(values()).toEqual([480, 270, 640, 360])
    commit('Region height', '180')
    expect(values()).toEqual([480, 270, 320, 180])
    commit('Region X', '1800')
    // Clamped so the box stays on the picture.
    expect(values()).toEqual([1600, 270, 320, 180])
    commit('Region Y', '5')
    expect(values()).toEqual([1600, 5, 320, 180])
    expect(box().style.top).toBe('2.5px')
  })

  it('draws a box with a drag on the picture', async () => {
    zoomingClip()
    await openPreview()

    // CSS (50, 50) is project (100, 100); the drag is 160 CSS px wide.
    fireEvent.mouseDown(picker(), { clientX: 50, clientY: 50, button: 0 })
    fireEvent.mouseMove(window, { clientX: 51, clientY: 50 })
    expect(values()).toEqual([480, 270, 960, 540]) // under the drag threshold
    fireEvent.mouseMove(window, { clientX: 210, clientY: 60 })
    fireEvent.mouseUp(window, { clientX: 210, clientY: 60 })
    expect(values()).toEqual([100, 100, 320, 180])

    // A move after the release draws nothing; a right button starts nothing.
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseDown(picker(), { clientX: 10, clientY: 10, button: 2 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    expect(values()).toEqual([100, 100, 320, 180])
  })

  it('applies the zoom as one undo step, and closes', async () => {
    zoomingClip()
    await openPreview()
    commit('Hold', '2')
    commit('Transition', '1')
    fireEvent.change(screen.getByLabelText('Easing'), { target: { value: 'ease-out' } })
    const before = store().history.past.length

    fireEvent.click(screen.getByRole('button', { name: 'Apply zoom' }))

    const written = keyframes()!
    for (const property of ['x', 'y', 'scaleX', 'scaleY'] as const) {
      expect(written[property]!.map((kf) => kf.time)).toEqual([2, 3, 5, 6])
      expect(written[property]![0].easing).toBe('ease-out')
    }
    expect(written.scaleX!.map((kf) => kf.value)).toEqual([1, 2, 2, 1])
    expect(store().history.past.length).toBe(before + 1)
    expect(store().zoomRegionClipId).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Zoom to region' })).toBeNull()

    act(() => store().undo())
    expect(keyframes()?.scaleX).toBeUndefined()
    act(() => store().redo())
    expect(keyframes()!.scaleX).toEqual(written.scaleX)
  })

  it('refuses with a reason, and writes nothing, when the zoom does not fit', async () => {
    zoomingClip()
    store().setCurrentTime(8)
    await openPreview()

    fireEvent.click(screen.getByRole('button', { name: 'Apply zoom' }))

    expect(screen.getByRole('alert').textContent).toBe(
      'The zoom takes 4.00 s, but the clip ends 2.00 s after the playhead. Move the playhead earlier, or shorten the hold or the transition.'
    )
    expect(keyframes()).toBeUndefined()
    expect(store().zoomRegionClipId).toBe('clip1')

    // Any change makes the reason stale.
    commit('Hold', '1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('refuses on a locked track', async () => {
    const clip = zoomingClip()
    store().updateTrack(clip.trackId, { locked: true })
    await openPreview()

    fireEvent.click(screen.getByRole('button', { name: 'Apply zoom' }))

    expect(screen.getByRole('alert').textContent).toMatch(/locked/)
    expect(keyframes()).toBeUndefined()
  })

  it('closes on Cancel and on Escape, writing nothing', async () => {
    const clip = zoomingClip()
    await openPreview()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(store().zoomRegionClipId).toBeNull()

    act(() => store().setZoomRegionClipId(clip.id))
    fireEvent.keyDown(field('Region X'), { key: 'Escape' })
    expect(store().zoomRegionClipId).toBeNull()
    expect(keyframes()).toBeUndefined()
  })

  it('takes focus from the inspector button that opens it, and gives it back on close', async () => {
    const clip = addClip('clip1', 0, 10)
    store().setSelectedClipId(clip.id)
    store().setCurrentTime(2)
    await openPreview()
    const toggle = document.createElement('button')
    toggle.setAttribute('data-zoom-region-toggle', '')
    document.body.appendChild(toggle)
    toggle.focus()

    act(() => store().setZoomRegionClipId(clip.id))
    expect(document.activeElement).toBe(field('Region X'))

    fireEvent.keyDown(field('Region X'), { key: 'Escape' })
    expect(store().zoomRegionClipId).toBeNull()
    expect(document.activeElement).toBe(toggle)

    // Shown again for another reason (here, straight from the store) with focus
    // elsewhere: focus stays where it is, open and closed.
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    act(() => store().setZoomRegionClipId(clip.id))
    expect(document.activeElement).toBe(elsewhere)
    act(() => store().setZoomRegionClipId(null))
    expect(document.activeElement).toBe(elsewhere)
    toggle.remove()
    elsewhere.remove()
  })

  it('ends a drag the tool closes in the middle of', async () => {
    zoomingClip()
    await openPreview()
    fireEvent.mouseDown(picker(), { clientX: 50, clientY: 50, button: 0 })
    fireEvent.mouseDown(picker(), { clientX: 60, clientY: 60, button: 0 }) // a second press restarts it

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })

    act(() => store().setZoomRegionClipId('clip1'))
    expect(values()).toEqual([480, 270, 960, 540])
  })

  it('takes the canvas’ own pointer handling away, and hides the box while playing', async () => {
    zoomingClip()
    const preview = await openPreview()

    fireEvent.mouseDown(preview.canvas, { clientX: 480, clientY: 270 })
    fireEvent.mouseMove(preview.canvas, { clientX: 600, clientY: 300 })
    fireEvent.mouseUp(preview.canvas)
    expect(store().project.timeline.clips[0].transform.x).toBe(0.5)

    act(() => store().setIsPlaying(true))
    expect(screen.queryByTestId('zoom-region-picker')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Zoom to region' })).toBeInTheDocument()
  })

  it('shows no box, and refuses, when the clip is not in the frame', async () => {
    const clip = zoomingClip()
    store().updateClipTransform(clip.id, { x: 3 })
    await openPreview()

    expect(picker().firstElementChild).toBeNull()
    expect(values()).toEqual([0, 0, 0, 0])
    fireEvent.click(screen.getByRole('button', { name: 'Apply zoom' }))
    expect(screen.getByRole('alert').textContent).toBe('The clip is not in the frame at the playhead.')
  })
})

describe('zoomRegionTarget', () => {
  const scene = (clip: Clip, overrides = {}) => ({
    clips: [clip],
    sourceVideos: store().sourceVideos,
    tracks: store().project.timeline.tracks,
    zoomRegionClipId: clip.id,
    selectedClipId: clip.id,
    ...overrides,
  })

  it('is the selected video clip the latch names', () => {
    const clip = addClip('clip1', 0, 4)
    expect(zoomRegionTarget(scene(clip))?.clip).toBe(clip)
  })

  it('is nothing for another selection, no latch, a hidden track, a missing source or an image', () => {
    const clip = addClip('clip1', 0, 4)
    expect(zoomRegionTarget(scene(clip, { selectedClipId: 'other' }))).toBeNull()
    expect(zoomRegionTarget(scene(clip, { zoomRegionClipId: null }))).toBeNull()
    expect(zoomRegionTarget(scene(clip, { clips: [] }))).toBeNull()
    expect(zoomRegionTarget(scene(clip, { tracks: [] }))).toBeNull()
    expect(zoomRegionTarget(scene(clip, { sourceVideos: [] }))).toBeNull()
    expect(zoomRegionTarget(scene({ ...clip, sourceVideoId: imageSource.id }, { sourceVideos: [imageSource] }))).toBeNull()
    expect(
      zoomRegionTarget(scene(clip, { sourceVideos: [{ ...store().sourceVideos[0], mediaType: 'audio' }] }))
    ).toBeNull()
  })

  it('regionCssBox scales a project box into CSS pixels', () => {
    expect(
      regionCssBox({ x: 100, y: 50, width: 400, height: 200 }, { width: 960, height: 540, offsetX: 0, offsetY: 0, scaleX: 0.5, scaleY: 0.5 })
    ).toEqual({ x: 50, y: 25, width: 200, height: 100 })
  })
})
