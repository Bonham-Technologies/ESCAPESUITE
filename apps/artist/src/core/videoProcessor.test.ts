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
  processVideoFile,
} from './videoProcessor'
import { getThumbnail, getVideo, storeVideo } from './storage'
import { DEFAULT_IMAGE_DURATION } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { mediaFile } from '../test/doubles/files'
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
      expect(metadata.frameRate).toBe(30)
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

    it('rejects and revokes the object URL when the file will not decode', async () => {
      media.script({ video: { fail: true } })
      const revoke = vi.spyOn(URL, 'revokeObjectURL')
      const file = new File(['junk'], 'broken.mp4', { type: 'video/mp4' })

      await expect(extractVideoMetadata(file)).rejects.toThrow('Failed to load video: broken.mp4')
      expect(revoke).toHaveBeenCalledWith('blob:mock-url')
      revoke.mockRestore()
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
      expect(revoke).toHaveBeenCalledWith('blob:mock-url')
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
      expect(metadata.thumbnailUrl).toBe('blob:mock-url')
      expect(metadata.hasAudio).toBe(true)
      expect(metadata.waveformData!.length).toBeGreaterThan(0)

      const stored = await getVideo(metadata.id)
      expect(stored?.metadata.name).toBe('clip.mp4')
      expect(await stored!.blob.text()).toBe('video bytes')
      expect(await getThumbnail(metadata.id)).toBeDefined()
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
      expect(metadata.thumbnailUrl).toBe('blob:mock-url')
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
    })

    it('rejects when the audio will not decode', async () => {
      media.script({ audio: { fail: true } })
      await expect(extractAudioMetadata(new File(['x'], 'bad.mp3', { type: 'audio/mp3' })))
        .rejects.toThrow('Failed to load audio: bad.mp3')
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
      expect(metadata.thumbnailUrl).toBe('blob:mock-url')
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

      await expect(createVideoUrl('created-url-video')).resolves.toBe('blob:mock-url')
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
