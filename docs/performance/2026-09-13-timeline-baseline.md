# Timeline interaction baseline — 2026-09-13

The first numbers for the timeline's pointer gestures, taken before any optimisation
work in performance round 2. Everything later in the round is measured against this
file.

Round 1 measured what the editor costs while it *plays* and while it *exports*
([2026-09-12-baseline.md](2026-09-12-baseline.md)). It never measured what the editor
costs while someone is *editing*, which is where a user spends nearly all of their
time. This file is that half.

Reproduce with:

```bash
pnpm perf                                       # the browser benchmark, in perf-report.json
pnpm --filter @escapesuite/artist exec vitest run \
  src/components/Timeline/timelineGestures.perf.test.ts   # the per-frame call counts
```

## What is measured

### The browser benchmark — `apps/e2e/tests/perf/timeline-interaction.spec.ts`

The same deterministic scene round 1 used: 14 clips over 4 tracks at a 1280×720
project resolution, built in-test from `apps/e2e/fixtures/headless/source.mp4` and
loaded through the documented integration API. See
[2026-09-12-baseline.md](2026-09-12-baseline.md#what-is-measured) for how the scene is
built; nothing about it changed.

Three gestures, each driven with synthetic pointer events (`page.mouse.move/down/up`,
one `mousemove` per call, so the frame count is the benchmark's own rather than a
helper's interpolation):

| Gesture | Shape |
|---|---|
| `clipDrag` | Grab `perf-clip-0` at its centre, 60 moves across the scene and up onto `perf-track-1`, release. The drop is at 14 s — past the 13 s scene, so the commit cannot be vetoed for an overlap. |
| `marquee` | Press on empty track space at 15 s, 60 moves walking three sides of a rectangle over both media rows, release. The rectangle it leaves selects clips on both rows. |
| `playheadScrub` | Press the playhead where a ruler click parked it at 2 s, 60 moves right to 12 s, release. |

Each gesture is run three times, and every run re-installs the scene through
`LOAD_PROJECT` and resets the selection and the playhead through the app's own
handlers, so all three runs move the same clip from the same place. Wall-time metrics
are reported as the median of the three.

The press, and the first move after it, are driven **outside** the measured window.
A mousedown is where a gesture pays its one-off costs — the React commit that installs
the drag state, the effect that binds the document listeners, the first measurement of
the container — and charging those to a per-move average would flatter every later
move. What the window holds is the steady state, which is the thing a fix has to move.

Each gesture **asserts that it did something**: the clip's track and offset, every
clip's class list, and the playhead's offset are sampled before the press and after the
release, and the benchmark fails if they agree. A drag the store vetoed for an overlap,
a marquee that selected nothing, or a scrub that missed the playhead would otherwise
report a very respectable cost for doing nothing at all — the same reasoning as
`measurePlayback`'s still-playing tripwire.

### The per-frame call counts — `apps/artist/src/components/Timeline/timelineGestures.perf.test.ts`

Ordinary vitest tests over the same scene (`src/test/fixtures/perfScene.ts`), driving
each gesture hook through `renderHook` + `act` over 20 synthetic mousemoves and counting
what one pointer frame costs in **calls**: `document.addEventListener` /
`removeEventListener`, `getBoundingClientRect` (container and track rows counted
separately), `querySelectorAll`, `getSnapPoints`, and — through the rendered `Timeline`
— `TimelineTrack` / `TrackHeader` / `TimelineRuler` renders and `getRulerTicks` calls.

## Two corrections to the decomposition review

The review that opened this round said all five gesture hooks re-bind their `document`
listeners on every pointer frame, and that the marquee walks the track rows per frame.
Both are recorded here, measured, before anything is fixed:

1. **Three of the five hooks re-bind per frame, not five.** `useClipDrag`,
   `useTrimDrag` and `useTimelineMarquee` each write something their own effect depends
   on (`dragState`; the store, so `clips` is a fresh array; `tlMarqueeCurrent`), so the
   pair of listeners is torn down and re-added on every move — **42 adds and 42 removes
   for a 20-move gesture** in all three cases. `usePlayheadDrag` and `useInOutDrag`
   write only booleans and call stable zustand actions, so their deps never change
   mid-gesture: **2 adds and 2 removes for the whole gesture**, measured, today. A plan
   that "fixed" the playhead scrub would be a no-op dressed up as a win.
2. **The marquee's row walk is on the mouseup path only.** During the 20 moves it makes
   **0** `querySelectorAll` calls and **0** track-row rect reads; on release it makes
   **1** and **4** (one per track). That is already once per gesture and is asserted
   exactly, so it stays that way.

## Local baseline

`pnpm perf`, the `timeline-interaction` section of `perf-report.json`, medians of three
runs:

| Metric | `clipDrag` | `marquee` | `playheadScrub` |
| --- | --- | --- | --- |
| Pointer moves | 60 | 60 | 60 |
| **Layouts per move** | **0.83** | **0.98** | **1.00** |
| Style recalcs per move | 1.25 | 2.02 | 4.45 |
| Renderer task per move | 23.72 ms | 23.92 ms | 30.41 ms |
| Renderer task duration | 1423.09 ms | 1435.01 ms | 1824.53 ms |
| Wall time | 2007.40 ms | 2137.20 ms | 2544.30 ms |
| Layouts | 50 | 59 | 60 |
| Style recalcs | 75 | 121 | 267 |
| Long tasks | 0 | 0 | 0 |
| Long-task total | 0 ms | 0 ms | 0 ms |
| Heap delta | 188.1 KB | 397.9 KB | 32.2 KB |

The three runs behind each median, so the noise band is visible rather than hidden:

### `clipDrag`

| Run | Wall | Renderer task | Task/move | Layouts | Layouts/move | Recalcs | Recalcs/move | Long tasks | Heap delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2367.0 ms | 1632.97 ms | 27.216 ms | 50 | 0.83 | 73 | 1.22 | 0 | 395.7 KB |
| 2 | 2007.4 ms | 1423.09 ms | 23.718 ms | 50 | 0.83 | 75 | 1.25 | 0 | −201.0 KB |
| 3 | 1933.1 ms | 1353.39 ms | 22.556 ms | 49 | 0.82 | 75 | 1.25 | 0 | 188.1 KB |

Spread: task/move 22.56–27.22 ms (±10% about the median); layouts/move 0.82–0.83.

### `marquee`

| Run | Wall | Renderer task | Task/move | Layouts | Layouts/move | Recalcs | Recalcs/move | Long tasks | Heap delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2080.2 ms | 1417.18 ms | 23.620 ms | 59 | 0.98 | 121 | 2.02 | 0 | 397.9 KB |
| 2 | 2137.2 ms | 1435.01 ms | 23.917 ms | 59 | 0.98 | 123 | 2.05 | 0 | 877.7 KB |
| 3 | 2151.0 ms | 1480.09 ms | 24.668 ms | 59 | 0.98 | 120 | 2.00 | 0 | −387.5 KB |

Spread: task/move 23.62–24.67 ms (±2%); layouts/move 0.98 in all three.

### `playheadScrub`

| Run | Wall | Renderer task | Task/move | Layouts | Layouts/move | Recalcs | Recalcs/move | Long tasks | Heap delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2636.7 ms | 1903.37 ms | 31.723 ms | 60 | 1.00 | 263 | 4.38 | 0 | 417.5 KB |
| 2 | 2505.4 ms | 1819.79 ms | 30.330 ms | 60 | 1.00 | 270 | 4.50 | 0 | 32.2 KB |
| 3 | 2544.3 ms | 1824.53 ms | 30.409 ms | 60 | 1.00 | 267 | 4.45 | 0 | 15.2 KB |

Spread: task/move 30.33–31.72 ms (±2%); layouts/move 1.00 in all three.

### Run-to-run spread **between** invocations — the important caveat

Six invocations of the benchmark were taken on this machine while writing this file:
three of the spec alone and three full `pnpm perf` runs. The medians:

| Invocation | `clipDrag` task/move | `marquee` | `playheadScrub` | `clipDrag` layouts/move | `marquee` | `playheadScrub` |
| --- | --- | --- | --- | --- | --- | --- |
| A — spec alone, cold Vite | 24.99 ms | 19.70 ms | 32.48 ms | 0.82 | 0.98 | 1.00 |
| B — spec alone, warm | 10.33 ms | 10.58 ms | 12.81 ms | 0.82 | 0.98 | 1.00 |
| C — spec alone, warm | 10.16 ms | 10.53 ms | 14.51 ms | 0.83 | 0.98 | 1.00 |
| D — `pnpm perf`, machine idle before it | 9.08 ms | 9.53 ms | 12.12 ms | 0.82 | 0.98 | 1.00 |
| E — `pnpm perf`, back to back after D | 25.53 ms | 21.15 ms | 32.62 ms | 0.82 | 0.98 | 1.00 |
| F — `pnpm perf`, back to back after E (**tabulated above**) | 23.72 ms | 23.92 ms | 30.41 ms | 0.83 | 0.98 | 1.00 |

A and E ran with `--strictPort` against a dev server that had just been started (A) or
that had just failed a `preview-playback` scene load (E, see "Known flake" below); D and
F are the two clean, green `pnpm perf` runs, and they still differ by 2.6×.

**The millisecond figures move by up to 2.5× between invocations; the per-move layout
and recalc counts do not move at all.** Wall time moves with them in almost exactly the
same ratio, and the layout and recalc *counts* are identical — that is, the same work
took longer, not more work happening. The likeliest cause is the obvious one on this
machine: an i9-8950HK in a laptop chassis, running a `pnpm perf` that is two minutes of
sustained encoding before the gesture spec even starts. Invocations D and B/C followed
an idle period; A followed a cold Vite (which additionally pays module-transform cost
on first load); E and F were back-to-back after a full run.

Two consequences, and they govern how round 2 is allowed to argue:

- **`layoutsPerFrame` and `recalcsPerFrame` are the metrics to compare.** They are
  stable to the second decimal across every invocation above, which makes them the only
  figures here a plain before/after can move an argument with.
- **No millisecond claim without paired alternation, ≥3 rounds** — base and patched code
  swapped on one warm dev server, both arms and the spread quoted. A sequential
  before/after on this machine can produce a 2.5× "win" from nothing at all, and this
  table is the proof. This is the same rule round 1 arrived at for the export figures
  (see [2026-09-12-profile.md](2026-09-12-profile.md)'s "After round 1" section), only
  more so.

## Per-frame call counts

`pnpm --filter @escapesuite/artist exec vitest run src/components/Timeline/timelineGestures.perf.test.ts`,
measured 2026-09-13 over a 20-move gesture. Ceilings in the test file are 2× the
measurement, rounded up; rows marked **exact** are properties rather than budgets and
are asserted exactly; rows marked **FINDING** pin what the code does *today* and carry,
in the test, the assertion to flip when it is fixed.

| Hook | Counter | Measured (20 moves) | Per move | Pinned as |
| --- | --- | --- | --- | --- |
| `useClipDrag` | listener adds / removes | 42 / 42 | ~1 pair | **exact** adds == removes; **FINDING** adds == 2·(moves+1) |
| `useClipDrag` | container rects | 20 | 1 | ≤ 2 / move |
| `useClipDrag` | track-row rects | 80 | 4 | ≤ 8 / move |
| `useClipDrag` | `querySelectorAll` | 20 | 1 | ≤ 2 / move |
| `useClipDrag` | `getSnapPoints` | 20 | 1 | ≤ 2 / move |
| `useTrimDrag` | listener adds / removes | 42 / 42 | ~1 pair | **exact** adds == removes; **FINDING** adds == 2·(moves+1) |
| `useTrimDrag` | container rects | 20 | 1 | ≤ 2 / move |
| `useTrimDrag` | row rects, `querySelectorAll` | 0, 0 | 0 | **exact** 0 |
| `useTimelineMarquee` | listener adds / removes | 42 / 42 | ~1 pair | **exact** adds == removes; **FINDING** adds == 2·(moves+1) |
| `useTimelineMarquee` | container rects | 21 over press + moves, 22 with the release | 1 | ≤ 2 / move, ≤ 2 on release |
| `useTimelineMarquee` | `querySelectorAll` | 0 during moves, 1 on release | 0 | **exact** 0 per move, 1 per gesture |
| `useTimelineMarquee` | track-row rects | 0 during moves, 4 on release | 0 | **exact** 0 per move, one pass per gesture |
| `usePlayheadDrag` | listener adds / removes | 2 / 2 | — | **exact** 2, once per gesture |
| `usePlayheadDrag` | container rects | 20 | 1 | ≤ 2 / move |
| `useInOutDrag` | listener adds / removes | 2 / 2 | — | **exact** 2, once per gesture |
| `useInOutDrag` | container rects | 20 | 1 | ≤ 2 / move |
| rendered `Timeline` | `TimelineTrack` renders | 80 | 4 (one per track) | ≤ 8 / frame |
| rendered `Timeline` | `TrackHeader` renders | 80 | 4 (one per track) | ≤ 8 / frame |
| rendered `Timeline` | `TimelineRuler` renders | 20 | 1 | ≤ 2 / frame |
| rendered `Timeline` | `getRulerTicks` calls | 20 | 1 | ≤ 2 / frame |

The row rects are the count that scales: 1 per track per pointer frame, so a project
with twice the tracks pays twice as much for the same drag. The ruler is the count that
is pure waste: nothing on it can change during a clip drag, and it rebuilds its ticks —
61 objects, at the scene's 60 s ruler floor — and diffs 61 DOM nodes on every frame
anyway.

## Where the numbers came from

| | |
|---|---|
| Machine | MacBook Pro, Intel Core i9-8950HK @ 2.90 GHz, 12 logical cores, 32 GB |
| OS | macOS 15.7.9 (darwin-x64), build 24G830 |
| Node | v26.7.0 |
| Playwright | 1.63.0 (bundled Chromium) |
| Vitest | 5.0.0, jsdom |
| App under test | ESCAPEARTIST dev server (Vite), `http://localhost:5175` |
| Chromium launch args | `--enable-precise-memory-info --disable-gpu --autoplay-policy=no-user-gesture-required` |

The same machine and the same launch args as
[2026-09-12-baseline.md](2026-09-12-baseline.md), so the two files' figures are
comparable with each other.

`pnpm perf` with all four browser benchmarks plus the kit takes **~2 minutes** on this
machine with a warm dev server (123 s and 108 s for the two green runs). The CI `perf`
job's `timeout-minutes: 30` is therefore left as it was — the new benchmark adds roughly
20 seconds to a job with an order of magnitude of headroom.

### Known flake

`loadPerfScene`'s "wait until a quarter of the preview canvas is red" probe timed out
twice in the eight scene loads taken for this file — once on a freshly started dev
server (the run that became invocation A after a retry) and once on `preview-playback`
inside invocation E. Both times the dev server log carried a
`VideoDecodeManager.handleError`, which is the fixture's known WebCodecs fallback
(`No keyframes found in video, falling back to HTMLVideoElement` — see
[2026-09-12-baseline.md](2026-09-12-baseline.md#how-to-read-these)) failing to paint
within the probe's 30 s. It is in the shared scene loader, predates this round's
benchmark, and affects `preview-playback` and `export` equally; `perf.mjs` is written so
that a benchmark which dies this way leaves the surviving numbers readable. Worth
watching; not this round's to fix.

## How to read these

**The two halves measure different things and neither stands alone.** jsdom performs no
layout: `getBoundingClientRect` is free there and returns an all-zero rect
(`src/test/doubles/layout.ts`), so the unit file can only count **calls**. A change that
halved the rect reads but doubled what each one cost would pass every ceiling in it.
The Playwright benchmark is the other half: it measures **time**, and the renderer's own
layout and style-recalc counters. Neither is allowed to carry a claim by itself.

**Five `getBoundingClientRect` calls per frame are not five layouts.** The unit counts
say a clip drag reads the container's rect once and each of the four track rows' rects
once per move; the browser says that whole frame costs **0.83 forced layouts**. Chromium
only runs a layout pass when something has dirtied layout since the last one, and
nothing does between those five reads — the five collapse into one pass, and the moves
that change no style at all (a snap that lands where the last one did) cost none. So the
call count is what scales with track count, and the layout count is what the machine
actually pays. Round 2 should not promise a 5× reduction in layouts from removing four
rect reads; what it can promise is that the reads stop scaling with the track count.

**These are dev-server numbers, in React's development build.** Same as every other
benchmark in this repo. A production build is materially faster; what these figures are
good for is comparing two commits measured the same way, not for telling a user what a
drag costs them.

**`wallMs` is round-trip dominated.** Each move is a separate CDP `Input.dispatchMouseEvent`
from Playwright, so wall time carries ~20–30 ms of round trip per move that a real 60 Hz
pointer would not. It is reported for completeness. `jsMsPerFrame` comes from the
renderer's own `TaskDuration` counter over the same window, so it does not include that
latency — but it *does* include whatever else the renderer did in the idle gaps between
moves, which makes it an upper bound on the gesture's own cost rather than an exact
figure.

**The playhead scrub is the most expensive of the three, and that is not the timeline's
fault.** A scrub writes `currentTime` on every move, and the preview re-composites the
whole 14-clip frame each time — which is why it shows 4.45 style recalcs per move
against the clip drag's 1.25 while costing only the same one layout. Any work on the
scrub has to separate the preview's redraw from the timeline's own re-render before it
can claim either.

**Nothing here is a long task, on this machine.** All three gestures record 0 long tasks
in the tabulated run, and the invocations that did record some (A, E, F's predecessors)
recorded them in the slow, thermally-throttled invocations (A and E). A 23 ms frame is under the 50 ms
long-task threshold with room to spare here; on a machine a third the speed it would not
be, which is the whole reason this repo has a lightweight-performance rule.

**CI numbers are relative, not comparable to these.** The `perf` job runs on a shared
`ubuntu-latest` runner, is `continue-on-error: true`, and is deliberately absent from
`ci-status`'s `needs`. Compare CI to CI on the same branch; compare local to this file
on this machine.
