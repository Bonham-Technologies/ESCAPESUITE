<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Recording Modes
- **Screen Only**: Display capture without audio
- **Screen + Mic**: Display with microphone audio
- **Screen + System**: Display with system audio (where supported)
- **Screen + Both**: Display with mic and system audio
- **Webcam Only**: Camera with microphone
- **Picture-in-Picture**: Screen with webcam overlay (adjustable position, size, shape)
- **Picture-in-Picture, separate tracks** (opt-in): the same sources recorded as up to **four**
  files — the screen (still carrying the mixed audio), the webcam, the microphone and the system
  audio — instead of one composited overlay

**The two PiP modes are two pipelines, and only one of them is the default.** Composited
PiP is unchanged: the `Compositor` draws the overlay, `canvas.captureStream(30)` feeds
MediaRecorder, and `fixWebMMetadata()` repairs the container at save time — which is what
the `pip-seekable` specs guard. **Separate tracks** (ESCSUITE-14, off by default, toggled in
the Webcam Overlay panel) routes the take through `WebCodecsRecorder` instead: one recorder
holding **two `VideoEncoder`s and two Mediabunny outputs**, both stamped by the one
`nextFrameTiming()` clock, so the two blobs are frame-aligned by construction rather than by
measurement — which is exactly what two MediaRecorders started back to back could not give.
Since slice 3 it holds **one `AudioEncoder` and one Opus-only output per audio source the take
really has** as well, counting their samples from the same `start()`, so the sound is split on
the same terms the picture is. The primary output keeps the mixed audio either way, so a
screen-only download is a complete, audible recording.
The compositor still runs in that mode but **only for the preview**
(`Compositor.startPreviewOnly()`, no `captureStream`); the preview *stream* the store holds is
then the raw screen, because the canvas itself is what `RecordingPreview` puts on screen.

**Which mode a take is, is decided once and handed to everything.**
`useRecordingController` computes `config.separateTracks && isPiP &&
canUseWebCodecsRecorder(true, true, true)` before the countdown, and that one answer drives the
compositor's mode, `createRecorder`, `getRecorderType()` (which is what the save path keys the
container repair off) and the config the recorder is initialized with. So a take cannot change
pipeline half-way, and a browser that cannot serve the mode cannot be left with a recorder
building a pipeline it cannot read.

The mode is **Chromium/Edge only** and says so: `canRecordSeparateTracks()`
(`core/webcodecsSupport.ts`) wants WebCodecs *and* `MediaStreamTrackProcessor`, and
`utils/separateTracksReadiness.ts` turns a "no" into the sentence on the disabled toggle —
the browser's answer first, then the storage headroom, which is measured for roughly double
the bitrate (`hasSeparateTracksSpace`, computed beside the record button's own
`hasStorageSpace` by one `refreshStorageSpace()`). **The same headroom check also reaches the
Record button** (ESCSUITE-176): the toggle's gate can refuse switching the mode *on*, but not a
take already configured for it, so before this the button stayed live and a take with no room for
two tracks started anyway, failing at the save (`SAVE_FAILED`) or losing a companion
(`SEPARATE_TRACK_NOT_SAVED`). `recordBlockedReason()` asks the same `hasSeparateTracksSpace`
question whenever the config would actually run the mode (both sources on, the toggle on), and
reuses `SEPARATE_TRACKS_NO_SPACE_REASON` rather than a reason of its own — the two gates say the
exact same sentence for the exact same fact. The webcam pipeline is deliberately
track-processor only: the primary keeps its `<video>`+canvas fallback because a take must
record *something*, and where the processor is missing the recorder warns and records the
screen alone — as it does for **every** way the webcam half can refuse to be built, including a
muxer or an encoder that will not start (see "Recorder lifecycle"). The toggle exists only while screen **and** webcam are both on, because a
webcam-only take already *is* the webcam — the recorder ignores the flag for one.

Which sources are captured is `src/hooks/useMediaStreams.ts`; what is done with them — countdown,
start, pause, resume, stop, cancel and teardown — is `src/hooks/useRecordingController.ts`.
