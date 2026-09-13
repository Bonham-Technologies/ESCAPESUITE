# Timeline decomposition (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `apps/artist/src/components/Timeline/Timeline.tsx` (1,274 lines: ~430 lines of JSX from line 843, and one component holding ruler rendering, click/seek handling, scroll sync, clip drag + razor, trim, track operations, and marquee selection) into focused modules with **no behaviour change**, the way `PreviewPlayer` was split (#331). The contract is the existing Timeline test suite (`Timeline.test.tsx`, `Timeline.editing.test.tsx`, `Timeline.chrome.test.tsx`, `TimelinePlayhead`/`TimelineTimeReadout`/`ClipKeyframeDiamonds`/`AudioWaveform` tests — ~150 tests) passing **byte-unchanged** except import paths and tests moved verbatim with the code they test. Each task's reviewer diffs every moved block against the original.

**Current structure (2026-09-13 lines):** imports `useVirtualizedTimeline`, `groupClipsByTrack`, `timeToPixels`/`pixelsToTime`, `formatTime`; 4 `useState`, 6 `useRef`, 6 effects; handlers: `getTrackClips` 124, `renderRuler` 133–154, `renderMarkers` 157–175, `renderMarkerLines` 178–189, `handleRulerClick` 192, `handleTrackClick` 210–251, `handlePlayheadMouseDown` 248, `handleTrackScroll` 314, `handleHeadersScroll` 330, `handleRazorClick` 356, `handleClipMouseDown` 383–524 (clip drag + snap + multi-select move, with document listeners), `handleTrimMouseDown` 527–654, track ops 663–736 (`moveTrackUp/Down`, `handleDeleteTrack`, `handleMuteToggle`, rename handlers), `handleTrackMouseDown` 742–841 (marquee). Re-derive ranges before each task.

**Global constraints**
- No behaviour change. Timeline tests not edited except import paths / verbatim moves. Any assertion change is a finding, not a fix.
- Each extracted pure module or hook gets its own unit test file (moved cases + direct tests). Artist coverage floors (99/98/89/98) hold; statements has ~1 line of headroom — cover any new branch you introduce (e.g. a hook's cleanup) so the floor does not trip.
- No new state; refs stay refs; effect order and deps arrays preserved (a hook's effects keep their relative order); document listener add/remove paths identical.
- The per-frame/tick discipline from the performance pass stays: no new store subscriptions to `currentTime` in the Timeline body (the playhead/readout components own that); handlers read the playhead on demand.
- Files ≤ ~600 lines. Lint 0, typecheck clean, `pnpm --filter @escapesuite/artist test:coverage` green per task.

## Task 1: Pure timeline geometry and ruler
- [ ] Extract `timeline/timelineGeometry.ts` (pure): snap-point computation (`getSnapPoints`), clip-at-position helpers, marquee-to-time-range maths, ruler tick maths, anything in the handlers that is a pure function of (clips, tracks, pixelsPerSecond, scroll). Extract `TimelineRuler.tsx` (`renderRuler`, `renderMarkers`, `renderMarkerLines` → one component taking explicit props: duration, pixelsPerSecond, markers, scroll offset, click handlers). Direct unit tests for the geometry; the ruler's rendering assertions stay in the component tests. Commit: `refactor(artist): extract timeline geometry and the ruler component`.

## Task 2: Track header and track row components
- [ ] `TrackHeader.tsx`: the per-track header (name editing, mute, move up/down, delete) with the six track-ops handlers moved in as its own callbacks (props: track, index, count, actions). `TimelineTrack.tsx`: one track row rendering its clips (`AudioWaveform`, `ClipKeyframeDiamonds`, selection state) given clips + handlers as props; `getTrackClips`/`groupClipsByTrack` usage stays with the caller. Existing tests unchanged (they query the DOM, which must be identical — same class names, `data-*` attributes, order). Commit: `refactor(artist): track header and track row components`.

## Task 3: Interaction hooks
- [ ] `useClipDrag.ts` (handleClipMouseDown + razor branch + snap + multi-select move + the document mousemove/mouseup listeners and drag state), `useTrimDrag.ts` (handleTrimMouseDown + its listeners), `useTimelineMarquee.ts` (handleTrackMouseDown + marquee state + `MarqueeSelection` props), `useScrollSync.ts` (track/headers scroll mirroring + `setContainerWidth`). Each hook takes explicit inputs, returns handlers + state for the JSX; `renderHook` lifecycle tests (listeners added on mousedown, removed on mouseup and on unmount; state reset). Commit: `refactor(artist): move timeline drag, trim, marquee, and scroll handling into hooks`.

## Task 4: Residue, docs, floors
- [ ] `Timeline.tsx` ≤ ~350 lines (selectors, composition, JSX). `apps/artist/CLAUDE.md` gains a `### Timeline (src/components/Timeline/)` section naming each module. Re-measure coverage; raise floors if numbers rose. `pnpm build:artist`. Commit: `refactor(artist): finish the Timeline decomposition; document the modules`.

## Done criteria
- `Timeline.tsx` ≤ ~350 lines; ~150 existing Timeline tests pass unchanged (imports aside); every new module/hook has direct tests; floors hold; lint/typecheck/build green; no behaviour change (reviewers diffed each moved block).
