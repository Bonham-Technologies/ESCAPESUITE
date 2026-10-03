// apps/artist/src/headless/renderProject.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { exportToMP4, exportToWebM, exportToGIF } = vi.hoisted(() => ({
  // ESCSUITE-175: the three exporters return `{ blob, audio }` now, not a bare
  // Blob — `audio` says whether the project's sound was dropped on the way out.
  exportToMP4: vi.fn(async () => ({ blob: new Blob([new Uint8Array([9, 9, 9])], { type: 'video/mp4' }), audio: true })),
  exportToWebM: vi.fn(async () => ({ blob: new Blob([new Uint8Array([8, 8])], { type: 'video/webm' }), audio: true })),
  exportToGIF: vi.fn(async () => ({ blob: new Blob([new Uint8Array([7])], { type: 'image/gif' }), audio: false })),
}))
vi.mock('../core/exporter', () => ({ exportToMP4, exportToWebM, exportToGIF }))
// Stands in for the real seeding: fills the fields the probe would supply.
vi.mock('./seedSources', () => ({
  seedSources: vi.fn(async (sourceVideos: SourceVideoInput[]) => sourceVideos.map((s) => ({
    duration: 1, width: 1920, height: 1080, frameRate: 30, size: 1, mediaType: 'video', ...s,
  }))),
}))

import { renderProject, renderProjectToFile } from './renderProject'
import { seedSources } from './seedSources'
import type { RenderFileInput, RenderInput, SourceVideoInput } from './types'
import type { Clip, TextOverlay } from '../store/types'
import { lastObjectUrl } from '../test/objectUrls'

/** A legacy text overlay as an older ARTIST version stored it, on the timeline's array. */
const legacyText = (): TextOverlay => ({
  id: 'legacy1', text: 'Legacy', startTime: 1, endTime: 3, x: 0.25, y: 0.5, opacity: 0.5,
  fontFamily: 'Arial', fontSize: 48, fontWeight: 'normal', fontStyle: 'normal',
  color: '#ffffff', backgroundColor: '#00000000', textAlign: 'center',
})

const baseInput = (): RenderInput => ({
  project: {
    id: 'p', name: 'n', resolution: { width: 64, height: 48 },
    timeline: { tracks: [{ id: 't0' }], clips: [{ id: 'c0', sourceVideoId: 's0', trackId: 't0' }], textOverlays: [], shapeOverlays: [], duration: 1 },
  } as unknown as RenderInput['project'],
  sourceVideos: [{ id: 's0', name: 's.mp4', mimeType: 'video/mp4', width: 1920, height: 1080 } as RenderInput['sourceVideos'][number]],
  sourceBlobs: { s0: new Uint8Array([1]).buffer },
  options: { format: 'mp4' } as RenderInput['options'],
})

beforeEach(() => { exportToMP4.mockClear(); exportToWebM.mockClear(); exportToGIF.mockClear() })

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

  it('routes gif to exportToGIF, carrying the frame rate through', async () => {
    const input = baseInput()
    input.options = { format: 'gif', fps: 20 } as RenderInput['options']
    const res = await renderProject(input)

    expect(exportToGIF).toHaveBeenCalledTimes(1)
    expect(exportToMP4).not.toHaveBeenCalled()
    expect((exportToGIF.mock.calls[0] as unknown[])[2]).toMatchObject({ format: 'gif', fps: 20 })
    expect(res.meta.format).toBe('gif')
  })

  it('reports a GIF durationSec in the frame delays the file stores, not the requested range', async () => {
    // A GIF's on-screen time per frame is stored in **centiseconds**, so there are
    // two roundings between a frame rate and a duration: the exporter asks for
    // `round(1000 / 15) = 67` ms and `gifenc` writes `round(67 / 10) = 7` cs = 70 ms.
    // A one-second range at 15 fps is therefore 15 frames of 70 ms = 1.05 s of GIF
    // — a 5% stretch, not the 0.5% that stopping at the first rounding suggests.
    // The verification manifest describes the bytes, and `ffprobe` will say 1.05.
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).timelinePosition = 0
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).duration = 1
    input.options = { format: 'gif', fps: 15 } as RenderInput['options']

    const res = await renderProject(input)

    expect(res.meta.durationSec).toBeCloseTo(1.05, 6)
  })

  it('reports a GIF durationSec of exactly the range at a rate the container can store', async () => {
    // 20 fps is 50 ms, a whole number of centiseconds, so both roundings are
    // identities and the GIF plays for exactly the second it was asked for. The
    // inexact case above and this one together are what keep the duration honest:
    // a single-rate assertion cannot tell 67 ms from 70 ms.
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).timelinePosition = 0
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).duration = 1
    input.options = { format: 'gif', fps: 20 } as RenderInput['options']

    const res = await renderProject(input)

    expect(res.meta.durationSec).toBe(1)
  })

  it('takes the GIF frame rate from the exporter\'s own default when the job asks for none', async () => {
    // `gifFrameRate` owns that default (15); the headless path must not invent a
    // second one, or the manifest would describe a render nobody made.
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).timelinePosition = 0
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).duration = 1
    input.options = { format: 'gif' } as RenderInput['options']

    const res = await renderProject(input)

    expect(res.meta.durationSec).toBeCloseTo(1.05, 6)
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
    // The kit renders through the editor's own exporters, so ESCSUITE-94 reaches
    // it for free — including the half of that fix that lives in
    // `getResolution`. A preset's height is fixed and its width follows the
    // **project's** aspect: this project is 64x48 (4:3), so 720p is 960x720. It
    // used to take the aspect from the bottom clip's source (1920x1080) and
    // report 1280x720 — a 16:9 file for a 4:3 project, which the exporter then
    // pillarboxed. The manifest and the bytes have to agree, and both now do.
    expect(res.meta).toMatchObject({ width: 960, height: 720, durationSec: 3 })
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
    ;(input.project.timeline.clips as unknown as Record<string, unknown>[]).push({ id: 'txt', sourceVideoId: '', overlayType: 'text', timelinePosition: 0, duration: 1, trackId: 't0' })
    await expect(renderProject(input)).resolves.toBeTruthy()
  })

  it('rejects a malformed crop through parseProject instead of silently dropping the clip (ESCSUITE-173)', async () => {
    // Before this, `validateInput` checked sources only: a crop of the wrong
    // shape reached `croppedSourceRect` as NaN and the clip was quietly
    // omitted from an unattended render rather than failing the job.
    const input = baseInput()
    ;(input.project.timeline.clips[0] as unknown as Record<string, unknown>).crop = {
      left: -1, top: 0, right: 0, bottom: 0,
    }
    await expect(renderProject(input)).rejects.toThrow(/invalid crop/i)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('rejects a project with a duplicate clip id instead of rendering whichever one won (ESCSUITE-173)', async () => {
    const input = baseInput()
    ;(input.project.timeline.clips as unknown as Record<string, unknown>[]).push({
      id: 'c0', sourceVideoId: 's0', trackId: 't0',
    })
    await expect(renderProject(input)).rejects.toThrow(/duplicate clip id/i)
    expect(exportToMP4).not.toHaveBeenCalled()
  })

  it('does not adopt the migration\'s 1920x1080 default for a project with no resolution of its own (MAJOR 1 / ESCSUITE-173)', async () => {
    // `parseProject`'s migration (`ensureTimelineHasTracks`) fills a MISSING
    // `resolution` in with 1920x1080 — the editor's own default. The headless
    // path never ran that migration before this ticket, and a resolution-less
    // job instead fell back to `getResolution('project', …)`'s OTHER path:
    // the source's own native size — the documented kit contract. A 640x480
    // source makes the two outcomes unmistakable (1920x1080 is also this
    // fixture's OTHER plausible-looking number, so it would not bite).
    const input = baseInput()
    delete (input.project as Partial<typeof input.project>).resolution
    input.sourceVideos[0].width = 640
    input.sourceVideos[0].height = 480

    const res = await renderProject(input)

    const passedResolution = (exportToMP4.mock.calls[0] as unknown[])[6]
    expect(passedResolution).toBeUndefined()
    expect(res.meta.width).toBe(640)
    expect(res.meta.height).toBe(480)
  })

  it('renders a legacy text overlay instead of dropping it from the export', async () => {
    // The headless entry does not go through the store, so before the conversion
    // landed here a project's legacy overlay arrays were silently excluded from
    // every render: the exporters only ever iterate timeline.clips.
    const input = baseInput()
    input.project.timeline.textOverlays = [legacyText()]

    await renderProject(input)

    const clips = (exportToMP4.mock.calls[0] as unknown[])[0] as Clip[]
    expect(clips).toHaveLength(2)
    expect(clips[1]).toMatchObject({ overlayType: 'text', timelinePosition: 1, duration: 2 })
    expect(clips[1].transform.opacity).toBe(0.5)
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
    // Both of these clears pin a COUNT across the setup, so they stay even
    // though every mock handle is now distinct (ESCSUITE-117): the download
    // case asserts exactly one createObjectURL, and the teardown case asserts
    // revokeObjectURL was never called at all.
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
    input.options = { format: 'mp4', quality: 'high' }
    await renderProjectToFile(input)

    // The caller's own sourceVideos entry carries no width/height (see
    // fileInputBase below) — only the seeded (probed) list does, so this is
    // only 1920 if the exporter received seedSources' completed list.
    expect(((exportToMP4.mock.calls[0] as unknown[])[1] as { width: number }[])[0].width).toBe(1920)
  })

  it('downloads the result as outputName plus the format extension, clicked from the document', async () => {
    fileInput(['source.mp4'])
    const meta = await renderProjectToFile(fileInputBase())

    expect(clicks).toEqual([{ download: 'job-1.mp4', href: lastObjectUrl(), inBody: true }])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(meta.format).toBe('mp4')
    expect(meta.byteLength).toBe(3)
  })

  it('takes the anchor back out of the document once it has been clicked', async () => {
    fileInput(['source.mp4'])
    await renderProjectToFile(fileInputBase())

    // The click has already handed the Blob to the download machinery, so the element has
    // no further job; leaving it behind would only litter a page the runner may reuse.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    // It was still attached at click time -- a detached anchor's click does nothing.
    expect(clicks[0].inBody).toBe(true)
  })

  it('renders a legacy text overlay in the streaming path too', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    input.project.timeline.textOverlays = [legacyText()]

    await renderProjectToFile(input)

    const clips = (exportToMP4.mock.calls[0] as unknown[])[0] as Clip[]
    expect(clips).toHaveLength(2)
    expect(clips[1]).toMatchObject({ id: 'legacy-text-legacy1', overlayType: 'text', timelinePosition: 1, duration: 2 })
  })

  it('uses the webm extension for a webm render', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    input.options = { format: 'webm' } as RenderFileInput['options']
    await renderProjectToFile(input)
    expect(clicks[0].download).toBe('job-1.webm')
  })

  it('uses the gif extension for a gif render', async () => {
    fileInput(['source.mp4'])
    const input = fileInputBase()
    input.options = { format: 'gif' } as RenderFileInput['options']
    await renderProjectToFile(input)
    expect(clicks[0].download).toBe('job-1.gif')
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
