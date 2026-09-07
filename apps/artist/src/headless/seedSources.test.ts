// apps/artist/src/headless/seedSources.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getVideo, getVideoBlob } from '@escapesuite/shared/storage'
import { seedSources } from './seedSources'
import type { SourceVideo } from '../store/types'
import type { SourceVideoInput } from './types'

// The probe drives <video>/<audio>/<img> elements, which jsdom cannot decode.
const { extractMetadataFromBlob } = vi.hoisted(() => ({
  extractMetadataFromBlob: vi.fn(
    async (blob: Blob, saved: { id: string; name: string; mimeType: string }): Promise<SourceVideo> => ({
      ...saved,
      duration: 2,
      width: 320,
      height: 240,
      frameRate: 30,
      size: blob.size,
      mediaType: 'video',
    }),
  ),
}))
vi.mock('../core/projectManager', () => ({ extractMetadataFromBlob }))

const complete = (over: Partial<SourceVideo> = {}): SourceVideo => ({
  id: 'src-1', name: 'a.mp4', mimeType: 'video/mp4',
  duration: 1, width: 64, height: 48, frameRate: 25, size: 4, mediaType: 'video',
  ...over,
})

beforeEach(() => { extractMetadataFromBlob.mockClear() })

describe('seedSources', () => {
  it('stores each injected source so getVideoBlob resolves it', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    await seedSources([complete()], { 'src-1': bytes })
    const blob = await getVideoBlob('src-1')
    expect(blob).toBeDefined()
    expect(blob!.size).toBe(4)
    expect(blob!.type).toBe('video/mp4')
  })

  it('stores a Blob source as-is rather than rebuilding it', async () => {
    // A rebuilt Blob would carry meta.mimeType; storing the given Blob keeps its own type.
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'video/webm' })
    await seedSources([complete({ id: 'src-blob', mimeType: 'video/mp4' })], { 'src-blob': blob })
    const stored = await getVideoBlob('src-blob')
    expect(stored!.type).toBe('video/webm')
    expect(stored!.size).toBe(2)
  })

  it('throws when a source has no bytes', async () => {
    await expect(seedSources([complete()], {})).rejects.toThrow(/Missing source bytes for id "src-1"/)
  })

  it('does not probe a source whose metadata is already complete', async () => {
    const result = await seedSources([complete()], { 'src-1': new Uint8Array([1, 2, 3, 4]).buffer })
    expect(extractMetadataFromBlob).not.toHaveBeenCalled()
    expect(result).toEqual([complete()])
  })

  it('probes a source with missing fields and lets provided fields win', async () => {
    const partial: SourceVideoInput = { id: 'src-2', name: 'b.mp4', mimeType: 'video/mp4', frameRate: 12 }
    const result = await seedSources([partial], { 'src-2': new Uint8Array([1, 2, 3, 4]).buffer })

    expect(extractMetadataFromBlob).toHaveBeenCalledTimes(1)
    expect(extractMetadataFromBlob.mock.calls[0][1]).toEqual({ id: 'src-2', name: 'b.mp4', mimeType: 'video/mp4' })
    expect(result[0]).toEqual({
      id: 'src-2', name: 'b.mp4', mimeType: 'video/mp4',
      duration: 2, width: 320, height: 240, mediaType: 'video', size: 4,
      frameRate: 12, // caller-provided value survives the probe
    })
    // the completed metadata is what lands in storage
    const record = await getVideo('src-2')
    expect(record!.metadata.width).toBe(320)
  })

  it('does not probe a video source that supplied width/height/duration but no mediaType', async () => {
    // The README's promise: supplying the dimensions and duration saves the probe. A video/*
    // mime type already says mediaType is 'video', so nothing is left to look up — and probing
    // here would fail outright on a source <video> refuses but WebCodecs can decode.
    const meta: SourceVideoInput = {
      id: 'src-3', name: 'c.mp4', mimeType: 'video/mp4',
      width: 1920, height: 1080, duration: 12, frameRate: 30, size: 9,
    }
    const result = await seedSources([meta], { 'src-3': new Uint8Array([1, 2, 3, 4]).buffer })

    expect(extractMetadataFromBlob).not.toHaveBeenCalled()
    expect(result[0]).toEqual({ ...meta, mediaType: 'video' })
    const record = await getVideo('src-3')
    expect(record!.metadata.mediaType).toBe('video')
  })

  it('probes a source whose mime type does not imply its media type', async () => {
    const meta: SourceVideoInput = {
      id: 'src-img', name: 'c.png', mimeType: 'image/png', width: 800, height: 600, duration: 0,
    }
    await seedSources([meta], { 'src-img': new Uint8Array([1]).buffer })

    expect(extractMetadataFromBlob).toHaveBeenCalledTimes(1)
  })

  it('probes only the incomplete sources in a mixed batch', async () => {
    await seedSources(
      [complete({ id: 'ok' }), { id: 'partial', name: 'p.mp4', mimeType: 'video/mp4' }],
      { ok: new Uint8Array([1]).buffer, partial: new Uint8Array([2]).buffer },
    )
    expect(extractMetadataFromBlob).toHaveBeenCalledTimes(1)
    expect(extractMetadataFromBlob.mock.calls[0][1].id).toBe('partial')
  })
})
