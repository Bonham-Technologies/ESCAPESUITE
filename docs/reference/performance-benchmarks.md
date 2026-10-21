<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Performance benchmarks

The benchmarks measure, they do not assert. `apps/e2e/scripts/perf.mjs` runs the Chromium-only
Playwright project in `apps/e2e/tests/perf/` (`playwright.perf.config.ts`: one worker, no
retries, fixed launch args) and then the headless kit's `src/perf.bench.test.ts`, then
**always** merges whatever results exist with `apps/e2e/scripts/perf-report.mjs` into
`perf-report.json` at the repo root plus a Markdown table (appended to
`$GITHUB_STEP_SUMMARY` in CI) — a failed benchmark still leaves the surviving numbers
readable, though `pnpm perf` itself then exits non-zero. `perf-results/` is emptied by the
perf project's `globalSetup` first, so a stale result can never be reported as current.
All three outputs are gitignored. `tests/perf/` also holds `visual.spec.ts`, which is not a
benchmark and does assert: a `toHaveScreenshot` pixel guard on the composited preview (self-skips
when no baseline exists for the platform — only macOS is committed) and a blur-band measurement
with no such skip, so it runs everywhere `pnpm perf` runs, CI included. It rides along in the
same `pnpm perf` invocation because it protects the same preview-rasterisation work the
benchmarks measure, not because it is one itself — a red `pnpm perf` from a moved pixel or a
blur band outside tolerance means this spec, not a benchmark or a tripwire below.

Ten benchmarks, each run three times and reported as the median: four
ESCAPEARTIST, five ESCAPECRAFT, and the headless kit render. The four
ESCAPEARTIST ones run against **one deterministic 12-clip, 13-second scene** (14 clips
over 4 tracks at 1280x720, clips scaled to fill the frame — scale 1 means native pixel
size here) built in-test from `apps/e2e/fixtures/headless/source.mp4` and loaded through
the documented integration API (`GET_STATE` for the imported source's id, then
`LOAD_PROJECT`); the five ESCAPECRAFT ones drive real takes through the recorder's own
UI against `mockSyntheticMedia`'s canvas-and-oscillator capture devices at 1280x720.
There is no app code for the benchmarks' sake in either app:

- **`preview-playback`** — 6 s of playback, first second discarded: rendered fps (counted
  by wrapping `requestAnimationFrame`), long tasks, JS heap delta after a CDP-forced GC,
  and CDP `TaskDuration` / `LayoutCount` / `RecalcStyleCount`.
- **`timeline-interaction`** — three pointer gestures over the same scene, 60 synthetic
  `mousemove`s each, with the press and the first move outside the measured window: a clip
  drag, a marquee selection and a playhead scrub. Per gesture: pointer moves, wall time,
  renderer `TaskDuration` and **JS ms per move**, **layouts and style recalcs per move**,
  long tasks and heap delta. Each gesture asserts it actually did something (the clip's
  track and offset, the clips' class lists, the playhead's offset are sampled before the
  press and after the release), so a vetoed drag cannot report a respectable cost for doing
  nothing.
- **`export-mp4` / `export-webm`** — one 720p export of the same scene through the export
  dialog: wall time, frames encoded and encoder queue high-water (both from a wrapper on
  `VideoEncoder.prototype.encode`), heap delta.
- **`craft-screen-recording`** — ESCAPECRAFT recording a 6 s screen-only take, first
  second discarded. That take goes through `WebCodecsRecorder`, which encodes on the main
  thread, so the same `VideoEncoder.prototype.encode` wrapper counts every recorded frame:
  frames encoded and per second, **renderer task per frame**, animation frames per second
  (the recorders' audio-level rAF loop), layouts, style recalcs, long tasks, heap delta and
  the stored WebM's size.
- **`craft-pip-recording`** — the same take with the webcam on, which `recorder-factory.ts`
  routes through the `Compositor` into MediaRecorder. Encoding is then off the main thread
  and `framesEncoded` is 0 by construction, so the rate reported is `compositedFps`, counted
  by wrapping `CanvasRenderingContext2D.prototype.drawImage` and halving the calls whose
  first argument is an `HTMLVideoElement` — a composited frame is exactly one screen draw
  plus one webcam draw.
- **`craft-separate-tracks-recording`** — the same take with the webcam on *and* the opt-in
  "Record webcam as a separate track" toggle clicked (ESCSUITE-14), which keeps
  `WebCodecsRecorder` but runs **two** `VideoEncoder`s on one clock into two Mediabunny
  outputs, with the `Compositor` drawing the preview only. `framesEncoded` is both
  pipelines' frames and `framesEncodedPerEncoder` splits them — attributed by encoder
  **instance identity** (a `WeakMap` keyed on the encoder, numbered in first-encode order),
  because both synthetic devices are 1280x720 and a frame's `codedWidth` cannot say which
  pipeline it came from; the screen pipeline is built and started first, so index 0 is the
  screen. Reported as `screenFramesEncoded` / `webcamFramesEncoded` beside the shared
  metrics, and it is the only arm that reports a real encode rate *and* a real
  `compositedFps`. Since slice 3 the take's sound has companions too — the microphone as its
  own Opus file beside the mix on the primary — so the arm also runs **two `AudioEncoder`s**
  and stores **three** library rows per take (screen, webcam, microphone; system audio is off by
  default and the synthetic display stream carries no audio track *as the benchmark drives it* —
  `mockSyntheticMedia` adds its oscillator to `getDisplayMedia` only when the capture asked for
  audio, which nothing here does — so there is no fourth. The ESCAPECRAFT e2e spec, which does
  click that toggle, sees four parts).
  Neither is published: the audio encoders are counted by instance identity as a tripwire and
  the row count only so the wait after Stop is for the take's last part. First numbers, and
  the re-measurement with the audio companions, in
  [docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md).
- **`craft-mp4-conversion`** — one 6 s take converted to MP4 in the page by `convertToMP4`,
  driven through the recording row's own button: wall time, frames encoded, renderer task
  per frame, encoder queue high-water, heap delta and the MP4's size. The conversion is
  bound to playback speed by `requestVideoFrameCallback`, so its wall time has a floor of
  roughly the take's length and **`taskMsPerFrame` is the number a converter change moves**.
- **`craft-composite-mp4-conversion`** — the same conversion over a **separate-tracks** take,
  which `convertToMP4` re-composites: a second `<video>` for the camera half drawn through
  `core/overlayGeometry.ts`'s `drawOverlay` into the same encode canvas, so **two**
  `drawImage(<video>)` per encoded frame. Same metrics as the plain arm plus `videoDraws`, and
  the gap between the two arms' `taskMsPerFrame` is what one overlay costs. Its tripwire is
  exact — `videoDraws === 2 x framesEncoded` — because anything else means either the overlay
  was never drawn (a plain conversion reported under this arm's name) or the screen was passed
  over twice.
- **`headless-kit-render`** — `services/headless-artist` rendering
  `fixtures/headless/project.json`, Chromium launch included.

The ESCAPECRAFT benchmarks assert nothing about speed either; their only `expect`s are the
twelve tripwires saying the benchmark measured the wrong thing — a take that stopped
mid-window; a "WebCodecs" take that encoded nothing, or that drew video into a canvas at all
(which would mean `WebCodecsRecorder` had taken its `startVideoElementCapture` fallback, a
different pipeline under the same name); a PiP take that composited nothing, or whose
`drawImage` count came out odd (which would mean a capture track was not ready for some
frames, so the two-draws-per-composited-frame divisor is wrong); a separate-tracks take that
did not run exactly two video encoders, or one of whose two encoded nothing, or that did not
run exactly two **audio** encoders (the mix on the primary plus the microphone companion — a
mode that quietly recorded its sound into the mix alone would look right in every published
number), plus the same two compositor checks now that it is drawing the preview; a
conversion that encoded no frames; and a composite conversion that did not draw exactly two
videos per encoded frame. The separate-tracks arm's wait for **three** library rows
after Stop is a thirteenth check in all but name: a take that stored a different number of parts
fails there rather than reporting a heap delta read mid-write.

`PERF_PROJECT_RESOLUTION=WxH` (e.g. `1920x1080`, `3840x2160`) overrides the preview scene's
project resolution for `preview-playback` only — the export benchmarks always render 720p
regardless — and on a machine whose sequential runs drift (observed up to several percent
across three consecutive `pnpm perf` invocations here), prefer **paired alternation** over a
plain before/after: swap base and patched code round-robin against one warm dev server and
run the benchmark spec directly, so drift affects both arms equally and cancels instead of
being charged to whichever ran second. See `docs/performance/2026-09-12-profile.md`'s "After
round 1" section for a worked example.

`PERF_PAINTER=raf` (ESCAPECRAFT's `craft-recording.spec.ts` only) swaps `mockSyntheticMedia`'s
synthetic source canvas from its default `setInterval(…, 33)` painter to a
`requestAnimationFrame` one; `apps/e2e/scripts/perf-paired.mjs [rounds=3]` runs the screen-take
benchmark alone, alternating the two painters round-robin, for a paired measurement of the
recorded frame rate specifically (ESCSUITE-86: it settled why the screen take reads
28.7–29.2 fps rather than 30 — see the note in
[docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md) —
and the benchmark keeps `setInterval` as its default painter regardless, so every other
`taskMsPerFrame` figure stays comparable).

**The A/V drift rig** (`apps/e2e/tests/perf/craft-av-drift.spec.ts`, ESCSUITE-296/297) sits
beside the benchmarks and is neither a benchmark nor a regression test: a measurement, run by
hand one arm at a time, that records a real 180 s ESCAPECRAFT take against `mockSyntheticMedia`
devices carrying opt-in sync markers (a flash and a beep every 10 s and a per-frame paint-time
timecode), instruments every `ScriptProcessorNode` callback and audio clock in the page
(`utils/avDrift.ts`), downloads the raw WebM and the MP4 / M4A conversions, and leaves the
numbers for `apps/e2e/scripts/av-drift-report.mjs` to read with ffprobe (`-fps_mode passthrough`
for the per-frame timecode): lost callbacks, the audio PTS gaps, the last audio packet against
the last video frame, and the marker drift slope in ms per minute with its standard error. It is
opt-in twice over — its own config, `playwright.av-drift.config.ts` (`pnpm --filter
@escapesuite/e2e run test:av-drift`), which `playwright.perf.config.ts` ignores by name and
`playwright.config.ts` by directory, **and** `AV_DRIFT=1` — so neither `pnpm test:e2e` nor
`pnpm perf` ever starts a three-minute take; the arm is chosen by `AV_DRIFT_MODE`
(`screen` | `pip` | `tracks` | `mic`), `AV_DRIFT_LOAD` (`idle` | `cpu4` | `jank`) and
`AV_DRIFT_SECONDS`, and the results land in the gitignored `apps/e2e/av-drift-results/`. The
only `expect`s are tripwires that the take it measured is the take it meant to. It is what found
and then confirmed the ESCSUITE-296 fix: on the unfixed recorder the CPU-throttled screen take
lost 5 callbacks and drifted −428 ms over 180 s (5 × 85.3 ms predicted −427), and on the fixed
one the two-track take that lost a callback drifted −2 ms; the before and after tables are on
the ticket. The CPU-throttled arms are not deterministic — how many callbacks Chromium drops
varies run to run — so a comparison reads the arm that lost callbacks on both trees, and the
rig reads the callbacks rather than the gap filler, so a fill count is inferred from the
end-to-end drift rather than read out. The rig records which audio capture path the take used
(`capturePath`: `worklet`, `script-processor` or `media-recorder`, read from the recorder's own
`console.info` line, ESCSUITE-320) and trips if it is not the one the arm meant (`AV_DRIFT_EXPECT_PATH`
overrides). Its ScriptProcessor callback instruments see nothing on a worklet take — every WebCodecs
take since ESCSUITE-299 — so the report prints "n/a (AudioWorklet)" and an n/a H1a verdict there
instead of reading it as a MediaRecorder take; a per-chunk gap read on the worklet port is not built.

CI runs them in their own workflow, `.github/workflows/perf.yml` (ESCSUITE-26): on every
push to `main` or `dev`, on a pull request that carries the **`perf` label** (add the label,
then push or re-run — the workflow listens for `labeled` and `synchronize`), and by hand via
`workflow_dispatch`. It is `continue-on-error: true` and was never in `ci-status`'s `needs` —
runner CPU varies, so a number moving is worth looking at and never worth blocking a merge
on — which is why taking it off every PR costs nothing in regression protection and saves
about fifteen runner-minutes per push. It uploads `perf-report.json` (and any `*.cpuprofile`)
as the `perf-report` artifact.

`PERF_PROFILE=1 pnpm perf` additionally records a CPU profile of each browser benchmark —
on a **fourth, discarded run**, so the medians stay unprofiled — into
`apps/e2e/perf-results/*.cpuprofile`, alongside a `*.maps.json` holding the inline source
maps of every `/src/` module it sampled. `apps/e2e/scripts/profile-top.mjs` turns the pair
into top-by-self-time and top-app-code-by-total-time tables (also embedded in
`perf-report.json` when the profiles exist), resolving each frame through the maps so
locations are lines in the `.ts` files and not in Vite's transformed output. Its fold — a
sample is charged the interval that *follows* it, and recursion counts once per sample — is
covered by `apps/e2e/scripts/profile-top.test.mjs`, run by `pnpm test:scripts` (node:test,
no browser) in CI's `test` job.

ESCAPECRAFT's own baseline — the three benchmarks above over three consecutive `pnpm perf`
invocations, what each metric means, and the two findings the first measurement turned up
(the compositor holding ~23 fps against its own 30 fps target, **fixed** by ESCSUITE-54 and
now 30.0 with the paired before/after in the same file; and the first take of a session
costing a quarter of what every later take costs, still open) — is in
[docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md).

Baseline numbers, the machine they came from and the launch args they used live in
[docs/performance/2026-09-12-baseline.md](docs/performance/2026-09-12-baseline.md); the
hotspot analysis those profiles produced, and the ranked fix list it argues for, in
[docs/performance/2026-09-12-profile.md](docs/performance/2026-09-12-profile.md). Round 2's
timeline-interaction baseline (`apps/e2e/tests/perf/timeline-interaction.spec.ts`: a clip drag, a
marquee and a playhead scrub over the same scene, reporting layouts and JS per pointer move) is in
[docs/performance/2026-09-13-timeline-baseline.md](docs/performance/2026-09-13-timeline-baseline.md),
and round 2's before/after — what each fix moved, what is a dev-build artefact, the ranked
candidates with their status and the open follow-ups — in
[docs/performance/2026-09-13-timeline-profile.md](docs/performance/2026-09-13-timeline-profile.md).

**Waveform extraction memory** (ESCSUITE-338) is a one-off measurement, not a benchmark in
`pnpm perf`: ESCAPEARTIST's `extractWaveformData` over a local fixture (not committed),
before (the whole-file `decodeAudioData` code, verbatim) and after (the streamed mediabunny decode
into `PeakReducer`), each in a fresh Chromium 141 headless shell against the artist dev server,
three runs per arm. The figure is the renderer's peak RSS rise during the waveform step alone:
`VmHWM` reset through `/proc/<pid>/clear_refs` after the file was fetched into a Blob, read again
when the call returned. The fixtures are ffmpeg-generated stereo 48 kHz (a sine plus pink noise),
Opus 96 kb/s in WebM and the same audio as 16-bit WAV; the page's AudioContext ran at 44.1 kHz,
so the old path also resampled. Ranges are over the three runs (2026-10-21).

| Fixture | Before: renderer peak RSS rise | After | Wall time before / after |
|---|---|---|---|
| 2 min Opus WebM (1.4 MB) | +96.7 MB | +31.1 MB | 0.80 s / 0.82 s |
| 10 min Opus WebM (6.9 MB) | +473.0–473.4 MB | +101.4–101.7 MB | 3.4–3.7 s / 3.6–3.7 s |
| 10 min 16-bit WAV (115 MB) | +620.9–621.8 MB | +99.7–101.0 MB | 2.1–2.2 s / 1.7–2.0 s |
| 30 min Opus WebM (20.6 MB) | +1410.3 MB | +142.2 MB | 10.8 s / 10.9 s |

Before grows linearly, ~47 MB per minute of audio (the decoded channels, a mono copy and the
file's bytes); after is the peaks plus collectable decoder garbage, and stops growing with length
(31 → 101 → 142 MB over 2 → 10 → 30 min, single runs at 2 and 30 min). The old path also grew the
audio-service utility process by ~53 MB for its AudioContext, which the streamed path never
creates. An audio import used to decode twice — its library thumbnail ran its own whole-file
`decodeAudioData` before the waveform's — so it paid the "before" cost twice in a row; the
thumbnail is now drawn from the same peaks.

**Per-frame ceilings** are the other half, and unlike the benchmarks they *do* assert.
Eight ordinary vitest files — `apps/artist/src/components/Preview/drawFrame.perf.test.ts`,
`apps/artist/src/core/exportMP4.perf.test.ts` and its twin
`apps/artist/src/core/exportWebM.perf.test.ts` (ESCSUITE-112: the same scene, the same splitter,
over the pipeline that draws media *elements* — `<video>`/`<img>` — straight onto the canvas
rather than decoded `VideoFrame`s, plus one measure with no equivalent on the MP4 side: seeks per
frame against the shared `<video>` element, steady-state and the one-time initialisation seek kept
separate so the count stays exact),
`apps/artist/src/components/Timeline/timelineGestures.perf.test.ts` (listeners, rects, snap-point
and render counts per pointer move), `apps/craft/src/core/compositor.perf.test.ts`,
`apps/craft/src/core/converter.perf.test.ts`,
`apps/craft/src/core/webcodecsRecorder.perf.test.ts` (level-monitor emissions, analyser and
planar buffers, frame/encode/flush and AudioContext lifecycles for one take — including a
separate-tracks take's audio companions: one `AudioData` created and closed per buffer per
pipeline, one encode each, one flush and one close each, and one `AudioContext` for all three)
and its mirror
`apps/craft/src/core/recorder.perf.test.ts` (the same emission rate for the MediaRecorder
path, so the two recorders' monitors cannot drift apart) — run the same scene through the same
doubles the behaviour tests use and count what one frame costs: 2D-context calls,
`drawImage`/`measureText`/`save`/`restore`, animation lookups, `getContext` calls, object
URLs, `VideoFrame`s created versus closed, `encode`/`flush` calls. They are `*.perf.test.ts`
rather than `bench` files on purpose: counts do not depend on the runner's CPU, so they can
be enforced in CI and in `test:coverage` like any other test. ARTIST's scene is the browser
benchmark's scene, built for unit tests in `apps/artist/src/test/fixtures/perfScene.ts`, so
a ceiling here and a millisecond figure there describe the same work.
**The rule: a ceiling is 2x the measured value rounded up, with the measurement and its date
in a comment beside it. Conservation laws (frames created == closed, one encode per frame,
balanced save/restore, one composite per animation frame) are asserted exactly. When a fix
lands, re-measure and lower the ceiling; never raise one without saying, in the PR, why the
new cost is correct.** A test that pins a *finding* rather than a target says so in its
comment, with the assertion to flip when the finding is fixed.
