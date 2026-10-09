import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import {
  exportProjectMetadata,
  extractMetadataFromBlob,
  importProjectMetadata,
  loadProject,
  saveProject,
  showOpenProjectDialog,
  MAX_PROJECT_FILE_BASE64_BYTES,
  ProjectTooLargeError,
  type ProjectFile,
} from './projectManager'
// The real storage layer, running on the fake-indexeddb installed by
// src/test/setup.ts — save/load really round-trips through IndexedDB here.
import { deleteVideo, getAllVideoMetadata, getThumbnail, getVideo, storeThumbnail, storeVideo } from './storage'
import type { Project, SourceVideo } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { lastObjectUrl } from '../test/objectUrls'
import { installFileReaderDouble } from '../test/doubles/fileReader'

// Pass-through spies so a test can see (and, for the budget cases, fake the
// size of) what saveProject asks storage for. Everything else is the real layer.
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>()
  return { ...actual, getVideo: vi.fn(actual.getVideo), getThumbnail: vi.fn(actual.getThumbnail) }
})

let idCounter = 0
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${idCounter++}`

const createTestProject = (videoId: string): Project => ({
  id: 'project1',
  name: 'Test Project',
  created: 1234567890000,
  modified: 1234567890000,
  resolution: { width: 1280, height: 720 },
  timeline: {
    tracks: [
      { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
    ],
    clips: [
      {
        id: 'clip1',
        sourceVideoId: videoId,
        name: 'Clip 1',
        startTime: 0,
        endTime: 5,
        duration: 5,
        trackId: 'track1',
        timelinePosition: 0,
        blendMode: 'normal',
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        effects: { blur: 0 },
        transition: { type: 'none', duration: 0.5 },
      },
    ],
    textOverlays: [],
    shapeOverlays: [],
    duration: 5,
  },
})

const sourceVideo = (id: string, name = 'test.mp4', mimeType = 'video/mp4'): SourceVideo => ({
  id,
  name,
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType,
  size: 1000000,
})

const base64Of = (bytes: number[]) => btoa(String.fromCharCode(...bytes))

/** The bytes the JSON writer produced, decoded back from base64. */
function decodeBase64(base64: string): number[] {
  const binary = atob(base64)
  const bytes: number[] = []
  for (let i = 0; i < binary.length; i++) bytes.push(binary.charCodeAt(i))
  return bytes
}

describe('exportProjectMetadata', () => {
  it('exports project as formatted JSON with the current version', () => {
    const result = exportProjectMetadata(createTestProject('video1'))
    const parsed = JSON.parse(result)

    expect(parsed.version).toBe(1)
    expect(parsed.project.id).toBe('project1')
    expect(parsed.project.name).toBe('Test Project')
    expect(parsed.exportedAt).toBeGreaterThan(0)
    // Formatted with two-space indentation
    expect(result).toContain('\n  "version": 1')
  })
})

describe('importProjectMetadata', () => {
  it('imports project metadata when all referenced videos exist', () => {
    const project = createTestProject('video1')
    const json = JSON.stringify({ version: 1, project })

    const result = importProjectMetadata(json, [sourceVideo('video1')])

    expect(result.id).toBe('project1')
    expect(result.timeline.clips).toHaveLength(1)
    expect(result.modified).toBeGreaterThan(project.modified)
  })

  it('throws naming how many clips are orphaned when videos are missing', () => {
    const json = JSON.stringify({ version: 1, project: createTestProject('video1') })
    expect(() => importProjectMetadata(json, [])).toThrow('Missing videos for 1 clip(s)')
  })

  it('accepts an overlay-only project whose clips carry no source video id', () => {
    const project = createTestProject('video1')
    project.timeline.clips[0].sourceVideoId = ''
    project.timeline.clips[0].overlayType = 'text'
    const json = JSON.stringify({ version: 1, project })

    // An empty sourceVideoId must still be satisfiable — by a source with that id.
    const result = importProjectMetadata(json, [sourceVideo('')])
    expect(result.timeline.clips[0].overlayType).toBe('text')
  })
})

describe('saveProject size budget (ESCSUITE-241)', () => {
  const MiB = 1024 * 1024
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let fileReader: ReturnType<typeof installFileReaderDouble>
  let readSpy: Mock<() => void>

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
    fileReader = installFileReaderDouble()
    // Count byte reads: the budget must be decided before any is made.
    const Installed = (globalThis as unknown as { FileReader: new () => { readAsDataURL(b: Blob): void } }).FileReader
    readSpy = vi.fn<() => void>()
    const original = Installed.prototype.readAsDataURL
    Installed.prototype.readAsDataURL = function (this: unknown, b: Blob) {
      readSpy()
      return original.call(this, b)
    }
    vi.mocked(getVideo).mockClear()
  })

  afterEach(() => {
    fileReader.uninstall()
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
  })

  /** A Blob that reports a size without holding the bytes. */
  const fakeBlob = (size: number) => {
    const blob = new Blob([])
    Object.defineProperty(blob, 'size', { value: size })
    return blob
  }
  const fakeStored = (id: string, size: number) => {
    vi.mocked(getVideo).mockImplementationOnce(async () => ({ blob: fakeBlob(size), metadata: sourceVideo(id) }))
  }
  const projectUsing = (ids: string[]): Project => {
    const project = createTestProject(ids[0])
    project.timeline.clips = ids.map((id, i) => ({ ...project.timeline.clips[0], id: `clip${i}`, sourceVideoId: id }))
    return project
  }

  it('the budget is 256 MiB of base64', () => {
    expect(MAX_PROJECT_FILE_BASE64_BYTES).toBe(256 * MiB)
  })

  it('writes the file as before when the sources are under the budget', async () => {
    const id = uniqueId('small')
    await storeVideo(id, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), sourceVideo(id))
    await saveProject(createTestProject(id), [sourceVideo(id)])
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  // onProgress(0, 'Preparing project data...') precedes the budget check by
  // design; no export step does.
  it('refuses one source over the budget, naming the totals and the largest source, before reading anything', async () => {
    const id = uniqueId('big')
    fakeStored(id, 200 * MiB) // 4 x ceil(200 MiB / 3) is about 267 MiB of base64
    const onProgress = vi.fn()
    const error = await saveProject(projectUsing([id]), [sourceVideo(id, 'Recording 3')], onProgress).catch((e) => e)

    expect(error).toBeInstanceOf(ProjectTooLargeError)
    expect(error.name).toBe('ProjectTooLargeError')
    expect(error.limit).toBe(MAX_PROJECT_FILE_BASE64_BYTES)
    expect(error.total).toBe(4 * Math.ceil((200 * MiB) / 3))
    expect(error.message).toContain('This project is too large to save as a .veditor file')
    expect(error.message).toContain('the format holds about 192 MiB')
    expect(error.message).toContain('its sources add up to 200 MiB')
    expect(error.message).toContain('Recording 3, 200 MiB')
    expect(readSpy).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalledWith(expect.any(Number), expect.stringContaining('Exporting'))
    expect(clickSpy).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('a source exactly at the budget is not refused, and one byte over is', async () => {
    const at = uniqueId('edge')
    // 4 x ceil(n / 3) = 256 MiB  =>  n = 192 MiB
    fakeStored(at, 192 * MiB)
    vi.mocked(getThumbnail).mockImplementationOnce(async () => undefined)
    const progress: string[] = []
    // The fake blob then fails the short-read check: what matters is that the
    // export loop was entered, which is the only place 'Exporting' is reported.
    const result = await saveProject(projectUsing([at]), [sourceVideo(at)], (_p, m) => progress.push(m)).catch((e) => e)
    expect(result).not.toBeInstanceOf(ProjectTooLargeError)
    expect(progress).toContain('Exporting video 1/1...')

    const over = uniqueId('over')
    fakeStored(over, 192 * MiB + 1) // 4 x ceil((192 MiB + 1) / 3) is 4 bytes more
    vi.mocked(getThumbnail).mockImplementationOnce(async () => undefined)
    const refused = await saveProject(projectUsing([over]), [sourceVideo(over)]).catch((e) => e)
    expect(refused).toBeInstanceOf(ProjectTooLargeError)
    expect(refused.total).toBeGreaterThan(MAX_PROJECT_FILE_BASE64_BYTES)
  })

  it('counts every source together, not each on its own', async () => {
    const a = uniqueId('a')
    const b = uniqueId('b')
    fakeStored(a, 120 * MiB)
    fakeStored(b, 100 * MiB)
    const error = await saveProject(projectUsing([a, b]), [sourceVideo(a, 'First'), sourceVideo(b, 'Second')]).catch((e) => e)

    expect(error).toBeInstanceOf(ProjectTooLargeError)
    expect(error.total).toBe(4 * Math.ceil((120 * MiB) / 3) + 4 * Math.ceil((100 * MiB) / 3))
    expect(error.message).toContain('First, 120 MiB')
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('counts the thumbnail in the total', async () => {
    const id = uniqueId('thumb')
    fakeStored(id, 190 * MiB) // under on its own
    vi.mocked(getThumbnail).mockImplementationOnce(async () => fakeBlob(10 * MiB))
    const error = await saveProject(projectUsing([id]), [sourceVideo(id)]).catch((e) => e)

    expect(error).toBeInstanceOf(ProjectTooLargeError)
    expect(error.total).toBe(4 * Math.ceil((190 * MiB) / 3) + 4 * Math.ceil((10 * MiB) / 3))
  })

  describe('a short read from the browser', () => {
    const useReader = (result: string | null) => {
      class Reader {
        result = result
        onloadend: (() => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          queueMicrotask(() => this.onloadend?.())
        }
      }
      ;(globalThis as unknown as { FileReader: unknown }).FileReader = Reader
    }
    const store10 = async () => {
      const id = uniqueId('short')
      await storeVideo(id, new Blob([new Uint8Array(10)], { type: 'video/mp4' }), sourceVideo(id))
      return id
    }

    it('rejects an empty result instead of writing a file with no video', async () => {
      const id = await store10()
      useReader('')
      await expect(saveProject(createTestProject(id), [sourceVideo(id)])).rejects.toThrow(/10 bytes/)
      expect(clickSpy).not.toHaveBeenCalled()
    })

    it('rejects a null result, which browsers report after an error', async () => {
      const id = await store10()
      useReader(null)
      await expect(saveProject(createTestProject(id), [sourceVideo(id)])).rejects.toThrow(/10 bytes/)
    })

    it('rejects a result with no base64 part', async () => {
      const id = await store10()
      useReader('data:video/mp4;base64,')
      await expect(saveProject(createTestProject(id), [sourceVideo(id)])).rejects.toThrow(/10 bytes/)
    })

    it('rejects a truncated result', async () => {
      const id = await store10()
      useReader('data:video/mp4;base64,AAAA') // 4 < 4 x floor(10 / 3) = 12
      await expect(saveProject(createTestProject(id), [sourceVideo(id)])).rejects.toThrow(/10 bytes/)
    })

    it('rejects an empty result for a blob too small to need any full base64 group', async () => {
      const id = uniqueId('tiny')
      await storeVideo(id, new Blob([new Uint8Array(2)], { type: 'video/mp4' }), sourceVideo(id))
      useReader('data:video/mp4;base64,')
      await expect(saveProject(createTestProject(id), [sourceVideo(id)])).rejects.toThrow(/2 bytes/)
    })

    it('accepts an empty result for an empty blob', async () => {
      const id = uniqueId('empty')
      await storeVideo(id, new Blob([], { type: 'video/mp4' }), sourceVideo(id))
      useReader('data:video/mp4;base64,')
      await saveProject(createTestProject(id), [sourceVideo(id)])
      expect(clickSpy).toHaveBeenCalledTimes(1)
    })

    it('accepts a complete result', async () => {
      const id = await store10()
      useReader('data:video/mp4;base64,' + 'A'.repeat(16))
      await saveProject(createTestProject(id), [sourceVideo(id)])
      expect(clickSpy).toHaveBeenCalledTimes(1)
    })
  })
})

describe('saveProject', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let fileReader: ReturnType<typeof installFileReaderDouble>

  beforeEach(() => {
    // jsdom would try to navigate on a real anchor click; the click itself is
    // what we assert on, so intercept it and read the anchor it was made on.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
    fileReader = installFileReaderDouble()
  })

  afterEach(() => {
    fileReader.uninstall()
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
  })

  /** The .veditor payload handed to URL.createObjectURL for download. */
  async function capturedProjectFile(): Promise<ProjectFile> {
    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    expect(blob.type).toBe('application/json')
    return JSON.parse(await blob.text()) as ProjectFile
  }

  it('embeds the stored video bytes and thumbnail, and triggers a download', async () => {
    const videoId = uniqueId('vid')
    const bytes = [0, 1, 2, 255, 254, 253]
    await storeVideo(videoId, new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), sourceVideo(videoId))
    await storeThumbnail(videoId, new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }))

    const project = createTestProject(videoId)
    const progress: Array<[number, string]> = []
    await saveProject(project, [sourceVideo(videoId)], (p, m) => progress.push([p, m]))

    const saved = await capturedProjectFile()
    expect(saved.version).toBe(1)
    expect(saved.project.id).toBe('project1')
    expect(saved.videos).toHaveLength(1)
    expect(saved.videos[0].id).toBe(videoId)
    expect(saved.videos[0].mimeType).toBe('video/mp4')
    // Binary data survives the base64 round trip byte for byte.
    expect(decodeBase64(saved.videos[0].data)).toEqual(bytes)
    expect(decodeBase64(saved.videos[0].thumbnail!)).toEqual([9, 8, 7])

    expect(progress[0]).toEqual([0, 'Preparing project data...'])
    expect(progress).toContainEqual([80, 'Exporting video 1/1...'])
    expect(progress).toContainEqual([90, 'Creating project file...'])
    expect(progress[progress.length - 1]).toEqual([100, 'Project saved!'])

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('Test Project.veditor')
    expect(anchor.href).toContain(lastObjectUrl())
    // The anchor is removed again once clicked.
    expect(document.body.contains(anchor)).toBe(false)
  })

  it('omits the thumbnail field when none is stored', async () => {
    const videoId = uniqueId('vid')
    await storeVideo(videoId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(videoId))

    await saveProject(createTestProject(videoId), [sourceVideo(videoId)])

    const saved = await capturedProjectFile()
    expect(saved.videos[0].thumbnail).toBeUndefined()
  })

  it('exports only the videos the timeline actually uses', async () => {
    const usedId = uniqueId('used')
    const unusedId = uniqueId('unused')
    await storeVideo(usedId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(usedId))
    await storeVideo(unusedId, new Blob([new Uint8Array([2])], { type: 'video/mp4' }), sourceVideo(unusedId))

    await saveProject(createTestProject(usedId), [sourceVideo(usedId), sourceVideo(unusedId)])

    const saved = await capturedProjectFile()
    expect(saved.videos.map((v) => v.id)).toEqual([usedId])
  })

  it('skips a referenced video whose blob is no longer in storage', async () => {
    const missingId = uniqueId('gone')
    await saveProject(createTestProject(missingId), [sourceVideo(missingId)])

    const saved = await capturedProjectFile()
    expect(saved.videos).toEqual([])
    // The project itself is still written out.
    expect(saved.project.timeline.clips).toHaveLength(1)
  })

  it('names the file "project.veditor" when the project has no name', async () => {
    const project = createTestProject(uniqueId('vid'))
    project.name = ''
    await saveProject(project, [])
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('project.veditor')
  })

  it('writes a clip crop into the .veditor (ESCSUITE-6)', async () => {
    const videoId = uniqueId('crop-save')
    await storeVideo(videoId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(videoId))
    const project = createTestProject(videoId)
    project.timeline.clips[0].crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }

    await saveProject(project, [sourceVideo(videoId)])

    const written = await capturedProjectFile()
    expect(written.project.timeline.clips[0].crop).toEqual({
      left: 0.25,
      top: 0.1,
      right: 0,
      bottom: 0,
    })
  })
})

describe('loadProject', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles({ video: { duration: 42, videoWidth: 1280, videoHeight: 720 } })
  })

  afterEach(() => {
    media.uninstall()
  })

  function veditorFile(file: Partial<ProjectFile>, videoId: string): File {
    const content: ProjectFile = {
      version: 1,
      project: createTestProject(videoId),
      videos: [],
      ...file,
    }
    return new File([JSON.stringify(content)], 'test.veditor', { type: 'application/json' })
  }

  it('restores the videos into IndexedDB and returns their extracted metadata', async () => {
    const videoId = uniqueId('load')
    const file = veditorFile(
      {
        videos: [
          { id: videoId, name: 'restored.mp4', mimeType: 'video/mp4', data: base64Of([0, 1, 255]) },
        ],
      },
      videoId
    )

    const progress: Array<[number, string]> = []
    const { project, sourceVideos } = await loadProject(file, (p, m) => progress.push([p, m]))

    expect(project.id).toBe('project1')
    expect(project.modified).toBeGreaterThan(1234567890000)

    expect(sourceVideos).toHaveLength(1)
    expect(sourceVideos[0]).toMatchObject({
      id: videoId,
      name: 'restored.mp4',
      duration: 42,
      width: 1280,
      height: 720,
      frameRate: 30,
      mimeType: 'video/mp4',
    })
    expect(sourceVideos[0].thumbnailUrl).toBeUndefined()

    // Really stored: readable back out of IndexedDB.
    const stored = await getVideo(videoId)
    expect(stored?.metadata.name).toBe('restored.mp4')
    expect(Array.from(new Uint8Array(await stored!.blob.arrayBuffer()))).toEqual([0, 1, 255])

    expect(progress[0]).toEqual([0, 'Reading project file...'])
    expect(progress).toContainEqual([10, 'Restoring videos...'])
    expect(progress).toContainEqual([90, 'Restoring video 1/1...'])
    expect(progress).toContainEqual([95, 'Finalizing...'])
    expect(progress[progress.length - 1]).toEqual([100, 'Project loaded!'])
  })

  it('restores a thumbnail and exposes it as an object URL', async () => {
    const videoId = uniqueId('thumb')
    const file = veditorFile(
      {
        videos: [
          {
            id: videoId,
            name: 'with-thumb.mp4',
            mimeType: 'video/mp4',
            data: btoa('abc'),
            thumbnail: btoa('thumbnail-bytes'),
          },
        ],
      },
      videoId
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0].thumbnailUrl).toBe(lastObjectUrl())
    const thumb = await getThumbnail(videoId)
    expect(thumb).toBeDefined()
    expect(await thumb!.text()).toBe('thumbnail-bytes')
    expect(thumb!.type).toBe('image/jpeg')
  })

  it('refuses a project file written by a newer version', async () => {
    const file = veditorFile({ version: 2 }, 'unused')
    await expect(loadProject(file)).rejects.toThrow(
      'Project file version 2 is newer than supported version 1'
    )
  })

  it('loads a project that embeds no videos at all', async () => {
    const { sourceVideos } = await loadProject(veditorFile({ videos: [] }, 'none'))
    expect(sourceVideos).toEqual([])
  })

  it('resurrects bytes but not CRAFT take identity for a source CRAFT no longer has (ESCSUITE-151)', async () => {
    const videoId = uniqueId('deleted-take')
    const take: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: videoId,
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), take)
    // CRAFT deleted the take: the row is gone from the shared DB entirely.
    await deleteVideo(videoId)

    const file = veditorFile(
      {
        videos: [
          {
            id: videoId,
            name: take.name,
            mimeType: take.mimeType,
            data: base64Of([1, 2, 3]),
            meta: {
              duration: take.duration,
              width: take.width,
              height: take.height,
              frameRate: take.frameRate,
              mediaType: take.mediaType,
              source: take.source,
              takeId: take.takeId,
              role: take.role,
              startOffset: take.startOffset,
              overlayPlacement: take.overlayPlacement,
              hasWebcam: take.hasWebcam,
            },
          },
        ],
      },
      videoId
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0].source).toBeUndefined()
    expect(sourceVideos[0].takeId).toBeUndefined()
    expect(sourceVideos[0].role).toBeUndefined()
    expect(sourceVideos[0].startOffset).toBeUndefined()
    expect(sourceVideos[0].overlayPlacement).toBeUndefined()
    // The bytes and the rest of the recording's metadata are still restored.
    expect(sourceVideos[0].duration).toBe(12)
    expect(sourceVideos[0].hasWebcam).toBe(true)

    const all = await getAllVideoMetadata()
    const restored = all.find((v) => v.id === videoId)
    expect(restored).toBeDefined()
    expect(restored!.source).toBeUndefined()
    expect(restored!.takeId).toBeUndefined()

    // ESCAPECRAFT's own library filter (apps/craft/src/core/storage.ts),
    // replicated inline: the resurrected copy must not pass it. (Other tests
    // in this file share the same fake-indexeddb instance and may leave their
    // own `source: 'recording'` rows behind, so this checks the one id rather
    // than asserting the whole filtered list is empty.)
    expect(
      all.filter((v) => v.source === 'recording').some((v) => v.id === videoId)
    ).toBe(false)

    // Self-contained: this test's own row does not linger for later tests in
    // this file (which all share one fake-indexeddb instance) to trip over.
    await deleteVideo(videoId)
  })

  it("keeps a present source's own CRAFT identity but still restores everything else from the file (ESCSUITE-151)", async () => {
    const videoId = uniqueId('already-present')
    const stored: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: videoId,
      role: 'screen',
      startOffset: 0,
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)

    // A .veditor referencing the same id, carrying its own newer meta — as if
    // it were re-saved after the waveform was recomputed.
    const file = veditorFile(
      {
        videos: [
          {
            id: videoId,
            name: 'take.webm',
            mimeType: 'video/webm',
            data: base64Of([1, 2, 3]),
            meta: {
              duration: 20,
              width: 640,
              height: 480,
              frameRate: 30,
              waveformData: [{ min: -1, max: 1 }],
            },
          },
        ],
      },
      videoId
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0]).toMatchObject({
      // The file's own meta wins for everything CRAFT doesn't own.
      duration: 20,
      width: 640,
      height: 480,
      frameRate: 30,
      waveformData: [{ min: -1, max: 1 }],
      // But CRAFT's take identity stays the stored record's, not the file's.
      source: 'recording',
      takeId: videoId,
      role: 'screen',
      startOffset: 0,
    })

    // Nothing is written back to the DB for an id already present.
    const dbMetadata = (await getVideo(videoId))!.metadata
    expect(dbMetadata).toEqual(stored)

    // Self-contained: this test's own row does not linger for later tests in
    // this file (which all share one fake-indexeddb instance) to trip over.
    await deleteVideo(videoId)
  })

  it('reads a clip crop back out of a .veditor (ESCSUITE-6)', async () => {
    const videoId = uniqueId('crop-load')
    const crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }
    const project = createTestProject(videoId)
    project.timeline.clips[0].crop = crop

    const { project: loaded } = await loadProject(veditorFile({ project }, videoId))

    expect(loaded.timeline.clips[0].crop).toEqual(crop)
  })
})

describe('project file metadata round trip (ESCSUITE-97)', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let fileReader: ReturnType<typeof installFileReaderDouble>
  let media: MediaDoubles

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
    fileReader = installFileReaderDouble()
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    fileReader.uninstall()
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
    media.uninstall()
  })

  /** The .veditor payload handed to URL.createObjectURL for download. */
  async function capturedProjectFile(): Promise<ProjectFile> {
    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    return JSON.parse(await blob.text()) as ProjectFile
  }

  it('carries waveformData, take identity and the flags TimelineTrack reads through a save, and resolves a headerless take instead of reintroducing Infinity', async () => {
    const videoId = uniqueId('take')
    const take: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24, // not the extractMetadataFromBlob default of 30
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), take)

    await saveProject(createTestProject(videoId), [take])
    const saved = await capturedProjectFile()

    expect(saved.videos[0].meta).toEqual({
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: take.waveformData,
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: take.overlayPlacement,
      hasWebcam: true,
    })

    // The blob probe would report Infinity if the load path fell back to it —
    // scripted here so the assertion below is proof the restored values came
    // from the file's own meta (the real `resolveStoredDuration`/
    // `resolveMetaDimensions` path, run the same way whether or not this id
    // is already in the DB — ESCSUITE-151 round 1 tried reusing the stored
    // record wholesale instead, which would have made this pass by
    // coincidence rather than by actually reading `meta`), not a coincidence
    // of a probe that happened to work.
    media.script({ video: { duration: Infinity, durationAfterSeek: 12, durationStaysUnknown: true } })

    const reopened = new File([JSON.stringify(saved)], 'take.veditor', { type: 'application/json' })
    const { sourceVideos } = await loadProject(reopened)

    expect(sourceVideos).toHaveLength(1)
    expect(sourceVideos[0]).toEqual(take)
    expect(media.videos).toHaveLength(0) // never probed the blob
  })

  it('clears CRAFT take identity but still restores everything else from meta when the source is no longer in the shared DB (ESCSUITE-151)', async () => {
    const videoId = uniqueId('deleted-take')
    const take: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24, // not the extractMetadataFromBlob default of 30
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), take)

    await saveProject(createTestProject(videoId), [take])
    const saved = await capturedProjectFile()

    // CRAFT deleted the take after the project was saved: the row is gone
    // from the shared DB entirely, so this load genuinely resurrects it.
    await deleteVideo(videoId)

    // The blob probe would report Infinity if the load path fell back to it —
    // scripted here so the assertion below is proof meta's duration/width/
    // height were still usable and trusted, exactly as they would be for any
    // other import.
    media.script({ video: { duration: Infinity, durationAfterSeek: 12, durationStaysUnknown: true } })

    const reopened = new File([JSON.stringify(saved)], 'take.veditor', { type: 'application/json' })
    const { sourceVideos } = await loadProject(reopened)

    expect(sourceVideos).toHaveLength(1)
    expect(sourceVideos[0]).toEqual({
      ...take,
      source: undefined,
      takeId: undefined,
      role: undefined,
      startOffset: undefined,
      overlayPlacement: undefined,
    })
    expect(media.videos).toHaveLength(0) // never probed the blob

    // Self-contained: this test's own row does not linger for later tests in
    // this file (which all share one fake-indexeddb instance) to trip over.
    await deleteVideo(videoId)
  })

  it('still loads an old-format file with no meta, resolving a headerless take through the shared probe instead of Infinity', async () => {
    media.script({ video: { duration: Infinity, durationAfterSeek: 9, durationStaysUnknown: true } })

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject('legacy'),
          videos: [
            { id: 'legacy', name: 'legacy.webm', mimeType: 'video/webm', data: base64Of([1, 2, 3]) },
          ],
        } satisfies ProjectFile),
      ],
      'legacy.veditor',
      { type: 'application/json' }
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0].duration).toBe(9)
    expect(Number.isFinite(sourceVideos[0].duration)).toBe(true)
    expect(sourceVideos[0].frameRate).toBe(30) // the hard-coded fallback, unchanged for an old file
  })

  it('trusts a present row\'s own stored metadata for a meta-less file instead of re-probing the blob (ESCSUITE-151 round 2)', async () => {
    const videoId = uniqueId('present-no-meta')
    const stored: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)

    // If the load path fell back to extractMetadataFromBlob, this is what it
    // would report — obviously different from what's stored, so the
    // assertions below can only pass if the probe never ran.
    media.script({ video: { duration: 999, videoWidth: 1, videoHeight: 1 } })

    // An old-format entry for the same id: bytes, but no `meta` at all.
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject(videoId),
          videos: [
            { id: videoId, name: 'take.webm', mimeType: 'video/webm', data: base64Of([1, 2, 3]) },
          ],
        } satisfies ProjectFile),
      ],
      'legacy.veditor',
      { type: 'application/json' }
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0]).toEqual(stored)
    expect(media.videos).toHaveLength(0) // extractMetadataFromBlob never ran

    await deleteVideo(videoId)
  })

  it('recovers a present row\'s own non-finite stored duration from the blob for a meta-less file (ESCSUITE-151 round 3)', async () => {
    const videoId = uniqueId('present-no-meta-bad-duration')
    const stored: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: Infinity, // pre-ESCSUITE-97 row: never went through the duration probe
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)

    // The same headerless-WebM discovery every other importer uses: a seek
    // past the end reveals the real length.
    media.script({ video: { duration: Infinity, durationAfterSeek: 9, durationStaysUnknown: true } })

    // A meta-less entry for the same id.
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject(videoId),
          videos: [
            { id: videoId, name: 'take.webm', mimeType: 'video/webm', data: base64Of([1, 2, 3]) },
          ],
        } satisfies ProjectFile),
      ],
      'legacy.veditor',
      { type: 'application/json' }
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0]).toEqual({ ...stored, duration: 9 })
    expect(Number.isFinite(sourceVideos[0].duration)).toBe(true)
    // Everything a blob probe could never recover is still the stored value.
    expect(sourceVideos[0].waveformData).toEqual(stored.waveformData)
    expect(sourceVideos[0].hasAudio).toBe(true)
    expect(sourceVideos[0].recordedAt).toBe(1700000000000)

    await deleteVideo(videoId)
  })

  it("recovers a present row's own unusable stored dimensions from the blob for a meta-less file (ESCSUITE-151 round 3)", async () => {
    const videoId = uniqueId('present-no-meta-bad-dims')
    const stored: SourceVideo = {
      id: videoId,
      name: 'take.webm',
      duration: 12,
      width: -1, // corrupt/placeholder — not the audio-only "0 is fine" case
      height: -1,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1700000000000,
      waveformData: [{ min: -0.5, max: 0.5 }],
      hasAudio: true,
      takeId: 'take-primary-id',
      role: 'screen',
      startOffset: 0,
      hasWebcam: true,
    }
    await storeVideo(videoId, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)

    media.script({ video: { duration: 12, videoWidth: 640, videoHeight: 480 } })

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject(videoId),
          videos: [
            { id: videoId, name: 'take.webm', mimeType: 'video/webm', data: base64Of([1, 2, 3]) },
          ],
        } satisfies ProjectFile),
      ],
      'legacy.veditor',
      { type: 'application/json' }
    )

    const { sourceVideos } = await loadProject(file)

    expect(sourceVideos[0]).toEqual({ ...stored, width: 640, height: 480 })
    // Everything a blob probe could never recover is still the stored value.
    expect(sourceVideos[0].waveformData).toEqual(stored.waveformData)
    expect(sourceVideos[0].hasAudio).toBe(true)

    await deleteVideo(videoId)
  })

  /** A .veditor file whose `meta` is built by hand rather than by saveProject. */
  function veditorFileWithMeta(videoId: string, meta: Record<string, unknown>, thumbnail?: string): File {
    return new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject(videoId),
          videos: [
            {
              id: videoId,
              name: 'corrupt.webm',
              mimeType: 'video/webm',
              data: base64Of([1, 2, 3]),
              ...(thumbnail !== undefined ? { thumbnail } : {}),
              meta,
            },
          ],
        }),
      ],
      'corrupt.veditor',
      { type: 'application/json' }
    )
  }

  it("recovers a saved take's duration from the blob when meta.duration is not a usable number (review round 1)", async () => {
    media.script({ video: { duration: Infinity, durationAfterSeek: 9, durationStaysUnknown: true } })
    const videoId = uniqueId('corrupt-duration')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(videoId, { duration: null, width: 1280, height: 720, frameRate: 24 })
    )

    expect(sourceVideos[0].duration).toBe(9)
    expect(sourceVideos[0].frameRate).toBe(24) // the rest of meta is still trusted
    expect(media.videos).toHaveLength(1) // this time the blob really was probed
  })

  it('trusts a usable meta.duration outright and never probes the blob for it', async () => {
    const videoId = uniqueId('usable-duration')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(videoId, { duration: 9, width: 1280, height: 720, frameRate: 24 })
    )

    expect(sourceVideos[0].duration).toBe(9)
    expect(media.videos).toHaveLength(0)
  })

  it("recovers a saved take's width/height from the blob when meta's values are not usable numbers (review round 1)", async () => {
    media.script({ video: { duration: 9, videoWidth: 640, videoHeight: 480 } })
    const videoId = uniqueId('corrupt-dims')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(videoId, { duration: 9, width: -1, height: null, frameRate: 24 })
    )

    expect(sourceVideos[0].width).toBe(640)
    expect(sourceVideos[0].height).toBe(480)
  })

  it("keeps meta's zero width/height for an audio-only take instead of treating them as unusable", async () => {
    const videoId = uniqueId('audio-dims')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(videoId, { duration: 9, width: 0, height: 0, frameRate: 0, mediaType: 'audio' })
    )

    expect(sourceVideos[0].width).toBe(0)
    expect(sourceVideos[0].height).toBe(0)
    expect(media.videos).toHaveLength(0)
    expect(media.audios).toHaveLength(0)
  })

  it('never lets a thumbnailUrl smuggled into meta reach the stored record or the returned source video (review round 1)', async () => {
    const videoId = uniqueId('spoofed-thumb')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(
        videoId,
        { duration: 9, width: 1280, height: 720, frameRate: 24, thumbnailUrl: 'blob:stale' },
        btoa('real-thumbnail-bytes')
      )
    )

    // The real, stored thumbnail resolves to the mocked object URL — not the
    // value smuggled into meta.
    expect(sourceVideos[0].thumbnailUrl).toBe(lastObjectUrl())

    const stored = await getVideo(videoId)
    expect(stored?.metadata.thumbnailUrl).not.toBe('blob:stale')
  })

  it('leaves thumbnailUrl unset when meta smuggles one in but the file has no real thumbnail to resolve', async () => {
    const videoId = uniqueId('spoofed-thumb-only')

    const { sourceVideos } = await loadProject(
      veditorFileWithMeta(videoId, {
        duration: 9,
        width: 1280,
        height: 720,
        frameRate: 24,
        thumbnailUrl: 'blob:stale',
      })
    )

    expect(sourceVideos[0].thumbnailUrl).toBeUndefined()

    const stored = await getVideo(videoId)
    expect(stored?.metadata.thumbnailUrl).toBeUndefined()
  })
})

describe('extractMetadataFromBlob', () => {
  let media: MediaDoubles

  beforeEach(() => {
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    media.uninstall()
  })

  it('reads an image blob as a 5-second still at its natural size', async () => {
    media.script({ image: { naturalWidth: 640, naturalHeight: 480 } })
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })

    const metadata = await extractMetadataFromBlob(blob, { id: 'i1', name: 'pic.png', mimeType: 'image/png' })

    expect(metadata).toEqual({
      id: 'i1',
      name: 'pic.png',
      duration: 5,
      width: 640,
      height: 480,
      frameRate: 1,
      mimeType: 'image/png',
      size: 4,
      mediaType: 'image',
    })
  })

  it('rejects when an image blob cannot be decoded', async () => {
    media.script({ image: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await expect(
      extractMetadataFromBlob(new Blob(['x'], { type: 'image/png' }), { id: 'i', name: 'bad.png', mimeType: 'image/png' })
    ).rejects.toThrow('Failed to load image: bad.png')
    expect(revoke).toHaveBeenCalledWith(lastObjectUrl())
    revoke.mockRestore()
  })

  it('reads an audio blob as a zero-dimension audio source', async () => {
    media.script({ audio: { duration: 12.5 } })
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/mpeg' })

    const metadata = await extractMetadataFromBlob(blob, { id: 'a1', name: 'song.mp3', mimeType: 'audio/mpeg' })

    expect(metadata).toEqual({
      id: 'a1',
      name: 'song.mp3',
      duration: 12.5,
      width: 0,
      height: 0,
      frameRate: 0,
      mimeType: 'audio/mpeg',
      size: 2,
      mediaType: 'audio',
    })
  })

  it('rejects when an audio blob cannot be decoded', async () => {
    media.script({ audio: { fail: true } })
    await expect(
      extractMetadataFromBlob(new Blob(['x'], { type: 'audio/mpeg' }), { id: 'a', name: 'bad.mp3', mimeType: 'audio/mpeg' })
    ).rejects.toThrow('Failed to load audio: bad.mp3')
  })

  it('treats anything else as video, at 30fps', async () => {
    media.script({ video: { duration: 8.25, videoWidth: 1920, videoHeight: 1080 } })
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' })

    const metadata = await extractMetadataFromBlob(blob, { id: 'v1', name: 'clip.webm', mimeType: 'video/webm' })

    expect(metadata).toEqual({
      id: 'v1',
      name: 'clip.webm',
      duration: 8.25,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/webm',
      size: 3,
    })
  })

  it('rejects when a video blob cannot be decoded', async () => {
    media.script({ video: { fail: true } })
    await expect(
      extractMetadataFromBlob(new Blob(['x'], { type: 'video/mp4' }), { id: 'v', name: 'bad.mp4', mimeType: 'video/mp4' })
    ).rejects.toThrow('Failed to load video: bad.mp4')
  })
})

describe('showOpenProjectDialog', () => {
  const win = window as unknown as Record<string, unknown>

  afterEach(() => {
    delete win.showOpenFilePicker
    vi.restoreAllMocks()
  })

  /**
   * The dialog creates a hidden <input type="file"> and calls click(); a real
   * browser then fires change or cancel. Stand in for the user by driving the
   * event off the click, and check the input the code configured.
   */
  function interceptFileInput(file: File | null, outcome: 'change' | 'cancel' = 'change') {
    let clicked = false
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      clicked = true
      expect(this.type).toBe('file')
      expect(this.accept).toBe('.veditor,application/json')
      if (outcome === 'cancel') {
        ;(this as unknown as { oncancel: () => void }).oncancel()
        return
      }
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: file ? { 0: file, length: 1, item: () => file } : { length: 0, item: () => null },
      })
      this.onchange?.(new Event('change'))
    })
    return () => clicked
  }

  it('uses the File System Access API when available', async () => {
    const file = new File(['{}'], 'picked.veditor')
    const getFile = vi.fn().mockResolvedValue(file)
    const picker = vi.fn().mockResolvedValue([{ getFile }])
    win.showOpenFilePicker = picker

    await expect(showOpenProjectDialog()).resolves.toBe(file)
    expect(picker).toHaveBeenCalledWith({
      types: [{ description: 'Video Editor Project', accept: { 'application/json': ['.veditor'] } }],
    })
  })

  it('falls back silently to the input element when the user cancels the picker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    win.showOpenFilePicker = vi.fn().mockRejectedValue(abort)

    const clicked = interceptFileInput(null)
    await expect(showOpenProjectDialog()).resolves.toBeNull()
    expect(clicked()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and falls back when the picker fails for any other reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    win.showOpenFilePicker = vi.fn().mockRejectedValue(new Error('boom'))

    const file = new File(['{}'], 'fallback.veditor')
    interceptFileInput(file)
    await expect(showOpenProjectDialog()).resolves.toBe(file)
    expect(warn).toHaveBeenCalledWith('File picker failed, falling back to input element')
  })

  it('resolves with the chosen file from the input element', async () => {
    const file = new File(['{}'], 'chosen.veditor')
    interceptFileInput(file)
    await expect(showOpenProjectDialog()).resolves.toBe(file)
  })

  it('resolves with null when the input element is cancelled', async () => {
    interceptFileInput(null, 'cancel')
    await expect(showOpenProjectDialog()).resolves.toBeNull()
  })
})
