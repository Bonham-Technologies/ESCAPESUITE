// The lifecycle of the preview's media: what gets created, and what gets let go.
//
// The component tests already prove the elements *draw* correctly. What they
// cannot show — because they never watch the hook alone across a change of
// timeline — is the bookkeeping: one object URL per source and no more, the
// right element type per media type, and the release of both when a clip
// stops needing them or the editor goes away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePreviewMedia } from './usePreviewMedia'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import {
  audioSource,
  imageSource,
  installPreviewDoubles,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()

  // src/test/setup.ts hands every source the same 'blob:mock-url'; these tests
  // are about which URL belongs to which source, so give each one its own.
  let next = 0
  vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:url-${next++}`)
  vi.mocked(URL.revokeObjectURL).mockClear()
})

afterEach(() => {
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Put a media clip of a non-video source on the first track. */
function addMediaClip(id: string, sourceVideoId: string, duration = 4): void {
  store().addClipToTimeline(
    { id, sourceVideoId, name: id, startTime: 0, endTime: duration, duration },
    store().project.timeline.tracks[0].id,
    0
  )
}

/** Mount the hook and let the mount-time media load resolve. */
async function mountMedia() {
  const rendered = renderHook(() => usePreviewMedia())
  await settle()
  return rendered
}

describe('usePreviewMedia element creation', () => {
  it('creates one object URL and one <video> for a video source', async () => {
    addClip('clip1', 0, 2)

    const { result } = await mountMedia()

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(doubles.media.videos).toHaveLength(1)
    expect(result.current.videoElementsRef.current.get(video.id)).toBe(doubles.media.videos[0])
    expect(doubles.media.srcAssignments).toEqual(['blob:url-0'])
  })

  it('creates an <img> for an image source and an <audio> for an audio one', async () => {
    store().addSourceVideo(imageSource)
    store().addSourceVideo(audioSource)
    addMediaClip('pic', imageSource.id)
    addMediaClip('song', audioSource.id)

    const { result } = await mountMedia()

    expect(result.current.imageElementsRef.current.get(imageSource.id)).toBe(doubles.media.images[0])
    expect(result.current.audioElementsRef.current.get(audioSource.id)).toBe(doubles.media.audios[0])
    expect(result.current.videoElementsRef.current.size).toBe(0)
  })

  it('loads each source once, however many clips share it', async () => {
    addClip('clip1', 0, 2)
    addClip('clip2', 4, 2)

    const { result } = await mountMedia()

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(result.current.videoElementsRef.current.size).toBe(1)
  })

  it('reports the loaded sources as redraw keys', async () => {
    store().addSourceVideo(imageSource)
    addClip('clip1', 0, 2)
    addMediaClip('pic', imageSource.id)

    const { result } = await mountMedia()

    expect(result.current.videoUrlsKey).toBe(video.id)
    expect(result.current.imageUrlsKey).toBe(imageSource.id)
  })

  it('clears the loading flag once the blobs have resolved', async () => {
    addClip('clip1', 0, 2)

    const { result } = await mountMedia()

    expect(result.current.isLoading).toBe(false)
  })
})

describe('usePreviewMedia release', () => {
  it('revokes the URL and empties the element when a source stops being used', async () => {
    const clip = addClip('clip1', 0, 2)

    const { result } = await mountMedia()
    const element = doubles.media.videos[0]

    store().removeClipFromTimeline(clip.id)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url-0')
    expect(result.current.videoElementsRef.current.size).toBe(0)
    expect(element.pause).toHaveBeenCalled()
    expect(element.src).toBe('')
  })

  it('keeps the element it already has when the timeline changes around it', async () => {
    addClip('clip1', 0, 2)

    const { result } = await mountMedia()
    const element = result.current.videoElementsRef.current.get(video.id)

    addClip('clip2', 4, 2)
    await settle()

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(result.current.videoElementsRef.current.get(video.id)).toBe(element)
  })

  it('pauses and empties every media element on unmount', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 2)
    addMediaClip('song', audioSource.id)

    const { unmount } = await mountMedia()
    const videoElement = doubles.media.videos[0]
    const audioElement = doubles.media.audios[0]

    unmount()

    expect(videoElement.pause).toHaveBeenCalled()
    expect(videoElement.src).toBe('')
    expect(audioElement.pause).toHaveBeenCalled()
    expect(audioElement.src).toBe('')
  })
})
