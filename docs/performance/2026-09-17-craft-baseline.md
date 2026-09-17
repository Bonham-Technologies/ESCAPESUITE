# ESCAPECRAFT recording baseline — 2026-09-17

The first millisecond numbers for ESCAPECRAFT. Everything after this is measured against
this file.

ESCAPEARTIST has had real-browser benchmarks since round 1
([2026-09-12-baseline.md](2026-09-12-baseline.md)) and gesture benchmarks since round 2
([2026-09-13-timeline-baseline.md](2026-09-13-timeline-baseline.md)), so a change to the
preview, the timeline or the exporter could be argued in milliseconds. ESCAPECRAFT had
only the unit-level `*.perf.test.ts` ceilings, which count **calls** and deliberately say
nothing about time. This file is the other half for the recorder.

Reproduce with:

```bash
pnpm perf                                       # the three benchmarks, in perf-report.json
pnpm --filter @escapesuite/e2e exec playwright test \
  --config=playwright.perf.config.ts craft-recording   # just these three
pnpm --filter @escapesuite/craft exec vitest run \
  src/core/compositor.perf.test.ts src/core/converter.perf.test.ts \
  src/core/webcodecsRecorder.perf.test.ts src/core/recorder.perf.test.ts  # the call ceilings
```

## What is measured

`apps/e2e/tests/perf/craft-recording.spec.ts`, plumbing in `apps/e2e/utils/craftPerf.ts`.
Three benchmarks, because ESCAPECRAFT has three distinct pipelines and they cost entirely
different things:

| Benchmark | Path under test | Recorder |
|---|---|---|
| `craft-screen-recording` | screen-only take: `MediaStreamTrackProcessor` → `VideoEncoder.encode` **on the main thread** → Mediabunny mux | `WebCodecsRecorder` |
| `craft-pip-recording` | screen + webcam: `Compositor`'s rAF draw loop → `canvas.captureStream(30)` → MediaRecorder, which encodes **off** the main thread | `Recorder` (MediaRecorder) |
| `craft-mp4-conversion` | `convertToMP4`: offscreen `<video>` + `requestVideoFrameCallback` → `drawImage` → `new VideoFrame` → `VideoEncoder.encode` → Mediabunny mux, all in the page | — |

Each is its own `test()` with its own page load, so one failing leaves the others' numbers
in the report. Each runs **three times** and reports the median; `PERF_PROFILE=1` adds a
fourth, discarded, profiled run (`craft-screen`, `craft-pip`, `craft-mp4`).

A take is six seconds start-click to stop-click, with the **first second discarded** — a
take's opening frames pay for opening the encoder, sizing the canvas and getting the first
decoded frame out of the capture track, and the forced GC that anchors the heap reading is
taken inside that discarded stretch so its pause never lands in the measured window. The
measured window is therefore **5 s**. The conversion benchmark has no window of its own:
it measures one whole click-to-file conversion of a 6 s take.

**Nothing was added to `apps/craft/src` for any of this.** Takes are driven through the UI
exactly as `tests/escapecraft/mp4-download.spec.ts` drives one — wait for the Screen toggle
to be enabled (capability detection is async), click Start, wait for "Pause recording",
click Stop, wait for the new row. Every number comes from outside the page:

- `addInitScript` wrappers for `requestAnimationFrame`, `VideoEncoder.prototype.encode`
  and — new for ESCAPECRAFT — `CanvasRenderingContext2D.prototype.drawImage`, counting only
  calls whose source is an `HTMLVideoElement`;
- a `PerformanceObserver` for long tasks, attributed to the window by **start** time (a task
  straddling the close is counted whole, the same rule as `measurePlayback`);
- a CDP session for `TaskDuration` / `LayoutCount` / `RecalcStyleCount` and for the
  `HeapProfiler.collectGarbage` that anchors each heap reading.

They assert nothing about speed. The only `expect`s are the six tripwires that say the
benchmark measured the wrong thing — each one pins an invariant the numbers rest on, in
code rather than in prose:

| Arm | Tripwire | What a failure means |
|---|---|---|
| both takes | still "Pause recording" when the window closed | the take died mid-window; every rate is an average over a stretch that was not capturing |
| screen | `framesEncoded > 0` | the take did not go through `WebCodecsRecorder` — nothing encoded on the main thread |
| screen | `videoDraws === 0` | `WebCodecsRecorder` is on its `startVideoElementCapture` fallback (no `MediaStreamTrackProcessor`), which is a different pipeline reported under this one's name |
| PiP | `videoDraws > 0` | the take did not composite — the webcam never arrived |
| PiP | `videoDraws % 2 === 0` | a capture track was not ready for some frames, so the two-draws-per-composited-frame divisor is wrong (see the compositor finding below) |
| conversion | `framesEncoded > 0` | `convertToMP4` resolved past its capture phase with nothing encoded — there is no video in the MP4 to have measured |

### Capture devices

`mockSyntheticMedia(page, { width: 1280, height: 720 })`. 720p rather than the helper's
640x360 default so the encode is a real one, and because it is exactly the resolution the
`Compositor` caps itself at (`maxDim = 1280`), so the PiP arm composites at its own ceiling
rather than being scaled down before anything is measured.

## Local baseline

**Four `pnpm perf` invocations**, medians of three runs each, so the
invocation-to-invocation spread is visible rather than hidden. A, B and C are the three
consecutive invocations the baseline was taken from. **D** was taken after fix round 1
changed how `taskMsPerFrame` is computed — it is now a ratio of two rates (renderer task ms
per second, over frames per second) rather than a plain division of one window's
milliseconds by another window's frame count. It is included so the effect of that change
is visible: every figure in D, `taskMsPerFrame` included, sits inside the A–C spread, which
is what the two windows differing by one CDP round trip in five seconds predicts. Machine
and launch args at the bottom.

### `craft-screen-recording` — WebCodecs, 1280x720, 5 s window

| Metric | Inv. A | Inv. B | Inv. C | Inv. D |
| --- | --- | --- | --- | --- |
| **Frames encoded** | 144 | 144 | 146 | 144 |
| **Frames/s** | 28.76 | 28.74 | 29.17 | 28.77 |
| **Renderer task per frame** | 28.97 ms | 29.02 ms | 28.35 ms | 28.65 ms |
| Renderer task duration | 4171.11 ms | 4165.83 ms | 4154.49 ms | 4142.96 ms |
| Animation frames/s | 60.11 | 60.07 | 59.94 | 59.93 |
| Layouts | 301 | 303 | 302 | 302 |
| Style recalcs | 301 | 301 | 300 | 301 |
| Long tasks | 0 | 0 | 0 | 0 |
| Encoder queue high-water | 0 | 0 | 0 | 0 |
| Heap delta | −383.8 KB | −326.8 KB | −185.2 KB | −164.4 KB |
| Output size (WebM) | 1.69 MB | 1.72 MB | 1.71 MB | 1.72 MB |

### `craft-pip-recording` — Compositor + MediaRecorder, 1280x720, 5 s window

| Metric | Inv. A | Inv. B | Inv. C | Inv. D |
| --- | --- | --- | --- | --- |
| **Composited fps** | 22.76 | 22.78 | 22.38 | 22.77 |
| Video draws | 228 | 228 | 224 | 228 |
| Video draws/s | 45.52 | 45.55 | 44.76 | 45.54 |
| **Renderer task per frame** (per *composited* frame here) | 35.20 ms | 34.85 ms | 35.73 ms | 34.69 ms |
| Renderer task duration | 4002.25 ms | 3973.25 ms | 4001.58 ms | 3989.52 ms |
| Animation frames/s | 119.88 | 119.87 | 119.89 | 120.23 |
| Frames encoded | 0 | 0 | 0 | 0 |
| Layouts | 299 | 305 | 300 | 305 |
| Style recalcs | 301 | 300 | 300 | 300 |
| Long tasks | 0 | 0 | 0 | 0 |
| Heap delta | −48.7 KB | −48.4 KB | −116.1 KB | 171.5 KB |
| Output size (WebM) | 1009.3 KB | 1.05 MB | 1.02 MB | 999.2 KB |

### `craft-mp4-conversion` — `convertToMP4` of a 6 s take

| Metric | Inv. A | Inv. B | Inv. C | Inv. D |
| --- | --- | --- | --- | --- |
| Wall time | 6759 ms | 6762 ms | 6753 ms | 6753 ms |
| Frames encoded | 195 | 195 | 195 | 195 |
| Frames/s | 28.85 | 28.84 | 28.88 | 28.88 |
| **Renderer task per frame** | 30.41 ms | 30.35 ms | 30.03 ms | 30.38 ms |
| Renderer task duration | 5929.12 ms | 5918.11 ms | 5854.93 ms | 5925.26 ms |
| Encoder queue high-water | 4 | 4 | 3 | 3 |
| Heap delta | 271.3 KB | 272.7 KB | 292.3 KB | 271.6 KB |
| Output size (MP4) | 835.0 KB | 838.0 KB | 861.5 KB | 825.0 KB |

**The spread between invocations is small here** — every headline figure above moves by
under 3% across the four, and `framesEncoded` for the conversion is identical (195) in all
twelve runs. That is a much tighter band than the timeline gestures showed on this machine
(up to 2.5x between invocations,
[2026-09-13-timeline-baseline.md](2026-09-13-timeline-baseline.md#run-to-run-spread-between-invocations--the-important-caveat)).

The reason is that the frame rates here are **paced rather than raced**: the conversion is
handed frames by `requestVideoFrameCallback` at playback speed, the compositor draws on a
gated rAF loop, and the recorder encodes whatever arrives on its capture track. None of the
three is trying to go as fast as the CPU will let it, which is what the export benchmarks
do. **That is not the same as "rate-limited whatever the machine":** the capture track is
not a device, it is `mockSyntheticMedia`'s `setInterval(…, 33)` canvas painter running on
the same main thread this benchmark reports as ~83% busy, and `setInterval` under that load
delivers materially fewer than 30 frames a second. That is the most likely reason the screen
take lands at 28.7–29.2 rather than ~30 (`WebCodecsRecorder`'s own gate is
`targetFrameInterval * 0.8` = 26.7 ms, so it is not the thing dropping the difference) —
see "How to read these" below.

What varies with the machine, and what a comparison should therefore use, is
`taskMsPerFrame`.

The paired-alternation rule from round 2 still applies to any millisecond claim: swap base
and patched code round-robin against one warm dev server rather than running a plain
before/after.

## The three runs inside one invocation, and the first-take step

The three runs behind each median above are **not** three samples of the same thing. The
first take of a session costs about a quarter of what every later take costs:

| | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| `craft-screen-recording` renderer task | 938 ms | 4171 ms | 4178 ms |
| `craft-pip-recording` renderer task | 1979 ms | 4048 ms | 4002 ms |

(Invocation A; B and C are the same shape to within a few percent.)

This was chased down before the numbers above were written, because a 4.4x step is exactly
the kind of thing that turns a benchmark into a lie if it is left unexplained. What is
known, all measured:

- **It is a one-off step, not accumulation.** Over **five** consecutive screen takes in one
  session the renderer task was 929, 4141, 4142, 4105, 4098 ms. It steps once, after the
  first take, and is then flat.
- **It is not the recordings list.** Deleting every row between takes — so the library is
  empty again each time — does not restore the cheap figure: 922, 4133, 4126, 4071 ms.
- **It is not the harness's leaked capture canvases.** `mockSyntheticMedia` never clears the
  33 ms `setInterval` that paints its source canvas, so one live painter leaks per captured
  video track per take (measured directly: live interval count 3 → 4 → 5 → 6 → 7 over five
  screen takes, and +2 per take in PiP). But the cost is flat while that count grows, so the
  leaked painters are cheap and are not the step.
- **Neither the frame rate nor the output changes with it.** Frames encoded per second and
  the stored file's size are the same in run 1 as in runs 2 and 3.

So: something about the first take of a session leaves the page in a more expensive steady
state, and it is not the library, not the harness, and not cumulative. **It has not been
root-caused, and it is a real follow-up.** Until it is, read the numbers this way:

> The reported median describes a **second-or-later take**, which is deliberate — it is the
> steady state, and it is what a user's session mostly consists of. A comparison must never
> mix a single-run measurement against a three-run median, because a single run would be
> the cheap first take.

## Finding: the compositor holds ~23 fps against its own 30 fps target

`compositedFps` comes out at **22.4–22.8**, not the 30 the `Compositor` asks for. That is
not a measurement artefact and not a slow machine; it is the throttle's arithmetic.

`Compositor.render` (`apps/craft/src/core/compositor.ts:148-157`) requests an animation
frame every frame and then returns early unless
`performance.now() - lastFrameTime >= 1000 / 30`, setting `lastFrameTime` to the *actual*
draw time rather than to an ideal schedule.

**There is no margin at all.** The gate is `1000 / 30` and two animation frames on a 60 Hz
display are `2 * (1000 / 60)`, and those are not merely close — they are the *same* IEEE 754
double, `33.333333333333336`:

```
$ node -e "console.log((1000/30) === 2*(1000/60))"
true
```

So `now - lastFrameTime >= 1000 / 30` passes after two frames only if those two frames
measured at or *above* the ideal 16.6667 ms each, and fails the moment they measure a
nanosecond below it. Nothing about that is a close call the machine usually wins: the
comparison is decided entirely by dispatch jitter, and `lastFrameTime` is snapped to the
callback's own `performance.now()` (`compositor.ts:153-154`) rather than to vsync, so the
error does not cancel between frames. A pair that lands below waits for a **third** animation
frame and that composited frame arrives at 50 ms instead of 33 ms.

That is arithmetic off the source, and the benchmark's own published figures confirm the
consequence: `rafPerSecond` of 119.88 is two loops, so 59.94 animation frames per second,
against 22.78 composited frames per second — **2.63 animation frames per composited frame**,
between the 2 the design intends and the 3 the gate keeps forcing. (An earlier draft of this
file quoted an animation-frame gap histogram from a throwaway diagnostic. The numbers in it
did not cohere — the stated sample count and window length were inconsistent — and the
diagnostic is not part of the branch, so it has been removed rather than left as an
unreproducible citation. Nothing in the conclusion rested on it.)

Two consequences:

- **The two-draws-per-composited-frame assumption behind `compositedFps` holds, and is now
  enforced rather than asserted in prose.** `drawFrame` draws the screen video and
  `drawWebcamOverlay` draws the webcam video, one `drawImage` each, **inside one synchronous
  rAF callback** — so a counter snapshot can never land between them. Each draw is guarded
  on its element's `readyState >= 2` (`compositor.ts:170`, `:175`), so a frame composited
  while a capture element has no decoded frame yields one draw or none, which would
  understate `compositedFps` and overstate `taskMsPerFrame` by the same factor. The PiP arm
  therefore asserts `videoDraws % 2 === 0`, and the screen arm asserts `videoDraws === 0`
  (which also catches `WebCodecsRecorder` silently taking its `startVideoElementCapture`
  fallback). Observed even in every run measured: 224, 226, 228, 230, 236.
- **A fix here is a real user-visible win** — a PiP recording is losing roughly a quarter of
  its frames to a comparison that has no margin to lose — and it would move
  `compositedFps` without moving `taskMsPerFrame`, which is precisely why both are reported.
  A deadline-based gate (advance `lastFrameTime` by the frame interval rather than snapping
  it to `now`, with a catch-up clamp) is the obvious shape. **No app code was changed for
  this baseline**; it is recorded here to be fixed on its own ticket.

## How to read these

**`rafPerSecond` is more than one loop.** Both recorders drive the audio-level monitor from
`requestAnimationFrame` — scheduled every frame, gated to one store write per 80 ms — so a
screen take runs one rAF loop (≈60/s) and a PiP take runs two, the monitor plus the
compositor's own (≈120/s). The measured 60.07 and 119.88 are that, and a number that
drifted away from them would mean a loop had been added or lost. It is **not** a frame rate;
`framesPerSecond` and `compositedFps` are.

**`framesPerSecond` and `compositedFps` are mutually exclusive by construction.** A PiP take
never calls `VideoEncoder.encode` — MediaRecorder encodes on its own thread, invisible from
the page — so its `framesEncoded` is 0 and is reported as 0 rather than dressed up. A screen
take composites nothing, so its `compositedFps` is 0. Each benchmark has exactly one rate,
and the report's headline picks the right one.

**The screen take's `framesPerSecond` is jointly determined by the harness.** It reads
28.7–29.2 rather than 30, and the shortfall is most likely the source, not the recorder:
`mockSyntheticMedia`'s capture "device" is a `setInterval(…, 33)` painter on the same main
thread that is ~83% busy in a second-or-later take, and `WebCodecsRecorder` encodes whatever
the track delivers (its own gate is `targetFrameInterval * 0.8` = 26.7 ms, so it is not
dropping the difference). So a future change that made the page *busier* could show up here
as a lower "recorded frame rate" that has nothing to do with the recorder. Compare
`taskMsPerFrame`. **`compositedFps` is not affected** — the compositor's rAF loop draws
whatever the `<video>` element currently shows, at a rate set by rAF and its own gate,
independent of how fast the source delivers — so the compositor finding above stands on its
own. The two rates look symmetric and are not.

**The conversion is real-time bound, so its wall time is a floor, not a score.**
`convertToMP4` plays the stored WebM in an offscreen `<video>` and captures frames from
`requestVideoFrameCallback`, so a 6 s take takes ~6.76 s to convert *however fast the
machine is*. Wall time is reported because it is what a user waits, but **`taskMsPerFrame`
is the number a converter change moves**, and `framesPerSecond` (28.8 against the
converter's 30 fps target) is what says the page is keeping up with the playback it is bound
to rather than falling behind it.

**The synthetic source is inside every measured window.** `mockSyntheticMedia`'s capture
device is a canvas repainted by a 33 ms `setInterval` on the page's own main thread — a
1280x720 `fillRect` plus a `fillText`, at ~30 Hz, under software rasterisation — plus an
oscillator for audio. That work is charged to `taskDurationMs` along with the app's. It is
identical in every arm of a comparison, so it cancels; it is not zero, so an absolute claim
("recording a 720p take costs 29 ms of main thread per frame") overstates the app's share.
And as noted above, a fresh painter leaks per take, which is a slow drift the benchmark
should be re-checked against if `PERF_RUNS` is ever raised.

**The perf project's file order changed when these were added.** `craft-recording.spec.ts`
sorts before `export.spec.ts`, so the ESCAPECRAFT benchmarks now run first and every
`pnpm perf` also starts ESCAPECRAFT's Vite server. The two existing baseline docs were taken
under the old ordering; the export figures either side of the change are inside their own
stated ~1.5% band (`export-mp4` 76.7 here against 77.17 on 2026-09-12, `export-webm` 80.16
against 80.76), so the three files stay comparable — but it is a difference between them,
and it is recorded here rather than left to be rediscovered.

**These are dev-server numbers, in React's development build**, under `--disable-gpu`
software rasterisation. Same as every other benchmark in this repo. They are for comparing
two commits measured the same way, not for telling a user what recording costs them.

**Encoder queue high-water is 0 for both takes and 3–4 for the conversion.** A recording
never gets ahead of its own capture track, so nothing queues; the conversion feeds the
encoder as fast as `requestVideoFrameCallback` delivers and briefly runs three or four
frames deep. A recording's high-water rising above 0 would mean the encoder had started
falling behind real time, which is the thing that drops frames in a take — worth watching.

**Nothing here is a long task, on this machine.** All nine recording runs and all nine
conversion runs recorded 0. That is despite the main thread being ~80% busy in a
second-or-later take, which says the work is spread across many short tasks rather than
concentrated — but on a machine a third the speed it would not be, which is the whole reason
this repo has a lightweight-performance rule.

**CI numbers are relative, not comparable to these.** The `perf` job runs on a shared
`ubuntu-latest` runner, is `continue-on-error: true` and is deliberately absent from
`ci-status`'s `needs`. Compare CI to CI on the same branch; compare local to this file on
this machine.

## Where the numbers came from

| | |
|---|---|
| Machine | MacBook Pro, Intel Core i9-8950HK @ 2.90 GHz, 12 logical cores, 32 GB |
| OS | macOS 15.7.9 (darwin-x64), build 24G830 |
| Node | v26.7.0 |
| Playwright | 1.63.0, bundled Chromium 153.0.8010.12 |
| App under test | ESCAPECRAFT dev server (Vite), `http://localhost:5174` |
| Chromium launch args | `--enable-precise-memory-info --disable-gpu --autoplay-policy=no-user-gesture-required` |

The same machine and the same launch args as
[2026-09-12-baseline.md](2026-09-12-baseline.md) and
[2026-09-13-timeline-baseline.md](2026-09-13-timeline-baseline.md), so all three files'
figures are comparable with each other.

`pnpm perf` with all seven browser benchmarks plus the kit takes **~3.1 minutes** on this
machine with a warm dev server (3.1 minutes for each of the four invocations above, against
~2 minutes before these three were added). The CI `perf` job's `timeout-minutes: 30` is left
as it was.

**Invocations A–C were taken before fix round 1; D was taken after it.** The review of this
work asked for two changes that touch what is reported here, and both are in D:
`taskMsPerFrame` is now a ratio of two rates rather than a plain division across two windows
that differ by one CDP round trip (so the numerator and the denominator no longer come from
differently-bracketed spans), and the conversion row's `6` is now published under its own
key, `takeSeconds` ("Source take length"), because that benchmark has no measured window and
labelling it "Measured window" was untrue. Neither change moved a figure outside the A–C
spread — which is the point of showing D rather than quietly replacing A–C with it. Every
other number in the tables is definitionally unchanged.

## Follow-ups this baseline opens

1. **The compositor's frame gate** (see the finding above): ~23 fps where 30 is intended, on
   a throttle whose gate is bit-for-bit two 60 Hz frame intervals, so any dispatch jitter
   costs a whole frame. A user-visible frame loss in every PiP recording.
2. **The first-take step**: the first take of a session costs ~0.9 s of renderer task in a
   5 s window and every later take ~4.1 s, once, permanently, and not because of the
   recordings list or the harness. Not root-caused.
3. **`mockSyntheticMedia` leaks a capture painter per take.** Harmless at three runs
   (measured flat), but it is a confound that grows with run count and the helper is shared
   with the functional E2E suites. Clearing the interval when the track ends would remove it.
