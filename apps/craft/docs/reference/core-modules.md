<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring (see
  "Audio level meters" for the 80 ms gate both recorders apply)
- `webcodecs-recorder.ts`: VideoEncoder/AudioEncoder + Mediabunny recorder for every take that
  is neither composited PiP nor audio-only
  (see "Frame timestamps and keyframes" for the recording clock every frame is stamped with) —
  and, for a separate-tracks take, a list of companion pipelines beside the primary
  (`CompanionPipeline`): a `VideoEncoder` and its own Mediabunny output for the webcam, with its
  own `FrameTiming`, and an `AudioEncoder` and its own Opus-only output for each audio source the
  take really has — all of them on that same clock, and none of them taking the mixed audio off
  the primary
- `audioWorkletCapture.ts`: `createAudioCapture()` — how every audio pipeline of a WebCodecs take
  (the mix and each audio companion) takes its audio off the graph: an AudioWorklet where the
  browser has one, the ScriptProcessorNode and ESCSUITE-296's gap filler where it does not (see
  "Frame timestamps and keyframes" → "The audio capture: an AudioWorklet, with a fallback")
- `audioGapFiller.ts`: ESCSUITE-296's silence for callbacks the page never saw — the
  ScriptProcessorNode fallback's only, since ESCSUITE-299
- `webcodecsSupport.ts`: `isWebCodecsRecordingSupported()` and `canRecordSeparateTracks()` — the
  two synchronous capability questions, in a module that imports nothing, so a *component* can
  ask one without pulling `mediabunny` into its graph (`WebcamOverlaySettingsPanel` does).
  `webcodecs-recorder.ts` re-exports the first, which is where it used to live
- `recorder-factory.ts`: `createRecorder()` / `canUseWebCodecsRecorder()` /
  `getRecorderType()` — picks between the two recorders for a take. WebCodecs unless the
  take is **composited** PiP (the compositor's hidden video elements break its frame capture)
  or has no video track at all (an audio-only take, which `WebCodecsRecorder` cannot serve);
  MediaRecorder otherwise. `separateTracks` is the third input and the one case where a PiP
  take *does* reach WebCodecs — nothing captures frames through the compositor there, so the
  reason for the exclusion does not apply. `getRecorderType()` returns that same decision as
  `'webcodecs' | 'mediarecorder'`, which is what the controller puts in `recorderTypeRef`
  and what the save path branches on to decide whether the blob needs repairing
- `permissions.ts`: Environment capability detection with detailed unavailability reasons
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen, throttled to
  the take's target frame rate by the deadline gate described under "The PiP frame gate".
  `start()` returns the recorded `captureStream`; `startPreviewOnly()` is the same draw loop
  with no capture, for a separate-tracks take where the canvas is only what the user watches.
  The overlay it draws is `core/overlayGeometry.ts`'s `drawOverlay()`, not its own method.
  `stop()` (and so `dispose()`) also stops that `captureStream()`'s own tracks (ESCSUITE-137):
  no caller ever did — `useRecordingController` folds the output stream's video track into
  `recordingScreen` and `useMediaStreams.stopAllStreams()` only stopped the raw screen/webcam/
  mic streams before disposing the compositor — so a composited PiP take's canvas capture
  track, and the (up to 1280-wide) canvas it kept reachable, used to outlive the take entirely
- `overlayGeometry.ts`: `drawOverlay()` — where the webcam sits in a frame and how it is
  drawn there (the 16:9 derivation, the four corners, the circular centre-crop, both clip
  paths, the border) — plus `overlayGeometryFor()` / `overlayPaddingFor()` and **five** constants:
  `COMPOSITOR_MAX_WIDTH`, `DEFAULT_OVERLAY_PADDING`, and the camera's own
  `OVERLAY_BORDER_COLOR` / `OVERLAY_BORDER_WIDTH` / `OVERLAY_CORNER_RADIUS` — the last three
  named (ESCSUITE-65) because ESCAPEARTIST now reproduces that border on a handed-over webcam
  clip and names the same numbers on its side (`OVERLAY_STROKE_COLOR`,
  `OVERLAY_STROKE_WIDTH_FRACTION`, `OVERLAY_CORNER_RADIUS_FRACTION` in
  `apps/artist/src/utils/overlayPlacement.ts`), so a change to the border here cannot silently
  stop matching what the editor draws. Naming them changed no pixel: the compositor's preview, a
  composited PiP recording and a re-composited MP4 all paint what they painted before. Pure: no
  element lookup, no canvas creation, no state, no `this`. It exists because **two** things draw
  this overlay — `Compositor` live, and `convertToMP4` offline from a second *file* — and a
  rounding difference between two copies would only ever be visible in a downloaded MP4.
  `CompositorConfig` is an
  alias of its `OverlayGeometry`, so the live loop passes `this.config` straight through and
  allocates nothing per frame. Nothing mocks it, which is what keeps `compositor.test.ts`
  exercising the real geometry
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction. Its size, type
  and quality constants are **imported from `utils/previewThumbnail.ts`**, not declared here:
  five suites (`App.settings`, `App.saving`, `App.recording`, `App.library`,
  `hooks/useRecordingSave`) `vi.mock('./core/thumbnailGenerator')` wholesale, so a constant
  declared in this module would vanish under the mock. `utils/previewThumbnail.ts` is never
  mocked, which is what makes it the single definition — keep it that way.
  **Both `cleanup()` helpers null `onloadeddata` and `onerror` before they release the
  element, and must keep doing so.** Emptying a media element's `src` is a *load failure*,
  not a release: the resource selection algorithm jumps to "failed with attribute" and fires
  an `error` at the element. A handler still attached there re-enters the very cleanup that
  emptied `src`, which empties it again — and the detached element then spins
  error → cleanup → error for the life of the page. That was ESCSUITE-55: measured at
  ~44,500 iterations a second, started by the first saved take of a session, and it left the
  tab ~87% busy doing nothing for the rest of the session. The release itself is
  `removeAttribute('src')` + `load()` rather than `src = ''` for the same reason — with no
  `src` attribute and no `srcObject` the algorithm ends at `NETWORK_EMPTY` with **no `error`
  and no `MediaError`**. (It is not silent: `load()` queues `abort` and `emptied` on the way
  there. Nothing listens for either, and neither can re-enter a cleanup; the property that
  matters is that no `error` is manufactured.)

  **Removed (ESCSUITE-138):** `generateStreamThumbnail(stream: MediaStream)`, a live-preview
  thumbnail path that was present, tested and called by nothing — the save path's thumbnail is
  `utils/previewThumbnail.ts`'s `drawThumbnail`, reached through
  `useRecordingController.captureThumbnail`. It also differed from its two siblings in ways
  that would have mattered had it ever been wired: it settled only from a `srcObject`'s
  `onloadeddata`/`onerror`, so a stream that never produced a frame left the promise pending
  forever (no timeout, unlike `extractVideoMetadata`'s 5 s one), and its 100 ms `setTimeout`
  called `ctx.drawImage` unguarded, where a throw would have stranded the promise rather than
  rejected it. Deleted with its suite and the `appDoubles.ts` double's entry rather than fixed,
  on the operator's decision, the same as ESCSUITE-85's `remuxToWebM`.
- `converter.ts`: `fixWebMMetadata()` — the WebM container repair a **MediaRecorder** take
  goes through at save time (a WebCodecs take needs none; see "WebM Handling"): `webm-duration-fix`
  and then `webmCues.ts`'s `writeKeyframeCues()`, the keyframe Cues index (ESCSUITE-322) — plus
  `convertToMP4()`, `convertToM4A()` (the audio alone, AAC in an MP4 container; the two share
  the private `encodeAudioChunks()` AAC pass) — `convertToMP4()`'s fourth optional argument is
  the take's camera half, which makes it the composite (see "Download Formats") — the `probeMP4Support()` codec probe both
  buttons are gated on (H.264 fatal for MP4, AAC only silencing there and fatal for M4A), and the
  `isMP4ConversionSupported()` presence check the conversion guards itself with, and
  `resolveFixWebmDuration()`, the hand-written CJS interop the repair's import needs (see
  "WebM Handling"). The library
  row's MP4 download reaches them through `hooks/useMp4Download.ts`. The compatible-WebM
  re-encode (`remuxToWebM`) that once lived here was deleted in ESCSUITE-85: nothing called
  it, and the stored WebM is already seekable.
