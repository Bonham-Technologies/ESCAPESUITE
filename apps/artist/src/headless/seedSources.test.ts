// apps/artist/src/headless/seedSources.test.ts
import { describe, it, expect } from 'vitest'
import { getVideoBlob } from '@escapesuite/shared/storage'
import { seedSources } from './seedSources'
import type { SourceVideo } from '../store/types'

describe('seedSources', () => {
  it('stores each injected source so getVideoBlob resolves it', async () => {
    const meta = { id: 'src-1', name: 'a.mp4', mimeType: 'video/mp4' } as SourceVideo
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    await seedSources([meta], { 'src-1': bytes })
    const blob = await getVideoBlob('src-1')
    expect(blob).toBeDefined()
    expect(blob!.size).toBe(4)
    expect(blob!.type).toBe('video/mp4')
  })
})
