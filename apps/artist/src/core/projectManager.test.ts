import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import {
  exportProjectMetadata,
  extractMetadataFromBlob,
  importProjectMetadata,
  loadProject,
  saveProject,
  showOpenProjectDialog,
  type ProjectFile,
  type SourceVideoMeta,
} from './projectManager'
import {
  HEADER_BYTES,
  MAX_INDEX_BYTES,
  ProjectFileError,
  encodeProjectFile,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
} from './projectFileFormat'
// The real storage layer, running on the fake-indexeddb installed by
// src/test/setup.ts — save/load really round-trips through IndexedDB here.
import { parseProject } from '../store/projectMigration'
import {
  deleteVideo,
  getAllVideoMetadata,
  getStorageEstimate,
  getThumbnail,
  getVideo,
  storeThumbnail,
  storeVideo,
} from './storage'
import type { EditorBlock, Project, SourceVideo } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { OBJECT_URL_PATTERN, lastObjectUrl } from '../test/objectUrls'

// Pass-through spies, so a test can see (and, for the 2 GiB and quota cases,
// fake) what save and load ask storage for. Everything else is the real layer.
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>()
  return {
    ...actual,
    getVideo: vi.fn(actual.getVideo),
    getThumbnail: vi.fn(actual.getThumbnail),
    storeVideo: vi.fn(actual.storeVideo),
    storeThumbnail: vi.fn(actual.storeThumbnail),
    deleteVideo: vi.fn(actual.deleteVideo),
    getStorageEstimate: vi.fn(actual.getStorageEstimate),
  }
})

// The real functions behind the spies, for a test that lets one call through
// and fails the next.
const actualStorage = await vi.importActual<typeof import('./storage')>('./storage')

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

const MiB = 1024 * 1024
const GiB = 1024 * MiB

/** A Blob that reports `size` and refuses every way of reading it. */
function untouchable(size: number, type: string): Blob {
  const blob = new Blob([], { type })
  Object.defineProperty(blob, 'size', { value: size })
  for (const read of ['arrayBuffer', 'text', 'stream', 'slice', 'bytes']) {
    Object.defineProperty(blob, read, {
      value: () => {
        throw new Error(`${read}() read a source`)
      },
    })
  }
  return blob
}

/**
 * A File the loader can slice, built from the writer's parts. Node's File:
 * src/test/setup.ts makes Node's Blob the global one, and jsdom's File would
 * turn a Node Blob part into the text "[object Blob]".
 */
const fileOf = (parts: BlobPart[], name = 'project.veditor'): File =>
  new NodeFile(parts as ConstructorParameters<typeof NodeFile>[0], name) as unknown as File

interface V2Source {
  id: string
  name?: string
  mimeType?: string
  meta?: SourceVideoMeta
  bytes: number[]
  thumbnail?: { bytes: number[]; type: string }
}

/** A v2 `.veditor` written by the real writer over real bytes. */
function v2File(project: Project, sources: V2Source[], editor?: EditorBlock): File {
  return fileOf(
    encodeProjectFile(
      project,
      editor,
      sources.map((source) => {
        const mimeType = source.mimeType ?? 'video/mp4'
        return {
          id: source.id,
          name: source.name ?? `${source.id}.mp4`,
          mimeType,
          meta: source.meta,
          blob: new Blob([new Uint8Array(source.bytes)], { type: mimeType }),
          thumbnail:
            source.thumbnail && new Blob([new Uint8Array(source.thumbnail.bytes)], { type: source.thumbnail.type }),
        }
      })
    )
  )
}

/** Hand-built v2 bytes, for files the writer would never produce. */
function rawV2File(
  index: unknown,
  payload: number[] = [],
  header: { version?: number; indexLength?: number } = {}
): File {
  const indexBytes = new TextEncoder().encode(typeof index === 'string' ? index : JSON.stringify(index))
  const head = new Uint8Array(HEADER_BYTES)
  head.set([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(head.buffer)
  view.setUint32(8, header.version ?? 2, true)
  view.setUint32(12, header.indexLength ?? indexBytes.length, true)
  return fileOf([head, indexBytes, new Uint8Array(payload)])
}

/**
 * A `.veditor` as large as its parts claim, without the bytes. `slice` hands
 * back the real header and index. Any other range returns an `untouchable`
 * marker Blob of that range's size and is recorded, so a test can see exactly
 * which ranges the loader cut, that it never read the file whole, and that it
 * never read a cut part either.
 */
function virtualV2File(parts: BlobPart[]) {
  const header = parts[0] as Uint8Array<ArrayBuffer>
  const indexBytes = parts[1] as Uint8Array<ArrayBuffer>
  const payloadStart = HEADER_BYTES + indexBytes.length
  const size = payloadStart + parts.slice(2).reduce<number>((sum, part) => sum + (part as Blob).size, 0)
  const cuts: Array<{ start: number; end: number; type: string; marker: Blob }> = []
  const wholeReads: string[] = []
  const file = {
    name: 'huge.veditor',
    type: '',
    size,
    slice(start = 0, end = size, type = '') {
      if (start === 0 && end === HEADER_BYTES) return new Blob([header])
      if (start === HEADER_BYTES && end === payloadStart) return new Blob([indexBytes])
      const marker = untouchable(end - start, type)
      cuts.push({ start, end, type, marker })
      return marker
    },
    text: () => {
      wholeReads.push('text')
      return Promise.reject(new Error('read the whole file'))
    },
    arrayBuffer: () => {
      wholeReads.push('arrayBuffer')
      return Promise.reject(new Error('read the whole file'))
    },
    stream: () => {
      wholeReads.push('stream')
      throw new Error('read the whole file')
    },
  }
  return { file: file as unknown as File, cuts, wholeReads, payloadStart }
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

/** A project whose clips use each of `ids`, in order. */
const projectUsing = (ids: string[]): Project => {
  const project = createTestProject(ids[0])
  project.timeline.clips = ids.map((id, i) => ({ ...project.timeline.clips[0], id: `clip${i}`, sourceVideoId: id }))
  return project
}

describe('saveProject', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jsdom would try to navigate on a real anchor click; the click itself is
    // what we assert on, so intercept it and read the anchor it was made on.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
  })

  afterEach(() => {
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
    // A case that throws before its once-queued storage stubs are consumed
    // must not hand them to the next case.
    vi.mocked(getVideo).mockReset()
    vi.mocked(getThumbnail).mockReset()
  })

  /** The .veditor handed to URL.createObjectURL for download, read back through the v2 reader. */
  async function capturedSave(): Promise<{ file: File; index: ProjectFileIndex; payloadStart: number }> {
    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    expect(blob.type).toBe('application/octet-stream')
    const file = fileOf([blob], 'saved.veditor')
    const container = await readProjectFileIndex(file)
    return { file, index: container!.index, payloadStart: container!.payloadStart }
  }

  const bytesAt = async (file: File, payloadStart: number, range: { offset: number; length: number }) =>
    Array.from(new Uint8Array(await sliceRange(file, payloadStart, range, '').arrayBuffer()))

  it('writes a v2 container holding the stored bytes and thumbnail, and triggers a download', async () => {
    const videoId = uniqueId('vid')
    const bytes = [0, 1, 2, 255, 254, 253]
    await storeVideo(videoId, new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), sourceVideo(videoId))
    await storeThumbnail(videoId, new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }))

    const progress: Array<[number, string]> = []
    await saveProject(createTestProject(videoId), [sourceVideo(videoId)], (p, m) => progress.push([p, m]))

    const { file, index, payloadStart } = await capturedSave()
    expect(index.version).toBe(2)
    expect(index.project.id).toBe('project1')
    expect(index.videos).toHaveLength(1)
    expect(index.videos[0].id).toBe(videoId)
    expect(index.videos[0].mimeType).toBe('video/mp4')
    expect(await bytesAt(file, payloadStart, index.videos[0].data)).toEqual(bytes)
    expect(index.videos[0].thumbnail!.mimeType).toBe('image/jpeg')
    expect(await bytesAt(file, payloadStart, index.videos[0].thumbnail!)).toEqual([9, 8, 7])

    expect(progress).toEqual([
      [0, 'Preparing project data...'],
      [90, 'Creating project file...'],
      [100, 'Project saved!'],
    ])

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('Test Project.veditor')
    expect(anchor.href).toContain(lastObjectUrl())
    // The anchor is removed again once clicked.
    expect(document.body.contains(anchor)).toBe(false)
  })

  it('omits the thumbnail when none is stored', async () => {
    const videoId = uniqueId('vid')
    await storeVideo(videoId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(videoId))

    await saveProject(createTestProject(videoId), [sourceVideo(videoId)])

    const { index } = await capturedSave()
    expect(index.videos[0].thumbnail).toBeUndefined()
  })

  it('writes only the videos the timeline actually uses', async () => {
    const usedId = uniqueId('used')
    const unusedId = uniqueId('unused')
    await storeVideo(usedId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(usedId))
    await storeVideo(unusedId, new Blob([new Uint8Array([2])], { type: 'video/mp4' }), sourceVideo(unusedId))

    await saveProject(createTestProject(usedId), [sourceVideo(usedId), sourceVideo(unusedId)])

    const { index } = await capturedSave()
    expect(index.videos.map((v) => v.id)).toEqual([usedId])
  })

  it('skips a referenced video whose blob is no longer in storage', async () => {
    const missingId = uniqueId('gone')
    await saveProject(createTestProject(missingId), [sourceVideo(missingId)])

    const { index } = await capturedSave()
    expect(index.videos).toEqual([])
    // The project itself is still written out.
    expect(index.project.timeline.clips).toHaveLength(1)
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

    const { index } = await capturedSave()
    expect(index.project.timeline.clips[0].crop).toEqual({ left: 0.25, top: 0.1, right: 0, bottom: 0 })
  })

  // Review Focus 2.
  it('saves and reopens a source of zero bytes', async () => {
    const videoId = uniqueId('zero')
    await storeVideo(videoId, new Blob([], { type: 'video/mp4' }), sourceVideo(videoId))

    await saveProject(createTestProject(videoId), [sourceVideo(videoId)])
    const { file, index } = await capturedSave()
    expect(index.videos[0].data).toEqual({ offset: 0, length: 0 })

    await deleteVideo(videoId)
    const media = installMediaElementDoubles()
    try {
      const { sourceVideos } = await loadProject(file)
      expect(sourceVideos[0].size).toBe(0)
      expect((await getVideo(videoId))!.blob.size).toBe(0)
    } finally {
      media.uninstall()
      await deleteVideo(videoId)
    }
  })

  // Spec test 1, and the red form of the deleted ESCSUITE-241 refusals: twice
  // the old 256 MiB budget, with sources that throw if anything reads them.
  it('saves sources twice the old budget without reading a byte of them', async () => {
    const a = uniqueId('big-a')
    const b = uniqueId('big-b')
    const bigA = untouchable(200 * MiB, 'video/mp4')
    const thumbA = untouchable(64 * 1024, 'image/jpeg')
    const bigB = untouchable(312 * MiB, 'video/webm')
    vi.mocked(getVideo)
      .mockImplementationOnce(async () => ({ blob: bigA, metadata: sourceVideo(a) }))
      .mockImplementationOnce(async () => ({ blob: bigB, metadata: sourceVideo(b, 'b.webm', 'video/webm') }))
    vi.mocked(getThumbnail)
      .mockImplementationOnce(async () => thumbA)
      .mockImplementationOnce(async () => undefined)
    // Record what saveProject hands `new Blob` instead of letting Node's Blob
    // add up 512 MiB of reported sizes over empty handles. Refuse any FileReader.
    const RealBlob = globalThis.Blob
    const RealFileReader = globalThis.FileReader
    const made: Array<{ parts: BlobPart[]; type?: string }> = []
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          made.push({ parts, type: options?.type })
        }
      }
    )
    vi.stubGlobal(
      'FileReader',
      class {
        constructor() {
          throw new Error('FileReader read a source on save')
        }
      }
    )
    try {
      await saveProject(projectUsing([a, b]), [sourceVideo(a, 'First'), sourceVideo(b, 'Second', 'video/webm')])
    } finally {
      vi.stubGlobal('Blob', RealBlob)
      vi.stubGlobal('FileReader', RealFileReader)
    }

    expect(made).toHaveLength(1)
    expect(made[0].type).toBe('application/octet-stream')
    const parts = made[0].parts
    expect(parts[2]).toBe(bigA)
    expect(parts[3]).toBe(thumbA)
    expect(parts[4]).toBe(bigB)
    const index = JSON.parse(new TextDecoder().decode(parts[1] as Uint8Array)) as ProjectFileIndex
    expect(index.videos.map((v) => [v.id, v.name, v.data])).toEqual([
      [a, 'First', { offset: 0, length: 200 * MiB }],
      [b, 'Second', { offset: 200 * MiB + 64 * 1024, length: 312 * MiB }],
    ])
    expect(index.videos[0].thumbnail).toEqual({ offset: 200 * MiB, length: 64 * 1024, mimeType: 'image/jpeg' })
    expect(clickSpy).toHaveBeenCalledTimes(1)
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

  // Final review fix 1: parseProject runs before any source is copied, so a
  // refused project leaves nothing behind in the shared DB.
  it('refuses a project parseProject refuses, by name, before storing any of its sources', async () => {
    const videoId = uniqueId('v1-refused')
    const noTimeline: Partial<Project> = createTestProject(videoId)
    delete noTimeline.timeline
    const file = veditorFile(
      {
        project: noTimeline as Project,
        videos: [{ id: videoId, name: 'v.mp4', mimeType: 'video/mp4', data: base64Of([1, 2, 3]) }],
      },
      videoId
    )
    vi.mocked(storeVideo).mockClear()
    vi.mocked(deleteVideo).mockClear()

    const error = await loadProject(file).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toBe('Project has no timeline')
    expect(storeVideo).not.toHaveBeenCalled()
    // Refused before the restore loop: there is nothing to roll back.
    expect(deleteVideo).not.toHaveBeenCalled()
    expect(await getVideo(videoId)).toBeUndefined()
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

describe('loadProject, version 2 (ESCSUITE-260)', () => {
  let media: MediaDoubles
  const meta = (overrides: Partial<SourceVideoMeta> = {}): SourceVideoMeta => ({
    duration: 12,
    width: 640,
    height: 360,
    frameRate: 24,
    ...overrides,
  })

  beforeEach(() => {
    media = installMediaElementDoubles({ video: { duration: 42, videoWidth: 1280, videoHeight: 720 } })
    // mockReset, not mockClear: it also drops a once-queued value a case left
    // unconsumed, and restores the pass-through implementation.
    vi.mocked(storeVideo).mockReset()
    vi.mocked(storeThumbnail).mockReset()
  })

  afterEach(() => {
    media.uninstall()
  })

  it('reads the bytes, meta, editor block, crop and the thumbnail in its own type', async () => {
    const id = uniqueId('v2')
    const project = createTestProject(id)
    project.timeline.clips[0].crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }
    const editor: EditorBlock = { inPoint: 1, outPoint: 4, markers: [] }
    const file = v2File(
      project,
      [
        {
          id,
          name: 'clip.webm',
          mimeType: 'video/webm',
          meta: meta({ waveformData: [{ min: -1, max: 1 }] }),
          bytes: [0, 1, 255],
          thumbnail: { bytes: [9, 8, 7], type: 'image/png' },
        },
      ],
      editor
    )

    const progress: Array<[number, string]> = []
    const loaded = await loadProject(file, (p, m) => progress.push([p, m]))

    expect(loaded.project.timeline.clips[0].crop).toEqual({ left: 0.25, top: 0.1, right: 0, bottom: 0 })
    expect(loaded.project.modified).toBeGreaterThan(1234567890000)
    expect(loaded.editor).toEqual(editor)
    expect(loaded.sourceVideos[0]).toMatchObject({
      id,
      name: 'clip.webm',
      mimeType: 'video/webm',
      duration: 12,
      width: 640,
      height: 360,
      frameRate: 24,
      size: 3,
      waveformData: [{ min: -1, max: 1 }],
    })
    expect(loaded.sourceVideos[0].thumbnailUrl).toBe(lastObjectUrl())
    const stored = await getVideo(id)
    expect(Array.from(new Uint8Array(await stored!.blob.arrayBuffer()))).toEqual([0, 1, 255])
    expect(stored!.blob.type).toBe('video/webm')
    const thumb = await getThumbnail(id)
    expect(Array.from(new Uint8Array(await thumb!.arrayBuffer()))).toEqual([9, 8, 7])
    expect(thumb!.type).toBe('image/png') // v1 always wrote image/jpeg
    expect(media.videos).toHaveLength(0)
    expect(progress[0]).toEqual([0, 'Reading project file...'])
    expect(progress).toContainEqual([10, 'Restoring videos...'])
    expect(progress).toContainEqual([90, 'Restoring video 1/1...'])
    expect(progress[progress.length - 1]).toEqual([100, 'Project loaded!'])

    await deleteVideo(id)
  })

  it('loads a v2 project that holds no sources', async () => {
    const loaded = await loadProject(v2File(createTestProject('none'), []))
    expect(loaded.sourceVideos).toEqual([])
    expect(loaded.editor).toBeUndefined()
  })

  // Review Focus 1.
  it('round trips a project whose names and markers are not ASCII', async () => {
    const id = uniqueId('unicode')
    const project = { ...createTestProject(id), name: 'Café — 日本' }
    const editor: EditorBlock = {
      inPoint: null,
      outPoint: null,
      markers: [{ id: 'm', time: 1, label: 'Ünïcødé ✓', color: '#ffcc00' }],
    }

    const loaded = await loadProject(v2File(project, [{ id, name: 'クリップ.mp4', meta: meta(), bytes: [4, 5] }], editor))

    expect(loaded.project.name).toBe('Café — 日本')
    expect(loaded.editor).toEqual(editor)
    expect(loaded.sourceVideos[0].name).toBe('クリップ.mp4')
    expect(Array.from(new Uint8Array(await (await getVideo(id))!.blob.arrayBuffer()))).toEqual([4, 5])

    await deleteVideo(id)
  })

  it('loads a 2 GiB file by slicing it, never reading it whole', async () => {
    const a = uniqueId('huge-a')
    const b = uniqueId('huge-b')
    const { file, cuts, wholeReads, payloadStart } = virtualV2File(
      encodeProjectFile(createTestProject(a), undefined, [
        {
          id: a,
          name: 'a.mp4',
          mimeType: 'video/mp4',
          meta: meta(),
          blob: untouchable(1536 * MiB, 'video/mp4'),
          thumbnail: untouchable(MiB, 'image/jpeg'),
        },
        { id: b, name: 'b.webm', mimeType: 'video/webm', meta: meta(), blob: untouchable(511 * MiB, 'video/webm') },
      ])
    )
    expect(file.size - payloadStart).toBe(2 * GiB)
    vi.mocked(storeVideo).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    vi.mocked(storeThumbnail).mockResolvedValueOnce(undefined)

    const { sourceVideos } = await loadProject(file)

    expect(wholeReads).toEqual([])
    expect(cuts.map(({ start, end, type }) => ({ start, end, type }))).toEqual([
      { start: payloadStart, end: payloadStart + 1536 * MiB, type: 'video/mp4' },
      { start: payloadStart + 1536 * MiB, end: payloadStart + 1537 * MiB, type: 'image/jpeg' },
      { start: payloadStart + 1537 * MiB, end: payloadStart + 2048 * MiB, type: 'video/webm' },
    ])
    expect(vi.mocked(storeVideo).mock.calls.map(([id, blob]) => [id, blob])).toEqual([
      [a, cuts[0].marker],
      [b, cuts[2].marker],
    ])
    expect(vi.mocked(storeVideo).mock.calls[0][1]).toBe(cuts[0].marker)
    expect(vi.mocked(storeVideo).mock.calls[1][1]).toBe(cuts[2].marker)
    expect(vi.mocked(storeThumbnail).mock.calls).toEqual([[a, cuts[1].marker]])
    expect(vi.mocked(storeThumbnail).mock.calls[0][1]).toBe(cuts[1].marker)
    expect(sourceVideos.map((source) => source.id)).toEqual([a, b])
  })

  it('resurrects bytes but not CRAFT take identity for a source CRAFT no longer has (ESCSUITE-151)', async () => {
    const id = uniqueId('v2-deleted-take')
    const take: SourceVideo = {
      id,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(id, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), take)
    await deleteVideo(id)

    const takeMeta: SourceVideoMeta = {
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
    }
    const { sourceVideos } = await loadProject(
      v2File(createTestProject(id), [{ id, name: take.name, mimeType: take.mimeType, meta: takeMeta, bytes: [1, 2, 3] }])
    )

    expect(sourceVideos[0].source).toBeUndefined()
    expect(sourceVideos[0].takeId).toBeUndefined()
    expect(sourceVideos[0].role).toBeUndefined()
    expect(sourceVideos[0].startOffset).toBeUndefined()
    expect(sourceVideos[0].overlayPlacement).toBeUndefined()
    expect(sourceVideos[0].duration).toBe(12)
    expect(sourceVideos[0].hasWebcam).toBe(true)
    const restored = (await getAllVideoMetadata()).find((v) => v.id === id)
    expect(restored!.source).toBeUndefined()
    expect(restored!.takeId).toBeUndefined()

    await deleteVideo(id)
  })

  it("keeps a present source's own CRAFT identity and writes nothing for it (ESCSUITE-151)", async () => {
    const id = uniqueId('v2-present')
    const stored: SourceVideo = {
      id,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
      hasWebcam: true,
    }
    await storeVideo(id, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)
    vi.mocked(storeVideo).mockClear()

    const { sourceVideos } = await loadProject(
      v2File(createTestProject(id), [
        {
          id,
          name: 'take.webm',
          mimeType: 'video/webm',
          meta: meta({ duration: 20, frameRate: 30, waveformData: [{ min: -1, max: 1 }] }),
          bytes: [1, 2, 3],
          thumbnail: { bytes: [5], type: 'image/jpeg' },
        },
      ])
    )

    expect(sourceVideos[0]).toMatchObject({
      duration: 20,
      frameRate: 30,
      waveformData: [{ min: -1, max: 1 }],
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
    })
    expect(storeVideo).not.toHaveBeenCalled()
    expect(storeThumbnail).not.toHaveBeenCalled()
    expect((await getVideo(id))!.metadata).toEqual(stored)

    await deleteVideo(id)
  })

  it('sends a file whose magic is one byte off down the v1 path, where it fails as JSON', async () => {
    const bytes = new Uint8Array(
      await rawV2File({ version: 2, project: createTestProject('x'), videos: [] }).arrayBuffer()
    )
    bytes[3] = 0x45 // 'E' where the magic has 'D'

    const error = await loadProject(fileOf([bytes])).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SyntaxError)
    expect(error).not.toBeInstanceOf(ProjectFileError)
    expect(storeVideo).not.toHaveBeenCalled()
  })

  const refusedId = 'refused'
  const indexWith = (videos: unknown[]) => ({ version: 2, project: createTestProject(refusedId), videos })
  const one = (data: unknown) => [{ id: refusedId, name: 'v.mp4', mimeType: 'video/mp4', data }]

  // Final review fix 1: parseProject runs before any source is copied, so a
  // refused project (hand-edited, or from a newer editor) leaves nothing behind.
  it.each([
    [
      'a project with no timeline',
      () => {
        const project: Partial<Project> = createTestProject(refusedId)
        delete project.timeline
        return { project }
      },
      'Project has no timeline',
    ],
    [
      'an editor block whose in point is after its out point',
      () => ({ project: createTestProject(refusedId), editor: { inPoint: 5, outPoint: 1, markers: [] } }),
      'editor.inPoint must be before editor.outPoint',
    ],
  ])('refuses %s by name before storing any of its sources', async (_case, build, reason) => {
    vi.mocked(deleteVideo).mockClear()
    const file = rawV2File({ version: 2, ...build(), videos: one({ offset: 0, length: 3 }) }, [1, 2, 3])

    const error = await loadProject(file).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toBe(reason)
    expect(storeVideo).not.toHaveBeenCalled()
    expect(storeThumbnail).not.toHaveBeenCalled()
    // Refused before the restore loop: there is nothing to roll back.
    expect(deleteVideo).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a file that opens with the magic and stops short of a whole header',
      () => fileOf([Uint8Array.of(0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 2, 0, 0, 0)]),
      /^the file ends before its header does: it is 12 bytes and a header is 16$/,
    ],
    ['a newer container version', () => rawV2File(indexWith([]), [], { version: 3 }), /newer ESCAPEARTIST/],
    [
      'an index longer than the cap',
      () => rawV2File('', [], { indexLength: MAX_INDEX_BYTES + 1 }),
      /over the 67108864-byte limit/,
    ],
    ['an index past the end of the file', () => rawV2File('{}', [], { indexLength: 4096 }), /ends before its index does/],
    ['an index that is not JSON', () => rawV2File('{oops'), /not valid JSON/],
    [
      'a range that is not a safe integer',
      () => rawV2File(indexWith(one({ offset: 0, length: 2 ** 53 })), [1, 2, 3]),
      /data is not a byte range/,
    ],
    ['a gap', () => rawV2File(indexWith(one({ offset: 1, length: 2 })), [1, 2, 3]), /starts at byte 1 of the media/],
    [
      'an overlap',
      () =>
        rawV2File(
          indexWith([...one({ offset: 0, length: 3 }), { id: 'other', name: 'o.mp4', mimeType: 'video/mp4', data: { offset: 2, length: 1 } }]),
          [1, 2, 3, 4]
        ),
      /video #1's data starts at byte 2/,
    ],
    [
      'sources out of order',
      () =>
        rawV2File(
          indexWith([...one({ offset: 1, length: 3 }), { id: 'other', name: 'o.mp4', mimeType: 'video/mp4', data: { offset: 0, length: 1 } }]),
          [1, 2, 3, 4]
        ),
      /video #0's data starts at byte 1/,
    ],
    [
      'a truncated payload',
      () => rawV2File(indexWith(one({ offset: 0, length: 10 })), [1, 2, 3]),
      /\(3 of 10 bytes\), so it was probably cut off while downloading/,
    ],
    ['trailing junk', () => rawV2File(indexWith(one({ offset: 0, length: 3 })), [1, 2, 3, 4, 5]), /2 bytes after its last source/],
  ])('refuses %s by name, and writes nothing', async (_case, build, reason) => {
    const error = await loadProject(build()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toMatch(reason)
    expect(storeVideo).not.toHaveBeenCalled()
    expect(storeThumbnail).not.toHaveBeenCalled()
  })
})

describe('loading a project into storage that may be full (ESCSUITE-260)', () => {
  let media: MediaDoubles
  const meta: SourceVideoMeta = { duration: 9, width: 64, height: 48, frameRate: 30 }
  const source = (id: string, size: number, thumbnail = 0) => ({
    id,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    meta,
    blob: untouchable(size, 'video/mp4'),
    ...(thumbnail > 0 ? { thumbnail: untouchable(thumbnail, 'image/jpeg') } : {}),
  })
  const estimate = (used: number, quota: number) =>
    vi.mocked(getStorageEstimate).mockResolvedValueOnce({ used, quota, available: quota - used })
  const seed = async (id: string) => {
    await actualStorage.storeVideo(id, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(id))
  }
  // mockReset, not mockClear: it also drops a once-queued value a case left
  // unconsumed, and restores the pass-through implementation. Done on both
  // sides, so nothing queued here reaches the describes that follow.
  const resetSpies = () => {
    vi.mocked(storeVideo).mockReset()
    vi.mocked(storeThumbnail).mockReset()
    vi.mocked(deleteVideo).mockReset()
    vi.mocked(getStorageEstimate).mockReset()
  }

  beforeEach(() => {
    media = installMediaElementDoubles()
    resetSpies()
  })

  afterEach(() => {
    media.uninstall()
    resetSpies()
  })

  describe('the pre-check', () => {
    it('refuses, before any write, a load that needs more than the browser has free', async () => {
      const a = uniqueId('q-a')
      const b = uniqueId('q-b')
      const { file } = virtualV2File(
        encodeProjectFile(createTestProject(a), undefined, [source(a, GiB, 256 * MiB), source(b, 256 * MiB)])
      )
      estimate(3 * GiB, 4 * GiB)

      const error = await loadProject(file).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProjectFileError)
      expect((error as Error).message).toBe(
        'This project needs 1.5 GiB of storage and this browser has 1.0 GiB free.'
      )
      expect(storeVideo).not.toHaveBeenCalled()
      expect(storeThumbnail).not.toHaveBeenCalled()
      // Refused before the restore loop: there is nothing to roll back.
      expect(deleteVideo).not.toHaveBeenCalled()
    })

    it('names a smaller shortfall in MiB', async () => {
      const a = uniqueId('q-mib')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, 200 * MiB)]))
      estimate(GiB - 100 * MiB, GiB)

      await expect(loadProject(file)).rejects.toThrow(
        'This project needs 200 MiB of storage and this browser has 100 MiB free.'
      )
    })

    // Final review fix 2: the needed figure rounds up and the free one down,
    // so a refusal never names the same figure twice.
    it.each([
      [Math.round(100.5 * MiB), Math.round(100.2 * MiB), 'needs 101 MiB of storage and this browser has 100 MiB free'],
      [Math.round(1.04 * GiB), Math.round(1.02 * GiB), 'needs 1.1 GiB of storage and this browser has 1.0 GiB free'],
    ])('names a shortfall of %d over %d bytes as two different figures', async (needed, free, words) => {
      const a = uniqueId('q-round')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, needed)]))
      vi.mocked(getStorageEstimate).mockResolvedValueOnce({ used: 0, quota: 4 * GiB, available: free })

      await expect(loadProject(file)).rejects.toThrow(`This project ${words}.`)
    })

    it('accepts a load that needs exactly what is free', async () => {
      const a = uniqueId('q-equal')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, GiB)]))
      estimate(3 * GiB, 4 * GiB)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      const { sourceVideos } = await loadProject(file)

      expect(sourceVideos.map((v) => v.id)).toEqual([a])
      expect(storeVideo).toHaveBeenCalledTimes(1)
    })

    // Review Focus 4.
    it('does not count a source that is already stored, however large the file says it is', async () => {
      const present = uniqueId('q-present')
      const fresh = uniqueId('q-new')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      const { file } = virtualV2File(
        encodeProjectFile(createTestProject(present), undefined, [source(present, 1.5 * GiB), source(fresh, 512 * MiB)])
      )
      estimate(3 * GiB, 4 * GiB)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      const { sourceVideos } = await loadProject(file)

      expect(sourceVideos.map((v) => v.id)).toEqual([present, fresh])
      expect(vi.mocked(storeVideo).mock.calls.map(([id]) => id)).toEqual([fresh])
      await actualStorage.deleteVideo(present)
    })

    it('skips the check when the browser measured nothing (quota 0, no estimate API)', async () => {
      const a = uniqueId('q-unmeasured')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, 1.5 * GiB)]))
      estimate(0, 0)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      await expect(loadProject(file)).resolves.toBeDefined()
      expect(storeVideo).toHaveBeenCalledTimes(1)
    })

    it('skips the check when the estimate itself rejects, and says why once', async () => {
      const a = uniqueId('q-rejected')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, 1.5 * GiB)]))
      const cause = new Error('estimate unavailable')
      vi.mocked(getStorageEstimate).mockRejectedValueOnce(cause)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(loadProject(file)).resolves.toBeDefined()

      expect(storeVideo).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        'Could not read the storage estimate; loading without the free-space check:',
        cause
      )
      warn.mockRestore()
    })

    // Review Focus 4.
    it('accepts a load that writes nothing when usage is already over quota', async () => {
      const present = uniqueId('q-over')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      const { file } = virtualV2File(encodeProjectFile(createTestProject(present), undefined, [source(present, GiB)]))
      estimate(5 * GiB, 4 * GiB)

      await expect(loadProject(file)).resolves.toBeDefined()
      expect(storeVideo).not.toHaveBeenCalled()
      await actualStorage.deleteVideo(present)
    })
  })

  describe('the rollback', () => {
    it('deletes what it wrote when a later write fails, and rethrows the original error', async () => {
      const first = uniqueId('rb-first')
      const second = uniqueId('rb-second')
      const failure = new Error('QuotaExceededError')
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(failure)

      const error = await loadProject(
        v2File(createTestProject(first), [
          { id: first, meta, bytes: [1] },
          { id: second, meta, bytes: [2] },
        ])
      ).catch((e: unknown) => e)

      expect(error).toBe(failure)
      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })

    it("revokes the thumbnail URL it minted for a source it rolled back, once", async () => {
      const first = uniqueId('rb-url-1')
      const second = uniqueId('rb-url-2')
      let minted = ''
      vi.mocked(storeVideo)
        .mockImplementationOnce(actualStorage.storeVideo)
        .mockImplementationOnce(async () => {
          // The first source's thumbnail handle is the last one minted before this write.
          minted = lastObjectUrl()
          throw new Error('disk full')
        })
      vi.mocked(URL.revokeObjectURL).mockClear()

      await expect(
        loadProject(
          v2File(createTestProject(first), [
            { id: first, meta, bytes: [1], thumbnail: { bytes: [9], type: 'image/jpeg' } },
            { id: second, meta, bytes: [2] },
          ])
        )
      ).rejects.toThrow('disk full')

      expect(minted).toMatch(OBJECT_URL_PATTERN)
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([[minted]])
      expect(await getVideo(first)).toBeUndefined()
    })

    it('revokes nothing when the load succeeds', async () => {
      const first = uniqueId('rb-url-ok-1')
      const second = uniqueId('rb-url-ok-2')
      vi.mocked(URL.revokeObjectURL).mockClear()

      const { sourceVideos } = await loadProject(
        v2File(createTestProject(first), [
          { id: first, meta, bytes: [1], thumbnail: { bytes: [9], type: 'image/jpeg' } },
          { id: second, meta, bytes: [2], thumbnail: { bytes: [8], type: 'image/jpeg' } },
        ])
      )

      expect(sourceVideos.map((v) => v.thumbnailUrl)).toEqual([
        expect.stringMatching(OBJECT_URL_PATTERN),
        expect.stringMatching(OBJECT_URL_PATTERN),
      ])
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      await actualStorage.deleteVideo(first)
      await actualStorage.deleteVideo(second)
    })

    it('never deletes a source that was stored before the load', async () => {
      const present = uniqueId('rb-present')
      const first = uniqueId('rb-new-1')
      const second = uniqueId('rb-new-2')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(new Error('disk full'))

      await expect(
        loadProject(
          v2File(createTestProject(present), [
            { id: present, meta, bytes: [1] },
            { id: first, meta, bytes: [2] },
            { id: second, meta, bytes: [3] },
          ])
        )
      ).rejects.toThrow('disk full')

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(present)).toBeDefined()
      await actualStorage.deleteVideo(present)
    })

    it('warns once when a delete fails, and still rethrows the original error', async () => {
      const first = uniqueId('rb-warn')
      const second = uniqueId('rb-warn-2')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deleteFailure = new Error('database closed')
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(new Error('disk full'))
      vi.mocked(deleteVideo).mockRejectedValueOnce(deleteFailure)

      await expect(
        loadProject(
          v2File(createTestProject(first), [
            { id: first, meta, bytes: [1] },
            { id: second, meta, bytes: [2] },
          ])
        )
      ).rejects.toThrow('disk full')

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(`Could not remove source ${first} after a project load failed:`, deleteFailure)
      warn.mockRestore()
      await actualStorage.deleteVideo(first)
    })

    it('rolls back its own video when its thumbnail write fails', async () => {
      const id = uniqueId('rb-thumb')
      vi.mocked(storeThumbnail).mockRejectedValueOnce(new Error('thumbnail write failed'))

      await expect(
        loadProject(v2File(createTestProject(id), [{ id, meta, bytes: [1], thumbnail: { bytes: [2], type: 'image/jpeg' } }]))
      ).rejects.toThrow('thumbnail write failed')

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[id]])
      expect(await getVideo(id)).toBeUndefined()
    })

    // Review Focus 3.
    it("rolls back when a later source's metadata probe fails", async () => {
      const first = uniqueId('rb-probe-1')
      const second = uniqueId('rb-probe-2')
      media.script({ video: { fail: true } })

      await expect(
        loadProject(
          v2File(createTestProject(first), [
            { id: first, meta, bytes: [1] },
            { id: second, bytes: [2] }, // no meta: probed, and the probe fails
          ])
        )
      ).rejects.toThrow(`Failed to load video: ${second}.mp4`)

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })

    // Review Focus 3: the loop is shared, so a v1 file rolls back too.
    it('rolls back a v1 load too', async () => {
      const first = uniqueId('rb-v1-1')
      const second = uniqueId('rb-v1-2')
      const file = new File(
        [
          JSON.stringify({
            version: 1,
            project: createTestProject(first),
            videos: [
              { id: first, name: 'a.mp4', mimeType: 'video/mp4', data: base64Of([1, 2, 3]), meta },
              { id: second, name: 'b.mp4', mimeType: 'video/mp4', data: '***not base64***', meta },
            ],
          } satisfies ProjectFile),
        ],
        'old.veditor',
        { type: 'application/json' }
      )

      // atob's InvalidCharacterError: a DOMException, so asserted as any rejection.
      await expect(loadProject(file)).rejects.toBeTruthy()

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })
  })
})

describe('project file metadata round trip (ESCSUITE-97)', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let media: MediaDoubles

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
    media = installMediaElementDoubles()
  })

  afterEach(() => {
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
    media.uninstall()
  })

  /** The .veditor handed to URL.createObjectURL for download, and its index. */
  async function captured(): Promise<{ file: File; index: ProjectFileIndex }> {
    const file = fileOf([createObjectURL.mock.calls.at(-1)![0] as Blob], 'take.veditor')
    return { file, index: (await readProjectFileIndex(file))!.index }
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
      frameRateSource: 'measured',
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
    const saved = await captured()

    expect(saved.index.videos[0].meta).toEqual({
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      frameRateSource: 'measured',
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

    const reopened = saved.file
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
    const saved = await captured()

    // CRAFT deleted the take after the project was saved: the row is gone
    // from the shared DB entirely, so this load genuinely resurrects it.
    await deleteVideo(videoId)

    // The blob probe would report Infinity if the load path fell back to it —
    // scripted here so the assertion below is proof meta's duration/width/
    // height were still usable and trusted, exactly as they would be for any
    // other import.
    media.script({ video: { duration: Infinity, durationAfterSeek: 12, durationStaysUnknown: true } })

    const reopened = saved.file
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
    expect(sourceVideos[0].frameRateSource).toBe('assumed')
  })

  // ESCSUITE-276: the probe belongs to an import, not to a reopen. A file
  // with no meta falls back to 30 'assumed' rather than spending up to
  // 400 ms playing the blob to measure it.
  it('never plays a blob to measure its frame rate on load', async () => {
    media.script({ video: { duration: 6, frameTimes: [0, 1 / 60, 2 / 60, 3 / 60] } })

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          project: createTestProject('legacy-rate'),
          videos: [
            { id: 'legacy-rate', name: 'legacy.webm', mimeType: 'video/webm', data: base64Of([1, 2, 3]) },
          ],
        } satisfies ProjectFile),
      ],
      'legacy.veditor',
      { type: 'application/json' }
    )

    const { sourceVideos } = await loadProject(file)

    expect(media.videos).toHaveLength(1)
    expect(media.videos[0].play).not.toHaveBeenCalled()
    expect(sourceVideos[0]).toMatchObject({ frameRate: 30, frameRateSource: 'assumed' })
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
      frameRateSource: 'assumed',
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
      frameRateSource: 'assumed',
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
      frameRateSource: 'assumed',
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
      expect(this.accept).toBe('.veditor')
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
      types: [{ description: 'Video Editor Project', accept: { 'application/octet-stream': ['.veditor'] } }],
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

describe('the editor block in the project file (ESCSUITE-245)', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>
  let media: MediaDoubles

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
    media = installMediaElementDoubles({ video: { duration: 42, videoWidth: 1280, videoHeight: 720 } })
  })

  afterEach(() => {
    media.uninstall()
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
  })

  const marker = (id: string, time: number) => ({ id, time, label: id, color: '#ffcc00' })
  const lastFile = async (): Promise<File> =>
    fileOf([createObjectURL.mock.calls.at(-1)![0] as Blob], 'p.veditor')

  it('writes the range and markers beside the project, not inside it', async () => {
    const id = uniqueId('ed')
    const editor = { inPoint: 1, outPoint: 4, markers: [marker('b', 3), marker('a', 1)] }
    await saveProject(createTestProject(id), [], undefined, editor)

    const saved = (await readProjectFileIndex(await lastFile()))!.index
    expect(saved.editor).toEqual(editor)
    expect('editor' in saved.project).toBe(false)
  })

  it('round trips a range and three unsorted markers, the markers coming back sorted', async () => {
    const id = uniqueId('ed')
    await saveProject(createTestProject(id), [], undefined, {
      inPoint: 1, outPoint: 4, markers: [marker('c', 9), marker('a', 2), marker('b', 5)],
    })

    const loaded = await loadProject(await lastFile())
    const parsed = parseProject(loaded.project, loaded.editor)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.editor).toEqual({
        inPoint: 1, outPoint: 4, markers: [marker('a', 2), marker('b', 5), marker('c', 9)],
      })
    }
  })

  it('an old file without the block loads with no editor state', async () => {
    const id = uniqueId('ed')
    await saveProject(createTestProject(id), [])

    const loaded = await loadProject(await lastFile())
    expect(loaded.editor).toBeUndefined()
    const parsed = parseProject(loaded.project, loaded.editor)
    expect(parsed.ok && parsed.editor).toBeUndefined()
  })

  // Final review fix 1: loadProject now runs parseProject itself, before any
  // write, so a malformed block is refused there by name (it was handed back
  // for the hook's parseProject to refuse, after the sources were stored).
  it('refuses a malformed block by name, through parseProject', async () => {
    const id = uniqueId('ed')
    await saveProject(createTestProject(id), [], undefined, { inPoint: 5, outPoint: 1, markers: [] })

    const error = await loadProject(await lastFile()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toContain('editor.inPoint')
  })
})

