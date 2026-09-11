# PreviewPlayer decomposition (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `apps/artist/src/components/Preview/PreviewPlayer.tsx` (~3,100 lines; 92% line coverage since PR #327) into focused modules with **no behaviour change**, delete its 204 dead lines, and remove the ~420 lines that duplicate `apps/artist/src/core/canvasRenderer.ts` by making the preview draw through the same functions the exporter uses. The existing preview test suite (9 files, 229 tests, ordered canvas-call assertions) is the contract: every task must leave it passing **unchanged** except for import paths and for tests that move with the code they test.

**Source of the design:** the Task 7 report's decomposition proposal (archived; the table is reproduced below with current line ranges — re-derive ranges from the file before each task, they shift as earlier tasks land).

| Proposed module | Moves from (2026-09-10 lines) | ~Lines |
|---|---|---|
| dead twins — delete | `drawTextOverlay` 525–588, `drawShapeOverlay` 592–731 | 204 |
| `preview/previewDrawing.ts` → replaced by calls into `core/canvasRenderer.ts` | `blendModeToCanvas` 40–49 (byte-identical to `exportTypes.ts`), `drawClip` 423–521, `drawTextOverlayAnimated` 733–802, `drawShapeOverlayAnimated` 804–937, the legacy-array loops inside `drawFrame` 1150–1261 | ~510 |
| `preview/transitions.ts` | `getActiveTransition` 65–120 + `drawFrame`'s transition switch 1051–1147 (identical to `canvasRenderer.drawTransition`) | ~150 |
| `preview/previewGeometry.ts` (pure) | `getOverlayBounds` 1266–1398, `getCanvasPosition` 1575–1614, `isManipulableClip`, `getClipType`, `hasCustomKeyframes` 1400–1435 | ~215 |
| `preview/hitTest.ts` (pure) | `hitTestHandles` 1616–1804 | 189 |
| `preview/selectionOverlay.ts` (pure) | `drawSelectionHandles` 1437–1531, `drawMultiSelectHandles` 1533–1573 | 136 |
| `preview/usePreviewMedia.ts` | blob→URL load effect 232–320, element effects 322–408 | 187 |
| `preview/usePreviewRenderLoop.ts` | playback effect + `animate` 2594–2898, scrub/seek-settle 2464–2592, debounced redraw 2450–2462 | ~447 |
| `preview/useTransformHandles.ts` | `handleMouseDown/Move/Up/Leave` 1806–2320, window listener effect 2323–2345, cursor helpers 2414–2447 | ~570 |
| `preview/InlineTextEditorAnchor.tsx` | the anchoring IIFE in the JSX 2931–2995 | 85 |
| `PreviewPlayer.tsx` residue | refs, store selectors, composition, JSX | ~250 |

**Known differences to preserve or reconcile (decide per task, record in the ledger):**
- The preview's shape blur reuses one `<canvas>` (`blurCanvasRef`); the exporter allocates an `OffscreenCanvas` per frame. Reconcile by giving `drawShapeOverlayToCanvasAnimated` an optional scratch-canvas parameter (default: allocate), so the preview keeps its reuse and the exporter is unchanged.
- The preview uses `getAnimatedValues`; the exporter uses `getAnimatedValuesCached`. Both are pure over the same inputs; the preview may switch to the cached variant only if the preview tests still pass unchanged AND `clearAnimationCache()` is called where the preview invalidates (playhead/edit) — otherwise keep `getAnimatedValues` via a parameter.
- Rotation is measured in normalised (aspect-distorted) canvas space (documented smell). **Do not fix in this plan**; move the code as is and keep the test that pins it.

**Global constraints**
- No behaviour change. The preview tests are not edited except import paths and moving a test to the file that now owns its subject. Any assertion change is a finding, not a fix.
- Each extracted pure module gets its own unit test file (moved cases plus direct tests of the exported functions); coverage of `apps/artist` must not drop below the current floors (97/96/87/98); raise them if the numbers rise.
- No new dependencies. No `any`. Files ≤ ~600 lines.
- `canvasRenderer.ts` changes are additive (an optional parameter, an exported helper); the exporter tests (`exportMP4/WebM`, `canvasRenderer.*`) must pass unchanged.
- Per-task: `pnpm --filter @escapesuite/artist test:coverage`, lint, `typecheck`; `pnpm build:artist` once at the end. The headless bundle (`src/headless/`) does not import the preview, so the exporter tests are its gate; `canvasRenderer.ts` changes (Task 3) are additive and covered by `canvasRenderer.*.test.ts` and `exportMP4/WebM.test.ts`.

## Task 1: Delete the dead twins and the duplicated blend map
- [ ] Delete `drawTextOverlay`/`drawShapeOverlay` (confirm zero references); replace the local `blendModeToCanvas` with the export from `core/exportTypes.ts`. Preview tests unchanged. Commit: `refactor(artist): drop PreviewPlayer's dead overlay drawers and duplicated blend map`.

## Task 2: Pure geometry, hit-testing, selection overlay
- [ ] Extract `previewGeometry.ts`, `hitTest.ts`, `selectionOverlay.ts` as pure functions taking explicit inputs (no refs, no store). Move the matching describes out of `PreviewPlayer.selection.test.tsx`/`transform.test.tsx` only where they test the function directly; add direct unit tests for each export. Commit: `refactor(artist): extract preview geometry, hit-testing, and selection drawing`.

## Task 3: Draw through `core/canvasRenderer.ts`
- [ ] Add the optional scratch-canvas parameter to `drawShapeOverlayToCanvasAnimated`; make the preview's clip/overlay/transition drawing call `drawClipToCanvas`/`drawImageToCanvasWithModifiers`/`drawTextOverlayToCanvasAnimated`/`drawShapeOverlayToCanvasAnimated`/`drawTransition`. Extract `transitions.ts` for `getActiveTransition`. Delete the preview's copies. Preview AND exporter tests unchanged. Commit: `refactor(artist): render the preview with the exporter's canvas renderer`.

## Task 4: Hooks
- [ ] `usePreviewMedia` (media elements + object URLs, cleanup on unmount), `usePreviewRenderLoop` (rAF loop, scrub settle, debounced redraw), `useTransformHandles` (mouse state machine + cursor). Each hook gets a `renderHook` test for lifecycle (listeners added/removed, URLs revoked, loop cancelled on unmount) in addition to the unchanged component tests. Commit: `refactor(artist): move PreviewPlayer's media, render loop, and transform handling into hooks`.

## Task 5: Anchor component, residue, docs, floors
- [ ] `InlineTextEditorAnchor.tsx`; confirm `PreviewPlayer.tsx` is ≤ ~400 lines; update `apps/artist/CLAUDE.md` (Transform Controls section now names the modules); re-measure coverage and raise floors; run `pnpm build:artist`. Commit: `refactor(artist): finish the PreviewPlayer decomposition; document the modules`.

## Done criteria
- `PreviewPlayer.tsx` ≤ ~400 lines; no function duplicated between preview and exporter; 204 dead lines gone.
- All 229 preview tests pass unchanged (imports aside); exporter and canvasRenderer tests unchanged; artist coverage ≥ current floors; lint/typecheck clean; artist build green.
