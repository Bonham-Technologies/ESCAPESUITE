// apps/artist/src/headless/renderProject.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { exportToMP4, exportToWebM } = vi.hoisted(() => ({
  exportToMP4: vi.fn(async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'video/mp4' })),
  exportToWebM: vi.fn(async () => new Blob([new Uint8Array([8, 8])], { type: 'video/webm' })),
}))
vi.mock('../core/exporter', () => ({ exportToMP4, exportToWebM }))
vi.mock('./seedSources', () => ({ seedSources: vi.fn(async () => {}) }))

import { renderProject } from './renderProject'
import type { RenderInput } from './types'

const baseInput = (): RenderInput => ({
  project: {
    id: 'p', name: 'n', resolution: { width: 64, height: 48 },
    timeline: { tracks: [{ id: 't0' }], clips: [{ id: 'c0', sourceVideoId: 's0' }], textOverlays: [], shapeOverlays: [], duration: 1 },
  } as unknown as RenderInput['project'],
  sourceVideos: [{ id: 's0', name: 's.mp4', mimeType: 'video/mp4', width: 1920, height: 1080 } as RenderInput['sourceVideos'][number]],
  sourceBlobs: { s0: new Uint8Array([1]).buffer },
  options: { format: 'mp4' } as RenderInput['options'],
})

beforeEach(() => { exportToMP4.mockClear(); exportToWebM.mockClear() })

describe('renderProject', () => {
  it('routes mp4 to exportToMP4 with editor arg order and returns base64 + meta', async () => {
    const res = await renderProject(baseInput())
    expect(exportToMP4).toHaveBeenCalledTimes(1)
    const args = exportToMP4.mock.calls[0] as unknown[]
    expect(args[0]).toHaveLength(1)              // clips
    expect(args[1]).toHaveLength(1)              // sourceVideos
    expect(args[4]).toEqual([{ id: 't0' }])      // tracks
    expect(args[6]).toEqual({ width: 64, height: 48 }) // projectResolution
    expect(res.meta.format).toBe('mp4')
    expect(res.meta.width).toBe(64)
    expect(res.meta.byteLength).toBe(3)
    expect(typeof res.base64).toBe('string')
  })

  it('routes webm to exportToWebM', async () => {
    const input = baseInput(); input.options = { format: 'webm' } as RenderInput['options']
    const res = await renderProject(input)
    expect(exportToWebM).toHaveBeenCalledTimes(1)
    expect(res.meta.format).toBe('webm')
  })

  it('computes durationSec from timelinePosition + duration, not from source trim bounds', async () => {
    // A clip starting at timelinePosition=5 with duration=3 ends at second 8.
    // The source trim bounds (startTime=0, endTime=3) must NOT be used — that
    // would give durationSec=3 instead of 8.
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).timelinePosition = 5
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).duration = 3
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).startTime = 0
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).endTime = 3
    const res = await renderProject(input)
    expect(res.meta.durationSec).toBe(8) // timelinePosition(5) + duration(3)
  })

  it('defaults options.resolution to project when the caller omits it', async () => {
    await renderProject(baseInput())
    const options = (exportToMP4.mock.calls[0] as unknown[])[2] as { resolution: string; format: string }
    expect(options).toMatchObject({ format: 'mp4', resolution: 'project' })
  })

  it('reports the OUTPUT size and duration when a resolution preset and timeRange are given', async () => {
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).timelinePosition = 0
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).duration = 10
    input.options = { format: 'mp4', quality: 'high', resolution: '720p', timeRange: { start: 2, end: 5 } }
    const res = await renderProject(input)
    expect(res.meta).toMatchObject({ width: 1280, height: 720, durationSec: 3 })
    // and the engine received the same options untouched
    expect(((exportToMP4.mock.calls[0] as unknown[])[2] as { timeRange: unknown }).timeRange).toEqual({ start: 2, end: 5 })
  })

  it('rejects a clip whose sourceVideoId is not in sourceVideos instead of rendering black', async () => {
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).sourceVideoId = 'ghost'
    await expect(renderProject(input)).rejects.toThrow(/unknown source "ghost"/)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('rejects a referenced source that has no bytes in sourceBlobs', async () => {
    const input = baseInput()
    input.sourceBlobs = {}
    await expect(renderProject(input)).rejects.toThrow(/no bytes in sourceBlobs/)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('ignores overlay clips during validation', async () => {
    const input = baseInput()
    ;(input.project.timeline.clips as unknown as Record<string, unknown>[]).push({ id: 'txt', sourceVideoId: '', overlayType: 'text', timelinePosition: 0, duration: 1 })
    await expect(renderProject(input)).resolves.toBeTruthy()
  })
})
