// Playback: what the preview does to its media elements and the playhead once
// the transport starts, and how it settles a seek when it is stopped.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import {
  audioSource,
  imageSource,
  FRAME_MS,
  installPreviewDoubles,
  last,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
  resetFrameCache()
})

afterEach(async () => {
  // Stop the animation loop before unmounting, so no frame is left in flight.
  if (store().isPlaying) {
    store().setIsPlaying(false)
    await settle(20)
  }
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** Start playback and let the transport spin for `ms` of wall clock. */
async function play(ms = 0): Promise<void> {
  store().setIsPlaying(true)
  await settle(ms)
}

const trackId = () => store().project.timeline.tracks[0].id

describe('PreviewPlayer transport start', () => {
  it('seeks each video to its source time and plays it', async () => {
    const clip = addClip('clip1', 4, 2)
    store().updateClip(clip.id, { startTime: 3, endTime: 5 })
    store().setCurrentTime(4.5)

    await renderPreview()
    await play()

    const element = doubles.media.videos[0]
    expect(element.currentTime).toBe(3.5)
    expect(element.play).toHaveBeenCalled()
    expect(element.muted).toBe(false)
    expect(element.volume).toBe(1)
  })

  it('keeps a muted track muted and silent', async () => {
    addClip('clip1', 0, 4)
    store().updateTrack(trackId(), { muted: true, volume: 0.5 })

    await renderPreview()
    await play()

    expect(doubles.media.videos[0].muted).toBe(true)
    expect(doubles.media.videos[0].volume).toBe(0.5)
  })

  it('multiplies the track volume by the clip volume keyframes', async () => {
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(trackId(), { volume: 0.5 })
    store().setClipKeyframe(clip.id, 'volume', { time: 0, value: 0.4, easing: 'linear' })

    await renderPreview()
    await play()

    expect(doubles.media.videos[0].volume).toBeCloseTo(0.2, 5)
  })

  it('plays an audio-only clip from its own element', async () => {
    store().addSourceVideo(audioSource)
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 2, endTime: 6, duration: 4 },
      trackId(),
      0
    )
    store().updateTrack(trackId(), { volume: 0.5 })
    store().setCurrentTime(1)

    await renderPreview()
    await play()

    const element = doubles.media.audios[0]
    expect(element.currentTime).toBe(3)
    expect(element.volume).toBe(0.5)
    expect(element.play).toHaveBeenCalled()
    expect(doubles.media.videos).toHaveLength(0)
  })

  it('never tries to play an image clip', async () => {
    store().addSourceVideo(imageSource)
    store().addClipToTimeline(
      { id: 'pic', sourceVideoId: imageSource.id, name: 'pic', startTime: 0, endTime: 4, duration: 4 },
      trackId(),
      0
    )

    await renderPreview()
    await play(FRAME_MS * 3)

    expect(doubles.media.videos).toHaveLength(0)
    expect(doubles.media.audios).toHaveLength(0)
    expect(store().isPlaying).toBe(true)
  })

  it('refuses to play a timeline with no clips', async () => {
    addClip('clip1', 0, 2)
    await renderPreview()
    store().removeClipFromTimeline('clip1')
    await settle(60)

    await play(FRAME_MS)

    expect(store().isPlaying).toBe(false)
  })

  it('jumps forward to the next clip when the playhead sits in a gap', async () => {
    addClip('later', 3, 2)
    store().setCurrentTime(1)

    await renderPreview()
    await play()

    expect(store().currentTime).toBe(3)
  })

  it('picks the nearest of the clips still ahead of the playhead', async () => {
    addClip('far', 6, 2)
    addClip('near', 3, 2)
    store().setCurrentTime(1)

    await renderPreview()
    await play()

    expect(store().currentTime).toBe(3)
  })

  it('stops at the end when there is no clip left to play', async () => {
    addClip('clip1', 0, 2)
    store().setCurrentTime(2.5)

    await renderPreview()
    await play()

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(2)
  })

  it('reports a rejected play() without stopping the transport', async () => {
    addClip('clip1', 0, 4)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await renderPreview()
    const element = doubles.media.videos[0]
    element.play = vi.fn().mockRejectedValue(new Error('gesture required'))
    await play(FRAME_MS)

    expect(consoleError).toHaveBeenCalledWith(expect.any(Error))
    expect(store().isPlaying).toBe(true)
    consoleError.mockRestore()
  })
})

describe('PreviewPlayer transport running', () => {
  it('advances the playhead and redraws every frame', async () => {
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    preview.clearCalls()
    await play(300)

    expect(store().currentTime).toBeGreaterThan(0.2)
    expect(store().currentTime).toBeLessThan(0.35)
    // One composite per animation frame.
    expect(preview.frames().length).toBeGreaterThan(10)
  })

  it('shows the running time before the store catches up', async () => {
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    await play(100)

    // The store is only written every 200ms; the timecode is not.
    expect(store().currentTime).toBe(0)
    expect(preview.view.getByText(/00:00\.\d\d\d/).textContent).not.toBe('00:00.000')
  })

  it('stops when it reaches the end of the timeline', async () => {
    addClip('clip1', 0, 1)

    await renderPreview()
    await play(1200)

    expect(store().isPlaying).toBe(false)
    expect(store().currentTime).toBe(1)
    expect(doubles.media.videos[0].pause).toHaveBeenCalled()
  })

  it('loops back to the beginning when loop playback is on', async () => {
    addClip('clip1', 0, 1)
    store().setLoopPlayback(true)

    await renderPreview()
    await play(1100)

    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeLessThan(0.3)
    expect(doubles.media.videos[0].currentTime).toBeLessThan(0.3)
  })

  it('loops between the in and out points when both are set', async () => {
    addClip('clip1', 0, 4)
    store().setLoopPlayback(true)
    store().setInPoint(1)
    store().setOutPoint(2)
    store().setCurrentTime(1.9)

    await renderPreview()
    await play(200)

    expect(store().isPlaying).toBe(true)
    expect(store().currentTime).toBeCloseTo(1, 1)
  })

  it('ignores the in and out points when loop playback is off', async () => {
    addClip('clip1', 0, 4)
    store().setInPoint(1)
    store().setOutPoint(2)
    store().setCurrentTime(1.9)

    await renderPreview()
    await play(300)

    expect(store().currentTime).toBeGreaterThan(2)
  })

  it('pauses the clip that ended and starts the one that follows', async () => {
    store().addSourceVideo({ ...video, id: 'video2', name: 'second.mp4' })
    addClip('first', 0, 1, trackId())
    store().addClipToTimeline(
      { id: 'second', sourceVideoId: 'video2', name: 'second', startTime: 0, endTime: 2, duration: 2 },
      trackId(),
      1
    )

    await renderPreview()
    const [first, second] = doubles.media.videos
    await play(1100)

    expect(first.pause).toHaveBeenCalled()
    expect(first.muted).toBe(true)
    expect(second.play).toHaveBeenCalled()
  })

  it('re-seeks a video that the next clip needs at a different source time', async () => {
    addClip('first', 0, 1, trackId())
    store().addClipToTimeline(
      { id: 'second', sourceVideoId: video.id, name: 'second', startTime: 5, endTime: 7, duration: 2 },
      trackId(),
      1
    )

    await renderPreview()
    doubles.media.seeks.length = 0
    await play(1100)

    expect(doubles.media.seeks.some((t) => t >= 5)).toBe(true)
  })

  it('starts an audio clip that begins part way through playback', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 10, trackId())
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 5, duration: 5 },
      store().addTrack('Audio').id,
      0.5
    )

    await renderPreview()
    await play(700)

    expect(doubles.media.audios[0].play).toHaveBeenCalled()
    expect(doubles.media.audios[0].volume).toBe(1)
  })

  it('re-seeks an audio element the next clip needs elsewhere in the file', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 10, trackId())
    const audioTrack = store().addTrack('Audio')
    // Two cuts of the same recording, back to back: the second needs the
    // element moved to a completely different point in the file.
    store().addClipToTimeline(
      { id: 'first', sourceVideoId: audioSource.id, name: 'first', startTime: 0, endTime: 0.3, duration: 0.3 },
      audioTrack.id,
      0
    )
    store().addClipToTimeline(
      { id: 'second', sourceVideoId: audioSource.id, name: 'second', startTime: 30, endTime: 35, duration: 5 },
      audioTrack.id,
      0.3
    )

    await renderPreview()
    await play(500)

    expect(doubles.media.audios[0].currentTime).toBeGreaterThanOrEqual(30)
  })

  it('never starts an audio clip on a muted track', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 10, trackId())
    const audioTrack = store().addTrack('Audio')
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 5, duration: 5 },
      audioTrack.id,
      0.5
    )
    store().updateTrack(audioTrack.id, { muted: true })

    await renderPreview()
    await play(700)

    expect(doubles.media.audios[0].play).not.toHaveBeenCalled()
  })

  it('pauses an audio clip that has ended while the video plays on', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 10, trackId())
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 0.5, duration: 0.5 },
      store().addTrack('Audio').id,
      0
    )

    await renderPreview()
    await play(700)

    expect(doubles.media.audios[0].pause).toHaveBeenCalled()
    expect(store().isPlaying).toBe(true)
  })

  it('rewinds the audio elements too when the timeline loops', async () => {
    store().addSourceVideo(audioSource)
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 1, duration: 1 },
      trackId(),
      0
    )
    store().setLoopPlayback(true)

    await renderPreview()
    await play(1100)

    expect(store().isPlaying).toBe(true)
    expect(doubles.media.audios[0].currentTime).toBeLessThan(0.3)
  })

  it('keeps applying volume keyframes while the same clips stay on screen', async () => {
    const clip = addClip('clip1', 0, 10)
    store().setClipKeyframe(clip.id, 'volume', { time: 0, value: 1, easing: 'linear' })
    store().setClipKeyframe(clip.id, 'volume', { time: 10, value: 0, easing: 'linear' })

    await renderPreview()
    await play(500)

    expect(doubles.media.videos[0].volume).toBeLessThan(1)
    expect(doubles.media.videos[0].volume).toBeGreaterThan(0.9)
  })

  it('leaves a muted track silent while the volume keyframes run', async () => {
    const clip = addClip('clip1', 0, 10)
    store().updateTrack(trackId(), { muted: true })
    store().setClipKeyframe(clip.id, 'volume', { time: 0, value: 0.5, easing: 'linear' })

    await renderPreview()
    await play(300)

    expect(doubles.media.videos[0].muted).toBe(true)
  })

  it('pauses every element when the transport stops', async () => {
    store().addSourceVideo(audioSource)
    addClip('clip1', 0, 10, trackId())
    store().addClipToTimeline(
      { id: 'song', sourceVideoId: audioSource.id, name: 'song', startTime: 0, endTime: 10, duration: 10 },
      store().addTrack('Audio').id,
      0
    )

    await renderPreview()
    await play(100)

    store().setIsPlaying(false)
    await settle(FRAME_MS)

    expect(doubles.media.videos[0].pause).toHaveBeenCalled()
    expect(doubles.media.videos[0].muted).toBe(true)
    expect(doubles.media.audios[0].pause).toHaveBeenCalled()
  })

  it('draws the paused frame once when the transport stops, then stops', async () => {
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    await play(100)

    preview.clearCalls()
    store().setIsPlaying(false)
    await settle(60)
    // The paused position is drawn twice: once by the scrub effect the moment
    // playback stops, once by the debounced redraw 50ms later.
    expect(preview.frames()).toHaveLength(2)

    preview.clearCalls()
    await settle(300)
    expect(preview.frames()).toHaveLength(0)
  })
})

describe('PreviewPlayer scrubbing', () => {
  it('seeks the video and redraws once the seek reports back', async () => {
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(4)
    await settle(FRAME_MS)

    expect(last(doubles.media.seeks)).toBe(4)
    // A provisional composite with the frame in hand, then the settled one.
    expect(preview.frames().length).toBeGreaterThanOrEqual(2)
  })

  it('draws once and waits for nothing when the video is already there', async () => {
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    doubles.media.seeks.length = 0
    preview.clearCalls()

    store().setCurrentTime(0.01)
    await settle(FRAME_MS)

    expect(doubles.media.seeks).toHaveLength(0)
    expect(preview.frames()).toHaveLength(1)
  })

  it('redraws anyway when the seek never reports back', async () => {
    doubles.media.script({ video: { stallSeek: true } })
    addClip('clip1', 0, 10)

    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(4)
    await settle(FRAME_MS)
    const provisional = preview.frames().length

    await settle(300)

    expect(preview.frames().length).toBeGreaterThan(provisional)
  })

  it('seeks the incoming clip of a transition too', async () => {
    store().addSourceVideo({ ...video, id: 'video2', name: 'second.mp4' })
    addClip('a', 0, 2, trackId())
    store().addClipToTimeline(
      { id: 'b', sourceVideoId: 'video2', name: 'b', startTime: 0, endTime: 2, duration: 2 },
      trackId(),
      2
    )
    store().updateClipTransition('a', { type: 'fade', duration: 1 })

    const preview = await renderPreview()
    doubles.media.seeks.length = 0

    store().setCurrentTime(1.5)
    await settle(FRAME_MS)

    // The outgoing clip seeks to 1.5 and the incoming one to 0 — it has not
    // started yet, so its source time is clamped at its own beginning.
    expect(doubles.media.seeks).toContain(1.5)
    expect(preview.frames().length).toBeGreaterThanOrEqual(1)
  })

  it('draws black without seeking anything when the playhead is in a gap', async () => {
    addClip('clip1', 0, 2)

    const preview = await renderPreview()
    doubles.media.seeks.length = 0
    preview.clearCalls()

    store().setCurrentTime(5)
    await settle(FRAME_MS)

    expect(doubles.media.seeks).toHaveLength(0)
    expect(preview.frame().methods).toEqual(['setTransform', 'fillRect'])
  })
})
