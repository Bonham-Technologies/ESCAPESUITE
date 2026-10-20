<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# MP4 Export Reliability (`src/core/exportMP4.ts`)
MP4 export includes robust error handling and codec compatibility:
- **H.264 codec validation**: Uses `VideoEncoder.isConfigSupported()` to verify codec support
  before encoding — and since ESCSUITE-175 **before mixing the audio, loading any media or
  starting the muxer**, so a browser that cannot encode H.264 pays for none of it. A refusal is
  `ExportError(MP4_NO_CODEC_REASON)`, the dialog's own sentence
- **AAC validation, in the same breath**: `isAudioCodecSupported(aacEncoderConfig(…))` right after the
  video ladder. No AAC encoder means the sound cannot be carried however long it is mixed, so
  `extractAndMixAudio` is skipped outright, `noAudioNote('mp4')` goes out through `onProgress`, and
  the result carries `audio: false`. It used to be probed deep inside the export, where a refusal
  set `audioData = null` behind a `console.warn` and the export reported "Export complete!" over a
  silent file (ESCSUITE-175; Firefox 155 is the browser, measured 2026-10-02)
- **Codec fallback chain**: `mp4VideoCodecConfigs(width, height, bitrate, frameRate)`
  (`exportTypes.ts`, so the dialog's probe and this `configure()` read one list — ESCSUITE-175)
  tries five H.264 profiles across two hardware-acceleration passes — `prefer-hardware` first,
  then `no-preference` so the headless/CI path works without a GPU. Each
  pass walks High Profile (`avc1.640028`) → Main Profile (`avc1.4d0028`) → Baseline Profile
  (`avc1.42001f`) → High Profile Level 5.1 (`avc1.640033`) → Main Profile Level 5.1
  (`avc1.4d0033`); the first three are Level 4.0/3.1, which `isConfigSupported` rejects above
  1920x1080, so the two Level 5.1 entries are listed last and exist to cover 1440p and 4K
- **Encoder error tracking**: Captures errors from encoder callbacks and propagates them instead of silent failures
- **Backpressure timeout**: 30-second timeout on encoder queue wait to detect stuck encoders, via
  the same `waitForEncoderBackpressure()` (`exportTypes.ts`) `exportWebM.ts` calls — see "WebM
  Export Reliability" below for why it is one function rather than two copies of the same loop
- **Quality-based audio bitrate**: Audio bitrate scales with quality setting (128k/192k/256k) instead of hardcoded value
- **Error checkpoints**: Validates encoder state at loop start, during backpressure, and before finalization
- **The decode worker starting up can no longer hang the export (`core/videoDecodeManager.ts`,
  `core/frameSource.ts`, `core/frameManager.ts`, ESCSUITE-153 / ESCSUITE-29 Mechanism 2).**
  `VideoDecodeManager.initialize()` used to resolve only on the worker's `WORKER_READY` message;
  a worker that never started — missing from a standalone download (its own fix is below), blocked
  by a CSP, or that fired `error`/`messageerror` instead — left the promise unsettled forever, and
  `FrameSourceFactory.initialize()` awaited it directly, so the export parked at "Loading media
  files…" with nothing thrown, nothing logged, and no way for Cancel to free it (`checkAborted()` is
  only consulted at points the export had not yet reached). `initialize()` now always settles:
  reject immediately on the worker's own `error` or `messageerror` event (the message names the
  worker), reject after a bounded 10s timeout if it posts nothing at all, and reject immediately if
  an optional `AbortSignal` is already aborted or aborts while the wait is pending — threaded down
  from `exportToMP4`'s own `signal` through `createFrameManager` so Cancel does not have to wait out
  the full timeout. `FrameSourceFactory.initialize()` catches that rejection, logs it, and sets
  `useWebCodecs` false instead of letting it escape — so `createSource()` takes the HTMLVideoElement
  path for every source, the same degradation it already takes per-source for an unsupported codec,
  rather than failing or hanging the whole export.

`exportWebM.ts`'s `encode()` call (ESCSUITE-131) is wrapped in
`try { videoEncoder.encode(frame, { keyFrame }) } finally { frame.close() }`, mirroring the
frame-closing shape of MP4's own encode block (which closes the canvas-drawn frame on both its
success and its fatal-retry paths): an encoder that throws mid-export no longer leaves the frame
it was encoding for the GC to finalise on top of the error that is already failing the export.
