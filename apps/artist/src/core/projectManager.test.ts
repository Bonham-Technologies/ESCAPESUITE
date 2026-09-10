import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  exportProjectMetadata,
  extractMetadataFromBlob,
  importProjectMetadata,
  loadProject,
  saveProject,
  showOpenProjectDialog,
  type ProjectFile,
} from './projectManager'
// The real storage layer, running on the fake-indexeddb installed by
// src/test/setup.ts — save/load really round-trips through IndexedDB here.
import { getThumbnail, getVideo, storeThumbnail, storeVideo } from './storage'
import type { Project, SourceVideo } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { installFileReaderDouble } from '../test/doubles/fileReader'

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
    expect(anchor.href).toContain('blob:mock-url')
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

    expect(sourceVideos[0].thumbnailUrl).toBe('blob:mock-url')
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
    expect(revoke).toHaveBeenCalledWith('blob:mock-url')
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
