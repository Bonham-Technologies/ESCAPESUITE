import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { SourceVideo, Project } from '../store/types'
import { dropDeltaFrameCues } from './webmDeltaFrameCues'
import { webmBlob } from '../test/fixtures/webmFixture'

// Reset IndexedDB before importing storage module
beforeEach(() => {
  // Reset the global indexedDB to a fresh instance
  globalThis.indexedDB = new IDBFactory()
})

// Dynamic import to ensure fresh module for each test
async function getStorageModule() {
  // Clear module cache and re-import
  vi.resetModules()
  return import('./storage')
}

describe('storage', () => {
  describe('video operations', () => {
    it('stores and retrieves a video', async () => {
      const storage = await getStorageModule()

      const blob = new Blob(['test video data'], { type: 'video/mp4' })
      const metadata: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      }

      await storage.storeVideo('video1', blob, metadata)
      const result = await storage.getVideo('video1')

      expect(result).toBeDefined()
      expect(result?.metadata.id).toBe('video1')
      expect(result?.metadata.name).toBe('test.mp4')
      // Blob type check - fake-indexeddb returns structured clone
      expect(result?.blob).toBeDefined()
    })

    it('returns undefined for non-existent video', async () => {
      const storage = await getStorageModule()

      const result = await storage.getVideo('non-existent')
      expect(result).toBeUndefined()
    })

    it('retrieves video blob only', async () => {
      const storage = await getStorageModule()

      const blob = new Blob(['test video data'], { type: 'video/mp4' })
      const metadata: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      }

      await storage.storeVideo('video1', blob, metadata)
      const resultBlob = await storage.getVideoBlob('video1')

      expect(resultBlob).toBeDefined()
    })

    // ESCSUITE-359: a WebM re-indexed at import before the fix carries video
    // cues on delta frames, and Chromium's preview freezes on a far seek into
    // one. Reading it repairs it, and writes the repair back.
    describe('getVideoBlob repairing a stored seek index (ESCSUITE-359)', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      const metadata: SourceVideo = {
        id: 'take',
        name: 'take.webm',
        duration: 100,
        width: 16,
        height: 16,
        frameRate: 1,
        mimeType: 'video/webm',
        size: 0,
      }
      /** A Cluster every 33 s with a video cue on each, and a key frame at 0 only. */
      const storedTake = () =>
        webmBlob({
          cues: 'indexed',
          clusterMs: 33_000,
          frames: Array.from({ length: 100 }, (_, i) => ({ timeMs: i * 1000, key: i === 0 })),
        })

      it('hands back the repaired bytes and writes them back under the same id and metadata', async () => {
        const storage = await getStorageModule()
        const original = storedTake()
        await storage.storeVideo('take', original, metadata)

        const read = await storage.getVideoBlob('take', { persistRepair: true })

        const repaired = await dropDeltaFrameCues(original)
        expect(new Uint8Array(await read!.arrayBuffer())).toEqual(new Uint8Array(await repaired!.arrayBuffer()))
        const stored = await storage.getVideo('take')
        expect(stored?.metadata).toEqual(metadata)
        expect(await dropDeltaFrameCues(stored!.blob)).toBeNull()
      })

      it('hands back a sound WebM exactly as stored, and writes nothing', async () => {
        const storage = await getStorageModule()
        await storage.storeVideo('take', webmBlob({ cues: 'indexed' }), metadata)
        const shared = await import('@escapesuite/shared/storage')
        const store = vi.spyOn(shared, 'storeVideo')

        const read = await storage.getVideoBlob('take')

        expect(read?.size).toBe(webmBlob({ cues: 'indexed' }).size)
        expect(store).not.toHaveBeenCalled()
      })

      it('still hands back the repaired bytes when the write-back fails', async () => {
        const storage = await getStorageModule()
        const original = storedTake()
        await storage.storeVideo('take', original, metadata)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const shared = await import('@escapesuite/shared/storage')
        vi.spyOn(shared, 'storeVideo').mockRejectedValue(new Error('QuotaExceededError'))

        const read = await storage.getVideoBlob('take', { persistRepair: true })

        expect(await dropDeltaFrameCues(read!)).toBeNull()
        expect(warn).toHaveBeenCalledWith('Could not store the repaired seek index of "take.webm":', expect.any(Error))
      })

      it('repairs in memory only unless asked to persist (export must not rewrite the database)', async () => {
        const storage = await getStorageModule()
        await storage.storeVideo('take', storedTake(), metadata)
        const shared = await import('@escapesuite/shared/storage')
        const store = vi.spyOn(shared, 'storeVideo')

        const read = await storage.getVideoBlob('take')

        expect(await dropDeltaFrameCues(read!)).toBeNull()
        expect(store).not.toHaveBeenCalled()
        expect(await dropDeltaFrameCues((await storage.getVideo('take'))!.blob)).not.toBeNull()
      })

      it('hands back the stored bytes, and says so once, when the check throws', async () => {
        const storage = await getStorageModule()
        await storage.storeVideo('take', storedTake(), metadata)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const cues = await import('./webmDeltaFrameCues')
        vi.spyOn(cues, 'dropDeltaFrameCues').mockRejectedValue(new Error('NotReadableError'))

        const read = await storage.getVideoBlob('take', { persistRepair: true })

        expect(read?.size).toBe(storedTake().size)
        expect(warn).toHaveBeenCalledTimes(1)
      })

      it('returns undefined for a row that is gone', async () => {
        const storage = await getStorageModule()
        expect(await storage.getVideoBlob('gone')).toBeUndefined()
      })
    })

    it('gets all video metadata', async () => {
      const storage = await getStorageModule()

      const blob1 = new Blob(['data1'], { type: 'video/mp4' })
      const blob2 = new Blob(['data2'], { type: 'video/mp4' })

      const metadata1: SourceVideo = {
        id: 'video1',
        name: 'test1.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      }

      const metadata2: SourceVideo = {
        id: 'video2',
        name: 'test2.mp4',
        duration: 20,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 2000,
      }

      await storage.storeVideo('video1', blob1, metadata1)
      await storage.storeVideo('video2', blob2, metadata2)

      const allMetadata = await storage.getAllVideoMetadata()

      expect(allMetadata).toHaveLength(2)
      expect(allMetadata.map(m => m.id)).toContain('video1')
      expect(allMetadata.map(m => m.id)).toContain('video2')
    })

    it('deletes a video and its thumbnail', async () => {
      const storage = await getStorageModule()

      const videoBlob = new Blob(['video data'], { type: 'video/mp4' })
      const thumbnailBlob = new Blob(['thumbnail data'], { type: 'image/jpeg' })
      const metadata: SourceVideo = {
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      }

      await storage.storeVideo('video1', videoBlob, metadata)
      await storage.storeThumbnail('video1', thumbnailBlob)

      await storage.deleteVideo('video1')

      const video = await storage.getVideo('video1')
      const thumbnail = await storage.getThumbnail('video1')

      expect(video).toBeUndefined()
      expect(thumbnail).toBeUndefined()
    })
  })

  describe('thumbnail operations', () => {
    it('stores and retrieves a thumbnail', async () => {
      const storage = await getStorageModule()

      const blob = new Blob(['thumbnail data'], { type: 'image/jpeg' })

      await storage.storeThumbnail('thumb1', blob)
      const result = await storage.getThumbnail('thumb1')

      expect(result).toBeDefined()
    })

    it('returns undefined for non-existent thumbnail', async () => {
      const storage = await getStorageModule()

      const result = await storage.getThumbnail('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('resolveThumbnailUrl', () => {
    // The one mechanism projectManager.loadProject and
    // useSessionRestore.handleRestoreSession both use to give a restored
    // source video a live thumbnailUrl (ESCSUITE-96) — a fresh object URL
    // built from whatever is actually in storage, never a persisted handle.
    it('builds a fresh object URL from a stored thumbnail', async () => {
      const storage = await getStorageModule()
      await storage.storeThumbnail('thumb1', new Blob(['thumbnail data'], { type: 'image/jpeg' }))

      const url = await storage.resolveThumbnailUrl('thumb1')

      expect(url).toEqual(expect.stringMatching(/^blob:/))
    })

    it('resolves undefined when nothing is stored', async () => {
      const storage = await getStorageModule()

      const url = await storage.resolveThumbnailUrl('non-existent')

      expect(url).toBeUndefined()
    })
  })

  describe('revokeSourceThumbnails', () => {
    // The other half of resolveThumbnailUrl: nothing else ever frees the
    // URL.createObjectURL handle a thumbnailUrl is (ESCSUITE-113).
    beforeEach(() => {
      vi.mocked(URL.revokeObjectURL).mockClear()
    })

    const video = (overrides: Partial<SourceVideo> = {}): SourceVideo => ({
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000,
      ...overrides,
    })

    it('revokes a blob: thumbnail URL exactly once', async () => {
      const storage = await getStorageModule()

      storage.revokeSourceThumbnails([video({ thumbnailUrl: 'blob:thumb-1' })])

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
    })

    it('revokes each source in a list exactly once', async () => {
      const storage = await getStorageModule()

      storage.revokeSourceThumbnails([
        video({ id: 'a', thumbnailUrl: 'blob:a' }),
        video({ id: 'b', thumbnailUrl: 'blob:b' }),
      ])

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:b')
    })

    it('does nothing for a source with no thumbnail', async () => {
      const storage = await getStorageModule()

      storage.revokeSourceThumbnails([video({ thumbnailUrl: undefined })])

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('does nothing for a thumbnail URL that is not a blob: handle', async () => {
      const storage = await getStorageModule()

      storage.revokeSourceThumbnails([video({ thumbnailUrl: 'https://example.com/thumb.jpg' })])

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('does nothing for an empty list', async () => {
      const storage = await getStorageModule()

      storage.revokeSourceThumbnails([])

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    // The one-URL entry point the list version is written in terms of, for a
    // caller holding a handle that never became a source's (ESCSUITE-117's
    // `setSourceThumbnail`, whose rebuild lost its race with a real load).
    describe('revokeThumbnailUrl', () => {
      it('revokes a blob: URL', async () => {
        const storage = await getStorageModule()

        storage.revokeThumbnailUrl('blob:one-handle')

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one-handle')
      })

      it.each([
        ['undefined', undefined],
        ['a URL that is not a blob: handle', 'https://example.com/thumb.jpg'],
      ])('does nothing for %s', async (_label, url) => {
        const storage = await getStorageModule()

        storage.revokeThumbnailUrl(url)

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      })
    })
  })

  describe('project operations', () => {
    const createTestProject = (id: string, name: string): Project => ({
      id,
      name,
      created: Date.now(),
      modified: Date.now(),
      resolution: { width: 1280, height: 720 },
      timeline: {
        tracks: [{ id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }],
        clips: [],
        textOverlays: [],
        shapeOverlays: [],
        duration: 0,
      },
    })

    it('stores and retrieves a project', async () => {
      const storage = await getStorageModule()

      const project = createTestProject('project1', 'Test Project')

      await storage.storeProject(project)
      const result = await storage.getProject('project1')

      expect(result).toBeDefined()
      expect(result?.id).toBe('project1')
      expect(result?.name).toBe('Test Project')
    })

    it('returns undefined for non-existent project', async () => {
      const storage = await getStorageModule()

      const result = await storage.getProject('non-existent')
      expect(result).toBeUndefined()
    })

    it('gets all projects', async () => {
      const storage = await getStorageModule()

      await storage.storeProject(createTestProject('project1', 'Project 1'))
      await storage.storeProject(createTestProject('project2', 'Project 2'))

      const allProjects = await storage.getAllProjects()

      expect(allProjects).toHaveLength(2)
      expect(allProjects.map(p => p.id)).toContain('project1')
      expect(allProjects.map(p => p.id)).toContain('project2')
    })

    it('deletes a project', async () => {
      const storage = await getStorageModule()

      await storage.storeProject(createTestProject('project1', 'Test Project'))
      await storage.deleteProject('project1')

      const result = await storage.getProject('project1')
      expect(result).toBeUndefined()
    })

    it('updates an existing project', async () => {
      const storage = await getStorageModule()

      const project = createTestProject('project1', 'Original Name')
      await storage.storeProject(project)

      const updatedProject = { ...project, name: 'Updated Name' }
      await storage.storeProject(updatedProject)

      const result = await storage.getProject('project1')
      expect(result?.name).toBe('Updated Name')
    })
  })

  describe('settings operations', () => {
    it('sets and gets a setting', async () => {
      const storage = await getStorageModule()

      await storage.setSetting('theme', 'dark')
      const result = await storage.getSetting<string>('theme')

      expect(result).toBe('dark')
    })

    it('returns undefined for non-existent setting', async () => {
      const storage = await getStorageModule()

      const result = await storage.getSetting('non-existent')
      expect(result).toBeUndefined()
    })

    it('stores complex objects as settings', async () => {
      const storage = await getStorageModule()

      const settings = { theme: 'dark', zoom: 1.5, snapEnabled: true }
      await storage.setSetting('preferences', settings)

      const result = await storage.getSetting<typeof settings>('preferences')
      expect(result).toEqual(settings)
    })
  })

  // ESCSUITE-274: one session slot per tab, a `session:<tabId>` row each, plus
  // the single `current-session` row every tab shared before — read as a slot
  // with no owner until it is consumed.
  describe('session state operations', () => {
    const sessionFor = (tabId: string, overrides: Partial<import('./storage').SessionState> = {}) =>
      ({
        tabId,
        project: {
          id: 'project1',
          name: `Project of ${tabId}`,
          created: 1,
          modified: 1,
          resolution: { width: 1280, height: 720 },
          timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 },
        },
        sourceVideos: [],
        currentTime: 5.5,
        selectedClipId: 'clip1',
        zoom: 1.5,
        timestamp: 1000,
        ...overrides,
      }) as import('./storage').SessionState

    /** Write a row the way a build before ESCSUITE-274 did. */
    const writeLegacy = async (storage: typeof import('./storage'), session: unknown) => {
      const db = await storage.getDB()
      await db.put('settings', session, 'current-session')
    }

    it('saves each tab under its own row, so one tab never overwrites another', async () => {
      const storage = await getStorageModule()

      await storage.saveSessionState(sessionFor('tab-a'))
      await storage.saveSessionState(sessionFor('tab-b', { currentTime: 9 }))

      const db = await storage.getDB()
      expect(await db.get('settings', 'session:tab-a')).toEqual(sessionFor('tab-a'))
      expect(await db.get('settings', 'session:tab-b')).toEqual(sessionFor('tab-b', { currentTime: 9 }))
    })

    it('lists every tab\'s slot, keyed by the tab id in its row\'s key', async () => {
      const storage = await getStorageModule()
      await storage.saveSessionState(sessionFor('tab-a'))
      await storage.saveSessionState(sessionFor('tab-b'))
      await storage.setSetting('theme-preference', 'dark')

      expect(await storage.listSessionStates()).toEqual([
        { tabId: 'tab-a', session: sessionFor('tab-a') },
        { tabId: 'tab-b', session: sessionFor('tab-b') },
      ])
    })

    it('lists the shared row an older build wrote as a slot with no owner', async () => {
      const storage = await getStorageModule()
      const legacy: Partial<import('./storage').SessionState> = { ...sessionFor('ignored') }
      delete legacy.tabId
      await writeLegacy(storage, legacy)
      await storage.saveSessionState(sessionFor('tab-a'))

      expect(await storage.listSessionStates()).toEqual([
        { tabId: 'tab-a', session: sessionFor('tab-a') },
        { tabId: null, session: legacy },
      ])
    })

    it('lists nothing when no session was ever saved', async () => {
      const storage = await getStorageModule()

      expect(await storage.listSessionStates()).toEqual([])
    })

    it('clears one tab\'s slot and leaves the others', async () => {
      const storage = await getStorageModule()
      await storage.saveSessionState(sessionFor('tab-a'))
      await storage.saveSessionState(sessionFor('tab-b'))

      await storage.clearSessionState('tab-a')

      expect(await storage.listSessionStates()).toEqual([{ tabId: 'tab-b', session: sessionFor('tab-b') }])
    })

    it('clears the ownerless shared row when asked for the slot with no owner', async () => {
      const storage = await getStorageModule()
      await writeLegacy(storage, sessionFor('ignored'))
      await storage.saveSessionState(sessionFor('tab-a'))

      await storage.clearSessionState(null)

      expect(await storage.listSessionStates()).toEqual([{ tabId: 'tab-a', session: sessionFor('tab-a') }])
    })
  })

  describe('utility operations', () => {
    it('gets total video size', async () => {
      const storage = await getStorageModule()

      const blob1 = new Blob(['12345'], { type: 'video/mp4' }) // 5 bytes
      const blob2 = new Blob(['1234567890'], { type: 'video/mp4' }) // 10 bytes

      const createMetadata = (id: string): SourceVideo => ({
        id,
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      })

      await storage.storeVideo('video1', blob1, createMetadata('video1'))
      await storage.storeVideo('video2', blob2, createMetadata('video2'))

      const totalSize = await storage.getTotalVideoSize()
      // Total size should be a non-negative number
      expect(typeof totalSize).toBe('number')
      expect(totalSize).toBeGreaterThanOrEqual(0)
    })
  })

  describe('storage estimate operations', () => {
    it('gets storage estimate', async () => {
      const storage = await getStorageModule()

      // Mock navigator.storage.estimate
      const originalNavigator = globalThis.navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          storage: {
            estimate: vi.fn().mockResolvedValue({
              usage: 1000000,
              quota: 100000000,
            }),
          },
        },
        writable: true,
      })

      const estimate = await storage.getStorageEstimate()

      expect(estimate.used).toBe(1000000)
      expect(estimate.quota).toBe(100000000)
      expect(estimate.available).toBe(99000000)

      // Restore navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
      })
    })

    it('returns zeros when storage API is not available', async () => {
      const storage = await getStorageModule()

      // Mock navigator without storage API
      const originalNavigator = globalThis.navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
      })

      const estimate = await storage.getStorageEstimate()

      expect(estimate.used).toBe(0)
      expect(estimate.quota).toBe(0)
      expect(estimate.available).toBe(0)

      // Restore navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
      })
    })

    it('checks if there is space for a file', async () => {
      const storage = await getStorageModule()

      // Mock storage estimate with plenty of space
      const originalNavigator = globalThis.navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          storage: {
            estimate: vi.fn().mockResolvedValue({
              usage: 1000000,
              quota: 100000000,
            }),
          },
        },
        writable: true,
      })

      // File smaller than available space (minus 10MB buffer)
      const hasSpace = await storage.hasSpaceForFile(50000000)
      expect(hasSpace).toBe(true)

      // File larger than available space
      const noSpace = await storage.hasSpaceForFile(100000000)
      expect(noSpace).toBe(false)

      // Restore navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
      })
    })
  })
})
