# Timeline interaction — round 2's before and after (2026-09-13)

What a pointer gesture in ESCAPEARTIST cost before round 2, what each fix moved, and what
is left. The measurements it argues from are the
[timeline baseline](2026-09-13-timeline-baseline.md) — the `timeline-interaction` browser
benchmark and the per-frame call counts in
`apps/artist/src/components/Timeline/timelineGestures.perf.test.ts` — plus round 1's
`preview-playback` benchmark for the two `currentTime` subscriptions round 1 missed.

Round 1 ([profile](2026-09-12-profile.md), [baseline](2026-09-12-baseline.md)) measured the
editor while it *plays* and while it *exports*. Round 2 measured it while someone is
**editing**, which is where a user spends nearly all of their time, and fixed what the
measurement ranked.

**One-line summary.** A clip drag costs **−19.6%** of the JavaScript per pointer frame and a
marquee **−46.7%**, both with disjoint arms across three paired rounds; playback executes
**−9.1%** of renderer task time with the toolbar off the tick; and the timeline's per-gesture
call counts — listener registrations, forced-layout reads, snap-point arrays — went from
scaling with the pointer to **once per gesture**. Forced layouts per move did **not** move,
and this document says why that was the predicted, correct outcome rather than a failed
change.

## How it was recorded

Everything below comes from one of three instruments, and each is reproducible from a command
printed here.

### 1. `pnpm perf` — the merged report

```bash
pnpm perf                    # all four browser benchmarks + the headless kit
```

Writes `perf-report.json` at the repo root plus the Markdown table CI appends to its job
summary. Four browser benchmarks now: `preview-playback`, **`timeline-interaction`** (new this
round), `export-mp4`, `export-webm`, and then `headless-kit-render` out of the headless kit.
The end-state run on this branch (2026-09-14T01:18:40Z, the `perf-report.json` left on disk by the branch's final `pnpm perf`, medians of three
runs each):

| Benchmark | Runs | Headline |
| --- | --- | --- |
| `preview-playback` | 3 | 60.09 rendered fps |
| `timeline-interaction` | 3 | clip drag: 0.82 layouts/move, 8.5 ms/move |
| `export-mp4` | 3 | 77.67 frames/s (5021 ms) |
| `export-webm` | 3 | 80.50 frames/s (4845 ms) |
| `headless-kit-render` | 3 | 51.81 frames/s (579 ms) |

**Do not read that `8.5 ms/move` against the baseline's `23.72 ms/move` as a 2.8× win.** The
baseline doc records the reason in full: on this machine the millisecond figures move up to
**2.6× between clean invocations** while the per-move layout and recalc counts do not move at
all, and the tabulated baseline run was one of the slow (thermally throttled) invocations.
The only millisecond comparisons in this file come from paired alternation, below. What *is*
comparable across invocations is the counts, and they sat still all round: the clip drag
measured 0.83 layouts/move in the baseline run and 0.82 in every arm of every paired run and
in the end-state run above; the marquee 0.98–1.00; the scrub 1.00 everywhere.

### 2. Paired alternation — every millisecond claim

One warm Vite dev server for the whole session, the two arms' source files swapped in place
round-robin, one discarded warm-up, then ≥3 rounds per arm. Drift is charged to both arms
equally instead of to whichever ran second.

```bash
# once, and left running for the whole session:
pnpm --filter @escapesuite/artist exec vite --port 5175 --strictPort

# per invocation — ARM is the copy of the touched files put in place first
cp "$SCRATCH/$ARM"/{useClipDrag,useTrimDrag,useTimelineMarquee}.ts \
   apps/artist/src/components/Timeline/
cd apps/e2e && npx playwright test --config=playwright.perf.config.ts \
   tests/perf/timeline-interaction.spec.ts
cp perf-results/timeline-interaction.json "$SCRATCH/results/$ARM-$ROUND.json"
```

and, for the two sub-items measured against playback rather than a gesture:

```bash
cd apps/e2e && pnpm exec playwright test \
  --config playwright.perf.config.ts tests/perf/preview-playback.spec.ts
# then: cp perf-results/preview-playback.json <label>.json
```

The perf config's `reuseExistingServer: true` picks up the hand-started dev server, so no
invocation pays a cold start. Each invocation is itself the benchmark's own median of three
runs; the tables below are the median of those medians, with every raw round quoted.

**Each swap was verified to have reached the browser** by fetching the transformed module from
the dev server and grepping for a symbol only one arm has — `useTrackAreaCache` for Task 2,
`SplitButton` for 3(b), `React.memo` in `TrackHeader.tsx` and `clipsByTrack` in `Timeline.tsx`
for 3(c):

```bash
curl -s http://localhost:5175/src/components/Timeline/useClipDrag.ts | grep -c useTrackAreaCache
# 2 on the patched arm, 0 on the base arm; the runner aborts if the grep disagrees with $ARM
```

A row is called **moved** only when the two arms' ranges are disjoint across every round.
Anything else is labelled a **noise check**, including rows that look like a win.

### 3. The per-frame call counts — jsdom, deterministic, CI-enforced

```bash
cd apps/artist && npx vitest run \
  src/components/Timeline/timelineGestures.perf.test.ts
```

Twenty synthetic mousemoves through each gesture hook, counting calls: `addEventListener` /
`removeEventListener`, `getBoundingClientRect` (container and track rows separately),
`querySelectorAll`, `getSnapPoints`, and — through a rendered `<Timeline>` — `TimelineTrack` /
`TrackHeader` / `TimelineRuler` renders and `getRulerTicks` calls. jsdom performs no layout,
so this half counts **calls, not cost**; the browser benchmark is the other half. Neither
carries a claim alone.

The re-render and re-bind contract tests use the same pass-through spy one level up:

```bash
cd apps/artist && npx vitest run \
  src/components/Toolbar/Toolbar.rerender.test.tsx \
  src/components/ClipEditor/ClipEditor.rerender.test.tsx \
  src/app/useAppKeyboardShortcuts.rebinds.test.tsx
```

### What is a dev-build artefact, and what transfers

Every browser number here comes from a Vite dev server running React's **development** build.
`exports.jsxDEV` — React's dev-mode JSX factory, and the single largest line item behind the
`Toolbar` result below — **does not exist in a production bundle at all**. Saying it once is
not enough, so it is said again here and beside each affected table:

- **The render *count* is the durable finding. Its unit price is not.** "Ten renders became
  zero" and "the headers column no longer re-renders on a drag frame" are true in any build.
  "−81.7 ms of `jsxDEV`" is true today, in this build, on this machine, and overstates the
  user-facing win.
- **Allocations removed transfer exactly.** Per 60-move clip drag: one sorted snap array
  instead of 60, two listener registrations instead of 122, five `getBoundingClientRect`
  calls instead of 300, four `Clip[]` allocations instead of one per track per frame, and the
  ruler's 61 tick objects rebuilt on **no** frame instead of on every one. A release build
  allocates and collects all of that the same way a dev build does, which is the half that
  matters for the charter's low-spec machines.
- **Forced layouts and style recalcs are the renderer's own counters** and are as real in a
  release build as here. They are also the rows that did not move; see Task 2 below.
- **The software-raster and dev-server caveats from round 1 all still apply** — the perf
  project launches with `--disable-gpu`, so every blit is rasterised on the CPU.

## Two corrections to the decomposition review

The review that opened this round asserted two things about the timeline's gesture hooks.
Both were measured before anything was fixed, and both were wrong in the direction that
matters — a plan built on them would have spent effort where there was nothing to win.

**1. Three of the five hooks re-bind their listeners per pointer frame, not five.**
`useClipDrag`, `useTrimDrag` and `useTimelineMarquee` each write something their own effect
depends on (`dragState`; the store, so `clips` is a fresh array every move;
`tlMarqueeCurrent`), so the `mousemove`/`mouseup` pair is torn down and re-added on every
move — **42 adds and 42 removes for a 20-move gesture**, all three. `usePlayheadDrag` and
`useInOutDrag` write only booleans and call stable zustand actions: **2 and 2 for the whole
gesture**, already, before this round. Both are now pinned exactly, so a refactor cannot drop
them into the churn. *A plan that "fixed" the playhead scrub would have been a no-op dressed
up as a win.*

**2. The marquee's row walk is on the mouseup path only.** During 20 moves it makes **0**
`querySelectorAll` calls and **0** track-row rect reads; on release it makes **1** and **4**
(one per track). That is already once per gesture, and it is asserted exactly so it stays
that way — which is also why the per-gesture cache deliberately does *not* pre-measure rows
for a marquee: eager measurement would make every plain click-to-deselect pay for four rects
it never uses.

A third, smaller correction: the plan recorded `useAppKeyboardShortcuts`' deps array as 33
entries. It is **37** (`useAppKeyboardShortcuts.ts:356-364`).

## Task 2 — one listener pair, one measurement, one snap array per gesture

`useClipDrag`, `useTrimDrag` and `useTimelineMarquee` now bind through
`src/hooks/useDocumentListener.ts` on a **boolean** that flips exactly twice a gesture, hold
their live state in a ref beside the `useState` the render needs, and take the track area's
geometry once on the mousedown through the new `useTrackAreaCache`.

### Call counts, before → after (one 20-move gesture)

| Hook | Counter | Before | After | Asserted as |
|---|---|---|---|---|
| `useClipDrag` | listener adds / removes | 42 / 42 | **2 / 2** | exact |
| | container `getBoundingClientRect` | 20 | **1** | exact |
| | track-row `getBoundingClientRect` | 80 | **4** (= track count) | exact |
| | `querySelectorAll('[data-track-id]')` | 20 | **1** | exact |
| | `getSnapPoints` | 20 | **1** | exact |
| `useTrimDrag` | listener adds / removes | 42 / 42 | **2 / 2** | exact |
| | container rects | 20 | **1** | exact |
| | row rects / `querySelectorAll` | 0 / 0 | 0 / 0 | exact (unchanged) |
| `useTimelineMarquee` | listener adds / removes | 42 / 42 | **2 / 2** | exact |
| | container rects (press + moves) | 21 | **1** | exact |
| | container rects on release | 1 | **0** | exact |
| | row rects / `querySelectorAll` on release | 4 / 1 | 4 / 1 | exact (unchanged) |
| `usePlayheadDrag`, `useInOutDrag` | listener adds / removes | 2 / 2 | 2 / 2 | exact (untouched) |

Scaled to the browser benchmark's 60-move clip drag: **122 listener registrations become 2**,
and **300 rect reads become 5**.

### The browser benchmark did not move, and that is the honest result

`timeline-interaction`, paired alternation, **four rounds per arm**:

| Gesture | Metric | base (4 rounds) | base med | patched (4 rounds) | patched med | Verdict |
|---|---|---|---|---|---|---|
| `clipDrag` | **layouts / move** | 0.82, 0.82, 0.82, 0.82 | **0.82** | 0.83, 0.82, 0.82, 0.82 | **0.82** | **unchanged** |
| `clipDrag` | recalcs / move | 1.30, 1.35, 1.33, 1.35 | 1.34 | 1.38, 1.33, 1.35, 1.30 | 1.34 | unchanged |
| `clipDrag` | JS ms / move | 11.02, 10.10, 11.16, 11.08 | 11.05 (10.10–11.16) | 11.77, 10.61, 10.65, 10.84 | 10.75 (10.61–11.77) | **noise check** — ranges overlap |
| `clipDrag` | heap delta (bytes) | 607853, 581057, −84059, −100001 | 248 499 | 576510, 583371, −103861, −87966 | 244 272 | noise check (sign flips within an arm) |
| `marquee` | layouts / move | 1.00, 0.98, 0.98, 0.98 | 0.98 | 1.00, 0.98, 0.98, 0.98 | 0.98 | unchanged |
| `marquee` | JS ms / move | 10.63, 10.46, 10.63, 10.66 | 10.63 (10.46–10.66) | 10.07, 10.62, 11.41, 10.82 | 10.72 (10.07–11.41) | noise check |
| `playheadScrub` *(control — code untouched)* | layouts / move | 1.00 ×4 | 1.00 | 1.00 ×4 | 1.00 | unchanged, as it must be |
| `playheadScrub` *(control)* | JS ms / move | 10.14, 10.02, 9.96, 9.94 | 9.99 (9.94–10.14) | 10.10, 9.95, 9.79, 10.27 | 10.03 (9.79–10.27) | **noise check — and this is the band** |

The scrub is the internal control: byte-identical code in both arms, and its two arms still
differ by 0.4% of the median across a 5% spread. Every difference in the table is smaller than
or comparable to that. **No millisecond claim is made for this task, and no layout claim
either.**

**Why the layout count could not move**, predicted in the baseline doc before the change and
confirmed by it: five `getBoundingClientRect` calls in one frame are not five layout passes.
Chromium runs a layout pass only when something has dirtied layout since the last one, and
nothing does between those five reads — they collapse into one pass, and a move that changes
no style costs none. The drag frame still performs its one pass, because `dragState` still
re-renders `Timeline` and the moved clip must be laid out before the next read. **Removing the
reads removed reads, not passes.**

What the task actually bought, all of it durable in a release build:

1. **The reads stop scaling with the track count.** Four tracks → 4 row rects per *gesture*
   instead of 4 per *frame*. The benchmark scene has four tracks, which is the case where the
   old code was cheapest: a twelve-track project used to read twelve rects on every move, and
   now reads twelve once for the whole gesture, exactly like this one.
2. **122 listener registrations per clip drag become 2** — and, more importantly, stable
   listeners are what made the hooks safe to memoise, which is what Task 3(c) then cashed in.
3. **One snap array per gesture instead of 60.** `getSnapPoints` allocates a `Set`, fills it
   with `2 × clips.length` entries and returns a fresh sorted array — 29 numbers on this
   scene, thrown away immediately, 60 times per drag. Gone.

### The cache, and the one behaviour it does not reproduce

`useTrackAreaCache` takes the container's client origin on the mousedown and, for a clip drag,
each `[data-track-id]` row's box in the container's own **layout space** (`rect.top -
containerTop + scrollTop`), so a move re-derives the pointer from `scrollTop`/`scrollLeft`
alone — scroll-position properties, not geometry. Scrolling the track area therefore cannot
invalidate anything. What does: a captured `scroll` listener on `document` (scroll does not
bubble, and an ancestor's scroll moves the container's client origin) and a `resize` listener
on `window`.

**Open caveat, recorded rather than fixed: the invalidation is event-based.** A layout change
that fires neither a `scroll` nor a `resize` event — an autosave or an undo landing mid-drag
and changing a row's height — would leave the cache stale, where the old per-frame measurement
absorbed it. A clip drag writes nothing to the store until release, and the UI has no control
that resizes a track while a pointer is down, so it is unreachable today; it is the one
behaviour the cache does not reproduce exactly, and it is listed as a follow-up below.

## Task 3(a) — `Toolbar` off the playback tick

`Toolbar.tsx` held `useEditorStore((state) => state.currentTime)` for three *handlers* and
nothing rendered. Nothing in the component's output derived from it, which makes this the
exact shape round 1 already fixed in `App.tsx`: the three handlers now read
`useEditorStore.getState().currentTime` inside themselves.

**Contract test** (`Toolbar.rerender.test.tsx`, 5 tests): ten `setCurrentTime` writes, each in
its **own** `act()`, add **0** renders against a ceiling of ≤1 — where the old selector
measured 10. (One `act()` around the loop batches into a single commit and would slip under
the ceiling with the bug present; the first draft of that test did exactly that and passed.)
With the selector restored the file fails 2 of 5.

`preview-playback`, paired alternation, order **A B B A A B**, three rounds per arm:

| Metric | base (3 runs) | patched (3 runs) | Delta | Verdict |
|---|---|---|---|---|
| Rendered fps | **59.94** (59.91–59.96) | **60.10** (59.92–60.12) | +0.16 | **noise check** — both arms sit on the 60 fps vsync ceiling |
| Renderer `TaskDuration` | **1037.55 ms** (1036.09–1062.29) | **942.62 ms** (937.51–956.25) | **−94.93 ms, −9.1%** | **moved** — ranges disjoint in all three pairs |
| Long tasks | 0 | 0 | — | unchanged (already zero after round 1) |
| Layouts | 67 (64–68) | 66 (66–67) | — | unchanged |
| Style recalcs | 24 (24–25) | 24 | — | unchanged |

fps cannot move here: round 1 put this scene on the vsync ceiling at 720p, so headroom shows
up as main-thread work *not done*, which is the `TaskDuration` row — the one row whose arms
never overlap.

**CPU profiles** (`PERF_PROFILE=1`, the discarded fourth run, one per arm, read with
`node apps/e2e/scripts/profile-top.mjs apps/e2e/perf-results/preview.cpuprofile`):

| | base | patched |
|---|---|---|
| Window | 5122.8 ms | 5118.9 ms |
| JavaScript executed in it | 596.6 ms | **507.2 ms** (−89.4 ms) |
| `(idle)` share | 82.5% | **84.2%** |
| `exports.jsxDEV` self | 126.5 ms (21.2%) | **44.8 ms (8.8%)** — −81.7 ms |
| `Toolbar` (app-code total time) | **#6 — 88.5 ms, 14.8%**, self 0.8 ms | **absent from the table** |

The base arm reproduces the post-round-1 profile's #6 entry almost exactly (round 1 recorded
76.8 ms / 14.8%; this machine measured 88.5 ms / 14.8% today), and the −81.7 ms of `jsxDEV`
accounts for essentially the whole −89.4 ms JavaScript drop and the −94.9 ms `TaskDuration`
median. Three independent instruments on the same ~90 ms.

**Say it again: `jsxDEV` does not exist in a release bundle.** The millisecond figure is a
dev-build number. What is real in any build is that ~30 buttons and their inline SVGs no longer
reconcile five times a second during playback.

## Task 3(b) — the clip inspector off the playback tick

`useClipEditorActions` held the same subscription for a `timeInClip` whose only consumer was
the Split button's `disabled` attribute — and because the hook runs *above* `ClipEditor.tsx`'s
`!selectedClip` early return, the empty panel paid exactly the same. Round 1's profile ranked
`ClipEditor` #10 of the app-code frames a playback window executes (23.1 ms, 4.4%).

`Toolbar`'s `getState()` fix is wrong here, because the disabled state **is** rendered and a
stale read would show the wrong one. This is `TimelinePlayhead`/`PreviewTimecode`'s shape
instead: a new `SplitButton` leaf subscribes to the **derived boolean** rather than to the
playhead, so zustand's `Object.is` ends the tick and the button re-renders only when the
answer flips.

**Counters** (10 playback ticks, one `act()` each, `ClipEditor.rerender.test.tsx`):

| Counter | Before | After | Ceiling |
|---|---|---|---|
| `ClipEditor` renders, clip selected | 10 | **0** | ≤1 |
| `ClipEditor` renders, nothing selected | 10 | **0** | ≤1 |
| `SplitButton` renders | 10 | **2** | ≤4 |

RED first: with `SplitButton` in place but the hook's selector restored, 4 of 6 tests fail. The
button's "before" of 10 is that RED configuration, which is also what a *coarser* leaf would
cost — a `SplitButton` subscribing to `currentTime` rather than to the derived boolean would
re-render on all ten ticks for no benefit. Subscribing to the answer instead means zustand's
`Object.is` ends the tick, and the button re-renders twice over a pass across a clip.

`preview-playback`, paired alternation, **five rounds per arm** (three were inconclusive on
everything):

| Metric | base rounds | patched rounds | base med | patched med | Delta | Verdict |
|---|---|---|---|---|---|---|
| Rendered fps | 59.96 59.93 59.94 59.93 59.93 | 60.10 59.95 60.09 60.11 59.94 | 59.93 | 60.09 | +0.27% | unchanged (vsync ceiling) |
| Renderer `TaskDuration` | 992.0 939.1 923.1 966.8 938.3 | 962.9 917.2 931.5 929.5 914.8 | 939.1 | 929.5 | −1.03% | **noise check** — ranges overlap |
| Layouts | 68 69 66 68 68 | 66 63 66 65 65 | 68 | 65 | −4.4% | **noise check** — 66 appears in both arms |
| Style recalcs | 24 24 24 24 24 | 24 23 24 24 24 | 24 | 24 | 0% | unchanged |
| Long tasks | 0 ×5 | 0 ×5 | 0 | 0 | unchanged |

The layout row was originally argued as "moved" on a rank-sum test. It is labelled a **noise
check** here: the ranges overlap, the repository's own rule says anything inside the recorded
bands is noise, and the mechanism a `disabled`-attribute fix predicts is not a −4.4% forced-
layout delta. **This sub-item lands on its render counter (10 → 0, exact, deterministic and
CI-enforced), not on a millisecond or a layout figure.**

One more caveat, stated plainly: the benchmark scene has **nothing selected**, so the base arm
was re-rendering the small empty state rather than the full inspector. The browser number
understates what the fix is worth with a clip selected — and measuring it with a selection
would change the scene and break comparability with every earlier round, so it was not done.

## Task 3(c) — memo boundaries under a gesture

The sub-item that moves the round's headline number, and the one with a hard dependency order:
**memoise the array before, or with, the row — never the row alone.**

1. `Timeline`'s `getTrackClips` used to `map` a fresh `Clip[]` per track per render, so a
   `React.memo` on the row would have compared unequal every time and bought nothing. It is now
   `clipsByTrack`, one `useMemo` keyed on `visibleClipsByTrack`, plus a module-level `NO_CLIPS`
   so an empty row's prop keeps its identity too.
2. `React.memo` on `TimelineRuler`, `TrackHeader` and `TimelineTrack`. No prop was changed to
   achieve it — Task 2 had already made the three mousedown handlers stable `useCallback`s.

**Renders per pointer frame** (`timelineGestures.perf.test.ts`, before → after):

| | clip drag | marquee | asserted as |
|---|---|---|---|
| `TimelineTrack` | 4 → 4 | 4 → **0** | drag ≤8; marquee exactly 0 |
| `TrackHeader` | 4 → **0** | 4 → **0** | exactly 0 |
| `TimelineRuler` | 1 → **0** | 1 → **0** | exactly 0 |
| `getRulerTicks` | 1 → **0** | 1 → **0** | exactly 0 |
| distinct `clips` arrays per 20-move drag | 80 → **4** | — | exactly 4 (conservation law) |

`TimelineTrack` still re-renders under a clip drag, correctly: `dragState` is one of its props
and any row may have to draw the ghost. The marquee is where its memo pays. The ruler's 61 tick
objects are no longer rebuilt — nor 61 DOM nodes diffed — on a frame where nothing on the ruler
can change.

`timeline-interaction`, paired alternation, three rounds per arm:

| Metric | base rounds | patched rounds | base med | patched med | Delta | Verdict |
|---|---|---|---|---|---|---|
| `clipDrag` JS ms/frame | 10.914 12.002 10.376 | 8.770 9.003 8.673 | 10.91 | **8.77** | **−19.6%** | ranges disjoint → **moved** |
| `clipDrag` `TaskDuration` | 654.9 720.1 622.5 | 526.2 540.2 520.4 | 654.9 | **526.2** | **−19.6%** | disjoint → **moved** |
| `clipDrag` layouts/move | 0.82 ×3 | 0.82 ×3 | 0.82 | 0.82 | 0% | unchanged (Task 2 already answered this row) |
| `clipDrag` recalcs/move | 1.32 1.38 1.32 | 1.37 1.35 1.38 | 1.32 | 1.37 | +3.8% | overlap → **noise check** |
| `marquee` JS ms/frame | 10.397 10.038 10.395 | 5.541 5.563 5.463 | 10.39 | **5.54** | **−46.7%** | disjoint → **moved** |
| `marquee` `TaskDuration` | 623.8 602.3 623.7 | 332.5 333.8 327.8 | 623.7 | **332.5** | **−46.7%** | disjoint → **moved** |
| `marquee` layouts/move | 0.98 1.00 0.98 | 1.00 0.98 1.00 | 0.98 | 1.00 | +2.0% | overlap → unchanged |
| `marquee` recalcs/move | 2.10 2.05 2.07 | 2.10 2.08 2.07 | 2.07 | 2.08 | +0.5% | unchanged |
| `playheadScrub` JS ms/frame | 9.076 9.711 9.433 | 9.377 9.456 9.148 | 9.43 | 9.38 | −0.6% | overlap → **noise check** |
| `playheadScrub` layouts/move | 1.00 ×3 | 1.00 ×3 | 1.00 | 1.00 | 0% | unchanged |
| Long tasks (all three gestures) | 0 | 0 | 0 | 0 | unchanged |

`playheadScrub` is unchanged **by construction**: a scrub writes `currentTime`, and `Timeline`
does not subscribe to it, so there is no `Timeline` re-render for a memo to catch. That is also
the clean demonstration that Task 2 (the layout half) and Task 3(c) (the render half) are
disjoint fixes: the layout rows are flat in this table, and the millisecond rows are flat in
Task 2's.

**Dev-build caveat, third time:** the −19.6% and −46.7% are measured in a dev build where
`jsxDEV` is a large share of every React render. The **counts** — four header renders and a
61-tick ruler rebuild eliminated per drag frame, 80 array allocations down to 4 — are what a
release build keeps.

**`TrackHeader`'s memo holds for a clip drag, a marquee and playback — not for a trim.** A trim
writes the store on every move, so `clips` is a fresh array every frame, and
`useTrackHeaderActions`' `handleDeleteTrack` has `clips` in its deps: `onDeleteTrack` changes
identity and the whole headers column re-renders anyway. Nothing is wrong; the claim is simply
narrower than "a gesture". The one-line fix is a follow-up below.

## Task 3(d) — the keyboard cascade's re-binds: measured, left verbatim

`useAppKeyboardShortcuts` binds one `keydown` listener on `window` behind a **37**-entry deps
array, so an edit that touches any of them swaps the listener.
`useAppKeyboardShortcuts.rebinds.test.tsx` drives the hook through `App.tsx`'s own selectors
over a scripted 20-edit burst and measures **15 re-binds over 20 edits**. The five free edits
are the informative ones — a playhead write, a transform, a clip move, a marker and a blend
mode change cost nothing, because `clips` is a dependency only through its `length`, which is
exactly the staleness the array carries on purpose for the Ctrl+B branch.

**15 is a lower bound, not the app's figure.** The harness pins `App`'s own seven callbacks at
fixed identities so the number is the **store's contribution alone**; in the live `App`,
`handleSaveProject` closes over `clipCount` and `handleZoomIn`/`handleZoomOut` over the zoom,
so the real count is ≥15. The extra churn mostly coincides with edits that already re-bind via
`clips.length`, so the decision is unaffected and if anything better supported.

**Decision: no code change.** Fifteen listener swaps spread over a burst that takes a user the
better part of a minute is not per-frame work, and the ref-held-latest-callback alternative
would change precisely the Ctrl+B staleness semantics `apps/artist/CLAUDE.md` records as
deliberate. The deps array is byte-unchanged; the test pins the finding at 2× the measurement
(≤30) with a non-zero guard, and says in its own comment to **lower** the assertion if the
array is ever split.

## Ranked candidates, with status

Ranked as the round opened, from the plan's structural read of `main` @ `b0534f0`. "Impact"
is what was expected before measuring; "Status" is what happened.

| # | Candidate | Expected impact | Status |
|---|---|---|---|
| 1 | **Render amplification under a gesture** — memoise `getTrackClips`, then `React.memo` the row, the header and the ruler | Large: 4 rows + 4 headers + a 61-tick ruler rebuilt per drag frame | **Done, Task 3(c).** clip drag −19.6%, marquee −46.7% JS/frame, both disjoint. The round's headline |
| 2 | **`Toolbar`'s live `currentTime` subscription** | Medium–large: #6 of the post-round-1 app-code profile, 14.8% of remaining preview JS | **Done, Task 3(a).** −9.1% renderer `TaskDuration` during playback, disjoint; `Toolbar` gone from the profile's app-code table |
| 3 | **Listener churn on three gesture hooks** (42/42 per 20 moves → 2/2) | Medium; also the precondition for #1 | **Done, Task 2.** A **counts** win: 122 registrations per drag → 2. No millisecond or layout claim — the benchmark did not move |
| 4 | **Per-move layout reads and snap-array allocation** (300 rect reads and 60 sorted arrays per drag → 5 and 1) | Was expected to move `layoutsPerFrame` | **Done, Task 2 — and the expected metric did not move.** 0.82 layouts/move on both arms. Five rect reads in a frame were never five layout passes; what changed is that the reads stop scaling with the track count |
| 5 | **`useClipEditorActions`' `currentTime` subscription** | Medium: #10 of the post-round-1 profile, 4.4%, and it costs the same with nothing selected | **Done, Task 3(b).** Lands on the render counter (10 → 0, selected and unselected); the browser rows are noise checks |
| 6 | **`useAppKeyboardShortcuts`' 37-dep re-bind** | Unknown — measure before touching | **Measured, not changed, Task 3(d).** 15 re-binds per 20 edits (a lower bound), none per frame. Deps array byte-verbatim |
| 7 | **`TimelineTrack`'s memo under a clip drag** | Not ranked at the start; surfaced by #1's counters | **Open.** 4 rows still re-render per drag frame because `dragState` is a prop. The next available win — see follow-up 3 |
| 8 | **`useTimelineHeight`'s per-pixel listener re-bind** | Small, and load-bearing | **Not attempted, deliberately.** `handleResizeEnd` closes over `timelineHeight` and that closure is what persists the height; `useDocumentListener` keeps its handler in a ref and would break exactly that |
| 9 | **`ShapeSection`'s duplicated `fillAlphaPercent`** | Trivial, off every hot path | **Out of scope**, per the plan |

## Ceilings

No ceiling was **raised** anywhere in this round. The ones that moved, moved down:

| File | Assertions lowered |
|---|---|
| `timelineGestures.perf.test.ts` (Task 2) | 11 — the three `FINDING` pins at `2·(MOVES+1)` flipped to `=== 2`; six `≤2/move` or `≤8/move` budgets flipped to exact `1` / `rows.length`; the drag's row-rect assertion split so the press measures and the move does not; the marquee's release-time container rect to `=== 0` |
| `timelineGestures.perf.test.ts` (Task 3c) | 3 — drag `TrackHeader` 8 → `=== 0`, `TimelineRuler` 2 → `=== 0`, `getRulerTicks` 2 → `=== 0`; plus new exact marquee ceilings 0/0/0/0 and a `clips`-array conservation law of exactly 4 per drag |

New ceilings created this round, each with its measured value and date in a comment beside
it: `ClipEditor` renders ≤1 per 10 ticks (measured 0), `SplitButton` ≤4 (measured 2), keydown
re-binds ≤30 (measured 15).

**Re-checked on 2026-09-13 at the end of the round**, by dumping each counter and reading it
against its comment:

```bash
cd apps/artist && npx vitest run \
  src/components/Timeline/timelineGestures.perf.test.ts \
  src/components/Preview/drawFrame.perf.test.ts src/core/exportMP4.perf.test.ts
cd ../craft && npx vitest run \
  src/core/compositor.perf.test.ts src/core/converter.perf.test.ts
```

| File | Counter | Measured today | Comment says | Ceiling |
|---|---|---|---|---|
| `timelineGestures.perf.test.ts` | drag renders/frame | tracks 4, headers 0, rulers 0, ticks 0 | 4 / 0 / 0 / 0 | ≤8, and three exact zeroes |
| | `usePlayheadDrag` container rects | 20 over 20 moves | 1 per move | ≤2 / move |
| | `useInOutDrag` container rects | 20 over 20 moves | 1 per move | ≤2 / move |
| `drawFrame.perf.test.ts` | effects frame | 25 calls, 2 drawImage, 1 measureText, 3 fills, 1 stroke, 4 animated values, 4 save/restore | same (2026-09-12) | ≤50 / 4 / 2 / 6 / 2 / 8 |
| | transition frame | 28 calls, 3 drawImage, 1 measureText, 5 animated values, 5 save/restore | same (2026-09-12) | ≤56 / 6 / 2 / 10 |
| `exportMP4.perf.test.ts` | per export frame | 24 calls, 2 drawImage, 4 save/restore, 4 animation lookups | same (2026-09-12) | ≤48 / 4 / 8 |
| `compositor.perf.test.ts` | PiP frame | 12 calls, 2 drawImage, 1 fillRect, 1 save / 1 restore | same (2026-09-12) | ≤24 / 4, and exact 1s |
| `converter.perf.test.ts` | per converted frame | 1 canvas call | same (2026-09-12) | ≤2 / frame |

Every remaining `≤` ceiling is already exactly 2× its measured value, so none could be lowered
further without breaking the repository's own rule; everything else in those files is asserted
exactly. **Nothing was changed in this pass** — the re-check is the evidence, and it is
recorded here so the next round does not have to take it on trust.

## Follow-ups — all open

1. **Constant-screen-size selection handles** (open since round 1). Handles are drawn at a
   fixed size in *project*-space pixels, so a large project shown in a small box draws
   sub-pixel handles. *Fix:* divide the handle size by the frame's raster scale `k` at the
   draw site, and match it in `hitTest`.
2. **DPR change without a resize** (open since round 1). `devicePixelRatio` is read at draw
   time, not subscribed to, so dragging the window to a different-DPI display re-rasterises
   only on the next resize or edit. *Fix:* a `matchMedia('(resolution: Xdppx)')` listener that
   re-rasterises when it changes.
3. **`TimelineTrack`'s memo still does nothing for a clip drag** — the gesture the round is
   named after. Four rows re-render per frame because `dragState` is a prop, worth roughly the
   rows' share of the remaining 8.77 ms/frame. *Fix:* narrow the prop to the per-row slice of
   the drag (does *this* row own the clip, or is it the drop target?), or split the ghost clip
   out into its own element so no row takes `dragState` at all. It is an architectural choice
   the round's briefs did not settle, and a custom comparator would add branches against a
   branch floor with under one percent of headroom, so it was left for a round of its own.
4. **`TrackHeader`'s memo does not hold during a trim drag.** `useTrackHeaderActions`'
   `handleDeleteTrack` has `clips` in its deps and a trim writes the store every move, so
   `onDeleteTrack` changes identity every frame and the headers column re-renders. *Fix:*
   narrow that dep to `clips.length` and read the clips with a `getState()` call inside the
   callback.
5. **`useDragListeners` has no caller.** It is the other export of
   `src/hooks/useDocumentListener.ts`, and only its own test file imports it. Task 2
   deliberately used `useDocumentListener` + a boolean instead, because `useDragListeners`'
   imperative start/stop would unbind the pair *synchronously* inside the mouseup and change
   the `marqueeJustFinished` handoff's timing. *Fix:* adopt it across all five gesture hooks,
   or delete it — it should not sit in `src/hooks` with nothing but a test calling it.
6. **The track-area cache's invalidation is event-based.** A layout change with neither a
   `scroll` nor a `resize` event (an autosave or an undo landing mid-drag and changing a row
   height) would leave it stale; unreachable through the UI today, because a clip drag writes
   nothing until release and no control resizes a track while a pointer is down. *Fix, if row
   heights ever become dynamic:* a `ResizeObserver` on the track container — the one
   `useScrollSync` already installs there — rather than a third listener.
7. **The keydown re-bind count is a lower bound.** 15/20 is the store's contribution alone;
   `App`'s own callbacks are pinned at fixed identities in the harness. *Fix, only if the
   number is ever used to justify a change:* let the seven callbacks vary as they do in `App`
   and re-measure.
8. **Two test-harness polish notes on `countMemoRenders`** (`timelineGestures.perf.test.ts`).
   React captures a simple memo's inner `type` on the fiber at mount, so a counter installed
   after `render()` would silently report zero — every current call site installs first, but
   nothing enforces it. *Fix:* one line in the docstring saying so. And `restore()` is called
   inline *and* drained by `afterEach`, so each runs twice; it is idempotent. *Fix:* pop the
   registered restore inside `restore()`.
9. **`NO_CLIPS` is a shared mutable array** (`Timeline.tsx`). Nothing mutates a `clips` prop
   today and `Object.freeze` would fight the `Clip[]` prop type, but a future `sort()` or
   `push()` inside a row would corrupt every empty track at once, silently. *Fix:* one
   sentence at the declaration naming that hazard.
10. **`clipDragRecalcsPerFrame` rose 3.8%** (1.32 → 1.37) with overlapping ranges, labelled a
    noise check. If it is real it is small, and it is the price of the same DOM being committed
    from fewer React renders. *Fix:* nothing yet — re-measure next round before acting.
11. **The playhead scrub measures the preview as much as the timeline.** It writes
    `currentTime` every move and the preview re-composites all 14 clips, which is why it shows
    ~4 style recalcs per move against the drag's ~1.3 at the same one layout. *Fix:* separate
    the preview's redraw from the timeline's own re-render before making any claim about the
    scrub.
12. **`loadPerfScene`'s red-pixel probe flakes** (twice in eight scene loads while the baseline
    was taken), always alongside a `VideoDecodeManager.handleError` — the fixture's known
    WebCodecs fallback failing to paint within the probe's 30 s. It predates this round and
    hits `preview-playback` and `export` equally. *Fix:* give the probe a decode-failure path
    rather than waiting for pixels that will never arrive.

## Where the numbers came from

Same machine, same launch args and the same scene as both earlier documents, so the three are
comparable with each other and with nothing else:

| | |
|---|---|
| Machine | MacBook Pro, Intel Core i9-8950HK @ 2.90 GHz, 12 logical cores, 32 GB |
| OS | macOS 15.7.9 (darwin-x64) |
| Node | v26.7.0 |
| Playwright | 1.63.0 (bundled Chromium) |
| Vitest | 5.0.0, jsdom |
| Chromium launch args | `--enable-precise-memory-info --disable-gpu --autoplay-policy=no-user-gesture-required` |
| Scene | 14 clips over 4 tracks at 1280×720, from `apps/e2e/fixtures/headless/source.mp4` |

Read [2026-09-13-timeline-baseline.md](2026-09-13-timeline-baseline.md)'s "How to read these"
before quoting any figure here: the two instruments measure different things, the millisecond
figures drift up to 2.6× between invocations on this machine, and CI numbers are comparable to
CI numbers only.
