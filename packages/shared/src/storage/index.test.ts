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

    // ESCSUITE-414: a newer tab's upgrade is not blocked storage.
    it('does not count a VersionError as storage that cannot be opened', async () => {
      const newer = new DOMException('The requested version is less than the existing version.', 'VersionError')
      openDB.mockImplementationOnce(() => Promise.reject(newer))

      const error = await mocked.getDB().catch((e: unknown) => e)

      expect(error).toBe(newer)
      expect(mocked.isStorageUnavailable(error)).toBe(false)
    })

    // Storage that works but is full keeps the quota sentence, not "blocked".
    it('does not count a QuotaExceededError as storage that cannot be opened', async () => {
      const full = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      openDB.mockImplementationOnce(() => Promise.reject(full))

      const error = await mocked.getDB().catch((e: unknown) => e)

      expect(error).toBe(full)
      expect(mocked.isStorageUnavailable(error)).toBe(false)
    })

    it('ignores a refusal that is not an object', async () => {
      openDB.mockImplementationOnce(() => Promise.reject('refused'))

      const error = await mocked.getDB().catch((e: unknown) => e)

      expect(error).toBe('refused')
      expect(mocked.isStorageUnavailable(error)).toBe(false)
    })
  })

  // ESCSUITE-414: Firefox with site data blocked, "Never remember history",
  // storage denied by policy or to an embed.
  describe('a browser that will not open the database', () => {
    const insecure = () => new DOMException('The operation is insecure.', 'SecurityError')

    it('recognises the error indexedDB.open throws, on every call that reaches storage', async () => {
      const open = vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        throw insecure()
      })

      for (const call of [
        () => storage.getDB(),
        () => storage.getAllVideoMetadata(),
        () => storage.storeVideo('a', new Blob(['a']), createMockMetadata({ id: 'a' })),
        () => storage.setSetting('k', 1),
        () => storage.listSettings('session:'),
      ]) {
        const error = await call().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(DOMException)
        expect(storage.isStorageUnavailable(error)).toBe(true)
      }
      // Never cached: each call asked the browser again.
      expect(open).toHaveBeenCalledTimes(5)
    })

    it('recognises the error a failed open request rejects with', async () => {
      const real = globalThis.indexedDB.open.bind(globalThis.indexedDB)
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((_name: string, version?: number) => {
        // A real request whose upgrade is aborted before idb hears of it.
        const request = real('escsuite-414-refused', version)
        request.addEventListener('upgradeneeded', (event) => {
          event.stopImmediatePropagation()
          request.transaction!.abort()
        })
        return request
      })

      const error = await storage.getAllVideoMetadata().catch((e: unknown) => e)

      expect((error as DOMException).name).toBe('AbortError')
      expect(storage.isStorageUnavailable(error)).toBe(true)
      // Wrapped as a cause by a caller that adds context.
      expect(storage.isStorageUnavailable(new Error('could not import', { cause: error }))).toBe(true)
    })

    it('opens normally once the browser allows it again', async () => {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementationOnce(() => {
        throw insecure()
      })

      await expect(storage.getDB()).rejects.toThrow('insecure')
      await storage.setSetting('k', 1)

      expect(await storage.getSetting('k')).toBe(1)
    })

    it('does not count a failed write in an open database', async () => {
      await storage.getDB()
      const quota = new DOMException('full', 'QuotaExceededError')
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw quota
      })

      const error = await storage.setSetting('k', 1).catch((e: unknown) => e)

      expect(error).toBe(quota)
      expect(storage.isStorageUnavailable(error)).toBe(false)
      expect(storage.isStorageUnavailable(null)).toBe(false)
      expect(storage.isStorageUnavailable(undefined)).toBe(false)
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

  // ESCSUITE-397: WebKit's ephemeral sessions (Safari Private Browsing, every
  // Playwright WebKit context) refuse to store a Blob in IndexedDB.
  describe('a browser that refuses to store a Blob', () => {
    const refusal = () =>
      new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError')

    /** Make every put() of a record holding a Blob fail as WebKit's does. */
    function refuseBlobs() {
      const put = IDBObjectStore.prototype.put
      return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (value && typeof value === 'object' && (value as { blob?: unknown }).blob instanceof Blob) {
          throw refusal()
        }
        return put.call(this, value, key)
      })
    }

    it('stores the bytes and MIME type instead, and reads them back as the same Blob', async () => {
      refuseBlobs()
      const metadata = createMockMetadata()
      await storage.storeVideo(metadata.id, new Blob(['video bytes'], { type: 'video/webm' }), metadata)
      await storage.storeThumbnail(metadata.id, new Blob(['thumb'], { type: 'image/jpeg' }))

      const row = await (await storage.getDB()).get('videos', metadata.id)
      expect(row && 'bytes' in row && row.type).toBe('video/webm')
      expect(row && 'blob' in row).toBe(false)

      const video = await storage.getVideo(metadata.id)
      expect(video?.blob).toBeInstanceOf(Blob)
      expect(video?.blob.type).toBe('video/webm')
      expect(await video?.blob.text()).toBe('video bytes')
      expect(video?.metadata).toEqual(metadata)
      expect(await (await storage.getVideoBlob(metadata.id))?.text()).toBe('video bytes')

      const thumbnail = await storage.getThumbnail(metadata.id)
      expect(thumbnail?.type).toBe('image/jpeg')
      expect(await thumbnail?.text()).toBe('thumb')
    })

    it('stops offering Blobs once one has been refused', async () => {
      const put = refuseBlobs()
      await storage.storeVideo('a', new Blob(['a']), createMockMetadata({ id: 'a' }))
      const attemptsForFirst = put.mock.calls.length
      await storage.storeVideo('b', new Blob(['b']), createMockMetadata({ id: 'b' }))
      // One refused attempt and one write for the first; one write for the second.
      expect(attemptsForFirst).toBe(2)
      expect(put.mock.calls.length).toBe(3)
    })

    it('keeps offering Blobs when the bytes could not be written either', async () => {
      // A File that changed on disk fails the same way in an ordinary session,
      // and must not switch the whole session to bytes.
      const put = refuseBlobs()
      const unreadable = new Blob(['x'])
      vi.spyOn(unreadable, 'arrayBuffer').mockRejectedValue(new DOMException('gone', 'NotReadableError'))
      await expect(storage.storeVideo('a', unreadable, createMockMetadata({ id: 'a' }))).rejects.toThrow('gone')
      put.mockRestore()

      await storage.storeVideo('b', new Blob(['b']), createMockMetadata({ id: 'b' }))
      const row = await (await storage.getDB()).get('videos', 'b')
      expect(row && 'blob' in row).toBe(true)
    })

    it('keeps reading rows stored as Blobs before the browser refused one', async () => {
      const metadata = createMockMetadata({ id: 'old' })
      await storage.storeVideo('old', new Blob(['old bytes'], { type: 'video/webm' }), metadata)
      refuseBlobs()
      await storage.storeVideo('new', new Blob(['new bytes'], { type: 'video/webm' }), createMockMetadata({ id: 'new' }))

      // A Blob row is handed back as it is. (This environment's structured clone
      // does not keep a Blob's bytes, so its contents are not compared.)
      const oldRow = await (await storage.getDB()).get('videos', 'old')
      expect(oldRow && 'blob' in oldRow).toBe(true)
      expect(await storage.getVideoBlob('old')).toEqual(oldRow && 'blob' in oldRow ? oldRow.blob : null)
      expect(await (await storage.getVideoBlob('new'))?.text()).toBe('new bytes')
    })

    it('passes any other failure through, a full quota included', async () => {
      const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw quota
      })
      await expect(storage.storeVideo('a', new Blob(['a']), createMockMetadata({ id: 'a' }))).rejects.toBe(quota)
    })

    it('sizes either shape without building a Blob', () => {
      expect(storage.storedBlobSize({ blob: new Blob(['12345']) })).toBe(5)
      expect(storage.storedBlobSize({ bytes: new ArrayBuffer(7), type: 'video/mp4' })).toBe(7)
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

  // ESCSUITE-274: ESCAPEARTIST keeps one session slot per tab, each a
  // `session:<tabId>` row in `settings`, and finds them by their prefix.
  describe('listSettings', () => {
    it('lists every row whose key starts with the prefix, key and value', async () => {
      await storage.setSetting('session:a', { n: 1 })
      await storage.setSetting('session:b', { n: 2 })
      await storage.setSetting('theme', 'dark')
      await storage.setSetting('sessions', 'not a slot')

      const rows = await storage.listSettings<{ n: number }>('session:')

      expect(rows).toEqual([
        { key: 'session:a', value: { n: 1 } },
        { key: 'session:b', value: { n: 2 } },
      ])
    })

    it('answers an empty list when no key has the prefix', async () => {
      await storage.setSetting('theme', 'dark')

      expect(await storage.listSettings('session:')).toEqual([])
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
