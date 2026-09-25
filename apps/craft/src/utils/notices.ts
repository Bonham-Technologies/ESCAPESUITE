// Everything ESCAPECRAFT has to tell the user that is not a state change.
//
// There is exactly ONE notice channel: `notice` in the recorder store, which
// `AppHeader` renders inside the header's `aria-live="polite"` region. A
// notice is raised by whichever path discovered the problem and cleared when
// the next take starts — see `useRecordingController.handleStartRecording`.
// Anything that needs a second channel needs a design discussion first, not a
// second store field.
export const SAVE_FAILED =
  'The recording could not be saved — it is not in your library.'

export const NOT_SEEKABLE =
  'Saved, but the recording may not be seekable — the container repair failed.'

export const CAPTURE_REFUSED =
  'The browser refused the capture — nothing was recorded.'

export const START_FAILED = 'The recording could not be started.'

export const LIBRARY_UNREADABLE =
  'Your saved recordings could not be loaded — storage may be blocked in this browser.'

export const DETECTION_FAILED =
  'This browser would not say what it can capture — some sources may be unavailable.'

export const NO_SYSTEM_AUDIO =
  "System audio was not shared — tick 'Share system audio' in the browser dialog."

/**
 * Said after a conversion that ran in a browser with no AAC encoder. The codec
 * probe says the same thing before it, under the library
 * (`MP4_NO_AUDIO_REASON` in `core/converter.ts`), so the user is told twice:
 * once while there is still a choice, once about the file they now have.
 */
export const MP4_SAVED_WITHOUT_AUDIO =
  'Saved as MP4 — without audio: this browser has no AAC encoder'

/**
 * The one notice that carries a detail: what a conversion said when it failed.
 * A function rather than a constant because the browser's own message ("No
 * H.264 encoder", a decode failure, "This recording has no audio track") is
 * the useful half — but it is still one string, raised through the same
 * `setNotice` channel as the rest. The wording names no format because both
 * conversions raise it: the MP4 download and the audio-only M4A, which have
 * one code path and one notice between them. Cancelling a conversion raises
 * nothing: see `useMp4Download`.
 */
export const mp4ConversionFailed = (message: string) => `Conversion failed: ${message}`

/**
 * Said when a separate-tracks take produced fewer parts than it asked for —
 * the camera, the microphone or the system audio did not make it.
 *
 * One sentence for any of them, and for any number of them, because there is
 * exactly one notice channel and "which track" is not something the user can
 * act on differently; the console carries the per-role detail. The spec says a
 * companion may never cost the take its primary: the screen recording is
 * still saved and listed exactly as a no-companion take would be, and this is
 * the one line that says something else was not. Raised from two places —
 * `useRecordingController` for a part lost inside the recorder, and
 * `useRecordingSave` for one lost in storage — because only the controller
 * knows how many parts the take asked for, and only the save hook knows which
 * write threw.
 */
export const SEPARATE_TRACK_NOT_SAVED =
  'A separate track could not be saved — the screen recording was kept.'

/**
 * Said when "Upload to host" found nothing to send: the row is drawn from
 * metadata the store still holds, and the bytes it names were not in storage.
 * Only an embedded CRAFT can raise it — see `utils/uploadToHost.ts`. Silence
 * would be indistinguishable from a successful hand-over, since the host, not
 * CRAFT, is what shows the result.
 */
export const UPLOAD_UNAVAILABLE =
  'That recording could not be read from your library — nothing was sent to the host.'

/**
 * Said after a conversion that could not include the take's camera part.
 *
 * Two things reach it: the part was listed and its bytes were gone
 * (`utils/takeParts.ts` answers `'unavailable'`), or its container would not
 * decode (`convertToMP4` calls `onCompanionSkipped`). One sentence for both,
 * because the fact the user can act on is the same — the MP4 they now have is
 * the screen alone, and the camera is still downloadable as WebM from its own
 * row.
 *
 * It wins the channel over `MP4_SAVED_WITHOUT_AUDIO` when both are true: the
 * silent-MP4 warning is said *before* the conversion too, under the library,
 * where a camera loss cannot yet be known.
 */
export const MP4_SAVED_WITHOUT_WEBCAM =
  'Saved as MP4 — without the webcam: its own track could not be read'
