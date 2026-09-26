# ESCSUITE-65 slice 1 — a mask and a stroke on every media clip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every **media** clip in ESCAPEARTIST can carry a static mask (`circle` or `rounded`) and a static stroke, drawn identically by the preview, the WebM export, the MP4 export, transitions and the headless renderer; the inspector offers both; and a webcam clip handed over from ESCAPECRAFT arrives with the circle *and* the white border it was recorded with, instead of a bare rectangle.

**Architecture:** Two new optional fields on `Clip` (`mask?: ClipMask`, `stroke?: ClipStroke`) declared in `src/store/types.ts`, and one new pure module, `src/core/clipMask.ts`, that owns the geometry (`maskPathFor`) and the two context-issuing helpers (`applyClipMask`, `applyClipStroke`). The two media draw functions in `src/core/canvasRenderer.ts` — `drawClipToCanvas` (line 325) and `drawImageToCanvasWithModifiers` (line 452) — call them between the point where `x`/`y`/`scaledWidth`/`scaledHeight` are known (385-386 / 510-511) and `drawImage` (389 / 514), which is after the rotation block (379-383 / 504-508) so the mask rotates with the clip. Every pipeline funnels through those two functions and nothing else (`drawFrame.ts:139`/`:152`, `exportWebM.ts:341`/`:347`, `exportMP4.ts:450` → `drawMediaWithFrame`, `drawTransition`/`drawTransitionWithFrames`), so writing the mask twice covers all five paths. The inspector gains one new component, `ClipEditor/MaskSection.tsx`, gated exactly as `BlendModeSection` is (`ClipEditor.tsx:105`), driving the **existing** `updateClip` action through two new handlers in `useClipEditorActions.ts`. The ESCAPECRAFT handoff gains `maskForPlacement` and `strokeForPlacement` in `src/utils/overlayPlacement.ts`, mapped in `store/clipSlice.ts`'s `placeTakeOnTimeline` beside the transform it already builds (now lines 152-154, not the spec's 137-139), and ESCAPECRAFT's `core/overlayGeometry.ts` names the two border literals it hard-codes four times so the two apps cannot drift.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (ten slices, `src/store/projectStore.ts` the only entry point), Vitest + Testing Library (jsdom) with `src/test/doubles/*` and `src/test/fixtures/*`, Playwright for e2e (slice 2 only), changesets for release notes.

**Spec:** `docs/superpowers/specs/2026-09-25-escsuite-65-clip-mask-design.md` — sections (a) through (h), with section (f) tasks **1–7** being this slice and the six operator decisions in section (g) binding. Read it before Task 1.

**Out of scope (slice 2 — do not build any of it here):** the masked timeline clip thumbnail and `utils/maskClipPath.ts` (spec task 8), the headless `frameCornerRGB`/`frameEdgeRGB` ffprobe siblings and the Chromium/e2e parity cases (task 9), and the documentation sweep — `apps/artist/CLAUDE.md`, `apps/craft/CLAUDE.md`, root `CLAUDE.md`, `ESCAPE-SUITE-DOCUMENTATION.md` (task 10). Also out of scope by decision: keyframing either field, text and shape overlays, and any change to the preview's rectangular selection box or hit test.

---

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure quoted in the step notes, before the implementation step. The steps below are ordered that way; do not reorder them. Task 1 is the one task whose red is a **typecheck** failure rather than a vitest failure, and it says so.
2. **Media clips only.** Text and shape overlays take neither field (decision 3). The inspector section is gated by `!isAudio && !isOverlay`, exactly as `BlendModeSection` is at `ClipEditor.tsx:105`. Nothing in `drawTextOverlayToCanvasAnimated` (canvasRenderer.ts:82) or the shape overlay draw is touched.
3. **Static, never keyframeable.** Neither `mask.kind`, `mask.radius` nor any stroke field joins `AnimatableProperty` (types.ts:95-103) or `ClipAnimation.keyframes` (types.ts:133-135), and neither passes through `getAnimatedValues`. `animationLookupsPerFrame` must not move (decision 4).
4. **Radius and stroke width are FRACTIONS, never pixels.** `mask.radius` is a fraction of the **clip's shorter drawn side** (0–0.5, decision 2). `stroke.width` is a fraction of the **frame width**, resolved against `canvasWidth` at draw time. A pixel count would silently change meaning the moment the project resolution changed, which ARTIST has a dialog for.
5. **The two media draw functions are the ONLY place the mask or the stroke is drawn.** `drawClipToCanvas` and `drawImageToCanvasWithModifiers` are near-duplicates; a mask added to one and not the other gives videos a mask and images none. Every assertion in Task 3 is written twice, once per function. No third call site, in this app or any other, and no `Path2D` allocation — pass numbers.
6. **`saves === restores`, exactly, in every combination**, and **a clip with neither mask nor stroke records exactly today's calls** — `['save', 'drawImage', 'restore']` for the plain case. Both are pinned in Task 3 and re-pinned per frame in Task 4. The mask costs no extra save/restore (both functions already `save()` at 339/465 and `restore()` at 392/516); the *stroke* is the only thing that adds an inner pair.
7. **The plain perf ceilings must not move.** Add a masked-and-stroked **variant** of the benchmark scene to `src/test/fixtures/perfScene.ts`; never edit `buildSceneClips()` or `SCENE_TRACKS`. The scene is shared with the real-browser benchmark (`apps/e2e/utils/perf.ts`) and the "same scene as the browser benchmark" contract is stated in that fixture's header, lines 1-16.
8. **`ClipEditor.rerender.test.tsx` counts unchanged.** No new store *state* subscription in `useClipEditorActions`, and **never `currentTime`** — the mask and stroke are read off `selectedClip`, which the panel already has, and the frame width off the `resolution` selector that already exists (useClipEditorActions.ts:126). The one selector this slice adds is `state.updateClip`, an **action**: its identity never changes, so it can cost no re-render, and the rerender suite running unchanged is the proof. If any count in that file moves, the section is subscribing to something it must not.
9. **`roundRect` has an `arcTo` fallback.** Safari gained `ctx.roundRect` only in 16.4 and `pnpm test:e2e:browsers` runs WebKit; a throw inside a preview frame kills the whole frame, not just the mask. `core/clipMask.ts` feature-detects and builds the rounded path from `moveTo` + four `arcTo` calls when it is missing. ESCAPECRAFT calls `roundRect` unconditionally (overlayGeometry.ts:193) but only in a Chromium-favoured recording path, so that is not precedent.
10. **Coverage floors only go up.** Artist's floors are **99 / 98 / 93 / 98** (lines/statements/branches/functions) against achieved 99.38 / 98.71 / 93.51 / 98.95; craft's are **100 / 99 / 97 / 100** against 100.00 / 99.46 / 97.55 / 100.00 (root `CLAUDE.md` table, lines 535-536). Every new line, every new branch and every new function must execute in a test — including `maskPathFor`'s degenerate-box arm, its `radius <= 0` arm, the `arcTo` fallback, `swatchValue`'s non-hex arm and each of `handleMaskChange`'s three arms. Finish with `pnpm --filter @escapesuite/artist test:coverage` and `pnpm --filter @escapesuite/craft test:coverage`; if a figure crosses a whole percent, raise the floor in `apps/artist/vite.config.ts` (line 224) **and** `scripts/coverage-report.mjs` **and** the root `CLAUDE.md` table. Never lower one.
11. **No existing test may be deleted or weakened, and a pure move stays byte-unchanged.** These files gain *inputs or cases only*, never looser assertions, and each change is named in the task that makes it: `src/test/doubles/canvas.ts` (two methods), `src/test/fixtures/perfScene.ts` (a variant builder), `src/components/Preview/drawFrame.perf.test.ts`, `src/core/exportMP4.perf.test.ts`, `src/core/canvasRenderer.clips.test.ts`, `src/components/ClipEditor/{clipEditorOptions.test.ts,useClipEditorActions.test.ts,ClipEditor.test.tsx,ClipEditor.overlay.test.tsx}`, `src/components/Preview/PreviewPlayer.rendering.test.tsx`, `src/store/projectStore.migration.test.ts`, `src/app/sessionSnapshot.test.ts`, `src/utils/overlayPlacement.test.ts`, `src/store/__tests__/projectStore.takePlacement.test.ts`. On the **craft** side Task 7 is a pure move: `apps/craft/src/core/{overlayGeometry,compositor,converter}.test.ts` and both craft perf tests must be **byte-unchanged**, and the task verifies that with `git diff --name-only`.
12. **Type-only declarations go in `src/store/types.ts`.** It is excluded from coverage `include` (`vite.config.ts`'s `'**/types.ts'`), so `ClipMask`, `ClipStroke`, `ClipMaskKind` and the two UI defaults live there — beside `DEFAULT_TRANSFORM` and `DEFAULT_SHAPE_OVERLAY_DATA`, which are the precedent for a constant in that file. A *new* type-only module would report 0% and break the lines floor.
13. **`DB_VERSION` stays 1 and no migration line is added.** Optional fields with `undefined === none` mean `ensureTimelineHasTracks` (`projectMigration.ts:48-65`) needs nothing: it only defaults fields the renderer dereferences unconditionally. The session snapshot carries `state.project` whole (`sessionSnapshot.ts:14`) and `cloneClip` is `structuredClone` (`utils/deepClone.ts`), so autosave, undo and duplicate all carry the new fields for free — Task 1 proves each.
14. **Typecheck and lint every task:** `pnpm --filter @escapesuite/artist typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/artist lint`; for Task 7 also `pnpm --filter @escapesuite/craft typecheck` and `pnpm --filter @escapesuite/craft lint`.
15. **No local Playwright.** Nothing in this slice runs or needs the e2e suite; the browser cases are slice 2's Task 9. Do not install browsers, do not run `pnpm test:e2e`.
16. **Every line number in this plan was verified against `main` at 53aa46e** and corrected where the spec had drifted. The corrections, for the record: `clipSlice.ts` `updateClip` is at **259** (spec said 243), its `pushToHistory` at **281** (265), the transform mapping in `placeTakeOnTimeline` at **152-154** (137-139); `utils/overlayPlacement.ts`'s "`shape` is read and **ignored**" sentence is at **111-112** (74-75), `OVERLAY_MARGIN_FRACTION` at **37** (23), `overlayWidth`/`overlayHeight` at **125**/**134** (88/97); the canvas double's method table is **139-168** with `ellipse` at 157, `rect` at 159 (spec said 150-162) and its type block **44-96** with `ellipse` at 59 and `clip` at 64 (59-64 ✓); craft `overlayGeometry.ts`'s circle radius is **143-145** (139-142), its centre-crop **153-179** (155-181), `borderRadius = 8` at **191** (167), `roundRect` at **193** (171), `COMPOSITOR_MAX_WIDTH` at **26** (27), and the two literals at **185-186** and **204-205** (✓ both); `apps/artist/CLAUDE.md`'s ESCSUITE-65 sentence is at **211-212** (205-206) and the shared-renderer claim at **658** (587) — both are slice 2's to edit, and slice 2 must use the corrected numbers. Everything else the spec quotes verified unchanged.
17. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

18. Branch `feat/escsuite-65-slice-1` off `main`. No push and no PR unless asked.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/core/clipMask.ts` | The mask and stroke geometry, and the only two functions that issue them to a context. Pure: numbers and a context in, calls out. No store, no React, no allocation |
| `apps/artist/src/core/clipMask.test.ts` | The maths: the inscribed circle, the clamped corner fraction, the degenerate cases that issue nothing, and the `arcTo` fallback |
| `apps/artist/src/components/ClipEditor/MaskSection.tsx` | The "Mask & Stroke" section of the clip inspector: the kind select, the corner-radius slider, the stroke-width slider labelled in pixels, and the stroke colour |
| `apps/artist/src/components/ClipEditor/MaskSection.test.tsx` | That section rendered on its own, against `vi.fn()` callbacks |
| `.changeset/artist-clip-mask.md` | `@escapesuite/artist: minor` |
| `.changeset/craft-overlay-border-constants.md` | `@escapesuite/craft: patch` |

**Modified**

| File | Change |
|---|---|
| `apps/artist/src/store/types.ts` | `ClipMaskKind`, `ClipMask`, `ClipStroke`, `DEFAULT_CLIP_MASK_RADIUS`, `DEFAULT_CLIP_STROKE_COLOR`; two optional fields on `Clip` |
| `apps/artist/src/store/projectStore.migration.test.ts` | One describe block: a pre-mask project loads with both fields absent |
| `apps/artist/src/app/sessionSnapshot.test.ts` | One case: both fields survive a snapshot round trip |
| `apps/artist/src/test/doubles/canvas.ts` | The recording context learns `roundRect` and `arcTo` |
| `apps/artist/src/core/canvasRenderer.ts` | The mask and stroke in both media draws, at 385-389 and 510-514 |
| `apps/artist/src/core/canvasRenderer.clips.test.ts` | Two describe blocks, one per draw function, plus the plain-clip pin |
| `apps/artist/src/test/fixtures/perfScene.ts` | `buildMaskedSceneClips()` / `buildMaskedSceneProject()` — a **variant**, never an edit |
| `apps/artist/src/components/Preview/drawFrame.perf.test.ts` | One masked-and-stroked ceiling case |
| `apps/artist/src/core/exportMP4.perf.test.ts` | `measureExport(clips)` takes the scene, plus one masked-and-stroked ceiling case |
| `apps/artist/src/components/ClipEditor/clipEditorOptions.ts` | `CLIP_MASK_KINDS` |
| `apps/artist/src/components/ClipEditor/clipEditorOptions.test.ts` | One case for that table's order |
| `apps/artist/src/components/ClipEditor/useClipEditorActions.ts` | `frameWidth`, `handleMaskChange`, `handleStrokeChange`, and the `updateClip` action selector |
| `apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts` | `'updateClip'` joins `ACTIONS`; five cases |
| `apps/artist/src/components/ClipEditor/ClipEditor.tsx` | `<MaskSection>` under the `!isAudio && !isOverlay` guard, after `BlendModeSection` |
| `apps/artist/src/components/ClipEditor/ClipEditor.test.tsx` | The media-clip and audio-clip cases mention the new section |
| `apps/artist/src/components/ClipEditor/ClipEditor.overlay.test.tsx` | The overlay case mentions it too |
| `apps/artist/src/components/Preview/PreviewPlayer.rendering.test.tsx` | Two cases: preview/export parity, and a masked clip drawn after a blur shape |
| `apps/artist/src/utils/overlayPlacement.ts` | `OVERLAY_CORNER_RADIUS_FRACTION`, `OVERLAY_STROKE_WIDTH_FRACTION`, `OVERLAY_STROKE_COLOR`, `maskForPlacement`, `strokeForPlacement`, a private `overlayBoxFor`, and the corrected doc sentence at 111-112 |
| `apps/artist/src/utils/overlayPlacement.test.ts` | One describe block per new function |
| `apps/artist/src/store/clipSlice.ts` | The mask and stroke beside the transform at 152-154 |
| `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts` | Two cases: the webcam clip carries both, the primary carries neither |
| `apps/craft/src/core/overlayGeometry.ts` | `OVERLAY_BORDER_COLOR`, `OVERLAY_BORDER_WIDTH`, `OVERLAY_CORNER_RADIUS` — a pure move, tests byte-unchanged |
| `apps/artist/vite.config.ts`, `scripts/coverage-report.mjs`, `CLAUDE.md` | Only if a whole-percent floor rises |

---

### Task 1: `ClipMask` + `ClipStroke`, the defaults, and the storage hygiene

**Files:**
- Modify: `apps/artist/src/store/types.ts` (a block after the `Clip` interface, which ends at line 338; two fields inside `Clip`, after `effects` at line 326)
- Modify: `apps/artist/src/store/projectStore.migration.test.ts` (one describe block, after the `setProject migration` block)
- Modify: `apps/artist/src/app/sessionSnapshot.test.ts` (one case)

**Interfaces:**
- Consumes: nothing new. `Clip` and the existing `updateClip`/`duplicateClip` actions.
- Produces, all in `apps/artist/src/store/types.ts`:
  ```ts
  export type ClipMaskKind = 'none' | 'circle' | 'rounded';
  export interface ClipMask { kind: ClipMaskKind; radius?: number }
  export interface ClipStroke { color: string; width: number }
  export const DEFAULT_CLIP_MASK_RADIUS = 0.05;
  export const DEFAULT_CLIP_STROKE_COLOR = '#ffffff';
  ```
  and on `Clip`:
  ```ts
  mask?: ClipMask;
  stroke?: ClipStroke;
  ```

**Five things this task pins, all argued in the commit message:**

- **Static properties on `Clip`, not members of `ClipTransform`.** Every field of `ClipTransform` (types.ts:38-47) is a number fed through `getAnimatedValues`, and every one of them is an `AnimatableProperty` (types.ts:95-103). An enum in there would put a non-interpolable value inside the interpolator and force a `DEFAULT_TRANSFORM` change (types.ts:49-58) that every fixture and the migration at `projectMigration.ts:54` reads.
- **Not keyframeable, and not "for free".** `radius` is a number, but keyframing it costs an `AnimatableProperty` member, a `ClipAnimation.keyframes` key, a row and a curve in the keyframe panel, and a field on the `animated` object both renderers read. `kind` cannot be interpolated at all, so a keyframed radius with a static kind is a half-feature (decision 4).
- **Absent is the only way to say "none".** `mask === undefined` means no mask and `stroke === undefined` means no stroke, and the inspector's handlers (Task 5) normalise to `undefined` rather than writing `{ kind: 'none' }` or `{ width: 0 }` — so a clip that has never been masked and one whose mask was removed are the same object, and `toEqual` comparisons against pre-mask fixtures keep passing.
- **No migration, and `DB_VERSION` stays 1.** `ensureTimelineHasTracks` only defaults fields the renderer dereferences unconditionally; these two are read through `clip.mask?.kind ?? 'none'`. The mask lives inside the project blob, not a new object store.
- **`ClipStroke` deliberately echoes `ShapeOverlayData`'s vocabulary** (`strokeColor`/`strokeWidth`, types.ts:196-210, defaulting to `'#ffffff'` / `0`) so the two read alike — but it is its own object on the clip, because a shape overlay's stroke belongs to its drawn shape and a media clip's belongs to its mask outline. `DEFAULT_CLIP_STROKE_COLOR` is that same `'#ffffff'`, for the same reason.

- [ ] **Step 1: Write the failing hygiene tests** — append a describe block to `apps/artist/src/store/projectStore.migration.test.ts`, after the closing `})` of the `describe('setProject migration', ...)` block

```ts
  describe('a mask and a stroke through storage (ESCSUITE-65)', () => {
    /** A project as every ARTIST before ESCSUITE-65 wrote it: clips with no mask field. */
    const preMaskProject = (): Project => ({
      id: 'p',
      name: 'Pre-mask',
      created: 1,
      modified: 1,
      resolution: { width: 1920, height: 1080 },
      timeline: {
        tracks: [
          { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
        ],
        clips: [
          {
            id: 'old-clip',
            sourceVideoId: 'video1',
            name: 'old-clip',
            startTime: 0,
            endTime: 2,
            duration: 2,
            trackId: 't1',
            timelinePosition: 0,
            blendMode: 'normal',
            transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
            effects: { blur: 0 },
            transition: { type: 'none', duration: 0.5 },
          },
        ],
        textOverlays: [],
        shapeOverlays: [],
        duration: 2,
      },
    })

    it('loads a pre-mask project with neither field, not with a default one', () => {
      store().setProject(preMaskProject())

      const clip = store().project.timeline.clips[0]
      // Absent, not `{ kind: 'none' }`: `undefined === none` is the whole reason
      // `ensureTimelineHasTracks` needs no new line for this feature, and it is
      // what keeps a clip that has never been masked identical to one whose mask
      // was removed. The unmasked *draw* is pinned in
      // core/canvasRenderer.clips.test.ts, which asserts such a clip records
      // exactly the three calls it has always recorded.
      expect(clip.mask).toBeUndefined()
      expect(clip.stroke).toBeUndefined()
      expect('mask' in clip).toBe(false)
      expect('stroke' in clip).toBe(false)
    })

    it('carries both fields through the existing updateClip action and its undo step', () => {
      store().setProject(preMaskProject())
      store().clearHistory()

      store().updateClip('old-clip', {
        mask: { kind: 'rounded', radius: 0.1 },
        stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
      })

      const clip = store().project.timeline.clips[0]
      expect(clip.mask).toEqual({ kind: 'rounded', radius: 0.1 })
      expect(clip.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 })
      // `updateClip` already pushes history (clipSlice.ts:281), which is why this
      // feature needs no new store action and no new member in ClipSlice's Pick.
      expect(store().history.past).toHaveLength(1)

      store().undo()

      expect(store().project.timeline.clips[0].mask).toBeUndefined()
      expect(store().project.timeline.clips[0].stroke).toBeUndefined()
    })

    it('carries both fields onto a duplicated clip', () => {
      store().setProject(preMaskProject())
      store().updateClip('old-clip', {
        mask: { kind: 'circle' },
        stroke: { color: '#ff0000', width: 0.004 },
      })

      store().duplicateClip('old-clip')

      // `cloneClip` is `structuredClone` (utils/deepClone.ts), so this holds by
      // construction rather than by a field list somebody has to remember to
      // extend — which is exactly why it is worth one test.
      const copy = store().project.timeline.clips.find((c) => c.id !== 'old-clip')!
      expect(copy.mask).toEqual({ kind: 'circle' })
      expect(copy.stroke).toEqual({ color: '#ff0000', width: 0.004 })
    })
  })
```

- [ ] **Step 2: Write the failing snapshot case** — append to the `describe('buildSessionSnapshot', ...)` block in `apps/artist/src/app/sessionSnapshot.test.ts`

```ts
  it('carries a clip mask and stroke through, because it carries the project whole', () => {
    const clip = addClip('clip1', 0);
    store().updateClip(clip.id, {
      mask: { kind: 'circle' },
      stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
    });

    const snapshot = buildSessionSnapshot(useEditorStore.getState(), 1);

    // The snapshot is `state.project` by reference, so autosave and restore get
    // ESCSUITE-65 for free and `DB_VERSION` stays 1. Asserted rather than
    // assumed: a future snapshot that picked fields out of the project one by
    // one would drop these two silently.
    const restored = snapshot.project.timeline.clips[0];
    expect(restored.mask).toEqual({ kind: 'circle' });
    expect(restored.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 });
  });
```

- [ ] **Step 3: Run them — vitest passes, the typecheck is the red**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/projectStore.migration.test.ts src/app/sessionSnapshot.test.ts`
Expected: **PASS**. Record that, and why: `updateClip` takes `Partial<Clip>` and spreads it, so at runtime an unknown field lands and reads back. Vitest does not type-check, so these tests cannot go red on a missing type. That is not a reason to skip the red step — it is a reason for the red step to be the typechecker.

Run: `pnpm --filter @escapesuite/artist typecheck`
Expected: **FAIL** — `error TS2353: Object literal may only specify known properties, and 'mask' does not exist in type 'Partial<Clip>'.` at the `updateClip` call in `projectStore.migration.test.ts`, and the matching `TS2339: Property 'mask' does not exist on type 'Clip'.` at each `clip.mask` read. Quote the first of them in the step notes.

- [ ] **Step 4: Declare the types**

In `apps/artist/src/store/types.ts`, immediately **after** the `Clip` interface's closing brace (line 338) and before the `TakeClipPart` block:

```ts
/**
 * Which shape a media clip's picture is masked to (ESCSUITE-65).
 *
 * `'none'` exists so the inspector's `<select>` has a value for "no mask"; it is
 * never *stored* — `clip.mask === undefined` is how a clip says it has none, so
 * a clip that was never masked and one whose mask was removed are the same
 * object. `CLIP_MASK_KINDS` in `components/ClipEditor/clipEditorOptions.ts` is
 * the table the dropdown is built from, in the order the user sees.
 */
export type ClipMaskKind = 'none' | 'circle' | 'rounded';

/**
 * A media clip's mask: **static, and deliberately not keyframeable** (decision 4).
 *
 * Not a member of `ClipTransform`, because every field there is a number fed
 * through `getAnimatedValues` and every one of them is an `AnimatableProperty` —
 * an enum in there would put a non-interpolable value inside the interpolator
 * and force a `DEFAULT_TRANSFORM` change that every fixture and the migration in
 * `projectMigration.ts` reads. `kind` cannot be interpolated at all, so a
 * keyframed radius with a static kind would be a half-feature.
 */
export interface ClipMask {
  kind: ClipMaskKind;
  /**
   * Corner radius as a **fraction of the clip's shorter drawn side**, 0 to 0.5,
   * and read for `'rounded'` only (decision 2).
   *
   * A fraction rather than a pixel count for the same reason
   * `OVERLAY_MARGIN_FRACTION` is one (`utils/overlayPlacement.ts`): ARTIST has a
   * resolution-change dialog, and a pixel count would silently change the
   * rounding the moment the project resolution moved. 0.5 is a stadium; anything
   * above it is clamped to it by `core/clipMask.ts`.
   */
  radius?: number;
}

/**
 * A media clip's outline: the mask's own edge, or the picture's rectangle when
 * there is no mask (decision 6).
 *
 * The words are `ShapeOverlayData`'s (`strokeColor` / `strokeWidth`, defaulting
 * to `'#ffffff'` / `0`) so the two vocabularies read alike, but this is its own
 * object on the clip: a shape overlay's stroke belongs to its drawn shape, a
 * media clip's belongs to its mask.
 */
export interface ClipStroke {
  /** Any CSS colour string, stored as given — including the `rgba()` ESCAPECRAFT hands over. */
  color: string;
  /**
   * Line width as a **fraction of the frame width**, resolved against the
   * canvas at draw time. ESCAPECRAFT's border is 3 px *of a 1280-wide canvas*,
   * and a pixel count would change meaning at another resolution. 0 is no
   * stroke, but the inspector writes `undefined` rather than `{ width: 0 }`.
   */
  width: number;
}

/** The corner radius a mask starts at when the user first picks "Rounded Rectangle". */
export const DEFAULT_CLIP_MASK_RADIUS = 0.05;

/**
 * The colour a stroke starts at, and what an `<input type="color">` shows for a
 * stored colour it cannot represent — `ShapeOverlayData`'s own stroke default.
 */
export const DEFAULT_CLIP_STROKE_COLOR = '#ffffff';
```

and inside `Clip`, immediately after `effects: ClipEffects;` (line 326):

```ts
  // Mask and stroke (ESCSUITE-65). Static — never keyframed, never animated.
  // Media clips only: text and shape overlays have no drawn box either could
  // mean anything against. Absent means none for both.
  mask?: ClipMask;
  stroke?: ClipStroke;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/projectStore.migration.test.ts src/app/sessionSnapshot.test.ts`
Expected: PASS — 13 tests in the migration file (the ten already there plus three), 3 in the snapshot file.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0. The typecheck passing is the green half of Step 3's red.

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store`
Expected: PASS — every pre-existing store suite, unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/projectStore.migration.test.ts \
  apps/artist/src/app/sessionSnapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(artist): a clip can carry a mask and a stroke (ESCSUITE-65)

Two optional fields on Clip: mask?: { kind: 'none' | 'circle' | 'rounded';
radius? } and stroke?: { color; width }. Static, and deliberately not in
ClipTransform — every field there is a number fed through getAnimatedValues and
every one of them is an AnimatableProperty, so an enum in there would put a
non-interpolable value inside the interpolator and force a DEFAULT_TRANSFORM
change that every fixture and the migration read. kind cannot be interpolated at
all, so a keyframed radius with a static kind would be a half-feature.

The radius is a fraction of the clip's shorter side and the stroke width a
fraction of the frame width, never pixels: ARTIST has a resolution-change dialog
and a pixel count would silently change the rounding and the border weight the
moment the project resolution moved.

No migration and DB_VERSION stays 1. `undefined === none` means
ensureTimelineHasTracks needs no new line — it only defaults fields the renderer
dereferences unconditionally — and the mask lives inside the project blob rather
than a new object store. The three things that carry state around already carry
these: the session snapshot takes state.project whole, cloneClip is
structuredClone, and updateClip spreads a Partial<Clip> and pushes history, so
this feature needs no new store action. Each is pinned rather than assumed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 2: `core/clipMask.ts`, and the canvas double learns `roundRect` and `arcTo`

**Files:**
- Create: `apps/artist/src/core/clipMask.ts`
- Create: `apps/artist/src/core/clipMask.test.ts`
- Modify: `apps/artist/src/test/doubles/canvas.ts` (the type block at 44-96, after `readonly rect` on line 61; the method table at 139-168, after `rect: record('rect')` on line 159)

**Interfaces:**
- Consumes: `ClipMask`, `ClipMaskKind`, `ClipStroke` from `../store/types` (Task 1).
- Produces, all in `apps/artist/src/core/clipMask.ts`:
  ```ts
  export type MaskPath =
    | { shape: 'rect'; x: number; y: number; width: number; height: number }
    | { shape: 'circle'; centreX: number; centreY: number; radius: number }
    | { shape: 'rounded'; x: number; y: number; width: number; height: number; radius: number };

  export function maskPathFor(
    kind: ClipMaskKind,
    radius: number | undefined,
    x: number,
    y: number,
    width: number,
    height: number
  ): MaskPath;

  export function visibleClipStroke(stroke: ClipStroke | undefined): ClipStroke | undefined;

  export function applyClipMask(
    ctx: CanvasRenderingContext2D,
    mask: ClipMask | undefined,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;

  export function applyClipStroke(
    ctx: CanvasRenderingContext2D,
    stroke: ClipStroke | undefined,
    mask: ClipMask | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
    frameWidth: number
  ): void;
  ```

**Five decisions this task pins, all argued in the commit message:**

- **One module for the maths, so the two call sites cannot drift.** `drawClipToCanvas` and `drawImageToCanvasWithModifiers` are near-duplicates; the spec's own risk list names "adding the mask to one and not the other" as the way this feature breaks. The geometry lives here, is unit-tested here, and each call site is four lines of plumbing.
- **`maskPathFor` always answers a path, and `'rect'` is how it says "nothing to mask".** A rectangle the size of the drawn box *is* the drawn box, so `applyClipMask` returns without issuing a call — and the same `'rect'` is exactly what a stroke on an unmasked clip needs to trace. One function, two readers, no second "is there a mask" rule to keep in step.
- **Three calls for a mask, and no `closePath()`.** `beginPath()` + one of `ellipse()`/`roundRect()` + `clip()`. `clip()` closes the path implicitly, so a `closePath()` would be a fourth call per masked clip per frame for nothing. ESCAPECRAFT's own draw does call it (overlayGeometry.ts:150/194); that is a cost worth not copying.
- **`ellipse`, not `arc`, and the circle is inscribed.** `ellipse` takes the same numbers and keeps the door open for a future `'ellipse'` kind without a second code path. Both radii are `min(width, height) / 2` centred on the box — the inscribed circle, which is what the user saw in ESCAPECRAFT (overlayGeometry.ts:143-145) and what decision 1 fixes. Not a box-filling ellipse.
- **The rounded path is built from `arcTo` when `roundRect` is missing.** Safari gained `roundRect` in 16.4 and `pnpm test:e2e:browsers` runs WebKit. A throw here kills the whole preview frame, not just the mask, so the fallback is a correctness path — and it costs five calls rather than one, which is why the ceilings in Task 4 are measured with `roundRect` present and say so.

- [ ] **Step 1: Write the failing test** — create `apps/artist/src/core/clipMask.test.ts`

```ts
// The mask and stroke geometry, on its own (ESCSUITE-65).
//
// Everything here is arithmetic over a drawn rectangle, so it is tested without
// a clip, without a renderer and without a store — `core/canvasRenderer.ts` is
// the only caller, and Task 3's tests assert that it calls these in the right
// place. The context is the recording double, reached directly rather than
// through a canvas element, because these functions take a context and create
// nothing.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyClipMask,
  applyClipStroke,
  maskPathFor,
  visibleClipStroke,
} from './clipMask'
import {
  createRecordingContext,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'

/** The drawn box every case below masks: 200x100 at (50, 30), so min = 100. */
const BOX = { x: 50, y: 30, width: 200, height: 100 } as const

let ctx: RecordingCanvasRenderingContext2D

const asCtx = () => ctx as unknown as CanvasRenderingContext2D

beforeEach(() => {
  ctx = createRecordingContext()
})

describe('maskPathFor', () => {
  it('inscribes the circle in the box, centred on it', () => {
    // Decision 1: min(w, h) / 2, the circle the user saw in ESCAPECRAFT
    // (overlayGeometry.ts:143-145). Not a box-filling ellipse — a separate
    // 'ellipse' kind can be added later if that is ever wanted.
    expect(maskPathFor('circle', undefined, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'circle',
      centreX: 150,
      centreY: 80,
      radius: 50,
    })
  })

  it('reads the rounded radius as a fraction of the shorter side', () => {
    // 0.2 x min(200, 100) = 20 canvas pixels. A fraction rather than pixels
    // because ARTIST can change a project's resolution under a clip.
    expect(maskPathFor('rounded', 0.2, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'rounded',
      x: 50,
      y: 30,
      width: 200,
      height: 100,
      radius: 20,
    })
  })

  it('clamps the rounded radius at half the shorter side', () => {
    // Half the shorter side is a stadium; past it a real roundRect throws
    // IndexSizeError, which inside a preview frame would kill the frame.
    expect(maskPathFor('rounded', 4, BOX.x, BOX.y, BOX.width, BOX.height)).toMatchObject({
      shape: 'rounded',
      radius: 50,
    })
  })

  it.each([
    ['no mask at all', 'none' as const, 0.2],
    ['a rounded mask whose radius is zero', 'rounded' as const, 0],
    ['a rounded mask with no radius stored', 'rounded' as const, undefined],
    ['a rounded mask with a negative radius', 'rounded' as const, -0.5],
  ])('answers the plain rectangle for %s', (_label, kind, radius) => {
    // The rectangle *is* the drawn box, which is how this says "nothing to
    // mask" — and it is also exactly the outline a stroke on an unmasked clip
    // needs to trace, so there is one rule here and not two.
    expect(maskPathFor(kind, radius, BOX.x, BOX.y, BOX.width, BOX.height)).toEqual({
      shape: 'rect',
      x: 50,
      y: 30,
      width: 200,
      height: 100,
    })
  })

  it.each([
    ['no width', 0, 100],
    ['no height', 200, 0],
    ['a negative width', -200, 100],
  ])('answers the plain rectangle for a box with %s', (_label, width, height) => {
    // A clip at scale 0 has no outline. A circle of radius 0 would clip the
    // whole frame away, which looks like the renderer breaking rather than like
    // a clip nobody can see.
    expect(maskPathFor('circle', undefined, BOX.x, BOX.y, width, height)).toMatchObject({
      shape: 'rect',
    })
  })
})

describe('applyClipMask', () => {
  it('issues exactly beginPath, ellipse and clip for a circle', () => {
    applyClipMask(asCtx(), { kind: 'circle' }, BOX.x, BOX.y, BOX.width, BOX.height)

    // Three calls, and no closePath(): clip() closes the path implicitly, so a
    // fourth call per masked clip per frame would buy nothing. ESCAPECRAFT's own
    // draw does call it; that is a cost worth not copying.
    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'ellipse', 'clip'])
    expect(ctx.argsFor('ellipse')[0]).toEqual([150, 80, 50, 50, 0, 0, Math.PI * 2])
  })

  it('issues exactly beginPath, roundRect and clip for a rounded mask', () => {
    applyClipMask(asCtx(), { kind: 'rounded', radius: 0.2 }, BOX.x, BOX.y, BOX.width, BOX.height)

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'roundRect', 'clip'])
    expect(ctx.argsFor('roundRect')[0]).toEqual([50, 30, 200, 100, 20])
  })

  it.each([
    ['an absent mask', undefined],
    ['a mask of kind none', { kind: 'none' as const }],
    ['a rounded mask with no radius', { kind: 'rounded' as const }],
  ])('touches the context not at all for %s', (_label, mask) => {
    applyClipMask(asCtx(), mask, BOX.x, BOX.y, BOX.width, BOX.height)

    // Not "issues a rect and clips to it": a clip with no mask must record
    // exactly what it recorded before ESCSUITE-65 existed, which is what the
    // canvasRenderer tests and the perf ceilings both hold to.
    expect(ctx.calls).toEqual([])
  })

  it('builds the rounded path from arcTo when the browser has no roundRect', () => {
    // Safari gained roundRect in 16.4 and `pnpm test:e2e:browsers` runs WebKit.
    // A throw inside a preview frame kills the whole frame, not just the mask,
    // so this is a correctness path rather than an optimisation — and it costs
    // five calls instead of one, which is why the perf ceilings are measured
    // with roundRect present.
    const withoutRoundRect = { ...(ctx as object) } as RecordingCanvasRenderingContext2D
    delete (withoutRoundRect as unknown as Record<string, unknown>).roundRect

    applyClipMask(
      withoutRoundRect as unknown as CanvasRenderingContext2D,
      { kind: 'rounded', radius: 0.2 },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height
    )

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'beginPath',
      'moveTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'arcTo',
      'clip',
    ])
    // Clockwise from the top edge, each corner turning into the next: the same
    // rectangle roundRect(50, 30, 200, 100, 20) describes.
    expect(ctx.argsFor('moveTo')[0]).toEqual([70, 30])
    expect(ctx.argsFor('arcTo')).toEqual([
      [250, 30, 250, 130, 20],
      [250, 130, 50, 130, 20],
      [50, 130, 50, 30, 20],
      [50, 30, 250, 30, 20],
    ])
  })
})

describe('visibleClipStroke', () => {
  it.each([
    ['no stroke', undefined],
    ['a stroke of zero width', { color: '#ffffff', width: 0 }],
    ['a stroke of negative width', { color: '#ffffff', width: -1 }],
  ])('answers undefined for %s', (_label, stroke) => {
    expect(visibleClipStroke(stroke)).toBeUndefined()
  })

  it('answers the stroke itself when it has width', () => {
    const stroke = { color: '#ff0000', width: 0.002 }
    expect(visibleClipStroke(stroke)).toBe(stroke)
  })
})

describe('applyClipStroke', () => {
  it('traces the mask outline and strokes it, in frame-width pixels', () => {
    applyClipStroke(
      asCtx(),
      { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
      { kind: 'circle' },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'ellipse', 'stroke'])
    // ESCAPECRAFT's 3 px is 3 px of a 1280-wide canvas, so the fraction resolves
    // to exactly 3 at 1280 and scales with the project from there.
    const [state] = ctx.stateFor('stroke')
    expect(state.lineWidth).toBe(3)
    expect(state.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
  })

  it('scales the line width with the frame', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 3 / 1280 },
      undefined,
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1920
    )

    expect(ctx.stateFor('stroke')[0].lineWidth).toBeCloseTo(4.5, 10)
  })

  it('traces the plain rectangle when the clip has no mask', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 0.01 },
      undefined,
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    // Decision 6: the stroke goes on the mask's outline, or on the picture's own
    // rectangle when there is no mask. A border round an unmasked clip is a
    // feature in its own right, not a fallback.
    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'rect', 'stroke'])
    expect(ctx.argsFor('rect')[0]).toEqual([50, 30, 200, 100])
  })

  it('traces the rounded outline for a rounded mask', () => {
    applyClipStroke(
      asCtx(),
      { color: '#ffffff', width: 0.01 },
      { kind: 'rounded', radius: 0.2 },
      BOX.x,
      BOX.y,
      BOX.width,
      BOX.height,
      1280
    )

    expect(ctx.calls.map((c) => c.method)).toEqual(['beginPath', 'roundRect', 'stroke'])
    expect(ctx.argsFor('roundRect')[0]).toEqual([50, 30, 200, 100, 20])
  })

  it.each([
    ['no stroke', undefined],
    ['a stroke of zero width', { color: '#ffffff', width: 0 }],
  ])('touches the context not at all for %s', (_label, stroke) => {
    applyClipStroke(asCtx(), stroke, { kind: 'circle' }, BOX.x, BOX.y, BOX.width, BOX.height, 1280)

    expect(ctx.calls).toEqual([])
  })

  it('touches the context not at all for a box with no area', () => {
    applyClipStroke(asCtx(), { color: '#ffffff', width: 0.01 }, { kind: 'circle' }, BOX.x, BOX.y, 0, 0, 1280)

    // maskPathFor answers a zero-area rectangle here, and stroking that would
    // paint a line where the user sees nothing at all.
    expect(ctx.calls).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/clipMask.test.ts`
Expected: FAIL — `Failed to resolve import "./clipMask" from "src/core/clipMask.test.ts"`.

- [ ] **Step 3: Teach the canvas double the two methods it is missing**

In `apps/artist/src/test/doubles/canvas.ts`, in the `RecordingCanvasRenderingContext2D` interface, immediately after `readonly rect` (line 61):

```ts
  readonly roundRect: ReturnType<typeof vi.fn>
  readonly arcTo: ReturnType<typeof vi.fn>
```

and in the method table, immediately after `rect: record('rect'),` (line 159):

```ts
    roundRect: record('roundRect'),
    arcTo: record('arcTo'),
```

Nothing else in the file changes. This is a capability the double gains, not an assertion that moves — without `roundRect` the rounded mask cannot be *recorded* at all, and without `arcTo` the WebKit fallback cannot be. `apps/craft/src/test/doubles/canvas.ts` has had `roundRect` since ESCSUITE-14 (its lines 38 and 92); this brings ARTIST's double level with it.

- [ ] **Step 4: Implement the module**

Create `apps/artist/src/core/clipMask.ts`:

```ts
// A media clip's mask and its stroke: the geometry, and the only two functions
// that issue either to a canvas context (ESCSUITE-65).
//
// It lives on its own because two near-duplicate functions draw every media
// clip in this editor — `drawClipToCanvas` and `drawImageToCanvasWithModifiers`
// in `core/canvasRenderer.ts` — and a mask added to one and not the other would
// give videos a mask and images none. Every pipeline funnels through those two
// (the preview, both exports, both transition paths and the headless renderer),
// so the mask written twice there is the mask drawn everywhere, and the maths
// written once here is the maths tested once here.
//
// Pure: it reads its arguments and calls the context. No clip, no store, no
// element lookup, and no allocation in the hot path beyond the small path object
// — numbers are passed to the context rather than built into a `Path2D`.
import type { ClipMask, ClipMaskKind, ClipStroke } from '../store/types';

/**
 * A mask outline for a drawn box, in canvas pixels.
 *
 * `'rect'` is how this says **there is nothing to mask**: a rectangle the size
 * of the drawn box is the drawn box. It is also exactly the outline a stroke on
 * an *unmasked* clip needs (decision 6), so one function answers both questions
 * and there is no second "is there a mask" rule to keep in step.
 */
export type MaskPath =
  | { shape: 'rect'; x: number; y: number; width: number; height: number }
  | { shape: 'circle'; centreX: number; centreY: number; radius: number }
  | { shape: 'rounded'; x: number; y: number; width: number; height: number; radius: number };

/**
 * The outline a mask of this kind describes inside the box `(x, y, width,
 * height)` — the rectangle the clip's picture is about to be drawn into.
 *
 * The circle is **inscribed**: `min(width, height) / 2`, centred on the box.
 * That is the circle a user saw in ESCAPECRAFT (`drawOverlay`,
 * `apps/craft/src/core/overlayGeometry.ts:143-145`) and what decision 1 fixes;
 * a box-filling ellipse would be a different feature and can be a `kind` of its
 * own if it is ever wanted.
 *
 * The rounded radius arrives as a **fraction of the shorter side** and comes
 * back in canvas pixels, clamped to half the shorter side — past that a real
 * `roundRect` throws `IndexSizeError`, and inside a preview frame that kills the
 * whole frame rather than just the mask.
 */
export function maskPathFor(
  kind: ClipMaskKind,
  radius: number | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): MaskPath {
  const rect = { shape: 'rect' as const, x, y, width, height };

  // A clip at scale 0 has no outline. A circle of radius 0 would clip the whole
  // frame away, which looks like the renderer breaking rather than like a clip
  // nobody can see.
  if (width <= 0 || height <= 0) return rect;

  const shorter = Math.min(width, height);

  if (kind === 'circle') {
    return {
      shape: 'circle',
      centreX: x + width / 2,
      centreY: y + height / 2,
      radius: shorter / 2,
    };
  }

  if (kind === 'rounded') {
    const corner = Math.min((radius ?? 0) * shorter, shorter / 2);
    // A rounded rectangle with square corners is a rectangle: nothing to mask,
    // and nothing for a stroke to trace but the box itself.
    return corner > 0 ? { shape: 'rounded', x, y, width, height, radius: corner } : rect;
  }

  return rect;
}

/**
 * The rounded rectangle, from `arcTo` when the browser has no `roundRect`.
 *
 * Safari gained `roundRect` in 16.4 and the e2e suite runs WebKit
 * (`pnpm test:e2e:browsers`). ESCAPECRAFT calls it unconditionally, but only in
 * a Chromium-favoured recording path; here a throw would take out the whole
 * preview frame. Clockwise from the top edge, each corner turning into the
 * next; the fourth `arcTo` lands back where `moveTo` started, so no closing
 * `lineTo` is needed.
 *
 * Five calls rather than one, which is why the per-frame ceilings in
 * `drawFrame.perf.test.ts` and `exportMP4.perf.test.ts` are measured with
 * `roundRect` present — as all three engines the e2e suite runs have it.
 */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
}

/**
 * Trace `path` into the current path. Two calls for a circle or a rectangle:
 * `beginPath` and the shape.
 *
 * `ellipse` rather than `arc` for the circle: it takes the same numbers, and a
 * future `'ellipse'` kind would need no second code path.
 */
function traceMaskPath(ctx: CanvasRenderingContext2D, path: MaskPath): void {
  ctx.beginPath();
  if (path.shape === 'circle') {
    ctx.ellipse(path.centreX, path.centreY, path.radius, path.radius, 0, 0, Math.PI * 2);
  } else if (path.shape === 'rounded') {
    traceRoundedRect(ctx, path.x, path.y, path.width, path.height, path.radius);
  } else {
    ctx.rect(path.x, path.y, path.width, path.height);
  }
}

/**
 * The stroke a clip really draws, or `undefined`.
 *
 * One definition of "visible", read by `applyClipStroke` and by the two draw
 * functions — which need the answer *before* the image, because the inner
 * `save()`/`restore()` pair that lets the stroke escape the clip region is the
 * only extra state operation this feature adds and it exists for the stroke
 * alone. A masked, unstroked clip pays no save and no restore.
 */
export function visibleClipStroke(stroke: ClipStroke | undefined): ClipStroke | undefined {
  return stroke !== undefined && stroke.width > 0 ? stroke : undefined;
}

/**
 * Clip the context to `mask` over the box the clip's picture is about to fill.
 *
 * Three recorded calls when there is a mask — `beginPath`, the shape, `clip` —
 * and **none at all** when there is not, which is what keeps a clip with no
 * mask recording exactly what it recorded before this feature existed.
 *
 * No `closePath()`: `clip()` closes the path implicitly, so it would be a fourth
 * call per masked clip per frame for nothing.
 *
 * Called *inside* the two draw functions' existing `save()`/`restore()` pair and
 * *after* their rotation block, so the mask rotates with the clip and needs no
 * save of its own. A wipe transition's own `clip()` is still in effect, and the
 * two clip regions intersect, which is the correct composition.
 */
export function applyClipMask(
  ctx: CanvasRenderingContext2D,
  mask: ClipMask | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const path = maskPathFor(mask?.kind ?? 'none', mask?.radius, x, y, width, height);
  // The box clipped to its own rectangle is the box: nothing to do, and nothing
  // recorded.
  if (path.shape === 'rect') return;
  traceMaskPath(ctx, path);
  ctx.clip();
}

/**
 * Stroke the mask's own outline — or the picture's rectangle when there is no
 * mask (decision 6).
 *
 * Called **after** the image and after the clip region has been dropped, so no
 * half of the line is eaten by the mask. ESCAPECRAFT does the same thing the
 * same way (`overlayGeometry.ts:182-187` restores, re-traces the path and
 * strokes it), which is why a handed-over webcam clip looks like the recording.
 *
 * `strokeStyle` is the stored colour as given, including the `rgba()` the
 * handoff carries. The line width is `stroke.width x frameWidth`: the export
 * canvas *is* the project resolution and the preview canvas scales uniformly
 * through the CTM, so one number serves both. (Unlike `ctx.filter`, whose
 * lengths the CTM does not reach — see `MediaDrawOptions.filterScale`.)
 */
export function applyClipStroke(
  ctx: CanvasRenderingContext2D,
  stroke: ClipStroke | undefined,
  mask: ClipMask | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  frameWidth: number
): void {
  const visible = visibleClipStroke(stroke);
  if (!visible) return;

  const path = maskPathFor(mask?.kind ?? 'none', mask?.radius, x, y, width, height);
  // A clip the user cannot see gets no outline either: a zero-area box would
  // otherwise be stroked into a visible line across nothing.
  if (width <= 0 || height <= 0) return;

  traceMaskPath(ctx, path);
  ctx.lineWidth = visible.width * frameWidth;
  ctx.strokeStyle = visible.color;
  ctx.stroke();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/clipMask.test.ts`
Expected: PASS — 22 tests (the four `maskPathFor` rectangle cases, three degenerate-box cases, three `applyClipMask` no-op cases, three `visibleClipStroke` cases and two `applyClipStroke` no-op cases are `it.each` groups).

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core src/components/Preview`
Expected: PASS — every suite that uses the canvas double, unchanged by the two methods it gained.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/clipMask.ts apps/artist/src/core/clipMask.test.ts \
  apps/artist/src/test/doubles/canvas.ts
git commit -m "$(cat <<'EOF'
feat(artist): the mask and stroke geometry, in one module (ESCSUITE-65)

core/clipMask.ts owns the maths and the two functions that issue it to a
context. It lives on its own because two near-duplicate functions draw every
media clip in this editor, and a mask added to one and not the other would give
videos a mask and images none.

maskPathFor always answers a path, and 'rect' is how it says there is nothing to
mask: a rectangle the size of the drawn box *is* the drawn box — and it is also
exactly the outline a stroke on an unmasked clip needs, so one function answers
both questions rather than two rules drifting apart. The circle is inscribed at
min(w, h) / 2, which is the circle ESCAPECRAFT drew; the rounded radius arrives
as a fraction of the shorter side and is clamped at half of it, because past
that a real roundRect throws IndexSizeError and inside a preview frame that
kills the frame rather than the mask.

A mask is three calls — beginPath, the shape, clip — and no closePath(), which
clip() does implicitly and which would otherwise cost a fourth call per masked
clip per frame. A clip with no mask records nothing at all. Only the stroke adds
a save/restore pair, because only the stroke needs the clip region dropped
before it draws.

The rounded path falls back to moveTo plus four arcTo calls when the browser has
no roundRect: Safari gained it in 16.4, the e2e suite runs WebKit, and a throw
here would take out the whole preview frame.

The recording canvas double gains roundRect and arcTo — without them the rounded
mask and its fallback cannot be recorded at all. Craft's double has had
roundRect since ESCSUITE-14; this brings artist's level with it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 3: apply the mask and the stroke in the two media draws

**Files:**
- Modify: `apps/artist/src/core/canvasRenderer.ts` (imports; `drawClipToCanvas` at 385-389; `drawImageToCanvasWithModifiers` at 510-514)
- Modify: `apps/artist/src/core/canvasRenderer.clips.test.ts` (two describe blocks appended, plus one case added to each of the two existing describe blocks)

**Interfaces:**
- Consumes: `applyClipMask`, `applyClipStroke`, `visibleClipStroke` from `./clipMask` (Task 2); `Clip['mask']`, `Clip['stroke']` (Task 1).
- Produces: no new exports. The *behaviour* is the contract: for a clip with neither field, both functions record exactly `['save', 'drawImage', 'restore']`; a mask adds three calls before `drawImage`; a stroke adds a `save` before the mask, a `restore` after `drawImage`, and `beginPath` + the shape + `stroke` after that.

**Four decisions this task pins, all argued in the commit message:**

- **After the rotation, before the image.** The mask goes between the point where `x`/`y`/`scaledWidth`/`scaledHeight` are known (385-386 / 510-511) and `drawImage` (389 / 514), which is after the rotation translate/rotate/translate (379-383 / 504-508) — so the mask rotates with the clip. A wipe transition's existing `clip()` (355-360 / 481-486) is already in effect and the two regions intersect, which is the correct composition and is tested.
- **The mask costs no save and no restore.** Both functions already `save()` (339 / 465) and `restore()` (392 / 516). The **stroke** is the only thing that adds an inner pair, because it is the only thing that needs the clip region gone while the rotation stays.
- **A clip with neither field records exactly what it recorded before.** Not "a rect and a clip that happen to be no-ops": literally `['save', 'drawImage', 'restore']`. That is the property the perf ceilings in Task 4 rest on and the reason `applyClipMask` returns without touching the context.
- **Every assertion is written twice, once per function.** The two are near-duplicates and the spec's risk list names divergence as the way this breaks. The shared helper is the guard against a *logic* difference; a test per function is the guard against one of them simply not being edited.

- [ ] **Step 1: Write the failing tests** — in `apps/artist/src/core/canvasRenderer.clips.test.ts`, extend the `Clip` type import to also pull `ClipMask` and `ClipStroke`:

```ts
import type { Clip, ClipMask, ClipStroke } from '../store/types'
```

add one case at the end of the existing `describe('drawClipToCanvas', ...)` block (after the 'offsets the draw position by the transition offset' case, which ends at line 177):

```ts
  it('records exactly what it always has for a clip with neither mask nor stroke', () => {
    draw(frame(640, 360))

    // ESCSUITE-65's load-bearing pin. Not "a rect and a clip that happen to be
    // no-ops" — literally the three calls this function made before the mask
    // existed, which is what the per-frame ceilings in
    // `components/Preview/drawFrame.perf.test.ts` and `core/exportMP4.perf.test.ts`
    // rest on, and what a project saved before ESCSUITE-65 draws as.
    expect(ctx.calls.map((c) => c.method)).toEqual(['save', 'drawImage', 'restore'])
  })
```

one case at the end of the existing `describe('drawImageToCanvasWithModifiers', ...)` block (after its 'offsets the draw position by the transition offset' case, which ends at line 232):

```ts
  it('records exactly what it always has for a clip with neither mask nor stroke', () => {
    draw(loadedImage(800, 600))

    expect(ctx.calls.map((c) => c.method)).toEqual(['save', 'drawImage', 'restore'])
  })
```

and append two whole describe blocks at the end of the file:

```ts
// ESCSUITE-65: the mask and the stroke are drawn in these two functions and
// nowhere else, so every claim below is made twice — once per function. The
// shared helper in `core/clipMask.ts` guards against the two disagreeing about
// the *geometry*; these guard against one of them simply not having been
// edited, which is the spec's own named risk.
const CIRCLE: ClipMask = { kind: 'circle' }
const ROUNDED: ClipMask = { kind: 'rounded', radius: 0.25 }
const STROKE: ClipStroke = { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1920 }

describe('drawClipToCanvas with a mask and a stroke', () => {
  const draw = (
    clip: Clip,
    modifiers?: TransitionModifiers
  ) => drawClipToCanvas(asCtx(), frame(640, 360), clip, 0, W, H, modifiers)

  it('clips to the mask after the rotation and before the image', () => {
    draw(
      makeClip({
        mask: CIRCLE,
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
      })
    )

    // After the rotation so the mask turns with the clip; before drawImage so
    // it is a clip region and not a shape painted over the picture.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'translate',
      'rotate',
      'translate',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
  })

  it('inscribes the circle in the drawn box', () => {
    draw(makeClip({ mask: CIRCLE }))

    // 640x360 at scale 1, centred on a 1920x1080 canvas: the box is
    // (640, 360)-(1280, 720), so the centre is (960, 540) and the inscribed
    // radius is 360/2 = 180.
    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([640, 360, 640, 360])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 180, 180, 0, 0, Math.PI * 2])
  })

  it('reads the rounded radius as a fraction of the drawn box shorter side', () => {
    draw(makeClip({ mask: ROUNDED }))

    // 0.25 x min(640, 360) = 90 canvas pixels, at this scale. Doubling the clip
    // would double the rounding, which is the point of a fraction.
    expect(ctx.argsFor('roundRect')[0]).toEqual([640, 360, 640, 360, 90])
  })

  it('strokes the outline after the image, outside the clip region', () => {
    draw(makeClip({ mask: CIRCLE, stroke: STROKE }))

    // The inner save/restore pair is the whole cost of a stroke: it exists so
    // the clip region is gone while the rotation is kept, which is how
    // ESCAPECRAFT draws the same border (overlayGeometry.ts:182-187). Without it
    // the mask would eat the inner half of every line.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
      'beginPath',
      'ellipse',
      'stroke',
      'restore',
    ])
    const [state] = ctx.stateFor('stroke')
    expect(state.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
    // 3/1920 of a 1920-wide frame is 3 canvas pixels.
    expect(state.lineWidth).toBeCloseTo(3, 10)
  })

  it('strokes the picture rectangle when the clip has no mask', () => {
    draw(makeClip({ stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'drawImage',
      'restore',
      'beginPath',
      'rect',
      'stroke',
      'restore',
    ])
    expect(ctx.argsFor('rect')[0]).toEqual([640, 360, 640, 360])
  })

  it('records two clips for a masked clip inside a wipe', () => {
    draw(makeClip({ mask: CIRCLE }), { clipRegion: { x: 10, y: 20, width: 300, height: 400 } })

    // The wipe's region and the mask intersect, which is the correct
    // composition: a half-revealed circular clip is a circle with a straight
    // edge, not a whole circle and not a whole rectangle.
    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'beginPath',
      'rect',
      'clip',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
    expect(ctx.argsFor('rect')[0]).toEqual([10, 20, 300, 400])
  })

  it.each([
    ['neither', undefined, undefined, 0, 0],
    ['a mask only', CIRCLE, undefined, 3, 0],
    ['a stroke only', undefined, STROKE, 3, 1],
    ['both', CIRCLE, STROKE, 6, 1],
  ])(
    'balances save and restore and adds a fixed cost for %s',
    (_label, mask, stroke, extraCalls, extraSaves) => {
      ctx = createRecordingContext()
      const plain = (() => {
        drawClipToCanvas(asCtx(), frame(640, 360), makeClip(), 0, W, H)
        return { calls: ctx.calls.length, saves: ctx.argsFor('save').length }
      })()

      ctx = createRecordingContext()
      drawClipToCanvas(asCtx(), frame(640, 360), makeClip({ mask, stroke }), 0, W, H)

      // Exact, not a ceiling: this is the arithmetic the per-frame ceilings in
      // Task 4 are derived from. A mask is beginPath + shape + clip; a stroke is
      // save + restore + beginPath + shape + stroke. lineWidth and strokeStyle
      // are property assignments, which the recording double does not count as
      // calls — see its `record()` helper and the note on `FrameMeasurement` in
      // `components/Preview/drawFrame.perf.test.ts`.
      expect(ctx.calls.length).toBe(plain.calls + extraCalls)
      expect(ctx.argsFor('save').length).toBe(plain.saves + extraSaves)
      expect(ctx.argsFor('save').length).toBe(ctx.argsFor('restore').length)
    }
  )
})

describe('drawImageToCanvasWithModifiers with a mask and a stroke', () => {
  const draw = (clip: Clip, modifiers?: TransitionModifiers) =>
    drawImageToCanvasWithModifiers(asCtx(), loadedImage(800, 600), clip, 0, W, H, modifiers)

  it('clips to the mask after the rotation and before the image', () => {
    draw(
      makeClip({
        mask: CIRCLE,
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 180, opacity: 1 },
      })
    )

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'translate',
      'rotate',
      'translate',
      'beginPath',
      'ellipse',
      'clip',
      'drawImage',
      'restore',
    ])
  })

  it('inscribes the circle in the drawn box', () => {
    draw(makeClip({ mask: CIRCLE }))

    // 800x600 centred on 1920x1080: the box is (560, 240)-(1360, 840), centre
    // (960, 540), inscribed radius 600/2 = 300.
    expect(ctx.argsFor('drawImage')[0].slice(1)).toEqual([560, 240, 800, 600])
    expect(ctx.argsFor('ellipse')[0]).toEqual([960, 540, 300, 300, 0, 0, Math.PI * 2])
  })

  it('reads the rounded radius as a fraction of the drawn box shorter side', () => {
    draw(makeClip({ mask: ROUNDED }))

    // 0.25 x min(800, 600) = 150.
    expect(ctx.argsFor('roundRect')[0]).toEqual([560, 240, 800, 600, 150])
  })

  it('strokes the outline after the image, outside the clip region', () => {
    draw(makeClip({ mask: ROUNDED, stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'beginPath',
      'roundRect',
      'clip',
      'drawImage',
      'restore',
      'beginPath',
      'roundRect',
      'stroke',
      'restore',
    ])
    expect(ctx.stateFor('stroke')[0].lineWidth).toBeCloseTo(3, 10)
  })

  it('strokes the picture rectangle when the clip has no mask', () => {
    draw(makeClip({ stroke: STROKE }))

    expect(ctx.calls.map((c) => c.method)).toEqual([
      'save',
      'save',
      'drawImage',
      'restore',
      'beginPath',
      'rect',
      'stroke',
      'restore',
    ])
  })

  it('records two clips for a masked clip inside a wipe', () => {
    draw(makeClip({ mask: CIRCLE }), { clipRegion: { x: 0, y: 0, width: 960, height: H } })

    expect(ctx.argsFor('clip')).toHaveLength(2)
    expect(ctx.argsFor('rect')[0]).toEqual([0, 0, 960, H])
  })

  it.each([
    ['neither', undefined, undefined, 0, 0],
    ['a mask only', CIRCLE, undefined, 3, 0],
    ['a stroke only', undefined, STROKE, 3, 1],
    ['both', CIRCLE, STROKE, 6, 1],
  ])(
    'balances save and restore and adds a fixed cost for %s',
    (_label, mask, stroke, extraCalls, extraSaves) => {
      ctx = createRecordingContext()
      drawImageToCanvasWithModifiers(asCtx(), loadedImage(800, 600), makeClip(), 0, W, H)
      const plain = { calls: ctx.calls.length, saves: ctx.argsFor('save').length }

      ctx = createRecordingContext()
      drawImageToCanvasWithModifiers(
        asCtx(),
        loadedImage(800, 600),
        makeClip({ mask, stroke }),
        0,
        W,
        H
      )

      expect(ctx.calls.length).toBe(plain.calls + extraCalls)
      expect(ctx.argsFor('save').length).toBe(plain.saves + extraSaves)
      expect(ctx.argsFor('save').length).toBe(ctx.argsFor('restore').length)
    }
  )
})
```

Add `createRecordingContext` to that file's existing import from `../test/doubles/canvas` — it already imports the type from there; the value import is on the same line at the top of the file and already present (line 14-17), so no change is needed if it is; confirm before adding.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/canvasRenderer.clips.test.ts`
Expected: FAIL — the two "records exactly what it always has" cases PASS (the renderer already records only those three calls; that is the point of pinning them *before* the change), and every masked or stroked case fails with `expected [ 'save', 'drawImage', 'restore' ] to deeply equal [ 'save', 'beginPath', 'ellipse', 'clip', 'drawImage', 'restore' ]` or, for the cost cases, `expected 3 to be 6`. Quote the first failure.

- [ ] **Step 3: Implement it in both functions**

In `apps/artist/src/core/canvasRenderer.ts`, add to the imports at the top of the file:

```ts
import { applyClipMask, applyClipStroke, visibleClipStroke } from './clipMask';
```

In `drawClipToCanvas`, replace lines 385-389 (from `const x = centerX - (scaledWidth / 2);` through `ctx.drawImage(source, x, y, scaledWidth, scaledHeight);`) with:

```ts
  const x = centerX - (scaledWidth / 2);
  const y = centerY - (scaledHeight / 2);

  // The mask and the stroke (ESCSUITE-65). This function and
  // `drawImageToCanvasWithModifiers` are the only two places either is drawn,
  // and every pipeline funnels through them — the preview, both exports, both
  // transition paths and the headless renderer — so a mask written here is a
  // mask drawn everywhere.
  //
  // Here rather than anywhere else because this is after the rotation block
  // above (so the mask turns with the clip) and after the drawn box is known.
  // A wipe transition's own clip() is already in effect and the two regions
  // intersect, which is the right composition. The mask needs no save of its
  // own: the outer save/restore this function already makes covers it.
  //
  // The stroke is the one thing that needs a second save: it has to be drawn
  // with the clip region gone but the rotation kept, or the mask would eat the
  // inner half of every line. Same shape as ESCAPECRAFT's own border
  // (`apps/craft/src/core/overlayGeometry.ts:182-187`). A clip with no stroke
  // pays neither the save nor the restore.
  const stroke = visibleClipStroke(clip.stroke);
  if (stroke) ctx.save();

  applyClipMask(ctx, clip.mask, x, y, scaledWidth, scaledHeight);

  // Draw the media frame (VideoFrame, HTMLVideoElement, or HTMLImageElement)
  ctx.drawImage(source, x, y, scaledWidth, scaledHeight);

  if (stroke) {
    ctx.restore();
    applyClipStroke(ctx, stroke, clip.mask, x, y, scaledWidth, scaledHeight, canvasWidth);
  }
```

In `drawImageToCanvasWithModifiers`, make the identical change at lines 510-514 (`const x = ...` through `ctx.drawImage(image, x, y, scaledWidth, scaledHeight);`), with the same block but `source` → `image` and a one-line comment pointing at the other function rather than repeating its paragraph:

```ts
  const x = centerX - (scaledWidth / 2);
  const y = centerY - (scaledHeight / 2);

  // The mask and the stroke (ESCSUITE-65) — the same four lines as
  // `drawClipToCanvas`, for the same reasons, which are argued in full there.
  // These two near-duplicate functions are the *only* two places either is
  // drawn, and a mask added to one and not the other would give videos a mask
  // and images none.
  const stroke = visibleClipStroke(clip.stroke);
  if (stroke) ctx.save();

  applyClipMask(ctx, clip.mask, x, y, scaledWidth, scaledHeight);

  // Draw the image
  ctx.drawImage(image, x, y, scaledWidth, scaledHeight);

  if (stroke) {
    ctx.restore();
    applyClipStroke(ctx, stroke, clip.mask, x, y, scaledWidth, scaledHeight, canvasWidth);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/canvasRenderer.clips.test.ts`
Expected: PASS — 51 tests (the 37 already there, the two new plain pins, and 12 in the two new describe blocks counting the two `it.each` groups as four each).

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core src/components/Preview`
Expected: PASS — every renderer, exporter, transition and preview suite, unchanged. This is the check that the four lines added to each function changed nothing for a clip that has neither field.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/core/canvasRenderer.ts apps/artist/src/core/canvasRenderer.clips.test.ts
git commit -m "$(cat <<'EOF'
feat(artist): draw the clip mask and stroke in the two media draws (ESCSUITE-65)

drawClipToCanvas and drawImageToCanvasWithModifiers each gain four lines. Those
two are the only places a media clip is drawn in this editor, and every pipeline
funnels through them — the preview, the WebM export, the MP4 export, both
transition paths and the headless renderer — so the mask written twice here is
the mask drawn in all five.

Placed after the rotation block, so the mask turns with the clip, and after the
drawn box is known. A wipe transition's own clip() is still in effect and the
two regions intersect, which is the right composition and is tested: a
half-revealed circular clip is a circle with a straight edge. The mask needs no
save of its own — the save/restore pair both functions already make covers it.

The stroke is the only thing that adds a save and a restore, because it is the
only thing that needs the clip region gone while the rotation stays; otherwise
the mask eats the inner half of every line. That is the same shape ESCAPECRAFT
draws its own border with.

A clip with neither field records exactly the three calls it recorded before
this commit — save, drawImage, restore — pinned for both functions, because
every per-frame ceiling in the repo rests on it and because that is what a
project saved before ESCSUITE-65 has to keep drawing as. The per-clip cost is
asserted exactly rather than as a ceiling: a mask is 3 calls, a stroke is 5 and
a save/restore pair, and saves == restores in all four combinations.

Every claim is made twice, once per function. The shared helper in
core/clipMask.ts guards against the two disagreeing about the geometry; the
duplicated tests guard against one of them simply not having been edited, which
is how a near-duplicate pair like this actually breaks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 4: masked and stroked per-frame ceilings

**Files:**
- Modify: `apps/artist/src/test/fixtures/perfScene.ts` (a variant builder appended; **`buildSceneClips`, `SCENE_TRACKS` and `buildSceneProject` are not touched**)
- Modify: `apps/artist/src/components/Preview/drawFrame.perf.test.ts` (one case inside `describe('preview per-frame work')`, after the transition-frame case which ends at line 194)
- Modify: `apps/artist/src/core/exportMP4.perf.test.ts` (`measureExport` takes the clips; one case after the 30-frame case, which ends at line 200)

**Interfaces:**
- Consumes: `ClipMask`, `ClipStroke` from `../../store/types`; the existing `buildSceneClips()` / `buildSceneProject()`.
- Produces, in `apps/artist/src/test/fixtures/perfScene.ts`:
  ```ts
  export const MASKED_SCENE_MASK: ClipMask;
  export const MASKED_SCENE_STROKE: ClipStroke;
  export const MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME = 2;
  export function buildMaskedSceneClips(): Clip[];
  export function buildMaskedSceneProject(): Project;
  ```
  and in `apps/artist/src/core/exportMP4.perf.test.ts`: `measureExport(clips?: Clip[])`.

**THE COUNTS ARE TO BE MEASURED, AND WRITTEN EXACTLY.** Read this before writing a number:

- The house rule for this repo is stated at the top of `drawFrame.perf.test.ts` (lines 14-19): *measure once, set the ceiling at 2× the measurement rounded up, write the measured value and the date beside it.* Follow it. The date is **2026-09-25**.
- The **derived** expectation, from Task 3's exact per-clip arithmetic, is **+3 recorded calls per masked clip** and **+5 recorded calls plus one save/restore pair per stroked clip** — so **+8 per clip that has both**, of which one is a `save` and one a `restore`. Two media clips are live at `EFFECTS_FRAME_TIME` (7.5 s) and over the export's 7-8 s range (the `ACTIVE_CLIPS = 4` comment at exportMP4.perf.test.ts:228 names them: the full-frame V1 clip, the PiP V2 clip, and the two overlays), so the derived per-frame delta is **2 × 8 = 16 calls** and **+2 saves / +2 restores**.
- **The spec says the stroke is "+8 (1 save, 1 restore, 6 outline calls)". That number is wrong for this repo and the plan corrects it.** The spec counted `lineWidth` and `strokeStyle` as recorded calls. ARTIST's recording double records **methods only** — `fillStyle`, `strokeStyle` and `lineWidth` are plain fields on the object, not wrapped by its `record()` helper (`src/test/doubles/canvas.ts`), and `FrameMeasurement`'s own doc comment in `drawFrame.perf.test.ts` (lines 78-81) says so in as many words: *"Property assignments (globalAlpha, filter, fillStyle, font) are not calls and are not counted"*. The spec's own list is five items long anyway, not six. So the stroke's outline is `beginPath` + the shape + `stroke` = **3**, plus the save and the restore = **5**.
- **Measure it. If the measured delta is not 16 calls per frame, do not adjust the number to match — find out why.** A delta of 32 means the mask is being applied twice; a delta of 22 means the double started recording property sets and the ceilings elsewhere are now understated; a delta of 0 means the variant scene is not reaching the renderer.
- **The plain ceilings must not move.** They are asserted by the existing cases, which this task does not touch, over the existing scene, which this task does not touch. The variant is a *variant*: adding a mask to an existing perf-scene clip would move those numbers and break the "same scene as the browser benchmark" contract stated at `perfScene.ts:1-16` and honoured by `apps/e2e/utils/perf.ts`.
- **`drawImagesPerFrame` and `animationLookupsPerFrame` must be unchanged.** A mask draws no second image and the fields are never animated (decision 4), so a movement in either is a bug rather than a cost.

- [ ] **Step 1: Write the failing variant fixture and the two ceiling cases**

Append to `apps/artist/src/test/fixtures/perfScene.ts`, and extend its type import to `import type { Clip, ClipMask, ClipStroke, Project, SourceVideo, Track } from '../../store/types'`:

```ts
/**
 * The mask and stroke the masked variant of the scene puts on every media clip
 * (ESCSUITE-65) — the handoff's own pair, so the variant measures the shape a
 * real user most often has: a circular webcam clip with ESCAPECRAFT's white
 * border.
 */
export const MASKED_SCENE_MASK: ClipMask = { kind: 'circle' }
export const MASKED_SCENE_STROKE: ClipStroke = {
  color: 'rgba(255, 255, 255, 0.8)',
  width: 3 / 1280,
}

/**
 * Media clips live at `EFFECTS_FRAME_TIME`, and over the export range the MP4
 * ceilings measure: the full-frame V1 clip (6-8 s) and the `screen`-blended
 * picture-in-picture V2 clip (7-9 s). The two overlays are live too but take
 * neither field — media clips only (decision 3) — so the per-frame delta the
 * ceilings expect is this many times the per-clip cost.
 */
export const MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME = 2

/**
 * The scene's clips with every **media** clip masked and stroked.
 *
 * A variant, deliberately, and never an edit to `buildSceneClips`: adding a mask
 * to an existing perf-scene clip would move the plain ceilings and break the
 * "same scene as the browser benchmark" contract this file opens with —
 * `apps/e2e/utils/perf.ts` builds the same twelve clips in a real browser and
 * the millisecond figures it reports are about that scene.
 *
 * The overlays are left alone because they cannot take either field.
 */
export function buildMaskedSceneClips(): Clip[] {
  return buildSceneClips().map((clip) =>
    clip.overlayType === undefined
      ? { ...clip, mask: { ...MASKED_SCENE_MASK }, stroke: { ...MASKED_SCENE_STROKE } }
      : clip
  )
}

/** The masked variant as a project, ready for `setProject`. */
export function buildMaskedSceneProject(): Project {
  const project = buildSceneProject()
  return {
    ...project,
    id: 'perf-scene-masked',
    name: 'Perf Scene (masked)',
    timeline: { ...project.timeline, clips: buildMaskedSceneClips() },
  }
}
```

In `apps/artist/src/components/Preview/drawFrame.perf.test.ts`, add `buildMaskedSceneProject` and `MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME` to the `perfScene` import, and add this case inside `describe('preview per-frame work')`, immediately after the transition-frame case:

```ts
  it('composites the masked and stroked effects frame within its ceilings', async () => {
    // The same frame as the first case, with every media clip carrying
    // ESCSUITE-65's circle and ESCAPECRAFT's white border. A *variant* of the
    // scene, never an edit to it: the plain ceilings above have to stay exactly
    // where they are, because they and `apps/e2e/tests/perf/` describe one
    // scene.
    store().setProject(buildMaskedSceneProject())
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, EFFECTS_FRAME_TIME)

    // MEASURE THIS AND WRITE THE REAL NUMBERS, then leave the derivation below
    // in place so the next reader can check them.
    //
    // Measured 2026-09-25: <total> calls, <n> drawImage, <n> fills, <n> strokes,
    // <n> getAnimatedValues, <n> save/restore pairs.
    //
    // Derived from `core/canvasRenderer.clips.test.ts`, which pins the per-clip
    // cost exactly: a mask is 3 calls (beginPath + ellipse + clip) and a stroke
    // is 5 (save + beginPath + ellipse + stroke + restore). `lineWidth` and
    // `strokeStyle` are property assignments, which this double does not count
    // as calls — see `FrameMeasurement` above. Two media clips are live here, so
    // the plain frame's 25 calls become 25 + 2 x 8 = 41. If the measurement is
    // not 41, do not adjust the number: 57 would mean the mask is applied twice,
    // 25 would mean the variant is not reaching the renderer, and 47 would mean
    // the double has started recording property sets and every other ceiling in
    // this file is now understated.
    expect(frame.totalCalls).toBeLessThanOrEqual(82)
    // Unchanged from the plain frame, and exact where the plain frame is exact:
    // a mask draws no second image, and neither field is animated (decision 4),
    // so a movement in either of these is a bug and not a cost.
    expect(frame.drawImages).toBeLessThanOrEqual(4)
    expect(frame.animatedValues).toBeLessThanOrEqual(8)
    // The scene's shape overlay strokes once; the two masked clips add one each.
    expect(frame.strokes).toBeLessThanOrEqual(6)
    // Exact: the stroke's inner save is the only state operation this feature
    // adds, and an unbalanced one would leak a clip region into the next frame.
    expect(frame.saves).toBe(frame.restores)
    expect(frame.getContexts).toBe(0)
    expect(frame.objectUrls).toBe(0)
  })
```

In `apps/artist/src/core/exportMP4.perf.test.ts`, change `measureExport`'s signature (line 144) to take the scene, defaulting to the plain one so no existing call site changes:

```ts
async function measureExport(clips: Clip[] = buildSceneClips()): Promise<ExportMeasurement> {
  const progress: ExportProgress[] = []
```

(delete the `const clips = buildSceneClips()` line that opened the function, add `buildMaskedSceneClips` and `MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME` to the `perfScene` import and `Clip` to the `store/types` type import), then add this case immediately after the 30-frame case:

```ts
  it('encodes the masked and stroked scene within its per-frame ceilings', async () => {
    // The same 30 frames, with every media clip masked and stroked. The plain
    // ceilings above are untouched and must stay that way: this is a variant of
    // the benchmark scene, not an edit to it.
    const measured = await measureExport(buildMaskedSceneClips())

    expect(measured.framesEncoded).toBe(FRAMES)

    // MEASURE THIS AND WRITE THE REAL NUMBER.
    //
    // Measured 2026-09-25: <n> calls per frame, <n> drawImage, <n> save/restore
    // pairs, <n> animation lookups per frame.
    //
    // Derived the same way as the preview ceiling: 3 calls for a mask, 5 for a
    // stroke, two media clips live over this second, so the plain 24 calls per
    // frame become 24 + 2 x 8 = 40.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(80)
    // Exact, and unchanged: a mask draws no second image.
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    // Exact, and unchanged: neither field is animated, so the lookup count is
    // still frames x active clips and nothing else (decision 4).
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
    // Exact: an export that leaked a save() would drift the whole file, and the
    // stroke's inner save is the only one this feature adds.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    expect(measured.getContexts).toBe(1)
  })

  it('creates and closes exactly one VideoFrame per encoded frame with masks on', async () => {
    const measured = await measureExport(buildMaskedSceneClips())

    // The classic out-of-memory bug, asked again with the mask on: a clip region
    // is context state, and a feature that leaked one could plausibly leak a
    // frame too.
    expect(measured.videoFramesCreated).toBe(FRAMES)
    expect(measured.videoFramesClosed).toBe(measured.videoFramesCreated)
    expect(allFramesClosed()).toBe(true)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/drawFrame.perf.test.ts src/core/exportMP4.perf.test.ts`
Expected: FAIL — `Failed to resolve import` is not it (the fixture is written in this same step); the failure is the two `<total>` placeholders being unwritten, i.e. the ceilings as typed above are 2× a *derived* number, so they should pass on the first run. **If they pass, that is the measurement step, not the red step** — record the measured figures, then go to Step 3 and replace every `<n>`/`<total>` with the measured value and every ceiling with 2× it rounded up. If either ceiling *fails*, the measured cost is more than double the derivation and Step 3 is an investigation, not a number swap.

- [ ] **Step 3: Measure, and write the numbers exactly**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/drawFrame.perf.test.ts src/core/exportMP4.perf.test.ts --reporter=verbose`

Read the measurement out by temporarily adding `console.log(frame)` / `console.log(measured)` to the two new cases, then **remove the logs** and write into the comments: the total calls, drawImages, fills, strokes, animatedValues and save/restore pairs for the preview frame; the callsPerFrame, drawImagesPerFrame, savesPerFrame and animationLookupsPerFrame for the export. Set each *ceiling* to 2× the measured value rounded up. Confirm against the derivation in the comment:

- preview: `masked.totalCalls − 25 === 16`
- export: `masked.callsPerFrame − 24 === 16`
- both: saves and restores each up by exactly 2 from the plain measurement.

If any of those three is false, stop and diagnose before writing a number. Record in the step notes what was measured and that it matched (or what it was instead, and why).

- [ ] **Step 4: Verify the plain ceilings did not move**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/drawFrame.perf.test.ts src/core/exportMP4.perf.test.ts`
Expected: PASS — 8 tests in the preview file (the five already there plus the new one, counting the render-loop describe), 5 in the export file (the three already there plus two).

Run: `git diff apps/artist/src/test/fixtures/perfScene.ts | grep '^-'`
Expected: only the `import type` line, and nothing else. A single deleted or changed line inside `buildSceneClips`, `SCENE_TRACKS` or `buildSceneProject` means the plain scene was edited rather than varied.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/test/fixtures/perfScene.ts \
  apps/artist/src/components/Preview/drawFrame.perf.test.ts \
  apps/artist/src/core/exportMP4.perf.test.ts
git commit -m "$(cat <<'EOF'
test(artist): per-frame ceilings for a masked and stroked scene (ESCSUITE-65)

A masked-and-stroked *variant* of the benchmark scene, and a ceiling for it in
both per-frame suites. A variant and never an edit: adding a mask to an existing
perf-scene clip would move the plain ceilings and break the "same scene as the
browser benchmark" contract that fixture opens with — apps/e2e/tests/perf/
builds the same twelve clips in a real browser and reports milliseconds about
that scene.

The delta is derived from the exact per-clip arithmetic canvasRenderer's own
tests pin — 3 calls for a mask, 5 for a stroke including its save/restore pair —
times the two media clips live at the measured frame, so 16 calls per frame. It
is then measured and the measurement written down beside the ceiling with its
date, which is this repo's rule for a ceiling.

Note for anyone comparing with the design doc: the stroke is 5 recorded calls
here, not 8. The doc counted lineWidth and strokeStyle as calls; this recording
double records methods only, as its own FrameMeasurement comment says.

drawImagesPerFrame and animationLookupsPerFrame are asserted unchanged rather
than re-ceilinged: a mask draws no second image and neither field is animatable,
so a movement in either would be a bug and not a cost. saves == restores stays
exact — the stroke's inner save is the only state operation this feature adds,
and an unbalanced one would leak a clip region into the next frame or drift a
whole exported file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 5: `MaskSection`, `CLIP_MASK_KINDS`, and the two handlers

**Files:**
- Create: `apps/artist/src/components/ClipEditor/MaskSection.tsx`
- Create: `apps/artist/src/components/ClipEditor/MaskSection.test.tsx`
- Modify: `apps/artist/src/components/ClipEditor/clipEditorOptions.ts` (a table after `BLEND_MODES`, which ends at line 32)
- Modify: `apps/artist/src/components/ClipEditor/clipEditorOptions.test.ts` (one case)
- Modify: `apps/artist/src/components/ClipEditor/useClipEditorActions.ts` (the interface at 58-105, the selectors at 128-141, the handlers after `handleBlendModeChange` at 205-211, and the return block)
- Modify: `apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts` (`ACTIONS` at 19-33; five cases)
- Modify: `apps/artist/src/components/ClipEditor/ClipEditor.tsx` (the destructure at 15-51; JSX after `BlendModeSection` at 105-107)
- Modify: `apps/artist/src/components/ClipEditor/ClipEditor.test.tsx` (the audio case at 156-167)
- Modify: `apps/artist/src/components/ClipEditor/ClipEditor.overlay.test.tsx` (the "no timing controls" case at 274-281)

**Interfaces:**
- Consumes: `ClipMask`, `ClipMaskKind`, `ClipStroke`, `DEFAULT_CLIP_MASK_RADIUS`, `DEFAULT_CLIP_STROKE_COLOR` from `../../store/types` (Task 1); `CollapsibleSection`; the **existing** `updateClip` action (`clipSlice.ts:259`, which pushes history at 281).
- Produces:
  ```ts
  // components/ClipEditor/clipEditorOptions.ts
  export const CLIP_MASK_KINDS: { value: ClipMaskKind; label: string }[];

  // components/ClipEditor/MaskSection.tsx
  interface MaskSectionProps {
    mask: ClipMask | undefined;
    stroke: ClipStroke | undefined;
    frameWidth: number;
    onMaskChange: (mask: ClipMask) => void;
    onStrokeChange: (stroke: ClipStroke) => void;
  }
  export function MaskSection(props: MaskSectionProps): JSX.Element;

  // components/ClipEditor/useClipEditorActions.ts — added to ClipEditorActions
  frameWidth: number;
  handleMaskChange: (mask: ClipMask) => void;
  handleStrokeChange: (stroke: ClipStroke) => void;
  ```

**Six decisions this task pins, all argued in the commit message:**

- **`MaskSection`, not a second `ShapeSection`.** `ClipEditor/ShapeSection.tsx` is the shape *overlay* editor and its `<select>` at line 26 offers Rectangle/Ellipse/Line/Arrow/Blur. Two sections titled "Shape" in one panel would be a UI bug and every future grep for the word would be ambiguous; `mask` keeps the two vocabularies apart, which is the spec's second named risk.
- **The title is `Mask & Stroke`, exactly.** The spec offers "Mask" or "Clip Shape"; the section carries both fields, so it says both. The string is pinned by four tests and is the accessible name the `CollapsibleSection` toggle button carries.
- **The handlers normalise; the section does not.** The section reports what the user did (`{ kind: 'circle', radius }`, `{ color, width: 0 }`); the handler decides what gets stored — `undefined` for kind `'none'`, `{ kind: 'circle' }` with no radius for a circle, `undefined` for a width of 0. So the store only ever holds canonical shapes, and a clip that has never been stroked is the same object as one whose stroke was removed.
- **No new store action, and no new state subscription.** `updateClip` already exists and already pushes history, so `ClipSlice`'s `Pick` (clipSlice.ts:16) is untouched. The one selector added is `state.updateClip` — an **action**, whose identity never changes, in the same shape as the thirteen already at lines 128-141, so it can cost no re-render. `frameWidth` is derived from the `resolution` selector that has been there since before this ticket (line 126). Nothing reads `currentTime`. `ClipEditor.rerender.test.tsx` running unchanged is the proof, and it is run in this task.
- **The stroke width is shown in pixels at the current project resolution.** `0.0023` is not a number anyone can act on; `3px` is. `px` with no space, matching `EffectsSection`'s `12.5px` and `ShapeSection`'s `30px` — the house style, chosen rather than drifted into.
- **The colour input shows white for a colour it cannot represent, and is disabled at width 0.** `<input type="color">` accepts `#rrggbb` only, and the handoff stores `rgba(255, 255, 255, 0.8)` — so the swatch shows `DEFAULT_CLIP_STROKE_COLOR` (which *is* white) and the stored string is replaced only when the user actually picks. Disabled below a visible width for the same reason `ShapeSection` disables its fill picker when there is no fill: a control whose value cannot matter should not invite a click.

- [ ] **Step 1: Write the failing section test** — create `apps/artist/src/components/ClipEditor/MaskSection.test.tsx`

```ts
// The "Mask & Stroke" section of the clip inspector, rendered on its own
// (ESCSUITE-65).
//
// Same shape as `BlendModeSection.test.tsx`: the real component, `vi.fn()`
// callbacks, and the section opened first because `CollapsibleSection` renders
// no children while it is closed. Normalising what gets *stored* is the hook's
// job and is tested in `useClipEditorActions.test.ts`; this file asserts what
// the user did.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaskSection } from './MaskSection'
import { CLIP_MASK_KINDS } from './clipEditorOptions'
import { rowControl, rowColor } from '../../test/domQueries'
import { DEFAULT_CLIP_MASK_RADIUS, DEFAULT_CLIP_STROKE_COLOR } from '../../store/types'
import type { ClipMask, ClipStroke } from '../../store/types'

/** ESCAPECRAFT's own border: white at 80%, three pixels of a 1280-wide frame. */
const HANDOVER_STROKE: ClipStroke = { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 }

async function renderOpen({
  mask,
  stroke,
  frameWidth = 1280,
}: { mask?: ClipMask; stroke?: ClipStroke; frameWidth?: number } = {}) {
  const user = userEvent.setup()
  const onMaskChange = vi.fn()
  const onStrokeChange = vi.fn()
  render(
    <MaskSection
      mask={mask}
      stroke={stroke}
      frameWidth={frameWidth}
      onMaskChange={onMaskChange}
      onStrokeChange={onStrokeChange}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Mask & Stroke' }))
  return { user, onMaskChange, onStrokeChange }
}

describe('MaskSection', () => {
  it('starts collapsed, showing only its title', () => {
    render(
      <MaskSection
        mask={undefined}
        stroke={undefined}
        frameWidth={1280}
        onMaskChange={vi.fn()}
        onStrokeChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Mask & Stroke' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers every mask kind, in the table order', async () => {
    await renderOpen()

    expect(
      Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => [
        (o as HTMLOptionElement).value,
        o.textContent,
      ])
    ).toEqual(CLIP_MASK_KINDS.map((k) => [k.value, k.label]))
  })

  it('shows None for a clip with no mask', async () => {
    await renderOpen()

    // Absent is how a clip says it has no mask; `'none'` exists so the dropdown
    // has something to display.
    expect(screen.getByRole('combobox')).toHaveValue('none')
  })

  it('reports the kind the user picked, with a radius to start from', async () => {
    const { user, onMaskChange } = await renderOpen()

    await user.selectOptions(screen.getByRole('combobox'), 'circle')

    expect(onMaskChange).toHaveBeenCalledWith({
      kind: 'circle',
      radius: DEFAULT_CLIP_MASK_RADIUS,
    })
  })

  it('offers the corner radius for a rounded mask and nothing else', async () => {
    await renderOpen({ mask: { kind: 'rounded', radius: 0.2 } })

    const radius = rowControl('Corner Radius')
    expect(radius).toHaveValue('0.2')
    expect(radius).toHaveAttribute('min', '0')
    expect(radius).toHaveAttribute('max', '0.5')
    // A fraction of the clip's shorter side, shown as a percentage of it — the
    // stored number is meaningless to read and 20% is not.
    expect(screen.getByText('20%')).toBeInTheDocument()
  })

  it.each([
    ['no mask', undefined],
    ['a circle', { kind: 'circle' as const }],
  ])('hides the corner radius for %s', async (_label, mask) => {
    await renderOpen({ mask })

    expect(screen.queryByText('Corner Radius')).not.toBeInTheDocument()
  })

  it('reports a new corner radius as a fraction', async () => {
    const { onMaskChange } = await renderOpen({ mask: { kind: 'rounded', radius: 0.2 } })

    fireEvent.change(rowControl('Corner Radius'), { target: { value: '0.35' } })

    expect(onMaskChange).toHaveBeenCalledWith({ kind: 'rounded', radius: 0.35 })
  })

  it('labels the stroke width in pixels at the project resolution', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE, frameWidth: 1280 })

    // 3/1280 of a 1280-wide frame is the 3px ESCAPECRAFT drew. Reading
    // "0.0023" would tell the user nothing they could act on.
    expect(screen.getByText('3px')).toBeInTheDocument()
  })

  it('shows the same fraction as more pixels on a larger project', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE, frameWidth: 1920 })

    // The fraction is the point: the same border is half again as thick on a
    // 1080p project, so it looks the same rather than measuring the same.
    expect(screen.getByText('4.5px')).toBeInTheDocument()
  })

  it('shows no stroke as 0px', async () => {
    await renderOpen()

    expect(rowControl('Stroke Width')).toHaveValue('0')
    expect(screen.getByText('0px')).toBeInTheDocument()
  })

  it('reports a new stroke width, keeping the colour it had', async () => {
    const { onStrokeChange } = await renderOpen({ stroke: { color: '#ff0000', width: 0.004 } })

    fireEvent.change(rowControl('Stroke Width'), { target: { value: '0.008' } })

    expect(onStrokeChange).toHaveBeenCalledWith({ color: '#ff0000', width: 0.008 })
  })

  it('starts a first stroke white', async () => {
    const { onStrokeChange } = await renderOpen()

    fireEvent.change(rowControl('Stroke Width'), { target: { value: '0.004' } })

    expect(onStrokeChange).toHaveBeenCalledWith({
      color: DEFAULT_CLIP_STROKE_COLOR,
      width: 0.004,
    })
  })

  it('reports a new stroke colour, keeping the width it had', async () => {
    const { onStrokeChange } = await renderOpen({ stroke: { color: '#ffffff', width: 0.004 } })

    fireEvent.change(rowColor('Stroke Color'), { target: { value: '#00ff00' } })

    expect(onStrokeChange).toHaveBeenCalledWith({ color: '#00ff00', width: 0.004 })
  })

  it('shows white in the swatch for a colour the input cannot represent', async () => {
    await renderOpen({ stroke: HANDOVER_STROKE })

    // `<input type="color">` accepts #rrggbb only, and the ESCAPECRAFT handoff
    // stores `rgba(255, 255, 255, 0.8)`. It shows as white — which it is — and
    // the stored string is replaced only when the user actually picks.
    expect(rowColor('Stroke Color')).toHaveValue(DEFAULT_CLIP_STROKE_COLOR)
  })

  it('disables the colour picker while there is no stroke to colour', async () => {
    await renderOpen()

    // The same choice `ShapeSection` makes for its fill picker when there is no
    // fill: a control whose value cannot matter should not invite a click.
    expect(rowColor('Stroke Color')).toBeDisabled()
  })

  it('enables the colour picker once the stroke has width', async () => {
    await renderOpen({ stroke: { color: '#ffffff', width: 0.004 } })

    expect(rowColor('Stroke Color')).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/MaskSection.test.tsx`
Expected: FAIL — `Failed to resolve import "./MaskSection" from "src/components/ClipEditor/MaskSection.test.tsx"`.

- [ ] **Step 3: Add the option table and its test**

In `apps/artist/src/components/ClipEditor/clipEditorOptions.ts`, extend the type import to include `ClipMaskKind` and add this table immediately after `BLEND_MODES` (which ends at line 32):

```ts
/**
 * Mask & Stroke → the mask's shape (ESCSUITE-65).
 *
 * `'none'` is first because it is the default and because a list of shapes with
 * no way back to "no shape" is a trap. The labels say what the shape is rather
 * than what it is for — "Rounded Rectangle", not "Webcam" — because the mask is
 * a clip property now, not a handoff artefact.
 */
export const CLIP_MASK_KINDS: { value: ClipMaskKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'rounded', label: 'Rounded Rectangle' },
];
```

In `apps/artist/src/components/ClipEditor/clipEditorOptions.test.ts`, add `CLIP_MASK_KINDS` to the import and this case after the blend-modes case:

```ts
  it('lists the mask kinds, None first', () => {
    expect(CLIP_MASK_KINDS).toEqual([
      { value: 'none', label: 'None' },
      { value: 'circle', label: 'Circle' },
      { value: 'rounded', label: 'Rounded Rectangle' },
    ])
  })
```

- [ ] **Step 4: Implement the section**

Create `apps/artist/src/components/ClipEditor/MaskSection.tsx`:

```tsx
import type { ClipMask, ClipMaskKind, ClipStroke } from '../../store/types';
import { DEFAULT_CLIP_MASK_RADIUS, DEFAULT_CLIP_STROKE_COLOR } from '../../store/types';
import { CLIP_MASK_KINDS } from './clipEditorOptions';
import { CollapsibleSection } from './CollapsibleSection';
import styles from './ClipEditor.module.css';

interface MaskSectionProps {
  /** The clip's mask, or undefined for none. */
  mask: ClipMask | undefined;
  /** The clip's stroke, or undefined for none. */
  stroke: ClipStroke | undefined;
  /**
   * The project's frame width in pixels.
   *
   * The stroke width is stored as a fraction of it (so the border keeps its
   * proportions when a project's resolution changes), and a fraction is not a
   * number anyone can act on — this is what turns it back into the pixels the
   * user is looking at.
   */
  frameWidth: number;
  /** The mask kind or radius the user chose. Normalising it is the caller's job. */
  onMaskChange: (mask: ClipMask) => void;
  /** The stroke colour or width the user chose. Normalising it is the caller's job. */
  onStrokeChange: (stroke: ClipStroke) => void;
}

/** `<input type="color">` accepts this and nothing else. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * What the colour swatch can show for a stored colour string.
 *
 * ESCAPECRAFT's border arrives as `rgba(255, 255, 255, 0.8)`, which the input
 * cannot represent; it shows as white — which it is — and the stored string is
 * replaced only when the user actually picks a colour.
 */
function swatchValue(color: string | undefined): string {
  return color !== undefined && HEX_COLOR.test(color) ? color : DEFAULT_CLIP_STROKE_COLOR;
}

/** The stroke width as the user sees it: pixels at the current project resolution. */
function strokePixels(width: number, frameWidth: number): string {
  // One decimal at most, so 3/1280 of a 720p frame reads "3px" rather than
  // "3.0px" and of a 1080p frame reads "4.5px" rather than "5px".
  return `${Math.round(width * frameWidth * 10) / 10}px`;
}

/**
 * The "Mask & Stroke" section of the clip inspector (ESCSUITE-65): which shape
 * the clip's picture is masked to, and the outline drawn round it.
 *
 * Deliberately **not** called `ShapeSection` — that name is taken by the shape
 * *overlay* editor in this same directory, and a panel with two sections titled
 * "Shape" would be a bug in the UI and an ambiguity in every future grep.
 *
 * Media clips only (decision 3): `ClipEditor` gates it exactly as it gates
 * `BlendModeSection`, because a text or shape overlay has no drawn box either
 * field could mean anything against.
 *
 * This component reports what the user did and normalises nothing. `'none'`
 * with a radius, or a width of 0 with a colour, are things a user can express;
 * turning them into "no mask" and "no stroke" is `useClipEditorActions`' job, so
 * the store only ever holds canonical shapes.
 */
export function MaskSection({
  mask,
  stroke,
  frameWidth,
  onMaskChange,
  onStrokeChange,
}: MaskSectionProps) {
  const kind = mask?.kind ?? 'none';
  const radius = mask?.radius ?? DEFAULT_CLIP_MASK_RADIUS;
  const strokeWidth = stroke?.width ?? 0;
  const strokeColor = stroke?.color ?? DEFAULT_CLIP_STROKE_COLOR;

  return (
    <CollapsibleSection title="Mask & Stroke" defaultOpen={false}>
      <select
        className={styles.select}
        value={kind}
        onChange={(e) => onMaskChange({ kind: e.target.value as ClipMaskKind, radius })}
      >
        {CLIP_MASK_KINDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className={styles.transformControls}>
        {kind === 'rounded' && (
          <div className={styles.transformRow}>
            <label>Corner Radius</label>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={radius}
              onChange={(e) => onMaskChange({ kind: 'rounded', radius: parseFloat(e.target.value) })}
            />
            {/* A fraction of the clip's shorter side, so a percentage of it is
                the only honest readout. 0.5 is a stadium. */}
            <span>{Math.round(radius * 100)}%</span>
          </div>
        )}

        <div className={styles.transformRow}>
          <label>Stroke Width</label>
          <input
            type="range"
            min={0}
            max={0.02}
            step={0.0001}
            value={strokeWidth}
            onChange={(e) =>
              onStrokeChange({ color: strokeColor, width: parseFloat(e.target.value) })
            }
          />
          <span>{strokePixels(strokeWidth, frameWidth)}</span>
        </div>

        <div className={styles.row}>
          <div className={styles.colorInput}>
            <span>Stroke Color</span>
            <input
              type="color"
              value={swatchValue(stroke?.color)}
              disabled={strokeWidth <= 0}
              onChange={(e) => onStrokeChange({ color: e.target.value, width: strokeWidth })}
            />
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
```

- [ ] **Step 5: Run the section tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/MaskSection.test.tsx src/components/ClipEditor/clipEditorOptions.test.ts`
Expected: PASS — 17 tests in `MaskSection.test.tsx` (the two-case `it.each` counts as two), 5 in `clipEditorOptions.test.ts`.

- [ ] **Step 6: Write the failing handler tests** — in `apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts`, add `'updateClip'` to the `ACTIONS` array (after `'updateClipAnimation'`, so the whole array stays in the store's own order):

```ts
  'updateClipAnimation',
  'updateClip',
```

add the two handler calls to the "every clip handler is a no-op without a selection" `act` block (after `result.current.handleShapeDataChange({ strokeWidth: 2 })`):

```ts
      result.current.handleMaskChange({ kind: 'circle' })
      result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 })
```

and add this describe block at the end of the file:

```ts
describe('useClipEditorActions mask and stroke (ESCSUITE-65)', () => {
  it('stores a circle with no radius, whatever radius the section reported', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleMaskChange({ kind: 'circle', radius: 0.2 }))

    // The section reports what the user did; the handler decides what is stored.
    // A radius on a circle is noise the renderer never reads, so it is dropped
    // here rather than carried in every project file from now on.
    expect(spies.updateClip).toHaveBeenCalledWith(clip.id, { mask: { kind: 'circle' } })
    expect(clipNow(clip.id).mask).toEqual({ kind: 'circle' })
  })

  it('stores a rounded mask with its radius, defaulting one that is missing', () => {
    const clip = mediaClip()
    const { result } = mount()

    act(() => result.current.handleMaskChange({ kind: 'rounded', radius: 0.3 }))
    expect(clipNow(clip.id).mask).toEqual({ kind: 'rounded', radius: 0.3 })

    act(() => result.current.handleMaskChange({ kind: 'rounded' }))
    expect(clipNow(clip.id).mask).toEqual({ kind: 'rounded', radius: DEFAULT_CLIP_MASK_RADIUS })
  })

  it('removes the mask rather than storing kind none', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleMaskChange({ kind: 'circle' }))

    act(() => result.current.handleMaskChange({ kind: 'none', radius: 0.2 }))

    // So a clip that was never masked and one whose mask was removed are the
    // same object, and `undefined === none` stays the only rule the renderer and
    // the migration need to know.
    expect(spies.updateClip).toHaveBeenLastCalledWith(clip.id, { mask: undefined })
    expect(clipNow(clip.id).mask).toBeUndefined()
  })

  it('removes the stroke rather than storing a width of zero', () => {
    const clip = mediaClip()
    const { result } = mount()
    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 }))
    expect(clipNow(clip.id).stroke).toEqual({ color: '#ffffff', width: 0.004 })

    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0 }))

    expect(spies.updateClip).toHaveBeenLastCalledWith(clip.id, { stroke: undefined })
    expect(clipNow(clip.id).stroke).toBeUndefined()
  })

  it('pushes one history entry per change, through the action that already existed', () => {
    const clip = mediaClip()
    const { result } = mount()
    useEditorStore.setState({ history: { past: [], future: [] } })

    act(() => result.current.handleMaskChange({ kind: 'circle' }))
    act(() => result.current.handleStrokeChange({ color: '#ffffff', width: 0.004 }))

    // `updateClip` pushes history itself (clipSlice.ts:281), which is why this
    // feature adds no store action and no member to ClipSlice's Pick — and why
    // one Ctrl+Z takes the stroke off and leaves the mask on.
    expect(useEditorStore.getState().history.past).toHaveLength(2)
    act(() => store().undo())
    expect(clipNow(clip.id).stroke).toBeUndefined()
    expect(clipNow(clip.id).mask).toEqual({ kind: 'circle' })
  })

  it('reports the project frame width the stroke is a fraction of', () => {
    mediaClip()
    const { result } = mount()

    // Derived from the `resolution` selector this hook has always had — no new
    // subscription, which is the rule `ClipEditor.rerender.test.tsx` holds.
    expect(result.current.frameWidth).toBe(store().project.resolution.width)
  })
})
```

Add `DEFAULT_CLIP_MASK_RADIUS` to that file's import from `../../store/types`.

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/useClipEditorActions.test.ts`
Expected: FAIL — `TypeError: result.current.handleMaskChange is not a function`.

- [ ] **Step 8: Implement the handlers**

In `apps/artist/src/components/ClipEditor/useClipEditorActions.ts`:

extend the type import to include `ClipMask` and `ClipStroke`, and the value import to include `DEFAULT_CLIP_MASK_RADIUS`:

```ts
import { DEFAULT_TRANSFORM, DEFAULT_CLIP_MASK_RADIUS } from '../../store/types';
import type {
  BlendMode,
  Clip,
  ClipMask,
  ClipStroke,
  TransitionType,
  // … unchanged
} from '../../store/types';
```

add to the `ClipEditorActions` interface, after `clipPosition` (line 102-ish, wherever it sits in the block at 58-105):

```ts
  /**
   * The project's frame width in pixels — what `clip.stroke.width` is a
   * fraction of, so the inspector can show it as the pixels the user sees.
   * Derived from the `resolution` selector this hook already had; it is not a
   * new subscription.
   */
  frameWidth: number;
```

and after `handleBlendModeChange`:

```ts
  handleMaskChange: (mask: ClipMask) => void;
  handleStrokeChange: (stroke: ClipStroke) => void;
```

add the action selector immediately after `updateClipAnimation` (line 135):

```ts
  // ESCSUITE-65's mask and stroke go through the `updateClip` that already
  // exists — it takes a Partial<Clip> and pushes history — so this feature adds
  // no store action and no member to ClipSlice's Pick. An *action* selector, in
  // the same shape as the thirteen above: an action's identity never changes, so
  // this cannot cost a re-render, and `ClipEditor.rerender.test.tsx` is what
  // holds that line.
  const updateClip = useEditorStore((state) => state.updateClip);
```

add the two handlers immediately after `handleBlendModeChange` (which ends at line 211):

```ts
  // ESCSUITE-65. `MaskSection` reports what the user did; these decide what gets
  // stored, so the store only ever holds canonical shapes: no `{ kind: 'none' }`,
  // no `{ width: 0 }`, and no radius on a circle. A clip that was never masked
  // and one whose mask was removed are then the same object, which is what makes
  // `undefined === none` the only rule the renderer and the migration need.
  const handleMaskChange = useCallback(
    (mask: ClipMask) => {
      if (!selectedClip) return;
      if (mask.kind === 'none') {
        updateClip(selectedClip.id, { mask: undefined });
        return;
      }
      updateClip(selectedClip.id, {
        mask:
          mask.kind === 'circle'
            ? { kind: 'circle' }
            : { kind: 'rounded', radius: mask.radius ?? DEFAULT_CLIP_MASK_RADIUS },
      });
    },
    [selectedClip, updateClip]
  );

  const handleStrokeChange = useCallback(
    (stroke: ClipStroke) => {
      if (!selectedClip) return;
      updateClip(selectedClip.id, { stroke: stroke.width > 0 ? stroke : undefined });
    },
    [selectedClip, updateClip]
  );
```

and add three entries to the returned object — `frameWidth: resolution.width,` beside `clipPosition`, and `handleMaskChange, handleStrokeChange,` after `handleBlendModeChange`.

- [ ] **Step 9: Render it, and pin where it is and is not offered**

In `apps/artist/src/components/ClipEditor/ClipEditor.tsx`, add the import beside `BlendModeSection` (line 7):

```ts
import { MaskSection } from './MaskSection';
```

add `frameWidth`, `handleMaskChange` and `handleStrokeChange` to the destructure (beside `clipPosition` and `handleBlendModeChange` respectively), and add the section immediately after the `BlendModeSection` block (lines 104-107), before the Effects block:

```tsx
      {/* Mask & Stroke section - media clips only (ESCSUITE-65). Gated exactly
          as Blend Mode is: a text or shape overlay has no drawn box a mask
          could mean anything against. Added *after* Blend Mode and before
          Effects rather than anywhere else, because CollapsibleSection seeds its
          open/closed state positionally (see its doc comment) — moving an
          existing section would hand its state to a different one. */}
      {!isAudio && !isOverlay && (
        <MaskSection
          mask={selectedClip.mask}
          stroke={selectedClip.stroke}
          frameWidth={frameWidth}
          onMaskChange={handleMaskChange}
          onStrokeChange={handleStrokeChange}
        />
      )}
```

In `apps/artist/src/components/ClipEditor/ClipEditor.test.tsx`, add one line to the audio case's assertions (after the `Blend Mode` line at 162):

```ts
      expect(screen.queryByRole('button', { name: 'Mask & Stroke' })).not.toBeInTheDocument()
```

and add one case to the `describe('transform', ...)` block's neighbourhood — put it at the end of the media-clip describe that holds the image and audio cases:

```ts
    it('offers the mask and stroke to a video clip', () => {
      mediaClip({})
      render(<ClipEditor />)

      expect(screen.getByRole('button', { name: 'Mask & Stroke' })).toBeInTheDocument()
    })
```

In `apps/artist/src/components/ClipEditor/ClipEditor.overlay.test.tsx`, add one line to the 'shows no timing controls it cannot honour for an overlay' case (after the `Blend Mode` line at 280):

```ts
    expect(screen.queryByRole('button', { name: 'Mask & Stroke' })).not.toBeInTheDocument()
```

- [ ] **Step 10: Run the whole inspector, and the rerender pin**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor`
Expected: PASS — every suite in the directory, including the six new handler cases and the three gating assertions.

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/ClipEditor/ClipEditor.rerender.test.tsx`
Expected: PASS — 6 tests, **file unchanged**. This is the hard rule: the panel must still pay ≤1 render over ten playback ticks with a clip selected and ≤1 with nothing selected, and the split button ≤4. If any count moved, the new section is subscribing to something it must not; the fix is the subscription, never the assertion.

Run: `git diff --stat apps/artist/src/components/ClipEditor/ClipEditor.rerender.test.tsx`
Expected: no output — the file is not in the diff at all.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/artist/src/components/ClipEditor/MaskSection.tsx \
  apps/artist/src/components/ClipEditor/MaskSection.test.tsx \
  apps/artist/src/components/ClipEditor/clipEditorOptions.ts \
  apps/artist/src/components/ClipEditor/clipEditorOptions.test.ts \
  apps/artist/src/components/ClipEditor/useClipEditorActions.ts \
  apps/artist/src/components/ClipEditor/useClipEditorActions.test.ts \
  apps/artist/src/components/ClipEditor/ClipEditor.tsx \
  apps/artist/src/components/ClipEditor/ClipEditor.test.tsx \
  apps/artist/src/components/ClipEditor/ClipEditor.overlay.test.tsx
git commit -m "$(cat <<'EOF'
feat(artist): a Mask & Stroke section in the clip inspector (ESCSUITE-65)

One new collapsible section on media clips: the mask's shape, a corner-radius
slider for the rounded kind, a stroke width slider and a stroke colour. Gated
exactly as Blend Mode is, because a text or shape overlay has no drawn box
either field could mean anything against (decision 3).

Called MaskSection and not ShapeSection: that name is taken by the shape
*overlay* editor in the same directory, and a panel with two sections titled
"Shape" would be a bug in the UI and an ambiguity in every future grep — the
spec's second named risk.

The section reports what the user did and normalises nothing; the two handlers
decide what is stored. Kind "none" stores undefined, a circle stores no radius,
and a width of 0 stores undefined — so a clip that was never masked and one
whose mask was removed are the same object, which is what keeps
`undefined === none` the only rule the renderer and the migration need to know.

No new store action and no new state subscription. updateClip already takes a
Partial<Clip> and already pushes history, so ClipSlice's Pick is untouched and
one Ctrl+Z takes one change back. The single selector added is an *action*,
whose identity never changes and which therefore cannot cost a render; the frame
width the stroke is shown against comes from the resolution selector this hook
has always had. ClipEditor.rerender.test.tsx is unchanged and still passing,
which is the only proof that claim allows.

The stroke width is labelled in pixels at the current project resolution — 3px,
not 0.0023 — because a fraction is not a number anyone can act on, and the same
fraction honestly reads as 4.5px on a 1080p project. The colour swatch shows
white for the rgba() ESCAPECRAFT hands over, which an <input type="color">
cannot represent, and replaces the stored string only when the user picks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 6: preview/export parity, and a mask after a blur shape

**Files:**
- Modify: `apps/artist/src/components/Preview/PreviewPlayer.rendering.test.tsx` (two cases at the end of `describe('PreviewPlayer drawing')`, which ends at line 176)

**Interfaces:**
- Consumes: `drawClipToCanvas` from `../../core/canvasRenderer`; `createRecordingContext` from `../../test/doubles/canvas`; the store fixtures and `renderPreview` already imported by the file.
- Produces: no exports. The contract is the assertion: for the same clip and the same project size, the preview's recorded media calls are the export's recorded media calls, method for method and argument for argument.

**Two things this task pins, argued in the commit message:**

- **"One shared renderer" is a claim, and this makes it a test.** `apps/artist/CLAUDE.md` (line 658 in the tree as it stands — the spec's 587 has moved) says the preview draws through `core/canvasRenderer.ts`, "the same renderer an export uses". The five pipelines funnelling through two functions is *why* a mask written twice is a mask drawn everywhere, so the slice that relies on it should stop relying on prose. The test is deliberately about **order and arguments**, not pixels: jsdom has no rasteriser and the point is that the preview reaches the same calls in the same sequence.
- **A masked clip drawn after a blur shape overlay is worth one explicit test.** The blur-shape path re-captures the canvas at the identity transform and hands it back (canvasRenderer.ts:244-247). A masked clip *under* a blur shape is uninteresting; a masked clip drawn *after* one is the case where a stray transform or a leaked clip region would show — the spec's fourth named risk.

- [ ] **Step 1: Write the failing tests** — append two cases to `describe('PreviewPlayer drawing')` in `apps/artist/src/components/Preview/PreviewPlayer.rendering.test.tsx`, and add to its imports:

```ts
import { drawClipToCanvas } from '../../core/canvasRenderer'
import { createRecordingContext } from '../../test/doubles/canvas'
```

```ts
  it('draws a masked and stroked clip exactly as an export does (ESCSUITE-65)', async () => {
    const clip = addClip('clip1', 0, 2)
    store().updateClip(clip.id, {
      mask: { kind: 'circle' },
      stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1920 },
    })
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    const frame = preview.frame()

    // The export's own draw, called directly with the same clip and the same
    // project size. `core/exportMP4.ts` reaches this function through
    // `drawMediaWithFrame` and `core/exportWebM.ts` calls it outright, so this
    // *is* what an export records for this clip.
    const exportCtx = createRecordingContext()
    drawClipToCanvas(
      exportCtx as unknown as CanvasRenderingContext2D,
      doubles.media.videos[0],
      store().project.timeline.clips[0],
      0,
      1920,
      1080
    )

    // Every frame opens with the raster transform and the black clear, which is
    // the preview's own business; from the clip's first `save` on, the two must
    // agree method for method.
    expect(frame.methods.slice(2)).toEqual(exportCtx.calls.map((c) => c.method))
    expect(frame.argsFor('ellipse')).toEqual(exportCtx.argsFor('ellipse'))
    expect(frame.argsFor('drawImage').map((args) => args.slice(1))).toEqual(
      exportCtx.argsFor('drawImage').map((args) => args.slice(1))
    )
    // The line width is in project pixels at both ends: the export canvas *is*
    // the project resolution, and the preview's raster transform scales the
    // stroke for free — unlike `ctx.filter`, whose lengths the CTM does not
    // reach (see MediaDrawOptions.filterScale).
    expect(frame.of('stroke')[0].state.lineWidth).toBe(
      exportCtx.stateFor('stroke')[0].lineWidth
    )
    expect(frame.of('stroke')[0].state.strokeStyle).toBe(
      exportCtx.stateFor('stroke')[0].strokeStyle
    )
  })

  it('masks a clip drawn after a blur shape overlay', async () => {
    const clip = addClip('clip1', 0, 4)
    store().updateClip(clip.id, { mask: { kind: 'circle' } })
    // The blur shape goes on a track *below* the clip, so the clip is drawn
    // after it. That path re-captures the canvas at the identity transform and
    // hands it back (canvasRenderer.ts:244-247), which is exactly where a stray
    // transform or a leaked clip region would show up.
    const lower = store().project.timeline.tracks[0].id
    const upper = store().addTrack('Upper').id
    store().moveClipToTrack(clip.id, upper)
    store().addShapeOverlayClip({ type: 'blur', blurAmount: 10 }, lower, 0, 4)
    store().setSelectedClipId(null)

    const preview = await renderPreview()
    const frame = preview.frame()

    // The masked clip still clips to its own circle, and the frame's save/restore
    // stack still balances across both draws.
    expect(frame.argsFor('ellipse')).toHaveLength(1)
    expect(frame.of('clip').length).toBeGreaterThanOrEqual(1)
    expect(frame.of('save')).toHaveLength(frame.of('restore').length)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Preview/PreviewPlayer.rendering.test.tsx`
Expected: this is the one task whose tests should pass on the first run, because Task 3 already made both true. **Run it before writing anything and record which** — if the parity case fails with `expected [ 'save', 'drawImage', 'restore' ] to deeply equal [ 'save', 'save', 'beginPath', 'ellipse', 'clip', 'drawImage', 'restore', 'beginPath', 'ellipse', 'stroke', 'restore' ]`, the preview is not reaching the shared renderer for masked clips and that is a real bug in Task 3's work; fix it there. If the ordering differs only in the two leading calls, adjust the `slice(2)` to whatever the frame's opening pair actually is (`setTransform`, `fillRect`) and say so.

To make the red real rather than assumed, run it once against Task 2's commit before running it against Task 3's:

Run: `git stash && git stash list` — no; instead: `git show HEAD~1:apps/artist/src/core/canvasRenderer.ts | diff - apps/artist/src/core/canvasRenderer.ts`
Expected: the four-line blocks from Task 3, confirming the parity case is asserting behaviour that this branch added rather than behaviour that was always there. Record that diff in the step notes in place of a red run.

- [ ] **Step 3: Run the whole preview suite**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Preview`
Expected: PASS — every preview suite, the new pair included.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/artist/src/components/Preview/PreviewPlayer.rendering.test.tsx
git commit -m "$(cat <<'EOF'
test(artist): the preview draws a masked clip exactly as an export does

"One shared renderer, two media entry points, five pipelines" is the claim this
whole slice rests on: it is why a mask written twice in canvasRenderer.ts is a
mask drawn in the preview, both exports, both transition paths and the headless
renderer. apps/artist/CLAUDE.md says it in prose; this says it in calls.

A masked and stroked clip in the store, composited by the real PreviewPlayer, is
compared against drawClipToCanvas called directly with the same clip and the
same project size — which is what exportWebM calls outright and what exportMP4
reaches through drawMediaWithFrame. Method for method, argument for argument,
and the stroke's line width and colour too: the export canvas is the project
resolution and the preview's raster transform scales the stroke for free, unlike
ctx.filter, whose lengths the CTM does not reach.

Plus the one interaction the design doc flags: a masked clip drawn *after* a blur
shape overlay, whose path re-captures the canvas at the identity transform and
hands it back. A stray transform or a leaked clip region would show there and
nowhere else.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 7: the handoff mapping, both apps, and the changesets

**Files:**
- Modify: `apps/artist/src/utils/overlayPlacement.ts` (three constants after `OVERLAY_MARGIN_FRACTION` at line 37; a private `overlayBoxFor`; two new exported functions; the doc sentence at 111-112)
- Modify: `apps/artist/src/utils/overlayPlacement.test.ts` (two describe blocks)
- Modify: `apps/artist/src/store/clipSlice.ts` (the imports at line 14; the clip literal at 152-157)
- Modify: `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts` (two cases)
- Modify: `apps/craft/src/core/overlayGeometry.ts` (three constants after `DEFAULT_OVERLAY_PADDING` at line 29; four literal sites at 185-186, 191, 193, 203-205)
- Create: `.changeset/artist-clip-mask.md`
- Create: `.changeset/craft-overlay-border-constants.md`

**Interfaces:**
- Consumes: `ClipMask`, `ClipStroke` from `../store/types` (Task 1); `OverlayPlacement` from the shared package via `../store/types`; `PixelSize`, `PixelFrame`, `COMPOSITOR_MAX_WIDTH` already in `overlayPlacement.ts`.
- Produces, in `apps/artist/src/utils/overlayPlacement.ts`:
  ```ts
  export const OVERLAY_CORNER_RADIUS_FRACTION: number; // 8 / 1280
  export const OVERLAY_STROKE_WIDTH_FRACTION: number;  // 3 / 1280
  export const OVERLAY_STROKE_COLOR: string;           // 'rgba(255, 255, 255, 0.8)'

  export function maskForPlacement(
    placement: OverlayPlacement,
    frame: PixelSize,
    partSize: PixelSize
  ): ClipMask;

  export function strokeForPlacement(): ClipStroke;
  ```
  and in `apps/craft/src/core/overlayGeometry.ts`:
  ```ts
  export const OVERLAY_BORDER_COLOR = 'rgba(255, 255, 255, 0.8)';
  export const OVERLAY_BORDER_WIDTH = 3;
  export const OVERLAY_CORNER_RADIUS = 8;
  ```

**Five decisions this task pins, all argued in the commit message:**

- **`maskForPlacement` takes the part's size, which the spec's two-argument sketch left out.** The stored radius is a fraction of the **clip's shorter drawn side** (decision 2), and the drawn box's height is `overlayWidth / the part's own aspect` — ARTIST draws the camera un-stretched, unlike `drawWebcamOverlay`'s hard-coded 16:9 box. The same three arguments `overlayPlacementToTransform` already takes, in the same order, so the two call sites read alike.
- **The box arithmetic is extracted, not duplicated.** A private `overlayBoxFor` now answers the overlay's width, height and scale for both `overlayPlacementToTransform` and `maskForPlacement`. The existing tests in `overlayPlacement.test.ts` are the proof the extraction changed nothing; not one of them is edited.
- **The radius comes out frame-independent, and that is the point.** `(frame.width × 8/1280) / min(boxWidth, boxHeight)` — both numerator and box scale linearly with the frame, so the stored fraction is the same at 1280 and at 1920 and reproduces ESCAPECRAFT's 8 px at the compositor cap and 12 px at 1080p. A stored pixel count would have been silently wrong the first time a user opened the resolution dialog.
- **`strokeForPlacement()` takes nothing, deliberately.** ESCAPECRAFT draws the same border whatever corner or shape the camera is in — `overlayGeometry.ts` sets `strokeStyle` and `lineWidth` to the same two literals in both of its branches. The function exists so the call site in `clipSlice.ts` reads as a mapping beside the other two and so the two constants are named exactly once on this side.
- **The CRAFT change is a pure move.** `rgba(255, 255, 255, 0.8)` and `3` appear twice each (185-186 and 204-205) and `8` once as a function-local (191); named as module constants, the same four values reach the same four sites. The composited preview and the composite MP4 draw the same pixels, and the proof is that `overlayGeometry.test.ts:138-139`, `compositor.test.ts:418-419`, the converter tests and both craft perf tests are **byte-unchanged** and green. `git diff --name-only` verifies that in Step 7.

- [ ] **Step 1: Write the failing mapping tests** — append two describe blocks to `apps/artist/src/utils/overlayPlacement.test.ts`, and extend its imports:

```ts
import {
  maskForPlacement,
  overlayMarginFor,
  overlayPlacementToTransform,
  strokeForPlacement,
  OVERLAY_CORNER_RADIUS_FRACTION,
  OVERLAY_MARGIN_FRACTION,
  OVERLAY_STROKE_COLOR,
  OVERLAY_STROKE_WIDTH_FRACTION,
} from './overlayPlacement'
import { maskPathFor } from '../core/clipMask'
```

```ts
// What shape the handed-over webcam clip arrives in (ESCSUITE-65, decisions 1,
// 2 and 6).
//
// The numbers are ESCAPECRAFT's, from `drawOverlay`
// (apps/craft/src/core/overlayGeometry.ts): an inscribed circle at
// min(webcamWidth, webcamHeight) / 2, a rounded rectangle at a flat 8 px, and a
// border of `rgba(255, 255, 255, 0.8)` at 3 px — all of them pixels of a canvas
// capped at 1280 wide. ARTIST stores fractions, so every case below converts
// back through `maskPathFor` and compares with those literals.
describe('maskForPlacement', () => {
  it('maps a circle placement to a circle mask', () => {
    // Decision 1: `maskPathFor` inscribes the circle in the drawn box, which is
    // exactly what ESCAPECRAFT drew, so the mask needs no radius of its own.
    expect(maskForPlacement(placement('bottom-right'), COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA))
      .toEqual({ kind: 'circle' })
  })

  it('reproduces craft 8px corner at the compositor cap', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.2, shape: 'rectangle' }

    const mask = maskForPlacement(placement, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA)

    expect(mask.kind).toBe('rounded')
    // The drawn box at 1280 x 0.2 is 256 x 144, and the stored fraction has to
    // put 8 canvas pixels on its corners — `ctx.roundRect(x, y, w, h, 8)`,
    // overlayGeometry.ts:193.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 256, 144)).toMatchObject({ radius: 8 })
    expect(OVERLAY_CORNER_RADIUS_FRACTION).toBe(8 / 1280)
  })

  it('scales the corner with the frame rather than freezing it at 8 pixels', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.2, shape: 'rectangle' }
    const project = { width: 1920, height: 1080 }

    const mask = maskForPlacement(placement, project, SIXTEEN_BY_NINE_CAMERA)

    // 1920 x 8/1280 = 12 px on a 384 x 216 box. The fraction is the same one as
    // at 1280 — both the radius and the box scale with the frame — which is the
    // whole reason it is stored as a fraction: ARTIST has a resolution-change
    // dialog, and a pixel count would silently change the rounding under a clip.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 384, 216)).toMatchObject({ radius: 12 })
    expect(mask.radius).toBeCloseTo(
      maskForPlacement(placement, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA).radius!,
      12
    )
  })

  it('measures the corner against the clip shorter side, camera aspect and all', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.25, shape: 'rectangle' }
    const project = { width: 1920, height: 1080 }

    const mask = maskForPlacement(placement, project, { width: 640, height: 480 })

    // A 4:3 camera at size 0.25 of a 1920 frame is drawn 480 x 360, not the
    // compositor's 480 x 270: ARTIST draws the part un-stretched. The shorter
    // side is 360, and the radius still has to come out at 1920 x 8/1280 = 12.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 480, 360)).toMatchObject({ radius: 12 })
  })

  it('falls back to the compositor 16:9 box for a part with no dimensions', () => {
    const placement: OverlayPlacement = { position: 'top-left', size: 0.2, shape: 'rectangle' }

    const mask = maskForPlacement(placement, COMPOSITOR_FRAME, { width: 0, height: 0 })

    // Nothing ESCAPECRAFT writes, but IndexedDB is not type-checked. The box
    // falls back to 16:9 — 256 x 144 — the same fallback the transform makes,
    // rather than dividing by zero into a NaN radius.
    expect(Number.isFinite(mask.radius)).toBe(true)
    expect(maskPathFor('rounded', mask.radius, 0, 0, 256, 144)).toMatchObject({ radius: 8 })
  })
})

describe('strokeForPlacement', () => {
  it('is craft white 3px border, as a fraction of the frame', () => {
    expect(strokeForPlacement()).toEqual({
      color: 'rgba(255, 255, 255, 0.8)',
      width: 3 / 1280,
    })
    expect(OVERLAY_STROKE_COLOR).toBe('rgba(255, 255, 255, 0.8)')
    expect(OVERLAY_STROKE_WIDTH_FRACTION).toBe(3 / 1280)
  })

  it('takes no arguments, because craft border does not depend on any', () => {
    // `drawOverlay` sets the same strokeStyle and the same lineWidth in both of
    // its branches (overlayGeometry.ts:185-186 and 204-205), whatever corner the
    // camera is in and whatever shape it is. This exists so the call site in
    // `clipSlice.ts` reads as a mapping beside the other two, and so the two
    // literals are named exactly once on this side of the handoff.
    expect(strokeForPlacement()).toEqual(strokeForPlacement())
    expect(strokeForPlacement.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/overlayPlacement.test.ts`
Expected: FAIL — `SyntaxError: The requested module './overlayPlacement' does not provide an export named 'maskForPlacement'`.

- [ ] **Step 3: Implement the two mappings**

In `apps/artist/src/utils/overlayPlacement.ts`, extend the import at line 13:

```ts
import {
  DEFAULT_TRANSFORM,
  type ClipMask,
  type ClipStroke,
  type ClipTransform,
  type OverlayPlacement,
} from '../store/types';
```

add the three constants immediately after `OVERLAY_MARGIN_FRACTION` (line 37):

```ts
/**
 * ESCAPECRAFT's rounded-rectangle corner, as a fraction of the frame's width.
 *
 * `drawOverlay` rounds the camera's corners by a flat `OVERLAY_CORNER_RADIUS`
 * (8 px) on a canvas capped at `COMPOSITOR_MAX_WIDTH`
 * (`apps/craft/src/core/overlayGeometry.ts`), so what the user saw is 8/1280 of
 * the frame. Stored as a fraction for the same reason the inset is one: ARTIST
 * has a resolution-change dialog, and a pixel count would silently restyle the
 * corners of a clip the user never touched.
 */
export const OVERLAY_CORNER_RADIUS_FRACTION = 8 / COMPOSITOR_MAX_WIDTH;

/**
 * ESCAPECRAFT's border weight, as a fraction of the frame's width.
 *
 * `OVERLAY_BORDER_WIDTH` (3 px) on the same capped canvas. A fraction for the
 * same reason again — and because `clip.stroke.width` is defined as a fraction
 * of the frame, so this is the unit the field is already in.
 */
export const OVERLAY_STROKE_WIDTH_FRACTION = 3 / COMPOSITOR_MAX_WIDTH;

/**
 * ESCAPECRAFT's border colour, spelled exactly as it draws it —
 * `OVERLAY_BORDER_COLOR`. Carried as the CSS string rather than a hex triple
 * because the alpha is part of the look, and `clip.stroke.color` stores whatever
 * it is given.
 */
export const OVERLAY_STROKE_COLOR = 'rgba(255, 255, 255, 0.8)';
```

add this private helper immediately before `overlayPlacementToTransform` (line 114):

```ts
/** The overlay's drawn size in frame pixels, and the scale that produces it. */
interface OverlayBox {
  width: number;
  height: number;
  scale: number;
}

/**
 * The rectangle the camera is drawn into, and the scale that gets it there.
 *
 * Extracted so `overlayPlacementToTransform` and `maskForPlacement` measure the
 * same box: the mask's radius is a fraction of the clip's shorter **drawn** side,
 * so a second copy of this arithmetic would be a second place for the two to
 * disagree about what the clip's shorter side is.
 *
 * The **width** is the compositor's exactly (`size` x the frame's width) and the
 * **aspect** is the part's own, because `drawWebcamOverlay` builds a 16:9 box
 * whatever the camera is and stretches a 4:3 picture into it — a bug to leave
 * behind rather than reproduce.
 */
function overlayBoxFor(
  placement: OverlayPlacement,
  frameWidth: number,
  partSize: PixelSize
): OverlayBox {
  const width = frameWidth * placement.size;
  // A part with no dimensions was not written by ESCAPECRAFT. It still belongs
  // in its corner: the box falls back to the compositor's 16:9 and the clip to
  // its native size, which beats a clip zero pixels wide.
  const hasSize = partSize.width > 0 && partSize.height > 0;
  const aspect = hasSize ? partSize.width / partSize.height : FALLBACK_OVERLAY_ASPECT;
  return {
    width,
    height: width / aspect,
    scale: hasSize ? width / partSize.width : DEFAULT_TRANSFORM.scaleX,
  };
}
```

replace the body of `overlayPlacementToTransform`'s first six statements (lines 125-134, `const overlayWidth` through `const overlayHeight`) with:

```ts
  const box = overlayBoxFor(placement, frame.width, partSize);
  const overlayWidth = box.width;
  const overlayHeight = box.height;
  const margin = overlayMarginFor(frame.width);
```

and change the returned `scaleX`/`scaleY` to `box.scale`. Replace the docstring's final paragraph (lines 111-112) — "`placement.shape` is read and **ignored** — a mask on every clip is ESCSUITE-65, and when it exists the circle maps onto it here." — with:

```
 * `placement.shape` is no longer ignored: `maskForPlacement` below turns it into
 * the clip's mask (ESCSUITE-65), named against `OVERLAY_CORNER_RADIUS_FRACTION`,
 * and `strokeForPlacement` carries the border across as
 * `OVERLAY_STROKE_COLOR` at `OVERLAY_STROKE_WIDTH_FRACTION`. This function
 * still answers geometry alone — the two are separate properties on the clip,
 * and `store/clipSlice.ts` maps all three side by side.
```

then append the two functions:

```ts
/**
 * The mask a handed-over webcam clip arrives with (ESCSUITE-65, decisions 1 and
 * 2).
 *
 * A `'circle'` placement needs no radius at all: `core/clipMask.ts` inscribes
 * the circle in the drawn box at `min(w, h) / 2`, which is precisely the circle
 * ESCAPECRAFT drew (`overlayGeometry.ts:143-145`).
 *
 * A `'rectangle'` placement becomes a `'rounded'` mask whose radius is stored as
 * a **fraction of the clip's shorter drawn side**, because that is the unit
 * `ClipMask.radius` is in. The conversion is
 * `(frame.width x OVERLAY_CORNER_RADIUS_FRACTION) / min(box.width, box.height)`,
 * which reproduces ESCAPECRAFT's 8 px at the compositor's 1280 cap and 12 px on
 * a 1080p project — and comes out to the *same fraction* at both, since the
 * radius and the box scale with the frame together. That is the property a
 * stored pixel count would have lost the moment a user opened the
 * resolution-change dialog.
 *
 * The three arguments are `overlayPlacementToTransform`'s, in its order, and for
 * the same reasons: `frame` is the rectangle the camera sat in a corner **of**
 * (the take's screen recording as ARTIST draws it, not the canvas), and
 * `partSize` is the camera's own pixels, because ARTIST draws it un-stretched.
 */
export function maskForPlacement(
  placement: OverlayPlacement,
  frame: PixelSize,
  partSize: PixelSize
): ClipMask {
  if (placement.shape === 'circle') return { kind: 'circle' };

  const box = overlayBoxFor(placement, frame.width, partSize);
  const radiusInFramePixels = frame.width * OVERLAY_CORNER_RADIUS_FRACTION;
  return {
    kind: 'rounded',
    radius: radiusInFramePixels / Math.min(box.width, box.height),
  };
}

/**
 * The border a handed-over webcam clip arrives with (ESCSUITE-65, decision 6).
 *
 * Takes nothing, deliberately: `drawOverlay` sets the same `strokeStyle` and the
 * same `lineWidth` in both of its branches, whatever corner the camera is in and
 * whatever shape it is. This exists so the mapping in `store/clipSlice.ts` reads
 * as three properties side by side rather than two calls and an inline object,
 * and so the two literals are named exactly once on this side of the handoff —
 * they are named on the other side too (`OVERLAY_BORDER_COLOR` and
 * `OVERLAY_BORDER_WIDTH`), so the two cannot drift silently.
 */
export function strokeForPlacement(): ClipStroke {
  return { color: OVERLAY_STROKE_COLOR, width: OVERLAY_STROKE_WIDTH_FRACTION };
}
```

- [ ] **Step 4: Run the mapping tests, and the extraction's proof**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/overlayPlacement.test.ts`
Expected: PASS — 18 tests: the 11 already there **unedited** (which is the proof that extracting `overlayBoxFor` changed no behaviour), plus 5 in `maskForPlacement` and 2 in `strokeForPlacement`.

Run: `git diff apps/artist/src/utils/overlayPlacement.test.ts | grep '^-'`
Expected: only the import block. Not one existing assertion changed.

- [ ] **Step 5: Write the failing placement tests** — add two cases to `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts`, after 'seeds the webcam clip transform from the take overlay placement' (which ends at line 112), and add `maskForPlacement, strokeForPlacement` to its import from `'../../utils/overlayPlacement'`

```ts
  it('gives the webcam clip the mask and stroke it was recorded with', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const webcam = placedClips()[1]
    // ESCSUITE-65: the handoff now carries the shape *and* the border, not just
    // the corner and the size. The screen recording is 1920x1080 and the project
    // is 1920x1080, so the frame the camera sat in a corner of is the canvas.
    expect(webcam.mask).toEqual(
      maskForPlacement(webcamPart.overlayPlacement!, store().project.resolution, {
        width: webcamPart.width,
        height: webcamPart.height,
      })
    )
    expect(webcam.stroke).toEqual(strokeForPlacement())
    expect(webcam.mask).toEqual({ kind: 'circle' })
    expect(webcam.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 })
  })

  it('gives every other part neither', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart, micPart])

    // The mask travels with the placement, which `app/takeImport.ts` puts on the
    // camera part alone — so the screen recording is an ordinary rectangular
    // clip and the microphone, which is never drawn, carries nothing derived
    // from a picture at all (ESCSUITE-71's rule, restated for two more fields).
    expect(placedClips()[0].mask).toBeUndefined()
    expect(placedClips()[0].stroke).toBeUndefined()
    expect(placedClips()[2].mask).toBeUndefined()
    expect(placedClips()[2].stroke).toBeUndefined()
  })

  it('never masks an audio part, even one carrying a placement', () => {
    const misfiled: TakeClipPart = { ...micPart, overlayPlacement: webcamPart.overlayPlacement }

    store().placeTakeOnTimeline([screenPart, misfiled])

    // Same question as the transform's, and the same answer: having no picture
    // wins over carrying a placement. IndexedDB is not type-checked.
    expect(placedClips()[1].mask).toBeUndefined()
    expect(placedClips()[1].stroke).toBeUndefined()
  })
```

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/__tests__/projectStore.takePlacement.test.ts`
Expected: FAIL — `expected undefined to deeply equal { kind: 'circle' }`.

- [ ] **Step 6: Map it in the store**

In `apps/artist/src/store/clipSlice.ts`, extend the import at line 14:

```ts
import {
  maskForPlacement,
  overlayPlacementToTransform,
  strokeForPlacement,
} from '../utils/overlayPlacement';
```

Inside `placeTakeOnTimeline`'s `parts.forEach`, immediately before the `clips.push({` call, add:

```ts
      // The placement the camera was drawn with, or nothing — asked once, so
      // the transform, the mask and the stroke cannot disagree about whether
      // this part is the take's camera. An audio part never takes any of the
      // three: it is never drawn, so a picture property on it would be a number
      // nobody reads that looks like a decision (ESCSUITE-71).
      const placement = part.mediaType !== 'audio' ? part.overlayPlacement : undefined;
```

then replace the `transform:`
property (lines 152-154) and follow it with the two new ones:

```ts
        transform: placement
          ? overlayPlacementToTransform(placement, resolution, part, overlayFrame)
          : { ...DEFAULT_TRANSFORM },
        // ESCSUITE-65: the shape and the border the camera was recorded with,
        // mapped beside the corner and the size rather than bolted on after.
        // Spread conditionally so a part that is not the camera produces the
        // same clip object it produced before this ticket — byte for byte, not
        // just `toEqual`-equal.
        ...(placement
          ? {
              mask: maskForPlacement(placement, overlayFrame ?? resolution, part),
              stroke: strokeForPlacement(),
            }
          : {}),
```

Leave the existing comment block above `transform:` in place and append one sentence to it: `The same question decides the mask and the stroke (ESCSUITE-65).`

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/__tests__/projectStore.takePlacement.test.ts`
Expected: PASS — 16 tests: the 13 already there **unedited**, plus the three new ones. The first of the thirteen, "places a single-part take exactly as dropping it from the library would", is the one that matters here: it compares the whole clip object against `addClipToTimeline`'s, so a `mask: undefined` key leaking onto a non-camera part would have to be invisible to `toEqual` — and the conditional spread means it is not there at all.

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store src/app`
Expected: PASS — every store and app suite, `app/takeImport.test.ts` and `app/useHostIntegration.test.ts` included, unchanged.

- [ ] **Step 7: Name craft's two literals — a pure move**

In `apps/craft/src/core/overlayGeometry.ts`, add after `DEFAULT_OVERLAY_PADDING` (line 29):

```ts
/**
 * The camera's border, drawn on the mask's own outline after the frame.
 *
 * Named because ESCAPEARTIST now reproduces it: a handed-over webcam clip
 * arrives with `clip.stroke` set to this colour at
 * `OVERLAY_STROKE_WIDTH_FRACTION` of the frame width
 * (`apps/artist/src/utils/overlayPlacement.ts`, ESCSUITE-65). Both sides name
 * the same two numbers so a change to the border here cannot silently stop
 * matching what the editor draws.
 *
 * Both are pixels of *this* frame, unlike the padding, which
 * `overlayPaddingFor` scales — the border and the corner are the weight and the
 * radius the compositor has always drawn, and this commit changes neither.
 */
export const OVERLAY_BORDER_COLOR = 'rgba(255, 255, 255, 0.8)';
export const OVERLAY_BORDER_WIDTH = 3;

/**
 * The rounded overlay's corner radius, in pixels of this frame.
 *
 * Was a function-local in `drawOverlay`; lifted out unchanged for the same
 * reason as the border — ARTIST stores it as `OVERLAY_CORNER_RADIUS_FRACTION`
 * (8/1280) and the two should be readable side by side.
 */
export const OVERLAY_CORNER_RADIUS = 8;
```

Then replace the four literal sites, and only those:

- line 185-186 (circle branch): `ctx.strokeStyle = OVERLAY_BORDER_COLOR;` / `ctx.lineWidth = OVERLAY_BORDER_WIDTH;`
- line 191: `const borderRadius = OVERLAY_CORNER_RADIUS;`
- line 204-205 (rectangle branch): `ctx.strokeStyle = OVERLAY_BORDER_COLOR;` / `ctx.lineWidth = OVERLAY_BORDER_WIDTH;`

Nothing else in the file changes. `ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius)` at 193 and 203 keeps reading the local, so the two stroke sites and the two path sites all still receive 8 and 3.

- [ ] **Step 8: Prove the craft change is a pure move**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/overlayGeometry.test.ts src/core/compositor.test.ts src/core/converter.test.ts src/core/converterInterop.test.ts`
Expected: PASS, every suite, **with not one test file edited**. `overlayGeometry.test.ts:138-139` and `compositor.test.ts:418-419` assert `strokeStyle === 'rgba(255, 255, 255, 0.8)'` and `lineWidth === 3` against the literals; `overlayGeometry.test.ts:105` asserts `roundRect(x, y, 256, 144, 8)`. All three still hold because the values did not move — only their names did.

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/compositor.perf.test.ts src/core/converter.perf.test.ts`
Expected: PASS — the compositor's and converter's per-frame ceilings, untouched. A pure move cannot change a call count, and this is the check that says so.

Run: `git diff --name-only apps/craft | grep test`
Expected: **no output**. A single craft test file in the diff means the move was not pure and needs undoing rather than accommodating.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 9: The artist changeset**

Create `.changeset/artist-clip-mask.md`:

```markdown
---
'@escapesuite/artist': minor
---

**Any video or image clip can now be masked to a circle or a rounded rectangle, and given a
border.** Select a clip and open the new **Mask & Stroke** section of the inspector: pick a
shape, set how round the corners are, and set the border's width and colour. Both show up
everywhere the clip does — in the preview, in an exported MP4 or WebM, and through a
transition — because they are drawn by the one renderer all of those share.

**A webcam clip handed over from ESCAPECRAFT now arrives with its circle and its white
border.** Before this release, "Record webcam as a separate track" gave you the camera in the
right corner at the right size but as a bare rectangle, so the clip on the timeline did not
look like the recording you had just watched. It does now — and because the shape and the
border are ordinary clip properties, you can change either one, or take them off.

Two details worth knowing. The corner radius is a proportion of the clip rather than a number
of pixels, and the border's width is a proportion of the frame, so changing a project's
resolution keeps a masked clip looking the way you left it instead of quietly restyling it.
And neither can be animated: a mask that changed shape halfway through a clip is not a thing
this release does.

The mask and the border are drawn on the clip's picture only. The selection box and the
click target in the preview stay rectangular, and the thumbnail in your media library — which
belongs to the source file rather than to one clip of it — is unmasked.
```

- [ ] **Step 10: The craft changeset**

Create `.changeset/craft-overlay-border-constants.md`:

```markdown
---
'@escapesuite/craft': patch
---

Internal only, with no change to what anything records or draws: the webcam overlay's border
colour and width, and its corner radius, are now named constants in
`core/overlayGeometry.ts` rather than literals repeated at four call sites.

ESCAPEARTIST reproduces the same border on a handed-over webcam clip (ESCSUITE-65), so both
apps now name the same numbers in one place each and a change to the border here cannot
silently stop matching what the editor draws. The live preview, a composited
picture-in-picture recording and a re-composited MP4 all paint exactly the pixels they did
before — pinned by the compositor, converter and overlay-geometry suites, which are unchanged.
```

- [ ] **Step 11: Full verification, then coverage**

Run each and confirm the stated result:

- `pnpm --filter @escapesuite/artist test:run` → PASS
- `pnpm --filter @escapesuite/artist typecheck` → exit 0, no output
- `pnpm --filter @escapesuite/artist lint` → exit 0
- `pnpm --filter @escapesuite/craft test:run` → PASS
- `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint` → exit 0
- `pnpm --filter @escapesuite/shared test:run` → PASS (nothing here touches it; this proves it)
- `git diff --name-only apps/craft | grep test` → no output
- `git diff --stat apps/artist/src/components/ClipEditor/ClipEditor.rerender.test.tsx` → no output

Run: `pnpm --filter @escapesuite/artist test:coverage`
Expected: PASS with no threshold error.

Run: `pnpm --filter @escapesuite/craft test:coverage`
Expected: PASS with no threshold error.

Run: `pnpm coverage:report`
Expected: a table. Read both apps' four `actual% / threshold%` pairs. The baselines are artist **99.38 / 98.71 / 93.51 / 98.95** against floors **99 / 98 / 93 / 98**, and craft **100.00 / 99.46 / 97.55 / 100.00** against **100 / 99 / 97 / 100**.

If a figure has crossed a whole percent, update all three places in one commit: `thresholds` in `apps/artist/vite.config.ts` (line 224) or `apps/craft/vite.config.ts` (line 45), that app's entry in `scripts/coverage-report.mjs`, and the root `CLAUDE.md` coverage table (lines 535-536) *plus* one sentence in the "Where it stands" paragraph naming this work and the date, in the voice of the entries already there — e.g. "`@escapesuite/artist` was re-measured 2026-09-25 at the end of ESCSUITE-65 slice 1 (a mask and a stroke on every media clip): …".

If a figure is *below* a floor, add the missing test rather than touching the floor. The branches most likely to be short, and where each one's test already is: `maskPathFor`'s degenerate-box and `radius <= 0` arms (Task 2, its two `it.each` groups), `traceRoundedRect`'s `arcTo` fallback (Task 2, the delete-`roundRect` case), `visibleClipStroke`'s two arms (Task 2), `applyClipStroke`'s zero-area early return (Task 2), the `if (stroke)` arms in both draw functions (Task 3, the four-way `it.each` per function), `swatchValue`'s non-hex arm and the `disabled` arm (Task 5), `handleMaskChange`'s three arms (Task 5), `overlayBoxFor`'s `hasSize` fallback (Task 7's no-dimensions case *and* the pre-existing transform case), and `maskForPlacement`'s circle arm (Task 7). Every one of them has a test; a gap means a test is not reaching it.

- [ ] **Step 12: Commit**

```bash
git add apps/artist/src/utils/overlayPlacement.ts apps/artist/src/utils/overlayPlacement.test.ts \
  apps/artist/src/store/clipSlice.ts \
  apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts \
  apps/craft/src/core/overlayGeometry.ts \
  .changeset/artist-clip-mask.md .changeset/craft-overlay-border-constants.md \
  apps/artist/vite.config.ts apps/craft/vite.config.ts scripts/coverage-report.mjs CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: a handed-over webcam clip arrives with its circle and its border (ESCSUITE-65)

The last sentence of ESCSUITE-14's handoff: placement.shape was read and
ignored, and it turns out the border was too. Both now map.

maskForPlacement turns 'circle' into { kind: 'circle' } with no radius at all —
core/clipMask.ts inscribes the circle at min(w, h) / 2, which is precisely the
circle ESCAPECRAFT drew — and 'rectangle' into a rounded mask whose radius is
stored as a fraction of the clip's shorter drawn side. The conversion reproduces
craft's flat 8px at the compositor's 1280 cap and 12px on a 1080p project, and
comes out to the same fraction at both, because the radius and the box scale
with the frame together. That is exactly the property a stored pixel count would
have lost the first time a user opened the resolution-change dialog.

It takes the part's own size, which the design sketch left out: ARTIST draws the
camera un-stretched, so a 4:3 camera's drawn box is 480x360 where the
compositor's was 480x270, and the shorter side the fraction resolves against is
the one ARTIST will actually draw. The box arithmetic is extracted into one
private helper both this and overlayPlacementToTransform use, rather than
copied — overlayPlacement.test.ts is unedited and green, which is the proof that
changed nothing.

strokeForPlacement takes nothing, deliberately: drawOverlay sets the same
strokeStyle and lineWidth in both of its branches, whatever corner and whatever
shape. It exists so clipSlice maps the corner, the shape and the border as three
properties side by side, and so the two literals are named once on this side.

They are named on craft's side too, which is a pure move: the colour and the
width appeared twice each and the corner radius once as a function-local, and
all four sites now read module constants. The compositor's preview, a composited
PiP recording and a re-composited MP4 paint the same pixels — proven by every
craft suite, including both perf suites, being byte-unchanged and green.

Whether a part is the take's camera is now asked once per part rather than three
times, so the transform, the mask and the stroke cannot disagree; and the two new
properties are spread conditionally, so a part that is not the camera produces
the clip object it produced before this commit rather than one with two undefined
keys on it.

The artist changeset leads with the feature every user gets — any clip can be
masked and bordered — and names the handoff second; craft's says plainly that
nothing it draws has moved.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage.**

| Spec requirement | Where it lives |
|---|---|
| (b) `ClipMaskKind`, `ClipMask`, `ClipStroke` exactly as specified, on `Clip` after `effects` (types.ts:326) | Task 1, Step 4 |
| (b) Not in `ClipTransform`; argued from `AnimatableProperty` and `DEFAULT_TRANSFORM` | Task 1, decision 1 + commit message |
| (b) Not keyframeable — neither field joins `AnimatableProperty` or `ClipAnimation.keyframes` (decision 4) | Global Constraint 3; Task 1 decision 2; Task 4 asserts `animationLookupsPerFrame` unchanged in both suites |
| (b) `ClipStroke` reuses `ShapeOverlayData`'s vocabulary but is its own object | Task 1, decision 5 |
| (b) No migration, `DB_VERSION` stays 1, snapshot round trip | Global Constraint 13; Task 1 Steps 1-2 (migration test, snapshot test, plus duplicate/undo) |
| (c) One `beginPath → ellipse\|roundRect → clip` inside the existing save/restore, after the rotation (379-383 / 504-508), before `drawImage` (389 / 514) | Task 3, Step 3, both functions; asserted by Task 3's rotation-order cases |
| (c) 3 recorded calls per masked clip, no extra `drawImage`, no extra `getAnimatedValues`, no allocation, **no `closePath()`** | Task 2 (`applyClipMask`'s exact three-call assertion, no `Path2D`); Task 3's exact-cost `it.each`; Task 4's `drawImages`/`animatedValues` assertions |
| (c) A wipe's `clip()` intersects with the mask | Task 3, 'records two clips for a masked clip inside a wipe', both functions |
| (c) `core/clipMask.ts` holding `maskPathFor` + `applyClipMask`, and `applyClipStroke` beside it | Task 2 |
| (c) The stroke drawn after the image with the clip region gone and the rotation kept; inner save/restore; `saves === restores`; a clip with neither records today's calls | Task 3, all six ordering cases and the four-way cost `it.each`, per function |
| (c) Stroke line width is `stroke.width × frame width`; colour as given | Task 2's two width cases and the `rgba` colour case; Task 6's preview/export width parity |
| (d) `MaskSection.tsx`, not a second `ShapeSection`; `BlendModeSection`'s shape; `defaultOpen={false}`; `CLIP_MASK_KINDS` in `clipEditorOptions.ts` beside `BLEND_MODES`; a radius row shown only for `rounded` | Task 5, Steps 3-4, and the four `MaskSection.test.tsx` cases that pin the title, order, collapse and conditional row |
| (d) Stroke width slider labelled in pixels at the project resolution; colour input; width 0 writes `stroke: undefined` | Task 5's `3px`/`4.5px`/`0px` cases and `handleStrokeChange`'s removal case |
| (d) Two handlers modelled on `handleBlendModeChange`, calling the existing `updateClip`; no new store action, no new `ClipSlice` member | Task 5, Step 8; the history case proves `updateClip` already pushes |
| (d) Gated at `ClipEditor.tsx:105`; no new store subscription; never `currentTime`; rerender counts unchanged | Global Constraint 8; Task 5 Steps 9-10, including the `git diff --stat` check on the rerender file |
| (e) `maskForPlacement` / `strokeForPlacement`; `OVERLAY_CORNER_RADIUS_FRACTION = 8/1280`; `OVERLAY_STROKE_WIDTH_FRACTION = 3/1280`; `OVERLAY_STROKE_COLOR`; mapped in `placeTakeOnTimeline` | Task 7, Steps 3 and 6 |
| (e) Craft names its two inline literals; compositor and converter tests byte-unchanged | Task 7, Steps 7-8, with `git diff --name-only` as the proof |
| (e) The `shape`-is-ignored sentence in `overlayPlacement.ts` comes out | Task 7, Step 3 (the docstring replacement at 111-112, corrected from the spec's 74-75) |
| (f) task 1 red-first tests: migration + snapshot | Task 1, Steps 1-3 |
| (f) task 2 red-first tests, and the double learning `roundRect` | Task 2, Steps 1 and 3 — plus `arcTo`, which the spec's own risk (h) requires and its task list omits |
| (f) task 3's six named assertions, ceilings unchanged | Task 3, Step 1; ceilings unchanged because the scene is not edited (Global Constraint 7, verified in Task 4 Step 4) |
| (f) task 4: variant scene, new cases in both perf suites, plain ceilings fixed, measured deltas, `saves === restores`, `drawImagesPerFrame`/`animationLookupsPerFrame` unchanged | Task 4 entire |
| (f) task 5's five red-first assertions, including absent for audio and overlays | Task 5, Steps 1, 6 and 9 |
| (f) task 6 preview parity | Task 6 |
| (f) task 7's red-first mapping and placement tests | Task 7, Steps 1 and 5 |
| (g) decision 1 inscribed circle | Task 2's `maskPathFor` circle case; Task 3's per-function inscribed-circle cases; Task 7's circle mapping needing no radius |
| (g) decision 2 radius is a fraction, 0–0.5, `8/1280` reproduces craft | Task 2's clamp case; Task 7's three radius cases |
| (g) decision 3 media clips only | Global Constraint 2; Task 5's audio and overlay absence cases; Task 4's variant leaving the overlays alone |
| (g) decision 4 not keyframeable | Global Constraint 3; Task 4's exact lookup assertions |
| (g) decision 6 stroke as its own clip layer option, on the mask's outline or the rectangle | Task 2's no-mask `rect` case; Task 3's 'strokes the picture rectangle' cases, both functions |
| (h) `roundRect` support risk → `arcTo` fallback | Task 2's fallback implementation and its explicit five-call test |
| (h) name collision risk | Task 5, decision 1 |
| (h) two draw functions risk | Global Constraint 5; every Task 3 assertion written twice |
| (h) blur-shape scratch path risk | Task 6's second case |
| (h) perf-scene drift risk | Global Constraint 7; Task 4 Step 4's `git diff` grep |
| (h) fixture blast radius | Not reachable in slice 1 — `apps/e2e/fixtures/headless/project.json` is untouched, and nothing here runs e2e (Global Constraint 15) |

Out of scope, carried to slice 2 with corrected line numbers: the timeline thumbnail (spec task 8), headless/e2e parity (task 9), and the documentation sweep (task 10) — which must edit `apps/artist/CLAUDE.md` at **211-212** and **658**, not the spec's 205-206 and 587. Decision 5's "the mask shows in the thumbnail" and decision 5's statement that the preview's selection box and hit test stay rectangular both belong to those tasks; nothing in this slice contradicts either, and the artist changeset already tells users the selection box and the library thumbnail are unmasked so the shipped behaviour is not read as a bug.

**2. Placeholder scan.** No "TBD", no "add appropriate tests", no "similar to Task N", no "and so on". Every option label (`None`, `Circle`, `Rounded Rectangle`), every row label (`Corner Radius`, `Stroke Width`, `Stroke Color`), the section title (`Mask & Stroke`), every readout format (`20%`, `3px`, `4.5px`, `0px`), every constant (`DEFAULT_CLIP_MASK_RADIUS = 0.05`, `DEFAULT_CLIP_STROKE_COLOR = '#ffffff'`, `OVERLAY_CORNER_RADIUS_FRACTION = 8 / 1280`, `OVERLAY_STROKE_WIDTH_FRACTION = 3 / 1280`, `OVERLAY_STROKE_COLOR = 'rgba(255, 255, 255, 0.8)'`, `OVERLAY_BORDER_COLOR`, `OVERLAY_BORDER_WIDTH = 3`, `OVERLAY_CORNER_RADIUS = 8`), every slider bound (`0`–`0.5` step `0.01`; `0`–`0.02` step `0.0001`) and every asserted geometry number (`[960, 540, 180, 180, 0, 0, Math.PI * 2]`, `[640, 360, 640, 360, 90]`, `[560, 240, 800, 600, 150]`, `[70, 30]` and the four `arcTo` tuples, radius `8` at 1280 and `12` at 1920) is written out and asserted somewhere. Every step names its run command and its expected result.

The only values deliberately not fixed in advance are **Task 4's six measured figures**, and that is the task's whole subject: it names the command that produces them, the derivation they must match (+3 per masked clip, +5 per stroked clip, 2 live media clips, so +16 calls and +2 save/restore pairs per frame), the date to write beside them (2026-09-25), the 2×-rounded-up rule for the ceiling, and the three specific wrong answers (32, 22, 0) with what each would mean. It also records that **the spec's "+8 (1 save, 1 restore, 6 outline calls)" is wrong for this repo and why** — the recording double's `record()` helper wraps methods only, and `FrameMeasurement`'s own doc comment at `drawFrame.perf.test.ts:78-81` says property assignments are not counted; the spec's own list of the six is five items long. Task 3 pins the corrected arithmetic exactly at the unit level, so Task 4's measurement has something to be checked against rather than merely recorded.

Two other places where this plan corrects the spec rather than transcribing it, both flagged at the point of use: `maskForPlacement` takes three arguments, not the spec's two, because the radius is a fraction of the clip's shorter *drawn* side and ARTIST draws the camera un-stretched; and Task 2 adds `arcTo` to the canvas double as well as `roundRect`, because risk (h) requires a fallback the spec's task list forgot to equip the double for. Global Constraint 16 lists all fifteen line-number corrections.

**3. Type consistency.** `ClipMask { kind: ClipMaskKind; radius?: number }` and `ClipStroke { color: string; width: number }` are declared once, in Task 1 (`src/store/types.ts`), and every later reference uses those exact field names: `mask?.kind`, `mask?.radius`, `stroke.color`, `stroke.width`. `ClipMaskKind` is the union `'none' | 'circle' | 'rounded'` in Task 1, is the `value` type of `CLIP_MASK_KINDS` in Task 5, and is `maskPathFor`'s first parameter in Task 2 — the `e.target.value as ClipMaskKind` cast in `MaskSection` is the same cast `BlendModeSection` makes for `BlendMode`, and it is sound because the `<option>` values come from that table.

`maskPathFor(kind, radius, x, y, width, height)` has the same six-parameter order in its definition (Task 2), in both `applyClipMask` and `applyClipStroke` (Task 2), in `clipMask.test.ts` (Task 2) and in `overlayPlacement.test.ts`'s round-trip assertions (Task 7). `MaskPath`'s three variants are discriminated on `shape` and every reader switches on that one field; `'rect'` is produced by exactly one function and consumed by exactly two.

`applyClipMask(ctx, mask, x, y, width, height)` and `applyClipStroke(ctx, stroke, mask, x, y, width, height, frameWidth)` are called with those argument orders in both media draw functions (Task 3), which pass `x, y, scaledWidth, scaledHeight` — the same four locals `drawImage` receives on the next line, so the mask and the picture cannot describe different rectangles. `visibleClipStroke` is defined in Task 2, called by `applyClipStroke` and by both draw functions, and nowhere else.

`maskForPlacement(placement, frame, partSize)` and `overlayPlacementToTransform(placement, projectResolution, partSize, frame?)` both take `PixelSize`-shaped second and third arguments, and `TakeClipPart` structurally satisfies `PixelSize` (it has `width` and `height`), which is why `maskForPlacement(placement, overlayFrame ?? resolution, part)` compiles at the store's call site exactly as the existing `overlayPlacementToTransform(placement, resolution, part, overlayFrame)` does. `overlayBoxFor(placement, frameWidth, partSize)` takes a `number` for the width — not a `PixelSize` — because both callers already have `frame.width` in hand and passing the rectangle would invite one of them to read `frame.height`, which the box does not depend on. `strokeForPlacement()` returns `ClipStroke` and takes nothing, in its definition, its test and its call site.

`handleMaskChange: (mask: ClipMask) => void` and `handleStrokeChange: (stroke: ClipStroke) => void` have the same signature in `ClipEditorActions` (Task 5), in the hook's implementation, in the hook's test, and as `MaskSectionProps.onMaskChange`/`onStrokeChange` — so `ClipEditor` passing the handlers straight through to the section is a type-level identity and not a coincidence. `frameWidth: number` is one field on `ClipEditorActions` and one prop on `MaskSectionProps`, with the same name in both. `updateClip(clipId, updates: Partial<Clip>)` is unchanged, which is why `clipSlice.ts`'s `Pick` (line 16) and `EditorState` appear in no task's file list.

`MASKED_SCENE_MASK: ClipMask` and `MASKED_SCENE_STROKE: ClipStroke` in Task 4's fixture are typed against Task 1's declarations, so a fixture that drifted from the real shape would fail to compile rather than measure the wrong thing; `measureExport(clips: Clip[] = buildSceneClips())` keeps the three existing call sites' zero-argument form valid, which is why none of them is edited.