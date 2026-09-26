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
Five benchmarks, because ESCAPECRAFT has five distinct pipelines and they cost entirely
different things (the fourth arrived with ESCSUITE-14 slice 1 — see its own section at the
end of this file — and the fifth with slice 4; the three below are the original baseline):

| Benchmark | Path under test | Recorder |
|---|---|---|
| `craft-screen-recording` | screen-only take: `MediaStreamTrackProcessor` → `VideoEncoder.encode` **on the main thread** → Mediabunny mux | `WebCodecsRecorder` |
| `craft-pip-recording` | screen + webcam: `Compositor`'s rAF draw loop → `canvas.captureStream(30)` → MediaRecorder, which encodes **off** the main thread | `Recorder` (MediaRecorder) |
| `craft-separate-tracks-recording` | screen + webcam, opt-in: two `MediaStreamTrackProcessor` readers → two `VideoEncoder.encode` **on the main thread** → two Mediabunny muxes, with the `Compositor` drawing the preview only | `WebCodecsRecorder` |
| `craft-mp4-conversion` | `convertToMP4`: offscreen `<video>` + `requestVideoFrameCallback` → `drawImage` → `new VideoFrame` → `VideoEncoder.encode` → Mediabunny mux, all in the page | — |
| `craft-composite-mp4-conversion` | `convertToMP4` again, with the take's camera half in a second `<video>` drawn through `drawOverlay` into the same canvas — the composite of a separate-tracks take (ESCSUITE-14 decision 3) | — |

Each is its own `test()` with its own page load, so one failing leaves the others' numbers
in the report. Each runs **three times** and reports the median; `PERF_PROFILE=1` adds a
fourth, discarded, profiled run (`craft-screen`, `craft-pip`, `craft-separate-tracks`,
`craft-mp4`, `craft-composite-mp4`).

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

They assert nothing about speed. The only `expect`s are the eleven tripwires that say the
benchmark measured the wrong thing — each one pins an invariant the numbers rest on, in
code rather than in prose:

| Arm | Tripwire | What a failure means |
|---|---|---|
| every take | still "Pause recording" when the window closed | the take died mid-window; every rate is an average over a stretch that was not capturing |
| screen | `framesEncoded > 0` | the take did not go through `WebCodecsRecorder` — nothing encoded on the main thread |
| screen | `videoDraws === 0` | `WebCodecsRecorder` is on its `startVideoElementCapture` fallback (no `MediaStreamTrackProcessor`), which is a different pipeline reported under this one's name |
| PiP | `videoDraws > 0` | the take did not composite — the webcam never arrived |
| PiP | `videoDraws % 2 === 0` | a capture track was not ready for some frames, so the two-draws-per-composited-frame divisor is wrong (see the compositor finding below) |
| separate tracks | `framesEncodedPerEncoder.length === 2` | the take did not run two encoders — the webcam pipeline was never built, or the mode fell back to composited PiP, either way reported under this arm's name |
| separate tracks | `min(framesEncodedPerEncoder) > 0` | one of the two pipelines encoded nothing: a companion that never started leaves the other doing all the work at a respectable-looking rate, and a blob with no frames in it is not a track |
| separate tracks | `videoDraws > 0` | the compositor did not draw — the preview the user watches was blank, so the take's main-thread cost is missing the one part of it this arm shares with PiP |
| separate tracks | `videoDraws % 2 === 0` | as for PiP: a capture element was not decoding for some frames, so the two-draws-per-composited-preview-frame divisor behind `compositedFps` is wrong |
| conversion | `framesEncoded > 0` | `convertToMP4` resolved past its capture phase with nothing encoded — there is no video in the MP4 to have measured |
| composite conversion | `videoDraws === 2 × framesEncoded` | either the overlay was never drawn — a plain conversion reported under the composite's name — or the screen was passed over twice, which at this capture size is the most expensive thing the loop could do twice |

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

| Metric | Inv. A | Inv. B | Inv. C | Inv. D | **After #55** |
| --- | --- | --- | --- | --- | --- |
| **Frames encoded** | 144 | 144 | 146 | 144 | 140 |
| **Frames/s** | 28.76 | 28.74 | 29.17 | 28.77 | 27.97 |
| **Renderer task per frame** | 28.97 ms | 29.02 ms | 28.35 ms | 28.65 ms | **6.54 ms** |
| Renderer task duration | 4171.11 ms | 4165.83 ms | 4154.49 ms | 4142.96 ms | **915.73 ms** |
| Animation frames/s | 60.11 | 60.07 | 59.94 | 59.93 | 60.05 |
| Layouts | 301 | 303 | 302 | 302 | 300 |
| Style recalcs | 301 | 301 | 300 | 301 | 300 |
| Long tasks | 0 | 0 | 0 | 0 | 0 |
| Encoder queue high-water | 0 | 0 | 0 | 0 | 0 |
| Heap delta | −383.8 KB | −326.8 KB | −185.2 KB | −164.4 KB | −354.0 KB |
| Output size (WebM) | 1.69 MB | 1.72 MB | 1.71 MB | 1.72 MB | 1.43 MB |

**A–D are superseded** — see "The cause, and the fix" below. Their medians are medians of
second-or-later runs, and every second-or-later run in this document was taken with the
ESCSUITE-55 error loop running.

The output size moves further than the frame count explains — 1.43 MB against 1.69–1.72 MB, a
17% drop where the 140-against-144 frames accounts for ~3%. **Unexplained**, one invocation
either side, and not load-bearing for anything here: it is a VP8/VP9 rate-controller outcome on
a synthetic source whose content is identical every run, so the most likely reading is that
encoding decisions differ when the encoder is not competing for the main thread. Noted rather
than explained, because the earlier claim that "neither the frame rate nor the output changes
with it" was made under the loop and this is the figure that contradicts it.

### `craft-pip-recording` — Compositor + MediaRecorder, 1280x720, 5 s window

| Metric | Inv. A | Inv. B | Inv. C | Inv. D | **After #55** |
| --- | --- | --- | --- | --- | --- |
| **Composited fps** | 22.76 | 22.78 | 22.38 | 22.77 | 30.11 |
| Video draws | 228 | 228 | 224 | 228 | 302 |
| Video draws/s | 45.52 | 45.55 | 44.76 | 45.54 | 60.22 |
| **Renderer task per frame** (per *composited* frame here) | 35.20 ms | 34.85 ms | 35.73 ms | 34.69 ms | **16.09 ms** |
| Renderer task duration | 4002.25 ms | 3973.25 ms | 4001.58 ms | 3989.52 ms | **2425.02 ms** |
| Animation frames/s | 119.88 | 119.87 | 119.89 | 120.23 | 120.03 |
| Frames encoded | 0 | 0 | 0 | 0 | 0 |
| Layouts | 299 | 305 | 300 | 305 | 306 |
| Style recalcs | 301 | 300 | 300 | 300 | 301 |
| Long tasks | 0 | 0 | 0 | 0 | 0 |
| Heap delta | −48.7 KB | −48.4 KB | −116.1 KB | 171.5 KB | −141.4 KB |
| Output size (WebM) | 1009.3 KB | 1.05 MB | 1.02 MB | 999.2 KB | 1.00 MB |

**A–D are superseded**, and two separate fixes sit between them and the last column: the
compositor's frame gate (ESCSUITE-54, which is what moves `compositedFps` 22.8 → 30.1) and the
error loop (ESCSUITE-55, which is what moves the renderer task 3990 → 2425 ms). The
ESCSUITE-54 paired measurement below isolates the first of the two; it was itself taken with
the loop running, in both of its arms, which is why its `taskDurationMs` sits at ~4000 ms in
all four columns and ~2425 ms here.

### `craft-mp4-conversion` — `convertToMP4` of a 6 s take

| Metric | Inv. A | Inv. B | Inv. C | Inv. D | **After #55** |
| --- | --- | --- | --- | --- | --- |
| Wall time | 6759 ms | 6762 ms | 6753 ms | 6753 ms | 6741 ms |
| Frames encoded | 195 | 195 | 195 | 195 | 195 |
| Frames/s | 28.85 | 28.84 | 28.88 | 28.88 | 28.93 |
| **Renderer task per frame** | 30.41 ms | 30.35 ms | 30.03 ms | 30.38 ms | **8.82 ms** |
| Renderer task duration | 5929.12 ms | 5918.11 ms | 5854.93 ms | 5925.26 ms | **1719.71 ms** |
| Encoder queue high-water | 4 | 4 | 3 | 3 | 1 |
| Heap delta | 271.3 KB | 272.7 KB | 292.3 KB | 271.6 KB | 240.8 KB |
| Output size (MP4) | 835.0 KB | 838.0 KB | 861.5 KB | 825.0 KB | 863.8 KB |

**A–D are superseded, and this benchmark is the worst affected of the three.** It records a
plain take *before* converting, so the error loop was running for **all three** of its runs,
not just the second and third — A–D are not a measurement of conversion at all. It costs
**−71%** of the renderer task it appeared to: 5925 → 1720 ms, 30.38 → 8.82 ms per frame.

Two things in that column are worth reading together. **Wall time did not move** (6753 →
6741 ms) — exactly what this file predicts, because the conversion is bound to playback speed
and `framesEncoded` is the same 195 it has been in every run ever recorded here. And the
**encoder queue high-water fell 3–4 → 1**: with the main thread no longer spinning, the
encoder stops falling behind the frames `requestVideoFrameCallback` hands it. Wall time being
a floor rather than a score, and `taskMsPerFrame` being the number a converter change moves,
are both stated under "How to read these"; this is what that looks like when something
actually moves.

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

> **Superseded by ESCSUITE-55.** The "~83% busy" in that paragraph was the error loop, and
> the prediction it makes is now testable: freeing the main thread should have pushed the
> capture rate back **up**, toward 30. It went **down** — post-fix the thread is ~18% busy and
> the screen take reads **27.97** frames/s, below the 28.7–29.2 the loop-era invocations
> recorded. That is the wrong direction for the starvation theory, so the theory is falsified
> whatever the exact band; the likelier remaining explanation is beating between
> `setInterval(…, 33)` (30.3 Hz) and `captureStream(30)`'s own sampling. Unresolved, and not
> worth resolving unless someone wants to make a claim about the recorded frame rate — in
> which case it needs its own paired measurement first. (One invocation either side, so the
> 0.8 f/s drop itself is not a claim — only its sign, which is all the falsification needs.)

> **Resolved by ESCSUITE-86 (2026-09-26).** The paired measurement the note above asked for:
> `mockSyntheticMedia` gained a second painter (`requestAnimationFrame`, selected by
> `PERF_PAINTER=raf`; the historical `setInterval(…, 33)` stays the default), and
> `apps/e2e/scripts/perf-paired.mjs` ran the screen arm three rounds each, alternating
> `interval`/`raf` round-robin against one warm dev server (`node
> apps/e2e/scripts/perf-paired.mjs 3`).
>
> | Round | Painter | fps | taskMsPerFrame |
> |---|---|---|---|
> | 1 | interval | 29.54 | 4.659 |
> | 1 | raf | 29.93 | 4.922 |
> | 2 | interval | 29.57 | 4.699 |
> | 2 | raf | 29.95 | 4.938 |
> | 3 | interval | 29.55 | 4.661 |
> | 3 | raf | 29.94 | 4.905 |
>
> | Painter | fps min | fps median | fps max | taskMsPerFrame min | taskMsPerFrame median | taskMsPerFrame max |
> |---|---|---|---|---|---|---|
> | interval | 29.54 | 29.55 | 29.57 | 4.659 | 4.661 | 4.699 |
> | raf | 29.93 | 29.94 | 29.95 | 4.905 | 4.922 | 4.938 |
>
> The two arms' fps ranges are disjoint. **Conclusion:** the shortfall below 30 fps is the
> harness's `setInterval(…, 33)` painter beating with `captureStream(30)`'s sampling, exactly
> as the falsified-starvation note above guessed — the recorder itself is not dropping frames,
> since a painter that cannot beat against the sampler the same way (`raf`) records ~29.94,
> visibly closer to 30. The cost of that fix is real, though: a 60 Hz painter costs the main
> thread about 0.25 ms more per encoded frame (`taskMsPerFrame` interval 4.659–4.699 vs. raf
> 4.905–4.938) — a harness cost, not the recorder's, but one that would move every existing
> `taskMsPerFrame` figure in this file if it became the default.
>
> Two more things turned up in the raw runs, both harness bugs rather than findings about
> ESCAPECRAFT: (1) with the rAF painter, `rafPerSecond` read 120/180/240 across a round's three
> takes rather than holding near 60 — every `getDisplayMedia` call had been leaving its
> previous painter loop running (fixed: the painter now stops when its track does), and the
> leak was invisible under the interval painter only because nothing here counts its rate; (2)
> the first rAF take of most rounds read 25–26 fps, with the later two at 29.9–30.2, a
> warm-up effect the interval painter does not show.
>
> **Decision: `'interval'` stays the benchmark's default painter.** Every `taskMsPerFrame` and
> `rafPerSecond` figure in this file, and in the round 1/round 2 baselines it links to, was
> taken under the interval painter; switching the default would make all of them
> non-comparable with anything measured after the switch, for a 0.25 ms/frame difference that
> is the painter's cost, not something an ESCAPECRAFT change could move either way.
> `PERF_PAINTER=raf` and `scripts/perf-paired.mjs` stay in the harness as the way to make a
> claim about the recorded frame rate specifically, the next time one is needed.

What varies with the machine, and what a comparison should therefore use, is
`taskMsPerFrame`.

The paired-alternation rule from round 2 still applies to any millisecond claim: swap base
and patched code round-robin against one warm dev server rather than running a plain
before/after.

### `craft-composite-mp4-conversion` — convertToMP4 with the overlay, 1280x720 source

First measured 2026-09-25, three runs, median. Produced by:

```bash
pnpm --filter @escapesuite/e2e exec playwright test --config=playwright.perf.config.ts craft-recording
node apps/e2e/scripts/perf-report.mjs
```

| Metric | Median |
| --- | --- |
| **Renderer task per frame** | 13.19 ms |
| Wall time | 6741 ms |
| Frames encoded | 195 |
| Frames/s | 28.93 |
| Video draws | 390 |
| Renderer task duration | 2571.81 ms |
| Encoder queue high-water | 1 |
| Heap delta | 294.4 KB |
| Output size (MP4) | 983.5 KB |

Read against `craft-mp4-conversion` on the same machine and the same run: the gap in
**renderer task per frame** is what one overlay costs — one `drawImage` of a 256x144 camera
frame, one circular clip path and one border stroke — and `Video draws` is exactly twice
`Frames encoded` by construction (390 in all three runs, not marginally).

The plain arm in that same invocation, for the comparison: **9.52 ms** per frame, 6733 ms wall,
195 frames at 28.96 f/s, 1857.14 ms renderer task, queue high-water 1, heap delta 311.8 KB,
851.1 KB out. So the overlay costs **+3.67 ms of renderer task per encoded frame (+38.6%)** and
**+714.67 ms over the whole 195-frame conversion**, while **wall time does not move** (6741 vs
6733 ms, +0.1%) — as this file predicts, because `convertToMP4` is paced by
`requestVideoFrameCallback` and 13 ms a frame still fits inside 33. The MP4 grows ~132 KB
(851.1 → 983.5 KB): the camera corner's extra detail in the same H.264 configuration.

Machine load at the start of that run: `load averages: 1.71 2.94 3.78` (Darwin 24.6.0, the
machine at the bottom of this file). Both arms come from one `pnpm perf`-equivalent invocation,
which is the only way the 3.67 ms gap is a gap rather than two measurements taken on different
days — the paired-alternation rule above applies to any further claim about it.

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
state, and it is not the library, not the harness, and not cumulative.

### The cause, and the fix (ESCSUITE-55, PR #415, 2026-09-21)

**It was an endless media-error loop, and it was an app bug, not a benchmark artefact.**

`thumbnailGenerator.ts` had two `cleanup()` helpers that ended with `video.src = ''`.
Emptying a media element's `src` is a *load failure*, not a release: the resource selection
algorithm jumps to "failed with attribute", sets a `MEDIA_ERR_SRC_NOT_SUPPORTED` and fires
`error` at the element. The handler answering that error was the very `cleanup()` that had
emptied `src` — so it ran again, emptied `src` again, and errored again. Every call left a
detached `<video>` spinning error → cleanup → error for the rest of the page's life.
`useRecordingSave.ts` calls `extractVideoMetadata` exactly once per saved recording, so the
loop started when the **first** take of a session was saved and never stopped.

The event is fired from a *queued task*, which is why it showed up as a task treadmill —
`longTaskCount` 0, no extra animation frames, no extra layouts, no extra style recalcs, just
several tens of thousands of very short tasks a second — rather than as a stack overflow or
one long task. And because a busy-spin consumes whatever main-thread capacity is spare, **one
loop already saturates the thread**: that is the whole explanation of "steps once, then
flat". The second and third loops added by later takes had nothing left to consume.

Measured from outside the app, over a **5 s idle window** with nothing recording:

| | renderer task / 5 s | `error` events | `URL.revokeObjectURL` calls |
| --- | --- | --- | --- |
| before the first take | **0.95 ms** | 0 | 0 |
| after take 1 | **4332.7 ms** | 222,873 | 222,873 |
| after take 2 | 4284.9 ms | 224,168 | 224,168 |
| after take 4 | 4231.7 ms | 210,595 | 210,595 |

≈44,500 laps a second, for ever, on a page doing nothing at all. **This was not confined to
the benchmark.** `thumbnailGenerator.ts` has no build-mode branch, so in a real session the
first recording a user saved left the tab burning most of a core until they reloaded.

The fix is to detach `onloadeddata` and `onerror` **before** releasing the element, and to
release it with `removeAttribute('src')` + `load()` — which, with no `src` attribute and no
`srcObject`, ends at `NETWORK_EMPTY` with no `error` and no `MediaError`. (Not silent: `load()`
queues `abort` and `emptied` on the way. Nothing listens for either. The property that matters
is that no `error` is manufactured, because an `error` is what the loop ran on.) After it, the
same idle window
shows **27 ms** of renderer task, 0 errors and 0 revokes, and a take's own window shows one of
each.

`craft-screen-recording`, renderer task per run, same machine and launch args, load verified
below 4 before each:

| | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Before | 890.8 ms | 4110.4 ms | 4084.4 ms |
| **After** | **886.5 ms** | **915.7 ms** | **1013.4 ms** |

The step is gone: the three runs now sit within 14% of each other instead of differing 4.6x,
and median `taskMsPerFrame` falls 27.98 → 6.54 ms. (An independent earlier post-fix
invocation read 905.7 / 937.8 / 1013.3 ms — the same shape, and inside the run-to-run spread
this file already documents.)

**Run 1 did not move**, which is the check that the diagnosis was right rather than merely
correlated: take 1 is the one take that never had a loop running during it, so the fix had
nothing to remove there, and it reads 890.8 ms before and 886.5 ms after.

### How to read the tables above, now

> **Every second-or-later run in this document was taken with the loop running.** The only
> uncontaminated figures it contains are the run-1 ones, and the three-run medians in the
> tables above — which are by construction medians *of* second-or-later runs — are therefore
> measurements of a page that was ~80% busy spinning in `thumbnailGenerator`. They are
> superseded. Do not compare a future change against them; re-baseline first.
>
> `craft-mp4-conversion` is the worst affected and the least obvious: it records a plain take
> *before* converting, so **all three** of its runs were contaminated. Its post-fix numbers
> are in its own table above.
>
> The earlier instruction in this section — that the median "describes a second-or-later
> take, which is deliberate, it is the steady state a user's session mostly consists of" —
> was right that it was the steady state and wrong that this was acceptable. The steady state
> was a bug.

With the loop gone, **follow-up 3 below (the harness's own leaked painter and `AudioContext`)
is what is left, and it is small.** The post-fix runs still trend gently upward within an
invocation — screen 886 / 916 / 1013 ms, PiP 2388 / 2425 / 2502 ms — which is consistent with
one more leaked 33 ms painter and one more un-closed `AudioContext` per take. At three runs it
is a few percent and does not change any conclusion here, exactly as the original measurement
of it said; it matters only if `PERF_RUNS` is ever raised. An earlier post-fix attempt appeared
to show a much steeper PiP drift (2399 / 2882 / 3418 ms) and that was the machine, not the
harness — its third run had `rafPerSecond` 95.4 against the expected ~120. It is recorded here
because it is the sort of number that would otherwise be quoted as a finding.

## Finding, fixed: the compositor held ~23 fps against its own 30 fps target

*Everything from here to “The fix” below describes the code and the numbers as they stood
at `7432e96`, in the present tense it was written in. Every `compositor.ts` line number in
it is a line in that commit: `lastFrameTime` no longer exists, and the render loop, the
gate and the `readyState` guards have all moved. Read it as the diagnosis, not as a
description of the shipped code — and note that its closing prediction, that a fix would
move `compositedFps` without moving `taskMsPerFrame`, turned out to be wrong; see “The
fix”.*

`compositedFps` comes out at **22.4–22.8**, not the 30 the `Compositor` asks for. That is
not a measurement artefact and not a slow machine; it is the throttle's arithmetic.

`Compositor.render` (`apps/craft/src/core/compositor.ts:148-157` **at `7432e96`**) requests an animation
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
callback's own `performance.now()` (`compositor.ts:153-154` at `7432e96`) rather than to vsync, so the
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
  `drawOverlay` (then `Compositor.drawWebcamOverlay`) draws the webcam video, one `drawImage` each, **inside one synchronous
  rAF callback** — so a counter snapshot can never land between them. Each draw is guarded
  on its element's `readyState >= 2` (`compositor.ts:170`, `:175` at `7432e96`), so a frame composited
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

### The fix (ESCSUITE-54, 2026-09-19)

`Compositor.render` now holds a deadline, `nextFrameDue`, and draws when
`now >= nextFrameDue - FRAME_TOLERANCE_MS` with `FRAME_TOLERANCE_MS = 4`. The deadline is
advanced **by one frame interval from the schedule** rather than from the drawing frame's
own clock, so jitter no longer accumulates; a gap longer than a frame interval resyncs it
to `now + frameInterval` instead, so a hidden tab or a GC pause comes back to one draw per
interval rather than to a burst. 4 ms exceeds real dispatch jitter and is well under one
60 Hz tick, so two consecutive *evenly spaced* ticks still cannot both draw; under
non-uniform jitter two adjacent ticks occasionally can, which is a cadence wobble and not a
rate breach — the deadline advances a full interval per draw, so the mean rate cannot
exceed the target whatever the spacing. `start()` leaves
`nextFrameDue` at 0, which is always in the past, so the first frame is still painted
immediately. See `apps/craft/CLAUDE.md`, "The PiP frame gate".

**Measured by paired alternation** — old gate, new gate, old, new, run **sequentially**
against one warm ESCAPECRAFT dev server on 5174, `craft-recording -g "PiP"`, three takes
per arm reported as the median, same machine and launch args as the baseline above.

**Validity of the arms.** All twelve takes had `longTaskCount` **0**, and eleven of the
twelve had `rafPerSecond` within **0.5%** of 120. The twelfth — Old A run 2, at 117.83, or
**−1.81%** — is the widest deviation in the set, so the honest band is “one take at
117.8, the other eleven within 0.5%” rather than a flat ±1%. It does not touch the result:
that run is not the median for any reported metric except `taskMsPerFrame`, Old A's median
`compositedFps` (22.78) comes from run 3 at `rafPerSecond` 120.30, and Old B — whose takes
are all within 0.4% — gives the same answer.

(Two earlier attempts were discarded outright: another workload on this machine had dropped
`rafPerSecond` to 40–60 and put 12–19 long tasks in a 5 s window, which halves
`compositedFps` in *both* arms and measures the machine rather than the gate.)

| Metric (per-metric median of 3) | Old A | Old B | New A | New B |
| --- | --- | --- | --- | --- |
| **Composited fps** | 22.78 | 22.37 | **29.97** | **29.98** |
| Video draws | 228 | 224 | 300 | 300 |
| **Renderer task per frame** | 34.67 ms | 35.27 ms | 26.63 ms | 26.69 ms |
| Renderer task duration | 3992.49 ms | 3981.95 ms | 3993.81 ms | 4004.59 ms |
| Animation frames/s | 120.16 | 120.21 | 119.89 | 119.92 |
| Long tasks | 0 | 0 | 0 | 0 |

Each column is a **per-metric** median, so a row can come from a different take than the
one above it — Old A's `taskMsPerFrame` is run 2's while its `compositedFps` and
`taskDurationMs` are run 3's, which is why 3992.49 / (22.78 × 5) = 35.05 rather than the
34.67 in the table. That is the right way to take these medians and the wrong way to divide
the rows into each other. All twelve takes, so the medians and the validity claim above are
checkable:

| Arm | Run | `compositedFps` | `videoDraws` | `taskMsPerFrame` | `taskDurationMs` | `rafPerSecond` | Long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Old A | 1 | 22.76 | 228 | 17.337 ms | 1978.04 ms | 120.16 | 0 |
| Old A | 2 | 23.17 | 232 | 34.667 ms | 4019.70 ms | 117.83 | 0 |
| Old A | 3 | 22.78 | 228 | 35.025 ms | 3992.49 ms | 120.30 | 0 |
| New A | 1 | 29.92 | 300 | 14.888 ms | 2233.82 ms | 120.09 | 0 |
| New A | 2 | 29.97 | 300 | 26.896 ms | 4034.18 ms | 119.89 | 0 |
| New A | 3 | 29.97 | 300 | 26.628 ms | 3993.81 ms | 119.48 | 0 |
| Old B | 1 | 22.37 | 224 | 17.614 ms | 1972.50 ms | 119.83 | 0 |
| Old B | 2 | 21.97 | 220 | 36.597 ms | 4028.64 ms | 120.24 | 0 |
| Old B | 3 | 22.56 | 226 | 35.268 ms | 3981.95 ms | 120.21 | 0 |
| New B | 1 | 29.97 | 300 | 14.947 ms | 2243.03 ms | 120.26 | 0 |
| New B | 2 | 29.98 | 300 | 27.020 ms | 4053.27 ms | 119.92 | 0 |
| New B | 3 | 29.98 | 300 | 26.692 ms | 4004.59 ms | 119.91 | 0 |

Run 1 of every arm is the cheap first take of a session — this file's own second finding,
still open — which is why the median and not the mean is the reported figure. It behaves
identically in both arms.

`compositedFps` goes to the target it always asked for: **22.4–22.8 → 30.0**, +32%, and
`videoDraws` is 300 exactly — 30 composited frames a second over a 5 s window, each drawing
its two videos, so the `videoDraws % 2 === 0` tripwire still holds.

**`taskDurationMs` did not rise, which the fix's own reasoning did not predict.** Drawing
31% more frames was expected to cost roughly 31% more renderer time; instead the total is
flat (3992/3982 ms old against 3994/4005 ms new, inside the arms' own spread) and
`taskMsPerFrame` *falls* 23%, from ~35 ms to ~26.6 ms. The honest reading is that the
composite itself is a small part of what the renderer is doing in this window — the
synthetic 33 ms capture painter, MediaRecorder's plumbing and React are the rest — so the
extra draws fit in slack that was already being paid for, and the per-frame figure improves
because its denominator grew while its numerator did not. **That mechanism is inferred from
the flat total, not confirmed by a CPU profile** — `PERF_PROFILE=1 pnpm perf` would settle
it and was not run. What *is* measured, and all the claim needs, is that the total did not
move: the fix did not make the page more expensive. `taskMsPerFrame` is therefore
**not** the invariant here that the plan expected it to be; `taskDurationMs` is. A machine
with no slack left would show the opposite, and that is the number to watch on one.

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
28.7–29.2 rather than 30, and this is measured, not a guess: ESCSUITE-86's paired
`interval`/`raf` painter comparison (see the note under the local baseline) found the shortfall
is beating between `mockSyntheticMedia`'s `setInterval(…, 33)` capture painter and
`captureStream(30)`'s own sampling — a painter that cannot beat against the sampler the same
way records ~29.94 instead — and not the main thread's business (that theory, from the
ESCSUITE-55 error loop, is falsified in the note above it) or `WebCodecsRecorder`'s own gate
(`targetFrameInterval * 0.8` = 26.7 ms, well under what would drop this difference). So a
future change that made the page *busier* could still show up here as a lower "recorded frame
rate" that has nothing to do with the recorder — the harness's ceiling just isn't a clean 30 to
begin with. Compare `taskMsPerFrame`. **`compositedFps` is not affected** — the compositor's rAF loop draws
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
second-or-later take — which, it turned out, was ~44,500 error-event tasks a second from
ESCSUITE-55, and is the sharpest possible illustration of the point: a thread can be pinned
at 80% by work that never produces a single long task, so `longTaskCount` 0 is not evidence
that a page is healthy. Post-fix the same window is ~18% busy, still with 0 long tasks. Either
way the work is spread across many short tasks rather than concentrated — but on a machine a third the speed it would not be, which is the whole reason
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

1. ~~**The compositor's frame gate**~~ — **fixed**, ESCSUITE-54, 2026-09-19. ~23 fps where
   30 was intended, on a throttle whose gate was bit-for-bit two 60 Hz frame intervals, so
   any dispatch jitter cost a whole frame. Now a deadline gate with a 4 ms tolerance and a
   stall resync: 22.4–22.8 → 30.0 composited fps, paired numbers under the finding above.
2. ~~**The first-take step**~~ — **fixed**, ESCSUITE-55, 2026-09-21. The first take of a
   session cost ~0.9 s of renderer task in a 5 s window and every later take ~4.1 s, once and
   permanently. `thumbnailGenerator`'s `cleanup()` emptied the `<video>`'s `src` with its own
   `onerror` still attached, and an empty `src` is a load failure: each saved recording left a
   detached element spinning error → cleanup → error at ~44,500 laps a second for the life of
   the page, saturating the main thread. Handlers are now detached before the element is
   released. Numbers under the finding above; **every second-or-later figure in this document
   predates the fix and is superseded.**
3. **`mockSyntheticMedia` leaks a capture painter per take.** Harmless at three runs
   (measured flat), but it is a confound that grows with run count and the helper is shared
   with the functional E2E suites. Clearing the interval when the track ends would remove it.

## craft-separate-tracks-recording — first measurement, 2026-09-25

Added by ESCSUITE-14 slice 1. Same machine, same launch args and the same
three-runs-median as the numbers above; `pnpm perf` reports it beside the other
three.

Taken in one invocation of
`playwright test --config=playwright.perf.config.ts craft-recording`, against a
warm dev server, with the machine under real load — `uptime` at the start of the
run read `23:28 up 24 days, 17:19, 4 users, load averages: 18.67 11.74 8.37`
(one `rustc` pinning a core throughout). These numbers are informational and
were not taken on a quiet machine: treat the *shape* below as the finding and
re-measure before quoting any millisecond figure as a target.

Every cell below is the **median of its own quantity over the three runs**, taken
independently of every other cell — which is what `writePerfResult` publishes and
what `perf-report.json` carries. Two consequences worth stating out loud, because
both look like arithmetic errors and neither is: no row is necessarily a figure
any single run produced, and the parts do not have to add up to the whole (see
below the table). `Encoder queue high-water` is the one exception — a maximum
over the three runs, not a median, because it is already a maximum within each.

| Metric | Statistic over the 3 runs | Value |
|---|---|---|
| Frames encoded (screen) | median of the per-run `framesEncodedPerEncoder[0]` | 134 |
| Frames encoded (webcam) | median of the per-run `framesEncodedPerEncoder[1]` | 133 |
| Frames encoded (both, `framesEncoded`) | median of the per-run **totals** | 272 |
| Frames/s | median | 54.28 |
| Composited fps (preview only) | median | 29.93 |
| Video draws | median | 300 |
| Renderer task duration (ms) | median | 1856.83 |
| Renderer task per frame (ms) | median | 6.83 |
| Animation frames/s | median | 119.89 |
| Layouts / style recalcs | median / median | 306 / 301 |
| Long tasks / total (ms) | median / median | 0 / 0 |
| Encoder queue high-water | **max** | 0 |
| Heap delta (bytes) | median | −378,267 |
| Output size (bytes, screen part) | median | 1,515,266 |

The three runs behind those cells, so the table can be checked against them:

| Run | screen | webcam | total | renderer task | task/frame | composited fps |
|---|---|---|---|---|---|---|
| 1 | 134 | 138 | 272 | 1736.99 ms | 6.382 ms | 29.76 |
| 2 | 129 | 128 | 257 | 1879.19 ms | 7.298 ms | 29.97 |
| 3 | 139 | 133 | 272 | 1856.83 ms | 6.830 ms | 29.93 |

The two per-encoder counts are written on all three recording arms so the JSON
keeps one shape: PiP constructs no `VideoEncoder` at all and reports `0 / 0`, and
the screen arm runs a single encoder, so its `Frames encoded (screen)` repeats its
`Frames encoded` (149 here) — which is what that one encoder is.

`Frames encoded (both)` is 272 where the two per-encoder cells sum to 267, and no
cell is wrong: the median of the per-run totals (`median(272, 257, 272) = 272`) is
a different statistic from the sum of the two per-encoder medians
(`median(134, 129, 139) + median(138, 128, 133) = 134 + 133 = 267`), because the
middling run for a total need not be the middling run for either part — here run 1
is the median total while run 3 is the median screen count. Both are published
because both answer a question: the total is what the main thread encoded, and the
split is what each pipeline contributed.

The split also says the two pipelines stayed together: 134/138, 129/128 and
139/133 — within a handful of frames of each other in every run, on a window that
carried ~135 frames per pipeline, which is what running both off one clock is for.
They are not expected to be frame-identical: the two capture tracks deliver
independently and only the timestamps are shared.

What the row is *for* is the comparison against `craft-pip-recording` directly
above it: the same capture, one mode encoding on the main thread twice over and
the other handing one composited stream to MediaRecorder. Side by side, from the
same invocation:

| | screen only | PiP | separate tracks |
|---|---|---|---|
| Renderer task duration | 611.08 ms | 2039.16 ms | **1856.83 ms** |
| Renderer task per frame | 4.14 ms (per encoded frame) | 13.51 ms (per *composited* frame) | 6.83 ms (per encoded frame) |
| Composited fps | — | 29.97 | 29.93 |
| Animation frames/s | 59.94 | 119.88 | 119.89 |
| Video tracks stored | 1 | 1 | 2 |

The headline is that **two encoders in the page cost less main-thread time than
one composited MediaRecorder take** here — 1857 ms against 2039 ms in the same
5 s window, for twice the stored video. The separate-tracks mode drops
`canvas.captureStream(30)` and MediaRecorder entirely; what remains on the main
thread is two `MediaStreamTrackProcessor` readers each driving its own
`VideoEncoder.encode`, plus the compositor still drawing the preview (300 video
draws, 29.93 composited fps — indistinguishable from PiP's, which is what says the
preview was not degraded to pay for the second encoder; note the preview
composited ~150 frames in the window while each pipeline encoded ~135, so the two
rates are related but not locked). The
per-frame figure is higher than the screen arm's 4.14 ms because the compositor's
preview loop is charged to it and the screen arm has no compositor at all; the
rate is not directly comparable between the two.

Also worth noting: 0 long tasks and an encoder queue high-water of **0** across
all three runs. Two 720p encoders on the main thread never fell behind the
capture on this machine, even loaded — the queue never held a frame at the moment
one was handed over.

`outputBytes` is the **screen** part alone. Both parts of a take are written with
the same `recordedAt` (one `now` for the pair), so `readNewestRecordingBytes`
breaks the tie towards the primary rather than leaving a coin toss between the
two halves in the report; it therefore understates the take's total bytes by
roughly the webcam part — which is the "about twice the storage" the toggle warns
about. For scale, the screen-only arm in the same invocation stored 1,642,328
bytes for a take of the same length.

## craft-separate-tracks-recording — re-measured for the audio companions, 2026-09-25

ESCSUITE-14 slice 3 gave the microphone its own `AudioEncoder` and its own
Mediabunny output, so this arm now runs **two video encoders and two audio
encoders** on the main thread (the mix on the primary, the microphone companion
beside it) and writes three files instead of two. The first measurement above
describes the two-file take and is kept for comparison, not superseded.

Three files, not four: `openCraft` leaves ESCAPECRAFT's defaults alone, and the
microphone is on by default while system audio is off — so the take asks
`getDisplayMedia` for no audio, `mockSyntheticMedia`'s synthetic display stream
carries no audio track, and no system part is built. The take therefore lands as
the screen primary (carrying the mixed audio), the webcam companion and the
microphone companion. That the count is exactly three is enforced, not assumed:
`measureTake` waits for `rowsBefore + 3` library rows after Stop, so a fourth
part or a missing one fails the benchmark instead of letting the heap reading be
taken mid-write.

The two audio encoders are counted the same way the video ones are — a `WeakMap`
keyed on the encoder instance, in first-encode order — and the count is **not
published**: it is read inside `measureTake` as a tripwire (`toBe(2)`) and
dropped, because it is an invariant the numbers rest on rather than a number
worth a row in the report. A mode that quietly recorded its sound into the mix
alone would still run two video encoders, still composite for the preview, and
still look right in every cell below.

Same machine, same launch args, same three-runs-median, taken in one invocation
of `playwright test --config=playwright.perf.config.ts craft-recording` against
a warm dev server. `uptime` at the start of the run read
`6:05 up 24 days, 23:57, 4 users, load averages: 2.54 3.45 4.18` — a quieter
machine than the first measurement's (which carried a load average of 18.67 and
a `rustc` pinning a core), so the millisecond figures below are *lower* than the
ones above for reasons that have nothing to do with the audio companions. The
shape is the finding; re-measure before quoting any millisecond figure as a
target, and do not read the difference between the two sections as a change in
cost.

Every cell below is the **median of its own quantity over the three runs**, taken
independently of every other cell, exactly as in the first measurement.
`Encoder queue high-water` is the one exception — a maximum over the three runs,
not a median, because it is already a maximum within each.

| Metric | Statistic over the 3 runs | Value |
|---|---|---|
| Frames encoded (screen) | median of the per-run `framesEncodedPerEncoder[0]` | 144 |
| Frames encoded (webcam) | median of the per-run `framesEncodedPerEncoder[1]` | 143 |
| Frames encoded (both, `framesEncoded`) | median of the per-run **totals** | 288 |
| Frames/s | median | 57.54 |
| Composited fps (preview only) | median | 29.96 |
| Video draws | median | 300 |
| Renderer task duration (ms) | median | 1724.09 |
| Renderer task per frame (ms) | median | 6.04 |
| Animation frames/s | median | 119.85 |
| Layouts / style recalcs | median / median | 305 / 300 |
| Long tasks / total (ms) | median / median | 0 / 0 |
| Encoder queue high-water | **max** | 0 |
| Heap delta (bytes) | median | −386,946 |
| Output size (bytes, screen part) | median | 1,635,196 |

The three runs behind those cells, so the table can be checked against them:

| Run | screen | webcam | total | renderer task | task/frame | composited fps |
|---|---|---|---|---|---|---|
| 1 | 136 | 143 | 279 | 1724.09 ms | 6.180 ms | 29.96 |
| 2 | 144 | 149 | 293 | 1697.81 ms | 5.795 ms | 29.96 |
| 3 | 146 | 142 | 288 | 1739.13 ms | 6.039 ms | 29.97 |

The same per-cell-median arithmetic as the first measurement applies, and shows
again: `Frames encoded (both)` is 288 where the two per-encoder cells sum to 287,
because the median of the per-run totals (`median(279, 293, 288) = 288`, run 3)
is a different statistic from the sum of the two per-encoder medians
(`median(136, 144, 146) + median(143, 149, 142) = 144 + 143 = 287`, runs 2 and 1).
Neither cell is wrong; see the first measurement for why both are published.

The split says the two video pipelines stayed together with the audio companions
running beside them: 136/143, 144/149 and 146/142, within a handful of frames of
each other in every run on a window carrying ~145 frames per pipeline. They are
not expected to be frame-identical — the two capture tracks deliver
independently and only the timestamps are shared.

Side by side with the other two arms, from the same invocation:

| | screen only | PiP | separate tracks |
|---|---|---|---|
| Renderer task duration | 703.00 ms | 1991.62 ms | **1724.09 ms** |
| Renderer task per frame | 4.77 ms (per encoded frame) | 13.28 ms (per *composited* frame) | 6.04 ms (per encoded frame) |
| Composited fps | — | 29.95 | 29.96 |
| Animation frames/s | 59.94 | 120.08 | 119.85 |
| Video encoders on the main thread | 1 | 0 | 2 |
| Audio encoders on the main thread | 1 | 0 | 2 |
| Files stored per take | 1 | 1 | 3 |

The slice 1 headline holds with the audio companions in place: **two video
encoders and two audio encoders in the page still cost less main-thread time
than one composited MediaRecorder take** — 1724 ms against 1992 ms in the same
5 s window, for twice the stored video and the microphone as its own file. The
preview was not degraded to pay for any of it (300 video draws, 29.96 composited
fps, indistinguishable from PiP's 29.95), the animation-frame rate is unchanged
at ~120/s, and the layout and style-recalc counts are within a few of PiP's — the
three extra library rows are written after the measured window closes, so the
saving path does not appear in these numbers at all.

Also unchanged: 0 long tasks and an encoder queue high-water of **0** across all
three runs. Four encoders on the main thread never fell behind the capture on
this machine — the queue never held a frame at the moment one was handed over.
The Opus encodes are cheap next to the two 720p video ones, which is what that
says.

`outputBytes` is the **screen** part alone, and now for a sharper reason: a
separate-tracks take writes three records carrying the identical `recordedAt`
(one `now` for the whole take), so the timestamp cannot order them and store
order is uuid order. The tie is broken towards the **primary** — the part with no
role, or the role `screen` — rather than "anything but the webcam", which was
deterministic while a take had two parts and a coin toss once it had three. So
the figure understates the take's total bytes by the webcam part and the
microphone part; for scale, the screen-only arm in the same invocation stored
1,642,586 bytes for a take of the same length, and the microphone's Opus file is
small next to either video part.

## ESCSUITE-67: preview-only compositor at 15 fps (2026-09-25)

**The question.** In separate-tracks mode the `Compositor` draws for the preview alone
(`startPreviewOnly()`, no `captureStream`) and still holds 30 fps, on the same main thread as
two `VideoEncoder`s. Nothing samples that canvas — the recorder reads the raw tracks — so the
30 is not a sampling rate any more, it is just how often the user's own screen is repainted in
front of them. Does halving it measurably help the encoders?

**Decision: keep 30.** The main thread got a lot cheaper and the encoders got nothing, because
on this machine they were never behind. The numbers and the caveats are below; what would have
to be true to revisit is at the end.

### The change measured

One literal in `apps/craft/src/core/compositor.ts`, and nothing else — in particular the
composited-recording path (`start(frameRate)`, which a PiP take still calls with the take's own
rate) was untouched:

```diff
-  startPreviewOnly(frameRate: number = 30): void {
+  startPreviewOnly(frameRate: number = 15): void {
```

`useRecordingController` calls `startPreviewOnly()` with no argument, so the default is the whole
knob.

### Machine, load and method

Same machine and same launch args as everything above, including `--disable-gpu` — which matters
here more than anywhere else in this file; see "What to distrust".

`uptime` before each round, in order:

| Round | `uptime` load averages |
|---|---|
| 30A | `17:37 up 25 days, 11:28, 4 users, load averages: 2.88 5.83 8.44` |
| 15A | `17:38 … load averages: 2.27 5.14 8.00` |
| 30B | `17:38 … load averages: 2.48 4.86 7.78` |
| 15B | `17:39 … load averages: 3.80 4.94 7.71` |
| 30C | `17:39 … load averages: 4.06 4.85 7.56` |
| 15C | `17:40 … load averages: 5.07 5.04 7.52` |

Load-1 was 5.15 when the work started, so the first round waited for it to fall under 4; it
then climbed back from 2.27 to 5.07 over the six rounds. That drift is the reason for the
alternation and it happens to run *against* the result — see "What to distrust".

**Paired alternation**, the method "The fix (ESCSUITE-54)" above used: 30, 15, 30, 15, 30, 15
run sequentially against one warm ESCAPECRAFT dev server on 5174, flipping that one literal
between rounds, only the separate-tracks arm selected. Each round is `PERF_RUNS = 3` takes
reported as a per-metric median, so the six rounds are **18 takes**, nine per arm. One further
round was run first and discarded as the warm-up. One collection hiccup, for the record: the
driver script aborted after the first 30 fps round (it assigned to `status`, which zsh reserves as
a read-only alias of `$?`); that round had already finished and its JSON was recovered intact from
`perf-results/`, and the sequence continued contiguously — nothing was re-run or dropped.

```bash
# Two warm dev servers, started by hand and left running for all six rounds, so
# playwright's reuseExistingServer never restarts one mid-sequence.
( cd apps/craft  && pnpm exec vite --port 5174 --strictPort )
( cd apps/artist && pnpm exec vite --port 5175 --strictPort )

# One round. Run six times, flipping the literal above between rounds.
cd apps/e2e
pnpm exec playwright test --config playwright.perf.config.ts craft-recording -g "separate tracks"

# perf-global-setup.ts empties perf-results/ at the start of every invocation, so
# each round's JSON has to be copied out before the next one runs.
cp perf-results/craft-separate-tracks-recording.json /tmp/e67-runs/30A.json
```

`-g "separate tracks"` (with the space) selects exactly one test — the recording arm. The
composite-conversion benchmark is titled "separate-tracks" with a hyphen and is not matched;
`--list` confirms one test before starting.

### The change took effect, and the tripwires held

All six rounds passed. `compositedFps` is the tripwire that says the knob was actually turned,
and `videoDraws` is the one that says the benchmark can still divide by two:

| | 30 fps arm | 15 fps arm |
|---|---|---|
| `compositedFps` (median of 9) | **29.97** | **14.98** |
| `compositedFps` (range of 9) | 29.96 – 30.11 | 14.97 – 14.98 |
| `videoDraws` | 300 in 8 takes, 302 in one | **150 in all nine** |
| `videoDraws % 2 === 0` | holds | holds |
| `videoDraws > 0` | holds | holds |
| Video encoders (`framesEncodedPerEncoder.length`) | 2 | 2 |
| Either encoder at zero | never | never |
| Audio encoders | 2 | 2 |
| Library rows per take | 3 | 3 |

150 draws is 15 composited frames a second over a 5 s window, each drawing its two videos.
Note that **`rafPerSecond` does not move** — 119.88 against 119.87 — because the compositor
still requests an animation frame every frame and the gate simply returns early twice as
often. The loop count is unchanged; only the draws are halved.

### Per arm, over nine takes each

Medians and ranges over all nine takes of each arm, not the per-round published medians, so the
spread is the real one:

| Metric | 30 fps (median) | 30 fps (range) | 15 fps (median) | 15 fps (range) | Change |
|---|---|---|---|---|---|
| **Renderer task per frame** | **6.152 ms** | 5.989 – 6.201 | **4.847 ms** | 4.694 – 4.904 | **−21.2%** |
| **Renderer task duration** | **1737.09 ms** | 1710.24 – 1763.74 | **1312.20 ms** | 1299.31 – 1318.52 | **−24.5%** |
| Long tasks | 0 | 0 – 0 | 0 | 0 – 0 | none to gain |
| Encoder queue high-water | 0 | 0 – 0 | 0 | 0 – 0 | none to gain |
| Frames encoded (both pipelines) | 286 | 278 – 290 | 271 | 267 – 279 | −5.2% |
| Frames encoded (screen / webcam) | 143 / 144 | 134–145 / 141–146 | 135 / 139 | 125–140 / 132–143 | −5.6% / −3.5% |
| Composited fps | 29.97 | 29.96 – 30.11 | 14.98 | 14.97 – 14.98 | −50.0% |
| Animation frames/s | 119.88 | 119.83 – 120.26 | 119.87 | 119.81 – 120.26 | flat |
| Layouts / style recalcs | 305 / 300 | 293–306 / 300–302 | 301 / 300 | 295–306 / 300–301 | flat |
| Heap delta (bytes) | −586,375 | −682,032 … −182,165 | −387,037 | −716,614 … −252,645 | no signal |
| Output size (screen part) | 1,568,897 | 1,497,568 – 1,636,970 | 1,528,052 | 1,497,746 – 1,595,312 | tracks the frames |

**The two cost metrics do not overlap at all.** The worst take in the 15 arm (1318.52 ms) is
still cheaper than the best take in the 30 arm (1710.24 ms), and the same holds per frame
(4.904 against 5.989). Within-arm spread is 3.1% and 1.5% on the total, 3.4% and 4.3% per
frame, against gaps of 24.5% and 21.2%. So the bound is not "−24.5% ± noise" but
**−22.9% to −26.3%** on the total and **−18.1% to −24.3%** per frame, taking the two ranges'
closest and furthest ends. It clears the noise by a wide margin.

All eighteen takes, so the table above is checkable:

| Arm | Run | screen | webcam | total | `videoDraws` | `compositedFps` | `taskDurationMs` | `taskMsPerFrame` | `rafPerSecond` | LT | queue |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 30A | 1 | 136 | 145 | 281 | 300 | 29.96 | 1743.54 ms | 6.201 ms | 120.26 | 0 | 0 |
| 30A | 2 | 134 | 144 | 278 | 300 | 29.97 | 1710.24 ms | 6.152 ms | 119.90 | 0 | 0 |
| 30A | 3 | 145 | 143 | 288 | 300 | 29.97 | 1724.71 ms | 5.989 ms | 119.88 | 0 | 0 |
| 15A | 1 | 125 | 143 | 268 | 150 | 14.98 | 1299.31 ms | 4.847 ms | 119.82 | 0 | 0 |
| 15A | 2 | 131 | 139 | 270 | 150 | 14.98 | 1309.92 ms | 4.852 ms | 119.82 | 0 | 0 |
| 15A | 3 | 138 | 141 | 279 | 150 | 14.98 | 1313.27 ms | 4.706 ms | 119.86 | 0 | 0 |
| 30B | 1 | 143 | 144 | 287 | 302 | 30.11 | 1739.18 ms | 6.069 ms | 120.05 | 0 | 0 |
| 30B | 2 | 137 | 143 | 280 | 300 | 29.96 | 1732.98 ms | 6.190 ms | 119.83 | 0 | 0 |
| 30B | 3 | 144 | 146 | 290 | 300 | 29.97 | 1737.09 ms | 5.989 ms | 119.88 | 0 | 0 |
| 15B | 1 | 140 | 139 | 279 | 150 | 14.98 | 1309.37 ms | 4.694 ms | 120.26 | 0 | 0 |
| 15B | 2 | 128 | 143 | 271 | 150 | 14.97 | 1318.52 ms | 4.868 ms | 120.16 | 0 | 0 |
| 15B | 3 | 135 | 140 | 275 | 150 | 14.98 | 1317.05 ms | 4.789 ms | 119.87 | 0 | 0 |
| 30C | 1 | 143 | 143 | 286 | 300 | 29.96 | 1747.05 ms | 6.098 ms | 119.85 | 0 | 0 |
| 30C | 2 | 134 | 145 | 279 | 300 | 29.97 | 1722.44 ms | 6.174 ms | 119.88 | 0 | 0 |
| 30C | 3 | 145 | 141 | 286 | 300 | 29.97 | 1763.74 ms | 6.167 ms | 119.87 | 0 | 0 |
| 15C | 1 | 136 | 135 | 271 | 150 | 14.98 | 1317.71 ms | 4.864 ms | 119.87 | 0 | 0 |
| 15C | 2 | 133 | 134 | 267 | 150 | 14.98 | 1312.20 ms | 4.904 ms | 120.21 | 0 | 0 |
| 15C | 3 | 139 | 132 | 271 | 150 | 14.98 | 1307.17 ms | 4.825 ms | 119.81 | 0 | 0 |

The first-take step this file's second finding describes is not visible in these rounds: every
round's three takes are within its arm's ordinary spread, because the dev server and the page
were already warm from the discarded round and each round loads a fresh page into a warm
process.

### So what did the encoders gain? Nothing measurable.

The freed time is real and large. Nothing the encoders do moved:

- **`encoderQueueHighWater` is 0 in all eighteen takes.** The queue never held a frame at the
  moment another was handed over — in *either* arm. Two 720p encoders on the main thread were
  not behind the capture at 30 fps, so there was no backlog for 15 fps to drain.
- **`longTaskCount` is 0 in all eighteen takes**, in either arm. No frame was ever handed to an
  encoder late because something else held the thread for 50 ms.
- **`framesEncoded` went *down*, not up** — median 286 → 271, −5.2%. Per pipeline the screen
  half lost 5.6% and the webcam half 3.5%, and the two arms' ranges overlap (278–290 against
  267–279, meeting at 279). If the encoders had been starved at 30 fps this is the number that
  would have risen.

That last one wants an explanation rather than a shrug, and the most likely one is the fixture,
not the app. `mockSyntheticMedia` paints its source canvas on a **33 ms** `setInterval` and
hands out `canvas.captureStream(30)` — a 33.33 ms cap. Those are the same zero-margin collision
ESCSUITE-54 was about, one layer down: a paint that lands a hair *early* against the cap is
dropped rather than captured, and which side of 33.33 ms a 33 ms timer lands on is decided
entirely by how busy the main thread is. A *busier* thread delays the painter past the boundary
and lets the frame through; the 15 fps arm's quieter thread fires the timer closer to its ideal
33 ms and loses a few more to the cap. That is consistent with the direction and the size, and
with both pipelines reading the same fixture. **It is inferred from the arithmetic, not confirmed
by a profile** — `PERF_PROFILE=1` would settle it and was not run. Either way it is a property
of the synthetic capture and not something a user's screen share does, and it means the −21.2%
per-frame figure is the *conservative* reading of the −24.5% total: its denominator shrank
while its numerator shrank much more.

### What to distrust

**`--disable-gpu` is in `PERF_LAUNCH_ARGS`, and this is the one benchmark where that is the
headline caveat.** 425 ms saved over 150 dropped composited frames is **2.83 ms of renderer
time per 720p composite**, which is the cost of software-rasterising a full-frame
`drawImage` from a video plus a clipped overlay draw and a stroke. On a user's machine that
draw is GPU-rasterised and the main thread mostly issues commands. So **the measured saving is
an upper bound taken on a machine no user has**, and the fraction of it a real separate-tracks
recording would recover is unknown and smaller. The encoders, by contrast, do the same work in
both worlds.

**The drift runs against the result, which is the good direction.** Load-1 climbed from 2.27 to
5.07 across the six rounds and the 15 fps arm always ran *second* within its pair, so a rising
trend should have made the 15 arm look worse. It looked 24% better instead — the effect is
anti-correlated with the drift, so drift cannot be what produced it. (It cannot explain the
frames-encoded dip either: a rising external load would, by the mechanism above, deliver *more*
capture frames, not fewer.)

**This refines the ESCSUITE-54 note above.** That section measured a *flat* `taskDurationMs`
when `compositedFps` went 22.4 → 30 and inferred "the composite itself is a small part of what
the renderer is doing in this window". Halving the rate in *this* mode moves the total 24.5%,
so the composite is **a quarter of the renderer's task time** here. The two are not in direct
contradiction — that arm was composited PiP, whose total also carries `captureStream(30)` and
MediaRecorder's plumbing, and it *raised* the rate by a third rather than halving it, into slack
that happened to exist. But the earlier section's inference should not be carried over to this
mode: in separate-tracks mode, with no `captureStream` and no MediaRecorder, the preview loop is
a large and clearly visible share of the total, and `taskDurationMs` is the number that shows it.

### The decision, and what would have to be true to revisit

**Keep 30. No code change.** The rule for this experiment was to lower the preview rate only if
the encoders measurably benefit, and they did not: queue high-water 0 → 0, long tasks 0 → 0,
frames encoded flat to slightly down. What 15 fps buys is **headroom** — a quarter of this
mode's renderer time, inflated by `--disable-gpu` — and the price is paid by the one thing that
canvas is still for. The preview is how the user confirms the recording is running and sees
where the camera overlay sits; halving its smoothness is a visible cost on every separate-tracks
take, in exchange for slack that nothing measured here needs. The recording itself would not
change either way — the recorder reads the raw tracks — so there is no output quality to trade,
only the live view.

Revisit when the encoders are actually the constrained party. Concretely, any of these would
turn the answer around:

- **A 30 fps arm with a non-zero `encoderQueueHighWater`, a non-zero `longTaskCount`, or a
  `framesEncodedPerEncoder` visibly short of what the capture delivered — that recovers at 15.**
  That is the measurement this experiment failed to produce, and it is the whole decision.
- **A bigger capture.** 1280x720 is what `craft-separate-tracks-recording` uses; two 1080p or
  4K encoders on the main thread are a different proposition, and the arm would need
  `CAPTURE_SIZE` raised (there is no env override for it, unlike the preview scene's
  `PERF_PROJECT_RESOLUTION`).
- **Fewer cores, or a real GPU.** Dropping `--disable-gpu` would move the preview's share of
  the total to something like what a user pays and is arguably the more honest arm for this
  particular question; a weaker machine would show whether the headroom is ever needed.
- **An adaptive rate instead of a fixed one.** The better shape, if a constrained arm ever turns
  up, is not a blanket 15 but falling back to it only while the encoder queue is non-empty —
  which would take the headroom on the machines that need it and leave the preview alone on the
  machines that do not. That is a bigger change than this experiment's one literal, and it
  should not be built before there is a measurement showing something to fix.
