# Changelog

## 2.11.9

### Patch Changes

- e7aa7d7: A conversion whose video cannot start playing now tears itself down like every other failure: a refused `play()` goes out through the converter's one failure exit, cancelling the frame callback it had just requested on the `requestVideoFrameCallback` path (the animation-frame fallback never gets as far as scheduling one), pausing both the screen and (on a composite) the camera element, reporting the camera part that never drew a frame, and dropping the abort listener — then rejecting with the play error itself, as it always did.

## 2.11.8

### Patch Changes

- 28db367: A conversion that hits an error while reading frames now fails with that error instead of staying on "Converting…" forever.
  
  Every frame of an MP4 or composite conversion is drawn from a browser callback — a `requestVideoFrameCallback`, an animation frame, an `ended` listener — and the browser swallows a throw out of one of those: it is reported to the page, and nothing else happens. The next frame was never requested, the capture promise never settled, so the conversion's one `finally` never ran, every encoder it had built stayed open and the recording row never left "Converting…". A `drawImage` or an overlay draw from an element that has errored, and a `VideoFrame` built on a zero-sized canvas, all raise exactly that; ESCSUITE-74 removed the one cause that was reachable in practice (a dead encoder's `encode()`), and this covers the shape whatever the cause.
  
  Each of those callback bodies now takes the same exit the cancellation path takes — stop the loop, stop both elements, stop listening, reject with what was thrown — so the failure reaches the library as `Conversion failed: …` and the encoders are released. Pinned by one arm per callback and per path in `converter.test.ts`, each with a one-second timeout, because a regression here is a hang (ESCSUITE-78).

## 2.11.5

### Patch Changes

- 0357ffa: A cancelled or failed MP4/M4A conversion no longer leaves hardware encoders open, and an encoder failure now says what the encoder said.
  
  Every `VideoEncoder`/`AudioEncoder` a conversion builds is registered and released in that conversion's one `finally`, guarded on the codec having not already closed itself — the `close()` calls used to sit on the success path, after the flush, where a cancellation or a failure part-way never reached them.
  
  And an asynchronous codec failure now reaches the caller. The `error:` callbacks only wrote a console line, so the conversion carried on handing frames to a dead encoder — whose `encode()` throws from inside a `requestVideoFrameCallback`, where nothing catches it, so the conversion hung, holding every other encoder open, and the row never returned to idle. The callback now aborts the work in flight and the conversion rejects with the codec's own error, so the library says `Conversion failed: <what the encoder said>` instead of nothing at all. No file is muxed out of an encoder that has died, and cancelling still outranks a failure: a conversion the user cancelled raises no notice, exactly as before.
  
  Ceilings for it are exact in `converter.perf.test.ts` — encoders built against encoders released, on the success, cancellation and encoder-failure outcomes of all three conversions (plain MP4, composite MP4, M4A) — and the WebCodecs test double is now strict about a second `close()`, the way the real API is (ESCSUITE-74, closing the tripwire ESCSUITE-66 had to leave lenient).

## 2.11.3

### Patch Changes

- 98bd2f7: Leaving the recorder while it is still setting up no longer leaves codecs, outputs and an
  audio graph behind, and no longer reports a failure for a recording that never existed.
  
  `WebCodecsRecorder.initialize()` awaits half a dozen times — the capture `<video>` starting,
  the AudioContext resuming, the muxer's `Output.start()`, each codec's `configure()`, each
  companion pipeline — and a take can be thrown away inside any one of those awaits: closing or
  navigating away from the recorder calls `dispose()` synchronously while the start it is parked
  on carries on underneath, and so does the recorder itself when the capture ends mid-setup. The
  teardown had already run and cleared its registries by the time the parked step resolved, so
  everything setup went on to build afterwards was built into a recorder nothing would ever tear
  down again: a second AudioContext with its own node graph, up to four Mediabunny outputs
  holding their encoders and their targets open, up to five codecs each holding a hardware
  encoder session, and a capture-track listener that could no longer be removed. Setup then
  walked into one of the fields the teardown had nulled and failed — and the failure was reported
  to the user as "The recording could not be started" for a take they had already walked away
  from. The level meters got one stray zeroed reading pushed at the app on the way past, which is
  a whole re-render on behalf of a recording that no longer existed.
  
  Setting up now stops where it stands: the teardown raises a flag, every await in the setup path
  is followed by a check, and whatever the resolving step produced is released — the codec
  closed, the output cancelled — through the same registries a cancelled take uses, so the
  recorder's conservation laws (every codec closed, every started output cancelled or finalized,
  every source node disconnected) hold for this exit too. Level monitoring is now started from
  outside that path, so it cannot be reached at all once a take has been disposed. `initialize()`
  resolves quietly rather than failing, and the start path drops a countdown it can no longer run
  — a capture stopped during setup used to leave a 3-2-1 counting down over a recorder that was
  already gone — and withholds the notice, so nothing is said about a recording that never
  existed. Nothing changes for a take that is recorded, stopped and saved.

## 2.11.0

### Patch Changes

- 9a4b7ca: Internal only, with no change to what anything records or draws: the webcam overlay's border
  colour and width, and its corner radius, are now named constants in
  `core/overlayGeometry.ts` rather than literals repeated at four call sites.
  
  ESCAPEARTIST reproduces the same border on a handed-over webcam clip (ESCSUITE-65), so both
  apps now name the same numbers in one place each and a change to the border here cannot
  silently stop matching what the editor draws. The live preview, a composited
  picture-in-picture recording and a re-composited MP4 all paint exactly the pixels they did
  before — pinned by the compositor, converter and overlay-geometry suites, which are unchanged.

## 2.10.5

### Patch Changes

- e667c66: The "Record webcam as a separate track" setting is now fixed at the moment a take starts.
  
  Flipping it while a recording is running no longer changes how that take is saved: the
  recording is stored as the mode it was started in — camera placement and all — even when the
  browser loses the extra files on the way out, where before such a take was filed as though it
  had been recorded as one composited file.
  
  Internal tidy behind it: the toggle no longer borrows the capture sources' CSS class (same
  appearance, one fewer way for a test to address the wrong button), and a test that removed a
  browser API now puts it back the way it found it.

## 2.10.4

### Patch Changes

- 62597d0: A cancelled or failed separate-tracks take no longer leaves encoders, outputs or audio nodes open, and an unplugged microphone mid-take ends its own track instead of going silent.
  
  None of this is visible to a user who records, stops and saves — it is what a take that is *cancelled*, or one whose companion pipeline fails, used to leave behind. `WebCodecsRecorder` now keeps construction-order registries of the codecs, Mediabunny outputs and audio source nodes a take builds, and its teardown works through all three: every codec that is not already closed is closed (guarded, because `close()` on a closed codec throws), every output still mid-file is `cancel()`led so Mediabunny releases its encoders and its target, and every `MediaStreamAudioSourceNode` is disconnected rather than waiting for the `AudioContext` to close. A separate-tracks take was leaving five codecs, four outputs and five source nodes open per cancelled take.
  
  Alongside that: an output abandoned because its companion could not be set up, or because that companion encoded nothing, is cancelled rather than left started; each frame reader is cancelled once and dropped instead of twice; an encoder that finishes configuring after a `dispose()` is closed rather than assigned back over a torn-down recorder; and the `AudioData` of a buffer whose `encode()` throws is closed in a `finally` instead of leaking once per callback.
  
  Every companion now watches its own track's `ended`, not just the camera's: an unplugged microphone ends that pipeline where its source died — the part is finalized short, and the screen keeps recording — where before a dead source node went on feeding silence into a `ScriptProcessorNode` that went on firing, so the part came out as long as the take and inaudible for most of it. A part that was cut before its first buffer is left out of the take entirely, and the controller's existing `SEPARATE_TRACK_NOT_SAVED` notice is what tells the user.

## 2.10.3

### Patch Changes

- 5e863bf: A recording whose microphone could not be opened no longer claims to have audio.
  
  The stored `hasAudio` was the microphone *toggle*, and a toggle only asks: on a machine
  with no microphone the capability is missing, the capture comes back empty, and the take is
  recorded with no sound in it — while both of its records said it had some and the M4A
  button offered an audio download of that silence, which could only fail. The answer is now
  the track the take really acquired, resolved once when the take starts (the same fact the
  recorder builds its audio parts from and the controller counts them with), so the take, its
  parts and its buttons cannot disagree. Such a row's M4A button is now disabled and says
  why: "This recording has no audio". The system-audio half is unchanged — ticking it still
  only asks, and the browser's own share dialog still answers.

## 2.10.1

### Patch Changes

- 66e57aa: The separate-tracks toggle's storage warning now says "Not enough storage for separate
  tracks — delete a recording first," matching a mode that can write up to four files (screen,
  webcam, microphone, system audio), not two.

## 2.10.0

### Minor Changes

- ba9326e: **"Download as MP4" on a recording made with "Record webcam as a separate track" now gives you
  one file with the webcam in it** — the screen with the camera back in the corner, at the size
  and in the shape it was recorded in, circle or rounded rectangle. It is the same picture the
  preview showed you while you were recording, drawn by the same code, so the two cannot come
  out differently.
  
  The note that used to sit under such a take — "MP4 and M4A cover the screen track only — the
  webcam track is not included yet" — is gone, because it is no longer true. **M4A was never
  missing anything**: the mixed sound has always been on the screen recording, so the audio-only
  download has always been the whole take, byte for byte.
  
  Each part is still downloadable on its own as WebM from its own row, and MP4 and M4A are still
  the whole take's downloads, on the take's first row.
  
  If the webcam's own file cannot be read — cleared, deleted by hand, or unreadable — you still
  get an MP4 of the screen rather than nothing at all, and ESCAPECRAFT says the webcam is not in
  it instead of letting you find out by watching the file.
  
  **For pages that embed ESCAPECRAFT:** `UPLOAD_RECORDING` may now carry an extra
  `payload.parts` — every file of the take at once, the screen part included, each with its own
  id, role, name, bytes and start offset. `payload.id`, `payload.name` and `payload.blob` are
  unchanged and are still the screen part, so **a host that ignores `parts` needs no change and
  behaves exactly as it does today**. A host that wants the whole take reads `payload.parts`
  when it is there and falls back to `payload.blob` when it is not — it is absent for a
  recording that is a single file. The message does not get bigger in any way that matters: the
  files cross as references, not as copies. A single part's row still has its own "Upload to
  host" button, which posts that part alone, for hosts that would rather ask for one thing at a
  time.

## 2.9.0

### Minor Changes

- 8527a18: "Record webcam as a separate track" now splits the sound as well as the picture. A take
  recorded with it on produces a file per source: the screen, the webcam, the microphone and the
  system audio — whichever of them the take actually had — all from one recorder off one clock, so
  they line up by construction rather than by measurement. Each appears as its own row in the
  library under its take, labelled with the track it is ("Webcam track", "Microphone track",
  "System audio track"), playable, downloadable and deletable on its own; deleting the take
  deletes all of them.
  
  **The screen recording still carries the mixed audio**, exactly as before. Downloading the
  screen part alone gives you a complete, audible recording, and nothing about a take recorded
  without the mode changes at all. The audio files are extra — for anyone who wants to level the
  microphone against the system audio, or cut one out, in the editor.
  
  The toggle's help text says so before you choose it. It still costs about **twice the CPU and
  twice the storage**, it is still **Chromium/Edge only**, and where a browser cannot serve it the
  toggle stays on screen and disabled with the reason said out loud.
  
  A lost track never costs the take: if one source's encoder, muxer or save fails, everything else
  is still recorded, stored and listed, and the app says a separate track could not be saved. That
  one sentence replaces the webcam-specific wording, because it is now true of any of the three
  companion tracks rather than only the camera.
  
  Unchanged, and still named on the row it applies to: **MP4 and M4A of a separate-tracks take
  cover the screen track only for now** — they carry the mixed audio, so they are complete
  recordings, but the webcam track is not drawn into them yet. Download any part's own WebM from
  its row until the composite lands.
  
  **ESCAPEARTIST needs no change for this.** The handoff already resolves every part of a take by
  its `takeId` and places each one on its own track, and the microphone and system roles were
  already in the order it reads them in — so an audio part sent over arrives beside the screen and
  the camera the way the camera did.

## 2.7.0

### Minor Changes

- 7ce6894: ESCAPECRAFT can record the webcam as its own track. "Record webcam as a separate track" is a
  new opt-in in the Webcam Overlay panel, shown only while the screen and the webcam are both on
  and **off by default**: a take recorded with it on produces two files — the screen and the
  webcam — from one recorder driving two encoders off one clock, so the two are frame-aligned by
  construction. The webcam half appears as its own row in the library directly under its take,
  playable, downloadable and deletable on its own; deleting the take deletes both, and deleting
  the webcam row alone leaves an ordinary single-file take behind.
  
  It costs about **twice the CPU and twice the storage**, which the toggle says before you
  choose it, and it is **Chromium/Edge only** — it needs WebCodecs and
  `MediaStreamTrackProcessor`. Where a browser cannot serve it, or where there is not enough
  room for two tracks, the toggle stays on screen and disabled with the reason said out loud;
  the composited overlay recording is unchanged and is still what every other browser and every
  default take gets. The webcam half never costs the take its screen recording: if the camera's
  encoder, muxer or save fails, the screen recording is still stored and listed, and the app says
  the webcam track could not be saved.
  
  One interim limit, named on the row it applies to: **MP4 and M4A of a separate-tracks take
  cover the screen track only for now** — the webcam track is not included yet. Download the
  webcam part's own WebM from its row until the composite lands.
  
  For embedders: `UPLOAD_RECORDING` is still one message per library row, and its payload may now
  carry optional `role` (`'screen' | 'webcam' | 'mic' | 'system'`) and `takeId` fields — added
  only for a row that has them, so a host that knows nothing of takes receives exactly the
  `{ id, name, blob }` it received before. A single message listing every part of a take
  (`payload.parts`) is planned and will come with its own adoption note.
  
  `@escapesuite/shared`: `SourceVideo` gains five optional fields — `takeId`, `role`,
  `startOffset`, `overlayPlacement` and `hasWebcam` — and the `RecordingRole` /
  `OverlayPlacement` types beside them. The database version is unchanged and every existing
  recording is read exactly as before.

### Patch Changes

- Updated dependencies [7ce6894]
  - @escapesuite/shared@1.4.0

## 2.6.2

### Patch Changes

- e9a7a90: Two honesty fixes in the recorder.
  
  A take recorded with "System Audio" ticked in CRAFT but the tick box cleared in the browser's
  own share dialog has no sound in it at all, and is now stored as having none — both records
  are built from `microphoneEnabled || (systemAudioEnabled && systemAudioShared)`, the flag the
  controller already read off the display stream when the take started (ESCSUITE-62). Before, the
  take was marked as having audio and its M4A button offered an audio-only download of silence.
  
  And the codec probe now answers for H.264 and AAC independently: `supported`/`reason` are the
  MP4 verdict, `audio`/`audioReason` the AAC one (ESCSUITE-61). A browser with an AAC encoder and
  no H.264 encoder gets a disabled MP4 button and a working M4A one, instead of both disabled with
  a sentence about video; the silent-MP4 note reads the AAC sentence too.

## 2.6.1

### Patch Changes

- 834e059: ESCAPECRAFT: the M4A button tells the truth after a reload, and the clock stops redrawing the app
  
  Two small fixes with nothing else in common.
  
  **A recording now remembers whether it had sound.** Whether a take captured
  audio was only ever held in memory, so after a reload every recording in the
  library claimed it had some — which put an enabled M4A button on screen-only
  takes, where the conversion could only fail and say so. The answer is now
  written into the recording's stored metadata when the take is saved, from the
  same expression the library entry uses, and read back on load. Recordings saved
  before this change keep the benefit of the doubt: their M4A button stays on
  offer, and the converter still refuses the ones with nothing to convert.
  
  **The elapsed timer and the countdown no longer re-render the whole screen.**
  The duration ticks once a second for the whole length of a take, and the
  countdown three times before one; each tick used to redraw the header, the
  sources panel, the library, the preview stage and the transport bar, for a value
  that moves five characters or one digit. The two numbers now subscribe to the
  store where they are drawn, so a tick costs exactly that and nothing else —
  which matters most on the low-spec machines this tool is meant to run on. No
  visible change.

## 2.6.0

### Minor Changes

- b4946d3: ESCAPECRAFT: download a recording's audio on its own, as M4A
  
  A third download per row, beside WebM and MP4: **M4A** — the take's audio alone,
  AAC in an MP4 container (`audio/mp4`, `.m4a`). A mic-only take is already an
  audio recording, but what ESCAPECRAFT stores for it is an audio-only WebM: it
  plays, and it is not an "audio file" to most tools — and the MP4 conversion is
  no help, since a take with no picture in it fails part-way through that one.
  Now the sound of any take comes out as a file audio editors, podcast tools and
  phones open.
  
  The conversion is local, like the others — `decodeAudioData`, a WebCodecs AAC
  encode, a Mediabunny mux — and it is the tail of the MP4 conversion and nothing
  else: no playback, no canvas, no video frames, so it costs a fraction of an MP4
  of the same take. The two conversions share one slot (one at a time, whichever
  it is), one progress row with a Cancel button, and one notice channel, whose
  wording is now the format-neutral "Conversion failed: …".
  
  It is gated in the same "say why, do not hide" shape as the MP4 button, with one
  difference that follows from the format: a browser with no AAC encoder still
  writes a *silent* MP4, and cannot write an M4A at all, so there the M4A button
  is disabled with the probe's own sentence while MP4 stays on offer. A take with
  no audio in it disables M4A alone, saying so.
  
  Out of scope, and named here so it is not mistaken for shipped: the other half
  of the original request — handing microphone and system audio to ESCAPEARTIST as
  *separate* tracks — needs the recorder to write two audio tracks, which is
  ESCSUITE-14's shape and not this change.

## 2.5.2

### Patch Changes

- 8222d37: `Compositor.start()` on a running compositor now replaces its render loop instead of orphaning the first one, so a later `stop()` ends the loop rather than only the newest chain (ESCSUITE-58; defensive — nothing in the app starts a compositor twice). The previous `captureStream()` stays with whoever was handed it.
- 65438d0: Stop the endless media-error loop every saved recording left behind. From the first recording
  you saved, the tab kept a CPU core busy until you reloaded the page — a fresh recording, the
  preview and the rest of the app all had to share what was left.
  
  `thumbnailGenerator`'s cleanup emptied the `<video>`'s `src` while its own `onerror` was still
  attached, and an empty `src` is a load failure rather than a release: the browser answers it
  with an `error` event. That went straight back into the cleanup that emptied `src`, which
  emptied it again — so each saved take left a detached element spinning error → cleanup → error
  at roughly 44,500 iterations a second for the rest of the session. The handlers now come off
  before the element is released, and the release uses `removeAttribute('src')` + `load()`, which
  raises no error and manufactures no `MediaError` at all — only `abort` and `emptied`, which
  nothing listens for.
- 914829c: Fix WebM container repair, which had been failing for every MediaRecorder take since the Vite 7 → 8 upgrade.
  
  `webm-duration-fix` is CommonJS (`exports.default` plus `__esModule`), and Vite 8 changed what a default import of such a module binds to: it moved dep optimization and the build to Rolldown and aligned CJS interop with Node's, so the import yielded the whole `module.exports` object instead of the function on it. Calling it threw `TypeError: fixWebmDuration is not a function`; `useRecordingSave` caught that, raised the `NOT_SEEKABLE` notice and stored the raw blob — so PiP takes, audio-only takes and takes in any browser without WebCodecs were saved with no Duration and no Cues and would not scrub. It affected the shipped build, not just the dev server.
  
  The dependency moved to Vite 8 on 2026-03-14, so **every ESCAPECRAFT release from 2.1.0 through 2.5.1 is affected**. There is no migration: takes those builds stored are still missing their Duration and Cues and are not repaired retroactively — in-app playback papers over it with the saved duration, but the WebM itself, and any copy already downloaded, stays unseekable. Re-record it, or use the row's MP4 download, which re-encodes the take into a fresh container.
  
  `converter.ts` now resolves the import to a function itself, accepting either interop shape, and a real PiP take is recorded and checked for a finite duration in both `apps/e2e` pipelines (dev server and the combined production build) so the regression cannot come back unseen.

## 2.5.1

### Patch Changes

- d6cf29c: Composite picture-in-picture frames at the target rate, and never store a non-finite duration.
  
  The PiP compositor's render loop gated on `now - lastFrameTime < 1000 / targetFrameRate`
  and snapped `lastFrameTime` to the drawing frame's own clock. `1000 / 30` is bit-for-bit
  `2 * (1000 / 60)`, so two 60 Hz animation frames cleared a 30 fps gate with **zero** margin:
  any dispatch jitter below the ideal refused the second frame and the draw waited for a
  third, 50 ms after the last one instead of 33 ms. Real takes composited 22.4–22.8 fps
  against a 30 fps target. The gate is now a deadline with a 4 ms tolerance, advanced on the
  schedule rather than from the drawing frame's clock, with a resync so a stalled tab catches
  up instead of bursting. A PiP recording gets the frames it was always supposed to.
  
  `useRecordingSave` also hardens its duration guard. `metadata.duration > 0` on its own would
  accept the `Infinity` an unrepaired MediaRecorder WebM reports for its duration; nothing
  delivers that today — the metadata helper already maps a non-finite duration to the timed
  one — but the hook should not depend on it, so the guard is now
  `Number.isFinite(metadata.duration) && metadata.duration > 0`, falling back to the recorded
  duration as before. No behaviour change on any recording you can currently make.

## 2.5.0

### Minor Changes

- 39cf86e: Recordings can be uploaded to an embedding host
  
  Every row in the recordings library gains an "Upload to host" button when
  ESCAPECRAFT is running inside an iframe: it posts `UPLOAD_RECORDING
  { id, name, blob }` to the parent window, handing over the stored blob itself
  by structured clone. A host that cannot reach the shared IndexedDB no longer
  has to. Standalone ESCAPECRAFT never draws the button — there would be no one
  to post to — and nothing goes over the network either way. A host that offers
  this action should name itself with `?hostOrigin=`: without it the post is
  addressed to `'*'`, which hands the recording's bytes to whatever page is
  framing ESCAPECRAFT.

### Patch Changes

- b724b65: WebCodecs recordings keep A/V sync at capture rates below 30 fps

## 2.4.2

### Patch Changes

- Updated dependencies [3b0fe5f]
  - @escapesuite/shared@1.3.3

## 2.4.1

### Patch Changes

- bd0a805: The MP4 button now checks the browser can encode H.264 before offering the download, instead of failing partway; if it cannot encode AAC the MP4 is offered without audio and says so, before the conversion and again after it. It reads "Checking..." for the moment that check takes, and where H.264 is missing it stays on screen, disabled, saying why.

## 2.4.0

### Minor Changes

- 4d62686: Download recordings as MP4 (H.264 + AAC) again — converted locally in the browser with progress and cancel; WebM stays the instant option.

## 2.3.11

### Patch Changes

- 7609a12: Lower CPU use while recording: only the audio meters redraw when levels change. The rest of the recorder — the header, the recordings list, the preview stage and the transport bar — is no longer redrawn a dozen times a second for the length of a take.
- Updated dependencies [236a7dc]
  - @escapesuite/shared@1.3.2

## 2.3.10

### Patch Changes

- Updated dependencies [50491ce]
  - @escapesuite/shared@1.3.1

## 2.3.9

### Patch Changes

- 47f2b92: Lower CPU use while recording: the audio meters now update about 12 times a second instead of on every frame, and a recording with no microphone or system audio no longer runs a meter at all — its meters are zeroed once at the start of the take instead.

## 2.3.8

### Patch Changes

- e66fb39: Dialogs behave like dialogs, for the keyboard and for a screen reader.
  
  - **Escape closes them.** The Recording Tips dialog had no way out but the mouse; it now
    closes on Escape, as the playback dialog already did.
  - **Focus goes in, stays in, and comes back.** Opening either dialog moves focus into it,
    Tab and Shift+Tab cycle within it instead of wandering onto the app behind, and closing it
    puts focus back on the button that opened it.
  - **The recorder's shortcuts no longer fire from inside a dialog.** Pressing R while the
    Recording Tips dialog was open started a screen recording behind it, complete with the
    browser's capture prompt; P, S and Escape reached the recorder the same way. Nothing
    behind a dialog takes keys now. Inside the playback dialog, the player keeps its own keys
    — Space, M and the arrows still work.
  - **The Recording Tips can be scrolled from the keyboard.** The tips scroll and hold no
    controls of their own, so there was nothing to Tab to and no way to reach the text below
    the fold without a mouse.
  - **The live recording label, the timer and the notice line are readable.** Their red was
    4.2:1 against the app's background, under the WCAG AA minimum; it has been lifted to
    5.7:1. The record button and the recording dot keep the original brand red.
- ee3d206: The record button tells the truth, and a failure is no longer silent.
  
  - **Record is disabled until it can actually record.** It used to be live from the first
    paint, while the browser was still being asked what it can capture — an early click did
    nothing at all, with no explanation. It now waits for that answer, and stays disabled
    with the reason on screen when nothing you have switched on can be captured in this
    browser, or when there is no storage space left for another take. The R shortcut follows
    the same rule.
  - **A recording that failed to save says so.** A failed save used to look exactly like a
    successful one: nothing in the library and nothing to explain it. Failures — a save that
    did not complete, a recordings list that could not be read, a capture the browser
    refused — are now announced in the header.
  - **You are told when system audio was not shared.** Switching on "System Audio" only asks
    for it; the browser's own share dialog has a separate tick box. If it was left clear, the
    app now says so and greys the System meter instead of leaving it sitting at zero.
  - **A recording that may not scrub says so.** When the container repair fails the take is
    still saved, as before, but you are told it may not be seekable rather than discovering
    it later.
  - **Downloads no longer get cancelled in some browsers**, and re-opening a recording no
    longer shows the previous one's duration.
- 5da3ddc: Three recorder fixes:
  
  - Pressing Escape during the countdown now releases the recorder along with the capture. It used to leave the audio graph and level monitor running, so a handful of cancelled takes in a row would exhaust the browser's audio contexts and stop recording from starting at all.
  - Microphone-only recordings work again. With both Screen and Webcam switched off, starting a take failed outright in Chrome; audio-only takes now record through the MediaRecorder path.
  - Stopping the screen share at an awkward moment is handled properly for screen-only and webcam-only takes. If the recording is paused, it now finishes and saves what was captured instead of sitting in Paused over a dead capture and producing a truncated file; if it happens during the countdown, the take is abandoned and the app returns to idle instead of starting a recording with no source; and if it happens just after you press Stop, the recording is still saved rather than being reported as a failure. Picture-in-Picture takes still cannot detect the share ending — the recorder there sees the composited canvas, not the screen itself.

## 2.3.1

### Patch Changes

- f46d27a: Internal: the thumbnail size and quality constants now have a single definition, shared between the preview-thumbnail helpers and the generator.

## 2.2.9

### Patch Changes

- 2b7f5db: Internal: the recorder screen is split into focused modules; no behaviour change.

## 2.2.5

### Patch Changes

- a71c87d: Preview playback does far less work per frame: the preview canvas is rasterised at its displayed size (a 4K project now plays at full frame rate instead of ~12 fps), the timecode and timeline playhead no longer re-render the editor each tick, and scrubbing with several clips on one source no longer composites twice.
  
  The picture-in-picture compositor no longer restores its canvas state twice per frame.

## 2.2.4

### Patch Changes

- 39a8f27: - A transition with media on only one side now runs as the transition it is: a wipe clips that side to the region it should occupy and a slide moves it, instead of every type fading.
  - A dissolve blurs in the preview the way it already did in an export, so what you see on the canvas is what the exported file contains.
  - The inspector no longer reads an opaque fill whose colour happens to end in `00` — pure red `#ff0000`, black `#000000` — as "no fill": the fill button, the colour picker and the fill-opacity slider all go by the colour's alpha channel now.
  - A clip whose media has not loaded no longer takes transform handles or counts as a video in the preview.
  - A recording that is cancelled stays cancelled: a recorder that flushes its last chunk after you cancel no longer saves that take to the library.

## 2.2.2

### Patch Changes

- 38d540f: Follow-up fixes from the coverage program:
  
  ESCAPECRAFT:
  
  - Closing or navigating away from the recorder mid-countdown or mid-take left the countdown and duration timers ticking and the screen, webcam and microphone still live; everything is now released as the recorder goes away.
  
  ESCAPEARTIST:
  
  - Ctrl/Cmd + "=" and Ctrl/Cmd + "-" zoomed the timeline and swallowed the browser's own page zoom; they now reach the browser, while plain "+", "=" and "-" still zoom the timeline.
  - Re-adding media the library already holds, unchanged — as a restored session does — recorded an undo step that undid nothing.

## 2.2.1

### Patch Changes

- f2b1be4: Bugs found and fixed while bringing both apps under a coverage floor:
  
  ESCAPECRAFT:
  
  - A recording whose thumbnail could not be extracted in time leaked the blob URL it had opened.
  - Converting a recording with an already-cancelled export hung instead of stopping straight away.
  - Cancelling a conversion between its two passes left the video and audio encoders open.
  - A compositor overlay with zero padding was given the default padding instead.
  - The screen and webcam capture stayed live after a take ended, so the browser kept showing "sharing" and the camera light stayed on.
  - The microphone stayed live after a take ended, for the same reason.
  - Disposing a recorder stopped nothing, leaving its combined stream running.
  
  ESCAPEARTIST:
  
  - Starting a new project left the previous project's markers on the timeline.
  - MP4 exports played a wipe-up transition as a wipe-down and vice versa; they now match the preview.
  - Cancelling an export while it was muxing was ignored, and the export finished anyway.
  - Ctrl+B never split the selected clip, and Ctrl+V changed the active tool instead of pasting.
  - Dragging a left, right, top or bottom resize handle in the preview resized both axes at once instead of the one being dragged.
  - Restoring a session could list the same media twice in the library.

## 2.2.0

### Minor Changes

- 90969e4: Host embedding protocol for apps running inside another page (#320):
  
  - ARTIST posts `EXPORT_COMPLETE { blob, format, name }` to the parent window after a successful export (the download still happens).
  - CRAFT's "Send to Editor" posts `SEND_TO_EDITOR { id }` to the parent when embedded instead of opening `/artist/`; the host navigates to its own editor URL with `?loadVideo=<id>`. Existing embedders must listen for this message.
  - ARTIST URL parameters: `?suppressRestore=1` (no "Resume Previous Session?" prompt, and no session autosave in that session), `?title=<name>` (initial project name), `?hostOrigin=<origin>` (postMessage target and inbound origin filter; recommended for production hosts).
  - ARTIST ignores inbound messages that do not come from its parent window; the `GET_STATE` reply now returns live state.
  - The hosted deployment (escapesuite.io) now sends `Content-Security-Policy: frame-ancestors 'self'` (#321).

### Patch Changes

- Updated dependencies [90969e4]
  - @escapesuite/shared@1.3.0

## 2.1.0

### Minor Changes

- b9f8928: - Moved CI to a Node 24 baseline and cleared the outstanding `fast-uri` security advisories via a pnpm override.
  - MP4 export now works correctly above 1080p, falling back to H.264 Level 5.1 for 4K/1440p sources; headless render metadata is now accurate, and missing source files fail loudly instead of silently producing a broken export.
  - Shipped headless render bundle v2: sources stream in via file input and results stream out via download, with metadata probing for accurate render info.
  - Accessibility fixes across ESCAPECRAFT and ESCAPEARTIST, plus new demo media in the README.

### Patch Changes

- Updated dependencies [b9f8928]
  - @escapesuite/shared@1.2.1

## 2.0.0

### Major Changes

- ESCAPECRAFT is now free and open source under the MIT license.

  **Breaking changes:**

  - Removed all licensing, subscription, and account gating. There is no sign-in,
    no trial, no plan check — every feature is available to everyone.
  - Removed export watermarks. Recordings and exports are unbranded regardless of
    how the app is run.
  - Removed the license-key entry flow from the offline build. The standalone
    single-file build now runs with no key and no activation step.

  **Distribution:**

  - Offline single-file builds are attached directly to each GitHub Release,
    replacing the gated download portal. Grab `ESCAPECRAFT-2.0.0.html` from the
    latest release and open it on any machine — including air-gapped networks.

## 1.4.0

### Minor Changes

- 2f796b1: Add flexible download format options and recording improvements

  **New Features:**

  - Three download format options: WebM (Instant), WebM (Compatible), and MP4 (Universal)
  - Help modal with recording tips and best practices
  - MP4 export using WebCodecs + Mediabunny (H.264 + AAC)

  **Improvements:**

  - Improved screen capture source selection (excludes self-capture)
  - Fixed download dropdown positioning
  - Added track ended event handlers for graceful recording stops
  - Better WebM metadata using webm-duration-fix library

  **Download Options:**

  - WebM (Instant): Fast download, works in browsers and VLC
  - WebM (Compatible): Re-encoded for Windows Media Player compatibility
  - MP4 (Universal): H.264 + AAC for maximum compatibility everywhere

- f37d020: Add WebCodecs-based recorder for proper WebM container output

  - New `WebCodecsRecorder` class using WebCodecs API and Mediabunny for muxing
  - Produces properly structured WebM files that work in Windows Media Player
  - Falls back to MediaRecorder-based recorder when WebCodecs is not available
  - Added `recorder-factory.ts` for automatic recorder selection based on browser support
  - VP9 video encoding at 2.5 Mbps, Opus audio encoding at 128 kbps
  - Preserves all existing recorder functionality (pause/resume, duration tracking, audio levels)

## 1.2.0

### Minor Changes

- Add standalone licensing system with pre-licensed downloads

  ### ESCAPEPLAN

  - **Pre-Licensed Downloads**: Server-side license injection - users download HTML with license already embedded
  - **Downloads Page**: "Download (Pre-Licensed)" button for instant-use downloads, "Generic" for manual key entry
  - **Edge Functions**: `get-licensed-download` for personalized builds, `get-user-licenses` for portal, `send-license-email` for purchase emails
  - **Database Migrations**: `license_activations` table, `downloads` storage bucket

  ### ESCAPECRAFT & ESCAPEARTIST

  - **License Input Modal**: Runtime license key entry UI for standalone builds
  - **Machine Hash**: Browser fingerprinting for activation tracking
  - **Dashboard Link**: Hidden in standalone mode (no dashboard exists)
  - **Analytics**: Removed from standalone builds (runs offline)

  ### Shared Package

  - **LicenseInputModal**: Reusable license entry component
  - **machineHash**: Cross-browser machine identification
  - **Bootstrap**: Analytics excluded from standalone mode

### Patch Changes

- Updated dependencies
  - @escapesuite/shared@1.2.0

## 1.1.1

### Patch Changes

- 0020d0e: Extract analytics trackEvent to @escapesuite/shared package

  - Add @escapesuite/shared/analytics module with shared trackEvent function
  - All apps now import trackEvent from shared package
  - App-specific analytics events remain in each app

- 246a63c: Extract auth UI components (AuthGate, ErrorScreen, LoadingScreen) to shared package

  - Move AuthGate, ErrorScreen, LoadingScreen components to @escapesuite/shared/auth
  - AuthGate now accepts appName, logo, and product props for customization
  - LoadingScreen accepts appName and logo props for app-specific branding
  - Apps use thin wrapper components that provide app-specific defaults
  - Removes ~240 lines of duplicated code across craft and artist

- 8c64a95: Extract auth utilities to @escapesuite/shared package

  - Add @escapesuite/shared/auth module with:
    - Config utilities (BUILD_MODE, isSaaSMode, isStandaloneMode)
    - AuthContext and useAuth hook
    - License validation with product parameter
    - Subscription API client
  - craft/artist now import from shared package

- dc3194d: Add app bootstrap utility for consistent initialization

  - Add `@escapesuite/shared/bootstrap` with `bootstrapApp()` function
  - Handles SaaS vs Standalone mode detection and auth wrapping
  - Dynamic loading of Clerk and Sentry (excludes from standalone bundle)
  - Simplifies main.tsx in craft and artist from ~53 lines to ~14 lines

- d5477d3: Extract Sentry configuration to @escapesuite/shared package

  - Add @escapesuite/shared/sentry module with shared initSentry function
  - Support product tagging via options parameter
  - All apps now import from shared package with app-specific product tags

- 08422a9: Extract IndexedDB storage operations to @escapesuite/shared package

  - Add @escapesuite/shared/storage module with:
    - Shared database configuration (DB_NAME, DB_VERSION)
    - Common video/thumbnail operations
    - Settings operations
    - Storage utilities
  - craft/artist now import from shared package
  - App-specific operations remain in each app

- 27869d5: Extract theme system to @escapesuite/shared package

  - Add @escapesuite/shared/theme module with storage-agnostic theme utilities
  - Add ThemeToggle component to shared package
  - All apps now use the shared theme module with app-specific storage adapters
  - Reduces ~500 lines of duplicated theme code

- 4fb6bd3: Extract shared types to @escapesuite/shared package

  - Add @escapesuite/shared/types module with:
    - MediaType, MediaSource types
    - WaveformPeak interface
    - SourceVideo interface
  - craft/artist now import shared types from shared package

- 33adadf: Extract time utilities and watermark module to shared package

  - Add @escapesuite/shared/utils with time formatting functions (formatTimecode, formatTime, formatDuration, parseTimecode, etc.)
  - Add @escapesuite/shared/watermark with drawWatermark function and StreamWatermarker class
  - Apps now re-export from shared, reducing duplication
  - Removes ~200 lines of duplicated code

- Updated dependencies [0020d0e]
- Updated dependencies [246a63c]
- Updated dependencies [8c64a95]
- Updated dependencies [dc3194d]
- Updated dependencies [d5477d3]
- Updated dependencies [08422a9]
- Updated dependencies [27869d5]
- Updated dependencies [4fb6bd3]
- Updated dependencies [33adadf]
  - @escapesuite/shared@1.1.0

## 1.1.0

### Minor Changes

- b633d3e: Add Changesets for version and release management

  - Automated version bumping and changelog generation
  - GitHub Action creates "Version Packages" PR when changesets accumulate
  - All main apps (plan, craft, artist) version together

### Patch Changes

- 0b2af1f: Dependency cleanup and version synchronization

  - Remove unused gh-pages dependency and deploy scripts from PLAN
  - Sync @clerk/clerk-react to ^5.59.2 across all apps
  - Sync React to ^19.2.3 across all apps
  - Standardize TypeScript constraint to ~5.9.3 (patch-only updates)

## 1.0.0 (2026-01-05)

### Features

- add Clerk auth integration and trial watermarks ([68980e2](https://github.com/bonham-technologies/ESCAPESUITE/commit/68980e2aca94a4f5ebfe9804b290996ca016bd97))
- add playback review and download for recordings ([561d278](https://github.com/bonham-technologies/ESCAPESUITE/commit/561d278d82f39c4152c6afebbf3e892af796832a))
- add testing infrastructure and CI pipeline ([28a577b](https://github.com/bonham-technologies/ESCAPESUITE/commit/28a577b2705ca54cefc6eac0d1d34abeccea59ec))
- initial ESCAPECRAFT recorder implementation ([4939b9b](https://github.com/bonham-technologies/ESCAPESUITE/commit/4939b9be4600fba6e35d5a50ae59b2dabaf98d29))

### Bug Fixes

- handle WebM metadata extraction issues ([e35ce4a](https://github.com/bonham-technologies/ESCAPESUITE/commit/e35ce4a8822eb83cb3ac3a5b1800cef7b8a008cb))
- improve recording save reliability and audio levels ([2f5209f](https://github.com/bonham-technologies/ESCAPESUITE/commit/2f5209ff711647f1938fa3271f894e544fcbc50f))
- resolve lint errors for CI ([b96f913](https://github.com/bonham-technologies/ESCAPESUITE/commit/b96f9138b404456ac55c849ba5a8ba9f89fbb55f))
- resolve lint errors in AuthGate.tsx ([2fd6ba6](https://github.com/bonham-technologies/ESCAPESUITE/commit/2fd6ba67b80dac096b14d92362b9d7065140abe7))
- update navigation links for new URL schema ([76c0a4a](https://github.com/bonham-technologies/ESCAPESUITE/commit/76c0a4a7f138af8834841229605a77a83cdd3a98))
- WebM scrubbing support and UI overflow ([65217f3](https://github.com/bonham-technologies/ESCAPESUITE/commit/65217f3b877d60fcb84ecb7fd64d9cdc5b7a6343))
