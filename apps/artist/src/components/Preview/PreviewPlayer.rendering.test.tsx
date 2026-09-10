// What PreviewPlayer actually paints: the ordered canvas calls of a composited
// frame, and the drawing state each call was made with.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import {
  audioSource,
  imageSource,
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { getFrameCache, resetFrameCache } from '../../core/frameCache'
import { getVideoBlob } from '../../core/storage'
import type { Clip, TextOverlayData } from '../../store/types'
import { PreviewPlayer } from './PreviewPlayer'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/**
 * Adding an overlay selects it, and a selected clip is drawn with handles on
 * top. These tests are not about the handles, so they start from nothing
 * selected.
 */
const addText = (data: Partial<TextOverlayData>, duration = 4): Clip => {
  const clip = store().addTextOverlayClip(data, undefined, 0, duration)
  store().setSelectedClipId(null)
  return clip
}

/** Put a media clip of a non-video source on the first track. */
const addMediaClip = (id: string, sourceVideoId: string, duration = 4): void => {
  store().addClipToTimeline(
    { id, sourceVideoId, name: id, startTime: 0, endTime: duration, duration },
    store().project.timeline.tracks[0].id,
    0
  )
}

describe('PreviewPlayer drawing', () => {
  it('clears to black and draws the one active video clip at native size', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview()
    const frame = preview.frame()

    expect(frame.methods).toEqual(['setTransform', 'fillRect', 'save', 'drawImage', 'restore'])
    const [clear] = frame.of('fillRect')
    expect(clear.args).toEqual([0, 0, 1920, 1080])
    expect(clear.state.fillStyle).toBe('#000000')
    // Scale 1 means native source pixels, centred on the canvas.
    const [draw] = frame.of('drawImage')
    expect(draw.args.slice(1)).toEqual([0, 0, 1920, 1080])
    expect(draw.args[0]).toBe(doubles.media.videos[0])
  })

  it('draws an image clip from the <img> element at its natural size', async () => {
    store().addSourceVideo(imageSource)
    addMediaClip('pic', imageSource.id)

    const preview = await renderPreview()

    const [draw] = preview.frame().of('drawImage')
    expect(draw.args[0]).toBe(doubles.media.images[0])
    // 800x600 centred on a 1920x1080 canvas.
    expect(draw.args.slice(1)).toEqual([560, 240, 800, 600])
  })

  it('never draws an audio clip', async () => {
    store().addSourceVideo(audioSource)
    addMediaClip('song', audioSource.id)

    const preview = await renderPreview()

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })

  it('draws stacked tracks bottom track first', async () => {
    const bottom = store().project.timeline.tracks[0].id
    const top = store().addTrack('Top').id
    addClip('lower', 0, 2, bottom)
    addClip('upper', 0, 2, top)
    // Distinguish the two draws by size.
    store().updateClipTransform('upper', { scaleX: 0.5, scaleY: 0.5 })

    const preview = await renderPreview()

    const widths = preview.frame().argsFor('drawImage').map((args) => args[3])
    expect(widths).toEqual([1920, 960])
  })

  it('skips clips on a hidden track', async () => {
    const trackId = store().project.timeline.tracks[0].id
    addClip('clip1', 0, 2, trackId)
    store().updateTrack(trackId, { visible: false })

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })

  it('applies opacity, blend mode, blur and rotation to the clip it draws', async () => {
    addClip('clip1', 0, 2)
    store().updateClipTransform('clip1', { opacity: 0.4, rotation: 90, scaleX: 2, scaleY: 2 })
    store().updateClipBlendMode('clip1', 'multiply')
    store().updateClipEffects('clip1', { blur: 6 })

    const preview = await renderPreview()
    const frame = preview.frame()

    const [draw] = frame.of('drawImage')
    expect(draw.state.globalAlpha).toBe(0.4)
    expect(draw.state.globalCompositeOperation).toBe('multiply')
    expect(draw.state.filter).toBe('blur(6px)')
    // Rotation happens about the clip centre.
    expect(frame.argsFor('translate')).toEqual([
      [960, 540],
      [-960, -540],
    ])
    expect(frame.argsFor('rotate')).toEqual([[Math.PI / 2]])
    // scale 2 on a 1920x1080 source, still centred.
    expect(draw.args.slice(1)).toEqual([-960, -540, 3840, 2160])
  })

  it('leaves the filter off when the clip has no blur', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')[0].state.filter).toBe('none')
  })

  it('draws nothing but black when the playhead sits in a gap', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(5)
    await settle(FRAME_MS)

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })
})

describe('PreviewPlayer letterboxing', () => {
  it('maps a click through the pillarbox when the element is wider than the frame', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 1000, height: 540 } })

    // 40px of pillarbox split either side of a 960px-wide rendered frame.
    expect(preview.at(0, 0)).toEqual({ clientX: 20, clientY: 0 })
    expect(preview.at(1920, 1080)).toEqual({ clientX: 980, clientY: 540 })
  })

  it('maps a click through the letterbox when the element is taller than the frame', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview({ rect: { left: 0, top: 0, width: 960, height: 600 } })

    expect(preview.at(0, 0)).toEqual({ clientX: 0, clientY: 30 })
    expect(preview.at(1920, 1080)).toEqual({ clientX: 960, clientY: 570 })
  })
})

describe('PreviewPlayer frame cache', () => {
  const fakeBitmap = () => ({ width: 1920, height: 1080, close: vi.fn() }) as unknown as ImageBitmap

  it('serves a cached frame instead of recomposing it', async () => {
    addText({ text: 'Cached' })

    const preview = await renderPreview()
    getFrameCache().set(0, fakeBitmap())

    // Renaming a track re-runs the redraw effects without changing anything the
    // cache key covers, so the debounced redraw finds the frame still cached.
    preview.clearCalls()
    store().updateTrack(store().project.timeline.tracks[0].id, { name: 'Renamed' })
    await settle()
    expect(preview.frame().of('fillText')).toHaveLength(1)

    preview.clearCalls()
    await settle(60)

    expect(preview.methods()).toEqual(['drawImage'])
    expect(preview.calls('drawImage')[0].args).toEqual([
      getFrameCache().get(0),
      0,
      0,
      1920,
      1080,
    ])
  })

  it('drops cached frames when the timeline content changes', async () => {
    addClip('clip1', 0, 4)

    await renderPreview()
    getFrameCache().set(0, fakeBitmap())
    expect(getFrameCache().has(0)).toBe(true)

    store().updateClipTransform('clip1', { x: 0.25 })
    await settle(FRAME_MS)

    expect(getFrameCache().has(0)).toBe(false)
  })
})

describe('PreviewPlayer media loading', () => {
  it('shows the spinner until the media blobs resolve', async () => {
    addClip('clip1', 0, 2)
    let release: (blob: Blob) => void = () => {}
    vi.mocked(getVideoBlob).mockReturnValueOnce(
      new Promise<Blob>((resolve) => {
        release = resolve
      })
    )

    render(<PreviewPlayer />)
    await settle()

    expect(screen.getByText('Loading videos...')).toBeInTheDocument()

    await act(async () => {
      release(new Blob(['v'], { type: 'video/mp4' }))
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(screen.queryByText('Loading videos...')).not.toBeInTheDocument()
  })

  it('keeps going when a source blob is missing', async () => {
    addClip('clip1', 0, 2)
    vi.mocked(getVideoBlob).mockResolvedValueOnce(undefined)

    const preview = await renderPreview()

    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })

  it('reports a failed media load and still draws the frame', async () => {
    addClip('clip1', 0, 2)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getVideoBlob).mockRejectedValueOnce(new Error('quota'))

    const preview = await renderPreview()

    expect(consoleError).toHaveBeenCalledWith('Failed to load media:', expect.any(Error))
    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
    consoleError.mockRestore()
  })

  it('reuses the element it already made for a source when a clip is added', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()
    const firstVideo = doubles.media.videos[0]

    addClip('clip2', 2, 2)
    await settle(60)

    expect(doubles.media.videos).toHaveLength(1)
    expect(doubles.media.videos[0]).toBe(firstVideo)
    expect(preview.frame().of('drawImage')).toHaveLength(1)
  })

  it('keeps the image it already loaded when another image joins the timeline', async () => {
    store().addSourceVideo(imageSource)
    addMediaClip('pic', imageSource.id)

    await renderPreview()
    const firstImage = doubles.media.images[0]

    const second = { ...imageSource, id: 'image2', name: 'other.png' }
    store().addSourceVideo(second)
    store().addClipToTimeline(
      { id: 'pic2', sourceVideoId: second.id, name: 'pic2', startTime: 0, endTime: 4, duration: 4 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.images).toHaveLength(2)
    expect(doubles.media.images[0]).toBe(firstImage)

    // Dropping the newcomer revokes only its URL, and leaves the first alone.
    store().removeClipFromTimeline('pic2')
    await settle(60)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(doubles.media.images).toHaveLength(2)
  })

  it('keeps the audio it already loaded and releases the one it drops', async () => {
    store().addSourceVideo(audioSource)
    addMediaClip('song', audioSource.id)

    await renderPreview()
    const firstAudio = doubles.media.audios[0]

    const second = { ...audioSource, id: 'audio2', name: 'other.mp3' }
    store().addSourceVideo(second)
    store().addClipToTimeline(
      { id: 'song2', sourceVideoId: second.id, name: 'song2', startTime: 0, endTime: 4, duration: 4 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.audios).toHaveLength(2)
    expect(doubles.media.audios[0]).toBe(firstAudio)

    store().removeClipFromTimeline('song2')
    await settle(60)

    expect(doubles.media.audios[1].src).toBe('')
    expect(doubles.media.audios[1].pause).toHaveBeenCalled()
  })

  it('keeps the video it already loaded when another video joins the timeline', async () => {
    addClip('clip1', 0, 2)

    await renderPreview()
    const firstVideo = doubles.media.videos[0]

    store().addSourceVideo({ ...video, id: 'video2', name: 'second.mp4' })
    store().addClipToTimeline(
      { id: 'clip2', sourceVideoId: 'video2', name: 'clip2', startTime: 0, endTime: 2, duration: 2 },
      store().addTrack('Second').id,
      0
    )
    await settle(60)

    expect(doubles.media.videos).toHaveLength(2)
    expect(doubles.media.videos[0]).toBe(firstVideo)
  })

  it('releases the element of a source no clip uses any more', async () => {
    addClip('clip1', 0, 2)
    await renderPreview()
    const element = doubles.media.videos[0]

    store().removeClipFromTimeline('clip1')
    await settle(60)

    expect(element.src).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})

describe('PreviewPlayer info bar', () => {
  it('names the top-most active clip and counts the clips at the playhead', async () => {
    const bottom = store().project.timeline.tracks[0].id
    const top = store().addTrack('Top').id
    addClip('lower', 0, 2, bottom)
    addClip('upper', 0, 2, top)

    const preview = await renderPreview()

    expect(preview.view.getByText('2 clips • upper')).toBeInTheDocument()
  })

  it('says Gap when the timeline has clips but none at the playhead', async () => {
    addClip('clip1', 0, 2)
    const preview = await renderPreview()

    store().setCurrentTime(5)
    await settle(FRAME_MS)

    expect(preview.view.getByText('Gap')).toBeInTheDocument()
  })

  it('shows the running timecode', async () => {
    addClip('clip1', 0, 4)
    const preview = await renderPreview()

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    expect(preview.view.getByText('00:01.500')).toBeInTheDocument()
  })
})

describe('PreviewPlayer clip visibility', () => {
  it('draws nothing for a video whose element has no dimensions yet', async () => {
    doubles.media.script({ video: { videoWidth: 0, videoHeight: 0 } })
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })

  it('draws nothing for a video that has not loaded metadata', async () => {
    doubles.media.script({ video: { readyState: 0 } })
    addClip('clip1', 0, 2)

    const preview = await renderPreview()

    expect(preview.frame().of('drawImage')).toHaveLength(0)
  })
})
