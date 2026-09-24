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
  MP4_CHECKING_REASON,
  MP4_UNSUPPORTED_REASON,
} from './useMp4Download'
import type { ConversionFormat } from './useMp4Download'
import { MP4_SAVED_WITHOUT_AUDIO } from '../utils/notices'
import { storeVideo } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import {
  analyticsModule,
  converterModule,
  ConversionAbortedError,
  resetAppDoubles,
  type ConversionProgressLike,
} from '../test/appDoubles'
import type { Mp4Support, SourceVideo } from '../store/types'

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
function deferConversion(format: ConversionFormat = 'mp4') {
  let report: (progress: ConversionProgressLike) => void = () => {}
  let settle: (blob: Blob) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  let signal: AbortSignal | undefined
  const started = new Promise<void>((resolveStarted) => {
    const converting =
      format === 'm4a' ? converterModule.convertToM4A : converterModule.convertToMP4
    converting.mockImplementation(
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

/** What the store holds once the codec probe has said yes, sound included. */
const MP4_SUPPORTED: Mp4Support = { state: 'ready', supported: true, audio: true }

/**
 * …and what it holds where there is no AAC encoder: offered, but silent. The
 * sentence arrives as `audioReason` — `reason` is the MP4 verdict, and there is
 * nothing wrong with the MP4 here (ESCSUITE-61).
 */
const MP4_SILENT: Mp4Support = {
  state: 'ready',
  supported: true,
  audio: false,
  audioReason: 'MP4 will have no audio in this browser (no AAC encoder)',
}

/**
 * The hook is handed the probe's answer rather than asking for it: the field
 * lives in the store and `RecordingsListPanel` selects it, so a test can put
 * the browser in any of the three states — still checking, cannot, can — and
 * move between them with `rerender`.
 */
function renderMp4Download(mp4Support: Mp4Support = MP4_SUPPORTED) {
  return renderHook((support: Mp4Support) => useMp4Download({ setNotice, mp4Support: support }), {
    initialProps: mp4Support,
  })
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
    // A conversion that worked says nothing of its own, and clears whatever
    // the channel was still holding — see the notice test below.
    expect(setNotice.mock.calls).toEqual([[null]])
  })

  it('clears an earlier failure once a conversion succeeds', async () => {
    await seed('take-1', 'Take One')
    converterModule.convertToMP4.mockRejectedValueOnce(new Error('No H.264 encoder'))
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })
    expect(setNotice).toHaveBeenLastCalledWith('Conversion failed: No H.264 encoder')

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(setNotice).toHaveBeenLastCalledWith(null)
    expect(clicks).toHaveLength(1)
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

  it('reports what the converter is doing, and how far, for the row being converted', async () => {
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
      conversion.report({ phase: 'encoding', progress: 42, message: 'Encoding frames...' })
    })
    expect(result.current.converting).toEqual({
      id: 'take-1',
      format: 'mp4',
      message: 'Encoding frames...',
      progress: 42,
    })

    act(() => {
      conversion.report({ phase: 'finalizing', progress: 99, message: 'Finalizing MP4...' })
    })
    expect(result.current.converting).toEqual({
      id: 'take-1',
      format: 'mp4',
      message: 'Finalizing MP4...',
      progress: 99,
    })

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

  it('downloads nothing when the conversion finishes after being cancelled', async () => {
    // `convertToMP4` does not check the signal between the last encoded frame
    // and the muxer's `finalize()`, and on an audio-less take there is no abort
    // check after frame capture at all — so a late cancel can come back as a
    // *resolved* MP4 rather than a `ConversionAbortedError`. The user asked for
    // no file; they must not be handed one.
    await seed('take-1', 'Take One')
    let settle: (blob: Blob) => void = () => {}
    let signal: AbortSignal | undefined
    const started = new Promise<void>((resolveStarted) => {
      converterModule.convertToMP4.mockImplementation(
        (_blob, _onProgress, abortSignal) =>
          new Promise<Blob>((resolve) => {
            settle = resolve
            signal = abortSignal
            resolveStarted()
          })
      )
    })
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await started
    })

    await act(async () => {
      result.current.cancelMp4Download()
    })
    expect(signal?.aborted).toBe(true)

    // The conversion ignores the abort and finishes anyway.
    await act(async () => {
      settle(new Blob(['mp4-bytes'], { type: 'video/mp4' }))
    })
    await waitFor(() => expect(result.current.converting).toBeNull())

    expect(clicks).toEqual([])
    expect(analyticsModule.track).not.toHaveBeenCalledWith('Recording Downloaded', undefined)
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('aborts the conversion when the component goes away', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion()
    const { result, unmount } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One')
    })
    await act(async () => {
      await conversion.started
    })

    unmount()

    // Otherwise the whole CPU-bound encode runs to completion behind a screen
    // that is gone, and then hands the user a file from it.
    expect(conversion.signal?.aborted).toBe(true)
    await flushMicrotasks()
    expect(clicks).toEqual([])
    expect(setNotice).not.toHaveBeenCalled()
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

    expect(setNotice).toHaveBeenCalledWith('Conversion failed: No H.264 encoder')
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

    expect(setNotice).toHaveBeenCalledWith('Conversion failed: encoder exploded')
  })
})

describe('useMp4Download gating', () => {
  it('is blocked, saying so, while the codec probe is still checking', async () => {
    // The probe is asynchronous, so there is a moment before it answers. The
    // button must be disabled for it rather than enabled and then taken away:
    // an enabled-to-disabled flash offers a conversion this browser may not be
    // able to do.
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download({ state: 'checking', supported: false, audio: false })

    expect(result.current.blockedReason).toBe(MP4_CHECKING_REASON)
    // …but it is not said out loud under the library: the note would appear
    // and vanish on every load, on browsers that can convert perfectly well.
    expect(result.current.note).toBeNull()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
  })

  it('is offered once the probe says this browser can encode it', async () => {
    await seed('take-1', 'Take One')
    const { result, rerender } = renderMp4Download({
      state: 'checking',
      supported: false,
      audio: false,
    })

    rerender(MP4_SUPPORTED)
    expect(result.current.blockedReason).toBeNull()
    expect(result.current.note).toBeNull()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'take_one.mp4' }])
  })

  it('is blocked with the probe\'s own reason once it says it cannot', async () => {
    await seed('take-1', 'Take One')
    const { result, rerender } = renderMp4Download({
      state: 'checking',
      supported: false,
      audio: false,
    })

    rerender({
      state: 'ready',
      supported: false,
      audio: false,
      reason: 'This browser cannot encode H.264 video, which an MP4 needs.',
    })

    expect(result.current.blockedReason).toBe(
      'This browser cannot encode H.264 video, which an MP4 needs.'
    )
    // A refusal is said out loud, as it always was.
    expect(result.current.note).toBe(
      'This browser cannot encode H.264 video, which an MP4 needs.'
    )

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
  })

  it('falls back to the general reason when the refusal came with none', async () => {
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download({ state: 'ready', supported: false, audio: false })

    expect(result.current.blockedReason).toBe(MP4_UNSUPPORTED_REASON)

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()

    // …and a silent answer that came without a sentence says nothing at all,
    // rather than putting an empty paragraph under the library.
    const silent = renderMp4Download({ state: 'ready', supported: true, audio: false })
    expect(silent.result.current.blockedReason).toBeNull()
    expect(silent.result.current.note).toBeNull()
  })

  it('still offers the conversion where there is no AAC encoder, and says it will be silent', async () => {
    // `convertToMP4` drops the audio and produces a working MP4 in this
    // browser, so the button must stay enabled — with the warning said out
    // loud under the library rather than hidden in a disabled title.
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download(MP4_SILENT)

    expect(result.current.blockedReason).toBeNull()
    expect(result.current.note).toBe('MP4 will have no audio in this browser (no AAC encoder)')

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(converterModule.convertToMP4).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'take_one.mp4' }])
    // Told twice: before, in the note, and after, in the one notice channel.
    expect(setNotice).toHaveBeenLastCalledWith(MP4_SAVED_WITHOUT_AUDIO)
  })

  it('says nothing after a conversion that did have sound', async () => {
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One')
    })

    expect(setNotice.mock.calls).toEqual([[null]])
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
    // The deferred double reports nothing, so the row still shows the hook's
    // own opening label — the converter has not spoken yet.
    expect(result.current.converting).toEqual({
      id: 'take-1',
      format: 'mp4',
      message: 'Starting conversion…',
      progress: 0,
    })
  })
})

describe('useMp4Download audio-only (M4A)', () => {
  it('converts the take\'s audio and downloads it under a safe .m4a name', async () => {
    await seed('take-1', 'Standup Demo: 9/9')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo: 9/9', 'm4a')
    })

    // The audio-only converter, not the video one: an M4A is not an MP4 with
    // the picture thrown away afterwards.
    expect(converterModule.convertToM4A).toHaveBeenCalledTimes(1)
    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'standup_demo__9_9.m4a' }])
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Downloaded', undefined)
    expect(setNotice.mock.calls).toEqual([[null]])
  })

  it('names the format on the conversion in flight, so the row can say which it is', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion('m4a')
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })
    await act(async () => {
      await conversion.started
    })

    expect(result.current.converting).toEqual({
      id: 'take-1',
      format: 'm4a',
      message: 'Starting conversion…',
      progress: 0,
    })

    act(() => {
      conversion.report({ phase: 'encoding', progress: 42, message: 'Encoding audio…' })
    })
    expect(result.current.converting).toEqual({
      id: 'take-1',
      format: 'm4a',
      message: 'Encoding audio…',
      progress: 42,
    })

    await act(async () => {
      conversion.settle(new Blob(['m4a-bytes'], { type: 'audio/mp4' }))
    })
    await waitFor(() => expect(result.current.converting).toBeNull())
  })

  it('shares the one conversion slot with MP4, in both directions', async () => {
    // Both are CPU-bound and there is one processor. An M4A running blocks an
    // MP4 for the same reason a second MP4 is blocked, and says the same thing.
    await seed('take-1', 'Take One')
    await seed('take-2', 'Take Two')
    const conversion = deferConversion('m4a')
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })
    await act(async () => {
      await conversion.started
    })

    expect(result.current.blockedReason).toBe(MP4_BUSY_REASON)
    expect(result.current.m4aBlockedReason).toBe(MP4_BUSY_REASON)

    await act(async () => {
      await result.current.startMp4Download('take-2', 'Take Two')
    })
    await act(async () => {
      await result.current.startMp4Download('take-2', 'Take Two', 'm4a')
    })

    expect(converterModule.convertToMP4).not.toHaveBeenCalled()
    expect(converterModule.convertToM4A).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([])
  })

  it('is blocked, saying so, while the codec probe is still checking', async () => {
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download({ state: 'checking', supported: false, audio: false })

    expect(result.current.m4aBlockedReason).toBe(MP4_CHECKING_REASON)

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })

    expect(converterModule.convertToM4A).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
  })

  it('is blocked where there is no AAC encoder, though MP4 is still offered', async () => {
    // The asymmetry the whole format turns on: `convertToMP4` drops the audio
    // and writes a silent video, which is still a video. There is no silent
    // M4A worth writing, so the same browser gets one button and not the other.
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download(MP4_SILENT)

    expect(result.current.m4aBlockedReason).toBe(
      'MP4 will have no audio in this browser (no AAC encoder)'
    )
    expect(result.current.blockedReason).toBeNull()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })

    expect(converterModule.convertToM4A).not.toHaveBeenCalled()
    expect(clicks).toEqual([])
  })

  it('falls back to the general reason when the refusal came with none', async () => {
    const { result } = renderMp4Download({ state: 'ready', supported: true, audio: false })

    expect(result.current.m4aBlockedReason).toBe(MP4_UNSUPPORTED_REASON)
  })

  // ESCSUITE-61. The two gates read two different sentences, so a browser
  // missing both encoders titles each button with the fact about it — the M4A
  // button is not disabled with a sentence about video.
  it('is blocked with the AAC sentence where MP4 is blocked with the H.264 one', async () => {
    const { result } = renderMp4Download({
      state: 'ready',
      supported: false,
      audio: false,
      reason: 'This browser cannot encode H.264 video, which an MP4 needs.',
      audioReason: 'MP4 will have no audio in this browser (no AAC encoder)',
    })

    expect(result.current.m4aBlockedReason).toBe(
      'MP4 will have no audio in this browser (no AAC encoder)'
    )
    expect(result.current.blockedReason).toBe(
      'This browser cannot encode H.264 video, which an MP4 needs.'
    )
    // What is said out loud is the blocking reason, as ever: the MP4 one.
    expect(result.current.note).toBe(
      'This browser cannot encode H.264 video, which an MP4 needs.'
    )
  })

  it('is offered, and runs, where only the video codec is missing', async () => {
    // An M4A needs an AAC encoder and nothing else, so `supported: false` — the
    // answer about H.264 — must not reach this button. The gate and the action
    // read the same reason, which is what stops an enabled button from being a
    // dead one: before, the button rendered enabled here and the click did
    // nothing at all. This combination is real since ESCSUITE-61: the probe
    // answers for H.264 and AAC independently, so a browser with an AAC
    // encoder and no H.264 lands exactly here — keep this test.
    await seed('take-1', 'Take One')
    const { result } = renderMp4Download({
      state: 'ready',
      supported: false,
      audio: true,
      reason: 'This browser cannot encode H.264 video, which an MP4 needs.',
    })

    expect(result.current.m4aBlockedReason).toBeNull()
    expect(result.current.blockedReason).toBe(
      'This browser cannot encode H.264 video, which an MP4 needs.'
    )

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })

    expect(converterModule.convertToM4A).toHaveBeenCalledTimes(1)
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'take_one.m4a' }])
  })

  it('is offered, with nothing to say, once the probe says the browser can encode AAC', () => {
    const { result } = renderMp4Download()

    expect(result.current.m4aBlockedReason).toBeNull()
    expect(result.current.note).toBeNull()
  })

  it('raises a failure through the one notice channel, in wording that fits either format', async () => {
    await seed('take-1', 'Take One')
    converterModule.convertToM4A.mockRejectedValue(new Error('This recording has no audio track'))
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Take One', 'm4a')
    })

    expect(setNotice).toHaveBeenCalledWith('Conversion failed: This recording has no audio track')
    expect(clicks).toEqual([])
  })

  it('cancelling an audio conversion downloads nothing and says nothing', async () => {
    await seed('take-1', 'Take One')
    const conversion = deferConversion('m4a')
    const { result } = renderMp4Download()

    act(() => {
      void result.current.startMp4Download('take-1', 'Take One', 'm4a')
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
    expect(setNotice).not.toHaveBeenCalled()
  })
})

/** Let whatever the unmounted conversion was doing settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Put the converter double back to the one-turn happy path. */
function resetConverterToHappyPath(): void {
  converterModule.convertToMP4.mockImplementation(async (blob, onProgress) => {
    onProgress({ phase: 'preparing', progress: 0, message: 'Preparing conversion...' })
    return new Blob([blob], { type: 'video/mp4' })
  })
}
