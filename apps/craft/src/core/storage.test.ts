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

  describe('getTotalRecordingsSize', () => {
    it('sums the size of recording-sourced blobs only', async () => {
      // fake-indexeddb doesn't preserve Blob through structured clone (size
      // comes back undefined), so write raw records with a `.size` field
      // directly rather than round-tripping a real Blob through storeVideo.
      const db = await storage.getDB()
      await db.put('videos', {
        id: 'rec-1',
        blob: { size: 100 } as unknown as Blob,
        metadata: createMockMetadata({ id: 'rec-1', source: 'recording' }),
      })
      await db.put('videos', {
        id: 'rec-2',
        blob: { size: 250 } as unknown as Blob,
        metadata: createMockMetadata({ id: 'rec-2', source: 'recording' }),
      })
      await db.put('videos', {
        id: 'imp-1',
        blob: { size: 5000 } as unknown as Blob,
        metadata: createMockMetadata({ id: 'imp-1', source: 'import' }),
      })

      const total = await storage.getTotalRecordingsSize()

      expect(total).toBe(350)
    })

    it('returns 0 for an empty database', async () => {
      const total = await storage.getTotalRecordingsSize()
      expect(total).toBe(0)
    })

    it('treats a missing blob as zero size', async () => {
      const db = await storage.getDB()
      await db.put('videos', {
        id: 'rec-no-blob',
        blob: undefined as unknown as Blob,
        metadata: createMockMetadata({ id: 'rec-no-blob', source: 'recording' }),
      })

      const total = await storage.getTotalRecordingsSize()

      expect(total).toBe(0)
    })
  })

  describe('clearAllRecordings', () => {
    it('deletes recording videos and their thumbnails, leaving imports intact', async () => {
      const blob = new Blob(['data'], { type: 'video/webm' })
      const thumb = new Blob(['thumb'], { type: 'image/png' })

      await storage.storeVideo('rec-1', blob, createMockMetadata({ id: 'rec-1', source: 'recording' }))
      await storage.storeThumbnail('rec-1', thumb)
      await storage.storeVideo('imp-1', blob, createMockMetadata({ id: 'imp-1', source: 'import' }))
      await storage.storeThumbnail('imp-1', thumb)

      await storage.clearAllRecordings()

      expect(await storage.getVideo('rec-1')).toBeUndefined()
      expect(await storage.getThumbnail('rec-1')).toBeUndefined()
      expect(await storage.getVideo('imp-1')).toBeDefined()
      expect(await storage.getThumbnail('imp-1')).toBeDefined()
    })

    it('does nothing on an empty database', async () => {
      await expect(storage.clearAllRecordings()).resolves.toBeUndefined()
    })
  })

  describe('hasSpaceForRecording', () => {
    afterEach(() => {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    })

    it('returns true when available space comfortably exceeds the buffer', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1024 * 1024 * 1024 }) }, // 1GB quota
        configurable: true,
      })

      const result = await storage.hasSpaceForRecording(1024 * 1024) // 1MB recording
      expect(result).toBe(true)
    })

    it('returns false when available space is within the 50MB buffer', async () => {
      const quota = 60 * 1024 * 1024 // 60MB quota, no usage
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: vi.fn().mockResolvedValue({ usage: 0, quota }) },
        configurable: true,
      })

      // 20MB recording + 50MB buffer > 60MB available
      const result = await storage.hasSpaceForRecording(20 * 1024 * 1024)
      expect(result).toBe(false)
    })

    it('returns false exactly at the buffer boundary', async () => {
      const estimatedSize = 10 * 1024 * 1024
      const quota = estimatedSize + 50 * 1024 * 1024 // available === estimatedSize + buffer
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: vi.fn().mockResolvedValue({ usage: 0, quota }) },
        configurable: true,
      })

      const result = await storage.hasSpaceForRecording(estimatedSize)
      expect(result).toBe(false)
    })

    it('returns false when the Storage API is unavailable', async () => {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })

      const result = await storage.hasSpaceForRecording(1024)
      expect(result).toBe(false)
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
