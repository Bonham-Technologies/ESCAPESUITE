<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Download Formats

**Three options per row, and they differ in kind rather than only in format.**

- **Download WebM** hands back the stored blob as `<name>.webm` with no conversion step.
  What is in storage is already seekable, either because the recorder wrote it that way or
  because it was repaired at save time — a Duration and a keyframe Cues index (see "WebM
  Handling") — so the download is instant
  and is never gated on anything.
- **MP4** re-encodes that blob to H.264 + AAC in the page — `convertToMP4()` in
  `core/converter.ts`: WebCodecs decode and encode, Mediabunny mux,
  `requestVideoFrameCallback` frame capture (~real-time rather than the minutes a
  seek-based loop takes) and `MessageChannel` yielding so the conversion is not throttled
  in a background tab. Nothing leaves the machine; the offline build converts with the
  same code, which `apps/e2e/tests/standalone/craft.spec.ts` asserts alongside its
  no-off-origin-requests check. **On a take recorded as separate tracks it is a
  re-composite** — see "The composite MP4" below.
- **M4A** is the take's *audio alone*, AAC in an MP4 container (`audio/mp4`, `.m4a`) —
  `convertToM4A()`, the tail of `convertToMP4` and nothing else: extract with
  `decodeAudioData`, encode AAC through the shared `encodeAudioChunks()`, mux one audio
  track. No `<video>`, no playback, no canvas, no `VideoFrame`, which is what makes it
  cheap (`converter.perf.test.ts` pins zero of each) and what lets it be offered on a take
  with no picture at all. It exists because a mic-only take is already an audio recording
  and what is stored for it is an audio-only WebM: it plays, and it is not an "audio file"
  to most tools — and `convertToMP4` is no help there: since ESCSUITE-136 it refuses a take
  with no picture outright, with `MP4_NO_VIDEO_REASON` ("This recording has no picture and
  cannot be converted to MP4 — try M4A instead."), rather than configuring a 0x0 video
  encoder and failing with whatever the browser says.

`hooks/useMp4Download.ts` owns both conversions, and the rules are:

- **One at a time, across both formats.** They are equally CPU-bound and there is one
  processor, so a second start is refused while either runs and every other row's MP4 *and*
  M4A buttons go `disabled` with `MP4_BUSY_REASON`. The row that is running shows the
  format actually running — "Converting to M4A…", "Cancel M4A conversion of …" — because
  the progress row is shared and the labels are what tell them apart.
- **The slot is never held by a row that is gone.** Deleting the recording that is
  converting used to strand the slot: the row unmounting took the progress readout and the
  only Cancel button with it, while `useMp4Download`'s `converting` and `abortRef` stayed
  set, leaving every other row's MP4 and M4A buttons `disabled` with `MP4_BUSY_REASON` for
  however long the orphaned conversion still needed (ESCSUITE-103). `RecordingsListPanel`'s
  delete handler now calls `cancelMp4Download()` first, whenever the row being deleted is
  the one converting, before handing the id to the delete it was given — the honest reading
  of "the user asked for the take to go" rather than a disabled Delete button. A conversion
  that finishes anyway, racing the delete through the same gap the cancellation test below
  documents, does not download: `startMp4Download` re-reads the record with `getVideo(id)`
  right before naming a file after it, and a recording gone from storage is worth exactly
  as little as one that was aborted.
- **Say why, do not hide.** Where the codec probe says this browser cannot encode MP4, the
  button stays on screen, `disabled`, with the probe's own sentence in its `title` and in
  the one visible note the MP4 buttons' `aria-describedby` points at. That is the
  record button's shape (see "The record button only offers what it can deliver"), and the
  reasons live beside their gate rather than in `utils/notices.ts` for the same reason
  `NO_STORAGE_SPACE` lives in `recordReadiness.ts`: nothing has gone wrong yet.
- **The gate is a real codec probe, and it is asynchronous.** `probeMP4Support()`
  (`core/converter.ts`) checks the four WebCodecs globals and then asks
  `VideoEncoder.isConfigSupported()` and `AudioEncoder.isConfigSupported()` about the
  **same** configurations `convertToMP4` will configure — H.264 `avc1.640028` at a
  representative 1280x720 (5 Mbps, 30 fps) and AAC-LC `mp4a.40.2` (48 kHz, stereo,
  128 kbps). Both are declared once, in `mp4VideoEncoderConfig()` and
  `MP4_AUDIO_ENCODER_CONFIG`, and the conversion configures from them, so the probe cannot
  drift into asking a different question than the button is gating on; the unit test "asks
  about the same H.264 and AAC configuration the conversion configures" pins that. It never
  rejects — a probe that could not answer is a `{ supported: false }` with a reason — and it
  memoises for the life of the page, so the UI asks once.
- **Two encoders, two questions, two answers, two sentences.** `supported` (with `reason`)
  is the **H.264** verdict; `audio` (with `audioReason`) is the **AAC** verdict, and it is
  answered on its own whatever H.264 said. The two `isConfigSupported()` calls were always
  both made — until ESCSUITE-61 the folding threw the AAC answer away as soon as H.264
  failed, which disabled the M4A button in a browser that could have written the file and
  titled it with a sentence about video. So a browser with AAC and no H.264 now gets
  `{ supported: false, audio: true, reason: MP4_NO_H264_REASON }`: MP4 disabled, M4A
  offered. `reason` is absent whenever `supported` is true, `audioReason` whenever `audio`
  is true, and where the probe could not run at all — no WebCodecs, or
  `isConfigSupported()` threw — *both* carry the same sentence, because neither question
  got an answer. `useMp4Download`'s two gates read one field each and never the other's:
  that is the whole point of there being two.
- **No AAC encoder is not a refusal, because the conversion does not treat it as one.**
  `convertToMP4` asks about AAC itself, and where the answer is no it drops the audio and
  muxes the video anyway — a working, silent MP4 (`converter.test.ts`, "drops audio and
  warns when AAC is unsupported"). The probe therefore answers
  `{ supported: true, audio: false, audioReason: MP4_NO_AUDIO_REASON }` there — no `reason`,
  because nothing is wrong with the MP4: the button stays
  **enabled**, and the missing sound is said as a *note* rather than as a blocked reason —
  "MP4 will have no audio in this browser (no AAC encoder)" — before the minutes are spent,
  and again afterwards through the one notice channel as `MP4_SAVED_WITHOUT_AUDIO` ("Saved
  as MP4 — without audio: this browser has no AAC encoder"). Told twice, because the first
  telling is a choice and the second is about a file they now have. Only
  `MP4_NO_WEBCODECS_REASON`, `MP4_NO_H264_REASON` and `MP4_PROBE_FAILED_REASON` disable.
- **A blocked reason and a note are two different props.** `useMp4Download` returns both,
  and `RecordingsList` takes both (`mp4BlockedReason`, `mp4Note`): the reason disables the
  button and fills its `title`, the note is the paragraph under the library that the
  buttons' `aria-describedby` points at. They differ in two places — "still checking" blocks
  without being said out loud (a paragraph that appeared and vanished on every load would
  move the page for nothing; the button still carries it in `title`), and the silent-MP4
  warning is said out loud without blocking anything.
- **"Checking..." rather than a flash.** Because the answer is asynchronous it is asked at
  capability bootstrap (`useCapabilityBootstrap`, alongside capability detection and the
  storage estimate — never on the click path) and lands in `store.mp4Support`
  (`{ state: 'checking' | 'ready', supported, audio, reason?, audioReason? }`, the probe's
  own shape with `state` in front of it). While it is `checking` the
  button is `disabled` with `MP4_CHECKING_REASON`; it then goes enabled, or disabled with
  the probe's reason. It is never enabled first and taken away: offering a conversion and
  withdrawing it a tick later is worse than waiting a tick to offer it.
  `RecordingsListPanel` selects `mp4Support` and hands it to the hook, so `App` never
  subscribes to it and the render contract below is unchanged.
  `isMP4ConversionSupported()` remains as the cheap synchronous presence check, and
  `convertToMP4` keeps guarding itself with it — that guard is a defence, not the UI's gate.
- **The probe is necessary, not sufficient — it only asks about 720p.** It asks about one
  representative 1280x720 frame, while `convertToMP4` configures the recording's real width
  and height, and `avc1.640028` is High profile **Level 4.0** — good to 1080p30 and not to
  4K. So a browser that encodes 720p but not a 3840x2160 screen capture still gets an
  enabled button and a failure part-way, landing in the notice channel as
  `mp4ConversionFailed(...)` exactly as before this gate existed. That is strictly better
  than the old presence check and is not a complete answer; the real fix is a
  profile-fallback chain like ARTIST's (`apps/artist/src/core/exportMP4.ts` tries five profiles
  — High, Main, Baseline, then High and Main again at Level 5.1 for 1440p/4K — across two
  hardware-acceleration passes), which CRAFT does not have yet.
  A second, far more common instance of the same gap (ESCSUITE-136): H.264 also refuses an
  **odd-sized** frame outright (`NotSupportedError: H264 only supports even sized frames.`),
  and the probe cannot catch that for a specific recording either — 1280x720 is even.
  `compositor.ts`'s own scaling arithmetic (`Math.round(height * scale)`) produces an odd
  height on a display wider than 1280 whose scaled height does not land on a whole even
  number, which is the *default* resolution on both current MacBook Pro sizes (e.g. 14":
  1512x982 → 1280x**831**; 16": 1728x1117 → 1280x**827**), so a composited PiP take on either
  of those was failing 100% of the time before the fix. `convertToMP4` now derives
  `encodeWidth = width - (width % 2)` and `encodeHeight = height - (height % 2)` once, and
  uses that pair for the canvas, for `mp4VideoEncoderConfig()` and — on the composite path —
  for `overlayGeometryFor()`'s frame width, so the camera lands in the frame actually being
  written. Dropping at most one row and one column is invisible in the output.
- **A stored duration that is not a usable number falls back to the recorder's own, or
  refuses** (ESCSUITE-135). Every MediaRecorder take reports `video.duration` as `Infinity`
  at `loadedmetadata` until its container is repaired (see "WebM Handling" below) — and
  `Math.ceil(Infinity * 30)` is `Infinity`, which used to make `captureFramesViaPlayback`'s
  `ended` handler loop forever, synchronously, encoding the same last frame past any bound:
  the tab stopped responding, Cancel became unreachable because the one conversion slot was
  held by a hung event handler, and the encoder queue grew until the tab was OOM-killed.
  `useMp4Download` now passes `record.metadata.duration` — already in hand from the
  `getVideo()` read it does before converting — into `convertToMP4` as `knownDuration`;
  `convertToMP4` uses `video.duration` whenever that is itself finite and positive (a stored
  duration can be *shorter* than the real playback length) and falls back to `knownDuration`
  otherwise, refusing with `MP4_NO_DURATION_REASON` before building a single encoder if
  neither is usable. The `requestVideoFrameCallback` capture path also now finishes as soon
  as it has captured its derived frame count, rather than waiting on the video's own `ended`
  event — which the rAF fallback already did, and which matters here because a `knownDuration`
  shorter than the container's real length would otherwise leave the capture waiting on an
  event that might arrive much later, or not at all while anything is watching.
- **Every encoder a conversion builds is released in one place, and a codec that dies says
  so** (ESCSUITE-74). `conversionEncoders()` in `core/converter.ts` is both halves of that,
  because they are one problem seen twice. A `VideoEncoder`/`AudioEncoder` is a hardware
  encode session and `close()` is the only way to give one back, so each conversion
  registers every encoder it constructs and its **one `finally`** closes the ones still
  open — guarded on `state !== 'closed'`, because a codec that reported an asynchronous
  failure closed itself and the real API throws `InvalidStateError` on a second `close()`.
  The `close()` calls used to sit on the success path after the flush, which a cancellation
  or a failure part-way never reaches. And an asynchronous failure arrives through the
  encoder's `error:` callback, which is on **no await path at all**: that callback used to
  only `console.error`, so the conversion kept handing frames to a dead encoder — whose
  `encode()` throws from inside a `requestVideoFrameCallback`, where nothing catches it, so
  the capture promise never settled, the conversion hung holding every other encoder open
  and the row never returned to idle. The callback now records the codec's error and aborts
  the work in flight; the conversion rejects with **the codec's own error** (so the notice
  reads `Conversion failed: <what the encoder said>`), and `throwIfFailed()` before
  `output.finalize()` covers the gap between the audio pass's every-hundredth-chunk abort
  check and the mux — a file written out of a dead encoder's packets is a truncated file
  handed over as a finished one. A **cancellation outranks a codec failure**: the user asked
  for no file, so a cancel that races an encoder death still rejects with
  `ConversionAbortedError` and still raises no notice. The accounting is pinned exactly (built
  == released, none closed twice) for the success, cancellation and encoder-failure outcomes
  of all three conversions — plain MP4, composite MP4 and M4A — in `converter.perf.test.ts`, and the WebCodecs double's `close()` is strict
  about a second close the way the real API is — which is the tripwire ESCSUITE-66 had to
  leave lenient, because the converter did not yet meet the law.
- **A throw while reading frames fails the conversion instead of hanging it** (ESCSUITE-78):
  every capture callback in `captureFramesViaPlayback` — the `requestVideoFrameCallback`, the
  `requestAnimationFrame` fallback and both `ended` handlers — runs inside `guarded()`, which
  hands a synchronous throw (a `drawImage`/`drawOverlay` from a dead element, a `VideoFrame`
  built on a zero-sized canvas) to the same `fail()` the abort path takes, so the conversion
  rejects with that error and releases every encoder rather than sitting on "Converting…" for
  the life of the tab, which is what the browser swallowing the throw used to leave behind.
  A `play()` the browser **refuses** goes out by that same `fail()` door since ESCSUITE-81 —
  it used to reject the capture directly, which settled the conversion but left the frame
  callback registered on the line above it, the abort listener attached, the element unpaused
  and, on a composite, the camera element still playing with nothing said about the picture it
  never contributed.
- **Cancelling is not failing.** Cancel aborts through an `AbortSignal`; the converter
  rejects with `ConversionAbortedError`, the row returns to idle, no file is written and
  **no notice is raised**. Any other rejection becomes `mp4ConversionFailed(message)` in
  the header's live region — the app's one notice channel, unchanged — and the WebM
  download is unaffected either way. A conversion that *succeeds* clears the channel
  (`setNotice(null)`), because an earlier "MP4 conversion failed" is no longer true; that
  clears whatever the region held, which is the price of having exactly one.
- **Abort does not always reject, so the hook checks the signal again.** `convertToMP4`
  checks the signal while it encodes, but there is none between the last frame and the
  muxer's `finalize()` — and on a take with no audio, none after frame capture at all — so
  a late cancel can come back as a finished MP4. `useMp4Download` therefore re-reads
  `controller.signal.aborted` after the `await` and returns before analytics and the
  download, rather than trusting the rejection. The unit double that always rejects on
  abort is exactly what would hide this, so one test makes it *resolve* after aborting.
- **Unmounting aborts.** The hook's one effect is a cleanup: `abortRef.current?.abort()`.
  Without it an unmount mid-conversion leaves the whole CPU-bound encode running behind a
  screen that no longer exists and then hands the user a file from it. In the shipped app
  `App` renders the panel unconditionally, so this fires at page teardown — it is a
  lifecycle guarantee, not a hot path.
- **Where the state lives is the performance contract.** `convertToMP4` reports progress
  continuously and the only pixels it moves are one row's bar, so the state is held in
  `components/RecordingsList/RecordingsListPanel.tsx`, one level below `App` — exactly as
  `SourceTogglesPanel` holds the `audioLevels` subscription. `App` never sees it;
  `App.mp4rerender.test.tsx` counts a progress tick as 0 `App` renders and 1 library
  render, and `App.rerender.test.tsx` is left alone to count the level push.

`RecordingsList` itself stays driven by props alone (`mp4Converting`, `mp4BlockedReason`,
`m4aBlockedReason`, `onDownloadMp4`, `onDownloadM4a`, `onCancelMp4`), which is what its own
test asserts.

**What is different about M4A**, and only that:

- **AAC is a hard requirement, where for MP4 it is only a preference.** `convertToMP4` drops
  the audio and muxes a silent video when the browser has no AAC encoder; there is no silent
  M4A worth writing, so `convertToM4A` refuses. The button follows: `m4aBlockedReason` is
  non-null whenever `mp4Support.audio` is false, carrying the probe's *own* sentence about
  AAC (`audioReason`, i.e. `MP4_NO_AUDIO_REASON`) so the reason on the button and the
  message from a failed conversion are one wording. It never reads `reason`: that is the
  answer about H.264, and this conversion encodes no video (ESCSUITE-61). The same browser
  therefore gets an enabled MP4 button with a note and a disabled M4A button — the two
  gates are separate props for exactly this reason — and a browser with the opposite gap
  gets a disabled MP4 button and an M4A that works.
- **A take with no audio disables it, and that gate lives in the component.** Everything
  else about the conversion is a fact about the browser and is decided in the hook; whether
  *this recording* has sound is a fact about the row, so `RecordingsList` reads
  `recording.hasAudio` and falls back to `NO_AUDIO_TRACK_REASON` ("This recording has no
  audio") when nothing app-wide is blocking. `convertToM4A` refuses the same case again with
  `M4A_NO_AUDIO_MESSAGE` — the button is the courtesy, the converter is the defence.
  (`Recording.hasAudio` is truthful across a reload since ESCSUITE-60: `buildSourceVideo`
  writes `hasAudio` into the stored `SourceVideo` from the same expression the list entry
  gets — both are handed the one answer `useRecordingSave` computes — and
  `loadRecordings()` reads it back as `m.hasAudio ?? true`. The `?? true` is for recordings
  saved *before* that field existed — they keep the answer they used to get, because
  demoting a take that did have audio would cost it its M4A button for good. That
  expression is `captured.micAcquired || (systemAudioEnabled && systemAudioShared)`: neither
  half is the toggle, because a toggle only *asks*. ESCSUITE-62 fixed the system half — the
  config alone said yes to a take whose share picker cleared the system-audio tick box, which
  is a take with no sound in it at all — and ESCSUITE-70 the microphone half, which said yes
  to a take on a machine with no microphone (`acquireStreams` back with `mic: null`), leaving
  the M4A button enabled on a promise rather than a track. It is still the streams' answer
  rather than the blob's — reading the saved file would mean a decode on the save path, and
  `convertToM4A`'s own refusal is still the defence behind the button.)
- **No new notices and no new analytics event.** Success clears the channel and failure
  raises `mp4ConversionFailed(message)`, whose wording is now the format-neutral
  "Conversion failed: …" because one code path serves both. The download is counted as
  `Recording Downloaded`, like the other two.

**Follow-up, inherited from `core/converter.ts` rather than introduced here:**

- All three downloads share one analytics event (`Recording Downloaded`), so the
  minutes-long conversion cannot be told from the instant download.

**The composite MP4** (ESCSUITE-14 decision 3). A take recorded as separate tracks is two
video files, and MP4 is the format that puts them back together: one file whose picture is
the screen with the camera drawn into the corner it was recorded in — position, size **and
shape**, the circle or rounded rectangle clipped exactly as the live compositor clips it.
The screen-only MP4 is deliberately not offered as a second option; a user who wants one
part alone downloads its WebM from that part's own row.

- **The geometry is one function, shared with the live compositor.** `drawOverlay()` in
  `core/overlayGeometry.ts` was `Compositor.drawWebcamOverlay`, moved out body-for-body (four
  renames, and one `this.webcamVideo` narrowing guard dropped as unreachable), and the
  compositor now calls it. So the numbers `compositor.test.ts` pins for the preview are the
  numbers a downloaded MP4 gets, and a change to one is a change to both — which was the whole
  point of moving it: two copies of the arc, the centre-crop and the two clip paths would be two
  places for a rounding difference to live, and the difference would only ever have been visible
  in a file somebody downloaded. `overlayGeometry.test.ts` pins the same values a second time so
  the shared function is red on its own. Nothing mocks it.
- **The inset is scaled to the frame, and it reproduces the inset that was on screen.**
  `webcamSize` is a fraction of the width and reproduces itself at any resolution; the 20 px
  padding does not. The live compositor caps its canvas at `COMPOSITOR_MAX_WIDTH` (1280)
  **only when the source is wider**, so what it draws is a flat 20 px of the *preview* canvas —
  20 px of the raw screen below the cap, and 20 px of a 1280-wide canvas above it. A
  separate-tracks take records the **raw** screen, so `overlayPaddingFor(frameWidth)` is
  `20 × frameWidth ÷ min(frameWidth, 1280)`: flat 20 at and below the cap, 30 at 1920, and at
  every width the same inset the user watched. A frame with no width answers
  `DEFAULT_OVERLAY_PADDING` rather than handing NaN coordinates to a canvas. (ARTIST's slice-2
  `utils/overlayPlacement.ts` reads the cap as unconditional — `20/1280 × frame.width`, so 10 px
  at 640 — and therefore agrees with this at and above 1280 and **disagrees below it**. ARTIST is
  out of this slice's scope; the divergence is ESCSUITE-69 item 4.)
- **The border and the corner are scaled to the frame too (ESCSUITE-144), the same way the
  inset is.** `overlayGeometryFor()` used to hand `drawOverlay` the flat module constants
  (`OVERLAY_BORDER_WIDTH` 3, `OVERLAY_CORNER_RADIUS` 8) unscaled, so a composite drawn from a
  raw capture wider than the 1280 cap showed a border and a corner at two thirds the fraction
  of the frame the live preview — and ARTIST's own `strokeForPlacement` /
  `maskForPlacement`, which already assumed craft scaled them — both agree on. `OverlayGeometry`
  now carries `borderWidth` and `cornerRadius` alongside `padding`, both filled by the shared
  `scaleToFrame(n, frameWidth)` helper `overlayPaddingFor` is written in terms of, and
  `drawOverlay` reads them instead of the constants. `Compositor` fills its own config with the
  two constants unscaled — its canvas is always at or below the cap, where `scaleToFrame` is the
  identity, so the live preview is byte-identical. `apps/artist/src/utils/overlayPlacement.test.ts`
  pins the two sides' numbers together at 1280, 1920 and 3840 wide — all at or above the cap.
  Below it, the border now agrees everywhere (craft is the identity there, and
  `strokeForPlacement` reads `max(frame.width, 1280)`), but the corner still does not:
  ARTIST's `maskForPlacement` is the unconditional `frame.width × 8/1280`, so a 640-wide
  separate-tracks take is 8 px in craft's preview and MP4 and 4 px once ARTIST places it — the
  same below-the-cap family as the inset's divergence just above, and the same ESCSUITE-69
  item 4 this slice did not touch.
- **Its audio is the primary's own track, and that is already the mix.**
  `WebCodecsRecorder` writes the microphone and system companions as a *second tap* on tracks
  the mix is already reading rather than diverting them, so the primary's audio track is the
  whole mix. The composite reads no audio from any part — one `AudioContext`, one
  `decodeAudioData`, of the primary, which `converter.perf.test.ts` pins — and **M4A on a
  separate-tracks take is unchanged, in bytes**: it was already the whole take the day slice 1
  shipped, and `convertToM4A` is untouched by this slice. The hook asks for no companion at all
  for an M4A, which its own test pins.
- **The camera's container is read before the first frame, and in parallel with the screen's.**
  The second `<video>`, its object URL and its `loadedmetadata`/`error` handlers are created in
  one synchronous step, so that header read is in flight while the conversion reads the screen's
  own metadata and extracts its audio. It is awaited once, just after the frame count is known,
  behind a `Loading the webcam track…` progress report at 3%. The promise resolves with
  `Error | null` rather than rejecting: a container that will not decode is a decision this
  function makes (draw the screen alone), not an error that escapes.
- **Sync is a shared start, not a seek per frame.** Both `<video>` elements play at 1× from
  the same moment and each captured frame draws whatever the camera element is currently
  showing. The two pictures stay within the two elements' start-up latency of each other —
  both `play()`s are issued from one synchronous block and nothing re-seeks either element
  afterwards, so that difference is constant for the run rather than accumulating, and the code
  bounds it no more tightly than that. A seek per frame is the minutes-instead-of-real-time
  cost `captureFramesViaPlayback` exists to avoid. `startOffset` shifts the camera's time base
  by deferring its `play()` until the screen has played that far — it is 0 for every take
  this recorder writes (one `start()`, one clock) and is honoured because it is stored per
  part. The per-frame guard is `overlay && overlayPlaying && readyState >= 2`, and the middle
  term is load-bearing: `preload='auto'` gets the camera element ready long before anything
  plays it, so readiness alone composited its frozen **first frame** over every screen frame
  before the offset — the exact thing the offset exists to prevent. The `play()` that a cancel
  interrupts rejects, and that rejection is swallowed, because cancelling is not a failure.
- **A camera part that cannot be used costs the overlay and not the file.** Three things reach
  that: its bytes are gone or the read itself failed (`loadWebcamCompanion` answers
  `'unavailable'`, and a read that *throws* is caught in the hook as that same answer — a
  companion never costs the primary, the ruling `uploadToHost` already takes); its container
  will not decode at all (`convertToMP4` warns and calls `onCompanionSkipped`); or its header
  parses and not one frame of it ever decodes, which no load can see — so the composite loop
  **counts the frames the overlay drew** and reports zero at `cleanup()`. That count is the only
  honest question there: `loadedmetadata` fires for a container whose pictures never arrive, and
  the element's later `error` resolves an already-settled promise. The two reports cannot
  double up — a load that failed builds no overlay to count. Either way the
  conversion **succeeds** with a screen-only MP4 — refusing after minutes of encoding would
  leave the user with nothing — and the notice channel says
  `MP4_SAVED_WITHOUT_WEBCAM` ("Saved as MP4 — without the webcam: its own track could not be
  read"). It outranks `MP4_SAVED_WITHOUT_AUDIO` when both are true, because the silent-MP4
  warning is also said *beforehand*, under the library, where a camera loss cannot yet be
  known.
- **Signature.** `convertToMP4(webmBlob, onProgress, signal?, composite?)` — a fourth
  *optional* argument (`CompositeOptions`: the `CompositeCompanion` and an optional
  `onCompanionSkipped`) rather than a second exported entry point, so every existing call is
  still three arguments, the plain path's tests and its per-frame ceilings are byte-unchanged,
  and there is one encode loop instead of two. The plain path already drew through a canvas, so
  the composite adds no canvas stage — one canvas, not one per layer. Its own per-frame ceilings
  (the appended `describe` in `converter.perf.test.ts`) are exact where they are laws — frames
  created == closed == encoded, one `flush`, two `drawImage` per frame and not three, one
  balanced `save`/`restore`, one `clip`, no `fillRect` (the screen frame covers the canvas), one
  `AudioContext` opened and closed — and 2× the measured 11 canvas calls where it is a cost,
  with the measurement and its date in the comment beside it. (The live compositor measures 12
  for the same overlay: it clears to black first, and the composite has no reason to, because the
  screen frame covers the canvas.)
- **Benchmarked separately.** `craft-composite-mp4-conversion` (`apps/e2e/tests/perf/craft-recording.spec.ts`)
  converts a separate-tracks take through the same code the plain arm measures; the gap
  between the two arms' `taskMsPerFrame` is what one overlay costs. Its tripwire is
  `videoDraws === 2 × framesEncoded`. First numbers in
  `docs/performance/2026-09-17-craft-baseline.md`.

**Removed (ESCSUITE-85):** the compatible-WebM path (`remuxToWebM`, `isWebMRemuxSupported`, a
VP9 + Opus re-encode into a fresh container) was present, tested and called by nothing from the
MP4 restore (#389) onward; its job — a seekable copy of MediaRecorder output — is done at save
time by the `webm-duration-fix` repair, and 'plays everywhere' is the MP4 download. Deleted
2026-09-26 on the operator's decision rather than wired as a fourth download.
