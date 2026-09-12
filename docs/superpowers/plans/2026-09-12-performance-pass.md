# Performance pass — measure first, then fix (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator's standing priority is lightweight performance on lower-spec machines, and nothing measures it today. Establish repeatable measurements of the three hot paths — ESCAPEARTIST preview playback, ESCAPEARTIST MP4/WebM export, and the headless render kit — in real Chromium and in the unit harness; record a baseline; profile; then fix the top hotspots in a separate PR with before/after numbers. No behaviour change in Tasks 1–3.

**Two PRs:** Tasks 1–3 (measurement + baseline + profile report) as `perf/measurement`; Task 4 (fixes) as `perf/fixes-round-1` after the profile identifies targets.

**Ground truth that exists:** `apps/e2e/fixtures/headless/{project.json, source.mp4}` (a real project + source used by `tests/headless/render-bundle.spec.ts` and the kit's Chromium tests); `apps/e2e/tests/escapeartist/*.spec.ts` (UI flows incl. export); `services/headless-artist` CLI `render` with `--job` specs; the preview modules under `apps/artist/src/components/Preview/` with recording doubles (`src/test/doubles/canvas.ts` ordered call log, `renderPreview.tsx` harness with `frames()`); `PREVIEW_DRAW_OPTIONS`; CI `ci.yml` with an `e2e` job on Playwright 1.63.0 Chromium.

**Global constraints**
- Tasks 1–3 change no app behaviour. App code may gain **zero-cost instrumentation only** if a measurement cannot be taken from outside (e.g. `performance.mark` calls) — prefer `page.addInitScript` wrappers (rAF, `VideoEncoder.encode`) and CDP so the app stays untouched; if a mark is added, it must be a no-op in production paths (guarded by a build-time flag) and covered by a unit test that it is not emitted by default.
- Measurements are **informational** in CI (a `perf` job that never fails the build: `continue-on-error: true`, no thresholds) and land in the job summary and an artifact. Unit-level characterisation ceilings (Task 2) ARE enforced, like coverage floors, but are set generously (2× measured) so only a real regression trips them.
- Determinism over precision: fixed fixture, fixed durations, warm-up frame discarded, median of 3 runs where wall time is involved; headless Chromium with `--disable-gpu` documented as the CI environment (numbers are relative, not what a user sees).
- Coverage floors hold (new app instrumentation, if any, is tested). Lint/typecheck clean. Tests never mock the module under test.

## Task 1: Real-browser benchmarks (Playwright, Chromium) + report
- [ ] `apps/e2e/tests/perf/preview-playback.spec.ts`: load ARTIST with a **generated** 12-clip project (build it in the test from `fixtures/headless/source.mp4` imported once and cloned across two tracks with transforms, one text overlay, one shape overlay, one transition — deterministic, documented), press play for 6 s, measure: rendered frames (wrap `requestAnimationFrame` via `addInitScript` and count callbacks whose invocation stack includes the preview loop — simplest: count all rAF callbacks; the preview is the only loop while playing), long tasks (`PerformanceObserver` `longtask`), JS heap delta (`performance.memory.usedJSHeapSize` start→end after a forced GC via CDP `HeapProfiler.collectGarbage`), and CDP `Performance.getMetrics` (`LayoutCount`, `RecalcStyleCount`, `TaskDuration`). Discard the first second.
- [ ] `apps/e2e/tests/perf/export.spec.ts`: same project, export MP4 at 720p and WebM via the UI (reuse the existing export flow helpers); measure wall time from the first `EXPORT` progress to `complete`, frames encoded (from the app's progress payload or by wrapping `VideoEncoder.prototype.encode` in `addInitScript`), heap delta, and `VideoEncoder` queue high-water mark (wrap `encodeQueueSize` reads or sample it every 100 ms).
- [ ] `services/headless-artist`: `src/perf.chromium.test.ts` (runs with `test:e2e` only): render `apps/e2e/fixtures/headless/project.json` three times, report median wall time and frames/s to stdout as one JSON line, and write it to `services/headless-artist/perf-report.json`.
- [ ] `apps/e2e/scripts/perf-report.mjs`: merges the three JSON outputs into `perf-report.json` + a Markdown table; appends to `$GITHUB_STEP_SUMMARY` when set. Root script `pnpm perf` runs the Playwright perf project (`playwright.perf.config.ts`, Chromium only, 1 worker, no retries) then the kit perf test, then the report.
- [ ] CI: a `perf` job (needs `build`, `continue-on-error: true`, same Playwright cache) running `pnpm perf` on PRs and main, uploading `perf-report.json` and any `.cpuprofile` as the `perf-report` artifact. Document in root `CLAUDE.md` (Testing) and `apps/e2e/README` if one exists.
- [ ] Record the baseline numbers (local + the first CI run) in `docs/performance/2026-09-12-baseline.md`.
- [ ] Commit: `perf: real-browser benchmarks for preview playback, export, and the headless kit; informational CI job`.

## Task 2: Unit-level per-frame characterisation (enforced ceilings)
- [ ] `apps/artist/src/components/Preview/drawFrame.perf.test.ts`: with the recording canvas double and the `renderPreview` harness, render one frame of the same 12-clip scene and assert **ceilings** on: 2D-context calls per frame, `save`/`restore` pairs, `measureText` calls, `getAnimatedValues` invocations (spy), `getContext` calls (must be 1 per frame after warm-up), and object-URL/`Map` allocations observable through the doubles. Print the measured numbers in the test name/output; set each ceiling at 2× measured, rounded up, with a comment giving the measured value and date.
- [ ] Same for `core/canvasRenderer.ts` via the exporter path (`exportMP4` with the WebCodecs/mediabunny doubles): draw calls per frame, `VideoFrame` created vs closed (must be equal), encoder `encode` calls == frames, `flush` calls, and `getAnimatedValuesCached` cache hit ratio for a static scene (must be > 0.9).
- [ ] `apps/craft`: compositor ticks per second under fake rAF with a 30 fps target (must not exceed 30 draws/s at 60 rAF/s), and `converter.ts` frames closed == frames created.
- [ ] Commit: `test(perf): per-frame work ceilings for the preview, the exporter, and the compositor`.

## Task 3: CPU profiles and a hotspot report
- [ ] In the Task 1 specs, when `PERF_PROFILE=1`, wrap the measured window in CDP `Profiler.start`/`stop` (sampling interval 100 µs) and save `preview.cpuprofile` / `export-mp4.cpuprofile`; a small `apps/e2e/scripts/profile-top.mjs` prints the top 25 functions by self time (URL + function name + %) into the report.
- [ ] Run locally with profiling on; write `docs/performance/2026-09-12-profile.md`: the top-25 tables for preview playback and MP4 export, with a short interpretation per entry (allocation-heavy? per-frame recomputation? store churn?) and a ranked list of candidate fixes with expected impact and risk. Do NOT fix anything in this task.
- [ ] Commit: `perf: CPU profiles of preview playback and MP4 export; hotspot report`.

## Task 4 (separate PR, planned after Task 3's report): fixes round 1
- [ ] Take the top 3–5 candidates from the report. Each: one commit, no behaviour change (all existing tests unchanged), before/after numbers from `pnpm perf` and the Task 2 ceilings in the commit body. Likely suspects to check first, from the reviews so far: the preview's `|| []` store selectors producing fresh arrays each snapshot (which churns `drawFrame`'s identity and rebuilds the rAF loop on every store write); per-mouse-event allocations in `hitTest`/`contentBox`; per-frame `getAnimatedValues` recomputation in the preview vs the exporter's cache; `drawSelectionHandles` allocations; `getClipsAtTime` filtering per frame.
- [ ] Lower Task 2's ceilings to the new measured values where they dropped. Commit per fix.

## Done criteria
- `pnpm perf` runs locally and in CI (informational) and produces a Markdown table + JSON artifact with preview fps, export fps, kit fps, heap deltas, long tasks.
- Baseline and profile documents exist under `docs/performance/`.
- Task 2 ceilings enforced in `pnpm test:coverage`.
- Task 4 lands measurable improvements with numbers, or the report explains why none were worth the risk.
