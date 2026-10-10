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
      const openSpy = vi.spyOn(globalThis.indexedDB, 'open')
      const db1 = await storage.getDB()
      const db2 = await storage.getDB()
      expect(db1).toBe(db2)
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    // ESCSUITE-226: the cache used to be written only after the open resolved,
    // so two callers on first use each opened a connection and one leaked.
    it('shares one open between two callers racing on first use', async () => {
      const openSpy = vi.spyOn(globalThis.indexedDB, 'open')
      const [db1, db2] = await Promise.all([storage.getDB(), storage.getDB()])
      expect(db1).toBe(db2)
      expect(openSpy).toHaveBeenCalledTimes(1)
    })

    // ESCSUITE-226: a delete (or a future upgrade) from another page fires
    // `versionchange` on this connection; it must step aside, not block it.
    it('steps aside for a deleteDatabase from elsewhere and reopens on the next call', async () => {
      const first = await storage.getDB()
      await storage.setSetting('theme', 'dark')

      const deleted = new Promise<string>((resolve) => {
        const request = globalThis.indexedDB.deleteDatabase(storage.DB_NAME)
        request.onsuccess = () => resolve('deleted')
        request.onerror = () => resolve('error')
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        deleted,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve('still blocked'), 500)
        }),
      ])
      clearTimeout(timer)
      expect(outcome).toBe('deleted')

      // The next call opens a fresh connection, the upgrade recreates the
      // stores, and a write lands.
      const second = await storage.getDB()
      expect(second).not.toBe(first)
      expect(second.objectStoreNames.contains('settings')).toBe(true)
      expect(await storage.getSetting('theme')).toBeUndefined()
      await storage.setSetting('theme', 'light')
      expect(await storage.getSetting('theme')).toBe('light')
    })
  })

  // The hooks `idb` hands to `openDB`, driven directly: fake-indexeddb cannot
  // terminate a connection abnormally, and `blocked` needs two pages.
  describe('getDB with idb mocked', () => {
    type OpenOptions = {
      upgrade?: unknown
      blocked?: (currentVersion: number, blockedVersion: number | null, event: unknown) => void
      blocking?: (currentVersion: number, blockedVersion: number | null, event: unknown) => void
      terminated?: () => void
    }
    type FakeDB = { close: ReturnType<typeof vi.fn> }

    let opens: Array<{ options: OpenOptions; db: FakeDB }>
    let openDB: ReturnType<typeof vi.fn>
    let mocked: typeof import('./index')

    beforeEach(async () => {
      opens = []
      openDB = vi.fn((_name: string, _version: number, options: OpenOptions) => {
        const db: FakeDB = { close: vi.fn() }
        opens.push({ options, db })
        return Promise.resolve(db)
      })
      vi.doMock('idb', () => ({ openDB }))
      vi.resetModules()
      mocked = await import('./index')
    })

    afterEach(() => {
      vi.doUnmock('idb')
    })

    it('opens again after a rejected open instead of failing forever', async () => {
      openDB.mockImplementationOnce(() => Promise.reject(new Error('open failed')))

      await expect(mocked.getDB()).rejects.toThrow('open failed')
      const db = await mocked.getDB()

      expect(openDB).toHaveBeenCalledTimes(2)
      expect(db).toBe(opens[0].db)
    })

    it('reopens after the browser terminates the connection', async () => {
      const first = await mocked.getDB()
      expect(await mocked.getDB()).toBe(first)

      opens[0].options.terminated!()
      const second = await mocked.getDB()

      expect(openDB).toHaveBeenCalledTimes(2)
      expect(second).toBe(opens[1].db)
      expect(second).not.toBe(first)
    })

    it('closes the connection and reopens when another connection needs a version change', async () => {
      const first = await mocked.getDB()

      opens[0].options.blocking!(1, null, {})
      const second = await mocked.getDB()

      expect(opens[0].db.close).toHaveBeenCalledTimes(1)
      expect(openDB).toHaveBeenCalledTimes(2)
      expect(second).toBe(opens[1].db)
      expect(second).not.toBe(first)
    })

    // ESCSUITE-226 review: `close()` waits for running transactions, so a
    // browser-forced close can still reach a connection `blocking` already let
    // go of — after a newer open has replaced it in the cache.
    it('keeps the newer connection cached when a replaced one terminates late', async () => {
      await mocked.getDB()
      opens[0].options.blocking!(1, null, {})
      const second = await mocked.getDB()

      opens[0].options.terminated!()

      expect(await mocked.getDB()).toBe(second)
      expect(openDB).toHaveBeenCalledTimes(2)
    })

    // The spec sends `versionchange` only to connections not already closing,
    // so this order is not expected from a browser; the guard is kept
    // symmetric with `terminated` so neither hook can drop a cache it does
    // not own.
    it('keeps the newer connection cached when a replaced one is asked to step aside', async () => {
      await mocked.getDB()
      opens[0].options.terminated!()
      const second = await mocked.getDB()

      opens[0].options.blocking!(1, null, {})

      expect(await mocked.getDB()).toBe(second)
      expect(openDB).toHaveBeenCalledTimes(2)
      // The replaced connection still closes itself; only the cache is spared.
      expect(opens[0].db.close).toHaveBeenCalledTimes(1)
      expect(opens[1].db.close).not.toHaveBeenCalled()
    })

    it('warns once, naming the database, when its open is blocked by another tab', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await mocked.getDB()

      opens[0].options.blocked!(1, 2, {})

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('video-editor-db')
    })

    it('does not warn when the open is not blocked', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await mocked.getDB()
      expect(warn).not.toHaveBeenCalled()
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
