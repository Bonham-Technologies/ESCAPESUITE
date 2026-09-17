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
import { useRef, useState } from 'react'
import {
  convertToMP4,
  isMP4ConversionSupported,
  ConversionAbortedError,
  type ConversionProgress,
} from '../core/converter'
import { getVideoBlob } from '../core/storage'
import { analytics } from '../utils/analytics'
import { downloadBlob } from '../utils/downloadBlob'
import { mp4ConversionFailed } from '../utils/notices'
import { safeFileName } from '../utils/recordingFormat'

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

/** The conversion in flight: which recording, and how far it has got. */
export interface Mp4Conversion {
  id: string
  phase: ConversionProgress['phase']
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
}

export function useMp4Download({ setNotice }: Mp4DownloadDeps): Mp4Download {
  const [converting, setConverting] = useState<Mp4Conversion | null>(null)
  // A ref rather than state: the guard below has to see the running conversion
  // in the same tick a second click arrives, before React has re-rendered.
  const abortRef = useRef<AbortController | null>(null)
  const supported = isMP4ConversionSupported()

  const startMp4Download = async (id: string, name: string): Promise<void> => {
    if (!supported || abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    setConverting({ id, phase: 'preparing', progress: 0 })

    try {
      const blob = await getVideoBlob(id)
      if (!blob) return

      const mp4 = await convertToMP4(
        blob,
        ({ phase, progress }) => setConverting({ id, phase, progress }),
        controller.signal
      )

      analytics.recordingDownloaded()
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

  return {
    converting,
    blockedReason: supported ? (converting ? MP4_BUSY_REASON : null) : MP4_UNSUPPORTED_REASON,
    startMp4Download,
    cancelMp4Download,
  }
}
