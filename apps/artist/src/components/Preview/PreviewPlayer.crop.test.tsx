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
  installPreviewDoubles,
  renderPreview,
  type PreviewDoubles,
} from '../../test/renderPreview'
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
    croppingClip()
    const preview = await renderPreview()

    expect(preview.view.getByRole('group', { name: 'Crop handles' })).toBeInTheDocument()
    expect(preview.view.getByRole('button', { name: 'Crop top left' })).toBeInTheDocument()
    expect(preview.view.getByRole('button', { name: 'Crop bottom right' })).toBeInTheDocument()
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
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })

  it('draws and mounts nothing during playback', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setIsPlaying(true)

    expect(preview.calls('clip')).toHaveLength(0)
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })
})
