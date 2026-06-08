// apps/artist/src/headless/seedSources.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import type { SourceVideo } from '../store/types'

// jsdom's Blob is not structured-clone-serialisable by jsdom's structuredClone
// (size/type are lost on round-trip through fake-indexeddb).  Swap in Node.js's
// native Blob so fake-indexeddb stores and retrieves it correctly.
vi.stubGlobal('Blob', NodeBlob)

// Reset IndexedDB and module singletons before each test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
})

describe('seedSources', () => {
  it('stores each injected source so getVideoBlob resolves it', async () => {
    // Dynamic imports after resetModules so both resolve the same fresh db singleton.
    const [{ getVideoBlob }, { seedSources }] = await Promise.all([
      import('@escapesuite/shared/storage'),
      import('./seedSources'),
    ])
    const meta = { id: 'src-1', name: 'a.mp4', mimeType: 'video/mp4' } as SourceVideo
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    await seedSources([meta], { 'src-1': bytes })
    const blob = await getVideoBlob('src-1')
    expect(blob).toBeDefined()
    expect(blob!.size).toBe(4)
    expect(blob!.type).toBe('video/mp4')
  })
})
