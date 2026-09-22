import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateThumbnail, generateStreamThumbnail, extractVideoMetadata } from './thumbnailGenerator'
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
  resetVideoElementDouble,
} from '../test/doubles/video'
import { getLastCanvasContext, resetCanvasContextDouble } from '../test/doubles/canvas'

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

  describe('generateStreamThumbnail', () => {
    function createMockStream(): MediaStream {
      return { id: 'mock-live-stream' } as unknown as MediaStream
    }

    it('draws a frame from the live stream after it stabilizes', async () => {
      vi.useFakeTimers()
      const stream = createMockStream()
      const promise = generateStreamThumbnail(stream)

      const video = getLastVideoDouble()!
      const ctx = getLastCanvasContext()!
      video.fireLoadedData()
      await vi.advanceTimersByTimeAsync(100)

      const result = await promise

      expect(result).toBeInstanceOf(Blob)
      expect(video.element.play).toHaveBeenCalled()
      expect(ctx.drawImage).toHaveBeenCalledWith(video.element, 0, 0, 320, 180)
      expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])
      expect(video.element.srcObject).toBeNull()
    })

    it('rejects when no 2D canvas context is available', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null)

      await expect(generateStreamThumbnail(createMockStream())).rejects.toThrow('Failed to get 2D context')
    })

    it('rejects when the canvas produces no blob', async () => {
      vi.useFakeTimers()
      const promise = generateStreamThumbnail(createMockStream())
      const rejection = expect(promise).rejects.toThrow('Failed to create thumbnail blob')
      const video = getLastVideoDouble()!
      const ctx = getLastCanvasContext()!
      ctx.toBlobResult = null

      video.fireLoadedData()
      await vi.advanceTimersByTimeAsync(100)

      await rejection
    })

    it('rejects and clears srcObject when the stream fails to load', async () => {
      const promise = generateStreamThumbnail(createMockStream())
      const video = getLastVideoDouble()!

      video.fireError()

      await expect(promise).rejects.toThrow('Failed to load stream for thumbnail')
      expect(video.element.srcObject).toBeNull()
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
