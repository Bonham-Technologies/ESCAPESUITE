import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { SourceVideo } from '../store/types'

// We need to dynamically import storage after resetting IndexedDB
// because it caches the db instance at module level
let storage: typeof import('./storage')

// Reset IndexedDB before each test
beforeEach(async () => {
  // Use fresh IndexedDB instance
  globalThis.indexedDB = new IDBFactory()

  // Clear module cache and reimport
  vi.resetModules()
  storage = await import('./storage')
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
  type: 'video/webm',
  size: 1024 * 1024 * 10, // 10MB
  createdAt: Date.now(),
  source: 'recording',
  thumbnailUrl: 'blob:thumbnail-url',
  ...overrides,
})

describe('storage', () => {
  describe('video operations', () => {
    it('stores and retrieves a video', async () => {
      const blob = new Blob(['test video data'], { type: 'video/webm' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, blob, metadata)
      const result = await storage.getVideo(metadata.id)

      expect(result).toBeDefined()
      // fake-indexeddb doesn't preserve Blob type perfectly, check for blob-like properties
      expect(result?.blob).toBeDefined()
      expect(result?.metadata.id).toBe(metadata.id)
      expect(result?.metadata.name).toBe(metadata.name)
    })

    it('returns undefined for non-existent video', async () => {
      const result = await storage.getVideo('non-existent-id')
      expect(result).toBeUndefined()
    })

    it('retrieves only the blob', async () => {
      const blob = new Blob(['test data'], { type: 'video/webm' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, blob, metadata)
      const result = await storage.getVideoBlob(metadata.id)

      expect(result).toBeDefined()
    })

    it('returns undefined blob for non-existent video', async () => {
      const result = await storage.getVideoBlob('non-existent-id')
      expect(result).toBeUndefined()
    })

    it('updates existing video when storing with same id', async () => {
      const blob1 = new Blob(['first'], { type: 'video/webm' })
      const blob2 = new Blob(['second, longer'], { type: 'video/webm' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, blob1, metadata)
      await storage.storeVideo(metadata.id, blob2, { ...metadata, name: 'Updated' })

      const result = await storage.getVideo(metadata.id)
      expect(result?.metadata.name).toBe('Updated')
    })

    it('deletes a video and its thumbnail', async () => {
      const videoBlob = new Blob(['video'], { type: 'video/webm' })
      const thumbBlob = new Blob(['thumb'], { type: 'image/png' })
      const metadata = createMockMetadata()

      await storage.storeVideo(metadata.id, videoBlob, metadata)
      await storage.storeThumbnail(metadata.id, thumbBlob)

      await storage.deleteVideo(metadata.id)

      const video = await storage.getVideo(metadata.id)
      const thumbnail = await storage.getThumbnail(metadata.id)

      expect(video).toBeUndefined()
      expect(thumbnail).toBeUndefined()
    })
  })

  describe('metadata operations', () => {
    it('retrieves all video metadata', async () => {
      const blob = new Blob(['data'], { type: 'video/webm' })

      await storage.storeVideo('video-1', blob, createMockMetadata({ id: 'video-1', name: 'Video 1' }))
      await storage.storeVideo('video-2', blob, createMockMetadata({ id: 'video-2', name: 'Video 2' }))
      await storage.storeVideo('video-3', blob, createMockMetadata({ id: 'video-3', name: 'Video 3' }))

      const allMetadata = await storage.getAllVideoMetadata()

      expect(allMetadata).toHaveLength(3)
      expect(allMetadata.map(m => m.name)).toContain('Video 1')
      expect(allMetadata.map(m => m.name)).toContain('Video 2')
      expect(allMetadata.map(m => m.name)).toContain('Video 3')
    })

    it('filters recordings only', async () => {
      const blob = new Blob(['data'], { type: 'video/webm' })

      await storage.storeVideo('rec-1', blob, createMockMetadata({ id: 'rec-1', source: 'recording' }))
      await storage.storeVideo('imp-1', blob, createMockMetadata({ id: 'imp-1', source: 'import' }))
      await storage.storeVideo('rec-2', blob, createMockMetadata({ id: 'rec-2', source: 'recording' }))

      const recordings = await storage.getRecordingsMetadata()

      expect(recordings).toHaveLength(2)
      expect(recordings.every(r => r.source === 'recording')).toBe(true)
    })
  })

  describe('thumbnail operations', () => {
    it('stores and retrieves a thumbnail', async () => {
      const blob = new Blob(['thumbnail data'], { type: 'image/png' })

      await storage.storeThumbnail('thumb-1', blob)
      const result = await storage.getThumbnail('thumb-1')

      expect(result).toBeDefined()
    })

    it('returns undefined for non-existent thumbnail', async () => {
      const result = await storage.getThumbnail('non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('blob URL operations', () => {
    it('creates a blob URL', () => {
      const blob = new Blob(['data'])
      const url = storage.createBlobUrl(blob)
      expect(url).toBe('blob:mock-url')
    })

    it('revokes a blob URL', () => {
      storage.revokeBlobUrl('blob:some-url')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:some-url')
    })
  })
})
