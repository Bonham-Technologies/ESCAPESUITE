# Coverage program — toward >95% where possible (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring unit-test coverage of the ESCAPE Suite packages up to the operator's standing requirement (>95% wherever possible), make the numbers visible in CI, and make regression impossible (thresholds that only go up). Measured 2026-09-10 from `pnpm test:coverage` (v8, unit suites only — the Chromium/e2e suites are not counted):

| Package | Lines | Branches | Functions | Note |
|---|---|---|---|---|
| packages/shared | 100.0 | 95.0 | 86.7 | done |
| services/headless-artist | 85.0 | 80.7 | 80.4 | `renderDriver.ts` is only exercised by the Chromium suite |
| apps/plan | 80.4 | 55.6 | 60.0 | 8 files |
| apps/craft | 42.9 | 45.5 | 47.2 | 736 uncovered lines; `converter.ts` 0.9%, `thumbnailGenerator.ts` 3.6%, `compositor.ts` 29.8% |
| apps/artist | 36.8 | 26.7 | 52.0 | 4,222 uncovered lines; `PreviewPlayer.tsx` alone 1,300 (1,606 lines), `Timeline.tsx` 290, `App.tsx` 289, `canvasRenderer.ts` 277, `exportMP4.ts` 234, `exportWebM.ts` 187 |

**Approach:** tests must verify behaviour, not mocks. For pure logic, test the real functions. For modules on browser APIs that jsdom lacks (WebCodecs `VideoEncoder`/`VideoDecoder`/`VideoFrame`, `OfflineAudioContext`, `MediaRecorder`, Canvas 2D), use faithful **test doubles that record calls and produce deterministic output**, kept in one shared place per app (`src/test/doubles/*.ts`) and reused across tests — never per-test ad-hoc stubs that only assert the stub was called. Where the existing Chromium suites already prove a path end to end (export, headless render, recording), unit tests should cover the branches those suites cannot reach (error paths, cancellation, option combinations, edge cases), not duplicate the happy path. Each task ends by raising that package's thresholds to the achieved numbers (rounded down to the nearest whole percent) so the gain is locked in.

**Global constraints**
- No behaviour changes in app code except genuine bugs found by the new tests; each such fix is a separate commit with the failing test first and is called out in the task report.
- Do not delete or weaken existing tests. Do not exclude files from coverage to hit a number; the only allowed exclusions are files whose behaviour is *entirely* browser-runtime (documented per file in the config with the Chromium test that covers it).
- Test output pristine (no unhandled errors, no stray console noise); runtime of a package's unit suite must not more than double.
- Thresholds live in each package's vitest/vite config `test.coverage.thresholds` (`lines`, `statements`, `branches`, `functions`). A task never lowers a threshold.
- Style per file; lint 0 errors; `tsc --noEmit` clean.

## File structure
- `scripts/coverage-report.mjs` — **create.** Reads every package's `coverage/coverage-summary.json` and prints one table (also writes it to `$GITHUB_STEP_SUMMARY` when set).
- Each package's vitest/vite config — **modify.** Add `json-summary` reporter and `thresholds`.
- `.github/workflows/ci.yml` — **modify.** `test` job prints the table.
- `apps/craft/src/test/doubles/`, `apps/artist/src/test/doubles/` — **create** as tasks need them (WebCodecs, MediaRecorder, canvas, OfflineAudioContext, mediabunny).
- New/extended `*.test.ts(x)` next to each source file.
- `CLAUDE.md` Testing section — **modify.** Coverage policy and the report script.

---

## Task 0: Coverage infrastructure — report, floors, CI visibility
- [ ] Add `'json-summary'` to `coverage.reporter` in all five configs (`apps/craft/vite.config.ts`, `apps/artist/vite.config.ts`, `apps/plan/vitest.config.ts`, `packages/shared/vitest.config.ts`, `services/headless-artist/vitest.config.ts` — the last currently has no coverage block; add one mirroring the others, excluding `**/*.chromium.test.ts` from being *test* files (already) and listing `src/renderDriver.ts` and `src/serve.ts` under `exclude` ONLY IF their coverage comes solely from the Chromium suite — check; `serve.ts` has unit tests so it stays in).
- [ ] `scripts/coverage-report.mjs` (Node built-ins only): table of package × lines/statements/branches/functions with the threshold beside each; exit 0 always (thresholds are enforced by vitest itself). Root script `"coverage:report": "node scripts/coverage-report.mjs"`, and `"test:coverage"` unchanged.
- [ ] Set `thresholds` to the current measured floors, rounded DOWN to whole percents: shared 100/97/95/86 (lines/statements/branches/functions — if `lines` 100 is brittle with v8 line mapping, use 99), plan 80/80/55/60, craft 42/42/45/47, artist 36/37/26/52, headless-artist 85/83/80/80. Verify `pnpm test:coverage` passes with them, then verify a deliberately lowered number fails (temporarily delete one test file, run, restore — record the failing output).
- [ ] CI `test` job: after `pnpm test:coverage`, `- name: Coverage summary` → `pnpm coverage:report` (always runs).
- [ ] `CLAUDE.md` Testing section: the policy (thresholds only go up; how to read the report; how to add doubles).
- [ ] Commit: `test: coverage report, per-package thresholds at current floors, CI summary`.

## Task 0b: Coverage denominator correction — count every source file
Found after Task 2: this Vitest (5.0) only adds files no test imported to the report when `coverage.include` is set, and no package sets it. So every package's numbers omit its untested files (craft `App.tsx`, `main.tsx`, `analytics.ts`, `themeStorage.ts`; shared `storage/`, `theme/`, `analytics/`, `bootstrap/`; plan `App.tsx`, both Legal pages, `themeStorage.ts`; artist `KeyframeEditor.tsx`, `OverlayEditor.tsx`, `ResolutionMismatchDialog.tsx`, `selectors.ts`, `main.tsx`, `headless/main.ts`, `workers/decodeWorker.ts`). The floors set so far are therefore against a partial denominator.
- [ ] In all five configs set `coverage.include: ['src/**/*.{ts,tsx}']` (keep the existing `exclude` list; `src/test/**`, `*.d.ts`, `types.ts`, config files stay excluded). Allowed additional exclusions, each with a one-line comment naming the covering suite: `src/main.tsx` in plan/craft/artist (React bootstrap only; exercised by every Playwright suite), artist `src/headless/main.ts` (headless-bundle bootstrap; covered by `services/headless-artist` Chromium tests) and artist `src/workers/decodeWorker.ts` (runs only inside a Web Worker; covered by the e2e MP4 export tests). `packages/shared/src/index.ts` and other pure barrel `index.ts` re-export files are NOT excluded (they are trivially covered by importing them).
- [ ] Re-run `pnpm test:coverage`. Re-derive every package's floors from the new measured numbers rounded DOWN (this is the one permitted downward move, because it is a correction of the measurement, not a regression; record old→new in the commit body). Update the thresholds map in `scripts/coverage-report.mjs` and the table in `CLAUDE.md`'s coverage policy (add a sentence: all `src` files count, whether or not a test loads them).
- [ ] Verify the previously invisible files now appear in each package's text report at their real (mostly 0%) numbers; list them in the report.
- [ ] Commit: `test: count every source file in coverage (coverage.include), re-derive floors`.

## Task 1: CRAFT pure core → ≥95% lines
Files: `src/core/permissions.ts` (51.9%), `src/core/storage.ts` (13%), `src/core/thumbnailGenerator.ts` (3.6%), `src/store/recorderStore.ts` (55%), `src/core/recorder.ts` gaps (92.7%), `src/core/recorder-factory.ts`.
- [ ] Read each module and its existing test (if any). `thumbnailGenerator` uses `<video>`/canvas: add `src/test/doubles/canvas.ts` (2D context recording `drawImage`/`toBlob`/`getImageData` with deterministic pixels) and a `<video>` element double that fires `loadedmetadata`/`seeked` on demand; test success, seek failure, zero-duration, aspect handling. `permissions` — every capability branch (present/absent APIs, denied/granted/prompt, secure-context). `storage` — real fake-indexeddb round trips incl. `source: 'recording'` filtering used by ARTIST's loadVideo. `recorderStore` — every action and derived state.
- [ ] Raise craft thresholds to the achieved numbers. Commit: `test(craft): cover permissions, storage, thumbnails, store, recorder factory`.

## Task 2: CRAFT converter, compositor, WebCodecs recorder → ≥90% lines
Files: `src/core/converter.ts` (317 lines, 0.9%), `src/core/compositor.ts` (29.8%), `src/core/webcodecs-recorder.ts` (65.7%).
- [ ] `src/test/doubles/webcodecs.ts`: `VideoEncoder`/`VideoDecoder`/`VideoFrame`/`AudioEncoder`/`AudioData`/`EncodedVideoChunk` doubles that call `output` callbacks with synthetic chunks, honour `configure/encode/flush/close`, and can be told to fail at any step; `src/test/doubles/mediabunny.ts` (`vi.mock('mediabunny')`) with a recording `Output`/`Input` that captures added chunks and returns a Blob. Test converter: WebM→MP4 and →WebM paths, progress callbacks, cancellation (`AbortSignal`), background-tab pacing branch, error propagation, cleanup of frames on every path. Compositor: layout math (PiP position/size/shape), 720p cap, 30 fps throttle, `getOutputStream` lifecycle, start/stop idempotency (with fake timers and the rAF stub that clears). WebCodecs recorder: keyframe interval, configure fallbacks, stop/flush ordering, error mid-stream.
- [ ] Raise craft thresholds. Commit: `test(craft): cover converter, compositor, and the WebCodecs recorder with faithful doubles`.

## Task 3: CRAFT VideoPlayer + App gaps → craft ≥90% lines overall
- [ ] `VideoPlayer.tsx` (63%): scrubbing, fastSeek path, knownDuration fallback, non-fatal error handling, keyboard shortcuts. `App.tsx` remaining branches reachable in jsdom (mode switches, capability gating, embedded/non-embedded send-to-editor already covered). Add what is missing; do not test purely visual layout.
- [ ] Raise craft thresholds; target craft lines ≥90, branches ≥85. Commit: `test(craft): cover VideoPlayer and App branches`.

## Task 4: ARTIST pure logic and hooks → ≥95% lines for these files
Files: `src/core/exportTypes.ts` (32%), `src/utils/canvasUtils.ts` (40%), `src/utils/animation.ts` (71%), `src/utils/workerSupport.ts` (21%), `src/core/projectManager.ts` (8%), `src/core/videoProcessor.ts` (23%), hooks `useDocumentListener` (0%), `useThrottledDragUpdate` (12%), `useDraggablePanel` (48%), `useKeyframeDrag` (2%), `src/store/projectStore.ts` gaps (86%).
Also in scope after Task 0b's correction (uncovered lines): `src/store/selectors.ts` 47/47, `src/core/frameManager.ts` 27/27, `src/utils/waveform.ts` 33/58, `src/core/frameCache.ts` 21/92, `src/hooks/useVirtualizedTimeline.ts` 20/43, `src/core/frameSource.ts` 15/88, `src/utils/deepClone.ts` 3/5, `src/utils/throttle.ts` 2/69, `src/utils/integration.ts` 1/78, `src/core/videoDecodeManager.ts` 2/119, `src/core/exportScheduler.ts` 7/64 — take each to 100% where the remaining lines are reachable in jsdom.
- [ ] Pure functions get exhaustive tests (every branch of `getResolution`, transitions helpers, easing curves, keyframe interpolation, `calculateTimelineDuration`, quality settings). `projectManager`: save/load round trip through fake-indexeddb incl. version check, thumbnail handling, `extractMetadataFromBlob` for image/audio/video via the element doubles. `videoProcessor`: metadata extraction, waveform path, error branches. Hooks: `@testing-library/react` `renderHook` with fake timers.
- [ ] Raise artist thresholds. Commit: `test(artist): cover pure core, utils, hooks, and projectManager`.

## Task 5: ARTIST engine → ≥85% lines for `audioMixer.ts`, `canvasRenderer.ts`, `exportMP4.ts`, `exportWebM.ts`
- [ ] Reuse/extend the craft doubles (move shared doubles to `packages/shared/src/test/doubles/` if both apps need them — with tests of the doubles themselves). `OfflineAudioContext` double for the mixer (buffers, gains, per-track volume/mute, timeRange slicing). Canvas 2D recording double for `canvasRenderer` (verify draw order by track index, blend modes, opacity, transforms, blur, text/shape overlays, transitions — assert the recorded call sequence and computed geometry, not pixels). Exporters: codec selection incl. the Level 5.1 fallback, HW→SW pass, abort at each phase, progress phases, audio present/absent, timeRange, `ExportError` payloads.
- [ ] Raise artist thresholds. Commit: `test(artist): cover the audio mixer, canvas renderer, and both exporters with recording doubles`.

## Task 6a: ARTIST keyframe panel and small components → ≥90% lines each
Files (lines, existing test): `KeyframePanel/KeyframePanel.tsx` 324 (none), `KeyframePanel/KeyframeGraph.tsx` 467 (none), `KeyframePanel/KeyframeTrack.tsx` 179 (none), `KeyframePanel/ClipPreview.tsx` 149 (none), `ClipEditor/KeyframeEditor.tsx` 272 (none), `Preview/InlineTextEditor.tsx` 121 (none), `ResolutionPicker.tsx` 102 (none), `Toolbar/Toolbar.tsx` 286 (none), `KeyboardShortcuts/KeyboardShortcuts.tsx` 124 (none), `ResolutionMismatchDialog.tsx` 60 (none), `Preview/MarqueeSelection.tsx` 22 (none), `Timeline/ClipKeyframeDiamonds.tsx` 41 (none), `ProjectLoadDialog.tsx` 55 (none), plus the remaining gaps in `VideoUploader.tsx` (555; test exists, 59% lines) and `Export/ExportDialog.tsx` (495; test exists, 76%).
- [ ] Testing Library + user-event against the real store (`useEditorStore.setState` reset per test) and the existing doubles (canvas, resizeObserver, media, files). Cover interactions and state transitions: drag via pointer events + fake timers, keyboard, validation, every toolbar action's store effect, every shortcut's store effect, the keyframe graph's hit-testing and drag (assert store keyframes after the gesture), inline text editing commit/cancel, resolution picker presets/custom, dialogs' confirm/cancel, uploader accept/reject/progress paths, export dialog format/quality/timeRange and the `EXPORT_COMPLETE` post.
- [ ] Raise artist thresholds. Commit: `test(artist): cover the keyframe panel, toolbar, shortcuts, dialogs, uploader, and export dialog`.

## Task 6b: ARTIST ClipEditor, OverlayEditor, Timeline, App → ≥85% lines each
Files: `ClipEditor/ClipEditor.tsx` 1100 (none), `OverlayEditor/OverlayEditor.tsx` 1058 (none), `Timeline/Timeline.tsx` 1280 (test 365 lines, 35% covered), `App.tsx` 1013 (test exists, 31%).
- [ ] Same approach. ClipEditor: every section (transform, effects, audio, speed, transitions, keyframe toggles) writes the expected store patch. OverlayEditor: text and shape overlay creation/edit/delete, style controls, animation presets. Timeline: zoom/waveform branches, razor/ripple tools, multi-select, drag/trim/snap, markers, keyboard. App: message-handler branches (`GET_STATE`, `LOAD_PROJECT`, `suppressRestore`, `title`, `hostOrigin` filtering), session restore prompt, project load/save/new, error notifications, resolution mismatch flow. Split into several test files per component area where a file would exceed ~600 lines, sharing a `src/test/renderWithStore.tsx` helper.
- [ ] Raise artist thresholds. Commit: `test(artist): cover ClipEditor, OverlayEditor, Timeline, and App branches`.

## Task 7: ARTIST `PreviewPlayer.tsx` (1,606 lines, 19%) → ≥80% + a split proposal
- [ ] Test the render loop, seeking, play/pause, frame cache interaction, overlay hit-testing, transform handles (pointer sequences), keyboard shortcuts — via the canvas double. Report (do not perform) a decomposition proposal: which hooks/modules would fall out (e.g. `usePreviewRenderLoop`, `useTransformHandles`, `hitTest.ts`) with line counts; the operator decides separately.
- [ ] Raise artist thresholds; target artist overall lines ≥85. Commit: `test(artist): cover PreviewPlayer; propose its decomposition`.

## Task 8: ESCAPEPLAN and packages/shared → ≥95% lines each
After Task 0b's correction the real numbers are plan 52.9% and shared 27.8% of lines. Uncovered (lines): shared `src/theme/theme.ts` 79/79, `src/storage/index.ts` 46/46, `src/theme/ThemeToggle.tsx` 18/18, `src/bootstrap/index.tsx` 5/5, `src/index.ts` 4/4, `src/analytics/index.ts` 1/1; plan `src/utils/themeStorage.ts` 19/19, `src/lib/launch.ts` 5/9, `src/pages/Home.tsx` 4/6, `Legal/Privacy.tsx` 2/2, `Legal/Terms.tsx` 2/2, `src/App.tsx` 1/1.
- [ ] shared: `storage/index.ts` through real fake-indexeddb round trips (open/upgrade, every exported function, `getStorageEstimate` with and without `navigator.storage`, blob URL helpers); `theme/theme.ts` every branch (system preference via a `matchMedia` double, stored preference precedence, `data-theme` attribute writes, listeners added/removed); `ThemeToggle.tsx` with Testing Library (cycles, aria); `bootstrap/index.tsx` (renders the given root with providers — assert on DOM); barrel files by importing them and asserting the export surface.
- [ ] plan: `themeStorage.ts` every branch (localStorage present/absent/throwing); `launch.ts` all branches; `Home.tsx` and both Legal pages rendered through the router; `App.tsx` route table (each route renders its page; 404 fallback).
- [ ] Raise plan and shared thresholds to the achieved numbers (target ≥95/95/85/90 each). Commit: `test(plan,shared): cover theme, storage, bootstrap, pages, and lib`.

## Task 9: headless-artist gap closure, final ratchet, changeset, policy
- [ ] `services/headless-artist` (unit suite, 91.7% lines): close the remaining reachable gaps — `src/cli.ts` 20/169, `src/loaders.ts` 16/132, `src/sinks.ts` 10/98, `src/serve.ts` 9/182, `src/s3.ts` 3/51, `src/run.ts` 2/31, `src/jobSpec.ts` 1/67 — with real behaviour tests (CLI arg parsing/exit codes via the exported entry with a stubbed process, loader error branches on real temp files, sink error paths with recording HTTP/S3 doubles, serve edge cases). Lines that need real Chromium stay uncovered and are listed with line numbers. Target ≥95 lines.
- [ ] Investigate and eliminate the `act(...)` warnings that `PreviewPlayer.playback.test.tsx` emits when only `apps/artist/src/components/Preview` is run (clean in the full suite): a per-directory run must be as clean as the full run.
- [ ] Add a changeset (`.changeset/coverage-program-fixes.md`, `patch` for `@escapesuite/craft` and `@escapesuite/artist`; `@escapesuite/plan` is linked and bumps with them) listing every user-visible fix from this branch: craft — thumbnail-timeout blob URL leak, conversion hang on an already-aborted signal, encoders left open when a conversion aborts between passes, zero compositor padding honoured, screen/webcam capture not released after a take, microphone not released after a take, `Recorder.dispose` stopping nothing; artist — markers surviving a project reset, MP4 export swapping wipe-up/wipe-down (now matches preview), cancel during muxing ignored, Ctrl+B split dead and Ctrl+V changing the tool, side resize handles dragging both axes; and `@escapesuite/shared` if Task 8 fixed anything there.
- [ ] Re-run `pnpm test:coverage`; set every package's thresholds to the achieved numbers rounded down (only upward moves); sync `scripts/coverage-report.mjs`; add a coverage table (package × lines/branches/functions, dated) to `CLAUDE.md`'s coverage policy and update the "set at Task 0" wording to describe the program's outcome; update `apps/artist/CLAUDE.md` / `apps/craft/CLAUDE.md` testing sections to mention the doubles directories and fixtures.
- [ ] Commit: `test: close headless-artist gaps, ratchet coverage thresholds, changeset for the fixes`.

## Done criteria
- `pnpm test:coverage` enforces per-package thresholds; `pnpm coverage:report` prints the table locally and in the CI job summary.
- shared ≥95, plan ≥95, headless-artist ≥85 (unit) with the Chromium-only files documented, craft ≥90, artist ≥85 lines — with branches within 10 points of lines in each package.
- No app behaviour changed except separately-committed bug fixes with failing tests first.
