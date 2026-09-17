// Converting one stored recording to MP4 and handing it to the browser.
//
// The whole conversion is local: `core/converter` decodes the stored WebM with
// WebCodecs, re-encodes it as H.264 + AAC and muxes it with Mediabunny. It is
// CPU-bound, which is why only one runs at a time, and it can take a while,
// which is why it reports progress and can be cancelled.
//
// Where this state lives matters. It is held here, in a hook called by
// `RecordingsListPanel` rather than by `App`, so the ~one progress report a
// frame redraws the library row and nothing else — the same reason
// `SourceTogglesPanel` owns the `audioLevels` subscription. `App` never sees
// it, and `App.mp4rerender.test.tsx` counts that.
import { useEffect, useRef, useState } from 'react'
import { convertToMP4, ConversionAbortedError } from '../core/converter'
import { getVideoBlob } from '../core/storage'
import { analytics } from '../utils/analytics'
import { downloadBlob } from '../utils/downloadBlob'
import { mp4ConversionFailed } from '../utils/notices'
import { safeFileName } from '../utils/recordingFormat'
import type { Mp4Support } from '../store/types'

/**
 * Why the MP4 button cannot start a conversion, in the same "say why" shape
 * the record button and the Sources rows use. These are button reasons rather
 * than notices — nothing has gone wrong yet — so they live here beside the
 * gate they describe, the way `NO_STORAGE_SPACE` lives in `recordReadiness`.
 */
export const MP4_UNSUPPORTED_REASON =
  'This browser cannot convert to MP4 — it needs the WebCodecs API (Chrome or Edge).'

export const MP4_BUSY_REASON =
  'One conversion at a time — converting to MP4 uses the whole processor.'

/**
 * While the codec probe is still asking. The button is disabled for this
 * moment rather than enabled and then taken away: offering a conversion and
 * withdrawing it a tick later is worse than waiting a tick to offer it.
 */
export const MP4_CHECKING_REASON =
  'Checking whether this browser can convert to MP4…'

/** The conversion in flight: which recording, and how far it has got. */
export interface Mp4Conversion {
  id: string
  /**
   * The converter's own description of what it is doing right now
   * ("Encoding frames (playing video)..."). Its `phase` is the same thing
   * coarser and in lower case, so the row shows this instead.
   */
  message: string
  /** 0-100. */
  progress: number
}

export interface Mp4Download {
  /** The conversion in flight, or null when none is running. */
  converting: Mp4Conversion | null
  /** Non-null when no conversion may be started, and why. */
  blockedReason: string | null
  startMp4Download: (id: string, name: string) => Promise<void>
  cancelMp4Download: () => void
}

export interface Mp4DownloadDeps {
  /** The app's one notice channel — see "Errors and notices" in CLAUDE.md. */
  setNotice: (notice: string | null) => void
  /**
   * What the codec probe found — `store.mp4Support`, selected by
   * `RecordingsListPanel` and handed down rather than read here, so `App`
   * never subscribes to it.
   */
  mp4Support: Mp4Support
}

export function useMp4Download({ setNotice, mp4Support }: Mp4DownloadDeps): Mp4Download {
  const [converting, setConverting] = useState<Mp4Conversion | null>(null)
  // A ref rather than state: the guard below has to see the running conversion
  // in the same tick a second click arrives, before React has re-rendered.
  const abortRef = useRef<AbortController | null>(null)
  // The real question, asked of WebCodecs at capability bootstrap: can this
  // browser encode H.264 and AAC in the configuration `convertToMP4` will use?
  // Until it has answered there is nothing to offer, so `checking` blocks the
  // button exactly as a `no` does — with a different sentence.
  const supported = mp4Support.state === 'ready' && mp4Support.supported

  // A conversion holds the whole processor for about as long as the recording
  // runs. Left alone, an unmount would let it finish behind a screen that no
  // longer exists and then hand the user a file from it.
  useEffect(() => () => abortRef.current?.abort(), [])

  const startMp4Download = async (id: string, name: string): Promise<void> => {
    if (!supported || abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    setConverting({ id, message: 'Starting conversion…', progress: 0 })

    try {
      const blob = await getVideoBlob(id)
      if (!blob) return

      const mp4 = await convertToMP4(
        blob,
        ({ message, progress }) => setConverting({ id, message, progress }),
        controller.signal
      )

      // Abort does not always reject. `convertToMP4` checks the signal while
      // it encodes, but there is no check between the last frame and the
      // muxer's `finalize()` — and on a take with no audio, none after frame
      // capture at all — so a late cancel comes back as a finished MP4. The
      // user asked for no file.
      if (controller.signal.aborted) return

      analytics.recordingDownloaded()
      // A conversion that worked makes any earlier "MP4 conversion failed"
      // untrue, and this is the one channel, so it is cleared here. It clears
      // whatever is in the region, not only an MP4 notice — the price of
      // having exactly one.
      setNotice(null)
      downloadBlob(mp4, `${safeFileName(name)}.mp4`)
    } catch (error) {
      // Cancelling is not a failure — the user asked for it, and there is
      // nothing to say about it that the row returning to idle does not.
      if (!(error instanceof ConversionAbortedError)) {
        setNotice(mp4ConversionFailed(error instanceof Error ? error.message : String(error)))
      }
    } finally {
      abortRef.current = null
      setConverting(null)
    }
  }

  const cancelMp4Download = (): void => {
    abortRef.current?.abort()
  }

  // Why the button cannot be pressed, in the order the reasons rule each other
  // out: the question is still open, the answer was no, a conversion is
  // already running.
  let blockedReason: string | null = null
  if (mp4Support.state === 'checking') {
    blockedReason = MP4_CHECKING_REASON
  } else if (!mp4Support.supported) {
    // The probe names what is missing (H.264, AAC, WebCodecs itself); the
    // constant is the fallback for a refusal that came without a reason.
    blockedReason = mp4Support.reason ?? MP4_UNSUPPORTED_REASON
  } else if (converting) {
    blockedReason = MP4_BUSY_REASON
  }

  return {
    converting,
    blockedReason,
    startMp4Download,
    cancelMp4Download,
  }
}
