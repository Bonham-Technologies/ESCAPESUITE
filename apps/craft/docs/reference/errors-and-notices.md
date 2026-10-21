<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Errors and notices

**One store field, one live region, cleared by the next take.** `notice: string | null`
in `recorderStore` is the whole notification surface: `AppHeader` renders it inside the
header's existing `aria-live="polite" aria-atomic="true"` region, and
`handleStartRecording` clears it when the next take begins. Every string lives in
`src/utils/notices.ts` — `SAVE_FAILED`, `NOT_SEEKABLE`, `CAPTURE_REFUSED`,
`CAPTURE_UNANSWERED`, `START_FAILED`, `LIBRARY_UNREADABLE`, `DETECTION_FAILED`,
`NO_SYSTEM_AUDIO`, `MIC_UNAVAILABLE`, `MP4_SAVED_WITHOUT_AUDIO`, `UPLOAD_UNAVAILABLE`,
`UPLOAD_NO_HOST_ORIGIN`,
`SEPARATE_TRACK_NOT_SAVED`, `MP4_SAVED_WITHOUT_WEBCAM`, `DELETE_FAILED`,
`RECORDING_UNAVAILABLE`,
`captureFailed()` and `mp4ConversionFailed()` —
so the vocabulary is readable in one place. `mp4ConversionFailed` is the one that takes an
argument, because the browser's own words for why an encode failed are the useful half; it
is still one string through the same `setNotice`, and it says "Conversion failed: …" rather
than naming a format, because both conversions — MP4 and M4A — raise it through one code path. **Do not add a second channel**: no toasts, no per-component error
state, no notification framework. A new thing to say is a new string in that file and one
call to `setNotice`.

The notice span deliberately carries **no `role` of its own**. The region's `aria-live` is
what announces it; a second `role="status"` would break the "at most one `role='status'`"
promise `AppHeader` makes, and would have an `aria-atomic` region read two independent
things as one phrase. A notice and a running take are on screen together in the ordinary
case — "System audio was not shared" during a recording is exactly that.

The price of sharing one region is that a notice raised *while* the state is changing can
be announced twice: `NOT_SEEKABLE` is set during `'saving'`, so the region reads
"Saving… + notice", and reads the notice alone again when the state clears to `'idle'`.
That is accepted — a second live region to avoid it would cost more than the repetition
does. (`SAVE_FAILED` is unaffected: the notice and the state land in one batch.)

Two related rules follow from it:

- **Failures travel up, not into a `console.error`.** `useRecordingSave` rejects rather
  than swallowing, so the controller can tell an unsaved take from a saved one — but only
  when the take itself failed to store: `storeVideo` rejecting is what the controller's
  `SAVE_FAILED` answers. A thumbnail write failing (or `generateThumbnail` throwing) is
  cosmetic and is caught inside the hook rather than rejecting the save, the same posture
  a lost companion already had (ESCSUITE-107) — the alternative was a take that *was*
  stored being reported as "not in your library", invisible until reload, and, for a
  separate-tracks take, its companions never written at all;
  `loadRecordings()` is caught in the bootstrap; a start whose capture request
  fails raises `captureFailed(source, reason)` — a sentence that **names the
  source** (screen, camera, or microphone) and the kind of failure (ESCSUITE-341).
  The requests run screen, then camera, then microphone, so a camera refused at
  Start fails after the user has already answered the share picker; the single
  sentence it used to get, `CAPTURE_REFUSED` ("The browser refused the
  capture"), read as if that share had failed, and a camera missing or in use
  by another app got the vaguer `START_FAILED`. `core/permissions.ts`'s
  `requestScreenCapture`/`requestWebcam`/`requestMicrophone` now rethrow every
  rejection as a `CaptureRequestError` carrying `source`, with the browser's own
  `DOMException` as `cause`. `startFailureNotice` (`hooks/useRecordingController.ts`)
  reads the source off the error and the browser's name through one helper,
  `failureName(error)` — `(error.cause ?? error).name` — and sorts that name
  into `refused` (`NotAllowedError`: a dismissed prompt, a blocking site
  setting, a cancelled picker, an expired user activation), `unavailable`
  (`NotFoundError`, `NotReadableError`, `OverconstrainedError`) or `failed`
  (anything else, which names only the source). Reading `.name` straight off
  the wrapper instead (as it did before ESCSUITE-210) made every refusal fall
  through to the generic sentence. The microphone sentences are reached only by
  a microphone-only take — anywhere else a closed microphone does not cost the
  take (`MIC_UNAVAILABLE`, below). A start that fails *without* a tagged
  request — a recorder that would not initialise — keeps the two unnamed
  sentences: `CAPTURE_REFUSED` for a `NotAllowedError`, `START_FAILED` for the
  rest. Whether a camera failure costs the take is unchanged: it still does,
  because the overlay is what the user asked for. A start whose capture
  request is never answered at all raises `CAPTURE_UNANSWERED` when its
  deadline expires (ESCSUITE-109) —
  a silence has to be reported too, because the alternative is a UI parked in
  `'preparing'` for good; `fixWebMMetadata()` failing still keeps the
  raw blob, but it now warns *and* raises `NOT_SEEKABLE` — an unrepaired MediaRecorder
  WebM plays and refuses to scrub, and saving it with no trace is how ESCSUITE-2 comes
  back.
- **`systemAudioShared`** is the one other honesty flag: enabling "System Audio" only
  *asks* for it (the browser's share dialog carries the tick box), so the controller
  checks `hasSystemAudio(screen)` after acquisition, raises `NO_SYSTEM_AUDIO` when a
  display capture came back without an audio track, and `SourceToggles` greys the System
  meter for the take. The notice is withheld when there was no display capture at all
  (system audio on, screen off) — there was no dialog to miss a tick box in — so the
  greyed meter carries its own, weaker wording (`NO_SYSTEM_AUDIO_HINT`, "No system audio
  arrived for this take") rather than the notice's. `handleStartRecording` resetting it to
  `true` is its whole lifecycle — which is also what makes it readable at save time: it
  still describes the take just finished until the *next* one starts. `useRecordingSave`
  reads it there (ESCSUITE-62) so a take whose tick box was cleared is stored as having no
  audio, rather than as a silent recording with an M4A button.
- **`MIC_UNAVAILABLE`** is the third: the microphone the take asked for could not be opened and the
  take went ahead anyway (ESCSUITE-184 — see "A microphone that cannot be opened does not cost
  the take" under "Recorder lifecycle"). One sentence for every way the request failed, because there is one
  channel and the fact the user can act on is the same — the recording now being made has no
  microphone in it; the console carries which error it was. It is raised **after**
  `NO_SYSTEM_AUDIO` in `handleStartRecording`, so it wins the single channel when both are true:
  the system-audio line is a nudge about a tick box the user can tick next time and the greyed
  System meter carries its own weaker wording for the rest of the take, while this names a source
  that is simply gone.

**`RECORDING_UNAVAILABLE`** covers three more paths through the same channel, on any row —
companion or primary. `useRecordingLibrary`'s `handlePlayRecording` and `handleDownload` each
raise it, and re-run `refreshStorageSpace()`, when `getVideoBlob` answers `undefined` for a row
the library still shows: the row is drawn from metadata the store still holds, but its bytes are
gone — typically a recording deleted from ARTIST's media library in another tab, which removes
the shared IndexedDB row without telling this one (ESCSUITE-146). Before this, both handlers did
nothing at all: no dialog, no file, no explanation, while the row kept showing its name, duration,
size and thumbnail. Nothing is disabled either way — the ruling is that a row whose blob is
missing is still deletable — only Play and Download now say so instead of the silent no-op.
`useMp4Download`'s `startMp4Download` raises the same notice for the same fact (ESCSUITE-176): a
row whose `getVideo()` read comes back with no `blob` returns from the conversion instead of
handing the converter nothing, which used to flash "Starting conversion… 0%" and silently return
to idle with no file and nothing said — one MP4/M4A guard covers both formats, same as everything
else in that hook.
