import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateThumbnail, extractVideoMetadata } from './thumbnailGenerator'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
  resetVideoElementDouble,
} from '../test/doubles/video'
import { getLastCanvasContext, resetCanvasContextDouble } from '../test/doubles/canvas'

/**
 * How long a probe in this module is given before it is abandoned — this
 * file's own copy of the source's `THUMBNAIL_TIMEOUT_MS`, not an import of it
 * (ESCSUITE-180). Both probes share it: `extractVideoMetadata`'s timeout was
 * 5 s before the constant existed and is unchanged by naming it.
 */
const DEADLINE_MS = 5_000

describe('thumbnailGenerator', () => {
  beforeEach(() => {
    installVideoElementDouble()
    resetVideoElementDouble()
    resetCanvasContextDouble()
    vi.mocked(URL.createObjectURL).mockClear()
    vi.mocked(URL.revokeObjectURL).mockClear()
  })

  afterEach(() => {
    uninstallVideoElementDouble()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('generateThumbnail', () => {
    it('draws the loaded frame and resolves with the produced blob', async () => {
      const videoBlob = new Blob(['source-video'], { type: 'video/webm' })
      const promise = generateThumbnail(videoBlob)

      const video = getLastVideoDouble()!
      const ctx = getLastCanvasContext()!
      video.setMetadata({ videoWidth: 1280, videoHeight: 720 })
      video.fireLoadedData()

      const result = await promise

      expect(result).toBeInstanceOf(Blob)
      expect(ctx.drawImage).toHaveBeenCalledWith(video.element, 0, 0, 320, 180)
      expect(ctx.canvas.width).toBe(320)
      expect(ctx.canvas.height).toBe(180)
      // The source requested a JPEG at the expected quality — asserting the
      // recorded call args, not just the double's default toBlobResult type.
      expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])
      expect(video.element.muted).toBe(true)
      expect(video.element.preload).toBe('metadata')
      // Cleaned up: object URL revoked, src attribute cleared
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('rejects when no 2D canvas context is available', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null)

      await expect(generateThumbnail(new Blob())).rejects.toThrow('Failed to get 2D context')
    })

    it('rejects and cleans up when the video fails to load', async () => {
      const promise = generateThumbnail(new Blob())
      const video = getLastVideoDouble()!

      video.fireError()

      await expect(promise).rejects.toThrow('Failed to load video for thumbnail')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('rejects and cleans up when drawing the frame throws', async () => {
      const promise = generateThumbnail(new Blob())
      const video = getLastVideoDouble()!
      const ctx = getLastCanvasContext()!
      ctx.drawImage.mockImplementationOnce(() => {
        throw new Error('draw failed')
      })

      video.fireLoadedData()

      await expect(promise).rejects.toThrow('Failed to draw video frame')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('detaches its handlers on cleanup, so the emptied src cannot re-enter it', async () => {
      // ESCSUITE-55. cleanup() ends with `video.src = ''`, and Chromium treats
      // an empty src as a load failure: it fires `error` at the element. With
      // onerror still attached that handler calls cleanup() again, which sets
      // `src = ''` again — an error loop that never ends. Measured in a real
      // browser at ~44,500 iterations a second, for the life of the page.
      //
      // fireError() here stands in for the error the platform raises against
      // the emptied src. One cleanup must mean one revoke.
      const promise = generateThumbnail(new Blob(['source-video']))
      const video = getLastVideoDouble()!
      video.fireLoadedData()
      await promise

      video.fireError()

      expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(1)
      // Twice: once to start the load, once in cleanup() to release it. The
      // release is two steps and the six `getAttribute('src')` assertions only
      // cover the first — without cleanup()'s load() this reads 1, the element
      // keeps the resource it already loaded and never reaches NETWORK_EMPTY,
      // and every other test in this file still passes.
      expect(vi.mocked(video.element.load)).toHaveBeenCalledTimes(2)
    })

    it('gives up on a probe that never settles, so a save cannot park on it', async () => {
      // ESCSUITE-180. Since ESCSUITE-174, `'saving'` has no user-reachable
      // exit at all — Record is disabled there, Cancel is not rendered and
      // Escape is inert — so the save promise settling is the only way out.
      // This function had an `onerror` and no clock, so a <video> that neither
      // loads nor errors (a container Chromium's demuxer will not commit to,
      // a decoder that never reports) parked the save, and with it the app,
      // for the life of the tab. `extractVideoMetadata` below has carried a
      // deadline since it was written; this is its twin.
      //
      // DEADLINE_MS is deliberately this file's own copy of the source's
      // `THUMBNAIL_TIMEOUT_MS` rather than an import of it, the way
      // `useRecordingSave.test.ts` keeps its own `captured()` beside the
      // hook's `NOTHING_CAPTURED`: what is pinned here is that a probe is
      // abandoned within a few seconds, not whatever number the source
      // happens to hold today.
      vi.useFakeTimers()
      const promise = generateThumbnail(new Blob(['source-video']))
      const video = getLastVideoDouble()!

      await vi.advanceTimersByTimeAsync(DEADLINE_MS)

      await expect(promise).rejects.toThrow('Timed out loading video for thumbnail')
      // The same release the error and draw-failure arms do: the object URL is
      // revoked and the element is taken back to NETWORK_EMPTY, so a probe
      // that was abandoned leaks neither.
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
      expect(vi.mocked(video.element.load)).toHaveBeenCalledTimes(2)
    })

    it('does not reject after the deadline once the frame was captured', async () => {
      // The other side of the clock: a probe that answered in time keeps its
      // blob, and the timer it no longer needs is cleared rather than left to
      // fire behind a settled promise — one deadline, one clearTimeout, and
      // one revoke.
      vi.useFakeTimers()
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const promise = generateThumbnail(new Blob(['source-video']))
      const video = getLastVideoDouble()!
      video.setMetadata({ videoWidth: 1280, videoHeight: 720 })

      video.fireLoadedData()
      await vi.advanceTimersByTimeAsync(32)
      const result = await promise

      await vi.advanceTimersByTimeAsync(DEADLINE_MS)

      expect(result).toBeInstanceOf(Blob)
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(1)
    })

    it('rejects when the canvas produces no blob', async () => {
      const promise = generateThumbnail(new Blob())
      const video = getLastVideoDouble()!
      const ctx = getLastCanvasContext()!
      ctx.toBlobResult = null

      video.fireLoadedData()

      await expect(promise).rejects.toThrow('Failed to create thumbnail blob')
    })
  })

  describe('extractVideoMetadata', () => {
    it('resolves with the video element duration and dimensions', async () => {
      const promise = extractVideoMetadata(new Blob(['x']), 10)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 42.5, videoWidth: 640, videoHeight: 480 })

      video.fireLoadedData()

      await expect(promise).resolves.toEqual({ duration: 42.5, width: 640, height: 480 })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('falls back to the known duration when the video reports Infinity', async () => {
      const promise = extractVideoMetadata(new Blob(['x']), 30)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: Infinity, videoWidth: 640, videoHeight: 480 })

      video.fireLoadedData()

      await expect(promise).resolves.toEqual({ duration: 30, width: 640, height: 480 })
    })

    it('falls back to the known duration when the video reports zero', async () => {
      const promise = extractVideoMetadata(new Blob(['x']), 15)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 0, videoWidth: 640, videoHeight: 480 })

      video.fireLoadedData()

      await expect(promise).resolves.toEqual({ duration: 15, width: 640, height: 480 })
    })

    it('falls back to zero duration when no known duration was given', async () => {
      const promise = extractVideoMetadata(new Blob(['x']))
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 0, videoWidth: 640, videoHeight: 480 })

      video.fireLoadedData()

      await expect(promise).resolves.toEqual({ duration: 0, width: 640, height: 480 })
    })

    it('falls back to default dimensions when the video reports none', async () => {
      const promise = extractVideoMetadata(new Blob(['x']), 5)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 5, videoWidth: 0, videoHeight: 0 })

      video.fireLoadedData()

      await expect(promise).resolves.toEqual({ duration: 5, width: 1920, height: 1080 })
    })

    it('resolves with defaults and cleans up when the video fails to load', async () => {
      const promise = extractVideoMetadata(new Blob(['x']), 20)
      const video = getLastVideoDouble()!

      video.fireError()

      await expect(promise).resolves.toEqual({ duration: 20, width: 1920, height: 1080 })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('detaches its handlers on cleanup, so the emptied src cannot re-enter it', async () => {
      // ESCSUITE-55, and this is the one that actually bit: saving a recording
      // calls extractVideoMetadata exactly once, and from the second take of a
      // session onward the page was ~85% busy spinning in this handler.
      //
      // cleanup() ends with `video.src = ''`, which Chromium treats as a load
      // failure and answers with an `error` event. With onerror still attached
      // that re-enters cleanup, which empties src again — forever. fireError()
      // stands in for the error the platform raises against the emptied src;
      // one cleanup must mean one revoke and one clearTimeout.
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const promise = extractVideoMetadata(new Blob(['x']), 10)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 10, videoWidth: 640, videoHeight: 480 })
      video.fireLoadedData()
      await promise

      video.fireError()

      expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(1)
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      // As above — one to start, one to release. removeAttribute alone does
      // not release the resource.
      expect(vi.mocked(video.element.load)).toHaveBeenCalledTimes(2)
    })

    it('resolves with defaults and cleans up the object URL when the video never loads', async () => {
      // Regression test: the timeout branch used to resolve without revoking
      // the blob URL or clearing the video's src, leaking the object URL and
      // leaving a dangling <video> element indefinitely.
      vi.useFakeTimers()
      const promise = extractVideoMetadata(new Blob(['x']), 20)
      const video = getLastVideoDouble()!

      await vi.advanceTimersByTimeAsync(5000)

      await expect(promise).resolves.toEqual({ duration: 20, width: 1920, height: 1080 })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(video.element.getAttribute('src')).toBeNull()
    })

    it('does not resolve again after the timeout once loadeddata already fired', async () => {
      vi.useFakeTimers()
      const promise = extractVideoMetadata(new Blob(['x']), 20)
      const video = getLastVideoDouble()!
      video.setMetadata({ duration: 12, videoWidth: 640, videoHeight: 480 })

      video.fireLoadedData()
      const result = await promise

      // Advancing past the timeout window must not throw or hang now that
      // the promise already settled.
      await vi.advanceTimersByTimeAsync(5000)

      expect(result).toEqual({ duration: 12, width: 640, height: 480 })
    })
  })
})
