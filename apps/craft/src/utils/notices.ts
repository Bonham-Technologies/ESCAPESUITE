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

/**
 * Said when a capture request was never answered: a share picker or a
 * permission prompt left on screen, or a camera or microphone driver wedged so
 * that `getUserMedia` never settles. `getDisplayMedia` and `getUserMedia` take
 * no `AbortController`, so nothing comes back — `handleStartRecording` parks in
 * `'preparing'` — and the only honest thing to do is stop waiting after a
 * generous while and say why the app went back to idle (ESCSUITE-109). The
 * request is still out there; whatever it hands over afterwards is released
 * rather than recorded, so "try again" is a real instruction and not a hope.
 */
export const CAPTURE_UNANSWERED =
  'The browser did not answer the capture request — try again.'

export const LIBRARY_UNREADABLE =
  'Your saved recordings could not be loaded — storage may be blocked in this browser.'

export const DETECTION_FAILED =
  'This browser would not say what it can capture — some sources may be unavailable.'

export const NO_SYSTEM_AUDIO =
  "System audio was not shared — tick 'Share system audio' in the browser dialog."

/**
 * Said when the microphone the take asked for could not be opened — the prompt
 * was refused, the device is in use, it was unplugged between the capability
 * check and the request — and the take went ahead without it (ESCSUITE-184).
 *
 * The microphone is the one source whose refusal does not cost the take: a
 * recording with no sound is still a recording, the ESCSUITE-14 companion
 * shape with the mic part simply absent, and a user who has already chosen the
 * window they wanted to share must not lose it to a prompt they said no to. A
 * refused screen capture still fails the take — there would be nothing to
 * record — and so does a refused webcam in a PiP take, because the overlay is
 * what the user explicitly asked for.
 *
 * One sentence for every way the request failed, because there is one channel
 * and the fact the user can act on is the same: the recording they are now
 * making has no microphone in it. The console carries which error it was.
 *
 * It wins the channel over `NO_SYSTEM_AUDIO` when both are true: that one is a
 * nudge about a tick box, and the greyed System meter carries its own weaker
 * wording for the rest of the take, while this names a source that is gone
 * from a take which went ahead regardless.
 */
export const MIC_REFUSED =
  'Microphone access was refused — recording without it.'

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
 * Said when "Upload to host" has bytes to send but nowhere safe to send them:
 * `?hostOrigin=` is absent, or carries a value `parseHostOrigin()` cannot
 * read (ESCSUITE-176). The id-only `SEND_TO_EDITOR` message may still fall
 * back to `'*'` — an opaque id is useless to a framer that cannot read the
 * shared IndexedDB — but a recording's bytes are never broadcast to whoever
 * happens to be framing the page. Named in the user's terms rather than the
 * query parameter's: the reader who can act on the parenthetical is the
 * host's developer, reading the console warning `parseHostOrigin()` also
 * raises, not the live region. See `utils/uploadToHost.ts`.
 */
export const UPLOAD_NO_HOST_ORIGIN =
  'Nothing was sent — the page embedding ESCAPECRAFT has not identified itself (no ?hostOrigin), so there is nowhere safe to send the recording.'

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

/**
 * Said when a delete — a take's own, or one of its companions' — threw partway
 * through the cascade. One sentence for either: which file survives is a
 * console detail (`handleDeleteRecording` logs it), and the fact the user can
 * act on is the same either way — the library may still be showing something
 * that storage has already lost track of, so a reload is the honest next step.
 */
export const DELETE_FAILED =
  'That recording could not be fully deleted — reload the library to see what is left.'

/**
 * Said when Play, Download, or an MP4/M4A conversion found nothing to read:
 * the row is drawn from metadata the store still holds, but the bytes it
 * names are gone — typically because the recording was deleted from
 * ESCAPEARTIST's media library in another tab, which removes the shared
 * IndexedDB row without telling this one (ESCSUITE-146; the conversion raises
 * it too as of ESCSUITE-176). `UPLOAD_UNAVAILABLE` stays a separate sentence
 * for "Upload to host"'s own version of the same fact — reached through
 * `getVideoBlob` rather than `getVideo`, so it carries no metadata to probe a
 * duration or dimensions from — and `UPLOAD_NO_HOST_ORIGIN` is the host-
 * unreachable fact that sentence's own doc comment used to (wrongly) describe
 * as this one's job.
 */
export const RECORDING_UNAVAILABLE =
  'That recording could not be read from your library — its file is no longer in storage.'
