import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createVideoUrl,
  extractAudioMetadata,
  extractImageMetadata,
  extractVideoMetadata,
  generateAudioThumbnail,
  generateImageThumbnail,
  generateThumbnail,
  getSupportedCodecs,
  isWebCodecsSupported,
  processAudioFile,
  processImageFile,
  processMediaFile,
  processVideoFile,
  resolveStoredDuration,
  THUMBNAIL_SEEK_TIMEOUT_MS,
} from './videoProcessor'
import { buildWebm, hasNonEmptyCues } from '../test/fixtures/webmFixture'
import { getThumbnail, getVideo, storeVideo } from './storage'
import { DEFAULT_IMAGE_DURATION } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { mediaFile } from '../test/doubles/files'
import { lastObjectUrl } from '../test/objectUrls'
import {
  failNextGetContext,
  getLastCanvasContext,
  installCanvasDouble,
  setDefaultToBlobResult,
  uninstallCanvasDouble,
} from '../test/doubles/canvas'
import {
  createAudioBufferDouble,
  installAudioContextDouble,
  type AudioContextDoubles,
} from '../test/doubles/audio'
import { installWebCodecsDoubles, removeWebCodecsGlobals } from '../test/doubles/webcodecs'

// The real waveform extractor runs in every test below; this wrapper only adds
// a switch so the "peak extraction failed" fallbacks can be reached, since
// extractWaveformData swallows its own errors and never rejects on its own.
const waveform = vi.hoisted(() => ({ fail: false }))
vi.mock('../utils/waveform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/waveform')>()
  return {
    ...actual,
    extractWaveformData: vi.fn(async (blob: Blob, samplesPerSecond?: number) => {
      if (waveform.fail) throw new Error('waveform decode blew up')
      return actual.extractWaveformData(blob, samplesPerSecond)
    }),
  }
})

/** A short stereo tone: enough samples for the waveform code to bucket. */
function tone(samples = 4800): Float32Array {
  const data = new Float32Array(samples)
  for (let i = 0; i < samples; i++) data[i] = Math.sin((i / samples) * Math.PI * 8) * 0.8
  return data
}

describe('videoProcessor', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles()
    installCanvasDouble()
    waveform.fail = false
  })

  afterEach(() => {
    media.uninstall()
    uninstallCanvasDouble()
  })

  describe('extractVideoMetadata', () => {
    it('extracts metadata from a video file', async () => {
      media.script({ video: { videoWidth: 1920, videoHeight: 1080, duration: 10.5 } })
      const file = new File(['video data'], 'test-video.mp4', { type: 'video/mp4' })

      const metadata = await extractVideoMetadata(file)

      expect(metadata.name).toBe('test-video.mp4')
      expect(metadata.mimeType).toBe('video/mp4')
      expect(metadata.width).toBe(1920)
      expect(metadata.height).toBe(1080)
      expect(metadata.duration).toBe(10.5)
      // jsdom's <video> has no requestVideoFrameCallback, so nothing was
      // measured and the rate is the fallback, labelled as one.
      expect(metadata.frameRate).toBe(30)
      expect(metadata.frameRateSource).toBe('assumed')
      expect(metadata.size).toBe(file.size)
      expect(metadata.id).toBeDefined()
      // A container that declares its length is believed as-is: no end seek.
      expect(media.seeks).toEqual([])
    })

    describe('frame rate (ESCSUITE-276)', () => {
      const spaced = (interval: number, count: number) =>
        Array.from({ length: count }, (_, i) => i * interval)

      it('measures 60 from a source whose frames are presented 1/60 s apart', async () => {
        media.script({ video: { frameTimes: spaced(1 / 60, 8) } })

        const metadata = await extractVideoMetadata(mediaFile(['v'], 'sixty.mp4', 'video/mp4'))

        expect(metadata.frameRate).toBe(60)
        expect(metadata.frameRateSource).toBe('measured')
        const [video] = media.videos
        expect(video.muted).toBe(true)
        expect(video.play).toHaveBeenCalledTimes(1)
        expect(video.pause).toHaveBeenCalledTimes(1)
        // Sought to the start to play from, then paused and sought back to it
        // once the frames were counted.
        expect(media.seeks).toEqual([0, 0])
      })

      // The duration probe leaves a headerless WebM at its end; the frame-rate
      // probe must play it from the start, not from there.
      it('measures a headerless file from its start, after the end seek', async () => {
        media.script({
          video: { duration: Infinity, durationAfterSeek: 12, durationStaysUnknown: true, frameTimes: spaced(1 / 60, 8) },
        })

        const metadata = await extractVideoMetadata(mediaFile(['webm'], 'headerless.webm', 'video/webm'))

        expect(metadata.duration).toBe(12)
        expect(metadata.frameRate).toBe(60)
        expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER, 0, 0])
      })

      // Review round 2, F1: the frames a real Chromium presented of a 120 fps
      // WebM at half speed on 60 Hz — 1, 5, 6, 7, 11, 12, 13 and 17, the rest
      // dropped, stamped in whole milliseconds — were stored as 126.87,
      // 'measured'.
      it('stores a 120 fps WebM that dropped frames during the probe as 120 or 119.88', async () => {
        media.script({ video: { frameTimes: [8, 42, 50, 58, 92, 100, 108, 142].map((t) => t / 1000) } })

        const metadata = await extractVideoMetadata(mediaFile(['webm'], 'hfr.webm', 'video/webm'))

        expect([120, 119.88]).toContain(metadata.frameRate)
        expect(metadata.frameRateSource).toBe('measured')
      })

      // Review round 3, G1: a real Chromium run of a 60 fps MP4 with the page's
      // main thread busy, its first callback left out, so every spacing the
      // page saw is two source frames. The media times alone read 30; the
      // compositor's presented-frame counter says 60.
      it('stores a busy 60 fps run as 60 from the presented-frame counter, not 30', async () => {
        vi.useFakeTimers()
        try {
          media.script({
            video: {
              frameTimes: [33, 67, 100, 133, 167, 200, 233].map((t) => t / 1000),
              presentedFrames: [3, 5, 7, 9, 11, 13, 15],
            },
          })
          const pending = extractVideoMetadata(mediaFile(['v'], 'busy.mp4', 'video/mp4'))

          await vi.advanceTimersByTimeAsync(500)

          const metadata = await pending
          expect([60, 59.94]).toContain(metadata.frameRate)
          expect(metadata.frameRateSource).toBe('measured')
        } finally {
          vi.useRealTimers()
        }
      })

      it('measures 24 and 29.97 the same way', async () => {
        media.script({ video: { frameTimes: spaced(1 / 24, 8) } })
        await expect(extractVideoMetadata(mediaFile(['v'], 'film.mp4', 'video/mp4'))).resolves.toMatchObject({
          frameRate: 24,
          frameRateSource: 'measured',
        })

        media.script({ video: { frameTimes: spaced(1001 / 30000, 8) } })
        await expect(extractVideoMetadata(mediaFile(['v'], 'ntsc.mp4', 'video/mp4'))).resolves.toMatchObject({
          frameRate: 29.97,
          frameRateSource: 'measured',
        })
      })

      it('assumes 30 when only two frames are presented before the probe gives up', async () => {
        vi.useFakeTimers()
        try {
          media.script({ video: { frameTimes: spaced(1 / 60, 2) } })
          const pending = extractVideoMetadata(mediaFile(['v'], 'stalls.mp4', 'video/mp4'))

          await vi.advanceTimersByTimeAsync(500)

          await expect(pending).resolves.toMatchObject({ frameRate: 30, frameRateSource: 'assumed' })
        } finally {
          vi.useRealTimers()
        }
      })

      it('revokes the object URL once, only after the probe has played the element', async () => {
        media.script({ video: { frameTimes: spaced(1 / 60, 8) } })
        // What the element had been asked to do by the time its URL went away.
        const atRevoke: number[] = []
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
          atRevoke.push(vi.mocked(media.videos[0].play).mock.calls.length)
        })
        try {
          await extractVideoMetadata(mediaFile(['v'], 'order.mp4', 'video/mp4'))
        } finally {
          revoke.mockRestore()
        }
        expect(atRevoke).toEqual([1])
      })

      it('does not probe a file that decoded no picture', async () => {
        media.script({ video: { videoWidth: 0, videoHeight: 0, frameTimes: spaced(1 / 60, 8) } })

        const metadata = await extractVideoMetadata(mediaFile(['mic'], 'take.webm', 'video/webm'))

        expect(media.videos[0].play).not.toHaveBeenCalled()
        expect(metadata.frameRateSource).toBe('assumed')
      })

      it('does not probe a picture with only one zero dimension either', async () => {
        media.script({ video: { videoWidth: 640, videoHeight: 0, frameTimes: spaced(1 / 60, 8) } })

        await extractVideoMetadata(mediaFile(['x'], 'odd.mp4', 'video/mp4'))

        expect(media.videos[0].play).not.toHaveBeenCalled()
      })
    })

    it('generates unique IDs for each video', async () => {
      const file1 = new File(['data1'], 'video1.mp4', { type: 'video/mp4' })
      const file2 = new File(['data2'], 'video2.mp4', { type: 'video/mp4' })

      const metadata1 = await extractVideoMetadata(file1)
      const metadata2 = await extractVideoMetadata(file2)

      expect(metadata1.id).not.toBe(metadata2.id)
    })

    it('rejects and revokes the object URL when the file will not decode', async () => {
      media.script({ video: { fail: true } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')
      const file = new File(['junk'], 'broken.mp4', { type: 'video/mp4' })

      await expect(extractVideoMetadata(file)).rejects.toThrow('Failed to load video: broken.mp4')
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })

    // A WebM written without a Duration element — raw MediaRecorder output, or a
    // CRAFT take whose metadata fix failed — reports Infinity (or 0) on
    // loadedmetadata. Seeking past the end makes the browser scan the container
    // and report the real length; anything else leaves an infinitely long clip.
    it('seeks to the end to learn the duration of a file that reports Infinity', async () => {
      media.script({ video: { duration: Infinity, durationAfterSeek: 12.5 } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')
      const file = new File(['webm'], 'headerless.webm', { type: 'video/webm' })

      const metadata = await extractVideoMetadata(file)

      expect(metadata.duration).toBe(12.5)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })

    it('seeks to the end to learn the duration of a file that reports 0', async () => {
      media.script({ video: { duration: 0, durationAfterSeek: 8 } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      const metadata = await extractVideoMetadata(
        new File(['webm'], 'zero.webm', { type: 'video/webm' })
      )

      expect(metadata.duration).toBe(8)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      revoke.mockRestore()
    })

    // Firefox announces nothing new on 'durationchange'; the end seek shows up
    // only as the position it clamped to, so `currentTime` is the fallback.
    it('takes the clamped seek position when the seek reveals no new duration', async () => {
      media.script({
        video: { duration: Infinity, durationAfterSeek: 6.25, durationStaysUnknown: true },
      })

      const metadata = await extractVideoMetadata(
        new File(['webm'], 'position-only.webm', { type: 'video/webm' })
      )

      expect(metadata.duration).toBe(6.25)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
    })

    // ESCSUITE-249: before `loadedmetadata` nothing bounded the wait, so a file
    // the browser neither decoded nor rejected sat on "Processing..." forever.
    describe('the metadata deadline (ESCSUITE-249)', () => {
      afterEach(() => {
        vi.useRealTimers()
      })

      it('rejects a video that never reports its metadata, at 15 s and not before', async () => {
        vi.useFakeTimers()
        media.script({ video: { silent: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const pending = extractVideoMetadata(new File(['x'], 'mute.mp4', { type: 'video/mp4' }))
        let settled = false
        pending.then(() => (settled = true), () => (settled = true))
        const rejection = expect(pending).rejects.toThrow(
          'Could not read mute.mp4 \u2014 the browser did not report its metadata within 15 s'
        )

        await vi.advanceTimersByTimeAsync(14_999)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)

        await rejection
        expect(revoke).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
        revoke.mockRestore()
      })

      it('rejects an audio file that never reports its metadata the same way', async () => {
        vi.useFakeTimers()
        media.script({ audio: { silent: true } })
        const pending = extractAudioMetadata(new File(['x'], 'mute.mp3', { type: 'audio/mp3' }))
        const rejection = expect(pending).rejects.toThrow(
          'Could not read mute.mp3 \u2014 the browser did not report its metadata within 15 s'
        )

        await vi.advanceTimersByTimeAsync(15_000)

        await rejection
      })

      it('clears the deadline when loadedmetadata arrives first, so nothing rejects late', async () => {
        vi.useFakeTimers()
        media.script({ video: { duration: 4 } })

        const metadata = await extractVideoMetadata(new File(['x'], 'ok.mp4', { type: 'video/mp4' }))

        expect(metadata.duration).toBe(4)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(20_000)
      })

      it('clears the deadline when the element errors first', async () => {
        vi.useFakeTimers()
        media.script({ video: { fail: true } })

        await expect(
          extractVideoMetadata(new File(['x'], 'bad.mp4', { type: 'video/mp4' }))
        ).rejects.toThrow('Failed to load video: bad.mp4')

        expect(vi.getTimerCount()).toBe(0)
      })

      it('hands over to the end-seek probe\'s own 5 s deadline once metadata has arrived', async () => {
        vi.useFakeTimers()
        media.script({ video: { duration: Infinity, stallSeek: true } })
        const pending = extractVideoMetadata(new File(['x'], 'slow.webm', { type: 'video/webm' }))
        const rejection = expect(pending).rejects.toThrow(
          'Could not determine the duration of slow.webm'
        )

        await vi.advanceTimersByTimeAsync(5000)

        await rejection
        expect(vi.getTimerCount()).toBe(0)
      })
    })

    it('rejects when the end seek never reports back', async () => {
      vi.useFakeTimers()
      try {
        media.script({ video: { duration: Infinity, stallSeek: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const pending = extractVideoMetadata(
          new File(['webm'], 'stalled.webm', { type: 'video/webm' })
        )
        const rejection = expect(pending).rejects.toThrow(
          'Could not determine the duration of stalled.webm'
        )

        await vi.advanceTimersByTimeAsync(5000)

        await rejection
        expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
        expect(revoke).toHaveBeenCalledTimes(1)
        revoke.mockRestore()
      } finally {
        vi.useRealTimers()
      }
    })

    // Nothing clamped the seek, so the element reports back the very target we
    // asked for. That is a seek target, not a length: accepting it would put
    // 285 million years on the timeline, which is worse than the Infinity this
    // fallback exists to remove, because a finite number propagates silently
    // into the clip, the timeline duration, the zoom and the export length.
    it('refuses the seek target itself as a duration', async () => {
      vi.useFakeTimers()
      try {
        // No durationAfterSeek, so the double does not clamp — a browser that
        // has not yet worked out where the end is.
        media.script({ video: { duration: Infinity } })
        const pending = extractVideoMetadata(
          new File(['webm'], 'unclamped.webm', { type: 'video/webm' })
        )
        const rejection = expect(pending).rejects.toThrow(
          'Could not determine the duration of unclamped.webm'
        )

        await vi.advanceTimersByTimeAsync(5000)

        await rejection
        expect(media.videos[0].currentTime).toBe(Number.MAX_SAFE_INTEGER)
      } finally {
        vi.useRealTimers()
      }
    })

    // An element that errors after the seek has started must not leave the
    // probe's timer armed: it holds the element, the File and the URL, and it
    // would revoke a second time when it eventually fired.
    it('tears the probe down when the element errors mid-seek', async () => {
      vi.useFakeTimers()
      try {
        media.script({ video: { duration: Infinity, stallSeek: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const pending = extractVideoMetadata(
          new File(['webm'], 'dies.webm', { type: 'video/webm' })
        )
        const rejection = expect(pending).rejects.toThrow('Failed to load video: dies.webm')

        // Let loadedmetadata run and the probe arm itself, then kill the element.
        await vi.advanceTimersByTimeAsync(0)
        expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
        media.videos[0].dispatchEvent(new Event('error'))

        await rejection
        expect(revoke).toHaveBeenCalledTimes(1)

        // Five seconds on, the probe's timeout is gone rather than firing.
        await vi.advanceTimersByTimeAsync(5000)
        expect(revoke).toHaveBeenCalledTimes(1)
        revoke.mockRestore()
      } finally {
        vi.useRealTimers()
      }
    })

    // Both events arrive and neither carries a usable length: the extractor waits
    // for the other one rather than resolving on the first, then gives up.
    it('rejects when the end seek reveals nothing usable', async () => {
      vi.useFakeTimers()
      try {
        media.script({ video: { duration: Infinity, durationAfterSeek: 0 } })
        const pending = extractVideoMetadata(
          new File(['webm'], 'empty.webm', { type: 'video/webm' })
        )
        const rejection = expect(pending).rejects.toThrow(
          'Could not determine the duration of empty.webm'
        )

        await vi.advanceTimersByTimeAsync(5000)

        await rejection
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('generateThumbnail', () => {
    it('seeks 10% into the video and encodes the frame as JPEG', async () => {
      media.script({ video: { videoWidth: 1920, videoHeight: 1080, duration: 20 } })
      const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

      const blob = await generateThumbnail(file)

      expect(media.seeks).toEqual([2])
      const ctx = getLastCanvasContext()!
      // 16:9 source into a 160x90 box: letterboxed to the box height.
      expect(ctx.canvas.height).toBe(90)
      expect(ctx.canvas.width).toBe(160)
      expect(ctx.argsFor('drawImage')).toEqual([[media.videos[0], 0, 0, 160, 90]])
      expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])
      expect(blob.type).toBe('image/jpeg')
    })

    it('seeks to an explicit time and fits a wider-than-box source by width', async () => {
      media.script({ video: { videoWidth: 2000, videoHeight: 1000, duration: 20 } })
      const file = new File(['video'], 'wide.mp4', { type: 'video/mp4' })

      await generateThumbnail(file, 7)

      expect(media.seeks).toEqual([7])
      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.width).toBe(160)
      expect(ctx.canvas.height).toBe(80)
    })

    it('honours a custom thumbnail box', async () => {
      media.script({ video: { videoWidth: 1000, videoHeight: 1000, duration: 10 } })
      await generateThumbnail(new File(['v'], 'square.mp4', { type: 'video/mp4' }), 1, 300, 200)

      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.height).toBe(200)
      expect(ctx.canvas.width).toBe(200)
    })

    it('rejects when the canvas hands back no 2D context', async () => {
      failNextGetContext()
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      await expect(generateThumbnail(new File(['v'], 'clip.mp4', { type: 'video/mp4' })))
        .rejects.toThrow('Failed to get canvas context')
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      revoke.mockRestore()
    })

    it('rejects when the canvas produces no blob', async () => {
      setDefaultToBlobResult(null)
      await expect(generateThumbnail(new File(['v'], 'clip.mp4', { type: 'video/mp4' })))
        .rejects.toThrow('Failed to generate thumbnail')
    })

    it('rejects when the video will not load', async () => {
      media.script({ video: { fail: true } })
      await expect(generateThumbnail(new File(['v'], 'broken.mp4', { type: 'video/mp4' })))
        .rejects.toThrow('Failed to load video for thumbnail: broken.mp4')
    })

    // ESCSUITE-305: on Firefox a seek into a Cues-less WebM never completes, and
    // the thumbnail's seek had no deadline — the import sat on "Processing..."
    // for ever. It now gives up after THUMBNAIL_SEEK_TIMEOUT_MS, by name.
    describe('the seek deadline (ESCSUITE-305)', () => {
      afterEach(() => {
        vi.useRealTimers()
      })

      it('rejects by name at 5 s and revokes its object URL once', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        media.script({ video: { stallSeek: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')

        const pending = generateThumbnail(new File(['v'], 'take.webm', { type: 'video/webm' }), 1.5)
        const outcome = pending.then(() => null, (error: unknown) => error)
        const video = media.videos[0]
        const removeAttribute = vi.spyOn(video, 'removeAttribute')
        await vi.advanceTimersByTimeAsync(4_999)
        expect(revoke).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)

        // Review round 1, MINOR 5: the wedged element is unloaded, not left
        // holding its source — Firefox stops loading new <video>s after four.
        expect(removeAttribute).toHaveBeenCalledWith('src')
        expect(video.load).toHaveBeenCalledTimes(1)

        expect(await outcome).toMatchObject({
          message: 'Could not capture a thumbnail of "take.webm" — the browser did not finish seeking within 5 s',
        })
        expect(revoke.mock.calls).toEqual([[lastObjectUrl()]])
        expect(THUMBNAIL_SEEK_TIMEOUT_MS).toBe(5_000)
        revoke.mockRestore()
      })

      it('resolves a seek that lands at 4.9 s and clears its deadline', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        media.script({ video: { stallSeek: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')

        const pending = generateThumbnail(new File(['v'], 'slow.webm', { type: 'video/webm' }), 1.5)
        await vi.advanceTimersByTimeAsync(4_900)
        media.videos[0].dispatchEvent(new Event('seeked'))

        expect((await pending).type).toBe('image/jpeg')
        expect(vi.getTimerCount()).toBe(0)
        expect(revoke).toHaveBeenCalledTimes(1)
        revoke.mockRestore()
      })

      it('revokes once and clears the deadline when the load fails', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        media.script({ video: { fail: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')

        await expect(generateThumbnail(new File(['v'], 'broken.mp4', { type: 'video/mp4' }))).rejects.toThrow(
          'Failed to load video for thumbnail: broken.mp4'
        )
        expect(vi.getTimerCount()).toBe(0)
        expect(revoke).toHaveBeenCalledTimes(1)
        revoke.mockRestore()
      })
    })
  })

  describe('processVideoFile', () => {
    let audio: AudioContextDoubles

    beforeEach(() => {
      audio = installAudioContextDouble(createAudioBufferDouble([tone()]))
    })

    afterEach(() => {
      audio.uninstall()
    })

    it('stores the video, its thumbnail and its waveform, and returns the metadata', async () => {
      media.script({ video: { videoWidth: 1280, videoHeight: 720, duration: 4 } })
      const file = mediaFile(['video bytes'], 'clip.mp4', 'video/mp4')

      const metadata = await processVideoFile(file)

      expect(metadata.mediaType).toBe('video')
      expect(metadata.thumbnailUrl).toBe(lastObjectUrl())
      expect(metadata.hasAudio).toBe(true)
      expect(metadata.waveformData!.length).toBeGreaterThan(0)

      const stored = await getVideo(metadata.id)
      expect(stored?.metadata.name).toBe('clip.mp4')
      expect(await stored!.blob.text()).toBe('video bytes')
      expect(await getThumbnail(metadata.id)).toBeDefined()
    })

    // generateThumbnail loads its own element, which reports the same useless
    // Infinity, so the thumbnail time comes from the metadata the extractor
    // recovered — otherwise the thumbnail seek is Infinity * 0.1.
    it('thumbnails a headerless file 10% into its recovered duration', async () => {
      media.script({ video: { duration: Infinity, durationAfterSeek: 20 } })

      const metadata = await processVideoFile(mediaFile(['video bytes'], 'raw.webm', 'video/webm'))

      expect(metadata.duration).toBe(20)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER, 2])
    })

    it('warns but still stores the video when the thumbnail cannot be made', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      failNextGetContext()

      const metadata = await processVideoFile(new File(['v'], 'clip.mp4', { type: 'video/mp4' }))

      expect(metadata.thumbnailUrl).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('Failed to generate thumbnail:', expect.any(Error))
      expect(await getVideo(metadata.id)).toBeDefined()
      expect(await getThumbnail(metadata.id)).toBeUndefined()
      warn.mockRestore()
    })

    // ESCSUITE-305 rule 2. A thumbnail was already cosmetic — a rejection was
    // warned about and the video stored without one — but a thumbnail seek that
    // never settled never rejected, so the import never finished.
    it('still stores the video, with no thumbnail, when the thumbnail seek never completes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        media.script({ video: { videoWidth: 1280, videoHeight: 720, duration: 15.5, stallSeek: true } })

        const pending = processVideoFile(mediaFile(['v'], 'take.webm', 'video/webm'))
        await vi.advanceTimersByTimeAsync(5_000)
        const metadata = await pending

        expect(metadata.thumbnailUrl).toBeUndefined()
        expect(warn).toHaveBeenCalledWith('Failed to generate thumbnail:', expect.any(Error))
        expect(await getVideo(metadata.id)).toBeDefined()
        expect(await getThumbnail(metadata.id)).toBeUndefined()
      } finally {
        vi.useRealTimers()
        warn.mockRestore()
      }
    })

    it('records hasAudio false when the file carries no decodable audio', async () => {
      audio.buffer = null
      const metadata = await processVideoFile(new File(['v'], 'silent.mp4', { type: 'video/mp4' }))

      expect(metadata.hasAudio).toBe(false)
      expect(metadata.waveformData).toEqual([])
    })

    it('warns and marks the video as having no audio when peak extraction throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      waveform.fail = true

      const metadata = await processVideoFile(new File(['v'], 'clip.mp4', { type: 'video/mp4' }))

      expect(metadata.hasAudio).toBe(false)
      expect(metadata.waveformData).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('Failed to extract waveform data:', expect.any(Error))
      warn.mockRestore()
    })
  })

  // The ?loadVideo= handoff from ESCAPECRAFT adds a stored recording from its
  // stored metadata, which never passed through extractVideoMetadata — so the
  // guard has to live here too, or a take stored as Infinity still builds an
  // infinitely long clip.
  describe('resolveStoredDuration', () => {
    /** A stored recording's metadata, with whatever duration the test is about. */
    const stored = (duration: number) => ({
      id: 'rec-1',
      name: 'Recording.webm',
      duration,
      width: 1280,
      height: 720,
      frameRate: 30,
      mimeType: 'video/webm',
      size: 1234,
    })

    it('trusts a usable stored duration without opening the blob', async () => {
      const blob = new Blob(['webm'], { type: 'video/webm' })

      await expect(resolveStoredDuration(blob, stored(12))).resolves.toBe(12)
      // No element created: the common path costs nothing.
      expect(media.videos).toHaveLength(0)
    })

    it('fails with the metadata-deadline sentence when the element never reports (ESCSUITE-249)', async () => {
      vi.useFakeTimers()
      try {
        media.script({ video: { silent: true } })
        const pending = resolveStoredDuration(new Blob(['webm'], { type: 'video/webm' }), stored(0))
        const rejection = expect(pending).rejects.toThrow(
          'Could not read Recording.webm \u2014 the browser did not report its metadata within 15 s'
        )

        await vi.advanceTimersByTimeAsync(15_000)

        await rejection
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('recovers the length of a recording stored with no usable duration', async () => {
      media.script({ video: { duration: Infinity, durationAfterSeek: 9 } })
      const blob = new Blob(['webm'], { type: 'video/webm' })

      await expect(resolveStoredDuration(blob, stored(Infinity))).resolves.toBe(9)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
    })

    it('recovers the length of a recording stored as zero', async () => {
      media.script({ video: { duration: 0, durationAfterSeek: 4 } })

      await expect(
        resolveStoredDuration(new Blob(['webm'], { type: 'video/webm' }), stored(0))
      ).resolves.toBe(4)
    })

    // It runs on the CRAFT handoff and the `.veditor` load, which already carry
    // a rate; recovering a length must not spend up to 400 ms measuring one.
    it('recovers a length without probing the frame rate (ESCSUITE-276)', async () => {
      media.script({ video: { duration: Infinity, durationAfterSeek: 9, frameTimes: [0, 0.01, 0.02, 0.03] } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      await expect(
        resolveStoredDuration(new Blob(['webm'], { type: 'video/webm' }), stored(Infinity))
      ).resolves.toBe(9)

      expect(media.videos[0].play).not.toHaveBeenCalled()
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })
  })

  describe('extractImageMetadata', () => {
    it('extracts metadata from an image file', async () => {
      media.script({ image: { naturalWidth: 800, naturalHeight: 600 } })
      const file = new File(['image data'], 'test-image.png', { type: 'image/png' })

      const metadata = await extractImageMetadata(file)

      expect(metadata.name).toBe('test-image.png')
      expect(metadata.mimeType).toBe('image/png')
      expect(metadata.width).toBe(800)
      expect(metadata.height).toBe(600)
      expect(metadata.duration).toBe(DEFAULT_IMAGE_DURATION)
      expect(metadata.mediaType).toBe('image')
      expect(metadata.frameRate).toBe(1)
      expect(metadata.frameRateSource).toBe('assumed')
    })

    it('rejects when the image will not decode', async () => {
      media.script({ image: { fail: true } })
      await expect(extractImageMetadata(new File(['x'], 'bad.png', { type: 'image/png' })))
        .rejects.toThrow('Failed to load image: bad.png')
    })
  })

  describe('generateImageThumbnail', () => {
    it('letterboxes a tall image into the box height', async () => {
      media.script({ image: { naturalWidth: 600, naturalHeight: 800 } })
      const blob = await generateImageThumbnail(new File(['i'], 'tall.png', { type: 'image/png' }))

      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.height).toBe(90)
      expect(ctx.canvas.width).toBe(67) // 90 * 600/800 = 67.5, truncated by the canvas
      expect(ctx.argsFor('drawImage')[0][0]).toBe(media.images[0])
      expect(blob.type).toBe('image/jpeg')
    })

    it('pillarboxes a wide image into the box width', async () => {
      media.script({ image: { naturalWidth: 1000, naturalHeight: 250 } })
      await generateImageThumbnail(new File(['i'], 'wide.png', { type: 'image/png' }))

      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.width).toBe(160)
      expect(ctx.canvas.height).toBe(40)
    })

    it('rejects when the canvas hands back no 2D context', async () => {
      failNextGetContext()
      await expect(generateImageThumbnail(new File(['i'], 'x.png', { type: 'image/png' })))
        .rejects.toThrow('Failed to get canvas context')
    })

    it('rejects when the canvas produces no blob', async () => {
      setDefaultToBlobResult(null)
      await expect(generateImageThumbnail(new File(['i'], 'x.png', { type: 'image/png' })))
        .rejects.toThrow('Failed to generate thumbnail')
    })

    it('rejects when the image will not load', async () => {
      media.script({ image: { fail: true } })
      await expect(generateImageThumbnail(new File(['i'], 'bad.png', { type: 'image/png' })))
        .rejects.toThrow('Failed to load image for thumbnail: bad.png')
    })
  })

  describe('processImageFile', () => {
    it('stores the image and its thumbnail', async () => {
      media.script({ image: { naturalWidth: 400, naturalHeight: 300 } })
      const metadata = await processImageFile(mediaFile(['png bytes'], 'pic.png', 'image/png'))

      expect(metadata.mediaType).toBe('image')
      expect(metadata.thumbnailUrl).toBe(lastObjectUrl())
      expect(await getThumbnail(metadata.id)).toBeDefined()
      expect(await (await getVideo(metadata.id))!.blob.text()).toBe('png bytes')
    })

    it('warns but still stores the image when the thumbnail cannot be made', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      failNextGetContext()

      const metadata = await processImageFile(new File(['i'], 'pic.png', { type: 'image/png' }))

      expect(metadata.thumbnailUrl).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('Failed to generate thumbnail:', expect.any(Error))
      expect(await getVideo(metadata.id)).toBeDefined()
      warn.mockRestore()
    })
  })

  describe('extractAudioMetadata', () => {
    it('extracts metadata from an audio file', async () => {
      media.script({ audio: { duration: 180.5 } })
      const file = new File(['audio data'], 'test-audio.mp3', { type: 'audio/mp3' })

      const metadata = await extractAudioMetadata(file)

      expect(metadata.name).toBe('test-audio.mp3')
      expect(metadata.mimeType).toBe('audio/mp3')
      expect(metadata.duration).toBe(180.5)
      expect(metadata.mediaType).toBe('audio')
      expect(metadata.width).toBe(0)
      expect(metadata.height).toBe(0)
      expect(metadata.frameRate).toBe(0)
      expect(metadata.frameRateSource).toBe('assumed')
    })

    it('rejects when the audio will not decode', async () => {
      media.script({ audio: { fail: true } })
      await expect(extractAudioMetadata(new File(['x'], 'bad.mp3', { type: 'audio/mp3' })))
        .rejects.toThrow('Failed to load audio: bad.mp3')
    })

    // The headerless WebM the video importer probes for arrives here too: an
    // ESCAPECRAFT take recorded with no camera is raw MediaRecorder Opus with
    // no Duration element, so 'loadedmetadata' reports Infinity and an
    // unchecked read builds an infinitely long audio clip.
    it('seeks to the end to learn the duration of audio that reports Infinity', async () => {
      media.script({ audio: { duration: Infinity, durationAfterSeek: 12.5 } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      const metadata = await extractAudioMetadata(
        new File(['webm'], 'headerless.webm', { type: 'audio/webm' })
      )

      expect(metadata.duration).toBe(12.5)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })

    it('seeks to the end to learn the duration of audio that reports 0', async () => {
      media.script({ audio: { duration: 0, durationAfterSeek: 8 } })

      const metadata = await extractAudioMetadata(
        new File(['webm'], 'zero.webm', { type: 'audio/webm' })
      )

      expect(metadata.duration).toBe(8)
      expect(media.seeks).toEqual([Number.MAX_SAFE_INTEGER])
    })

    it('rejects when the audio end seek never reports back', async () => {
      vi.useFakeTimers()
      try {
        media.script({ audio: { duration: Infinity, stallSeek: true } })
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const pending = extractAudioMetadata(
          new File(['webm'], 'stalled.webm', { type: 'audio/webm' })
        )
        const rejection = expect(pending).rejects.toThrow(
          'Could not determine the duration of stalled.webm'
        )

        await vi.advanceTimersByTimeAsync(5000)

        await rejection
        expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
        expect(revoke).toHaveBeenCalledTimes(1)
        revoke.mockRestore()
      } finally {
        vi.useRealTimers()
      }
    })

    // A container that declares its length costs nothing extra: no seek, and
    // the one revoke every settle path owes.
    it('believes a declared duration without seeking, and revokes once', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      const metadata = await extractAudioMetadata(
        new File(['audio data'], 'song.mp3', { type: 'audio/mp3' })
      )

      expect(metadata.duration).toBe(180)
      expect(media.seeks).toEqual([])
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })

    it('revokes the object URL exactly once when the audio errors', async () => {
      media.script({ audio: { fail: true } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      await expect(extractAudioMetadata(new File(['x'], 'bad.webm', { type: 'audio/webm' })))
        .rejects.toThrow('Failed to load audio: bad.webm')
      expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
      expect(revoke).toHaveBeenCalledTimes(1)
      revoke.mockRestore()
    })
  })

  describe('generateAudioThumbnail', () => {
    let audio: AudioContextDoubles

    beforeEach(() => {
      audio = installAudioContextDouble(createAudioBufferDouble([tone(1600)]))
    })

    afterEach(() => {
      audio.uninstall()
    })

    it('paints a waveform strip, closes the AudioContext and encodes JPEG', async () => {
      const blob = await generateAudioThumbnail(new File(['a'], 'song.mp3', { type: 'audio/mp3' }))

      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.width).toBe(160)
      expect(ctx.canvas.height).toBe(90)
      // Background painted first, then one line segment per pixel column.
      expect(ctx.argsFor('fillRect')).toEqual([[0, 0, 160, 90]])
      expect(ctx.argsFor('moveTo')).toHaveLength(160)
      expect(ctx.argsFor('lineTo')).toHaveLength(160)
      expect(ctx.argsFor('stroke')).toHaveLength(1)
      // The note glyph is centred in the strip.
      expect(ctx.argsFor('fillText')).toEqual([['♪', 80, 45]])
      expect(audio.closed).toBe(1)
      expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])
      expect(blob.type).toBe('image/jpeg')
    })

    it('honours a custom strip size', async () => {
      await generateAudioThumbnail(new File(['a'], 'song.mp3', { type: 'audio/mp3' }), 40, 20)
      const ctx = getLastCanvasContext()!
      expect(ctx.canvas.width).toBe(40)
      expect(ctx.canvas.height).toBe(20)
      expect(ctx.argsFor('moveTo')).toHaveLength(40)
    })

    it('rejects when the canvas hands back no 2D context', async () => {
      failNextGetContext()
      await expect(generateAudioThumbnail(new File(['a'], 'song.mp3', { type: 'audio/mp3' })))
        .rejects.toThrow('Failed to get canvas context')
    })

    it('rejects when the canvas produces no blob', async () => {
      setDefaultToBlobResult(null)
      await expect(generateAudioThumbnail(new File(['a'], 'song.mp3', { type: 'audio/mp3' })))
        .rejects.toThrow('Failed to generate audio thumbnail')
    })

    it('rejects when the audio cannot be decoded', async () => {
      audio.buffer = null
      await expect(generateAudioThumbnail(new File(['a'], 'song.mp3', { type: 'audio/mp3' })))
        .rejects.toThrow('Unable to decode audio data')
    })
  })

  describe('processAudioFile', () => {
    let audio: AudioContextDoubles

    beforeEach(() => {
      audio = installAudioContextDouble(createAudioBufferDouble([tone(), tone()]))
      media.script({ audio: { duration: 30 } })
    })

    afterEach(() => {
      audio.uninstall()
    })

    it('stores the audio, its waveform strip and its peak data', async () => {
      const metadata = await processAudioFile(mediaFile(['mp3 bytes'], 'song.mp3', 'audio/mp3'))

      expect(metadata.mediaType).toBe('audio')
      expect(metadata.thumbnailUrl).toBe(lastObjectUrl())
      expect(metadata.hasAudio).toBe(true)
      expect(metadata.waveformData!.length).toBeGreaterThan(0)
      expect(await getThumbnail(metadata.id)).toBeDefined()
      expect(await (await getVideo(metadata.id))!.blob.text()).toBe('mp3 bytes')
    })

    it('assumes an audio file has audio when peak extraction throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      waveform.fail = true

      const metadata = await processAudioFile(new File(['a'], 'song.mp3', { type: 'audio/mp3' }))

      expect(metadata.hasAudio).toBe(true)
      expect(metadata.waveformData).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('Failed to extract waveform data:', expect.any(Error))
      warn.mockRestore()
    })

    it('warns but still stores the audio when the strip cannot be drawn', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      failNextGetContext()

      const metadata = await processAudioFile(new File(['a'], 'song.mp3', { type: 'audio/mp3' }))

      expect(metadata.thumbnailUrl).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('Failed to generate audio thumbnail:', expect.any(Error))
      expect(await getVideo(metadata.id)).toBeDefined()
      warn.mockRestore()
    })
  })

  // ESCSUITE-255: one media-type decision for every entry path, made by what
  // the element decoded and not by the MIME type a browser guessed from an
  // extension. A microphone-only .webm arrives as video/webm.
  describe('processMediaFile', () => {
    let audio: AudioContextDoubles

    beforeEach(() => {
      audio = installAudioContextDouble(createAudioBufferDouble([tone()]))
    })

    afterEach(() => {
      audio.uninstall()
    })

    it('types a file whose <video> decodes a picture as video', async () => {
      media.script({ video: { videoWidth: 640, videoHeight: 360, duration: 4 } })

      const metadata = await processMediaFile(mediaFile(['v'], 'clip.mp4', 'video/mp4'))

      expect(metadata.mediaType).toBe('video')
      expect(metadata.width).toBe(640)
      expect(metadata.height).toBe(360)
      expect(metadata.thumbnailUrl).toBe(lastObjectUrl())
    })

    it('types a video/webm file that decodes no picture as audio (the regression)', async () => {
      media.script({ video: { videoWidth: 0, videoHeight: 0, duration: 7 }, audio: { duration: 7 } })

      const metadata = await processMediaFile(mediaFile(['mic'], 'take.webm', 'video/webm'))

      expect(metadata.mediaType).toBe('audio')
      expect(metadata.width).toBe(0)
      expect(metadata.height).toBe(0)
      expect(metadata.duration).toBe(7)
      expect(metadata.mimeType).toBe('video/webm')
      expect((await getVideo(metadata.id))?.metadata.mediaType).toBe('audio')
    })

    it('treats a picture with only one zero dimension as no picture', async () => {
      media.script({ video: { videoWidth: 640, videoHeight: 0 }, audio: { duration: 3 } })

      const metadata = await processMediaFile(mediaFile(['x'], 'odd.mp4', 'video/mp4'))

      expect(metadata.mediaType).toBe('audio')
    })

    it('sends an image/* file to the image path without a <video> probe', async () => {
      const metadata = await processMediaFile(mediaFile(['png'], 'pic.png', 'image/png'))

      expect(metadata.mediaType).toBe('image')
      expect(media.videos).toHaveLength(0)
    })

    it('sends an audio/* file straight to the audio path without a <video> probe', async () => {
      media.script({ audio: { duration: 30 } })

      const metadata = await processMediaFile(mediaFile(['a'], 'song.webm', 'audio/webm'))

      expect(metadata.mediaType).toBe('audio')
      expect(media.videos).toHaveLength(0)
    })

    it('stores an audio/wav file fetched from a URL as audio, the way ?video= and LOAD_VIDEO hand it over (ESCSUITE-228)', async () => {
      media.script({ audio: { duration: 12 } })
      // loadVideoFromUrl's blob wrapped in a File named for the URL, as both host paths do.
      const fetched = new Blob(['RIFF'], { type: 'audio/wav' })

      const metadata = await processMediaFile(new File([fetched], 'x.wav', { type: fetched.type }))

      expect(metadata.mediaType).toBe('audio')
      expect(metadata.width).toBe(0)
      expect((await getVideo(metadata.id))?.metadata.mediaType).toBe('audio')
      expect(media.videos).toHaveLength(0)
    })

    // ESCSUITE-305 rule 3: a WebM with an empty Cues index is stored remuxed
    // with one, so Firefox can seek it; one that already has an index, and any
    // file that is not a WebM, is stored byte for byte as it came.
    describe('the seek index (ESCSUITE-305)', () => {
      it('stores a WebM whose Cues index is empty remuxed with a real one', async () => {
        media.script({ video: { videoWidth: 16, videoHeight: 16, duration: 0.33 } })
        const original = buildWebm({ cues: 'empty' })

        const metadata = await processMediaFile(mediaFile([original as BlobPart], 'take.webm', 'video/webm;codecs=vp9'))

        const stored = await getVideo(metadata.id)
        const bytes = new Uint8Array(await stored!.blob.arrayBuffer())
        expect(hasNonEmptyCues(bytes)).toBe(true)
        expect(stored!.blob.type).toBe('video/webm;codecs=vp9')
        expect(metadata.size).toBe(stored!.blob.size)
      })

      it('stores a WebM that already has an index byte for byte', async () => {
        media.script({ video: { videoWidth: 16, videoHeight: 16, duration: 0.33 } })
        const original = buildWebm({ cues: 'indexed' })

        const metadata = await processMediaFile(mediaFile([original as BlobPart], 'take.webm', 'video/webm'))

        const stored = await getVideo(metadata.id)
        expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(original)
      })

      it('never probes a file that is not a WebM', async () => {
        media.script({ video: { videoWidth: 16, videoHeight: 16, duration: 0.33 } })
        // A Cues-less WebM's bytes under an MP4 type: the type decides, not the bytes.
        const original = buildWebm({ cues: 'empty' })

        const metadata = await processMediaFile(mediaFile([original as BlobPart], 'clip.mp4', 'video/mp4'))

        const stored = await getVideo(metadata.id)
        expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(original)
      })
    })

    it('rejects, as the video path always did, when the file will not decode', async () => {
      media.script({ video: { fail: true } })

      await expect(
        processMediaFile(mediaFile(['junk'], 'broken.mp4', 'video/mp4'))
      ).rejects.toThrow('Failed to load video: broken.mp4')
    })
  })

  describe('createVideoUrl', () => {
    it('returns an object URL for a stored video', async () => {
      await storeVideo(
        'created-url-video',
        new Blob(['bytes'], { type: 'video/mp4' }),
        {
          id: 'created-url-video',
          name: 'v.mp4',
          duration: 1,
          width: 10,
          height: 10,
          frameRate: 30,
          mimeType: 'video/mp4',
          size: 5,
        }
      )
      const createObjectURL = vi.spyOn(URL, 'createObjectURL')

      // lastObjectUrl() has to be read AFTER the call: the handle does not exist
      // until createVideoUrl mints it.
      const url = await createVideoUrl('created-url-video')
      expect(url).toBe(lastObjectUrl())
      expect(await (createObjectURL.mock.calls[0][0] as Blob).text()).toBe('bytes')
      createObjectURL.mockRestore()
    })

    it('returns null when no such video is stored', async () => {
      await expect(createVideoUrl('no-such-video')).resolves.toBeNull()
    })
  })

  describe('isWebCodecsSupported', () => {
    it('returns true when the three WebCodecs globals are present', () => {
      const codecs = installWebCodecsDoubles()
      try {
        expect(isWebCodecsSupported()).toBe(true)
      } finally {
        codecs.uninstall()
      }
    })

    it('returns false when WebCodecs APIs are not available', () => {
      const restore = removeWebCodecsGlobals()
      try {
        expect(isWebCodecsSupported()).toBe(false)
      } finally {
        restore()
      }
    })
  })

  describe('getSupportedCodecs', () => {
    it('returns empty arrays when WebCodecs is not supported', async () => {
      const restore = removeWebCodecsGlobals()
      try {
        await expect(getSupportedCodecs()).resolves.toEqual({ encode: [], decode: [] })
      } finally {
        restore()
      }
    })

    it('probes every candidate codec at 1080p30 and lists what each side accepts', async () => {
      const codecs = installWebCodecsDoubles()
      try {
        codecs.encoder.answer = (config) => config.codec.startsWith('avc1')
        codecs.decoder.answer = (config) => config.codec === 'vp8'

        const result = await getSupportedCodecs()

        expect(result.encode).toEqual(['avc1.42E01E', 'avc1.4D401E', 'avc1.64001E'])
        expect(result.decode).toEqual(['vp8'])
        expect(codecs.encoder.configs[0]).toEqual({
          codec: 'avc1.42E01E',
          width: 1920,
          height: 1080,
          framerate: 30,
          bitrate: 5_000_000,
        })
        expect(codecs.decoder.configs[0]).toEqual({
          codec: 'avc1.42E01E',
          codedWidth: 1920,
          codedHeight: 1080,
        })
      } finally {
        codecs.uninstall()
      }
    })

    it('skips codecs whose probe throws, on either side', async () => {
      const codecs = installWebCodecsDoubles()
      try {
        codecs.encoder.answer = (config) => {
          if (config.codec === 'vp8') throw new Error('unsupported codec')
          return true
        }
        codecs.decoder.answer = () => {
          throw new Error('unsupported codec')
        }

        const result = await getSupportedCodecs()

        expect(result.encode).not.toContain('vp8')
        expect(result.encode).toContain('avc1.42E01E')
        expect(result.decode).toEqual([])
      } finally {
        codecs.uninstall()
      }
    })
  })
})
