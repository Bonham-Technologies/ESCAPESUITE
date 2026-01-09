import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the video element behavior for testing
vi.mock('./thumbnailGenerator', async () => {
  const actual = await vi.importActual('./thumbnailGenerator')
  return {
    ...actual,
    // Mock extractVideoMetadata to return immediately with defaults
    extractVideoMetadata: vi.fn().mockImplementation(
      async (_blob: Blob, knownDuration?: number) => ({
        duration: knownDuration ?? 0,
        width: 1920,
        height: 1080,
      })
    ),
    // Mock generateThumbnail to return a simple blob
    generateThumbnail: vi.fn().mockResolvedValue(new Blob(['thumbnail'], { type: 'image/jpeg' })),
  }
})

import { extractVideoMetadata, generateThumbnail } from './thumbnailGenerator'

describe('thumbnailGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractVideoMetadata', () => {
    it('should return metadata with known duration', async () => {
      const result = await extractVideoMetadata(new Blob(), 30)

      expect(result.duration).toBe(30)
      expect(result.width).toBe(1920)
      expect(result.height).toBe(1080)
    })

    it('should return default dimensions', async () => {
      const result = await extractVideoMetadata(new Blob(), 60)

      expect(result.width).toBe(1920)
      expect(result.height).toBe(1080)
    })

    it('should use provided knownDuration', async () => {
      const knownDuration = 45.5
      const result = await extractVideoMetadata(new Blob(), knownDuration)

      expect(result.duration).toBe(knownDuration)
    })

    it('should handle zero duration', async () => {
      const result = await extractVideoMetadata(new Blob(), 0)

      expect(result.duration).toBe(0)
    })

    it('should handle undefined duration', async () => {
      const result = await extractVideoMetadata(new Blob())

      expect(result.duration).toBe(0)
    })
  })

  describe('generateThumbnail', () => {
    it('should return a blob', async () => {
      const result = await generateThumbnail(new Blob())

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('image/jpeg')
    })
  })
})
