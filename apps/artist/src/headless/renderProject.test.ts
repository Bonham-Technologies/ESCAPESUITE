// apps/artist/src/headless/renderProject.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { exportToMP4, exportToWebM } = vi.hoisted(() => ({
  exportToMP4: vi.fn(async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'video/mp4' })),
  exportToWebM: vi.fn(async () => new Blob([new Uint8Array([8, 8])], { type: 'video/webm' })),
}))
vi.mock('../core/exporter', () => ({ exportToMP4, exportToWebM }))
// Stands in for the real seeding: fills the fields the probe would supply.
vi.mock('./seedSources', () => ({
  seedSources: vi.fn(async (sourceVideos: SourceVideoInput[]) => sourceVideos.map((s) => ({
    duration: 1, width: 1920, height: 1080, frameRate: 30, size: 1, mediaType: 'video', ...s,
  }))),
}))

import { renderProject, renderProjectToFile } from './renderProject'
import { seedSources } from './seedSources'
import type { RenderFileInput, RenderInput, SourceVideoInput } from './types'

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

const fileInput = (names: string[]): HTMLInputElement => {
  const input = document.createElement('input')
  input.type = 'file'
  input.id = '__sources'
  const files = names.map((n) => new File([new Uint8Array([1, 2, 3])], n, { type: 'video/mp4' }))
  Object.defineProperty(input, 'files', { value: files as unknown as FileList })
  document.body.appendChild(input)
  return input
}

const fileInputBase = (): RenderFileInput => ({
  project: baseInput().project,
  sourceVideos: [{ id: 's0', name: 'source.mp4', mimeType: 'video/mp4' }],
  sourceFiles: { s0: 'source.mp4' },
  options: { format: 'mp4' } as RenderFileInput['options'],
  outputName: 'job-1',
})

describe('renderProjectToFile', () => {
  let clicks: { download: string; href: string; inBody: boolean }[]
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    clicks = []
    // Spy rather than let jsdom follow the blob: href (it cannot, and logs a
    // "not implemented" navigation error) — the click itself is what matters.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href, inBody: document.body.contains(this) })
    })
    vi.mocked(seedSources).mockClear()
    vi.mocked(URL.createObjectURL).mockClear()
    vi.mocked(URL.revokeObjectURL).mockClear()
  })
  afterEach(() => { clickSpy.mockRestore() })

  it('resolves each source id against the file input by name and renders those bytes', async () => {
    fileInput(['other.mp4', 'source.mp4'])
    await renderProjectToFile(fileInputBase())

    expect((exportToMP4.mock.calls[0] as unknown[])[1]).toHaveLength(1)
    expect(vi.mocked(seedSources).mock.calls[0][1]).toEqual({ s0: expect.any(File) })
    expect((vi.mocked(seedSources).mock.calls[0][1].s0 as File).name).toBe('source.mp4')
  })

  it('renders with the completed sourceVideos from seedSources, not the caller\'s partial list', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    input.options = { format: 'mp4', quality: 'high', resolution: 'original' }
    const meta = await renderProjectToFile(input)

    // Only the seeded (probed) list carries width/height, which sizing depends on.
    expect(((exportToMP4.mock.calls[0] as unknown[])[1] as { width: number }[])[0].width).toBe(1920)
    expect(meta).toMatchObject({ width: 1920, height: 1080 })
  })

  it('downloads the result as outputName plus the format extension, clicked from the document', async () => {
    fileInput(['source.mp4'])
    const meta = await renderProjectToFile(fileInputBase())

    expect(clicks).toEqual([{ download: 'job-1.mp4', href: 'blob:mock-url', inBody: true }])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(meta.format).toBe('mp4')
    expect(meta.byteLength).toBe(3)
  })

  it('uses the webm extension for a webm render', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    input.options = { format: 'webm' } as RenderFileInput['options']
    await renderProjectToFile(input)
    expect(clicks[0].download).toBe('job-1.webm')
  })

  it('never revokes the download object URL, on a timer or otherwise', async () => {
    vi.useFakeTimers()
    try {
      fileInput(['source.mp4'])
      await renderProjectToFile(fileInputBase())
      // Chromium reads the Blob for as long as the download runs; a render can outlast any
      // timer, and revoking early truncates the file. The context teardown frees it instead.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60 * 60_000)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when the named file is not in the input', async () => {
    fileInput(['other.mp4'])
    await expect(renderProjectToFile(fileInputBase())).rejects.toThrow(/source "s0".*"source\.mp4"/i)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('throws when two files share the requested name', async () => {
    fileInput(['source.mp4', 'source.mp4'])
    await expect(renderProjectToFile(fileInputBase())).rejects.toThrow(/more than one file named "source\.mp4"/)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('throws when the page has no #__sources input', async () => {
    await expect(renderProjectToFile(fileInputBase())).rejects.toThrow(/#__sources/)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('rejects a clip whose source was not supplied, before any download', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).sourceVideoId = 'ghost'
    await expect(renderProjectToFile(input)).rejects.toThrow(/unknown source "ghost"/)
    expect(clicks).toHaveLength(0)
  })

  it('reports progress through the same callback as renderProject', async () => {
    fileInput(['source.mp4'])
    const seen: number[] = []
    await renderProjectToFile(fileInputBase(), (p) => seen.push(p))
    const progress = (exportToMP4.mock.calls[0] as unknown[])[3] as (e: { progress: number }) => void
    progress({ progress: 0.5 })
    expect(seen).toEqual([0.5])
  })
})
