// Converting one stored recording to MP4 and handing it to the browser.
//
// Storage is real (fake-indexeddb) and so are the object-URL helpers. The
// converter is a boundary the browser owns — WebCodecs encoding, Mediabunny
// muxing — so it is doubled, along with analytics delivery; the hook's own
// orchestration is never mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useMp4Download,
  MP4_BUSY_REASON,
  MP4_UNSUPPORTED_REASON,
} from './useMp4Download'
import { storeVideo } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import {
  analyticsModule,
  converterModule,
  ConversionAbortedError,
  resetAppDoubles,
  type ConversionProgressLike,
} from '../test/appDoubles'
import type { SourceVideo } from '../store/types'

vi.mock('../core/converter', async () => (await import('../test/appDoubles')).converterModule)
vi.mock('@vercel/analytics', async () => (await import('../test/appDoubles')).analyticsModule)

let setNotice: ReturnType<typeof vi.fn<(notice: string | null) => void>>
let clicks: Array<{ href: string; download: string }>

function metadata(id: string, name: string): SourceVideo {
  return {
    id,
    name,
    duration: 30,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
  }
}

async function seed(id: string, name: string): Promise<void> {
  await storeVideo(id, new Blob(['video-bytes'], { type: 'video/webm' }), metadata(id, name))
}

/**
 * A conversion the test drives by hand: it reports whatever progress the test
 * asks for and finishes only when the test says so.
 */
function deferConversion() {
  let report: (progress: ConversionProgressLike) => void = () => {}
  let settle: (blob: Blob) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  let signal: AbortSignal | undefined
  const started = new Promise<void>((resolveStarted) => {
    converterModule.convertToMP4.mockImplementation(
      (_blob, onProgress, abortSignal) =>
        new Promise<Blob>((resolve, reject) => {
          report = onProgress
          settle = resolve
          fail = reject
          signal = abortSignal
          abortSignal?.addEventListener('abort', () => reject(new ConversionAbortedError()))
          resolveStarted()
        })
    )
  })
  return {
    started,
    report: (progress: ConversionProgressLike) => report(progress),
    settle: (blob: Blob) => settle(blob),
    fail: (error: unknown) => fail(error),
    get signal() {
      return signal
    },
  }
}

beforeEach(async () => {
  resetAppDoubles()
  setNotice = vi.fn<(notice: string | null) => void>()
  clicks = []
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  await clearAllRecordings()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderMp4Download() {
  return renderHook(() => useMp4Download({ setNotice }))
}

describe('useMp4Download, start to finish', () => {
  it('converts the stored recording and downloads it under a safe .mp4 name', async () => {
    await seed('take-1', 'Standup Demo: 9/9')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo: 9/9')
    })

    expect(converterModule.convertToMP4).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'standup_demo__9_9.mp4' }])
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Downloaded', undefined)
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('is idle again once the conversion is done', async () => {
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(result.current.converting).toBeNull()
    expect(result.current.blockedReason).toBeNull()
  })

  it('reports the phase and the percentage of the row being converted', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion()
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await conversion.started
    })

    act(() => {
      conversion.report({ phase: 'encoding', progress: 42, message: 'Encoding video...' })
    })
    expect(result.current.converting).toEqual({ id: 'take-1', phase: 'encoding', progress: 42 })

    act(() => {
      conversion.report({ phase: 'finalizing', progress: 99, message: 'Writing file...' })
    })
    expect(result.current.converting).toEqual({ id: 'take-1', phase: 'finalizing', progress: 99 })

    await act(async () => {
      conversion.settle(new Blob(['mp4-bytes'], { type: 'video/mp4' }))
    })
    await waitFor(() => expect(result.current.converting).toBeNull())
    expect(clicks).toHaveLength(1)
  })

  it('does nothing when the stored blob has gone missing', async () => {
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('ghost', 'Ghost Take')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
    expect(setNotice).not.toHaveBeenCalled()
    expect(result.current.converting).toBeNull()
  })
})

describe('useMp4Download cancellation', () => {
  it('aborts the conversion, downloads nothing and says nothing', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion()
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await conversion.started
    })

    await act(async () => {
      result.current.cancelMp4Download()
    })

    expect(conversion.signal?.aborted).toBe(true)
    await waitFor(() => expect(result.current.converting).toBeNull())
    expect(clicks).toEqual([])
    // A cancellation is not a failure: it raises no notice.
    expect(setNotice).not.toHaveBeenCalled()
    expect(analyticsModule.track).not.toHaveBeenCalledWith('Recording Downloaded', undefined)
  })

  it('a conversion can be started again after one was cancelled', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion()
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await conversion.started
    })
    await act(async () => {
      result.current.cancelMp4Download()
    })
    await waitFor(() => expect(result.current.converting).toBeNull())

    converterModule.convertToMP4.mockClear()
    resetConverterToHappyPath()
    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'take_one.mp4' }])
  })

  it('does nothing when there is no conversion to cancel', () => {
    const { result } = renderMp4Download()

    expect(() => result.current.cancelMp4Download()).not.toThrow()
  })
})

describe('useMp4Download failures', () => {
  it('raises the failure through the notice channel', async () => {
    await seed('take-1', 'Take One')
    converterModule.convertToMP4.mockRejectedValue(new Error('No H.264 encoder'))
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(setNotice).toHaveBeenCalledWith('MP4 conversion failed: No H.264 encoder')
    expect(clicks).toEqual([])
    expect(result.current.converting).toBeNull()
  })

  it('says something even when what was thrown is not an Error', async () => {
    await seed('take-1', 'Take One')
    converterModule.convertToMP4.mockRejectedValue('encoder exploded')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(setNotice).toHaveBeenCalledWith('MP4 conversion failed: encoder exploded')
  })
})

describe('useMp4Download gating', () => {
  it('is blocked, with a reason, where the browser cannot encode H.264', async () => {
    await seed('take-1', 'Take One')
    converterModule.isMP4ConversionSupported.mockReturnValue(false)
    const { result } = renderMp4Download()

    expect(result.current.blockedReason).toBe(MP4_UNSUPPORTED_REASON)

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
  })

  it('runs one conversion at a time, and says why the others are blocked', async () => {
    await seed('take-1', 'Take One')
    await seed('take-2', 'Take Two')
    const conversion = deferConversion()
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await conversion.started
    })

    expect(result.current.blockedReason).toBe(MP4_BUSY_REASON)

    await act(async () => {
      await result.current.startMp4Download('take-2', 'Take Two')
    })

    expect(converterModule.convertToMP4).toHaveBeenCalledTimes(1)
    expect(result.current.converting).toEqual({ id: 'take-1', phase: 'preparing', progress: 0 })
  })
})

/** Put the converter double back to the one-turn happy path. */
function resetConverterToHappyPath(): void {
  converterModule.convertToMP4.mockImplementation(async (blob, onProgress) => {
    onProgress({ phase: 'preparing', progress: 0, message: 'Preparing conversion...' })
    return new Blob([blob], { type: 'video/mp4' })
  })
}
