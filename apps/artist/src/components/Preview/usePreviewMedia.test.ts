// The lifecycle of the preview's media: what gets created, and what gets let go.
//
// The component tests already prove the elements *draw* correctly. What they
// cannot show — because they never watch the hook alone across a change of
// timeline — is the bookkeeping: one object URL per source and no more, the
// right element type per media type, and the release of both when a clip
// stops needing them or the editor goes away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { previewVideoForSlot, usePreviewMedia } from './usePreviewMedia'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import {
  audioSource,
  imageSource,
  installPreviewDoubles,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { lastObjectUrl } from '../../test/objectUrls'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()

  // These tests are about which URL belongs to which source; src/test/setup.ts
  // mints a distinct handle per call (ESCSUITE-117), so they read the handles
  // back from the mock rather than installing a per-source stub of their own.
  // The clear stays: resetStoreForTest() above drives the real resetProject(),
  // which revokes a previous test's library, and one case below asserts
  // revokeObjectURL was not called at all.
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
    expect(doubles.media.srcAssignments).toEqual([lastObjectUrl()])
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
    const loadedUrl = element.src

    store().removeClipFromTimeline(clip.id)
    await settle()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(loadedUrl)
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

  it('revokes every live object URL on unmount', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 2)
    addMediaClip('song', audioSource.id)

    const { unmount } = await mountMedia()
    const live = vi.mocked(URL.createObjectURL).mock.results.map((r) => r.value as string)
    expect(live).toHaveLength(2)

    unmount()

    // Emptying the elements is not enough: the blobs behind those URLs stay
    // alive in the browser until each URL is revoked.
    for (const url of live) {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    }
  })
})

// ESCSUITE-313: a source with two clips live at once has a second <video>,
// made on demand over the first one's URL, kept while the source is used and
// let go with it.
describe('usePreviewMedia second elements for one source', () => {
  it('starts with none, and makes one over the same URL when a slot asks for it', async () => {
    addClip('clip1', 0, 2)
    const { result } = await mountMedia()
    const videos = result.current.videoElementsRef.current
    const extras = result.current.extraVideoElementsRef.current
    expect(extras.size).toBe(0)

    const second = previewVideoForSlot(videos, extras, video.id, 1)

    expect(second).toBe(doubles.media.videos[1])
    expect(second!.src).toBe(videos.get(video.id)!.src)
    expect(second!.muted).toBe(true)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    // Slot 0 is the source's own element, and asking again makes nothing new.
    expect(previewVideoForSlot(videos, extras, video.id, 0)).toBe(videos.get(video.id))
    expect(previewVideoForSlot(videos, extras, video.id, 1)).toBe(second)
    expect(doubles.media.videos).toHaveLength(2)
  })

  it('makes nothing for a source that has no element of its own', async () => {
    const { result } = await mountMedia()

    expect(
      previewVideoForSlot(
        result.current.videoElementsRef.current,
        result.current.extraVideoElementsRef.current,
        'nowhere',
        1
      )
    ).toBeUndefined()
    expect(doubles.media.videos).toHaveLength(0)
  })

  it('empties the second element when its source stops being used', async () => {
    const clip = addClip('clip1', 0, 2)
    const { result } = await mountMedia()
    const second = previewVideoForSlot(
      result.current.videoElementsRef.current,
      result.current.extraVideoElementsRef.current,
      video.id,
      1
    )!

    store().removeClipFromTimeline(clip.id)
    await settle()

    expect(second.pause).toHaveBeenCalled()
    expect(second.src).toBe('')
    expect(result.current.extraVideoElementsRef.current.size).toBe(0)
  })

  it('keeps the second element while its source is still used', async () => {
    addClip('clip1', 0, 2)
    const { result } = await mountMedia()
    const second = previewVideoForSlot(
      result.current.videoElementsRef.current,
      result.current.extraVideoElementsRef.current,
      video.id,
      1
    )!

    addClip('clip2', 4, 2)
    await settle()

    expect(result.current.extraVideoElementsRef.current.get(video.id)).toEqual([second])
    expect(second.src).not.toBe('')
  })

  it('pauses and empties the second element on unmount, revoking the shared URL once', async () => {
    addClip('clip1', 0, 2)
    const { result, unmount } = await mountMedia()
    const second = previewVideoForSlot(
      result.current.videoElementsRef.current,
      result.current.extraVideoElementsRef.current,
      video.id,
      1
    )!

    unmount()

    expect(second.pause).toHaveBeenCalled()
    expect(second.src).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
