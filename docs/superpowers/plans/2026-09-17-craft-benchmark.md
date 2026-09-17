# ESCAPECRAFT browser benchmarks

**Goal:** give ESCAPECRAFT the same measured footing ESCAPEARTIST has — real-browser
benchmarks in `pnpm perf` whose numbers a CRAFT performance change can be argued from in
milliseconds, alongside the counts the `*.perf.test.ts` ceilings already enforce.

**Spec:** none — this plan is the authority. It follows the measurement discipline in the
root `CLAUDE.md` ("Performance benchmarks") and `docs/performance/2026-09-12-baseline.md`.

## Global constraints

1. **No app code for the benchmarks' sake.** Nothing under `apps/craft/src` changes. Every
   number is taken from outside the page: `addInitScript` wrappers, a `PerformanceObserver`,
   a CDP session. The take is driven through the UI exactly as `apps/e2e/tests/escapecraft/
   mp4-download.spec.ts` and the journey drive it.
2. **Measure, never assert.** No CPU-speed thresholds. The only `expect`s are tripwires
   that say a benchmark measured the wrong thing (a take that was not recording for the
   whole window, a "WebCodecs" take that encoded zero frames, a conversion that produced no
   file) — the same principle as `measurePlayback`'s still-playing check.
3. **Informational only.** The CI `perf` job stays `continue-on-error`, out of `ci-status`.
4. **Existing benchmarks byte-unchanged in behaviour.** `preview-playback`,
   `timeline-interaction`, `export-*`, `visual` and the kit benchmark keep their numbers,
   names and JSON shape. `utils/perf.ts` may gain exports but no existing export changes
   signature. Prefer a new `apps/e2e/utils/craftPerf.ts` over growing `perf.ts` (1,089
   lines already).
5. **Every new JSON key is labelled in `scripts/perf-report.mjs`'s `METRICS`** so it renders
   in the table; unknown keys render raw and that counts as a defect.
6. **Docs in the same PR:** root `CLAUDE.md` "Performance benchmarks", `apps/e2e/README.md`
   perf section, `apps/craft/CLAUDE.md` perf bullet, `playwright.perf.config.ts` header
   comment, and a new `docs/performance/2026-09-17-craft-baseline.md`.
7. Lint (`pnpm --filter @escapesuite/e2e lint`) and typecheck (`pnpm --filter
   @escapesuite/e2e typecheck`) clean. e2e ESLint is ES2022.

## What the app does, so the benchmark measures the right thing

- A **screen-only take** goes through `WebCodecsRecorder` (`apps/craft/src/core/
  webcodecs-recorder.ts`): a `MediaStreamTrackProcessor` reader on the main thread hands
  each `VideoFrame` to `VideoEncoder.encode` (keyframe every `frameRate` frames), Mediabunny
  muxes. So the existing `VideoEncoder.prototype.encode` wrapper in
  `installPerfInstrumentation` counts every recorded frame, and CDP `TaskDuration` includes
  the encode submissions. An rAF loop runs the audio level monitor (80 ms gate).
- A **PiP take** (screen + webcam) goes through the `Compositor` (`core/compositor.ts`): an
  rAF loop throttled to 30 draws/s, each draw = `drawImage(screenVideo)` +
  `drawImage(webcamVideo)` into a canvas whose `captureStream(30)` feeds **MediaRecorder**
  (`recorder-factory.ts` forces MediaRecorder for PiP). Encoding is off the main thread;
  `TaskDuration` is compositor + React. `recorder.ts` also runs an rAF level monitor, so a raw
  rAF count is two loops, not one — count composited frames by wrapping
  `CanvasRenderingContext2D.prototype.drawImage` and counting calls whose first argument is
  an `HTMLVideoElement` (`videoDraws`), two per composited frame.
- **MP4 conversion** (`core/converter.ts`, `convertToMP4`): plays the WebM in an offscreen
  `<video>` with `requestVideoFrameCallback`, `drawImage` → `new VideoFrame(canvas)` →
  `VideoEncoder.encode` (main thread), AAC via `AudioEncoder`, Mediabunny mux. Real-time
  bound by design, so wall time ≈ take length + prepare + finalize; frames/s against the
  take's frame rate says whether it keeps up. Driven by the "Download … as MP4" button; the
  file arrives as a Playwright `download`.
- Capture devices come from `mockSyntheticMedia(page, {width, height})`
  (`utils/media-mocks.ts`): a canvas animated by a 33 ms `setInterval` on the page's own main
  thread plus an oscillator. **That interval's fillRect + fillText is inside every measured
  window.** It is the same in every arm of a comparison and small next to a 720p encode, but
  the baseline doc must say so. Use **1280x720** capture so the encode is a real one.
- Countdown default is 0 (`recorderStore.ts`), so a take starts on the click. "Start
  recording" → "Pause recording" visible means recording; "Stop recording" → the row with
  "Open … in Editor" means saved to IndexedDB. Source toggles: `aria-label` `Screen`,
  `Webcam`, `Microphone`, `System Audio`; wait for the Screen toggle to be enabled before
  the first click (capability detection is async). Screen is on by default; PiP = click
  `Webcam` on too.

## Task 1 — harness, three benchmarks, report, config, docs

### Files

- `apps/e2e/utils/craftPerf.ts` (new): `CRAFT_URL` (`http://localhost:5174`),
  `TAKE_SECONDS = 6`, `TAKE_WARMUP_SECONDS = 1`, `CAPTURE_SIZE = {width:1280, height:720}`,
  `installCraftPerfInstrumentation(page)` (calls `installPerfInstrumentation` then adds
  the `drawImage` wrapper → `window.__perfCraft.videoDraws`, reset alongside `__perfReset`
  — or extend the existing counter bag in `perf.ts` if that is cleaner; either way
  `__perfReset` must clear it), `openCraft(page, {webcam: boolean})` (mockSyntheticMedia at
  CAPTURE_SIZE, grantMediaPermissions, goto, wait for the Screen toggle enabled, click
  Webcam if asked and wait for it to be pressed/enabled), `measureTake(page, cdp, opts,
  profileName?)`, `measureMp4Conversion(page, cdp, profileName?)`.
- `apps/e2e/tests/perf/craft-recording.spec.ts` (new): three `test()`s — screen take, PiP
  take, MP4 conversion — each its own page load, each writing its own JSON, each with the
  `PERF_PROFILE` fourth discarded run (`craft-screen`, `craft-pip`, `craft-mp4` profiles).
- `apps/e2e/scripts/perf-report.mjs`: `ORDER` gains `craft-screen-recording`,
  `craft-pip-recording`, `craft-mp4-conversion` after `export-webm`; `METRICS` gains
  `mode`, `recorder`, `captureSize`, `taskMsPerFrame` (ms), `videoDrawsPerSecond`,
  `compositedFps`, `rafPerSecond`; `headline()` gains a `compositedFps` branch before the
  `framesPerSecond` one; `PROFILE_LABELS`/`PROFILE_ORDER` gain the three profiles.
- `apps/e2e/playwright.perf.config.ts`: second `webServer` entry for CRAFT on strict 5174;
  header comment updated (it currently says only ARTIST is started).
- Docs (constraint 6). The baseline doc is Task 2.

### `measureTake(page, cdp, { webcam }, profileName?)`

1. `__perfReset()`; click "Start recording"; wait for "Pause recording" visible (30 s).
2. Warm-up `TAKE_WARMUP_SECONDS`: half, `readHeapAfterGc`, half (as `measurePlayback`).
3. `readCdpMetrics`; read `{raf, encode, videoDraws, now}` from the page; window =
   `withCpuProfile(... waitForTimeout((TAKE_SECONDS - TAKE_WARMUP_SECONDS) * 1000))`.
4. `readCdpMetrics`; read counters + long tasks by start time (same attribution rule and
   comment as `measurePlayback`).
5. **Tripwire:** "Pause recording" still visible (the take was recording for the whole
   window). Click "Stop recording"; wait for the "Open … in Editor" button; `readHeapAfterGc`.
6. **Tripwire per mode:** screen (`webcam: false`) must have `framesEncoded > 0`, else fail
   with "the screen take did not go through WebCodecsRecorder — nothing was encoded on the
   main thread". PiP must have `videoDraws > 0`, else "the PiP take did not composite".
7. Output bytes: newest recording's blob size from IndexedDB `video-editor-db/videos`
   (the journey's `readRecordingBytes` shows the shape; read only `blob.size`, do not
   base64 the file). Report as `outputBytes`.
8. Return: `framesEncoded`, `framesPerSecond` (encoded / window s; PiP reports 0 — its
   frames are MediaRecorder's), `videoDraws`, `videoDrawsPerSecond`, `compositedFps`
   (`videoDrawsPerSecond / 2`, with the two-draws-per-frame reasoning in a comment —
   screen mode reports 0), `rafPerSecond`, `taskDurationMs`, `taskMsPerFrame`
   (task / framesEncoded for screen, task / composited frames for PiP), `layoutCount`,
   `recalcStyleCount`, `longTaskCount`, `longTaskTotalMs`, `heapDeltaBytes`,
   `encoderQueueHighWater`, `outputBytes`.

Each run is a fresh take on the same page (the recordings list accumulates three rows;
that is what a user's third take sees too — say so in a comment).

### `measureMp4Conversion(page, cdp, profileName?)`

Precondition: one screen take exists (the spec records one with `measureTake`'s driving
steps, or a plain 6 s take — no measurement needed). `test.skip(!(await canConvertToMp4
(page)))` as the MP4 spec does. Then per run: `__perfReset`, `readHeapAfterGc`, click
`/Download .+ as MP4/` (the newest row — `.first()` or scope to the row), `waitForEvent
('download')` inside `withCpuProfile`, wall time click→download, counters (`framesEncoded`,
`encoderQueueHighWater`), `taskDurationMs` across the window, heap after GC, `outputBytes`
from the download stream (as `measureExport`), `download.delete()`, then wait for the
progressbar to be gone and the button enabled again. Return `wallMs`, `framesEncoded`,
`framesPerSecond`, `taskDurationMs`, `taskMsPerFrame`, `heapDeltaBytes`,
`encoderQueueHighWater`, `outputBytes`.

### JSON written

- `craft-screen-recording`: `runs`, `mode: 'screen'`, `recorder: 'webcodecs'`,
  `captureSize: '1280x720'`, `windowSeconds`, medians of the numbers above
  (`encoderQueueHighWater` as the max, like `export.spec.ts`).
- `craft-pip-recording`: `mode: 'screen + webcam (PiP)'`, `recorder: 'mediarecorder'`,
  same shape.
- `craft-mp4-conversion`: `runs`, `captureSize`, `windowSeconds: TAKE_SECONDS` (the take's
  length, which bounds the conversion), medians.

### Verification

- `pnpm --filter @escapesuite/e2e exec playwright test --config=playwright.perf.config.ts
  craft-recording` runs green locally and writes the three JSON files; `node apps/e2e/
  scripts/perf-report.mjs` renders every key with a label (no raw keys). Paste the rendered
  CRAFT sections into the report file.
- Sanity-check the counts against the app's design and write what you saw in the report:
  screen take ≈ 30 encoded frames/s; PiP `rafPerSecond` ≈ 120 (two 60 Hz loops) and
  `videoDrawsPerSecond` ≈ 60 (30 composited frames × 2 draws); conversion frames ≈ the
  take's frames and wall ≈ 6–8 s. If a count disagrees with this reasoning, find out why
  before choosing what to report — do not paper over it with a different divisor.
- Full `pnpm perf` still runs every existing benchmark and the kit, and the merged
  `perf-report.json` lists the three new rows between `export-webm` and
  `headless-kit-render`.
- `pnpm --filter @escapesuite/e2e lint` and `typecheck` clean.

## Task 2 — baseline doc

`docs/performance/2026-09-17-craft-baseline.md`, in the shape of
`docs/performance/2026-09-13-timeline-baseline.md`: machine, Chromium version and launch
args, the three tables from **three consecutive `pnpm perf` runs** (so the doc shows the
spread, not one number), what each metric means and which one a fix should move, the
synthetic-source confound, the two-draws-per-frame assumption behind `compositedFps`, the
level-monitor rAF loop in `rafPerSecond`, and the note that conversion is real-time bound
by `requestVideoFrameCallback` (so its wall time is a floor set by the take length, and
`taskMsPerFrame` is the number a converter change moves). Link it from the root
`CLAUDE.md` beside the other baseline docs. Commit separately from Task 1.
