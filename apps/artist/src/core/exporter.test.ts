// The public export barrel. The behaviour of each export path is covered in
// exportMP4.test.ts / exportWebM.test.ts and the shared helpers in
// exportTypes.test.ts; what this file pins down is the barrel's own contract —
// that every name callers import from './exporter' resolves to the real
// implementation, and that the two entry points refuse to start on a browser
// without WebCodecs, on an empty timeline, or under an already-cancelled export.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ExportAbortedError,
  exportToMP4,
  exportToWebM,
  isMP4ExportSupported,
  isWebMExportSupported,
} from './exporter'
import { installWebCodecsDoubles, removeWebCodecsGlobals } from '../test/doubles/webcodecs'
import { removeGlobal } from '../test/doubles/globals'
import {
  makeClip,
  makeExportOptions,
  makeSourceVideo,
} from '../test/fixtures/clipFixtures'

const clips = [makeClip()]
const sourceVideos = [makeSourceVideo()]

const restores: Array<() => void> = []

afterEach(() => {
  while (restores.length) restores.pop()!()
})

describe('export support probes', () => {
  it('reports MP4 export as supported when all three WebCodecs APIs exist', () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())

    expect(isMP4ExportSupported()).toBe(true)
  })

  it('reports WebM export as supported when it can configure VP9', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())

    await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(true)
  })

  it.each(['VideoEncoder', 'VideoFrame'])(
    'reports both MP4 and WebM export as unsupported without %s',
    async (missing) => {
      const webcodecs = installWebCodecsDoubles()
      restores.push(() => webcodecs.uninstall())
      restores.push(removeGlobal(missing))

      expect(isMP4ExportSupported()).toBe(false)
      await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(false)
    }
  )

  // ESCSUITE-22: WebM never decodes through WebCodecs — it seeks
  // HTMLVideoElements directly — so unlike MP4 it does not need VideoDecoder.
  // The two probes used to be the same function; this is the split.
  it('reports MP4 as unsupported without VideoDecoder, but leaves WebM supported', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())
    restores.push(removeGlobal('VideoDecoder'))

    expect(isMP4ExportSupported()).toBe(false)
    await expect(isWebMExportSupported(1920, 1080)).resolves.toBe(true)
  })
})

describe('exportToWebM', () => {
  it('refuses to run without WebCodecs', async () => {
    restores.push(removeWebCodecsGlobals())

    await expect(
      exportToWebM(clips, sourceVideos, makeExportOptions({ format: 'webm' }), vi.fn())
    ).rejects.toThrow('WebM export requires WebCodecs API')
  })

  it('refuses to export an empty timeline', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())

    await expect(
      exportToWebM([], [], makeExportOptions({ format: 'webm' }), vi.fn())
    ).rejects.toThrow('No clips to export')
  })

  it('throws ExportAbortedError when the signal is already aborted', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())
    const controller = new AbortController()
    controller.abort()

    const error = await exportToWebM(
      clips,
      sourceVideos,
      makeExportOptions({ format: 'webm' }),
      vi.fn(),
      undefined,
      controller.signal
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportAbortedError)
    expect((error as Error).message).toBe('Export was cancelled')
  })
})

describe('exportToMP4', () => {
  it('refuses to run without WebCodecs', async () => {
    restores.push(removeWebCodecsGlobals())

    await expect(
      exportToMP4(clips, sourceVideos, makeExportOptions(), vi.fn())
    ).rejects.toThrow('MP4 export requires WebCodecs API')
  })

  it('refuses to export an empty timeline', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())

    await expect(exportToMP4([], [], makeExportOptions(), vi.fn())).rejects.toThrow(
      'No clips to export'
    )
  })

  it('throws ExportAbortedError when the signal is already aborted', async () => {
    const webcodecs = installWebCodecsDoubles()
    restores.push(() => webcodecs.uninstall())
    const controller = new AbortController()
    controller.abort()

    await expect(
      exportToMP4(
        clips,
        sourceVideos,
        makeExportOptions(),
        vi.fn(),
        undefined,
        controller.signal
      )
    ).rejects.toBeInstanceOf(ExportAbortedError)
  })
})
