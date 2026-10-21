// ESCSUITE-324: the seek-index probe-and-remux (ESCSUITE-305) runs BEFORE the
// metadata probe. A WebM with no Duration and no Cues is the file whose
// end-seek wedges on Firefox, so the duration probe has to read repaired bytes.
//
// The raw-file failure the red cases reproduce is the 5 s end-seek probe's
// ("Could not determine the duration of <name>"), not the 15 s metadata
// deadline: `loadedmetadata` arrives, it is the end-seek that never lands.
//
// The <video> double is scripted per blob, the way the 305 tests key on bytes:
// a seek wedges only while the element holds the raw Cues-less file, and lands
// (clamped to 5 s, `durationStaysUnknown`) while it holds anything else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processMediaFile, processVideoFile } from './videoProcessor'
import * as seekIndex from './webmSeekIndex'
import { getVideo } from './storage'
import { buildWebm, hasNonEmptyCues } from '../test/fixtures/webmFixture'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { installCanvasDouble, uninstallCanvasDouble } from '../test/doubles/canvas'
import { mediaFile } from '../test/doubles/files'

// The waveform reads the file too — through mediabunny's BlobSource, which
// slices it — since ESCSUITE-338. That read is not the seek index's, and the
// "never reads its head" cases below count the seek index's alone.
vi.mock('../utils/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/waveform')>()),
  extractWaveformData: vi.fn(async () => ({ peaks: [], hasAudio: false })),
}))

vi.mock('./webmSeekIndex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./webmSeekIndex')>()
  return { ...actual, withSeekIndex: vi.fn(actual.withSeekIndex) }
})

describe('the seek index is repaired before the metadata probe (ESCSUITE-324)', () => {
  let media: MediaDoubles
  let held: Blob | undefined
  let rawFile: File | undefined
  let handedToElements: Blob[]

  beforeEach(() => {
    vi.mocked(seekIndex.withSeekIndex).mockClear()
    held = undefined
    rawFile = undefined
    handedToElements = []
    media = installMediaElementDoubles()
    installCanvasDouble()
    // The setup file's stub already mints distinct handles; this only records
    // which blob each one was minted for (the element holds the last).
    const mint = vi.mocked(URL.createObjectURL).getMockImplementation()!
    vi.mocked(URL.createObjectURL).mockImplementation((object: Blob | MediaSource) => {
      held = object as Blob
      if ((object as Blob).type.includes('webm')) handedToElements.push(held)
      return mint(object)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(URL.createObjectURL).mockReset()
    media.uninstall()
    uninstallCanvasDouble()
  })

  /** Headerless (Infinity), end-seek only answers as a clamped position, and wedges on the raw file. */
  function scriptFirefox(): void {
    media.script({
      video: {
        videoWidth: 16,
        videoHeight: 16,
        duration: Infinity,
        durationAfterSeek: 5,
        durationStaysUnknown: true,
        wedgeSeekAt: () => held === rawFile,
      },
    })
  }

  async function settle<T>(pending: Promise<T>): Promise<T | Error> {
    const outcome = pending.then(
      (value) => value,
      (error: unknown) => error as Error
    )
    await vi.advanceTimersByTimeAsync(20_000)
    return outcome
  }

  it('processVideoFile: a Cues-less, Duration-less WebM imports from the repaired bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    scriptFirefox()
    rawFile = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'raw.webm', 'video/webm')

    const result = await settle(processVideoFile(rawFile))

    expect(result).not.toBeInstanceOf(Error)
    const metadata = result as Awaited<ReturnType<typeof processVideoFile>>
    expect(metadata.duration).toBe(5)
    const stored = await getVideo(metadata.id)
    expect(hasNonEmptyCues(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe(true)
    // The metadata probe never saw the raw file.
    expect(handedToElements.length).toBeGreaterThan(0)
    expect(handedToElements).not.toContain(rawFile)
    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
  })

  it('processMediaFile: the ?video= / LOAD_VIDEO path gets the same order', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    scriptFirefox()
    rawFile = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'raw.webm', 'video/webm;codecs=vp9')

    const result = await settle(processMediaFile(rawFile))

    expect(result).not.toBeInstanceOf(Error)
    const metadata = result as Awaited<ReturnType<typeof processMediaFile>>
    expect(metadata.duration).toBe(5)
    expect(metadata.mediaType).toBe('video')
    const stored = await getVideo(metadata.id)
    expect(hasNonEmptyCues(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe(true)
    expect(handedToElements).not.toContain(rawFile)
    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
  })

  it('an already-indexed WebM is neither remuxed nor handled twice', async () => {
    media.script({ video: { videoWidth: 16, videoHeight: 16, duration: 0.33 } })
    const bytes = buildWebm({ cues: 'indexed' })
    const file = mediaFile([bytes as BlobPart], 'indexed.webm', 'video/webm')

    const metadata = await processVideoFile(file)

    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
    expect(handedToElements.every((object) => object === file)).toBe(true)
    const stored = await getVideo(metadata.id)
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(bytes)
  })

  it('a non-WebM file never reads its head for a seek index', async () => {
    media.script({ video: { videoWidth: 16, videoHeight: 16, duration: 0.33 } })
    const file = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'clip.mp4', 'video/mp4')
    const slice = vi.spyOn(file, 'slice')

    const metadata = await processMediaFile(file)

    expect(slice).not.toHaveBeenCalled()
    const stored = await getVideo(metadata.id)
    expect(stored!.blob.size).toBe(file.size)
  })

  function scriptFirefoxAudio(): void {
    media.script({
      audio: {
        duration: Infinity,
        durationAfterSeek: 5,
        durationStaysUnknown: true,
        wedgeSeekAt: () => held === rawFile,
      },
    })
  }

  it('processMediaFile: a Cues-less, Duration-less audio/webm is repaired before the audio probe', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    scriptFirefoxAudio()
    rawFile = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'raw.webm', 'audio/webm;codecs=opus')

    const result = await settle(processMediaFile(rawFile))

    expect(result).not.toBeInstanceOf(Error)
    const metadata = result as Awaited<ReturnType<typeof processMediaFile>>
    expect(metadata.duration).toBe(5)
    expect(metadata.mediaType).toBe('audio')
    const stored = await getVideo(metadata.id)
    expect(hasNonEmptyCues(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe(true)
    expect(handedToElements).not.toContain(rawFile)
    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
  })

  it('an already-indexed audio/webm is not remuxed', async () => {
    media.script({ audio: { duration: 0.33 } })
    const bytes = buildWebm({ cues: 'indexed' })
    const file = mediaFile([bytes as BlobPart], 'indexed.webm', 'audio/webm')

    const metadata = await processMediaFile(file)

    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
    expect(handedToElements.every((object) => object === file)).toBe(true)
    const stored = await getVideo(metadata.id)
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(bytes)
  })

  it('a non-WebM audio file never reads its head for a seek index', async () => {
    media.script({ audio: { duration: 3 } })
    const file = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'song.mp3', 'audio/mpeg')
    const slice = vi.spyOn(file, 'slice')

    const metadata = await processMediaFile(file)

    expect(slice).not.toHaveBeenCalled()
    expect((await getVideo(metadata.id))!.blob.size).toBe(file.size)
  })

  it('a video/webm with no picture is stored as audio from the remuxed bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    media.script({
      video: {
        videoWidth: 0,
        videoHeight: 0,
        duration: Infinity,
        durationAfterSeek: 5,
        durationStaysUnknown: true,
        wedgeSeekAt: () => held === rawFile,
      },
    })
    scriptFirefoxAudio()
    rawFile = mediaFile([buildWebm({ cues: 'none' }) as BlobPart], 'voice.webm', 'video/webm')

    const result = await settle(processMediaFile(rawFile))

    expect(result).not.toBeInstanceOf(Error)
    const metadata = result as Awaited<ReturnType<typeof processMediaFile>>
    expect(metadata.mediaType).toBe('audio')
    const stored = await getVideo(metadata.id)
    expect(hasNonEmptyCues(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe(true)
    expect(stored!.blob.size).not.toBe(rawFile.size)
    expect(handedToElements).not.toContain(rawFile)
    expect(seekIndex.withSeekIndex).toHaveBeenCalledTimes(1)
  })
})
