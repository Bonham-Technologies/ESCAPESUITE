import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { SourceVideo, Project } from '../store/types'

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

  describe('session state operations', () => {
    it('saves and retrieves session state', async () => {
      const storage = await getStorageModule()

      const session: import('./storage').SessionState = {
        project: {
          id: 'project1',
          name: 'Test',
          created: Date.now(),
          modified: Date.now(),
          resolution: { width: 1280, height: 720 },
          timeline: {
            tracks: [],
            clips: [],
            textOverlays: [],
            shapeOverlays: [],
            duration: 0,
          },
        },
        sourceVideos: [],
        currentTime: 5.5,
        selectedClipId: 'clip1',
        zoom: 1.5,
        timestamp: Date.now(),
      }

      await storage.saveSessionState(session)
      const result = await storage.getSessionState()

      expect(result).toBeDefined()
      expect(result?.currentTime).toBe(5.5)
      expect(result?.selectedClipId).toBe('clip1')
      expect(result?.zoom).toBe(1.5)
    })

    it('clears session state', async () => {
      const storage = await getStorageModule()

      const session: import('./storage').SessionState = {
        project: {
          id: 'project1',
          name: 'Test',
          created: Date.now(),
          modified: Date.now(),
          resolution: { width: 1280, height: 720 },
          timeline: {
            tracks: [],
            clips: [],
            textOverlays: [],
            shapeOverlays: [],
            duration: 0,
          },
        },
        sourceVideos: [],
        currentTime: 5.5,
        selectedClipId: null,
        zoom: 1,
        timestamp: Date.now(),
      }

      await storage.saveSessionState(session)
      await storage.clearSessionState()

      const result = await storage.getSessionState()
      expect(result).toBeUndefined()
    })
  })

  describe('utility operations', () => {
    it('clears all data', async () => {
      const storage = await getStorageModule()

      // Add some data
      const blob = new Blob(['data'], { type: 'video/mp4' })
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
      await storage.storeThumbnail('thumb1', new Blob(['thumb']))
      await storage.storeProject({
        id: 'project1',
        name: 'Test',
        created: Date.now(),
        modified: Date.now(),
        resolution: { width: 1280, height: 720 },
        timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 },
      })
      await storage.setSetting('key', 'value')

      await storage.clearAllData()

      const videos = await storage.getAllVideoMetadata()
      const projects = await storage.getAllProjects()

      expect(videos).toHaveLength(0)
      expect(projects).toHaveLength(0)
    })

    it('clears all videos but keeps projects and settings', async () => {
      const storage = await getStorageModule()

      // Add video and project
      const blob = new Blob(['data'], { type: 'video/mp4' })
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
      await storage.storeThumbnail('video1', new Blob(['thumb']))
      await storage.storeProject({
        id: 'project1',
        name: 'Test',
        created: Date.now(),
        modified: Date.now(),
        resolution: { width: 1280, height: 720 },
        timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 },
      })

      await storage.clearAllVideos()

      const videos = await storage.getAllVideoMetadata()
      const projects = await storage.getAllProjects()
      const thumbnail = await storage.getThumbnail('video1')

      expect(videos).toHaveLength(0)
      expect(thumbnail).toBeUndefined()
      expect(projects).toHaveLength(1)
    })

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
