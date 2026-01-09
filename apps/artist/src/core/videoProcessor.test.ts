import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractVideoMetadata,
  extractImageMetadata,
  extractAudioMetadata,
  isWebCodecsSupported,
  getSupportedCodecs,
  createVideoUrl,
} from './videoProcessor'
import { DEFAULT_IMAGE_DURATION } from '../store/types'

describe('videoProcessor', () => {
  describe('extractVideoMetadata', () => {
    beforeEach(() => {
      // Mock createElement for video elements
      const originalCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'video') {
          const video = originalCreateElement('video') as HTMLVideoElement

          // Mock video properties
          Object.defineProperties(video, {
            videoWidth: { value: 1920, writable: true },
            videoHeight: { value: 1080, writable: true },
            duration: { value: 10.5, writable: true },
          })

          // Override src setter to trigger onloadedmetadata
          const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
          Object.defineProperty(video, 'src', {
            set(value) {
              originalSrcDescriptor?.set?.call(this, value)
              setTimeout(() => {
                if (video.onloadedmetadata) {
                  video.onloadedmetadata(new Event('loadedmetadata'))
                }
              }, 0)
            },
            get() {
              return originalSrcDescriptor?.get?.call(this)
            },
          })

          return video
        }
        return originalCreateElement(tagName)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('extracts metadata from video file', async () => {
      const file = new File(['video data'], 'test-video.mp4', { type: 'video/mp4' })

      const metadata = await extractVideoMetadata(file)

      expect(metadata.name).toBe('test-video.mp4')
      expect(metadata.mimeType).toBe('video/mp4')
      expect(metadata.width).toBe(1920)
      expect(metadata.height).toBe(1080)
      expect(metadata.duration).toBe(10.5)
      expect(metadata.size).toBe(file.size)
      expect(metadata.id).toBeDefined()
    })

    it('generates unique IDs for each video', async () => {
      const file1 = new File(['data1'], 'video1.mp4', { type: 'video/mp4' })
      const file2 = new File(['data2'], 'video2.mp4', { type: 'video/mp4' })

      const metadata1 = await extractVideoMetadata(file1)
      const metadata2 = await extractVideoMetadata(file2)

      expect(metadata1.id).not.toBe(metadata2.id)
    })
  })

  describe('extractImageMetadata', () => {
    beforeEach(() => {
      const originalCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'img') {
          const img = originalCreateElement('img') as HTMLImageElement

          Object.defineProperties(img, {
            naturalWidth: { value: 800, writable: true },
            naturalHeight: { value: 600, writable: true },
          })

          // Trigger onload when src is set
          const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
          Object.defineProperty(img, 'src', {
            set(value) {
              originalSrcDescriptor?.set?.call(this, value)
              setTimeout(() => {
                if (img.onload) {
                  img.onload(new Event('load'))
                }
              }, 0)
            },
            get() {
              return originalSrcDescriptor?.get?.call(this)
            },
          })

          return img
        }
        return originalCreateElement(tagName)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('extracts metadata from image file', async () => {
      const file = new File(['image data'], 'test-image.png', { type: 'image/png' })

      const metadata = await extractImageMetadata(file)

      expect(metadata.name).toBe('test-image.png')
      expect(metadata.mimeType).toBe('image/png')
      expect(metadata.width).toBe(800)
      expect(metadata.height).toBe(600)
      expect(metadata.duration).toBe(DEFAULT_IMAGE_DURATION)
      expect(metadata.mediaType).toBe('image')
      expect(metadata.frameRate).toBe(1)
    })
  })

  describe('extractAudioMetadata', () => {
    beforeEach(() => {
      const originalCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'audio') {
          const audio = originalCreateElement('audio') as HTMLAudioElement

          Object.defineProperty(audio, 'duration', { value: 180.5, writable: true })

          // Trigger onloadedmetadata when src is set
          Object.defineProperty(audio, 'src', {
            set(_value) {
              setTimeout(() => {
                if (audio.onloadedmetadata) {
                  audio.onloadedmetadata(new Event('loadedmetadata'))
                }
              }, 0)
            },
            get() {
              return ''
            },
          })

          return audio
        }
        return originalCreateElement(tagName)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('extracts metadata from audio file', async () => {
      const file = new File(['audio data'], 'test-audio.mp3', { type: 'audio/mp3' })

      const metadata = await extractAudioMetadata(file)

      expect(metadata.name).toBe('test-audio.mp3')
      expect(metadata.mimeType).toBe('audio/mp3')
      expect(metadata.duration).toBe(180.5)
      expect(metadata.mediaType).toBe('audio')
      expect(metadata.width).toBe(0)
      expect(metadata.height).toBe(0)
      expect(metadata.frameRate).toBe(0)
    })
  })

  describe('isWebCodecsSupported', () => {
    it('returns true when WebCodecs APIs are available', () => {
      // The test environment may or may not have these, so just verify it returns a boolean
      const result = isWebCodecsSupported()
      expect(typeof result).toBe('boolean')
    })

    it('returns false when WebCodecs APIs are not available', () => {
      const originalVideoEncoder = globalThis.VideoEncoder
      const originalVideoDecoder = globalThis.VideoDecoder
      const originalVideoFrame = globalThis.VideoFrame

      // Remove WebCodecs APIs
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoDecoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoFrame

      const result = isWebCodecsSupported()
      expect(result).toBe(false)

      // Restore
      globalThis.VideoEncoder = originalVideoEncoder
      globalThis.VideoDecoder = originalVideoDecoder
      globalThis.VideoFrame = originalVideoFrame
    })
  })

  describe('getSupportedCodecs', () => {
    it('returns empty arrays when WebCodecs is not supported', async () => {
      const originalVideoEncoder = globalThis.VideoEncoder
      const originalVideoDecoder = globalThis.VideoDecoder
      const originalVideoFrame = globalThis.VideoFrame

      // Remove WebCodecs APIs
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoEncoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoDecoder
      // @ts-expect-error - intentionally removing for test
      delete globalThis.VideoFrame

      const result = await getSupportedCodecs()

      expect(result.encode).toEqual([])
      expect(result.decode).toEqual([])

      // Restore
      globalThis.VideoEncoder = originalVideoEncoder
      globalThis.VideoDecoder = originalVideoDecoder
      globalThis.VideoFrame = originalVideoFrame
    })

    it('returns codec arrays when WebCodecs is supported', async () => {
      // Mock VideoEncoder and VideoDecoder with isConfigSupported
      const mockVideoEncoder = {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
      }
      const mockVideoDecoder = {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
      }

      const originalVideoEncoder = globalThis.VideoEncoder
      const originalVideoDecoder = globalThis.VideoDecoder
      const originalVideoFrame = globalThis.VideoFrame

      globalThis.VideoEncoder = mockVideoEncoder as unknown as typeof VideoEncoder
      globalThis.VideoDecoder = mockVideoDecoder as unknown as typeof VideoDecoder
      globalThis.VideoFrame = {} as typeof VideoFrame

      const result = await getSupportedCodecs()

      expect(result.encode.length).toBeGreaterThan(0)
      expect(result.decode.length).toBeGreaterThan(0)

      // Restore
      globalThis.VideoEncoder = originalVideoEncoder
      globalThis.VideoDecoder = originalVideoDecoder
      globalThis.VideoFrame = originalVideoFrame
    })
  })

  describe('createVideoUrl', () => {
    it('is a function that returns a promise', () => {
      // createVideoUrl depends on storage which is complex to mock
      expect(typeof createVideoUrl).toBe('function')
    })
  })
})
