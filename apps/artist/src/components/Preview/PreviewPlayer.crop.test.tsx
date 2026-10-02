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

  it('mounts eight named handles over the canvas', async () => {
    // Crop mode is entered with the preview already on screen — the inspector's
    // toggle is the only way in — so the latch is set after the render here
    // rather than before it, which is also the order that gives the mount's
    // `canvasRef.current` a canvas to hand over.
    const clip = addClip('clip1', 0, 4)
    store().setSelectedClipId(clip.id)
    const preview = await renderPreview()

    store().setCropClipId(clip.id)

    const group = preview.view.getByRole('group', { name: 'Crop handles' })
    expect(group.querySelectorAll('button')).toHaveLength(8)
    expect(preview.view.getByRole('button', { name: 'Crop top left' })).toBeEnabled()
    expect(preview.view.getByRole('button', { name: 'Crop bottom right' })).toBeEnabled()
  })

  it('moves the handles with the playhead, onto the box the clip is animated to', async () => {
    // The `time={currentTime}` half of the props the mount computes: the frame
    // follows the clip's ANIMATED centre, not its stored one. Nothing else pins
    // it — `CropHandles.test.tsx` renders the component directly and so cannot
    // catch a wrong value handed over by the preview.
    const clip = addClip('clip1', 0, 4)
    store().setSelectedClipId(clip.id)
    store().setClipKeyframe(clip.id, 'x', { time: 0, value: 0.25, easing: 'linear' })
    store().setClipKeyframe(clip.id, 'x', { time: 2, value: 0.75, easing: 'linear' })
    const preview = await renderPreview()
    store().setCropClipId(clip.id)
    const frameLeft = () =>
      preview.view.getByRole('group', { name: 'Crop handles' }).style.left

    // The canvas is laid out at 960x540 for a 1920x1080 project, so a centre at
    // x 0.75 puts the 1920-wide picture's left edge 240 CSS pixels in.
    store().setCurrentTime(2)
    expect(frameLeft()).toBe('240px')

    store().setCurrentTime(0)
    expect(frameLeft()).toBe('-240px')
  })

  it('derives the transition the chrome and the handles are measured against', async () => {
    // The ESCSUITE-147 half of the props and arguments the preview computes: the
    // clip's last second slides out to the left and a fade owns that side, so the
    // renderer draws it centred and the crop frame has to agree. Nothing else
    // pins it — `cropOverlay.test.ts` and `CropHandles.test.tsx` are handed a
    // transition, and so cannot catch the preview failing to derive one.
    const clip = addClip('clip1', 0, 4)
    addClip('next', 4, 4)
    store().updateClipAnimation(clip.id, {
      out: { type: 'slide-left', duration: 1, easing: 'linear' },
    })
    store().setSelectedClipId(clip.id)
    const preview = await renderPreview()
    store().setCropClipId(clip.id)
    const frameLeft = () =>
      preview.view.getByRole('group', { name: 'Crop handles' }).style.left

    // No transition yet: at 3.5s the preset has the picture — and the frame —
    // a quarter of the project's width left of centre.
    store().setCurrentTime(3.5)
    expect(frameLeft()).toBe('-240px')

    preview.clearCalls()
    store().updateClipTransition(clip.id, { type: 'fade', duration: 1 })

    expect(frameLeft()).toBe('0px')
    // The chrome's own translate is the last one of the repaint: the composited
    // frame goes down first, then the crop dim and its frame on top of it.
    const translates = preview.argsFor('translate')
    expect(translates[translates.length - 1]).toEqual([960, 540])
  })

  it('disables the handles it mounts over a locked track', async () => {
    // The `locked={isTrackLocked(...)}` half.
    const clip = addClip('clip1', 0, 4)
    store().setSelectedClipId(clip.id)
    const preview = await renderPreview()

    store().updateTrack(clip.trackId, { locked: true })
    store().setCropClipId(clip.id)

    expect(preview.view.getByRole('button', { name: 'Crop top left' })).toBeDisabled()
  })

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

  it('draws and mounts nothing once the playhead leaves the clip, and brings both back', async () => {
    // The chrome has always refused to draw outside the clip's window; the DOM
    // handle layer had no such guard, so scrubbing off the clip left eight live
    // handles over an unrelated frame and a drag there wrote a crop on a clip
    // the user could not see. Both now gate on the one `visibleCropTarget`.
    const clip = addClip('clip1', 0, 4)
    store().setSelectedClipId(clip.id)
    const preview = await renderPreview()
    store().setCropClipId(clip.id)
    const handles = () => preview.view.queryByRole('group', { name: 'Crop handles' })

    expect(handles()).toBeInTheDocument()

    preview.clearCalls()
    store().setCurrentTime(5)

    expect(handles()).not.toBeInTheDocument()
    expect(preview.calls('clip')).toHaveLength(0)

    // And back: the latch survives a scrub, so re-entering the clip returns the
    // mode rather than silently dropping it.
    store().setCurrentTime(1)

    expect(handles()).toBeInTheDocument()
    expect(preview.calls('clip').length).toBeGreaterThan(0)
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
