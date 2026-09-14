# ESCAPEARTIST performance — round 2 (timeline interaction)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Branch: `perf/round-2-timeline` off `main`.
Round 1: PRs #336/#337, `docs/performance/2026-09-12-baseline.md`, `docs/performance/2026-09-12-profile.md`.

## Goal

Round 1 fixed the two things a *playing* preview cost: the raster size
(`previewRaster`, 4K 11.9 → 59.9 fps) and the per-tick re-render storm
(`Timeline` + `App`'s `currentTime` subscriptions, long tasks 22 → 0). Nothing in round 1
measured a **pointer gesture**, and the profile says so out loud —
`2026-09-12-profile.md` §"Suspected but not visible": *"`hitTest` / `contentBox`
per-mouse-event allocations. Zero samples: neither benchmark moves the pointer.
Unmeasured, not disproved."*

Round 2 closes that gap, in the round-1 order: **measure first, then fix what the
measurement ranks.** The charter is customers on lower-spec machines, and a clip drag is
the gesture they touch most; a drag frame that re-binds two `document` listeners, walks
every track row with `getBoundingClientRect`, rebuilds a sorted snap array and re-renders
every track row is the shape of a gesture that feels fine on this MacBook and stutters on
theirs. Round 1's method is binding here: paired alternation before any claim, ceilings in
`*.perf.test.ts` at 2× measured (only ever lowered), renderer changes additive, no
per-frame allocations.

Two things this round deliberately does **not** do: it does not touch CRAFT (no
decomposition review recorded a `useRecordingController`/compositor item; `compositor.perf.test.ts`
and `converter.perf.test.ts` already pin that pipeline), and it does not do the
constant-screen-size selection handles (`2026-09-12-profile.md` follow-up 1) — that is a UX
defect at sub-pixel handle size, not a per-frame cost, and it belongs in a UX change.

## Current structure (verified on `main` @ b0534f0)

### The five gestures, and which of them actually churns listeners

The decomposition review's note said all five re-add `document` listeners per pointer
frame. **Three do; two do not.** Verified by reading the deps arrays against what each
effect writes:

| Hook | Effect | Deps that change per move | Re-binds per frame? |
|---|---|---|---|
| `useClipDrag.ts:143–235` | `:228–234` | `dragState`, written at `:185` by every mousemove | **Yes** |
| `useTrimDrag.ts:82–140` | `:133–139` | `clips` — `updateClip` at `:110` writes the store every move, so `state.project.timeline.clips` is a new array each frame | **Yes** |
| `useTimelineMarquee.ts:104–180` | `:173–179` | `tlMarqueeCurrent` / `tlMarqueeActive`, set at `:115` on every move past the threshold | **Yes** |
| `usePlayheadDrag.ts:53–76` | `:69–75` | none — `isDraggingPlayhead` is a boolean, `setCurrentTime` is a stable zustand action, `pixelsPerSecond`/`timelineDuration` are constant during a scrub | **No** — binds once per gesture already |
| `useInOutDrag.ts:64–94` | `:87–93` | none, same shape | **No** |

So the listener churn is **three hooks, not five**. A plan that "fixes" the playhead scrub
would be a no-op dressed up as a win; the scrub's per-frame cost is something else (below).

### Per-move measurement and allocation, with call sites

- `useClipDrag.ts:149` — `trackContainerRef.current.getBoundingClientRect()` per move.
- `useClipDrag.ts:175` — `querySelectorAll('[data-track-id]')` per move, then
  `useClipDrag.ts:178–183` — `el.getBoundingClientRect()` **per track row per move**. With
  four tracks that is 5 forced layouts per drag frame, and it scales with track count.
- `useClipDrag.ts:163` — `getSnapPoints(clips, dragState.clipId)` per move →
  `store/projectStore.ts:1559–1569`, which allocates a `Set`, fills it with
  `2 × clips.length` entries and returns `Array.from(points).sort(...)` — a fresh sorted
  array of ~29 numbers every frame on the 14-clip scene, thrown away immediately.
- `useClipDrag.ts:165` / `useTrimDrag.ts:88,91` — `clips.find(...)` per move.
- `useTrimDrag.ts:93` — container rect per move.
- `useTimelineMarquee.ts:109` — container rect per move. Its
  `querySelectorAll` + per-row rects (`:136–151`) are **mouseup-only**, already once per
  gesture — a second correction to the review's note.
- `usePlayheadDrag.ts:59` and `useInOutDrag.ts:71` — one container rect per move each.
  No listener churn, but still a forced layout per frame.

### Render amplification during a drag

`dragState` lives in `useClipDrag`'s `useState`, so every mousemove re-renders `Timeline`
and everything below it:

- `Timeline.tsx:95–101` — `getTrackClips` is a `useCallback`, but its body is
  `trackClips.map(vc => vc.clip)`: **a fresh array per track per render**. Called at
  `Timeline.tsx:256`. This is why `React.memo` on `TimelineTrack` alone would buy nothing —
  the `clips` prop never compares equal.
- `TimelineTrack.tsx:47` — not memoised. Re-runs its whole clip loop per drag frame, and
  allocates three inline lambdas per clip (`:105`, `:124`, `:130`).
- `TrackHeader.tsx` — not memoised. Nothing in a header changes during a clip drag; it
  holds its own rename state, so a memo is safe and its props (`track`, `index`,
  `trackCount`, four store actions and three `useTrackHeaderActions` callbacks) are already
  stable-ish.
- `TimelineRuler.tsx:57` — not memoised, and calls `getRulerTicks(duration, pixelsPerSecond)`
  in the render body → `timelineGeometry.ts:39–53` allocates one object per tick.
  `RULER_MINOR_INTERVAL = 1` (`timelineGeometry.ts:15`) and `Timeline.tsx:68` floors the
  duration at 60 s, so that is **≥61 objects plus 61 DOM diffs per drag frame**, for a ruler
  whose content cannot change during a clip drag.
- `Timeline.tsx:162` — `tracks.reduce` per render. Trivial; listed for completeness.

### Two live `currentTime` subscriptions round 1 missed

This is the round's biggest surprise. Round 1 removed `currentTime` from `Timeline.tsx` and `App.tsx`. Two more remain, and they are
precisely the two components left at the top of the post-round-1 app-code profile
(`2026-09-12-profile.md` §"Preview playback, 720p — top 10", total-time table):

| Component | Subscription | Used where | Profile after round 1 |
|---|---|---|---|
| `Toolbar.tsx:18` | `state.currentTime` | **handlers only** — `:40–41` (`addMarker`), `:181`, `:190` (in/out toggles). Never rendered. | #6, **76.8 ms total, 14.8%** of remaining preview JS |
| `useClipEditorActions.ts:119` | `state.currentTime` | `:157–158`, feeding `timeInClip`, which **is** rendered (the header row and `ActionsSection`'s split-disabled state) | #10, **23.1 ms total, 4.4%** |

Together ~19% of the JavaScript a playback window still executes. `Toolbar` is the exact
shape round 1 already fixed in `App.tsx` — *"the shortcut handlers that need the live value
read `useEditorStore.getState().currentTime` inside the handler"* (`apps/artist/CLAUDE.md`,
App section) — simply not applied here. `ClipEditor` is the `PreviewTimecode` /
`TimelinePlayhead` shape instead: the value is displayed, so it needs a small self-
subscribing leaf, not a `getState()` read. Note `ClipEditor` re-renders on every tick even
with **nothing selected**, because the hook subscribes before `ClipEditor.tsx`'s
`!selectedClip` early return.

These two are measurable **today**, with the existing `preview-playback` benchmark and no
new tooling. That makes them the cheapest credible win in the round.

### Elsewhere

- `apps/artist/src/app/useAppKeyboardShortcuts.ts:113` — one `keydown` effect with a
  **33-entry** deps array (`:335–342`), including `handleSaveProject`, which
  `useProjectActions.ts:80` rebuilds whenever `project` changes. So the global keydown
  listener is torn down and re-added on essentially every edit. One `removeEventListener` +
  one `addEventListener` per edit is cheap in absolute terms and is **not** per-frame;
  `apps/artist/CLAUDE.md` records the deps array as *"the inline one character for
  character … a known staleness, carried deliberately"*. Measure before touching.
- `apps/artist/src/app/useTimelineHeight.ts:54–83` — deps `[isResizing, timelineHeight]`,
  re-binding both listeners and both `document.body.style` writes per clamped pixel. Called
  out in that file's own header as load-bearing: `handleResizeEnd` (`:64–68`) closes over
  `timelineHeight` and that closure is what reaches `storeTimelineHeight` (`:67`).
- `ShapeSection.tsx:99` and `:105` — `fillAlphaPercent(shapeData.fillColor || '#000000ff')`
  computed twice per render. Trivial, not on any hot path, and it would move a coverage floor for
  nothing. **Out of scope.**

## Existing measurement tooling (what can be measured today)

**Browser benchmarks** — `apps/e2e/playwright.perf.config.ts` picks up any spec under
`tests/perf/`, Chromium only, one worker, no retries, fixed `PERF_LAUNCH_ARGS`
(`utils/perf.ts:52`). Today: `preview-playback.spec.ts`, `export.spec.ts`, `visual.spec.ts`.

**`apps/e2e/utils/perf.ts`** already provides everything a new benchmark needs:

| Helper | Line | What it gives |
|---|---|---|
| `installPerfInstrumentation` | `:267` | rAF counter + `PerformanceObserver({entryTypes:['longtask']})` + encoder wrapper, installed via `addInitScript` before app code |
| `loadPerfScene` | `:611` | the 14-clip / 4-track / 13 s scene through the real import + `LOAD_PROJECT` integration API, then waits for decoded red pixels |
| `readCdpMetrics` | `:325` | `TaskDuration`, **`LayoutCount`, `RecalcStyleCount`** — already collected, exactly the counters a drag benchmark wants |
| `readHeapAfterGc` | `:341` | forced-GC-anchored heap delta |
| `withCpuProfile` | `:201` | `PERF_PROFILE=1`'s discarded fourth run + source maps |
| `writePerfResult` / `median` / `round` | `:80` / `:66` / `:74` | the JSON the report merges |

**Report wiring** — `apps/e2e/scripts/perf-report.mjs` auto-collects every
`perf-results/*.json`, so a new benchmark appears in `perf-report.json` and the CI job
summary with **no** script change; it needs entries in `ORDER` (`:41`) and `METRICS`
(`:44`) only so it is ordered and labelled rather than dumped nameless. `scripts/perf.mjs`
runs the whole perf project as one step (`:33–44`) — also no change needed. CI `perf` job:
`.github/workflows/ci.yml:582`, `continue-on-error: true`, absent from `ci-status`'s
`needs`, `timeout-minutes: 30`.

**Unit ceilings** — `drawFrame.perf.test.ts` (its header states the rule),
`exportMP4.perf.test.ts`, plus CRAFT's two. Scene fixture:
`apps/artist/src/test/fixtures/perfScene.ts` — `buildSceneProject()` at `:213` is the same
12-clip scene the browser benchmark builds.

**Patterns the new ceilings will reuse, all already in the repo:**

- Listener counting: `useClipDrag.test.ts:47–48` already does
  `vi.spyOn(document, 'addEventListener' / 'removeEventListener')`.
- Render counting: `App.rerender.test.tsx` — a **pass-through** `vi.spyOn(module, export)`
  (no `mockImplementation`, the real thing still runs), with a comment explaining why a
  React `Profiler` cannot do this job. Works on components too; the spy is installed once so
  the element type identity stays stable across renders.
- Function-call counting: same pass-through spy, on `projectStore.getSnapPoints`.
- jsdom rects: `test/doubles/layout.ts` `setRect`/`setRects`. **Caveat for the ceilings:**
  `setRect` replaces `getBoundingClientRect` **on the element instance** (`:33`), so a
  counter must spy on the instance *after* `setRect`, or wrap inside `setRect`'s closure —
  a `vi.spyOn(Element.prototype, 'getBoundingClientRect')` will count zero for exactly the
  elements the test cares about.

**No timeline-interaction benchmark exists.** That is Task 1.

## Global constraints

1. **No claim without paired alternation, ≥3 rounds.** Base and patched code swapped on one
   warm dev server, spec run round-robin, report both arms and the spread — not a delta.
   Sequential before/after drifts on this machine (round 1 saw `export-webm` fall
   79.75 → 72.14 f/s across three *untouched* runs). Anything inside the recorded bands
   (~1 fps playback, ~1.5% export) is **noise, and must be labelled a noise check**, as
   round 1's Task 5 row is.
2. **`pnpm perf` green.** Every benchmark completes; `perf-report.json` written.
3. **Ceilings: 2× measured, rounded up, with the measured value and the date in a comment
   beside it. Conservation laws asserted exactly. Only ever lowered.** Raising one requires
   saying in the PR why the new cost is correct.
4. **`Timeline.*.test.tsx`, the five gesture-hook test files, and the six `App.*.test.tsx`
   files are byte-unchanged.** They are the behaviour contract for Task 2; a rewrite that
   needs its tests edited is a rewrite that changed behaviour. `git diff --stat` must show
   them absent. (New `*.perf.test.ts` files are additions, not edits.)
5. **Coverage floors move up only** — artist lines 99 / statements 98 / branches 92 /
   functions 98 (`apps/artist/vite.config.ts:166–171`).
6. **No `currentTime` subscription in `App.tsx` or `src/app/`.** `App.rerender.test.tsx` is
   the net and stays byte-unchanged.
7. **No per-frame allocation added.** A change that removes one array per frame and adds an
   object per frame has not landed.
8. **Renderer changes additive**, ES2020, `pnpm lint` + `pnpm typecheck` + `pnpm test` green.

## Tasks

- [ ] **Task 1 — Measure first: a `timeline-interaction` benchmark, unit ceilings for the
      gesture hooks, and a recorded baseline.**

  Add `apps/e2e/tests/perf/timeline-interaction.spec.ts`, mirroring
  `preview-playback.spec.ts`'s structure exactly (`installPerfInstrumentation` →
  `loadPerfScene` → `newCDPSession` + `Performance.enable` → `PERF_RUNS` windows →
  `writePerfResult` → `console.log` the runs → the `PERF_PROFILE` fourth discarded run
  writing `timeline-interaction.cpuprofile`). Add a `measureGesture(page, cdp, gesture,
  profileName?)` to `apps/e2e/utils/perf.ts` beside `measurePlayback`/`measureExport`,
  returning one metrics object per gesture so `withCpuProfile` wraps the call without
  restructuring.

  Three gestures over the existing 14-clip scene, driven with synthetic pointer events
  (`page.mouse.move/down/up`, not `dragTo`, so the frame count is ours):

  | Gesture | Shape |
  |---|---|
  | `clipDrag` | grab `[data-clip-id="perf-clip-0"]`, N = 60 moves across the scene and down onto `perf-track-1`, release |
  | `marquee` | press on empty track space, N = 60 moves describing a rectangle over both media tracks, release |
  | `playheadScrub` | press the playhead, N = 60 moves along the ruler, release |

  Per gesture report: `moveEvents`, `wallMs`, `jsMsPerFrame` (`TaskDuration` delta ÷
  `moveEvents`), `layoutCount` **and `layoutsPerFrame`**, `recalcStyleCount` and
  `recalcsPerFrame`, `longTaskCount`, `longTaskTotalMs`, `heapDeltaBytes`. Long tasks are
  attributed by start time, same rule and same comment as `measurePlayback` (`:764–781`).
  `layoutsPerFrame` is the headline: it is the number Task 2 is predicted to move and the
  one a slow machine feels.

  Determinism notes to write into the spec: each run re-loads the scene (or reverses the
  drag) so all three runs move the same clip from the same place; one `page.mouse.move`
  between `down` and the first measured move, discarded, so gesture start-up is not in the
  window; assert the drag actually committed (the clip's `left` changed) so a benchmark that
  silently measures nothing fails loudly — the same reasoning as `measurePlayback`'s
  still-playing tripwire.

  Wire-up: add `'timeline-interaction'` to `perf-report.mjs`'s `ORDER` (`:41`) and the new
  metric keys to `METRICS` (`:44`) with labels/units. `scripts/perf.mjs` needs no change
  (it runs the project, not the specs); update the CI `perf` job's comment
  (`.github/workflows/ci.yml:572–575`) to name four benchmarks and raise `timeout-minutes`
  to 40 if the local wall time says the job will not fit in 30.

  Unit ceilings, new file
  `apps/artist/src/components/Timeline/timelineGestures.perf.test.ts`, header modelled on
  `drawFrame.perf.test.ts`'s. Drive each hook through `renderHook` + `act` the way
  `useClipDrag.test.ts` already does, over N synthetic mousemoves, and count:

  | Counter | How | Hooks |
  |---|---|---|
  | `document.addEventListener` / `removeEventListener` calls per move | `vi.spyOn(document, …)`, as `useClipDrag.test.ts:47–48` | all five |
  | `getBoundingClientRect` calls per move | spy on the **instances** after `setRect` (see the caveat above), container and rows counted separately | all five |
  | `getSnapPoints` calls per move | pass-through `vi.spyOn(projectStore, 'getSnapPoints')` | `useClipDrag` |
  | `querySelectorAll` calls per move | `vi.spyOn(container, 'querySelectorAll')` | `useClipDrag`, marquee |
  | `TimelineTrack` / `TrackHeader` / `TimelineRuler` renders per drag frame | pass-through `vi.spyOn` on each component module, driven through the rendered `Timeline` | rendered timeline |
  | `getRulerTicks` calls per drag frame | pass-through spy on `timelineGeometry` | rendered timeline |

  Record every measured value with its date in a comment, ceiling at 2× rounded up. Assert
  the conservation law exactly: **`addEventListener` calls == `removeEventListener` calls
  over a complete gesture, and both == 2 at the end** (one pair, added and removed once) —
  that is a property, not a budget, and it is what Task 2 has to make true.

  `usePlayheadDrag` and `useInOutDrag` get ceilings too, at their already-good values (2
  listener pairs per gesture, 1 rect per move), so a future refactor cannot quietly
  regress them into the churn the other three are in.

  Then record `docs/performance/2026-09-13-timeline-baseline.md` in the shape of
  `2026-09-12-baseline.md`: what is measured, the machine/OS/Node/Playwright/launch-arg
  block, three runs per gesture with the run-to-run spread so a reader knows the noise band,
  the unit ceilings' measured "before" values, and a "how to read these" section saying what
  jsdom cannot see.

  Commit: `perf(artist): benchmark a timeline drag, marquee and scrub, and pin the gesture hooks' per-frame call counts`

  **Reviewer checks**
  - `pnpm perf` green; `perf-report.json` holds a labelled `timeline-interaction` section.
  - The spec asserts the gesture had an effect; a no-op drag fails the benchmark.
  - No app code changed. `git diff --name-only` touches only `apps/e2e/**`, the new
    `*.perf.test.ts`, the CI comment, and the new doc.
  - Every ceiling carries its measured value **and** the date `2026-09-13`.
  - Baseline doc records three runs and the spread, not a single number.
  - The doc states the three-of-five listener-churn correction and the marquee's
    mouseup-only row walk, so the record is right before anything is fixed.

- [ ] **Task 2 — One listener pair per gesture, one rect cache per gesture, one snap
      array per gesture.**

  For `useClipDrag`, `useTrimDrag` and `useTimelineMarquee` only (the two that already bind
  once are left alone, and their new ceilings prove it):

  Hold per-move state in refs read by a single listener registered once per gesture — added
  on mousedown, removed on mouseup and on unmount. `dragState` / `trimState` /
  `tlMarqueeCurrent` stay as `useState` for the *render* (the ghost clip, the live trim, the
  rectangle all draw from them) and gain a ref alongside that the listener reads, so the
  effect's deps no longer name the value each move writes. `src/hooks/useDocumentListener.ts`
  already implements the ref-held-handler shape and `useDragListeners` (`:74`) the
  start/stop shape — reuse whichever fits rather than inventing a third; if neither fits,
  say why in the commit body.

  Cache track rects **once per gesture**: on mousedown snap the container rect and each
  `[data-track-id]` row's layout-space top/height/id into a ref array, then per move compute
  `clientY - containerTop + container.scrollTop` against the cached offsets. Only `scrollTop`
  is read per move — a scroll-position read, not N forced layouts. Invalidate the cache on
  `scroll` (capture) and `resize` while the gesture is live, because a mid-drag vertical
  scroll or a timeline-panel resize moves the container's client top.

  Compute snap points **once per gesture**, on mousedown, into a ref
  (`getSnapPoints(clips, clipId)` — its inputs cannot change during a drag, since a clip
  drag writes nothing to the store until release: `useClipDrag.ts:13–16`, `:193–226`).

  **Preserve exactly**, and say in the PR how each was verified:
  - `useTrimDrag`'s per-move `updateClip` store write and its re-derivation from the origin
    (`:97–111`) — the trim must still come home exactly after wandering past a limit.
  - The mouseup semantics: the bulk-vs-single commit and its `wouldOverlap` veto
    (`useClipDrag.ts:193–226`); the ripple shift (`useTrimDrag.ts:114–131`); the marquee's
    `marqueeJustFinished.current = true` (`useTimelineMarquee.ts:164`) which
    `useTimelineSeek` reads to suppress the closing click's seek.
  - The hooks' call order in `Timeline.tsx:104–203`, which `apps/artist/CLAUDE.md` records
    as load-bearing for the four that bind listeners.

  Paired alternation, ≥3 rounds, on all three gestures. Lower every ceiling Task 1 set that
  moved; the listener conservation assertion should now be satisfied by construction.

  Commit: `perf(artist): bind one listener pair per timeline gesture and measure the track rows once`

  **Reviewer checks**
  - `git diff --stat` shows **no** change to `Timeline.*.test.tsx` or the five hook test
    files. `pnpm test --filter artist` green.
  - Ceiling file shows listeners per gesture == 2 exactly, `getSnapPoints` == 1 per gesture,
    per-row `getBoundingClientRect` == rows-once-per-gesture, all with new dated comments.
  - `layoutsPerFrame` for `clipDrag` moved, with both arms and the spread quoted.
  - Cache invalidation on scroll/resize is covered by a new test (mid-drag scroll still
    lands the clip on the right track).
  - No new per-frame allocation: the ref cache is built on mousedown, never in the move
    handler.
  - Unmount mid-gesture removes the listeners (existing tests already cover this; confirm
    they still do).

- [ ] **Task 3 — Memo boundaries and the two remaining `currentTime` subscriptions, each
      with its own before/after.**

  Three independent sub-items. Each measured on its own by paired alternation; any that does
  not move a number outside the band is **reverted, or landed and labelled a noise check** —
  never landed as an unmeasured "optimisation".

  **(a) `Toolbar`'s `currentTime` — highest expected value, measurable with the existing
  `preview-playback` benchmark, no Task 1 dependency.** `Toolbar.tsx:18`'s subscription is
  read only inside handlers (`:40–41`, `:181`, `:190`). Replace with
  `useEditorStore.getState().currentTime` inside each handler — character for character the
  pattern `apps/artist/CLAUDE.md` documents for `App.tsx`. Expect the post-round-1 profile's
  #6 app-code entry (76.8 ms, 14.8%) to go to roughly zero. Watch: rendered fps, renderer
  task duration, `jsxDEV` self ms in a fresh `PERF_PROFILE=1` profile. Add the `Toolbar`
  half of the contract to a ceiling test in the shape of `App.rerender.test.tsx` — a
  playback tick must not re-render `Toolbar`.

  **(b) `ClipEditor`'s `currentTime`.** `useClipEditorActions.ts:119` feeds `timeInClip`
  (`:157–158`), which **is** rendered, so `getState()` is wrong here. Use the
  `PreviewTimecode` / `TimelinePlayhead` shape instead: move the playhead-derived readout
  into a small `React.memo`'d leaf that subscribes for itself, leaving the hook and the panel
  off the tick. Note the panel re-renders on every tick even with nothing selected (the hook
  runs before `ClipEditor.tsx`'s `!selectedClip` early return), so the win applies to the
  common case of no selection too. `ActionsSection`'s split-disabled state also reads the
  playhead — decide deliberately whether it moves into the leaf or keeps a coarser
  subscription, and say which in the PR. Expected: the profile's #10 entry (23.1 ms, 4.4%).

  **(c) Memo boundaries under a drag, in dependency order.** `getTrackClips`
  (`Timeline.tsx:95–101`) must be memoised per `visibleClipsByTrack` change **first** — a
  `React.memo` on `TimelineTrack` is worthless while its `clips` prop is a fresh array every
  render. Then `React.memo` on `TimelineTrack`, `TrackHeader` and `TimelineRuler`, each only
  where Task 1's render counters say it costs something during a drag or playback, with
  props made stable (`useCallback` where the parent already has the callback; note
  `Timeline.tsx:256`'s call site and `TimelineTrack.tsx:105/124/130`'s inline lambdas, which
  are inside the memo boundary and therefore fine). `TimelineRuler` is the strongest
  candidate — `getRulerTicks` allocates ≥61 objects per drag frame for a ruler that cannot
  change during a clip drag. `TrackHeader` is the weakest; if its render counter is already
  low, skip it and say so.

  **(d) The `useAppKeyboardShortcuts` deps churn — measure, then probably leave it.**
  33 deps, re-binding on every edit. It is not per-frame, `apps/artist/CLAUDE.md` records the
  array as deliberate, and splitting the handler into a ref-held latest-callback changes the
  staleness semantics the Ctrl+B branch depends on. Count the re-binds over a scripted edit
  burst; land a change **only** if the count is large enough to matter. The expected outcome
  is a documented "measured, left verbatim", which is a result.

  Do **not** memoise `TimelinePane` — `apps/artist/CLAUDE.md` records it as deliberately
  unmemoised so `App.rerender.test.tsx` keeps counting real `Timeline` renders.

  Commit: `perf(artist): keep the toolbar and clip editor off the playback tick and memoise the timeline's rows`

  **Reviewer checks**
  - One before/after table per sub-item, both arms, ≥3 rounds; anything inside the band
    labelled a noise check.
  - `App.rerender.test.tsx` byte-unchanged and green; the new `Toolbar` contract test fails
    if the selector comes back.
  - `getTrackClips` memoisation lands **before or with** any `React.memo` on
    `TimelineTrack`; a reviewer can see the prop identity is now stable.
  - No memo added without a counter that moved. Sub-item (d) has a recorded number whichever
    way it goes.
  - `TimelinePane` still unmemoised.
  - Coverage floors unchanged or raised.

- [ ] **Task 4 — Profile doc, ceilings, CI summary, changeset.**

  `docs/performance/2026-09-13-timeline-profile.md`, in the shape of
  `2026-09-12-profile.md`: how it was recorded, before/after tables per gesture and per
  sub-item with **both arms**, what transferred to a production build and what is a dev-build
  artefact (`jsxDEV` does not exist in a release bundle; the render *count* is the durable
  finding, its unit price is not — say it again rather than assuming the reader followed the
  link), the three-of-five listener-churn correction and the marquee's mouseup-only row walk
  written up as corrections to the decomposition review, a ranked-candidates table with a
  status column, and a follow-ups section. Follow-ups to carry forward: the constant-screen-
  size selection handles (still open from round 1), the DPR-change listener (still open), and
  anything Task 3 measured and chose not to land.

  Re-check every ceiling against a fresh measurement and lower the ones that moved; confirm
  none was raised. Update `CLAUDE.md`'s "Performance benchmarks" section (four browser
  benchmarks, not three; name `timeline-interaction` and its metrics) and "Per-frame
  ceilings" (five ceiling files, not four). Update `apps/artist/CLAUDE.md`'s Timeline section
  with the gesture-listener contract, the per-gesture rect/snap caches and their invalidation
  rule, and its Preview/App sections with the `Toolbar`/`ClipEditor` `currentTime` outcome —
  including, if (b) landed, the new self-subscribing leaf beside `PreviewTimecode` and
  `TimelinePlayhead`. Link both new docs from `CLAUDE.md` next to the round-1 pair.

  Changeset: patch `@escapesuite/artist` only. `@escapesuite/e2e` is private and unversioned
  — no entry, matching how the round-1 changesets were written.

  Commit: `docs(artist): record the timeline interaction profile and round 2's before/after`

  **Reviewer checks**
  - Every number in the doc is reproducible from a command printed in the doc.
  - No ceiling raised anywhere in the diff; every lowered one carries a `2026-09-13` comment.
  - `CLAUDE.md` says four benchmarks and five ceiling files, and both counts match the tree.
  - CI `perf` job summary from a real run shows the new benchmark's rows.
  - Changeset patches artist only.
  - Follow-ups are stated as open, with the one-line fix each needs — round 1's follow-up
    list is the standard.

## Done criteria

1. `pnpm perf` green and `perf-report.json` carries four browser benchmarks plus the kit.
2. `timeline-interaction` reports `layoutsPerFrame`, `jsMsPerFrame`, long tasks and heap
   delta for `clipDrag`, `marquee` and `playheadScrub`, over the 14-clip scene.
3. Over a complete clip drag, trim or marquee: **exactly one** `document` listener pair
   added and removed, **one** `getSnapPoints` call, **one** pass over the track rows — all
   asserted, not asserted-approximately.
4. Every claim in `2026-09-13-timeline-profile.md` is backed by paired alternation, ≥3
   rounds, both arms and the spread quoted; anything inside the noise band is labelled a
   noise check.
5. No `currentTime` selector in `App.tsx`, `src/app/`, `Timeline.tsx` or `Toolbar.tsx`;
   `App.rerender.test.tsx` byte-unchanged and green, with a matching `Toolbar` contract test.
6. `Timeline.*.test.tsx`, the five gesture-hook test files and the six `App.*.test.tsx` files
   are byte-unchanged.
7. Ceilings only lowered; every touched one dated `2026-09-13`; conservation laws exact.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test` green; artist coverage floors unchanged or
   raised; ES2020.
9. Changeset patches artist only.

## Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| **The `useTimelineHeight` resize re-bind is how the height reaches `localStorage`.** `useTimelineHeight.ts:64–68`: `handleResizeEnd` closes over `timelineHeight`, and the `[isResizing, timelineHeight]` deps are what make that closure current. A ref rewrite that forgets the final write silently stops persisting the panel height — and the App suite is the only thing that would catch it. | Silent data loss, and the file's own header warns about it | **Out of scope for round 2.** It is not a per-frame cost on any user-facing gesture the benchmark measures, and the trade is bad. If a later round touches it: keep a `heightRef` written by every move and have `handleResizeEnd` persist `heightRef.current`, and treat `App.session.test.tsx` as the acceptance gate. |
| **The marquee/click handoff.** `marqueeJustFinished` (`Timeline.tsx:174`, set at `useTimelineMarquee.ts:164`, read by `useTimelineSeek`) is a ref written on mouseup and read by the click that follows. A single-listener rewrite that changes *when* mouseup runs relative to the click re-introduces "the marquee selects, then the click immediately deselects and seeks". | User-visible, and easy to miss in review | Byte-unchanged `useTimelineMarquee.test.ts` + `useTimelineSeek.test.ts` + `Timeline.editing.test.tsx` are the net. Register the gesture listener on the `document` in the same phase it uses today — no `capture`, no `once`. |
| **Cached track rects go stale mid-gesture.** Vertical scroll or a timeline resize during a drag moves the rows the cache describes; a stale cache drops the clip on the wrong track. | Wrong result, not just slow | Cache layout-space offsets and read `scrollTop` per move; invalidate on `scroll` (capture) and `resize` for the gesture's life; add a mid-drag-scroll test. |
| **jsdom cannot measure layout.** `getBoundingClientRect` is all-zero (`test/doubles/layout.ts` header), so the unit ceilings can only count *calls*. A change that halves the calls but doubles their cost would pass every ceiling. | A green suite that means less than it looks | Keep the split explicit and stated in both docs: **unit ceilings count calls, the Playwright benchmark measures time.** Neither is allowed to stand alone for a claim. |
| **`setRect` hides a prototype spy.** It replaces `getBoundingClientRect` on the instance, so `vi.spyOn(Element.prototype, …)` counts zero for exactly the elements under test. | A ceiling that reads 0 and asserts nothing | Spy the instance after `setRect`, and add an assertion that the counter is **non-zero before** the fix, so a ceiling can never pass by measuring nothing. |
| **CI runner variance.** The `perf` job is informational, `continue-on-error: true`, absent from `ci-status`'s `needs`, on a shared runner. | A CI number will move for reasons unrelated to the diff | Keep it informational. Compare CI to CI on the same branch; every claim in the docs comes from local paired alternation. |
| **A new benchmark lengthens the `perf` job.** `timeout-minutes: 30` today for three benchmarks. | A timed-out job reports nothing | Measure the wall time locally in Task 1 and raise the timeout in the same commit if it does not fit. |
| **Memoising a component with hidden state.** `TrackHeader` owns its rename state; `CollapsibleSection` seeds `defaultOpen` at mount and never re-reads it. A memo that changes remount behaviour changes which section's open/closed state is which. | A subtle UI regression no perf test would catch | Only memoise where a counter says it pays; keep element identity and key order unchanged; the byte-unchanged component suites are the net. |
| **Fixing (b) by moving the readout could change `ActionsSection`'s split-disabled logic.** It reads the playhead to decide whether split is available. | A control that enables at the wrong time | Decide explicitly and record it; `ClipEditor.test.tsx` byte-unchanged is the gate. |
