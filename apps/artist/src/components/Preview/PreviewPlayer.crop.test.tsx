// Crop mode through the real preview (ESCSUITE-157).
//
// `cropOverlay.test.ts` owns the numbers; this file owns the wiring: that the
// crop chrome REPLACES the transform chrome, that the canvas' own pointer
// handling is off while it is on, that the handles are mounted, and that all of
// it disappears the four ways crop mode can be off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  imageSource,
  installPreviewDoubles,
  renderPreview,
  type Preview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { CROP_DIM_ALPHA, CROP_VEIL_FILL } from './cropOverlay'
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

/** A media clip on the default 1920x1080 source, selected, with crop mode on. */
function croppingClip(): Clip {
  const clip = addClip('clip1', 0, 4)
  store().setSelectedClipId(clip.id)
  store().setCropClipId(clip.id)
  return clip
}

/** The same, on an IMAGE source — the other arm of the chrome's element lookup. */
function croppingImageClip(): Clip {
  store().addSourceVideo(imageSource)
  store().addClipToTimeline(
    { id: 'pic', sourceVideoId: imageSource.id, name: 'pic', startTime: 0, endTime: 4, duration: 4 },
    store().project.timeline.tracks[0].id,
    0
  )
  const clip = store().project.timeline.clips.find((c) => c.id === 'pic')!
  store().setSelectedClipId(clip.id)
  store().setCropClipId(clip.id)
  return clip
}

/**
 * The crop chrome's own dim pass, picked out of a recording that also holds the
 * composited frame's draws: the frame uses the nine-argument `drawImage` at full
 * alpha, the chrome the five-argument one at {@link CROP_DIM_ALPHA}.
 */
const dimDraws = (preview: Preview) =>
  preview.calls('drawImage').filter((c) => c.state.globalAlpha === CROP_DIM_ALPHA)

/** The chrome's veil fallback — the fill it uses when there is nothing to draw. */
const veilFills = (preview: Preview) =>
  preview.calls('fillRect').filter((c) => c.state.fillStyle === CROP_VEIL_FILL)

describe('crop mode on the preview', () => {
  it('draws the crop chrome instead of the transform handles', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    // The dim pass' clip() is the crop chrome's signature; the rotation grip's
    // arc() is the transform chrome's.
    expect(preview.calls('clip')).toHaveLength(1)
    expect(preview.calls('arc')).toHaveLength(0)
  })

  it('draws the transform handles once crop mode is off again', async () => {
    const clip = croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCropClipId(null)

    expect(preview.calls('clip')).toHaveLength(0)
    expect(preview.calls('arc').length).toBeGreaterThan(0)
    expect(store().selectedClipId).toBe(clip.id)
  })

  // Task 4 replaces this with the live assertion — it is the red step of that
  // task's own brief, and `CropHandles` is a shell returning null until then.
  // The body cannot be written here without shipping Task 4's component, and a
  // task may not leave this package's suite red for the next one, so it is a
  // todo rather than a failing case:
  //
  //   croppingClip(); const preview = await renderPreview()
  //   getByRole('group',  { name: 'Crop handles' })
  //   getByRole('button', { name: 'Crop top left' })
  //   getByRole('button', { name: 'Crop bottom right' })
  it.todo('mounts eight named handles over the canvas')

  it('dims a video clip from the <video> the preview decoded', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    const [dim] = dimDraws(preview)
    expect(dim.args[0]).toBe(doubles.media.videos[0])
    expect(veilFills(preview)).toHaveLength(0)
  })

  it('dims an image clip from its decoded <img>', async () => {
    // The image arm of the chrome's element lookup: an image source draws from
    // `imageElementsRef`, not from the video map, which would always veil.
    croppingImageClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    const [dim] = dimDraws(preview)
    expect(dim.args[0]).toBe(doubles.media.images[0])
    expect(veilFills(preview)).toHaveLength(0)
  })

  it('veils instead of dimming while the video has no frame to draw yet', async () => {
    // Spec section 2's case. `usePreviewMedia` puts an element in the map when it
    // CREATES it, so "not in the map" is not "not ready": a <video> at
    // readyState 0 is a silent no-op for `drawImage`, which would leave the ring
    // neither dimmed nor veiled. The chrome applies the frame path's own
    // readiness test and takes the veil instead.
    doubles.media.script({ video: { readyState: 0 } })
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    expect(dimDraws(preview)).toHaveLength(0)
    expect(veilFills(preview).length).toBeGreaterThan(0)
  })

  it('veils instead of dimming while the image has not decoded', async () => {
    // The image half of the same readiness test: an <img> whose request has not
    // completed draws nothing.
    croppingImageClip()
    const preview = await renderPreview()
    Object.defineProperty(doubles.media.images[0], 'complete', {
      value: false,
      configurable: true,
    })
    preview.clearCalls()

    store().setCurrentTime(1)

    expect(dimDraws(preview)).toHaveLength(0)
    expect(veilFills(preview).length).toBeGreaterThan(0)
  })

  it('takes the canvas\' own pointer handling out of the way', async () => {
    const clip = croppingClip()
    const preview = await renderPreview()

    // Mid-canvas, which outside crop mode would start a move drag on this clip.
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    fireEvent.mouseMove(window, preview.at(1160, 540))
    fireEvent.mouseUp(window)

    expect(store().project.timeline.clips[0].transform.x).toBe(clip.transform.x)
  })

  it('draws and mounts nothing while the latch names another clip', async () => {
    croppingClip()
    addClip('clip2', 4, 4)
    store().setSelectedClipId('clip2')
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    expect(preview.calls('clip')).toHaveLength(0)
    // The other side of the todo above: this passes trivially while
    // `CropHandles` is a shell rendering nothing, and only starts
    // discriminating once Task 4 gives it a body.
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })

  it('draws and mounts nothing during playback', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setIsPlaying(true)

    expect(preview.calls('clip')).toHaveLength(0)
    // Trivially true until Task 4's `CropHandles` has a body — see above.
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })
})
