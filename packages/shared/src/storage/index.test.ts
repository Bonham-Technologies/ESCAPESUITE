import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { SourceVideo } from '../types'

// storage caches the db instance at module level, so reset modules and
// IndexedDB before each test to get a truly fresh database.
let storage: typeof import('./index')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  storage = await import('./index')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const createMockMetadata = (overrides: Partial<SourceVideo> = {}): SourceVideo => ({
  id: 'test-video-1',
  name: 'Test Recording',
  duration: 60,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/webm',
  size: 1024 * 1024 * 10,
  ...overrides,
})

describe('storage', () => {
  describe('getDB', () => {
    it('creates all object stores on first open', async () => {
      const db = await storage.getDB()
      expect(db.objectStoreNames.contains('videos')).toBe(true)
      expect(db.objectStoreNames.contains('thumbnails')).toBe(true)
      expect(db.objectStoreNames.contains('projects')).toBe(true)
      expect(db.objectStoreNames.contains('settings')).toBe(true)
    })

    it('returns the cached singleton on subsequent calls', async () => {
      const db1 = await storage.getDB()
      const db2 = await storage.getDB()
      expect(db1).toBe(db2)
    })
  })

  describe('video operations', () => {
    it('stores and retrieves a video', async () => {
      const blob = new Blob(['test video data'], { type: 'video/webm' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, blob, metadata)
      const result = await storage.getVideo(metadata.id)

      expect(result).toBeDefined()
      expect(result?.blob).toBeDefined()
      expect(result?.metadata.id).toBe(metadata.id)
      expect(result?.metadata.name).toBe(metadata.name)
    })

    it('returns undefined for a non-existent video', async () => {
      const result = await storage.getVideo('non-existent-id')
      expect(result).toBeUndefined()
    })

    it('retrieves only the blob via getVideoBlob', async () => {
      const blob = new Blob(['test data'], { type: 'video/webm' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, blob, metadata)
      const result = await storage.getVideoBlob(metadata.id)

      expect(result).toBeDefined()
    })

    it('returns undefined blob for a non-existent video', async () => {
      const result = await storage.getVideoBlob('non-existent-id')
      expect(result).toBeUndefined()
    })

    it('retrieves all video metadata', async () => {
      const blob = new Blob(['data'], { type: 'video/webm' })

      await storage.storeVideo('video-1', blob, createMockMetadata({ id: 'video-1', name: 'Video 1' }))
      await storage.storeVideo('video-2', blob, createMockMetadata({ id: 'video-2', name: 'Video 2' }))

      const all = await storage.getAllVideoMetadata()

      expect(all).toHaveLength(2)
      expect(all.map(m => m.name).sort()).toEqual(['Video 1', 'Video 2'])
    })

    it('returns an empty array when there are no videos', async () => {
      const all = await storage.getAllVideoMetadata()
      expect(all).toEqual([])
    })

    it('deletes a video and its thumbnail', async () => {
      const videoBlob = new Blob(['video'], { type: 'video/webm' })
      const thumbBlob = new Blob(['thumb'], { type: 'image/png' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, videoBlob, metadata)
      await storage.storeThumbnail(metadata.id, thumbBlob)

      await storage.deleteVideo(metadata.id)

      expect(await storage.getVideo(metadata.id)).toBeUndefined()
      expect(await storage.getThumbnail(metadata.id)).toBeUndefined()
    })
  })

  describe('thumbnail operations', () => {
    it('stores and retrieves a thumbnail', async () => {
      const blob = new Blob(['thumbnail data'], { type: 'image/png' })

      await storage.storeThumbnail('thumb-1', blob)
      const result = await storage.getThumbnail('thumb-1')

      expect(result).toBeDefined()
    })

    it('returns undefined for a non-existent thumbnail', async () => {
      const result = await storage.getThumbnail('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('settings operations', () => {
    it('stores and retrieves a setting', async () => {
      await storage.setSetting('theme', 'dark')
      const result = await storage.getSetting<string>('theme')
      expect(result).toBe('dark')
    })

    it('returns undefined for a non-existent setting', async () => {
      const result = await storage.getSetting('missing')
      expect(result).toBeUndefined()
    })

    it('overwrites an existing setting', async () => {
      await storage.setSetting('theme', 'dark')
      await storage.setSetting('theme', 'light')
      const result = await storage.getSetting<string>('theme')
      expect(result).toBe('light')
    })
  })

  describe('getStorageEstimate', () => {
    afterEach(() => {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    })

    it('computes used/quota/available when navigator.storage.estimate is present', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: vi.fn().mockResolvedValue({ usage: 1000, quota: 5000 }) },
        configurable: true,
      })

      const estimate = await storage.getStorageEstimate()

      expect(estimate).toEqual({ used: 1000, quota: 5000, available: 4000 })
    })

    it('defaults usage/quota to 0 when the estimate omits them', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: vi.fn().mockResolvedValue({}) },
        configurable: true,
      })

      const estimate = await storage.getStorageEstimate()

      expect(estimate).toEqual({ used: 0, quota: 0, available: 0 })
    })

    it('returns all zeros when navigator.storage is unavailable', async () => {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })

      const estimate = await storage.getStorageEstimate()

      expect(estimate).toEqual({ used: 0, quota: 0, available: 0 })
    })
  })

  describe('blob URL utilities', () => {
    it('creates a blob URL via URL.createObjectURL', () => {
      const createSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:mock-url')
      const blob = new Blob(['data'])

      const url = storage.createBlobUrl(blob)

      expect(url).toBe('blob:mock-url')
      expect(createSpy).toHaveBeenCalledWith(blob)
    })

    it('revokes a blob URL via URL.revokeObjectURL', () => {
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      storage.revokeBlobUrl('blob:mock-url')

      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url')
    })
  })
})
