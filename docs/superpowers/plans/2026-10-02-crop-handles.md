# ESCSUITE-157 — Crop v2: on-canvas crop handles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a **crop mode** on the selected media clip in ESCAPEARTIST's preview. The clip's full source is drawn dimmed, the kept region bright, and eight handles on the kept region's edges and corners drag it. A drag writes `clip.crop` through the same decision the inspector's `handleCropChange` makes — so `normaliseCrop`'s clamps and floors, the locked-track refusal and "one gesture, one undo entry" hold unchanged — plus the compensating centre that keeps the edges the drag is not touching still on screen. The handles are real focusable buttons: eight distinct names, arrow keys nudging one source pixel, Shift+arrow ten, every landed nudge announced. Escape leaves the mode, and so does changing the selection.

**Architecture:** four new modules and no new stored shape. `ClipCrop` is exactly what ESCSUITE-6 defined, `MAX_CROP_INSET` is still 0.9, and v1's four pure functions keep their behaviour to the letter.

1. **The arithmetic** — `src/core/cropDrag.ts`, pure: which insets each handle owns (`CROP_HANDLES`, `CROP_HANDLE_LABELS`), a pointer displacement turned into source pixels in the clip's own unrotated frame (`sourceDelta`, the same `R(-θ)` as `previewGeometry.ts`'s `toLocalPoint`), the insets a handle's move produces with the opposite edge pinned and the aspect optionally held (`cropForHandleMove`), the region's aspect at the press (`cropRegionAspect`), the compensating centre (`cropCentreFor`) and whether the clip's placement allows one at all (`cropCompensatesCentre`), the whole update a write hands `updateClip` (`cropWriteFor`), the "did anything change" test (`cropsEqual`) and the live region's words (`cropAnnouncement`).
2. **The write decision** — one new export on the existing `src/core/clipCrop.ts`: `cropUpdateFor(crop, source)`, which is the body of v1's `handleCropChange` lifted out of the inspector so the canvas cannot drift from it. `handleCropChange` becomes two lines over it; its seven existing tests are the proof that nothing moved.
3. **The chrome** — `src/components/Preview/cropOverlay.ts`: `cropTarget` (the one definition of "crop mode is on": the latch names the selected clip, the clip and its source exist, nothing is playing), `fullSourceBox` / `cropFrameBox` (the geometry, in project pixels and in CSS pixels), and `drawCropOverlay`, which runs where `drawSelectionHandles` runs — **never per frame** — and dims everything outside the kept rectangle with one `drawImage` under an evenodd clip.
4. **The handles** — `src/components/Preview/CropHandles.tsx` and `useCropHandleGesture.ts`: a DOM layer inside `.videoWrapper` beside `MarqueeSelection` and `InlineTextEditorAnchor`, positioned through `contentBox` exactly as the inline text editor is, rotated by one CSS `rotate()`, with the pointer drag and the keyboard nudges in a hook of its own over `hooks/useGestureHistory.ts`.

Crop mode itself is **one latch** in `src/store/uiSlice.ts` — `cropClipId: string | null` — and every reader requires `cropClipId === selectedClipId`, so a selection change, a delete, a project load and an undo all leave crop mode with no synchronisation, no effect and no cross-slice write. `PreviewPlayer.tsx` grows the branch that draws the crop chrome instead of the transform chrome, the gate that unbinds the canvas' own pointer handlers (the one the inline text editor already uses), and the mount of the DOM layer. `useTransformHandles.ts` is **not touched at all**.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (ten slices, `src/store/projectStore.ts` the only entry point), Vitest + Testing Library (jsdom) with `src/test/doubles/*`, `src/test/fixtures/*` and `src/test/renderPreview.tsx`, changesets for release notes.

**Spec:** `docs/superpowers/specs/2026-10-02-crop-handles-design.md` — the binding authority. Read it before Task 1. Two places where the spec's prose needs a line drawn, resolved here and binding on the implementer:

- The spec says a drag writes "through the same `handleCropChange` path". `handleCropChange` is a member of `useClipEditorActions()`, a hook the preview cannot call (it holds the inspector's own slider gesture). "The same path" therefore means **the same decision**: `cropUpdateFor` is extracted in Task 1 and both callers use it, each with its own gesture history. The store action is the same one (`updateClip`), so the locked-track refusal and the history push are literally shared.
- The spec says the handles behave in screen pixels the way ESCSUITE-90 made the selection chrome behave. They are **DOM buttons**, which *is* that property rather than an approximation of it: a handle is a 12 CSS-pixel square whatever the project's resolution, with no `screenScale` multiplication and no second copy of the hit-zone arithmetic. `hitTest.ts` and `useTransformHandles.ts` gain nothing and lose nothing, and while the handles are up the canvas is not listening — so a pointer over a handle reaching only the button is intended, not a gap (operator ruling, 2026-10-02).

**Out of scope (do not build any of it here):**
- Any change to `ClipCrop`, `MAX_CROP_INSET`, `croppedSourceRect`, `isValidCrop`, `normaliseCrop` or `cropForAspect`. Task 1 **adds** one function to `core/clipCrop.ts` and edits none of the existing five.
- Animating the crop. `crop` never joins `AnimatableProperty`.
- Cropping overlays, and cropping the timeline thumbnail (`utils/maskClipPath.ts` stays untouched — still a documented limit).
- Rule-of-thirds guides, an on-canvas numeric readout, a crop toolbar, a crop cursor that rotates with the clip.
- Fixing ESCSUITE-147's gap (chrome drawn without the transition's preset suppression). The crop chrome reads `getOverlayBounds` and inherits it; Task 6 documents that.
- Any change to `hitTest.ts`, `selectionOverlay.ts`, `dragGeometry.ts`, `useTransformHandles.ts`, `drawFrame.ts` or `core/canvasRenderer.ts`.

---

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the exact failure text pasted into the step notes, before the implementation step. The steps below are ordered that way; do not reorder them. Task 1's `handleCropChange` refactor is the one exception, and it says so: a pure extraction has no behaviour to make red, and its proof is that the seven existing cases stay green.
2. **No coverage runs.** Do **not** run `pnpm test:coverage` or `turbo test:coverage`, and do **not** edit the coverage table or the coverage paragraphs in the root `CLAUDE.md`, `apps/artist/vite.config.ts`'s `thresholds` block, or `scripts/coverage-report.mjs`. The coordinator measures and writes that paragraph. Artist's floors are **99 / 99 / 95 / 99** (lines/statements/branches/functions, verified in `apps/artist/vite.config.ts` at `2cae295`); they only ever go up, which is why constraint 4 matters.
3. **No Playwright, no pushes, no subagents.** Do not run `pnpm test:e2e`, do not install browsers, do not push, do not open a PR, do not dispatch subagents.
4. **Every new conditional is reached from both sides by a test, or it is deleted.** The precedent is ESCSUITE-110, which deleted two defensive operands rather than inventing tests for them, and ESCSUITE-118, which deleted a guard that a new one had made unreachable. Every `if`, every `||`/`&&`/`??` operand and every ternary this plan adds has its two cases named in the task that adds it.
5. **The per-frame ceiling files and the rerender pins stay byte-identical.** `apps/artist/src/components/Preview/drawFrame.perf.test.ts`, `apps/artist/src/core/exportMP4.perf.test.ts`, `apps/artist/src/core/exportWebM.perf.test.ts`, `apps/artist/src/components/Timeline/timelineGestures.perf.test.ts`, `apps/artist/src/App.rerender.test.tsx`, `apps/artist/src/components/ClipEditor/ClipEditor.rerender.test.tsx` and `apps/artist/src/components/Toolbar/Toolbar.rerender.test.tsx` must not change by one byte, and neither may `src/test/fixtures/perfScene.ts`. This is achievable because nothing is added to `drawPreviewFrame` or to either exporter, and because the one new inspector subscription (`cropClipId`) is a scalar that cannot change on a playback tick. Tasks 2, 3 and 4 each verify it with `git diff --name-only`.
6. **No new `*.perf.test.ts` file.** The crop chrome is not a per-frame path — it is drawn where `drawSelectionHandles` is drawn and returns early while `isPlaying` — so a per-frame ceiling would be measuring something that does not run per frame. The conservation laws live in `cropOverlay.test.ts` instead (Task 3) and are asserted **exactly**: zero context calls when crop mode is off, and when it is on, one `drawImage`, one `clip`, one `translate`, one `rotate`, and `save` balanced with `restore`.
7. **`cropClipId` is a latch, never a synchronised copy.** Nothing clears it on a selection change, a clip removal, a project load or an undo. Every reader goes through `cropTarget`, which requires `cropClipId === selectedClipId`. Do not add an effect, a `setSelectedClipId` edit, or a `pruneSelection` clause.
8. **The crop gesture makes ONE store write per move:** `updateClip(clipId, { crop, transform })`. Not two actions. `updateClip` merges a `Partial<Clip>` and `transform` is handed over whole, built from the transform the gesture *started* with — so one history push, one locked-track check, and no compounding from the previous move of the same drag (the ESCSUITE-110 lesson). One undo entry per gesture, through `hooks/useGestureHistory.ts`. This is **the shape the resize handles already use** — `useTransformHandles.ts`'s west and north drags write `x`/`y` beside the scale for exactly the same reason — not a new rule (operator ruling, 2026-10-02).
9. **…except on a clip whose placement is keyframed, where the write is the crop ALONE.** If the clip carries custom keyframes on `x`, `y`, `scaleX` or `scaleY`, no `transform` goes with the crop: a static centre written onto an animated placement fights its keyframes, and the keyframes win at playback regardless (operator ruling, 2026-10-02). The decision is `cropDrag.ts`'s `cropCompensatesCentre(animation)` and `cropWriteFor(..., compensate)` is what acts on it — **one** branch, in one pure function, with a red case on each side. The accepted consequence, which Task 6 documents: on such a clip the picture shrinks about its centre as it is cropped while the handles keep following `getOverlayBounds`' animated box.
10. **The handles are DOM buttons over the canvas, and the canvas does not listen while they are up.** `useTransformHandles.ts` and `hitTest.ts` are untouched (operator ruling, 2026-10-02): a pointer over a handle is that button's event, there is no canvas hit test to race, and in crop mode the canvas' own mouse handlers are unbound. Screen-pixel sizing, accessible names, focus and `disabled` all come from the DOM rather than from a second copy of the chrome's arithmetic.
11. **Insets stay fractions of the source frame.** The gesture computes in source pixels and divides; nothing stores a pixel count. Same rule `ClipMask.radius` and `ClipStroke.width` follow.
12. **`DB_VERSION` stays 1 and no migration line is added.** Nothing persisted changes. `cropClipId` is view state and is not written to a `.veditor`, a session snapshot or the undo history.
13. **Type-only declarations go in `src/store/types.ts`** (excluded from the coverage `include`), runtime constants and functions in the measured modules.
14. **No existing test may be deleted or weakened.** Task 1's extraction keeps all seven `handleCropChange` cases exactly as they are. Task 2 adds to `CropSection.test.tsx`; if an existing case there addresses a button positionally, make its query explicit rather than changing what it asserts.
15. **Update `apps/artist/CLAUDE.md`** where the behaviour is documented (Task 6). The root `CLAUDE.md` gets **one clause** extended — nowhere near the coverage section.
16. **Changeset:** `.changeset/escsuite-157-crop-handles.md`, `'@escapesuite/artist': minor`, a headline line then one paragraph in the user's words. Task 6.
17. **Typecheck and lint every task:** `pnpm --filter @escapesuite/artist typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/artist lint`.
18. **Run the whole artist suite at the end of every task**, not just the files you touched: `pnpm --filter @escapesuite/artist exec vitest run`.
19. **Every line number in this plan was verified against the worktree at `2cae295`.** Line numbers drift as you edit; after Task 2, locate code by the quoted text rather than by line.
20. **Branch:** `feat/escsuite-157-crop-handles` in the worktree `/Users/littlemac/Projects/ESCAPESUITE-e157`. Never touch `/Users/littlemac/Projects/ESCAPESUITE` or any other worktree. Run `pnpm install --offline` first if `node_modules` is missing.
21. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/core/cropDrag.ts` | The crop *gesture's* arithmetic: the eight handles and their names, which insets each owns, a pointer displacement in the clip's own frame, the insets a move produces, the aspect lock, the compensating centre, whether a clip's placement allows one, the whole update a write hands `updateClip`, the equality test and the announcement |
| `apps/artist/src/core/cropDrag.test.ts` | That arithmetic directly — no clip, no store, no DOM |
| `apps/artist/src/components/Preview/cropOverlay.ts` | `cropTarget` (is crop mode on, and on what), `fullSourceBox`, `cropFrameBox`, `CROP_HANDLE_MODES` and `drawCropOverlay` (the dim pass and the kept rectangle's edge) |
| `apps/artist/src/components/Preview/cropOverlay.test.ts` | Those, against a recording canvas, plus the conservation laws of one chrome paint |
| `apps/artist/src/components/Preview/useCropHandleGesture.ts` | One handle's pointer drag and keyboard nudges: the gesture history, the rAF throttle, the one store write, the live region's text |
| `apps/artist/src/components/Preview/CropHandles.tsx` | The DOM layer: the rotated frame, eight named buttons, the live region |
| `apps/artist/src/components/Preview/CropHandles.module.css` | The frame, the eight handle positions, the disabled state, the visually-hidden live region |
| `apps/artist/src/components/Preview/CropHandles.test.tsx` | The layer rendered over a canvas with a layout box: positions, the drag, the undo count, the lock, the nudges, the announcement, Escape, the mid-drag unmount |
| `apps/artist/src/components/Preview/PreviewPlayer.crop.test.tsx` | Crop mode through the real component: the chrome branch, the unbound canvas handlers, the mount and the four ways crop mode is off |
| `.changeset/escsuite-157-crop-handles.md` | `@escapesuite/artist: minor` |

**Modified**

| File | Change |
|---|---|
| `apps/artist/src/core/clipCrop.ts` | `cropUpdateFor` — the inspector's write decision, lifted so the canvas shares it |
| `apps/artist/src/core/clipCrop.test.ts` | Five cases for it |
| `apps/artist/src/components/ClipEditor/useClipEditorActions.ts` | `handleCropChange` reduced to `cropUpdateFor`; `cropOnCanvas` + `handleCropOnCanvasToggle` |
| `apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts` | Two cases for the toggle (the seven crop cases are untouched) |
| `apps/artist/src/components/ClipEditor/CropSection.tsx` | The "Crop on canvas" toggle in `headerRight` |
| `apps/artist/src/components/ClipEditor/CropSection.test.tsx` | Three cases for it |
| `apps/artist/src/components/ClipEditor/ClipEditor.tsx` | Two more props on `<CropSection>` |
| `apps/artist/src/store/types.ts` | `cropClipId` and `setCropClipId` on `EditorState` |
| `apps/artist/src/store/uiSlice.ts` | Both, in the `UiSlice` Pick and the creator |
| `apps/artist/src/store/projectStore.test.ts` | Four cases for the latch |
| `apps/artist/src/test/fixtures/projectStore.ts` | `cropClipId: null` in `resetStoreForTest`, and its doc comment |
| `apps/artist/src/app/useAppKeyboardShortcuts.ts` | `cropClipId` / `setCropClipId` deps and the Escape cascade's new second branch |
| `apps/artist/src/app/useAppKeyboardShortcuts.test.ts` | Two cases, in the existing "Escape cascade, in order" block |
| `apps/artist/src/App.tsx` | Passes the two new deps |
| `apps/artist/src/components/Preview/PreviewPlayer.tsx` | The crop branch in the chrome callback, the pointer gate, the `<CropHandles>` mount |
| `apps/artist/CLAUDE.md`, `CLAUDE.md` | Documentation (Task 6) |

---

### Task 1: the crop gesture's arithmetic, and one shared write decision

**Files:**
- Create: `apps/artist/src/core/cropDrag.test.ts`
- Create: `apps/artist/src/core/cropDrag.ts`
- Modify: `apps/artist/src/core/clipCrop.ts` (one new export at the end)
- Modify: `apps/artist/src/core/clipCrop.test.ts` (one new `describe`)
- Modify: `apps/artist/src/components/ClipEditor/useClipEditorActions.ts` (`handleCropChange`'s body only)

**Interfaces:**
- Consumes: `ClipCrop`, `ClipAnimation`, `ClipTransform` (`store/types.ts`), `croppedSourceRect` and `normaliseCrop` (`core/clipCrop.ts`).
- Produces, in `apps/artist/src/core/clipCrop.ts`:
  ```ts
  export function cropUpdateFor(
    crop: ClipCrop,
    source: { width: number; height: number } | undefined
  ): { crop: ClipCrop | undefined } | null;
  ```
- Produces, in `apps/artist/src/core/cropDrag.ts`:
  ```ts
  export type CropHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
  export const CROP_HANDLES: readonly CropHandle[];
  export const CROP_HANDLE_LABELS: Record<CropHandle, string>;
  export const CROP_NUDGE: { readonly fine: number; readonly coarse: number };
  export const NO_CROP_INSETS: ClipCrop;
  export interface SourceSize { width: number; height: number }
  export interface CropGestureTransform { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
  export function sourceDelta(delta: { x: number; y: number }, transform: Pick<CropGestureTransform, 'scaleX' | 'scaleY' | 'rotation'>): { x: number; y: number };
  export function cropForHandleMove(start: ClipCrop | undefined, handle: CropHandle, delta: { x: number; y: number }, source: SourceSize, keepAspect?: number): ClipCrop;
  export function cropRegionAspect(crop: ClipCrop | undefined, source: SourceSize): number;
  export function cropCentreFor(start: { crop: ClipCrop | undefined; transform: CropGestureTransform }, next: ClipCrop, source: SourceSize, project: { width: number; height: number }): { x: number; y: number };
  export function cropCompensatesCentre(animation: ClipAnimation | undefined): boolean;
  export function cropWriteFor(start: { crop: ClipCrop | undefined; transform: ClipTransform }, next: ClipCrop | undefined, source: SourceSize, project: { width: number; height: number }, compensate: boolean): { crop: ClipCrop | undefined; transform?: ClipTransform };
  export function cropsEqual(a: ClipCrop | undefined, b: ClipCrop | undefined): boolean;
  export function cropAnnouncement(handle: CropHandle, crop: ClipCrop | undefined, source: SourceSize): string;
  ```

**What this task pins:**

- **The opposite inset is never written.** A handle owns one inset per axis and the move adds to it; pinning the opposite edge is therefore not a rule the gesture applies but a property of the data it touches. The clamp also lands on the inset that moved, so a handle dragged past the far edge stops without dragging the far edge with it.
- **A drag is computed from the gesture's start, every move.** `cropForHandleMove` takes the crop the gesture began with, not the clip's current one. Rebasing each move from the previous move's output is what ESCSUITE-110 found compounding a trim; the same trap is here.
- **Two floors, and the stricter wins.** `cropForHandleMove` keeps one source pixel on each axis, which is `croppedSourceRect`'s own floor expressed as an inset; `normaliseCrop` then clamps to `MAX_CROP_INSET` and refuses what is left of the impossible. Neither replaces the other: the first keeps the handle from asking for something absurd, the second is the store's rule and is unchanged.
- **The compensating centre is arithmetic, not policy.** `cropCentreFor` says how far the kept region's centre moved *within the source* and carries that displacement out through the clip's scale and rotation. It knows nothing about handles.
- **Whether to compensate at all is one question, asked in one place.** `cropCompensatesCentre` is false for a clip carrying custom keyframes on `x`, `y`, `scaleX` or `scaleY`, and `cropWriteFor` is the only thing that reads it: with the compensation it returns `{ crop, transform }`, without it `{ crop }` and nothing else (operator ruling, 2026-10-02). Rotation, opacity and blur keyframes do **not** turn it off — the compensation still uses the clip's static rotation there, which is the same family of inexactness one step smaller, and is named in the docs rather than branched on.
- **`cropUpdateFor` is v1's decision moved, not changed.** The no-source arm, the all-zero arm, the clamp and the refusal come across verbatim; the seven existing `handleCropChange` cases are the regression test and must not be edited.
- **`cropsEqual` is why a nudge that cannot move costs nothing.** ArrowUp on the left handle, or ArrowLeft on a handle already at the frame's edge, produces the crop the clip already has — and a write of that would spend an undo entry on a change of nothing.

- [ ] **Step 1: Write the failing test file** — create `apps/artist/src/core/cropDrag.test.ts`

```ts
// The crop GESTURE's arithmetic, on its own (ESCSUITE-157).
//
// Everything here is numbers over a source frame: no clip, no store, no canvas,
// no pointer. The hook that drives it (`components/Preview/useCropHandleGesture.ts`)
// has its own tests for the writing and the announcing; the numbers live here.
//
// The frame throughout is 400 x 200 — a 2:1 picture, so an aspect lock has
// something to do — drawn at scale 1 into a 1920 x 1080 project unless a case
// says otherwise.
import { describe, it, expect } from 'vitest'
import {
  CROP_HANDLES,
  CROP_HANDLE_LABELS,
  CROP_NUDGE,
  cropAnnouncement,
  cropCentreFor,
  cropCompensatesCentre,
  cropForHandleMove,
  cropRegionAspect,
  cropWriteFor,
  cropsEqual,
  sourceDelta,
  type CropGestureTransform,
} from './cropDrag'
import { makeAnimation } from '../test/fixtures/clipFixtures'
import type { ClipCrop, ClipTransform } from '../store/types'

const SOURCE = { width: 400, height: 200 }
const PROJECT = { width: 1920, height: 1080 }

const crop = (overrides: Partial<ClipCrop> = {}): ClipCrop => ({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  ...overrides,
})

const transform = (overrides: Partial<CropGestureTransform> = {}): CropGestureTransform => ({
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  ...overrides,
})

describe('the handle table', () => {
  it('has eight handles, each with a name of its own', () => {
    expect(CROP_HANDLES).toHaveLength(8)
    const names = CROP_HANDLES.map((handle) => CROP_HANDLE_LABELS[handle])
    expect(new Set(names).size).toBe(8)
  })

  it('nudges one source pixel, or ten with Shift', () => {
    expect(CROP_NUDGE).toEqual({ fine: 1, coarse: 10 })
  })
})

describe('sourceDelta', () => {
  it('is the displacement itself for an unrotated clip at scale 1', () => {
    expect(sourceDelta({ x: 40, y: -10 }, transform())).toEqual({ x: 40, y: -10 })
  })

  it('divides by the clip\'s scale — a 2x clip crops half as fast as the pointer moves', () => {
    expect(sourceDelta({ x: 40, y: 20 }, transform({ scaleX: 2, scaleY: 4 }))).toEqual({
      x: 20,
      y: 5,
    })
  })

  it('un-rotates: dragging DOWN a clip rotated 90° moves along its own x axis', () => {
    // The canvas rotates the clip, so the clip's local +x points down the
    // screen. The same R(-θ) `previewGeometry.ts`'s `toLocalPoint` applies.
    const local = sourceDelta({ x: 0, y: 40 }, transform({ rotation: 90 }))

    expect(local.x).toBeCloseTo(40)
    expect(local.y).toBeCloseTo(0)
  })
})

describe('cropForHandleMove', () => {
  it('turns a rightward drag of the left handle into a left inset', () => {
    expect(cropForHandleMove(undefined, 'w', { x: 100, y: 0 }, SOURCE)).toEqual(
      crop({ left: 0.25 })
    )
  })

  it('reads the right handle the other way round — leftward crops the right', () => {
    expect(cropForHandleMove(undefined, 'e', { x: -100, y: 0 }, SOURCE)).toEqual(
      crop({ right: 0.25 })
    )
  })

  it('moves two insets for a corner, and only those two', () => {
    expect(cropForHandleMove(undefined, 'se', { x: -100, y: -50 }, SOURCE)).toEqual(
      crop({ right: 0.25, bottom: 0.25 })
    )
  })

  it('leaves the other three edges exactly as the gesture found them', () => {
    const start = crop({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 })

    expect(cropForHandleMove(start, 'n', { x: 999, y: 20 }, SOURCE)).toEqual({
      ...start,
      top: 0.3,
    })
  })

  it('stops at the edge it started from rather than going negative', () => {
    expect(cropForHandleMove(undefined, 'w', { x: -100, y: 0 }, SOURCE)).toEqual(crop())
  })

  it('keeps one source pixel, and keeps it by clamping the inset that MOVED', () => {
    // 90% is already off the right, so the left can take at most
    // 1 - 1/400 - 0.9 = 0.0975 before the region has no pixel in it. The right
    // inset is the pinned edge and does not move to make room.
    const start = crop({ right: 0.9 })

    expect(cropForHandleMove(start, 'w', { x: 400, y: 0 }, SOURCE)).toEqual({
      ...start,
      left: 1 - 1 / 400 - 0.9,
    })
  })

  describe('with Shift holding the aspect', () => {
    it('derives the height from the width for a side handle, about the region\'s centre', () => {
      // 50% off the right leaves 200x200 at (0,0); held at 2:1 that is 200x100,
      // centred on the region's own centre (100, 100) — so 25% comes off the top
      // and 25% off the bottom.
      expect(cropForHandleMove(undefined, 'e', { x: -200, y: 0 }, SOURCE, 2)).toEqual({
        left: 0,
        top: 0.25,
        right: 0.5,
        bottom: 0.25,
      })
    })

    it('absorbs a corner\'s dependent axis into the edge the corner owns', () => {
      // 25% off the left leaves 300x200 at (100,0); held at 3:1 that is 300x100,
      // and the handle is the NW one — so the BOTTOM stays where it was and the
      // whole 100px comes off the top.
      expect(cropForHandleMove(undefined, 'nw', { x: 100, y: 0 }, SOURCE, 3)).toEqual({
        left: 0.25,
        top: 0.5,
        right: 0,
        bottom: 0,
      })
    })

    it('absorbs it into the BOTTOM for a bottom corner, pinning the top', () => {
      // The mirror of the case above, and the reason the corner arm is written
      // out per edge rather than behind a computed key.
      expect(cropForHandleMove(undefined, 'sw', { x: 100, y: 0 }, SOURCE, 3)).toEqual({
        left: 0.25,
        top: 0,
        right: 0,
        bottom: 0.5,
      })
    })

    it('derives the width from the height for a top or bottom handle', () => {
      // 50% off the top leaves 400x100 at (0,100); held at 1:1 that is 100x100,
      // centred on the region's centre (200, 150) — 150px off each side.
      expect(cropForHandleMove(undefined, 'n', { x: 0, y: 100 }, SOURCE, 1)).toEqual({
        left: 0.375,
        top: 0.5,
        right: 0.375,
        bottom: 0,
      })
    })

    it('leaves a region that already has the aspect alone', () => {
      expect(cropForHandleMove(undefined, 'e', { x: 0, y: 0 }, SOURCE, 2)).toEqual(crop())
    })
  })
})

describe('cropRegionAspect', () => {
  it('is the frame\'s own aspect with no crop', () => {
    expect(cropRegionAspect(undefined, SOURCE)).toBe(2)
  })

  it('is the kept region\'s aspect, not the frame\'s', () => {
    expect(cropRegionAspect(crop({ right: 0.5 }), SOURCE)).toBe(1)
  })
})

describe('cropCentreFor', () => {
  it('leaves the centre alone when the crop did not change', () => {
    expect(
      cropCentreFor({ crop: undefined, transform: transform() }, crop(), SOURCE, PROJECT)
    ).toEqual({ x: 0.5, y: 0.5 })
  })

  it('moves the centre so the edges the drag did not touch stay still', () => {
    // 25% off the left: the kept region's centre moves from source x 200 to 250,
    // so the drawn picture's centre moves 50 project pixels right — which is
    // what holds the right edge at the pixel it was already on.
    const centre = cropCentreFor(
      { crop: undefined, transform: transform() },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5 + 50 / 1920)
    expect(centre.y).toBeCloseTo(0.5)
  })

  it('carries the displacement out through the clip\'s scale', () => {
    const centre = cropCentreFor(
      { crop: undefined, transform: transform({ scaleX: 2 }) },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5 + 100 / 1920)
  })

  it('rotates it with the clip — a 90° clip\'s left crop moves the centre DOWN', () => {
    const centre = cropCentreFor(
      { crop: undefined, transform: transform({ rotation: 90 }) },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5)
    expect(centre.y).toBeCloseTo(0.5 + 50 / 1080)
  })
})

describe('cropCompensatesCentre', () => {
  // Whether a crop write may move the clip's centre to hold the edges the drag
  // is not touching. Not on a clip whose placement is keyframed: a static centre
  // written onto an animated one fights its keyframes, and the keyframes win at
  // playback anyway (operator ruling, 2026-10-02).
  const kf = [{ time: 0, value: 0.5, easing: 'linear' as const }]

  it('compensates a clip with no animation at all', () => {
    expect(cropCompensatesCentre(undefined)).toBe(true)
  })

  it('compensates a clip whose animation carries no keyframes', () => {
    expect(cropCompensatesCentre(makeAnimation())).toBe(true)
  })

  it('does not compensate a clip keyframed on position', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { x: kf } }))).toBe(false)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { y: kf } }))).toBe(false)
  })

  it('does not compensate a clip keyframed on scale', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { scaleX: kf } }))).toBe(false)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { scaleY: kf } }))).toBe(false)
  })

  it('still compensates a clip keyframed on rotation, opacity or blur alone', () => {
    // Those do not move the clip's centre, so the centre is still the gesture's
    // to write. The rotation case carries a known inexactness — the
    // compensation uses the static rotation — which is documented, not branched
    // on.
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { rotation: kf } }))).toBe(true)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { opacity: kf } }))).toBe(true)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { blur: kf } }))).toBe(true)
  })

  it('ignores an empty keyframe list, which is what deleting the last one leaves', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { x: [] } }))).toBe(true)
  })
})

describe('cropWriteFor', () => {
  const full: ClipTransform = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.8 }

  it('writes the crop and the compensating transform, carrying the rest of it over', () => {
    const write = cropWriteFor(
      { crop: undefined, transform: full },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT,
      true
    )

    expect(write.crop).toEqual(crop({ left: 0.25 }))
    expect(write.transform!.x).toBeCloseTo(0.5 + 50 / 1920)
    // Everything the gesture is not changing comes across untouched — the write
    // hands `updateClip` a whole ClipTransform, not a patch.
    expect(write.transform!.opacity).toBe(0.8)
    expect(write.transform!.scaleX).toBe(1)
  })

  it('writes the crop ALONE when the clip\'s placement is keyframed', () => {
    const write = cropWriteFor(
      { crop: undefined, transform: full },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT,
      false
    )

    expect(write).toEqual({ crop: crop({ left: 0.25 }) })
    expect('transform' in write).toBe(false)
  })

  it('carries an undefined crop through — the clip going back to its whole frame', () => {
    const write = cropWriteFor(
      { crop: crop({ left: 0.25 }), transform: full },
      undefined,
      SOURCE,
      PROJECT,
      true
    )

    expect(write.crop).toBeUndefined()
    // Back to no crop at all, so the centre comes back to where it started.
    expect(write.transform!.x).toBeCloseTo(0.5 - 50 / 1920)
  })
})

describe('cropsEqual', () => {
  it('treats no crop and four zeroes as the same thing', () => {
    expect(cropsEqual(undefined, crop())).toBe(true)
  })

  it('tells one inset apart', () => {
    expect(cropsEqual(crop({ top: 0.1 }), crop({ top: 0.2 }))).toBe(false)
  })

  it('compares all four edges', () => {
    const left = crop({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 })

    expect(cropsEqual(left, { ...left })).toBe(true)
    expect(cropsEqual(left, { ...left, bottom: 0.41 })).toBe(false)
  })
})

describe('cropAnnouncement', () => {
  it('names the handle and the one inset a side handle owns, in source pixels', () => {
    // Percentages would round a one-pixel nudge of a wide source to "0%", which
    // is the one thing a nudge announcement must not say.
    expect(cropAnnouncement('w', crop({ left: 1 / 400 }), SOURCE)).toBe('Crop left: left 1 px')
  })

  it('names both insets a corner owns', () => {
    expect(cropAnnouncement('nw', crop({ left: 0.25, top: 0.1 }), SOURCE)).toBe(
      'Crop top left: left 100 px, top 20 px'
    )
  })

  it('reads a clip with no crop as zeroes', () => {
    expect(cropAnnouncement('s', undefined, SOURCE)).toBe('Crop bottom: bottom 0 px')
  })
})
```

- [ ] **Step 2: Run it and watch it fail to resolve**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/core/cropDrag.test.ts
```

Expected: the file errors before any test runs, with `Failed to resolve import "./cropDrag" from "src/core/cropDrag.test.ts". Does the file exist?` Paste the exact text into the step notes.

- [ ] **Step 3: Write the module** — create `apps/artist/src/core/cropDrag.ts`

```ts
// The crop GESTURE's arithmetic (ESCSUITE-157): what dragging or nudging one of
// the eight handles on a clip's kept region does to `clip.crop`.
//
// It sits beside `core/clipCrop.ts`, which owns the crop itself — the region a
// crop names, the shape check, the store's clamps and the aspect presets — and
// is deliberately a separate file: that module is read by the renderer on every
// media clip of every frame, and none of this is.
//
// Pure: numbers in, numbers out. No clip, no store, no canvas, no pointer
// event. The hook that drives it is `components/Preview/useCropHandleGesture.ts`.
import type { AnimatableProperty, ClipAnimation, ClipCrop, ClipTransform } from '../store/types';
import { croppedSourceRect } from './clipCrop';

/** One of the eight handles, by compass point. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/**
 * The eight handles, in the order the DOM renders them — reading order, so a
 * screen reader walking the group goes along the top, down the sides, along the
 * bottom.
 */
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

/**
 * What each handle is called.
 *
 * Eight distinct names, which is a requirement rather than a nicety: a screen
 * reader lists these as eight buttons with no other context, so "Crop top left"
 * and not "Top left", and never two of the same.
 */
export const CROP_HANDLE_LABELS: Record<CropHandle, string> = {
  nw: 'Crop top left',
  n: 'Crop top',
  ne: 'Crop top right',
  w: 'Crop left',
  e: 'Crop right',
  sw: 'Crop bottom left',
  s: 'Crop bottom',
  se: 'Crop bottom right',
};

/**
 * How far one arrow key moves a handle, in SOURCE pixels.
 *
 * A source pixel is the finest crop that means anything — `croppedSourceRect`
 * floors the region at one — and ten is the step a user reaches for when they
 * know where they are going, the same shape as the keyframe graph's fine and
 * coarse nudges.
 */
export const CROP_NUDGE = { fine: 1, coarse: 10 } as const;

/** No crop at all, as the four insets that say so. */
export const NO_CROP_INSETS: ClipCrop = { left: 0, top: 0, right: 0, bottom: 0 };

/** The source frame a crop is a fraction of. */
export interface SourceSize {
  width: number;
  height: number;
}

/** The clip transform a crop gesture starts from. */
export interface CropGestureTransform {
  /** The clip's normalised centre. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, as `ClipTransform.rotation` holds them. */
  rotation: number;
}

/** Which inset(s) a handle owns, per axis. */
const HANDLE_EDGES: Record<CropHandle, { x?: 'left' | 'right'; y?: 'top' | 'bottom' }> = {
  nw: { x: 'left', y: 'top' },
  n: { y: 'top' },
  ne: { x: 'right', y: 'top' },
  w: { x: 'left' },
  e: { x: 'right' },
  sw: { x: 'left', y: 'bottom' },
  s: { y: 'bottom' },
  se: { x: 'right', y: 'bottom' },
};

/**
 * A displacement on the canvas, in the clip's own unrotated frame and in SOURCE
 * pixels.
 *
 * Two conversions in one: the clip is drawn rotated about its centre, so the
 * displacement is rotated backwards by the same `R(-θ)`
 * `previewGeometry.ts`'s `toLocalPoint` applies to a point; and the drawn size
 * is the source times the clip's scale, so a 2x clip's handle crops half as
 * fast as the pointer moves.
 *
 * `delta` is in PROJECT pixels — the caller divides the pointer's client
 * displacement by the content box' scale first. A clip at scale 0 yields a
 * non-finite inset, which `normaliseCrop`'s own clamp reads as no inset; no
 * guard is coded for a scale no caller can produce (`updateClipTransform`
 * floors every scale at 0.1).
 */
export function sourceDelta(
  delta: { x: number; y: number },
  transform: Pick<CropGestureTransform, 'scaleX' | 'scaleY' | 'rotation'>
): { x: number; y: number } {
  const rad = (-transform.rotation * Math.PI) / 180;
  return {
    x: (delta.x * Math.cos(rad) - delta.y * Math.sin(rad)) / transform.scaleX,
    y: (delta.x * Math.sin(rad) + delta.y * Math.cos(rad)) / transform.scaleY,
  };
}

/** The most two opposite insets may sum to and still leave one source pixel. */
function axisLimit(dimension: number): number {
  return 1 - 1 / dimension;
}

/**
 * One moved inset, as far as it is allowed to go: never below zero, and never
 * so far that the axis has no pixel left in it.
 *
 * The clamp lands on the inset that MOVED, which is what keeps the opposite
 * edge pinned: the alternative — scaling both — would drag the far edge along
 * with a handle that had run out of room.
 */
function clampMoved(moved: number, opposite: number, dimension: number): number {
  return Math.min(Math.max(moved, 0), Math.max(0, axisLimit(dimension) - opposite));
}

/**
 * The insets `handle` produces, having been moved `delta` source pixels from
 * the crop the gesture **started** with.
 *
 * Always from the start, never from the clip's current crop: a drag writes on
 * every move, and rebasing each move from the previous one's output compounds
 * (ESCSUITE-110's trim bug, in a different gesture).
 *
 * `keepAspect` is Shift: the kept region keeps that width/height ratio, with
 * the axis the pointer set kept and the other derived. The caller decides what
 * the ratio is — {@link cropRegionAspect} at the press, which is the active
 * preset's ratio whenever a preset was the last thing applied, since
 * `CROP_ASPECT_PRESETS` stores insets and remembers nothing.
 */
export function cropForHandleMove(
  start: ClipCrop | undefined,
  handle: CropHandle,
  delta: { x: number; y: number },
  source: SourceSize,
  keepAspect?: number
): ClipCrop {
  const base = start ?? NO_CROP_INSETS;
  const edges = HANDLE_EDGES[handle];
  const next: ClipCrop = { ...base };

  // Written out per edge rather than through `next[edges.x]`: a write behind a
  // union key reads worse than four lines and TypeScript is happier for it. The
  // "no edge on this axis" arm is the side handles — `n` and `s` own no x inset,
  // `w` and `e` no y inset.
  if (edges.x === 'left') {
    next.left = clampMoved(base.left + delta.x / source.width, base.right, source.width);
  } else if (edges.x === 'right') {
    next.right = clampMoved(base.right - delta.x / source.width, base.left, source.width);
  }
  if (edges.y === 'top') {
    next.top = clampMoved(base.top + delta.y / source.height, base.bottom, source.height);
  } else if (edges.y === 'bottom') {
    next.bottom = clampMoved(base.bottom - delta.y / source.height, base.top, source.height);
  }

  if (keepAspect === undefined) return next;
  return withAspect(next, handle, source, keepAspect);
}

/**
 * The same insets, with the dependent axis rewritten so the kept region has the
 * given aspect.
 *
 * Which axis is dependent follows the handle: a left/right handle or a corner
 * sets the width and the height follows; a top/bottom handle sets the height
 * and the width follows. Where the handle owns an edge on the dependent axis
 * (a corner) the whole adjustment lands on that edge, so the edge the corner is
 * diagonally opposite stays where it was; where it does not, the region keeps
 * its own centre on that axis and the change is split between the two edges.
 *
 * The result can ask for a region with no pixel in it — an aspect-locked drag
 * derives rather than clamps — which `cropUpdateFor` refuses, so the drag
 * simply stops.
 */
function withAspect(
  crop: ClipCrop,
  handle: CropHandle,
  source: SourceSize,
  aspect: number
): ClipCrop {
  const region = croppedSourceRect(source.width, source.height, crop);
  const edges = HANDLE_EDGES[handle];

  if (edges.x) {
    const height = region.sw / aspect;
    if (edges.y === 'top') {
      return { ...crop, top: Math.max(0, 1 - crop.bottom - height / source.height) };
    }
    if (edges.y === 'bottom') {
      return { ...crop, bottom: Math.max(0, 1 - crop.top - height / source.height) };
    }
    const centre = region.sy + region.sh / 2;
    return {
      ...crop,
      top: Math.max(0, (centre - height / 2) / source.height),
      bottom: Math.max(0, 1 - (centre + height / 2) / source.height),
    };
  }

  const width = region.sh * aspect;
  const centre = region.sx + region.sw / 2;
  return {
    ...crop,
    left: Math.max(0, (centre - width / 2) / source.width),
    right: Math.max(0, 1 - (centre + width / 2) / source.width),
  };
}

/** The width/height ratio of the region a crop keeps. */
export function cropRegionAspect(crop: ClipCrop | undefined, source: SourceSize): number {
  const region = croppedSourceRect(source.width, source.height, crop);
  return region.sw / region.sh;
}

/**
 * The clip's normalised centre, moved so the edges the gesture is **not**
 * dragging stay where they are on screen.
 *
 * `crop` shrinks the drawn picture in place — the drawn size is the cropped
 * region times the scale, anchored on the clip's centre (ESCSUITE-6) — so a
 * crop written on its own moves BOTH edges of the axis, half as far as the
 * pointer, and the handle lags and the pinned edge does not pin. The fix is the
 * displacement of the kept region's centre within the source, carried out
 * through the clip's scale and rotated with it. The same compensation the
 * resize handles already make when they write `x`/`y` beside a scale.
 */
export function cropCentreFor(
  start: { crop: ClipCrop | undefined; transform: CropGestureTransform },
  next: ClipCrop,
  source: SourceSize,
  project: { width: number; height: number }
): { x: number; y: number } {
  const before = croppedSourceRect(source.width, source.height, start.crop);
  const after = croppedSourceRect(source.width, source.height, next);

  const px = (after.sx + after.sw / 2 - (before.sx + before.sw / 2)) * start.transform.scaleX;
  const py = (after.sy + after.sh / 2 - (before.sy + before.sh / 2)) * start.transform.scaleY;

  const rad = (start.transform.rotation * Math.PI) / 180;
  return {
    x: start.transform.x + (px * Math.cos(rad) - py * Math.sin(rad)) / project.width,
    y: start.transform.y + (px * Math.sin(rad) + py * Math.cos(rad)) / project.height,
  };
}

/** The transform properties that decide where the clip's picture sits. */
const PLACEMENT_PROPERTIES: readonly AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY'];

/**
 * May a crop write move the clip's centre as well (operator ruling,
 * 2026-10-02)?
 *
 * Not on a clip whose **placement** is keyframed. {@link cropCentreFor}'s whole
 * job is to write a static centre that holds the edges the drag is not touching;
 * on a clip whose `x`, `y`, `scaleX` or `scaleY` is animated, that static value
 * is overridden at every frame the animation covers, so writing it would fight
 * the keyframes and change nothing the user can see. The crop is then written
 * alone and the picture shrinks about its centre as it is cropped — the accepted
 * inexactness, documented in `apps/artist/CLAUDE.md`.
 *
 * Keyframes on `rotation`, `opacity` or `blur` do not turn it off: none of them
 * moves the clip's centre, so the centre is still the gesture's to write. (A
 * rotation-keyframed clip's compensation is computed with the clip's *static*
 * rotation, which is the same family of inexactness one step smaller, and is
 * documented rather than branched on.)
 */
export function cropCompensatesCentre(animation: ClipAnimation | undefined): boolean {
  if (!animation?.keyframes) return true;
  for (const property of PLACEMENT_PROPERTIES) {
    const keyframes = animation.keyframes[property];
    if (keyframes && keyframes.length > 0) return false;
  }
  return true;
}

/**
 * The whole `Partial<Clip>` one crop write hands `updateClip`: the crop, and —
 * only where {@link cropCompensatesCentre} allows it — the compensating centre
 * beside it.
 *
 * One function so there is exactly one place that decides whether a crop write
 * carries a transform, and one `updateClip` either way: one history push, one
 * locked-track check, one re-render per move. `transform` is handed over whole
 * rather than as a patch, built from the transform the gesture started with, so
 * `opacity`, `rotation` and `scaleLocked` come across untouched.
 */
export function cropWriteFor(
  start: { crop: ClipCrop | undefined; transform: ClipTransform },
  next: ClipCrop | undefined,
  source: SourceSize,
  project: { width: number; height: number },
  compensate: boolean
): { crop: ClipCrop | undefined; transform?: ClipTransform } {
  if (!compensate) return { crop: next };

  const centre = cropCentreFor(start, next ?? NO_CROP_INSETS, source, project);
  return { crop: next, transform: { ...start.transform, x: centre.x, y: centre.y } };
}

/**
 * Whether two crops keep the same region. Absent counts as four zeroes, the
 * rule `undefined === no crop` already sets.
 *
 * It is what makes a nudge that cannot move cost nothing: ArrowUp on the left
 * handle, or any arrow on a handle already clamped at the frame's edge,
 * produces the crop the clip already has, and writing that would spend an undo
 * entry on a change of nothing and announce an edit that did not happen.
 */
export function cropsEqual(a: ClipCrop | undefined, b: ClipCrop | undefined): boolean {
  const left = a ?? NO_CROP_INSETS;
  const right = b ?? NO_CROP_INSETS;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom
  );
}

/**
 * What the crop layer's live region says after a nudge that landed: the handle,
 * and the inset(s) it owns, in SOURCE pixels.
 *
 * Pixels rather than the inspector's percentages because the nudge's own step
 * is one source pixel: on a 1920-wide source that is 0.05%, and a percentage
 * would announce the nudge as "0%" — the one thing it must not say. A side
 * handle's message repeats its own name ("Crop left: left 1 px"); the
 * redundancy is the price of one sentence shape for all eight.
 */
export function cropAnnouncement(
  handle: CropHandle,
  crop: ClipCrop | undefined,
  source: SourceSize
): string {
  const insets = crop ?? NO_CROP_INSETS;
  const edges = HANDLE_EDGES[handle];
  const parts: string[] = [];
  if (edges.x) parts.push(`${edges.x} ${Math.round(insets[edges.x] * source.width)} px`);
  if (edges.y) parts.push(`${edges.y} ${Math.round(insets[edges.y] * source.height)} px`);
  return `${CROP_HANDLE_LABELS[handle]}: ${parts.join(', ')}`;
}
```

- [ ] **Step 4: Run the file again — green**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/core/cropDrag.test.ts
```

All cases pass. If the `clampMoved` case fails by a hair, read the expectation rather than loosening it: `1 - 1/400 - 0.9` is written as arithmetic precisely so the floor and the test cannot drift apart.

- [ ] **Step 5: Write the failing cases for `cropUpdateFor`** — append to `apps/artist/src/core/clipCrop.test.ts`

Add the import (`cropUpdateFor` into the existing `from './clipCrop'` list) and this block at the end of the file:

```ts
describe('cropUpdateFor', () => {
  // The decision `handleCropChange` used to make inline, lifted so the preview's
  // crop handles cannot drift from the inspector's sliders (ESCSUITE-157). Every
  // answer below is the one v1 gave; the seven cases in
  // `useClipEditorActions.test.ts` are the regression test for that.
  const source = { width: W, height: H }

  it('clears the crop of a clip with no source media, and writes nothing else', () => {
    // An overlay is exactly this case: no source frame for an inset to be a
    // fraction of. Clearing is allowed, cropping is not.
    expect(cropUpdateFor(crop(), undefined)).toEqual({ crop: undefined })
    expect(cropUpdateFor(crop({ left: 0.25 }), undefined)).toBeNull()
  })

  it('stores no crop at all for four zeroes', () => {
    expect(cropUpdateFor(crop(), source)).toEqual({ crop: undefined })
  })

  it('stores the normalised crop', () => {
    expect(cropUpdateFor(crop({ left: 2, top: 0.1 }), source)).toEqual({
      crop: { left: MAX_CROP_INSET, top: 0.1, right: 0, bottom: 0 },
    })
  })

  it('writes nothing for a crop that would leave less than a source pixel', () => {
    expect(cropUpdateFor(crop({ left: 0.9, right: 0.9 }), source)).toBeNull()
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/core/clipCrop.test.ts
```

Expected: a TypeScript/import failure naming `cropUpdateFor`. Paste the exact text.

- [ ] **Step 7: Add `cropUpdateFor`** — at the end of `apps/artist/src/core/clipCrop.ts`

```ts
/**
 * What to write for the crop a user asked for, or `null` for "write nothing".
 *
 * The one decision both crop surfaces make: the inspector's four sliders
 * (`useClipEditorActions`' `handleCropChange`) and the preview's eight handles
 * (`components/Preview/useCropHandleGesture.ts`). It was the body of the former
 * until ESCSUITE-157 needed the latter, and it is shared rather than copied for
 * the obvious reason — two normalisations would be two sets of rules about what
 * the store may hold.
 *
 * `{ crop: undefined }` is a write: the clip goes back to showing its whole
 * frame. `null` is not: a crop that would leave less than a source pixel, or
 * any crop at all on a clip with no source frame to be a fraction of, is
 * refused so the control the user is dragging snaps back to what is stored
 * rather than to a number nobody asked for.
 */
export function cropUpdateFor(
  crop: ClipCrop,
  source: { width: number; height: number } | undefined
): { crop: ClipCrop | undefined } | null {
  if (!source) {
    const empty = crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0;
    return empty ? { crop: undefined } : null;
  }

  const decision = normaliseCrop(crop, source.width, source.height);
  if (!decision.ok) return null;
  return { crop: decision.crop };
}
```

- [ ] **Step 8: Reduce `handleCropChange` to it** — in `apps/artist/src/components/ClipEditor/useClipEditorActions.ts`

This is a pure extraction: no behaviour changes, so there is nothing to make red. Its proof is that the seven existing crop cases stay green, and they must not be edited. Replace the body:

```ts
  // The decision is `core/clipCrop.ts`'s `cropUpdateFor` (ESCSUITE-157), shared
  // with the preview's crop handles so the two surfaces cannot disagree about
  // what the store may hold. `null` means write nothing — two opposite sliders
  // at their 90% maximum ask for exactly that — and the slider the user is
  // dragging snaps back to the stored value rather than to one nobody asked for.
  const handleCropChange = useCallback(
    (crop: ClipCrop) => {
      if (!selectedClip) return;
      const update = cropUpdateFor(crop, sourceVideo ?? undefined);
      if (!update) return;
      commit((skipHistory) => updateClip(selectedClip.id, update, skipHistory));
    },
    [selectedClip, sourceVideo, updateClip, commit]
  );
```

and change the import of `normaliseCrop` from `'../../core/clipCrop'` to `cropUpdateFor` (check whether `normaliseCrop` is still used elsewhere in the file before removing it — at `2cae295` it is not).

Note the two deliberate details: `sourceVideo ?? undefined` because the hook's memo answers `null` where `cropUpdateFor` takes `undefined`, and `update` is passed to `updateClip` as the `Partial<Clip>` it already is, which is why the existing assertions `toHaveBeenCalledWith(clip.id, { crop: CROP }, false)` still hold exactly.

- [ ] **Step 9: Prove nothing moved**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/useClipEditorActions.test.ts src/core/clipCrop.test.ts src/core/cropDrag.test.ts
```

All green, and `git diff src/components/ClipEditor/useClipEditorActions.test.ts` is empty.

- [ ] **Step 10: Typecheck, lint, whole suite**

```bash
pnpm --filter @escapesuite/artist typecheck
pnpm --filter @escapesuite/artist lint
pnpm --filter @escapesuite/artist exec vitest run
```

- [ ] **Step 11: Commit** — `feat(artist): the crop gesture's arithmetic and one shared write decision (ESCSUITE-157)`

---

### Task 2: crop mode — the latch, the inspector's toggle, Escape

**Files:**
- Modify: `apps/artist/src/store/types.ts` (one field and one action on `EditorState`)
- Modify: `apps/artist/src/store/uiSlice.ts`
- Modify: `apps/artist/src/store/projectStore.test.ts`
- Modify: `apps/artist/src/test/fixtures/projectStore.ts`
- Modify: `apps/artist/src/components/ClipEditor/useClipEditorActions.ts`, `useClipEditorActions.test.ts`
- Modify: `apps/artist/src/components/ClipEditor/CropSection.tsx`, `CropSection.test.tsx`
- Modify: `apps/artist/src/components/ClipEditor/ClipEditor.tsx`
- Modify: `apps/artist/src/app/useAppKeyboardShortcuts.ts`, `useAppKeyboardShortcuts.test.ts`
- Modify: `apps/artist/src/App.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, on `EditorState` (`store/types.ts`):
  ```ts
  cropClipId: string | null;
  setCropClipId: (clipId: string | null) => void;
  ```
- Produces, on `ClipEditorActions` (`useClipEditorActions.ts`):
  ```ts
  cropOnCanvas: boolean;
  handleCropOnCanvasToggle: () => void;
  ```
- Produces, on `CropSectionProps`:
  ```ts
  cropOnCanvas: boolean;
  onCropOnCanvasToggle: () => void;
  ```
- Produces, on `AppKeyboardShortcutsDeps`:
  ```ts
  cropClipId: string | null;
  setCropClipId: (clipId: string | null) => void;
  ```

**What this task pins:**

- **The latch is view state, in `uiSlice`.** Not in the project, not in the undo history, not in a `.veditor`, not in the session snapshot — the same company as `zoom`, `activeTool` and `loopPlayback`.
- **Nothing synchronises it.** `setSelectedClipId` is untouched, `pruneSelection` is untouched, and there is no effect anywhere that clears it. A latch that no longer names the selected clip is inert, which is how a selection change, a delete, a project load and an undo all leave crop mode for free (constraint 7).
- **The toggle is live on a locked track.** Crop mode is a view; the handles are what go inert (Task 4), and the panel already says why. So `onCropOnCanvasToggle` is **not** passed `disabled`, and it goes in `headerRight` beside Reset, which `CollapsibleSection` renders outside the `<fieldset disabled>`.
- **Escape leaves crop mode second, after the shortcuts sheet and before the in/out points.** A modal sheet is on top of everything; crop mode is a mode and goes before the three selection-ish branches, or Escape would deselect the clip — which leaves crop mode too, but loses the selection with it.
- **The two new keyboard deps are props, not a subscription inside the hook.** `useAppKeyboardShortcuts` takes everything it reads as `AppKeyboardShortcutsDeps`; its test file drives it with `vi.fn()`s on that basis.

- [ ] **Step 1: Write the failing store cases** — append to `apps/artist/src/store/projectStore.test.ts`

```ts
describe('crop mode (ESCSUITE-157)', () => {
  // A latch, not a synchronised copy: every reader asks whether it names the
  // SELECTED clip (`components/Preview/cropOverlay.ts`'s `cropTarget`), so
  // nothing has to clear it and nothing can leave it half-cleared.
  it('starts off', () => {
    expect(store().cropClipId).toBeNull()
  })

  it('names the clip crop mode was opened on', () => {
    const clip = addClip('clip1', 0)

    store().setCropClipId(clip.id)

    expect(store().cropClipId).toBe(clip.id)
  })

  it('is not cleared by a selection change — the readers compare it to the selection', () => {
    const first = addClip('clip1', 0)
    addClip('clip2', 4)
    store().setCropClipId(first.id)

    store().setSelectedClipId('clip2')

    expect(store().cropClipId).toBe(first.id)
  })

  it('is not part of the undo history', () => {
    const clip = addClip('clip1', 0)
    store().setCropClipId(clip.id)

    store().updateClip(clip.id, { name: 'renamed' })
    store().undo()

    expect(store().project.timeline.clips[0].name).toBe('clip1')
    expect(store().cropClipId).toBe(clip.id)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/store/projectStore.test.ts
```

Expected: `store().setCropClipId is not a function`. Paste the exact text.

- [ ] **Step 3: Declare the latch** — in `apps/artist/src/store/types.ts`, beside the other UI state (after `loopPlayback: boolean;`):

```ts
  /**
   * The clip the preview's **crop mode** is open on (ESCSUITE-157), or null.
   *
   * A latch, deliberately not kept in step with anything: every reader requires
   * it to name the *selected* clip (`components/Preview/cropOverlay.ts`'s
   * `cropTarget`), so selecting another clip, deselecting, deleting the clip,
   * loading another project and undoing the clip away all leave crop mode
   * without a single line of synchronisation. View state — not in the project,
   * not in the undo history, not in a saved file.
   */
  cropClipId: string | null;
```

and the action, with the other UI actions (after `setLoopPlayback`):

```ts
  setCropClipId: (clipId: string | null) => void;
```

- [ ] **Step 4: Implement it** — in `apps/artist/src/store/uiSlice.ts`

Extend the slice's `Pick` with `'cropClipId' | 'setCropClipId'`, add `cropClipId: null,` to the initial state beside `loopPlayback: false,`, and the setter beside `setLoopPlayback`:

```ts
  setCropClipId: (clipId: string | null) => set({ cropClipId: clipId }),
```

Update the file's header comment to name it: `// UI slice: the editor's view preferences — timeline zoom, snapping, the active`
`// tool, loop playback and the preview's crop mode. None of it is part of the`
`// project or the undo stack.`

- [ ] **Step 5: Keep it out of the next test** — in `apps/artist/src/test/fixtures/projectStore.ts`

Add `cropClipId: null,` to the `useEditorStore.setState({ … })` call in `resetStoreForTest`, and add it to the list in that function's doc comment (`Those are \`zoom\`, \`snapEnabled\`, \`activeTool\`, \`loopPlayback\`, \`cropClipId\`, …`). Run the store file again — green.

- [ ] **Step 6: Write the failing inspector cases** — in `apps/artist/src/components/ClipEditor/CropSection.test.tsx`, append inside the existing `describe('CropSection', …)`:

```ts
  it('offers a Crop on canvas toggle in its header, pressed when crop mode is on', () => {
    renderClosed({ cropOnCanvas: true })

    // In the header, so it is reachable without opening the section — and so a
    // locked track's <fieldset disabled> does not reach it.
    expect(screen.getByRole('button', { name: 'Crop on canvas' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('reports a press, and does not change the crop itself', () => {
    const { onCropChange, onCropOnCanvasToggle } = renderClosed()

    fireEvent.click(screen.getByRole('button', { name: 'Crop on canvas' }))

    expect(onCropOnCanvasToggle).toHaveBeenCalledTimes(1)
    expect(onCropChange).not.toHaveBeenCalled()
  })

  it('stays live on a locked track — looking at a crop is not editing one', () => {
    const { onCropOnCanvasToggle } = renderClosed({ disabled: true, cropOnCanvas: false })
    const toggle = screen.getByRole('button', { name: 'Crop on canvas' })

    expect(toggle).not.toBeDisabled()
    fireEvent.click(toggle)

    expect(onCropOnCanvasToggle).toHaveBeenCalledTimes(1)
  })
```

and extend the file's `renderClosed` helper to take and return the two new props:

```ts
function renderClosed({
  crop,
  sourceWidth = 400,
  sourceHeight = 200,
  disabled,
  cropOnCanvas = false,
}: {
  crop?: ClipCrop
  sourceWidth?: number
  sourceHeight?: number
  disabled?: boolean
  cropOnCanvas?: boolean
} = {}) {
  const user = userEvent.setup()
  const onCropChange = vi.fn()
  const onCropOnCanvasToggle = vi.fn()
  render(
    <CropSection
      crop={crop}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
      onCropChange={onCropChange}
      cropOnCanvas={cropOnCanvas}
      onCropOnCanvasToggle={onCropOnCanvasToggle}
      sliderGesture={inertSliderGesture}
      disabled={disabled}
    />
  )
  return { user, onCropChange, onCropOnCanvasToggle }
}
```

- [ ] **Step 7: Run it and watch it fail**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/CropSection.test.tsx
```

Expected: `Unable to find an accessible element with the role "button" and name "Crop on canvas"`. Paste the exact text.

- [ ] **Step 8: Add the toggle** — in `apps/artist/src/components/ClipEditor/CropSection.tsx`

Two props on the interface:

```ts
  /** Whether the preview's crop mode is open on this clip (ESCSUITE-157). */
  cropOnCanvas: boolean;
  /** Open or close it. Live on a locked track: crop mode is a view, not an edit. */
  onCropOnCanvasToggle: () => void;
```

destructure them, and replace the `headerRight` prop with both buttons:

```tsx
      headerRight={
        <>
          {/* Not `disabled`: crop mode shows the user what is being cropped
              away, which is reading. The eight handles are what go inert on a
              locked track (ESCSUITE-157), and the panel header already says
              why. It sits in `headerRight` and so outside the section's
              <fieldset disabled> for the same reason. */}
          <button
            className={styles.resetButton}
            aria-pressed={cropOnCanvas}
            onClick={(e) => {
              e.stopPropagation();
              onCropOnCanvasToggle();
            }}
          >
            Crop on canvas
          </button>
          <button
            className={styles.resetButton}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onCropChange(NO_CROP);
            }}
          >
            Reset
          </button>
        </>
      }
```

(The `e.stopPropagation()` on both is what keeps a click off the section's own collapse toggle, which is why Reset already has it.)

- [ ] **Step 9: Write the failing hook cases** — in `apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts`, after the existing crop block:

```ts
  it('opens crop mode on the selected clip', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBe(clip.id)
    expect(result.current.cropOnCanvas).toBe(true)
  })

  it('closes it again, rather than re-opening it on the same clip', () => {
    mediaClip()
    const { result } = mount()
    act(() => result.current.handleCropOnCanvasToggle())

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBeNull()
    expect(result.current.cropOnCanvas).toBe(false)
  })

  it('reads crop mode as off while the latch names another clip', () => {
    // The latch is never cleared on a selection change; the readers compare it
    // to the selection, and so does the toggle's own pressed state.
    const clip = mediaClip()
    store().setCropClipId('some-other-clip')
    const { result } = mount()

    expect(result.current.cropOnCanvas).toBe(false)

    act(() => result.current.handleCropOnCanvasToggle())

    expect(store().cropClipId).toBe(clip.id)
  })
```

- [ ] **Step 10: Run it, watch it fail, and implement** — in `apps/artist/src/components/ClipEditor/useClipEditorActions.ts`

Expected failure: `result.current.handleCropOnCanvasToggle is not a function`.

Two members on the `ClipEditorActions` interface, beside `handleCropChange`:

```ts
  /** Whether the preview's crop mode is open on the selected clip (ESCSUITE-157). */
  cropOnCanvas: boolean;
  handleCropOnCanvasToggle: () => void;
```

Two selectors beside the others (`cropClipId` is a scalar that changes only when the toggle is pressed, so it cannot move a playback-tick render count — see constraint 5):

```ts
  const cropClipId = useEditorStore((state) => state.cropClipId);
  const setCropClipId = useEditorStore((state) => state.setCropClipId);
```

and, beside `handleCropChange`:

```ts
  // Crop mode is a latch (`store/uiSlice.ts`): it is "on" only while it names
  // the selected clip, which is what makes a selection change leave the mode
  // without anything having to clear it.
  const cropOnCanvas = selectedClip !== null && cropClipId === selectedClip.id;

  const handleCropOnCanvasToggle = useCallback(() => {
    if (!selectedClip) return;
    setCropClipId(cropOnCanvas ? null : selectedClip.id);
  }, [selectedClip, cropOnCanvas, setCropClipId]);
```

Return both from the hook.

Note on `selectedClip !== null`: the hook runs above `ClipEditor`'s `!selectedClip` early return, so it is reached with nothing selected on every render of the empty panel — both sides covered by the cases above and by the existing "no clip selected" sweep.

- [ ] **Step 11: Wire the section** — in `apps/artist/src/components/ClipEditor/ClipEditor.tsx`, pull `cropOnCanvas` and `handleCropOnCanvasToggle` out of the hook's return and pass them:

```tsx
        <CropSection
          crop={selectedClip.crop}
          sourceWidth={sourceVideo?.width ?? 0}
          sourceHeight={sourceVideo?.height ?? 0}
          onCropChange={handleCropChange}
          cropOnCanvas={cropOnCanvas}
          onCropOnCanvasToggle={handleCropOnCanvasToggle}
          sliderGesture={sliderGesture}
          disabled={trackLocked}
        />
```

- [ ] **Step 12: Write the failing Escape cases** — in `apps/artist/src/app/useAppKeyboardShortcuts.test.ts`, inside `describe('the Escape cascade, in order', …)`, directly after the shortcuts-sheet case:

```ts
  it('then leaves crop mode', () => {
    mountShortcuts({ ...everything, showShortcuts: false, cropClipId: 'clip-1' })

    expect(press('Escape')).toBe(false)
    expect(deps.setCropClipId).toHaveBeenCalledWith(null)
    expect(deps.clearInOutPoints).not.toHaveBeenCalled()
  })

  it('leaves the shortcuts sheet ahead of it', () => {
    mountShortcuts({ ...everything, cropClipId: 'clip-1' })

    press('Escape')

    expect(deps.setShowShortcuts).toHaveBeenCalledWith(false)
    expect(deps.setCropClipId).not.toHaveBeenCalled()
  })
```

and add the two deps to the `beforeEach` block's `deps` object:

```ts
    cropClipId: null,
    setCropClipId: vi.fn(),
```

- [ ] **Step 13: Run it, watch it fail, and implement** — in `apps/artist/src/app/useAppKeyboardShortcuts.ts`

Expected failure: `Object literal may only specify known properties, and 'cropClipId' does not exist in type 'AppKeyboardShortcutsDeps'` from vitest's transform, or a runtime `deps.setCropClipId is not a function` on the assertion.

Two fields on `AppKeyboardShortcutsDeps`:

```ts
  /** The clip the preview's crop mode is open on, and how to close it (ESCSUITE-157). */
  cropClipId: string | null;
  setCropClipId: (clipId: string | null) => void;
```

destructure them with the rest, add both to the effect's dependency array, and insert the branch immediately after the `showShortcuts` branch inside `if (e.key === 'Escape') {`:

```ts
        // Crop mode is a mode, so Escape leaves it before Escape touches a
        // selection (ESCSUITE-157). Below the shortcuts sheet, which is a modal
        // on top of everything; above the in/out points and the two selection
        // branches, because deselecting would leave crop mode as a side effect
        // and take the selection with it.
        if (cropClipId) {
          e.preventDefault();
          setCropClipId(null);
          return;
        }
```

- [ ] **Step 14: Pass them from `App`** — in `apps/artist/src/App.tsx`

Two selectors beside the others:

```ts
  const cropClipId = useEditorStore((state) => state.cropClipId);
  const setCropClipId = useEditorStore((state) => state.setCropClipId);
```

and two entries in the `useAppKeyboardShortcuts({ … })` call, beside `clearInOutPoints`:

```ts
    cropClipId,
    setCropClipId,
```

- [ ] **Step 15: Prove the pins are untouched**

```bash
git diff --name-only
```

must list none of `src/components/Preview/drawFrame.perf.test.ts`, `src/core/exportMP4.perf.test.ts`, `src/core/exportWebM.perf.test.ts`, `src/App.rerender.test.tsx`, `src/components/ClipEditor/ClipEditor.rerender.test.tsx`, `src/components/Toolbar/Toolbar.rerender.test.tsx`, `src/test/fixtures/perfScene.ts`.

- [ ] **Step 16: Typecheck, lint, whole suite** (the four commands of Task 1's Step 10), then **commit** — `feat(artist): crop mode — the latch, the inspector's toggle and Escape (ESCSUITE-157)`

---

### Task 3: the canvas chrome — the dimmed source and the kept rectangle

**Files:**
- Create: `apps/artist/src/components/Preview/cropOverlay.test.ts`
- Create: `apps/artist/src/components/Preview/cropOverlay.ts`
- Create: `apps/artist/src/components/Preview/PreviewPlayer.crop.test.tsx`
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.tsx`

**Interfaces:**
- Consumes: `CropHandle` (Task 1), `croppedSourceRect` (`core/clipCrop.ts`), `getOverlayBounds` / `contentBox` / `CanvasContentBox` (`previewGeometry.ts`), `DragMode` / `OverlayBounds` / `ProjectSize` (`./types`), `cropClipId` (Task 2).
- Produces, in `apps/artist/src/components/Preview/cropOverlay.ts`:
  ```ts
  export interface CropOverlayScene {
    clips: Clip[];
    sourceVideos: SourceVideo[];
    cropClipId: string | null;
    selectedClipId: string | null;
    isPlaying: boolean;
  }
  export interface CropTarget { clip: Clip; source: SourceVideo }
  export interface CropFrameBox { left: number; top: number; width: number; height: number; rotation: number }
  export const CROP_DIM_ALPHA: number;
  export const CROP_FRAME_COLOR: string;
  export const CROP_VEIL_FILL: string;
  export const CROP_HANDLE_MODES: Record<CropHandle, DragMode>;
  export function cropTarget(scene: CropOverlayScene): CropTarget | null;
  export function fullSourceBox(bounds: OverlayBounds, crop: ClipCrop | undefined, source: { width: number; height: number }): { x: number; y: number; width: number; height: number };
  export function cropFrameBox(bounds: OverlayBounds, content: CanvasContentBox): CropFrameBox;
  export function drawCropOverlay(canvas: HTMLCanvasElement, time: number, scene: CropOverlayScene, element: CanvasImageSource | undefined, project?: ProjectSize, screenScale?: number): void;
  ```

**What this task pins:**

- **`cropTarget` is the one definition of "crop mode is on".** Five conditions — the latch is set, it names the *selected* clip, nothing is playing, the clip is on the timeline, its source is in the library — and both the chrome and the DOM layer's mount read it. An overlay needs no condition of its own: it carries `sourceVideoId: ''` and so fails the source lookup.
- **Zero cost when crop mode is off.** `drawCropOverlay` returns before `getContext`, so a chrome paint with the mode off records not one call on the canvas. That is asserted, not asserted-ish.
- **One `drawImage` per chrome paint, and the kept region is never redrawn.** The evenodd clip is what makes that possible: the frame already drew the kept region, so the dim pass only has to cover the ring around it.
- **The crop chrome *replaces* the transform chrome.** They would otherwise draw two sets of handles over the same rectangle, only one of which does anything — and in crop mode it is the canvas' own pointer handling that is off, so the resize handles would be visible and inert.
- **Nothing is added to `drawPreviewFrame`.** The branch is in `PreviewPlayer`'s `drawSelectionHandles` callback, which runs after the frame and not during playback.

- [ ] **Step 1: Write the failing test file** — create `apps/artist/src/components/Preview/cropOverlay.test.ts`

```ts
// The crop chrome, drawn straight onto a recording canvas (ESCSUITE-157).
//
// Two halves: `cropTarget`, which is the one answer to "is crop mode on, and on
// what", and `drawCropOverlay`, which dims everything outside the kept region.
// The numbers are built from the clip's own box rather than pasted in, and the
// call counts at the end are conservation laws — the crop chrome is not a
// per-frame path, so what it costs is pinned here instead of in a
// `*.perf.test.ts` file (see the plan's constraint 6).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CROP_DIM_ALPHA,
  CROP_FRAME_COLOR,
  CROP_HANDLE_MODES,
  CROP_VEIL_FILL,
  cropFrameBox,
  cropTarget,
  drawCropOverlay,
  fullSourceBox,
  type CropOverlayScene,
} from './cropOverlay'
import { contentBox } from './previewGeometry'
import { CROP_HANDLES } from '../../core/cropDrag'
import { makeClip, makeSourceVideo } from '../../test/fixtures/clipFixtures'
import {
  failNextGetContext,
  getCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import type { Clip, SourceVideo } from '../../store/types'

const CANVAS_W = 1920
const CANVAS_H = 1080

/** A 400x200 source centred on the canvas: the kept region is 400x200 at scale 1. */
const source: SourceVideo = makeSourceVideo({ width: 400, height: 200 })

let canvas: HTMLCanvasElement
let ctx: RecordingCanvasRenderingContext2D

beforeEach(() => {
  installCanvasDouble()
  canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  canvas.getContext('2d')
  ctx = getCanvasContext(canvas)!
})

afterEach(() => {
  uninstallCanvasDouble()
})

const mediaClip = (overrides: Partial<Clip> = {}): Clip =>
  makeClip({ id: 'clip1', duration: 4, ...overrides })

function scene(overrides: Partial<CropOverlayScene> = {}): CropOverlayScene {
  return {
    clips: [mediaClip()],
    sourceVideos: [source],
    cropClipId: 'clip1',
    selectedClipId: 'clip1',
    isPlaying: false,
    ...overrides,
  }
}

/** An element the dim pass can draw: its identity is all the double records. */
const element = document.createElement('video')

describe('cropTarget', () => {
  it('resolves the clip and its source when crop mode is on', () => {
    expect(cropTarget(scene())).toEqual({ clip: mediaClip(), source })
  })

  it('is null with crop mode off', () => {
    expect(cropTarget(scene({ cropClipId: null }))).toBeNull()
  })

  it('is null while the latch names anything but the selected clip', () => {
    // Nothing clears the latch, so this is how every selection change, delete,
    // project load and undo leaves crop mode (ESCSUITE-157).
    expect(cropTarget(scene({ selectedClipId: 'clip2' }))).toBeNull()
  })

  it('is null during playback', () => {
    expect(cropTarget(scene({ isPlaying: true }))).toBeNull()
  })

  it('is null for a latch naming a clip that has left the timeline', () => {
    expect(cropTarget(scene({ clips: [] }))).toBeNull()
  })

  it('is null for a clip whose source is not in the library — an overlay included', () => {
    // An overlay carries sourceVideoId: '', so it fails this lookup and needs no
    // condition of its own.
    expect(cropTarget(scene({ sourceVideos: [] }))).toBeNull()
    expect(
      cropTarget(scene({ clips: [mediaClip({ overlayType: 'text', sourceVideoId: '' })] }))
    ).toBeNull()
  })
})

describe('fullSourceBox', () => {
  const bounds = { centerX: 960, centerY: 540, width: 300, height: 200, rotation: 0 }

  it('is the kept region itself when the clip has no crop', () => {
    // 400x200 source, kept region 400x200 — so the full box is the kept box,
    // offset to the centre the chrome has already translated to.
    expect(
      fullSourceBox(
        { ...bounds, width: 400, height: 200 },
        undefined,
        { width: 400, height: 200 }
      )
    ).toEqual({ x: -200, y: -100, width: 400, height: 200 })
  })

  it('reaches out past the kept region by the part the crop hides', () => {
    // 25% off the left of a 400px source is 100 source pixels; the kept region
    // is 300 wide and drawn 300 wide, so the scale is 1 and the full box starts
    // 100px left of the kept box's own left edge (-150).
    expect(fullSourceBox(bounds, { left: 0.25, top: 0, right: 0, bottom: 0 }, {
      width: 400,
      height: 200,
    })).toEqual({ x: -250, y: -100, width: 400, height: 200 })
  })

  it('takes the clip\'s scale from the bounds it is given', () => {
    // The same crop drawn at 2x: everything doubles, including the reach.
    expect(
      fullSourceBox({ ...bounds, width: 600, height: 400 }, {
        left: 0.25,
        top: 0,
        right: 0,
        bottom: 0,
      }, { width: 400, height: 200 })
    ).toEqual({ x: -500, y: -200, width: 800, height: 400 })
  })
})

describe('cropFrameBox', () => {
  it('maps the kept region into the element\'s own CSS pixels', () => {
    // 960x540 box over a 1920x1080 project: half size, nothing letterboxed.
    setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })
    const content = contentBox(canvas, canvas.getBoundingClientRect(), {
      width: CANVAS_W,
      height: CANVAS_H,
    })

    expect(
      cropFrameBox({ centerX: 960, centerY: 540, width: 400, height: 200, rotation: 30 }, content)
    ).toEqual({ left: 380, top: 220, width: 200, height: 100, rotation: 30 })
  })

  it('carries the letterbox offset', () => {
    // 960x600 box: 960x540 of content with 30px of letterbox above it.
    setRect(canvas, { left: 0, top: 0, width: 960, height: 600 })
    const content = contentBox(canvas, canvas.getBoundingClientRect(), {
      width: CANVAS_W,
      height: CANVAS_H,
    })

    expect(
      cropFrameBox({ centerX: 960, centerY: 540, width: 400, height: 200, rotation: 0 }, content)
    ).toMatchObject({ left: 380, top: 250 })
  })
})

describe('drawCropOverlay', () => {
  it('dims the whole source outside the kept region, in one drawImage', () => {
    drawCropOverlay(canvas, 1, scene({ clips: [mediaClip({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } })] }), element)

    const [args] = ctx.argsFor('drawImage')
    // The kept region is 300x200 at scale 1, so the full source is drawn 400
    // wide starting 100px left of the kept box's left edge.
    expect(args).toEqual([element, -250, -100, 400, 200])
    expect(ctx.stateFor('drawImage')[0].globalAlpha).toBe(CROP_DIM_ALPHA)
  })

  it('punches the kept region out of it, so the frame\'s own picture stays bright', () => {
    drawCropOverlay(canvas, 1, scene(), element)

    expect(ctx.argsFor('rect')).toEqual([
      [-200, -100, 400, 200],
      [-200, -100, 400, 200],
    ])
    expect(ctx.argsFor('clip')).toEqual([['evenodd']])
  })

  it('strokes the kept region\'s edge at a constant size on screen', () => {
    drawCropOverlay(canvas, 1, scene(), element, canvas, 4)

    expect(ctx.argsFor('strokeRect')).toEqual([[-200, -100, 400, 200]])
    expect(ctx.stateFor('strokeRect')[0].strokeStyle).toBe(CROP_FRAME_COLOR)
    expect(ctx.stateFor('strokeRect')[0].lineWidth).toBe(4)
  })

  it('rotates with the clip', () => {
    drawCropOverlay(
      canvas,
      1,
      scene({ clips: [mediaClip({ transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 } })] }),
      element
    )

    expect(ctx.argsFor('translate')).toEqual([[960, 540]])
    expect(ctx.argsFor('rotate')).toEqual([[Math.PI / 2]])
  })

  it('veils the ring instead when the media element is not loaded yet', () => {
    drawCropOverlay(canvas, 1, scene(), undefined)

    expect(ctx.argsFor('drawImage')).toEqual([])
    expect(ctx.argsFor('fillRect')).toEqual([[-200, -100, 400, 200]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe(CROP_VEIL_FILL)
  })

  it('draws nothing at all with crop mode off', () => {
    drawCropOverlay(canvas, 1, scene({ cropClipId: null }), element)

    expect(ctx.calls).toEqual([])
  })

  it('draws nothing while the clip is off screen at this time', () => {
    drawCropOverlay(canvas, 9, scene(), element)

    expect(ctx.calls).toEqual([])
  })

  it('draws nothing on a canvas with no 2D context', () => {
    const el = document.createElement('canvas')
    el.width = CANVAS_W
    el.height = CANVAS_H
    failNextGetContext()

    expect(() => drawCropOverlay(el, 1, scene(), element)).not.toThrow()
  })

  it('draws nothing for a clip `getOverlayBounds` will not measure', () => {
    // An overlay kind with no data for it, on a source that IS in the library:
    // not a shape the app produces, but the chrome must never draw a rectangle
    // `getOverlayBounds` would not vouch for, and this is the one way to ask it
    // for a box and be told no.
    drawCropOverlay(
      canvas,
      1,
      scene({ clips: [mediaClip({ overlayType: 'text' })] }),
      element
    )

    expect(ctx.argsFor('drawImage')).toEqual([])
    expect(ctx.argsFor('strokeRect')).toEqual([])
  })

  it('costs exactly one dim, one clip and one stroke, with its state put back', () => {
    drawCropOverlay(canvas, 1, scene(), element)

    const count = (method: string) => ctx.calls.filter((c) => c.method === method).length
    expect(count('drawImage')).toBe(1)
    expect(count('clip')).toBe(1)
    expect(count('translate')).toBe(1)
    expect(count('rotate')).toBe(1)
    expect(count('save')).toBe(count('restore'))
    expect(ctx.globalAlpha).toBe(1)
  })
})

describe('CROP_HANDLE_MODES', () => {
  it('names a resize mode for every handle, so the cursors come from one table', () => {
    for (const handle of CROP_HANDLES) {
      expect(CROP_HANDLE_MODES[handle]).toBe(`resize-${handle}`)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail to resolve**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/cropOverlay.test.ts
```

Expected: `Failed to resolve import "./cropOverlay"`. Paste the exact text.

- [ ] **Step 3: Write the module** — create `apps/artist/src/components/Preview/cropOverlay.ts`

```ts
// Crop mode's chrome (ESCSUITE-157): the clip's full source drawn dimmed
// outside the region the crop keeps, and that region's own edge.
//
// It draws where `selectionOverlay.ts` draws — on the chrome path, after the
// composited frame, on a pointer move or a store change — and like that module
// it is pure: the scene is a parameter and the canvas is passed in. **Not a
// per-frame path**: `PreviewPlayer`'s chrome callbacks are not called during
// playback, and `cropTarget` below returns null if they ever are.
//
// The eight handles themselves are NOT here. They are DOM buttons
// (`CropHandles.tsx`), because they have to be focusable, individually named
// and individually disable-able, and because a CSS-pixel size is the one thing
// ESCSUITE-90 asks of chrome and a DOM element gets for free.
import { croppedSourceRect } from '../../core/clipCrop';
import type { CropHandle } from '../../core/cropDrag';
import { getOverlayBounds, type CanvasContentBox } from './previewGeometry';
import type { Clip, ClipCrop, SourceVideo } from '../../store/types';
import type { DragMode, OverlayBounds, ProjectSize } from './types';

/** Everything crop mode's chrome reads out of the editor store. */
export interface CropOverlayScene {
  clips: Clip[];
  sourceVideos: SourceVideo[];
  /** The latch: the clip crop mode was opened on, or null. */
  cropClipId: string | null;
  selectedClipId: string | null;
  isPlaying: boolean;
}

/** The clip crop mode is open on, and the source frame it is cropping. */
export interface CropTarget {
  clip: Clip;
  source: SourceVideo;
}

/** The kept region's box in the canvas element's own CSS pixels. */
export interface CropFrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Degrees, for a CSS `rotate()`. */
  rotation: number;
}

/** How much of the cropped-away picture shows through the dim. */
export const CROP_DIM_ALPHA = 0.45;

/** The kept region's edge. */
export const CROP_FRAME_COLOR = '#2196F3';

/** What dims the ring when there is no media element to draw into it. */
export const CROP_VEIL_FILL = 'rgba(0, 0, 0, 0.55)';

/**
 * Which resize mode each handle behaves like, so the cursor comes from
 * `cursor.ts`'s existing table rather than a second copy of it. It inherits
 * that table's one limitation: a cursor keyword does not rotate with the clip,
 * exactly as the selection chrome's does not.
 */
export const CROP_HANDLE_MODES: Record<CropHandle, DragMode> = {
  nw: 'resize-nw',
  n: 'resize-n',
  ne: 'resize-ne',
  w: 'resize-w',
  e: 'resize-e',
  sw: 'resize-sw',
  s: 'resize-s',
  se: 'resize-se',
};

/**
 * Is crop mode on, and on what?
 *
 * The **one** definition, read by the chrome below and by `PreviewPlayer` for
 * whether to mount the handles at all. `cropClipId` is a latch that nothing
 * clears, so the second condition is what makes a selection change — or a
 * delete, a project load, an undo — leave crop mode: a latch that no longer
 * names the selected clip is inert.
 *
 * An overlay needs no condition of its own: it carries `sourceVideoId: ''` and
 * fails the source lookup.
 */
export function cropTarget(scene: CropOverlayScene): CropTarget | null {
  const { clips, sourceVideos, cropClipId, selectedClipId, isPlaying } = scene;
  if (!cropClipId || cropClipId !== selectedClipId || isPlaying) return null;

  const clip = clips.find((c) => c.id === cropClipId);
  if (!clip) return null;

  const source = sourceVideos.find((s) => s.id === clip.sourceVideoId);
  if (!source) return null;

  return { clip, source };
}

/**
 * Where the clip's **whole** source frame would be drawn, given the box its
 * kept region occupies — in the clip's own unrotated frame, relative to the
 * centre the caller has already translated to.
 *
 * The scale comes out of `bounds` rather than off the clip's transform, so an
 * animated scale is already baked in and this needs to know nothing about
 * keyframes: the kept region is `region.sw` source pixels drawn `bounds.width`
 * wide, and that ratio carries the rest of the frame.
 */
export function fullSourceBox(
  bounds: OverlayBounds,
  crop: ClipCrop | undefined,
  source: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const region = croppedSourceRect(source.width, source.height, crop);
  const scaleX = bounds.width / region.sw;
  const scaleY = bounds.height / region.sh;

  return {
    x: -bounds.width / 2 - region.sx * scaleX,
    y: -bounds.height / 2 - region.sy * scaleY,
    width: source.width * scaleX,
    height: source.height * scaleY,
  };
}

/**
 * The kept region's box in the canvas element's own CSS pixels — what the DOM
 * handle layer is positioned with.
 *
 * The same `object-fit: contain` mapping `InlineTextEditorAnchor` does for the
 * inline text editor, and for the same reason: the handles are DOM elements
 * over a canvas the browser has letterboxed to fit its box.
 */
export function cropFrameBox(bounds: OverlayBounds, content: CanvasContentBox): CropFrameBox {
  return {
    left: content.offsetX + (bounds.centerX - bounds.width / 2) * content.scaleX,
    top: content.offsetY + (bounds.centerY - bounds.height / 2) * content.scaleY,
    width: bounds.width * content.scaleX,
    height: bounds.height * content.scaleY,
    rotation: bounds.rotation,
  };
}

/**
 * Dim everything the crop throws away, and outline what it keeps.
 *
 * One `drawImage`: the ring between the full source's box and the kept
 * rectangle is clipped with `evenodd` and the source is drawn once across it at
 * {@link CROP_DIM_ALPHA}. The kept region is deliberately NOT redrawn — the
 * composited frame already drew it, cropped, which is the picture the user is
 * deciding about. With no media element to draw (a video mid-load, an image not
 * yet decoded) the same ring is veiled instead, so the kept region still reads
 * as the kept region.
 *
 * `screenScale` is project pixels per CSS pixel, as every other chrome function
 * here takes it (ESCSUITE-90): it sizes the pen and nothing else. Positions are
 * the clip's own geometry.
 */
export function drawCropOverlay(
  canvas: HTMLCanvasElement,
  time: number,
  scene: CropOverlayScene,
  element: CanvasImageSource | undefined,
  project: ProjectSize = canvas,
  screenScale: number = 1
): void {
  const target = cropTarget(scene);
  if (!target) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { clip, source } = target;
  const clipEnd = clip.timelinePosition + clip.duration;
  if (time < clip.timelinePosition || time >= clipEnd) return;

  const bounds = getOverlayBounds(clip, canvas, time, scene.sourceVideos, project);
  if (!bounds) return;

  const full = fullSourceBox(bounds, clip.crop, source);
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;

  ctx.save();
  ctx.translate(bounds.centerX, bounds.centerY);
  ctx.rotate((bounds.rotation * Math.PI) / 180);

  ctx.save();
  ctx.beginPath();
  ctx.rect(full.x, full.y, full.width, full.height);
  ctx.rect(-halfW, -halfH, bounds.width, bounds.height);
  ctx.clip('evenodd');
  if (element) {
    ctx.globalAlpha = CROP_DIM_ALPHA;
    ctx.drawImage(element, full.x, full.y, full.width, full.height);
  } else {
    ctx.fillStyle = CROP_VEIL_FILL;
    ctx.fillRect(full.x, full.y, full.width, full.height);
  }
  ctx.restore();

  ctx.strokeStyle = CROP_FRAME_COLOR;
  ctx.lineWidth = 1 * screenScale;
  ctx.setLineDash([]);
  ctx.strokeRect(-halfW, -halfH, bounds.width, bounds.height);

  ctx.restore();
}
```

- [ ] **Step 4: Run the file — green.** The `getOverlayBounds` null case is reached by the 0x0 source: its media branch divides nothing, and a source of no size gives a zero-sized box — if that case instead draws, assert what it draws rather than deleting the case, and say so in the step notes.

- [ ] **Step 5: Write the failing component cases** — create `apps/artist/src/components/Preview/PreviewPlayer.crop.test.tsx`

```tsx
// Crop mode through the real preview (ESCSUITE-157).
//
// `cropOverlay.test.ts` owns the numbers; this file owns the wiring: that the
// crop chrome REPLACES the transform chrome, that the canvas' own pointer
// handling is off while it is on, that the handles are mounted, and that all of
// it disappears the four ways crop mode can be off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  installPreviewDoubles,
  renderPreview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import type { Clip } from '../../store/types'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** A media clip on the default 1920x1080 source, selected, with crop mode on. */
function croppingClip(): Clip {
  const clip = addClip('clip1', 0, 4)
  store().setSelectedClipId(clip.id)
  store().setCropClipId(clip.id)
  return clip
}

describe('crop mode on the preview', () => {
  it('draws the crop chrome instead of the transform handles', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    // The dim pass' clip() is the crop chrome's signature; the rotation grip's
    // arc() is the transform chrome's.
    expect(preview.calls('clip')).toHaveLength(1)
    expect(preview.calls('arc')).toHaveLength(0)
  })

  it('draws the transform handles once crop mode is off again', async () => {
    const clip = croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCropClipId(null)

    expect(preview.calls('clip')).toHaveLength(0)
    expect(preview.calls('arc').length).toBeGreaterThan(0)
    expect(store().selectedClipId).toBe(clip.id)
  })

  it('mounts eight named handles over the canvas', async () => {
    croppingClip()
    const preview = await renderPreview()

    expect(preview.view.getByRole('group', { name: 'Crop handles' })).toBeInTheDocument()
    expect(preview.view.getByRole('button', { name: 'Crop top left' })).toBeInTheDocument()
    expect(preview.view.getByRole('button', { name: 'Crop bottom right' })).toBeInTheDocument()
  })

  it('takes the canvas\' own pointer handling out of the way', async () => {
    const clip = croppingClip()
    const preview = await renderPreview()

    // Mid-canvas, which outside crop mode would start a move drag on this clip.
    fireEvent.mouseDown(preview.canvas, preview.at(960, 540))
    fireEvent.mouseMove(window, preview.at(1160, 540))
    fireEvent.mouseUp(window)

    expect(store().project.timeline.clips[0].transform.x).toBe(clip.transform.x)
  })

  it('draws and mounts nothing while the latch names another clip', async () => {
    croppingClip()
    addClip('clip2', 4, 4)
    store().setSelectedClipId('clip2')
    const preview = await renderPreview()
    preview.clearCalls()

    store().setCurrentTime(1)

    expect(preview.calls('clip')).toHaveLength(0)
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })

  it('draws and mounts nothing during playback', async () => {
    croppingClip()
    const preview = await renderPreview()
    preview.clearCalls()

    store().setIsPlaying(true)

    expect(preview.calls('clip')).toHaveLength(0)
    expect(preview.view.queryByRole('group', { name: 'Crop handles' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/PreviewPlayer.crop.test.tsx
```

Expected: the group and the eight buttons are missing, and `clip` is never called. Paste the exact text. The handles themselves arrive in Task 4 — the three cases that need them (`mounts eight named handles`, and the two `queryByRole` halves) stay red until then. Note that in the step notes and do not weaken them.

- [ ] **Step 7: Wire the chrome and the mount** — in `apps/artist/src/components/Preview/PreviewPlayer.tsx`

Imports:

```ts
import * as cropOverlay from './cropOverlay';
import { CropHandles } from './CropHandles';
import { isTrackLocked } from '../../store/trackLock';
import type { SourceVideo } from '../../store/types';
```

Two store reads, beside the others:

```ts
  const cropClipId = useEditorStore((state) => state.cropClipId);
  const setCropClipId = useEditorStore((state) => state.setCropClipId);
```

The scene and the resolved target, after `canvasDimensions`:

```ts
  // Crop mode (ESCSUITE-157). `cropTarget` is the single answer to "is it on,
  // and on what": the latch has to name the SELECTED clip, so a selection
  // change leaves the mode with nothing to clear. It gates three things — the
  // chrome below, the canvas' own pointer handlers, and the DOM handle layer —
  // and all three ask it once, here.
  const cropScene = useMemo<cropOverlay.CropOverlayScene>(
    () => ({ clips, sourceVideos, cropClipId, selectedClipId, isPlaying }),
    [clips, sourceVideos, cropClipId, selectedClipId, isPlaying]
  );
  const cropping = useMemo(() => cropOverlay.cropTarget(cropScene), [cropScene]);

  /** The decoded element a source draws from, for the crop chrome's dim pass. */
  const mediaElementFor = useCallback(
    (source: SourceVideo): CanvasImageSource | undefined =>
      source.mediaType === 'image'
        ? imageElementsRef.current.get(source.id)
        : videoElementsRef.current.get(source.id),
    [imageElementsRef, videoElementsRef]
  );
```

The chrome branch, at the top of the existing `drawSelectionHandles` callback (after the `if (!canvas) return;`):

```ts
    // In crop mode the crop chrome REPLACES the transform chrome: the canvas'
    // own pointer handling is off (see the canvas element below), so resize
    // handles would be visible and inert, over the same rectangle as the crop
    // frame.
    if (cropping) {
      cropOverlay.drawCropOverlay(
        canvas,
        time,
        cropScene,
        mediaElementFor(cropping.source),
        canvasDimensions,
        handleScreenScale(canvas)
      );
      return;
    }
```

and add `cropping`, `cropScene` and `mediaElementFor` to that callback's dependency array.

The pointer gate — four handlers on the `<canvas>`, each already gated on `editingTextClipId`:

```tsx
            onMouseDown={editingTextClipId || cropping ? undefined : handleMouseDown}
            onMouseMove={editingTextClipId || cropping ? undefined : handleMouseMoveForCursor}
            onMouseUp={editingTextClipId || cropping ? undefined : handleMouseUp}
            onMouseLeave={editingTextClipId || cropping ? undefined : handleMouseLeave}
```

and the mount, after the `{marqueeActive && …}` block inside `.videoWrapper`:

```tsx
        {cropping && canvasRef.current && (
          <CropHandles
            clip={cropping.clip}
            source={cropping.source}
            canvas={canvasRef.current}
            projectSize={canvasDimensions}
            time={currentTime}
            locked={isTrackLocked(tracks, cropping.clip.trackId)}
            onLeave={() => setCropClipId(null)}
          />
        )}
```

Leave `onDoubleClick` alone: it opens the inline text editor on text clips and crop mode is only ever on a media clip.

- [ ] **Step 8: Run both files.** `cropOverlay.test.ts` is green; `PreviewPlayer.crop.test.tsx` is green except the three cases that need Task 4's component — which cannot compile at all until `CropHandles.tsx` exists. So create it now as a shell carrying **Task 4's real `CropHandlesProps`** (copy the interface from Task 4's Interfaces block, imports included) and this body, and say so in the step notes:

```tsx
export function CropHandles(_props: CropHandlesProps) {
  return null;
}
```

Task 4's Step 5 replaces the body wholesale and its own tests are what prove the replacement; the props do not change. Leave the three cases red here and note them.

- [ ] **Step 9: Prove the pins are untouched** — `git diff --name-only` as in Task 2's Step 15.

- [ ] **Step 10: Typecheck, lint, whole suite, then commit** — `feat(artist): crop mode's canvas chrome — the dimmed source and the kept region (ESCSUITE-157)`

---

### Task 4: the eight handles, and the drag

**Files:**
- Create: `apps/artist/src/components/Preview/useCropHandleGesture.ts`
- Create: `apps/artist/src/components/Preview/CropHandles.module.css`
- Create: `apps/artist/src/components/Preview/CropHandles.tsx`
- Create: `apps/artist/src/components/Preview/CropHandles.test.tsx`

**Interfaces:**
- Consumes: everything Task 1 produced, plus `cropFrameBox` / `CROP_HANDLE_MODES` (Task 3), `cropUpdateFor` (Task 1), `getCursorForMode` (`./cursor`), `contentBox` / `getOverlayBounds` (`previewGeometry.ts`), `useGestureHistory` and `useThrottledDragUpdate` (`../../hooks`).
- Produces, in `apps/artist/src/components/Preview/useCropHandleGesture.ts`:
  ```ts
  export interface CropHandleGestureDeps {
    clip: Clip;
    source: SourceVideo;
    projectSize: ProjectSize;
    /** CSS pixels per project pixel, from the canvas' content box. */
    contentScale: number;
    onLeave: () => void;
  }
  export interface CropHandleGesture {
    onMouseDown: (handle: CropHandle, e: ReactMouseEvent<HTMLButtonElement>) => void;
    onKeyDown: (handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => void;
    /** Ends a keyboard gesture: bound to both keyup and blur. */
    onKeyUp: () => void;
    /** What the crop layer's live region is saying. */
    message: string;
  }
  export function useCropHandleGesture(deps: CropHandleGestureDeps): CropHandleGesture;
  ```
- Produces, in `apps/artist/src/components/Preview/CropHandles.tsx`:
  ```ts
  export interface CropHandlesProps {
    clip: Clip;
    source: SourceVideo;
    canvas: HTMLCanvasElement;
    projectSize: ProjectSize;
    /** The playhead, so the handles sit on the clip's animated box. */
    time: number;
    locked: boolean;
    onLeave: () => void;
  }
  export function CropHandles(props: CropHandlesProps): JSX.Element | null;
  ```

This task writes the keyboard *plumbing* (`onKeyDown`, `onKeyUp`, `message`) because the gesture is one object, but only Escape is implemented in it. Task 5 fills in the arrows and the announcement; its tests are what make them red first.

**What this task pins:**

- **One store write per move, and the gesture's start is its only reference.** `updateClip(id, { crop, transform })`, built from the crop and the transform captured at the press — never from the clip as the previous move of the same drag left it. On a clip keyframed on position or scale the same write carries **no** `transform` at all (Task 1's `cropWriteFor`), and the case below that drags such a clip is what proves it.
- **One undo entry per drag, however many moves it took.** `gestureHistory.begin()` at the press, `commit` around the write **inside the rAF updater** (the throttler coalesces a frame's moves, so "first write" has to mean the first that reaches the store), `end()` at the release.
- **A locked row's handles are inert through `disabled` alone.** React does not deliver mouse events to a disabled form control, and a disabled button takes no focus, so there is **no `locked` branch in the gesture hook** — one mechanism, not two, and nothing defensive to leave untested. The explanation is `ClipEditorHeader`'s existing notice, and `updateClip`'s own refusal is the backstop for a row locked *mid*-gesture (whose open document listeners keep running) and for the one path `disabled` does not block, a keydown dispatched straight at the element.
- **No listener outlives the component.** The drag's `mousemove`/`mouseup` pair is installed at the press and removed at the release *or* at unmount — the ESCSUITE-120 shape.
- **The handles follow `getOverlayBounds`**, the function every other piece of preview chrome reads, so the crop frame cannot disagree with the selection box; and they inherit its documented ESCSUITE-147 gap rather than inventing a second geometry.

- [ ] **Step 1: Write the failing test file** — create `apps/artist/src/components/Preview/CropHandles.test.tsx`

```tsx
// The crop handle layer: where the eight handles sit, and what dragging one
// writes (ESCSUITE-157).
//
// Rendered on its own over a canvas with a layout box, the way
// `InlineTextEditorAnchor.test.tsx` renders the inline editor: the store is
// real, so the assertions are about the clip the drag actually produced.
//
// The scene throughout: the default 1920x1080 source and project, a canvas laid
// out at 960x540 — so one CSS pixel is two project pixels and nothing is
// letterboxed — and a clip at the default centre and scale, whose kept region
// is therefore the whole frame and whose frame box is the whole 960x540 box.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CropHandles } from './CropHandles'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { installCanvasDouble, uninstallCanvasDouble } from '../../test/doubles/canvas'
import { setRect } from '../../test/doubles/layout'
import {
  installResizeObserverDouble,
  type ResizeObserverDouble,
} from '../../test/doubles/resizeObserver'
import type { Clip } from '../../store/types'

let observer: ResizeObserverDouble

beforeEach(() => {
  installCanvasDouble()
  observer = installResizeObserverDouble()
  resetStoreForTest()
})

afterEach(() => {
  cleanup()
  observer.uninstall()
  uninstallCanvasDouble()
})

const clipNow = (id: string): Clip => store().project.timeline.clips.find((c) => c.id === id)!

const past = (): number => store().history.past.length

/** The canvas the handles are positioned over: 1920x1080 project in a 960x540 box. */
function previewCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1920
  canvas.height = 1080
  setRect(canvas, { left: 0, top: 0, width: 960, height: 540 })
  return canvas
}

interface Mounted {
  clip: Clip
  onLeave: ReturnType<typeof vi.fn>
  handle(name: string): HTMLButtonElement
}

function mount({ locked = false }: { locked?: boolean } = {}): Mounted {
  const clip = addClip('clip1', 0, 4)
  const onLeave = vi.fn()
  render(
    <CropHandles
      clip={clip}
      source={video}
      canvas={previewCanvas()}
      projectSize={{ width: 1920, height: 1080 }}
      time={1}
      locked={locked}
      onLeave={onLeave}
    />
  )
  return {
    clip,
    onLeave,
    handle: (name) => screen.getByRole('button', { name }) as HTMLButtonElement,
  }
}

/** Drag one handle by a displacement in the canvas element's own CSS pixels. */
function drag(handle: HTMLButtonElement, dx: number, dy: number, shiftKey = false): void {
  fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(document, { clientX: dx, clientY: dy, shiftKey })
  fireEvent.mouseUp(document)
}

describe('the crop handle layer', () => {
  it('draws eight handles with eight distinct names, in one named group', () => {
    mount()

    const group = screen.getByRole('group', { name: 'Crop handles' })
    const names = Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual([
      'Crop top left',
      'Crop top',
      'Crop top right',
      'Crop left',
      'Crop right',
      'Crop bottom left',
      'Crop bottom',
      'Crop bottom right',
    ])
    expect(new Set(names).size).toBe(8)
  })

  it('frames the kept region in the element\'s own CSS pixels', () => {
    mount()

    const frame = screen.getByRole('group', { name: 'Crop handles' })
    expect(frame.style.left).toBe('0px')
    expect(frame.style.top).toBe('0px')
    expect(frame.style.width).toBe('960px')
    expect(frame.style.height).toBe('540px')
  })

  it('shrinks the frame onto a cropped clip', () => {
    // Half the width cropped off the right: 960x1080 of source, drawn at scale 1
    // and still centred on the frame, so the picture spans project x 480…1440 —
    // 480 CSS pixels wide starting at 240.
    const clip = addClip('clip1', 0, 4)
    store().updateClip(clip.id, { crop: { left: 0, top: 0, right: 0.5, bottom: 0 } })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    const frame = screen.getByRole('group', { name: 'Crop handles' })
    expect(frame.style.left).toBe('240px')
    expect(frame.style.width).toBe('480px')
  })

  it('rotates the frame with the clip', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClipTransform(clip.id, { rotation: 30 })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    expect(screen.getByRole('group', { name: 'Crop handles' }).style.transform).toBe('rotate(30deg)')
  })

  it('follows the canvas when the element is resized under it', () => {
    const canvas = previewCanvas()
    render(
      <CropHandles
        clip={addClip('clip1', 0, 4)}
        source={video}
        canvas={canvas}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    setRect(canvas, { left: 0, top: 0, width: 480, height: 270 })
    observer.emit(canvas, { width: 480, height: 270 })

    expect(screen.getByRole('group', { name: 'Crop handles' }).style.width).toBe('480px')
  })

  it('crops from the left when the left handle is dragged right', () => {
    const { clip, handle } = mount()

    // 96 CSS pixels is 192 project pixels, which at scale 1 is 192 source
    // pixels — a tenth of a 1920-wide frame.
    drag(handle('Crop left'), 96, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 })
  })

  it('moves the clip\'s centre so the edges it is not dragging stay still', () => {
    const { clip, handle } = mount()

    drag(handle('Crop left'), 96, 0)

    // The kept region is 1728 wide and its centre moved 96 project pixels, so
    // the right edge of the picture is exactly where it was.
    expect(clipNow(clip.id).transform.x).toBeCloseTo(0.55)
    expect(clipNow(clip.id).transform.y).toBeCloseTo(0.5)
  })

  it('reads a rotated clip\'s handles in the clip\'s own frame', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClipTransform(clip.id, { rotation: 90 })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    // Dragging DOWN on a clip rotated 90° is dragging along its own +x.
    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 0, 96)

    // `toBeCloseTo`, not `toEqual`: cos(-90°) is 6.1e-17 rather than 0, so the
    // inset lands a few ulps off a tenth. The three insets the handle does not
    // own are untouched and so are exact.
    const crop = clipNow(clip.id).crop!
    expect(crop.left).toBeCloseTo(0.1)
    expect(crop.top).toBe(0)
    expect(crop.right).toBe(0)
    expect(crop.bottom).toBe(0)
  })

  it('writes the crop alone on a clip whose position is keyframed', () => {
    // A static centre written onto an animated one would fight its keyframes and
    // lose at playback, so the compensation is skipped and the picture shrinks
    // about its centre instead (operator ruling, 2026-10-02).
    const clip = addClip('clip1', 0, 4)
    store().setClipKeyframe(clip.id, 'x', { time: 0, value: 0.5, easing: 'linear' })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 96, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 })
    expect(clipNow(clip.id).transform.x).toBe(0.5)
  })

  it('holds the region\'s aspect while Shift is down', () => {
    const { clip, handle } = mount()

    // The frame is 16:9; cropping 192px off the left leaves 1728x1080, and
    // holding 16:9 takes the height to 972 — 54px off the top and the bottom.
    drag(handle('Crop left'), 96, 0, true)

    const crop = clipNow(clip.id).crop!
    expect(crop.left).toBeCloseTo(0.1)
    expect(crop.top).toBeCloseTo(0.05)
    expect(crop.bottom).toBeCloseTo(0.05)
  })

  it('leaves one undo entry for a drag, however many moves it took', () => {
    const { clip, handle } = mount()
    const before = past()

    const button = handle('Crop left')
    fireEvent.mouseDown(button, { clientX: 0, clientY: 0 })
    for (let step = 1; step <= 5; step++) {
      fireEvent.mouseMove(document, { clientX: step * 20, clientY: 0 })
    }
    fireEvent.mouseUp(document)

    expect(past()).toBe(before + 1)
    expect(clipNow(clip.id).crop).toBeDefined()
  })

  it('undoes the drag back to the uncropped clip, at the centre it started from', () => {
    const { clip, handle } = mount()

    drag(handle('Crop left'), 96, 0)
    store().undo()

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(clipNow(clip.id).transform.x).toBe(0.5)
  })

  it('disables every handle on a locked track, and writes nothing', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked
        onLeave={vi.fn()}
      />
    )
    const before = past()

    drag(screen.getByRole('button', { name: 'Crop left' }) as HTMLButtonElement, 96, 0)

    const group = screen.getByRole('group', { name: 'Crop handles' })
    for (const button of group.querySelectorAll('button')) expect(button).toBeDisabled()
    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('clamps a drag past the far edge to the stored maximum', () => {
    const { clip, handle } = mount()

    // `cropForHandleMove` stops one source pixel short of the opposite edge and
    // `normaliseCrop` then clamps to MAX_CROP_INSET, so the stored crop is the
    // clamp rather than the ask — and the handle simply stops moving.
    drag(handle('Crop left'), 9999, 0)

    expect(clipNow(clip.id).crop).toEqual({ left: 0.9, top: 0, right: 0, bottom: 0 })
  })

  it('takes its listeners with it when it unmounts mid-drag', () => {
    const { clip, handle } = mount()
    fireEvent.mouseDown(handle('Crop left'), { clientX: 0, clientY: 0 })

    cleanup()
    fireEvent.mouseMove(document, { clientX: 96, clientY: 0 })

    expect(clipNow(clip.id).crop).toBeUndefined()
  })

  it('leaves crop mode on Escape, and claims the key', () => {
    const { onLeave, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'Escape' })).toBe(false)
    expect(onLeave).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail to resolve**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/CropHandles.test.tsx
```

Expected: `Failed to resolve import "./CropHandles"` — or, if Task 3's shell is still in place, `The expression is not callable` / eight missing buttons. Paste the exact text.

- [ ] **Step 3: Write the gesture hook** — create `apps/artist/src/components/Preview/useCropHandleGesture.ts`

Only the pointer drag and Escape go in here. The arrow nudges are Task 5's, after its own red
tests — so none of `CROP_NUDGE`, `cropAnnouncement`, `cropsEqual` or `ANNOUNCE_MARK` is imported
or declared yet, and `message` is state with no writer (an empty live region, which is what a
live region should be until something happens).

```ts
// One crop handle's gesture: the pointer drag, Escape, and the one store write a
// move makes (ESCSUITE-157). The arrow-key nudges join it in the same shape.
//
// The arithmetic is `core/cropDrag.ts` and the write decision is
// `core/clipCrop.ts`'s `cropUpdateFor`, shared with the inspector's sliders.
// What is here is the gesture: when it begins, what it reads, and the single
// `updateClip` it issues per animation frame.
//
// **One write, not two.** A crop alone would shrink the picture about the clip's
// centre, so both edges of the axis would move and the handle would lag the
// pointer by half (ESCSUITE-6's "cropping shrinks the picture in place"). The
// write therefore carries a compensating `transform` beside the `crop`, built
// from the transform the gesture STARTED with — one `updateClip`, so one
// history push, one locked-track check and no compounding from the previous
// move. The same thing the resize handles do when they write `x`/`y` beside a
// scale.
//
// **Except on a clip whose placement is keyframed**, where the crop is written
// alone: a static centre on an animated one fights its keyframes and loses at
// playback. `cropCompensatesCentre` is that question, `cropWriteFor` acts on it,
// and the picture then shrinks about its centre as it is cropped (operator
// ruling, 2026-10-02; documented in `apps/artist/CLAUDE.md`).
//
// **One undo entry.** `hooks/useGestureHistory.ts`, unchanged: `begin` at the
// press, `commit` around the write inside the throttled updater — the throttler
// coalesces a frame's moves, so "the gesture's first write" has to mean the
// first that reaches the store — and `end` at the release. A keydown that is
// not a repeat begins; a repeat resumes; keyup and blur end. `useSliderGesture`'s
// rule verbatim.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { useGestureHistory, useThrottledDragUpdate } from '../../hooks';
import { cropUpdateFor } from '../../core/clipCrop';
import {
  cropCompensatesCentre,
  cropForHandleMove,
  cropRegionAspect,
  cropWriteFor,
  sourceDelta,
  type CropHandle,
} from '../../core/cropDrag';
import type { Clip, ClipCrop, ClipTransform, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';

/**
 * What a crop gesture needs that a hook cannot reach for itself.
 *
 * No `locked`: a locked row's handles are `disabled`, React delivers no mouse
 * event to a disabled control and a disabled button takes no focus, so there is
 * nothing here for a lock to refuse — and `updateClip` refuses the write anyway
 * for a row locked mid-gesture (ESCSUITE-84).
 */
export interface CropHandleGestureDeps {
  clip: Clip;
  source: SourceVideo;
  projectSize: ProjectSize;
  /** CSS pixels per project pixel, from the canvas' content box. */
  contentScale: number;
  /** Leave crop mode (Escape). */
  onLeave: () => void;
}

/** The listeners one handle binds, and what the live region is saying. */
export interface CropHandleGesture {
  onMouseDown: (handle: CropHandle, e: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /** Ends a keyboard gesture. Bound to keyup AND blur, as the sliders' is. */
  onKeyUp: () => void;
  message: string;
}

/** What the gesture read when it began, and never re-reads. */
interface CropGestureStart {
  handle: CropHandle;
  clientX: number;
  clientY: number;
  crop: ClipCrop | undefined;
  /**
   * The clip's whole transform, not just the five fields the arithmetic reads:
   * the write hands `updateClip` a complete `ClipTransform` with a new centre,
   * so `opacity` and `scaleLocked` have to come along unchanged.
   */
  transform: ClipTransform;
  /** The kept region's aspect at the press — what Shift holds. */
  aspect: number;
}

export function useCropHandleGesture({
  clip,
  source,
  projectSize,
  contentScale,
  onLeave,
}: CropHandleGestureDeps): CropHandleGesture {
  const updateClip = useEditorStore((state) => state.updateClip);
  const gestureHistory = useGestureHistory();
  const throttled = useThrottledDragUpdate<{ crop: ClipCrop; start: CropGestureStart }>();
  // Nothing writes this yet — the arrow nudges do, in Task 5. The live region it
  // feeds is rendered from the start regardless: an aria-live region has to
  // exist before its content changes for a screen reader to announce one.
  const [message] = useState('');

  /**
   * The open drag's teardown, so an unmount mid-drag takes its two document
   * listeners with it (ESCSUITE-120's shape). Null between drags.
   */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  /**
   * Normalise one crop and write it — with the centre that keeps the pinned
   * edges still, unless the clip's placement is keyframed, in which case the
   * crop goes alone (operator ruling, 2026-10-02). Returns whether the store
   * wrote.
   */
  const write = useCallback(
    (next: ClipCrop, start: Pick<CropGestureStart, 'crop' | 'transform'>): boolean => {
      const update = cropUpdateFor(next, source);
      if (!update) return false;

      const payload = cropWriteFor(
        start,
        update.crop,
        source,
        projectSize,
        cropCompensatesCentre(clip.animation)
      );
      return gestureHistory.commit((skipHistory) => updateClip(clip.id, payload, skipHistory));
    },
    [clip.id, clip.animation, source, projectSize, updateClip, gestureHistory]
  );

  const onMouseDown = useCallback(
    (handle: CropHandle, e: ReactMouseEvent<HTMLButtonElement>) => {
      // No locked check: the button is `disabled` on a locked row and React
      // delivers it no mouse event at all.
      // No text selection and no scroll during the drag; focus is taken
      // explicitly, because preventDefault would otherwise leave the handle
      // unfocused and the arrow keys with nothing to nudge.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.focus();

      const start: CropGestureStart = {
        handle,
        clientX: e.clientX,
        clientY: e.clientY,
        crop: clip.crop,
        transform: clip.transform,
        aspect: cropRegionAspect(clip.crop, source),
      };
      gestureHistory.begin();

      const onMove = (move: MouseEvent) => {
        const delta = sourceDelta(
          {
            x: (move.clientX - start.clientX) / contentScale,
            y: (move.clientY - start.clientY) / contentScale,
          },
          start.transform
        );
        const next = cropForHandleMove(
          start.crop,
          start.handle,
          delta,
          source,
          move.shiftKey ? start.aspect : undefined
        );
        throttled.scheduleUpdate((pending) => write(pending.crop, pending.start), {
          crop: next,
          start,
        });
      };

      const onUp = () => {
        throttled.flush();
        gestureHistory.end();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endDragRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      endDragRef.current = onUp;
    },
    [clip.crop, clip.transform, source, contentScale, gestureHistory, throttled, write]
  );

  // Escape only, for now: Task 5 adds the arrow branch below it, red first. The
  // `handle` parameter is already taken because every button passes it and the
  // arrows are what will read it.
  const onKeyDown = useCallback(
    (_handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onLeave();
      }
    },
    [onLeave]
  );

  const onKeyUp = useCallback(() => gestureHistory.end(), [gestureHistory]);

  return { onMouseDown, onKeyDown, onKeyUp, message };
}
```

- [ ] **Step 4: Write the stylesheet** — create `apps/artist/src/components/Preview/CropHandles.module.css`

```css
/* Crop mode's handle layer (ESCSUITE-157): a frame on the kept region, with
   eight handles on its corners and edges.

   Sizes are CSS pixels and stay CSS pixels: a handle is the same size under the
   pointer whatever the project's resolution, which is what ESCSUITE-90 asks of
   chrome and what a DOM element gets for free. The frame is positioned in the
   element's own pixels by the component and rotated about its centre, so each
   handle's position inside it is a percentage and nothing here knows about
   rotation. */
.frame {
  position: absolute;
  box-sizing: border-box;
  z-index: 11;
  pointer-events: none;
}

.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: 0;
  padding: 0;
  transform: translate(-50%, -50%);
  background: #ffffff;
  border: 2px solid #2196f3;
  border-radius: 2px;
  pointer-events: auto;
}

.handle:disabled {
  background: #9e9e9e;
  border-color: #607d8b;
  cursor: not-allowed;
}

.handle:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

.nw { left: 0; top: 0; }
.n { left: 50%; top: 0; }
.ne { left: 100%; top: 0; }
.w { left: 0; top: 50%; }
.e { left: 100%; top: 50%; }
.sw { left: 0; top: 100%; }
.s { left: 50%; top: 100%; }
.se { left: 100%; top: 100%; }

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Write the component** — create `apps/artist/src/components/Preview/CropHandles.tsx`

```tsx
// Crop mode's handles: eight buttons on the kept region's corners and edges
// (ESCSUITE-157).
//
// A DOM layer over the canvas, beside `MarqueeSelection` and
// `InlineTextEditorAnchor` and positioned the same way — the clip's box in
// project pixels, through the object-fit: contain mapping, into the element's
// own CSS pixels. DOM rather than canvas chrome for three reasons: a handle has
// to be focusable and named for a keyboard user, it has to be disable-able on
// its own for a locked track, and a CSS-pixel size is exactly what ESCSUITE-90
// asks of chrome. The clip's rotation is one CSS `rotate()` on the frame, so
// the eight positions inside it are percentages.
//
// The dim behind it — the cropped-away picture — is canvas chrome and lives in
// `cropOverlay.ts`.
import { useEffect, useState } from 'react';
import { CROP_HANDLES, CROP_HANDLE_LABELS } from '../../core/cropDrag';
import { contentBox, getOverlayBounds } from './previewGeometry';
import { CROP_HANDLE_MODES, cropFrameBox } from './cropOverlay';
import { getCursorForMode } from './cursor';
import { useCropHandleGesture } from './useCropHandleGesture';
import type { Clip, SourceVideo } from '../../store/types';
import type { ProjectSize } from './types';
import styles from './CropHandles.module.css';

export interface CropHandlesProps {
  clip: Clip;
  source: SourceVideo;
  /** The preview canvas the handles are positioned over. */
  canvas: HTMLCanvasElement;
  projectSize: ProjectSize;
  /** The playhead, so the handles sit on the clip's animated box. */
  time: number;
  /** The clip's track is locked (ESCSUITE-84): the handles are inert. */
  locked: boolean;
  /** Leave crop mode. */
  onLeave: () => void;
}

export function CropHandles({
  clip,
  source,
  canvas,
  projectSize,
  time,
  locked,
  onLeave,
}: CropHandlesProps) {
  // The canvas element's CSS box, followed for as long as crop mode is open.
  // An observer of its own rather than a prop from `PreviewPlayer`, which keeps
  // its box in a ref precisely so a resize does not re-render the preview
  // subtree: this layer only exists in crop mode, so the render a resize costs
  // here is bounded by the mode being open.
  const [box, setBox] = useState(() => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  const content = contentBox(canvas, box, projectSize);
  // `locked` is not handed to the gesture: the buttons below are `disabled`, so
  // React delivers them no mouse event and they take no focus. A keydown aimed
  // straight at one is the only way in, and `updateClip` refuses that write
  // (ESCSUITE-84) — which is also the backstop for a row locked mid-drag.
  const gesture = useCropHandleGesture({
    clip,
    source,
    projectSize,
    contentScale: content.scaleX,
    onLeave,
  });

  // The same `getOverlayBounds` the selection chrome, the hit test, the marquee
  // and the drag seed read, so the crop frame cannot disagree with the box the
  // rest of the preview draws — and so it inherits that function's documented
  // ESCSUITE-147 gap rather than inventing a second geometry.
  const bounds = getOverlayBounds(clip, canvas, time, [source], projectSize);
  if (!bounds) return null;

  const frame = cropFrameBox(bounds, content);

  return (
    <>
      <div
        className={styles.frame}
        role="group"
        aria-label="Crop handles"
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          transform: `rotate(${frame.rotation}deg)`,
        }}
      >
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={`${styles.handle} ${styles[handle]}`}
            style={{ cursor: getCursorForMode(CROP_HANDLE_MODES[handle]) }}
            aria-label={CROP_HANDLE_LABELS[handle]}
            disabled={locked}
            onMouseDown={(e) => gesture.onMouseDown(handle, e)}
            onKeyDown={(e) => gesture.onKeyDown(handle, e)}
            onKeyUp={gesture.onKeyUp}
            onBlur={gesture.onKeyUp}
          />
        ))}
      </div>

      {/* Always rendered, never conditional: a live region has to exist before
          its content changes for a screen reader to announce the change. */}
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {gesture.message}
      </span>
    </>
  );
}
```

- [ ] **Step 6: Run the file — green**, and run Task 3's component file too: its three remaining cases now pass.

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/CropHandles.test.tsx src/components/Preview/PreviewPlayer.crop.test.tsx
```

If the Shift case is a hair off, check the expectation's arithmetic before the code: 16:9 of 1728 is 972, and `toBeCloseTo`'s default precision is two decimals.

- [ ] **Step 7: Prove the pins are untouched** — `git diff --name-only` as in Task 2's Step 15.

- [ ] **Step 8: Typecheck, lint, whole suite, then commit** — `feat(artist): eight crop handles on the preview, and the drag that writes them (ESCSUITE-157)`

---

### Task 5: the keyboard — nudges, ten-pixel steps, and what the live region says

**Files:**
- Modify: `apps/artist/src/components/Preview/CropHandles.test.tsx` (one new `describe`)
- Modify: `apps/artist/src/components/Preview/useCropHandleGesture.ts` (the arrow branch, the announcer and the two constants it needs)

Task 4 left `onKeyDown` handling Escape and nothing else, so every case below is red before a line of it is written. The hook's `message` state exists already and the live region that renders it has been mounted since Task 4 — only its writer is new.

**Interfaces:** no new exports. The gesture's shape is Task 4's.

**What this task pins:**

- **One source pixel, ten with Shift**, in the direction the arrow points, through the same `cropForHandleMove` a drag uses.
- **A focused handle owns all four arrows.** An arrow it has no inset for is swallowed and does nothing: the playhead must not step while a crop handle has focus.
- **A held key is one undo entry**, not one per repetition — `resume()` on `e.repeat`, the rule `useSliderGesture` sets for a held slider arrow.
- **Nothing is announced that did not happen**, and nothing is announced twice silently. A refused write, a clamped nudge and an arrow the handle does not own all say nothing; two identical messages in a row differ by the zero-width mark so an atomic live region re-reads them.
- **The announcement is the stored crop, in source pixels.** `Crop left: left 1 px`, not `0%`.

- [ ] **Step 1: Write the failing cases** — append to `apps/artist/src/components/Preview/CropHandles.test.tsx`

```tsx
describe('nudging a crop handle from the keyboard', () => {
  /** What the live region is saying, with the re-read mark taken off. */
  const announced = (): string =>
    (screen.getByRole('status').textContent ?? '').replace(/\u200B$/, '')

  it('crops one source pixel per arrow press, in the direction the arrow points', () => {
    const { clip, handle } = mount()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight' })

    expect(clipNow(clip.id).crop).toEqual({ left: 1 / 1920, top: 0, right: 0, bottom: 0 })
  })

  it('crops ten with Shift', () => {
    const { clip, handle } = mount()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight', shiftKey: true })

    expect(clipNow(clip.id).crop).toEqual({ left: 10 / 1920, top: 0, right: 0, bottom: 0 })
  })

  it('moves the handle back out again, towards the frame\'s edge', () => {
    const { clip, handle } = mount()
    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight', shiftKey: true })

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowLeft' })

    // Two divisions by 1920 and a subtraction do not land on 9/1920 exactly.
    expect(clipNow(clip.id).crop!.left).toBeCloseTo(9 / 1920, 6)
  })

  it('nudges both of a corner\'s insets', () => {
    const { clip, handle } = mount()

    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowDown', shiftKey: true })

    expect(clipNow(clip.id).crop).toEqual({
      left: 10 / 1920,
      top: 10 / 1080,
      right: 0,
      bottom: 0,
    })
  })

  it('swallows an arrow the handle has no inset for, and does nothing with it', () => {
    // The playhead must not step out from under a user whose focus is on a crop
    // handle, so the key is claimed; there is simply nothing for it to move.
    const { clip, handle } = mount()

    expect(fireEvent.keyDown(handle('Crop left'), { key: 'ArrowUp' })).toBe(false)
    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(announced()).toBe('')
  })

  it('writes nothing when the nudge is already at the edge it came from', () => {
    const { clip, handle } = mount()
    const before = past()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowLeft' })

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(past()).toBe(before)
  })

  it('leaves one undo entry per press, and one for a held key', () => {
    const { handle } = mount()
    const button = handle('Crop left')
    const before = past()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowRight', repeat: true })
    fireEvent.keyDown(button, { key: 'ArrowRight', repeat: true })
    fireEvent.keyUp(button, { key: 'ArrowRight' })

    expect(past()).toBe(before + 1)
  })

  it('starts a fresh entry for the next press', () => {
    const { handle } = mount()
    const button = handle('Crop left')
    const before = past()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyUp(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyUp(button, { key: 'ArrowRight' })

    expect(past()).toBe(before + 2)
  })

  it('announces the stored crop in source pixels', () => {
    // Percentages would read a one-pixel nudge of a 1920-wide source as "0%".
    const { handle } = mount()

    fireEvent.keyDown(handle('Crop left'), { key: 'ArrowRight' })

    expect(announced()).toBe('Crop left: left 1 px')
  })

  it('announces both of a corner\'s insets', () => {
    const { handle } = mount()

    fireEvent.keyDown(handle('Crop top left'), { key: 'ArrowRight', shiftKey: true })

    expect(announced()).toBe('Crop top left: left 10 px, top 0 px')
  })

  it('says the same thing twice audibly', () => {
    // An aria-atomic region whose text does not change is not re-read, which is
    // exactly the case a user repeating one nudge is in.
    const { handle } = mount()
    const button = handle('Crop left')

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    const first = screen.getByRole('status').textContent
    fireEvent.keyDown(button, { key: 'ArrowLeft' })
    fireEvent.keyDown(button, { key: 'ArrowRight' })

    expect(screen.getByRole('status').textContent).not.toBe(first)
    expect(announced()).toBe('Crop left: left 1 px')
  })

  it('announces nothing when the store refuses the write', () => {
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(
      <CropHandles
        clip={clipNow(clip.id)}
        source={video}
        canvas={previewCanvas()}
        projectSize={{ width: 1920, height: 1080 }}
        time={1}
        locked={false}
        onLeave={vi.fn()}
      />
    )

    // `locked={false}` with a locked track is the row-locked-mid-gesture case:
    // the button is live, the store refuses, and the live region must not claim
    // an edit that did not happen.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Crop left' }), { key: 'ArrowRight' })

    expect(clipNow(clip.id).crop).toBeUndefined()
    expect(announced()).toBe('')
  })
})
```

- [ ] **Step 2: Run them**

```bash
pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/CropHandles.test.tsx
```

Expected: every case in the new block fails — Task 4's `onKeyDown` handles Escape and nothing
else, so no arrow writes anything, `screen.getByRole('status')` is empty, and the two undo-count
cases read `before`. Paste the exact text.

- [ ] **Step 3: Add the arrow branch** — in `apps/artist/src/components/Preview/useCropHandleGesture.ts`

Extend the `core/cropDrag` import with `CROP_NUDGE`, `cropAnnouncement` and `cropsEqual`, give
`message` its writer (`const [message, setMessage] = useState('');`), and add the two
module-level constants above the hook:

```ts
// Appended to alternate announcements so two identical ones in a row are two
// different strings — an aria-atomic region whose text does not change is not
// re-read, which is exactly the case a user repeating one nudge is in.
// Deliberately a copy of the keyframe graph's
// (`KeyframePanel/hooks/useKeyframeGraphKeyboard.ts`) rather than an import of
// it: the graph owns its own live region, and importing from it would tie the
// preview to the keyframe panel for one character.
const ANNOUNCE_MARK = '\u200B';

/** Which way each arrow moves a handle, in the clip's own frame. */
const ARROW_STEPS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
```

the announcer, beside the `endDragRef` effect:

```ts
  const announce = useCallback((text: string) => {
    setMessage((prev) => (prev.slice(-1) === ANNOUNCE_MARK ? text : text + ANNOUNCE_MARK));
  }, []);
```

and replace `onKeyDown` whole — the `_handle` parameter becomes `handle`:

```ts
  const onKeyDown = useCallback(
    (handle: CropHandle, e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onLeave();
        return;
      }

      const step = ARROW_STEPS[e.key];
      if (!step) return;
      // A focused control owns its arrows — the rule the keyframe graph states —
      // so all four are claimed even where the handle owns no inset on that
      // axis, rather than stepping the playhead out from under the user.
      e.preventDefault();
      e.stopPropagation();

      const distance = e.shiftKey ? CROP_NUDGE.coarse : CROP_NUDGE.fine;
      const next = cropForHandleMove(
        clip.crop,
        handle,
        { x: step.x * distance, y: step.y * distance },
        source
      );
      // An arrow the handle does not own, or a handle already clamped at the
      // frame's edge: writing this would spend an undo entry on a change of
      // nothing and announce an edit that did not happen.
      if (cropsEqual(next, clip.crop)) return;

      // A held key is one undo entry, not one per repetition —
      // `useSliderGesture`'s rule for a held slider arrow.
      if (e.repeat) gestureHistory.resume();
      else gestureHistory.begin();

      // Refused by the store (a locked row): nothing changed, so the live region
      // must not say otherwise (ESCSUITE-87's shape).
      if (!write(next, { crop: clip.crop, transform: clip.transform })) return;
      announce(cropAnnouncement(handle, cropUpdateFor(next, source)?.crop, source));
    },
    [clip.crop, clip.transform, source, onLeave, gestureHistory, write, announce]
  );
```

One note for the reviewer, deliberate: `cropUpdateFor` is called twice on a nudge — once inside
`write` and once for the announcement — so the live region reads what was **stored** (clamped)
rather than what was asked for. It is pure arithmetic over four numbers; the alternative is for
`write` to return the stored crop, which makes its `boolean` contract — the one
`gestureHistory.commit` needs — two things at once.

- [ ] **Step 4: Run them again — green.** If a case's *expectation* turns out to be wrong, say so in the step notes with the reasoning, and change the expectation rather than quietly deleting the case. Two to watch:

- **`Crop top left: left 10 px, top 0 px`** — `Math.round` is right and the expectation is right; if it reads a different number, the announcement is reading the asked-for crop rather than the stored one.
- **the held-key case leaving three entries** — `fireEvent.keyDown(el, { repeat: true })` does set `e.repeat`, so the fault would be in the hook.

- [ ] **Step 5: Prove the pins are untouched** — `git diff --name-only` as in Task 2's Step 15.

- [ ] **Step 6: Typecheck, lint, whole suite, then commit** — `feat(artist): arrow-key crop nudges, announced (ESCSUITE-157)`

---

### Task 6: documentation and the changeset

**Files:**
- Modify: `apps/artist/CLAUDE.md`
- Modify: `CLAUDE.md` (one clause)
- Create: `.changeset/escsuite-157-crop-handles.md`

**Interfaces:** none. No source file changes in this task.

**What this task pins:** that the next person reading either CLAUDE.md learns crop mode exists, how it is entered and left, that the latch is a latch, which chrome layer draws what, and which of v1's two limits survives.

- [ ] **Step 1: Replace v1's "no handles" limit** — in `apps/artist/CLAUDE.md`, find the paragraph beginning `**Two deliberate v1 limits.**` and replace it with:

```markdown
**One deliberate limit survives from v1.** The **timeline thumbnail is not
cropped** — `utils/maskClipPath.ts` is untouched, so a cropped clip's tile still
shows the whole frame's picture (masked, if it is masked).

**Crop mode: the crop can also be dragged on the canvas** (ESCSUITE-157). The
inspector's Crop section header carries a **Crop on canvas** toggle; pressing it
puts the clip's id in `cropClipId` (`store/uiSlice.ts`), and the preview then
draws the clip's **full source dimmed** outside the region the crop keeps, with
eight handles on that region's corners and edges. Escape leaves crop mode — the
global cascade's second branch, after the shortcuts sheet and *before* the
in/out points, because deselecting would leave the mode as a side effect and
take the selection with it — and so does pressing the toggle again.

`cropClipId` is a **latch, not a synchronised copy**: nothing clears it, and
every reader goes through `components/Preview/cropOverlay.ts`'s `cropTarget`,
which requires it to name the **selected** clip (and nothing to be playing, and
the clip and its source to exist). So a selection change, a delete, a project
load and an undo all leave crop mode by construction, with no effect and no
cross-slice write — a latch that no longer names the selected clip is inert. It
is view state: not in the project, not in the undo history, not in a `.veditor`.

**Two layers, and neither of them is the frame renderer.** The dim is canvas
chrome: `drawCropOverlay` runs where `drawSelectionHandles` runs — after the
frame, on a pointer move or a store change, never during playback — and clips to
the full source's box with the kept rectangle punched out (`rect`, `rect`,
`clip('evenodd')`) so **one `drawImage`** at 45% alpha covers the ring and the
kept region is left exactly as the frame drew it. With no decoded element yet,
the same ring is veiled instead. In crop mode that chrome **replaces** the
transform chrome, and the canvas' own pointer handlers are unbound the way they
already are while the inline text editor is open — so `useTransformHandles.ts` is
untouched and a crop drag can never be mistaken for a move, a resize or a
marquee. The eight handles are the second layer and are **DOM buttons**
(`CropHandles.tsx`, beside `MarqueeSelection` and `InlineTextEditorAnchor`,
positioned through `contentBox` and rotated by one CSS `rotate()`): focusable,
individually named, individually disable-able, and a constant 12 CSS pixels —
which is what ESCSUITE-90 asks of chrome and what a DOM element gets for free.
Because the crop chrome reads the same `getOverlayBounds` everything else does,
it inherits that function's ESCSUITE-147 gap (chrome evaluated without a
transition's preset suppression) rather than introducing a second geometry.

**What a handle writes.** `core/cropDrag.ts` is the arithmetic: the pointer's
displacement is divided by the content box' scale into project pixels, rotated
backwards by the clip's rotation and divided by its scale into **source**
pixels (`sourceDelta`, the same `R(-θ)` as `toLocalPoint`), then added to the
inset(s) the handle owns — `w`→`left`, `e`→`right` negated, `n`→`top`, `s`→
`bottom`, a corner one of each. **The opposite inset is never touched**, and the
clamp lands on the inset that moved, so the opposite edge is pinned. Shift holds
the kept region's aspect **as it was at the press** (`cropRegionAspect`): there
is no stored "active preset" to read, because `CROP_ASPECT_PRESETS` writes insets
and remembers nothing, and at the press that ratio *is* the last preset applied.
Every move is computed from the crop the gesture started with, never from the
clip as the previous move left it — ESCSUITE-110's compounding trim, in a
different gesture.

The write is **one** `updateClip(id, { crop, transform })`, and the `transform`
is why: `crop` shrinks the drawn picture *in place* (v1's rule — the drawn size
is the cropped region times the scale, anchored on the clip's centre), so a crop
written alone would move both edges of the axis half as far as the pointer and
pin neither. `cropCentreFor` carries the kept region's centre displacement
within the source out through the clip's scale and rotation, so the edges the
drag is not touching stay on the pixels they were on — the same compensation
the resize handles already make when they write `x`/`y` beside a scale. One
write means one history push, one locked-track check and one re-render per move,
and `core/clipCrop.ts`'s **`cropUpdateFor`** is the write decision, shared with
the inspector's sliders: the clamp to `MAX_CROP_INSET`, `undefined` for an
all-zero crop, and a refusal (write nothing) for anything leaving less than a
source pixel.

**A clip whose placement is keyframed is cropped without that compensation.**
`cropCompensatesCentre` is false for custom keyframes on `x`, `y`, `scaleX` or
`scaleY`, and `cropWriteFor` then returns the crop with no `transform` beside it:
writing a static centre onto an animated one would fight the keyframes and lose
at playback. The accepted consequence is that on such a clip the picture shrinks
about its centre as it is cropped — both edges of the axis move, half as far as
the pointer — while the handles keep following `getOverlayBounds`' animated box.
Keyframes on rotation, opacity or blur do not turn the compensation off; a
rotation-keyframed clip's compensation uses the clip's static rotation, the same
inexactness one step smaller.

**And the handles are above the canvas, which is not listening.** In crop mode
the canvas' four mouse handlers are unbound, so a pointer over a handle is that
button's event and no canvas hit test can race it — intended, and the reason
`hitTest.ts` needed no crop-aware pass.

**Keyboard and lock.** Each handle takes **arrow keys for one source pixel and
Shift+arrow for ten**, through the same `cropForHandleMove` a drag uses; a
focused handle claims all four arrows (an arrow it owns no inset for is
swallowed and does nothing, so the playhead cannot step out from under it), a
held key is one undo entry (`resume()` on `e.repeat`, `useSliderGesture`'s rule),
and every nudge that **lands** is announced in the layer's own
`role="status"` region in source pixels — `Crop left: left 1 px`, because a
percentage would read a one-pixel nudge of a 1920-wide source as "0%" — with the
keyframe graph's zero-width-space alternation so two identical messages in a row
are both read. A nudge that changes nothing, or that the store refuses,
announces nothing. On a **locked track** crop mode can still be entered (looking
at what is being cropped away is reading) and all eight handles render
`disabled`, so there is no press, no focus and no keydown; the explanation is the
panel header's existing "Track locked" notice, and `updateClip`'s own refusal is
the backstop for a row locked mid-gesture.

**The crop chrome is not a per-frame path**, which is why there is no
`cropOverlay.perf.test.ts`: `drawFrame.perf.test.ts` and both exporters' ceiling
files are byte-identical, and the conservation laws of one chrome paint — zero
context calls with the mode off, and one `drawImage`, one `clip`, one `translate`,
one `rotate` and balanced `save`/`restore` with it on — are asserted in
`cropOverlay.test.ts`.
```

- [ ] **Step 2: Add the chrome cross-reference** — in `apps/artist/CLAUDE.md`, immediately after the paragraph beginning `**The selection chrome is a constant size on screen** (ESCSUITE-90).`, add:

```markdown
**Crop mode draws its own chrome instead** (ESCSUITE-157), and its handles are
DOM buttons rather than canvas squares — so they are sized in CSS pixels
directly and take no `screenScale` at all. The one thing that chrome scales is
the pen: `drawCropOverlay` takes the same `screenScale` and multiplies its
`lineWidth` by it. See "Crop mode" in the overlay/mask section below.
```

- [ ] **Step 3: Extend the root clause** — in `CLAUDE.md`, line 143's bullet, replace `(a crop — four insets as fractions of the source frame)` with:

```
(a crop — four insets as fractions of the source frame, set from the inspector or, since ESCSUITE-157, by dragging eight handles in the preview's crop mode)
```

- [ ] **Step 4: Write the changeset** — create `.changeset/escsuite-157-crop-handles.md`

```markdown
---
'@escapesuite/artist': minor
---

Crop a clip on the canvas, not just in the inspector

Press "Crop on canvas" in the clip inspector's Crop section and the preview
shows the whole of the clip's source dimmed, with the part you are keeping
bright and eight handles on its corners and edges. Drag one and the picture
crops from that side while the other edges stay exactly where they are; hold
Shift to keep the shape you already had. The handles are real buttons, so Tab
reaches them, the arrow keys move one pixel of the source at a time (ten with
Shift), and every nudge is read out. Escape leaves crop mode, and so does
selecting another clip. On a locked track you can still look, and the handles
say so by greying out.
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @escapesuite/artist typecheck
pnpm --filter @escapesuite/artist lint
pnpm --filter @escapesuite/artist exec vitest run
git diff --name-only
```

The last command must list no `*.perf.test.ts` file, no `*.rerender.test.tsx` file and not `src/test/fixtures/perfScene.ts`.

- [ ] **Step 6: Commit** — `docs(artist): crop mode on the canvas (ESCSUITE-157)`

---

## What the coordinator does after Task 6

1. `pnpm --filter @escapesuite/artist test:coverage` and write the coverage paragraph (constraint 2 keeps the implementer out of it). Expect branches to move most: `cropForHandleMove`'s two axis arms and `withAspect`'s three, `cropTarget`'s five conditions, `drawCropOverlay`'s element arm, `cropsEqual`, `e.repeat` and the `ARROW_STEPS` lookup — every one of them reached from both sides by the tests above.
2. Raise a floor only if a whole percent was crossed, and never lower one.
3. File the follow-ups this ticket deliberately did not take: a cropped clip on a keyframed placement shrinking about its centre (the ruled behaviour — a real improvement would keyframe the compensation, which means animating something the crop is not), ESCSUITE-147's chrome-under-a-transition gap, and the uncropped timeline thumbnail.
