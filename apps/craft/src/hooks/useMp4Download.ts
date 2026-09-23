// Converting one stored recording — to MP4, or to M4A — and handing it to the
// browser.
//
// The whole conversion is local either way: `core/converter` decodes the stored
// WebM with WebCodecs and muxes the result with Mediabunny, as H.264 + AAC for
// an MP4 or as AAC alone for an M4A. Both are CPU-bound, which is why only one
// runs at a time *across both formats*, and either can take a while, which is
// why they report progress and can be cancelled.
//
// The name is the one thing that did not change when the second format
// arrived: every call site and every test names this hook, and renaming it
// would have been a diff about nothing. `format` is the second conversion's
// whole surface here.
//
// Where this state lives matters. It is held here, in a hook called by
// `RecordingsListPanel` rather than by `App`, so the ~one progress report a
// frame redraws the library row and nothing else — the same reason
// `SourceTogglesPanel` owns the `audioLevels` subscription. `App` never sees
// it, and `App.mp4rerender.test.tsx` counts that.
import { useEffect, useRef, useState } from 'react'
import { convertToMP4, convertToM4A, ConversionAbortedError } from '../core/converter'
import { getVideoBlob } from '../core/storage'
import { analytics } from '../utils/analytics'
import { downloadBlob } from '../utils/downloadBlob'
import { mp4ConversionFailed, MP4_SAVED_WITHOUT_AUDIO } from '../utils/notices'
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

/**
 * Said on every conversion button that is not the one running. Deliberately
 * names no format: one slot serves both, so this sentence titles a disabled
 * M4A button while an MP4 is converting and the other way round. (The constant
 * keeps its `MP4_` name because every caller and test imports it under that
 * name; what a user reads is the string.)
 */
export const MP4_BUSY_REASON =
  'One conversion at a time — it uses the whole processor.'

/**
 * While the codec probe is still asking. The button is disabled for this
 * moment rather than enabled and then taken away: offering a conversion and
 * withdrawing it a tick later is worse than waiting a tick to offer it. One
 * probe answers for both formats, so this names neither.
 */
export const MP4_CHECKING_REASON =
  'Checking what this browser can convert…'

/**
 * Why *this recording* cannot be saved as audio: there is none in it. The one
 * reason here that is a fact about a row rather than about the browser, which
 * is why `RecordingsList` reaches for it per recording (`recording.hasAudio`)
 * instead of being handed it.
 *
 * Its pair is `M4A_NO_AUDIO_MESSAGE` in `core/converter.ts` ("This recording
 * has no audio track"), which `convertToM4A` *throws* for the same fact. Two
 * strings on purpose: this one titles a button that was never pressed, that
 * one becomes a notice about a conversion that was. Neither is canonical —
 * change both or neither.
 */
export const NO_AUDIO_TRACK_REASON = 'This recording has no audio'

/** Which of the two conversions a download is. */
export type ConversionFormat = 'mp4' | 'm4a'

/** The conversion in flight: which recording, to what, and how far it has got. */
export interface Mp4Conversion {
  id: string
  /**
   * Which conversion is running. The row is the same row either way — it is
   * the labels on it ("Converting to M4A…") that have to tell the truth.
   */
  format: ConversionFormat
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
  /**
   * What the library should say out loud, or null. Usually the blocked reason,
   * but not always either way: "still checking" is true for a moment on every
   * load and is not worth a paragraph that appears and vanishes, while "this
   * MP4 will be silent" is worth saying even though nothing is blocked.
   */
  note: string | null
  /**
   * Non-null when no M4A may be started, and why. A separate answer from
   * `blockedReason` because the two formats are gated differently: a browser
   * with no AAC encoder still converts to (silent) MP4, and cannot write an
   * M4A at all.
   */
  m4aBlockedReason: string | null
  startMp4Download: (id: string, name: string, format?: ConversionFormat) => Promise<void>
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
  // A conversion holds the whole processor for about as long as the recording
  // runs. Left alone, an unmount would let it finish behind a screen that no
  // longer exists and then hand the user a file from it.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Why the button cannot be pressed, in the order the reasons rule each other
  // out: the question is still open, the answer was no, a conversion is
  // already running. The question is the real one, asked of WebCodecs at
  // capability bootstrap — can this browser encode H.264 and AAC in the
  // configuration the conversion will use — so `checking` blocks the button
  // exactly as a `no` does, with a different sentence. Computed before the
  // action below, because the action is gated on exactly these answers.
  let blockedReason: string | null = null
  if (mp4Support.state === 'checking') {
    blockedReason = MP4_CHECKING_REASON
  } else if (!mp4Support.supported) {
    // The probe names what is missing (H.264, WebCodecs itself, or that it
    // could not tell); the constant is the fallback for a refusal that came
    // without a reason. A missing AAC encoder is NOT here — it does not block.
    blockedReason = mp4Support.reason ?? MP4_UNSUPPORTED_REASON
  } else if (converting) {
    blockedReason = MP4_BUSY_REASON
  }

  // The same three questions for the audio-only download, with one different
  // answer in the middle: a missing AAC encoder blocks an M4A outright, where
  // it only silences an MP4. The fallback is the MP4 gate's, for a refusal
  // that arrived without a sentence — the probe always sends one.
  let m4aBlockedReason: string | null = null
  if (mp4Support.state === 'checking') {
    m4aBlockedReason = MP4_CHECKING_REASON
  } else if (!mp4Support.audio) {
    m4aBlockedReason = mp4Support.reason ?? MP4_UNSUPPORTED_REASON
  } else if (converting) {
    m4aBlockedReason = MP4_BUSY_REASON
  }

  const startMp4Download = async (
    id: string,
    name: string,
    format: ConversionFormat = 'mp4'
  ): Promise<void> => {
    // The button's reason and the action's refusal are one question, answered
    // once: an enabled button always does something, and a disabled one is
    // never the only thing standing between a click and a conversion the
    // browser cannot run. (Before, the two were separate predicates and could
    // disagree — `{ supported: false, audio: true }` rendered an enabled M4A
    // button whose click did nothing.)
    //
    // `abortRef` is the guard the reasons cannot give: it sees a conversion
    // started in this very tick, before React has re-rendered and recomputed
    // them. One slot for both formats — they are equally CPU-bound, and there
    // is one processor.
    const blocked = format === 'm4a' ? m4aBlockedReason : blockedReason
    if (blocked !== null || abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    setConverting({ id, format, message: 'Starting conversion…', progress: 0 })

    try {
      const blob = await getVideoBlob(id)
      if (!blob) return

      const convert = format === 'm4a' ? convertToM4A : convertToMP4
      const converted = await convert(
        blob,
        ({ message, progress }) => setConverting({ id, format, message, progress }),
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
      // having exactly one. Where the browser had no AAC encoder the file that
      // just landed is silent, and that is what the channel says instead: the
      // same fact the note said beforehand, now about a file they have.
      // An M4A only ever runs where the probe said AAC is there, so this is
      // `null` for it by construction — the silent-file warning is an MP4 fact.
      setNotice(mp4Support.audio ? null : MP4_SAVED_WITHOUT_AUDIO)
      downloadBlob(converted, `${safeFileName(name)}.${format}`)
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

  // And what the library says out loud. Everything blocking is said, except
  // "still checking": that one is true for a moment on every load, and a
  // paragraph that appears and vanishes moves the page for nothing. What is
  // said while nothing is blocked is the silent-MP4 warning, so it arrives
  // before the minutes are spent rather than after.
  let note: string | null = null
  if (mp4Support.state === 'ready') {
    note = blockedReason ?? (mp4Support.audio ? null : mp4Support.reason ?? null)
  }

  return {
    converting,
    blockedReason,
    note,
    m4aBlockedReason,
    startMp4Download,
    cancelMp4Download,
  }
}
