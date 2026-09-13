import { describe, it, expect, vi, afterEach } from 'vitest'
import { drawThumbnail, createPlaceholderThumbnail, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from './previewThumbnail'
import { getLastCanvasContext, resetCanvasContextDouble, type RecordingCanvasRenderingContext2D } from '../test/doubles/canvas'

describe('drawThumbnail', () => {
  afterEach(() => {
    resetCanvasContextDouble()
    vi.restoreAllMocks()
  })

  it('draws the source into a 320x180 canvas and resolves with the encoded blob', async () => {
    const source = document.createElement('canvas')
    const result = drawThumbnail(source)

    expect(result).not.toBeNull()
    const ctx = getLastCanvasContext()!
    expect(ctx.canvas.width).toBe(THUMBNAIL_WIDTH)
    expect(ctx.canvas.height).toBe(THUMBNAIL_HEIGHT)
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 320, 180)
    expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])

    const blob = await result
    expect(blob).toBe(ctx.toBlobResult)
  })

  it('returns null synchronously when no 2D context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null)

    const result = drawThumbnail(document.createElement('canvas'))

    expect(result).toBeNull()
  })

  it('returns null synchronously when drawImage throws', () => {
    const source = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d') as unknown as RecordingCanvasRenderingContext2D
    ctx.drawImage.mockImplementationOnce(() => {
      throw new Error('draw failed')
    })
    vi.spyOn(document, 'createElement').mockReturnValueOnce(canvas)

    const result = drawThumbnail(source)

    expect(result).toBeNull()
  })

  it('resolves null when the browser produces no blob', async () => {
    const source = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d') as unknown as RecordingCanvasRenderingContext2D
    ctx.toBlobResult = null
    vi.spyOn(document, 'createElement').mockReturnValueOnce(canvas)

    const result = drawThumbnail(source)

    expect(result).not.toBeNull()
    await expect(result).resolves.toBeNull()
  })
})

describe('createPlaceholderThumbnail', () => {
  afterEach(() => {
    resetCanvasContextDouble()
    vi.restoreAllMocks()
  })

  it('fills the background before drawing the label, and always resolves with a blob', async () => {
    const blob = await createPlaceholderThumbnail()

    const ctx = getLastCanvasContext()!
    expect(ctx.canvas.width).toBe(THUMBNAIL_WIDTH)
    expect(ctx.canvas.height).toBe(THUMBNAIL_HEIGHT)
    expect(ctx.calls.map((c) => c.method)).toEqual(['fillRect', 'fillText'])
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 320, 180)
    expect(ctx.fillText).toHaveBeenCalledWith('Recording', 160, 95)
    expect(ctx.toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.8 }])
    expect(blob).toBeInstanceOf(Blob)
  })

  it('skips drawing (but still resolves) when no 2D context is available', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null)

    const blob = await createPlaceholderThumbnail()

    expect(blob).toBeInstanceOf(Blob)
  })

  it('falls back to an empty Blob when the browser produces no blob', async () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d') as unknown as RecordingCanvasRenderingContext2D
    ctx.toBlobResult = null
    vi.spyOn(document, 'createElement').mockReturnValueOnce(canvas)

    const blob = await createPlaceholderThumbnail()

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(0)
  })
})
