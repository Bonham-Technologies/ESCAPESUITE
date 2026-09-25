# ESCSUITE-65 design proposal — a mask (circle / rounded rectangle) on every media clip (2026-09-25)

> Status: PROPOSAL awaiting operator decisions (section g). No implementation has started. Follows ESCSUITE-14, whose slice 2 carries the webcam's position and size into ARTIST and left the shape to this ticket.

## (a) Recommendation (three sentences)

Add `clip.mask?: { kind: 'circle' | 'rounded'; radius?: number }` as a **static, non-keyframeable** clip field and apply it as one `beginPath → ellipse|roundRect → clip` inside the two existing `save`/`restore` blocks in `apps/artist/src/core/canvasRenderer.ts` — `drawClipToCanvas` (line 325) and `drawImageToCanvasWithModifiers` (line 452), immediately after the rotation block (lines 379-383 / 504-508) and before `drawImage` (lines 389 / 514) — because every pipeline funnels through those two functions and nothing else. Ship it for **media clips only** in v1 (text and shape overlays have no drawn box the mask could mean anything against — `drawTextOverlayToCanvasAnimated`'s geometry comes from `measureText`, canvasRenderer.ts:129), gating the new inspector row exactly as `BlendModeSection` is gated (`ClipEditor.tsx:105`). Then the handoff is genuinely one line in `placeTakeOnTimeline` beside the transform it already maps (`apps/artist/src/store/clipSlice.ts:137-139`), and the `shape`-is-ignored sentences in `apps/artist/src/utils/overlayPlacement.ts:74-75` and `apps/artist/CLAUDE.md:205-206` come out.

## (b) Data model

**Static property, not transform.** Exact field, on `Clip` (`apps/artist/src/store/types.ts:311-338`, after `effects` on line 326):

```ts
export type ClipMaskKind = 'none' | 'circle' | 'rounded';
export interface ClipMask { kind: ClipMaskKind; radius?: number }  // radius: rounded only
mask?: ClipMask;   // absent === { kind: 'none' }
```

Why not in `ClipTransform` (types.ts:39-47): every field there is a number fed through `getAnimatedValues` and every one of them is an `AnimatableProperty` (types.ts:95-103). Putting an enum in there would put a non-interpolable value inside the interpolator and force a `DEFAULT_TRANSFORM` change (types.ts:50-58) that every fixture and the migration at `projectMigration.ts:54` reads.

**Keyframing: no, and not "for free".** `radius` is a number, but keyframing it costs a new `AnimatableProperty` member (types.ts:95), a `ClipAnimation.keyframes` key (types.ts:135), a row and a curve in the keyframe panel, and a new field on `AnimatedOverlayValues`/the `animated` object the renderers read. `kind` cannot be interpolated at all, so a keyframed radius with a static kind is a half-feature. Static.

**Migration: none required.** Optional + `undefined === none` means `ensureTimelineHasTracks` (`projectMigration.ts:48-65`) needs no new line — it only defaults fields the renderer dereferences unconditionally. `DB_VERSION` stays 1 (`packages/shared/src/storage/index.ts:9`): the mask lives inside the project blob, not in a new object store. The session snapshot carries `state.project` whole (`apps/artist/src/app/sessionSnapshot.ts:13`), so autosave/restore gets it free. Add one regression test to `projectStore.migration.test.ts` proving a pre-mask project loads with `clip.mask === undefined` and renders unmasked.

## (c) The ONE draw call, and the per-frame cost

There is **one shared renderer and two media entry points into it**, and all three pipelines go through them:

- Preview: `drawFrame.ts:139` (`drawImageToCanvasWithModifiers`) and `drawFrame.ts:152` (`drawClipToCanvas`).
- WebM export: `exportWebM.ts:341` / `exportWebM.ts:347` — the same two functions.
- MP4 export: `exportMP4.ts:450` → `drawMediaWithFrame` (canvasRenderer.ts:428) → the same two.
- Transitions: `drawTransition` (canvasRenderer.ts:592) and `drawTransitionWithFrames` (canvasRenderer.ts:680) both reduce to `drawMediaWithModifiers`/`drawMediaWithFrame` → the same two.
- Headless: `apps/artist/src/headless/renderProject.ts:80-81` calls `exportToWebM`/`exportToMP4` — literally the editor's engine, as `apps/artist/CLAUDE.md:587` says.

So a mask written once in each of those two functions is drawn once in all five paths. Put it **after** the rotation translate/rotate/translate (canvasRenderer.ts:379-383 and 504-508) so it rotates with the clip, and after `x`/`y`/`scaledWidth`/`scaledHeight` are known (385-386 / 510-511), i.e. between line 386 and 389 (and 511 and 514). Both functions already `save()` (339 / 465) and `restore()` (392 / 516), so **no extra save/restore** is needed — and a wipe transition's existing `clip()` (355-360 / 481-486) intersects with the mask, which is the correct composition.

Per masked clip per frame: `beginPath()` + one of `ellipse()` / `roundRect()` + `clip()` = **3 recorded context calls**, no extra `drawImage`, no extra `getAnimatedValues`, no allocation (pass numbers, don't build a `Path2D`). Do not call `closePath()` — `clip()` closes implicitly and it would be a fourth call per clip per frame for nothing (CRAFT's own draw does call it, overlayGeometry.ts:145/170).

Factor the path into a pure `core/clipMask.ts` (`maskPathFor(kind, radius, x, y, w, h)` returning the numbers, plus an `applyClipMask(ctx, …)` that issues the three calls) so the maths is unit-testable and both call sites are one line.

## (d) Editor UI

`ClipEditor/` already has a `ShapeSection.tsx` for shape *overlays* (its `<select>` is at line 26). **Do not reuse that name** — name the new file `MaskSection.tsx` and label it "Mask" (or "Clip Shape"), or the panel will show two "Shape" sections. Copy `BlendModeSection.tsx:17-32` verbatim in shape: a `CollapsibleSection` with `defaultOpen={false}`, one `<select className={styles.select}>` over a new `CLIP_MASK_KINDS` table in `clipEditorOptions.ts` (beside `BLEND_MODES` at line 24 — that file's comment at lines 3-5 makes option order part of the contract), plus a radius `<input type="range">` row in `styles.transformRow` shown only when `kind === 'rounded'` (the same conditional shape as `ShapeSection.tsx:37-53`'s blur row).

Wiring: one handler in `useClipEditorActions.ts`, modelled on `handleBlendModeChange` (lines 205-211), calling the **existing** `updateClip(selectedClip.id, { mask })` (`clipSlice.ts:243`) — it pushes history already (line 265), so no new store action and no new slice member in `ClipSlice`'s `Pick` (clipSlice.ts:16). Render it in `ClipEditor.tsx` beside `BlendModeSection` under the same `{!isAudio && !isOverlay && …}` guard (line 105). The selector contract in `ClipEditor.rerender.test.tsx` (its header, lines 1-29) and `useClipEditorActions.ts:16-24` is the hard rule: **no new store subscription, and never `currentTime`** — read the mask off `selectedClip`, which the panel already has. The rerender test's mount/tick counts must come out unchanged; if the new section moves them, the section is subscribing to something it shouldn't.

## (e) The handoff mapping

`TakeClipPart.overlayPlacement` already arrives on the webcam part (`app/takeImport.ts:154-156`) and `placeTakeOnTimeline` already converts it to a transform (`clipSlice.ts:137-139`). The mapping is one property beside it:

```ts
mask: part.overlayPlacement ? maskForPlacement(part.overlayPlacement, overlayFrame ?? resolution) : undefined,
```

with a new `maskForPlacement` in `utils/overlayPlacement.ts` returning `{ kind: 'circle' }` for `'circle'` and `{ kind: 'rounded', radius: … }` for `'rectangle'`.

The CRAFT numbers, from `apps/craft/src/core/overlayGeometry.ts`: circle is an **inscribed circle**, `radius = Math.min(webcamWidth, webcamHeight) / 2` centred on the box (lines 139-142), *plus* a centre-crop of the source (155-181); rectangle is `ctx.roundRect(x, y, w, h, 8)` — a flat **8 px** (line 167) in pixels of a canvas capped at `COMPOSITOR_MAX_WIDTH = 1280` (line 27).

So express the radius as a **fraction of the clip's shorter side**, exactly as `OVERLAY_MARGIN_FRACTION = 20 / 1280` did for the inset (`overlayPlacement.ts:23`), because the pixel count is meaningless at another resolution (the same argument as that constant's doc, lines 17-22) and ARTIST has a resolution-change dialog that would otherwise silently change the corner rounding. Add `export const OVERLAY_CORNER_RADIUS_FRACTION = 8 / 1280;` and derive: radius-in-frame-px `= frame.width * 8/1280`, so the stored fraction `= (frame.width * 8/1280) / Math.min(overlayWidth, overlayHeight)` — both already computed at `overlayPlacement.ts:88` and `:97`.

Docs sentence to replace, `overlayPlacement.ts:74-75`: "`placement.shape` is read and **ignored** — a mask on every clip is ESCSUITE-65, and when it exists the circle maps onto it here." → it now maps, naming the two constants. Same for `apps/artist/CLAUDE.md:205-206`.

## (f) Task list

1. **`ClipMask` type, defaults, migration hygiene** — `store/types.ts:311-338`; red-first: `projectStore.migration.test.ts` (pre-mask project → `mask === undefined`, renders unmasked), `app/sessionSnapshot.test.ts` (mask survives a snapshot round trip). Ceilings: none. **0.5 PR-day.**
2. **`core/clipMask.ts` + the canvas double learns `roundRect`** — new `core/clipMask.test.ts` (circle = inscribed radius `min(w,h)/2` at the box centre; rounded radius clamped to `min(w,h)/2`; `radius <= 0` and `kind:'none'` issue nothing); `src/test/doubles/canvas.ts` has no `roundRect` (its method table is lines 150-162, its type at 59-64) so the rounded path cannot be recorded until it does. Ceilings: none. **0.5 PR-day.**
3. **Apply the mask in the two media draws** — `core/canvasRenderer.ts` at 386-389 and 511-514; red-first in `core/canvasRenderer.clips.test.ts`: `clip()` recorded *after* `rotate()` and *before* `drawImage()`; the ellipse args are the drawn box's centre and half-extents; an unmasked clip records no `clip()`; `save` count == `restore` count; a masked clip inside a wipe records two `clip()`s. Ceilings: unchanged (the perf scene has no masks — `test/fixtures/perfScene.ts:108` builds none). **1 PR-day.**
4. **Masked-clip per-frame ceilings** — a masked variant of the scene in `test/fixtures/perfScene.ts`, new cases in `components/Preview/drawFrame.perf.test.ts` (beside the ceilings at lines 160-174) and `core/exportMP4.perf.test.ts` (beside 184-201): the plain ceilings must not move; the masked ceiling is measured +3 calls per masked clip, `saves === restores` exact, `drawImagesPerFrame` and `animationLookupsPerFrame` unchanged. **0.5 PR-day.**
5. **`MaskSection` + `CLIP_MASK_KINDS` + the handler** — new `ClipEditor/MaskSection.tsx` and `MaskSection.test.tsx`, `clipEditorOptions.ts` (+`clipEditorOptions.test.ts`), `useClipEditorActions.ts` (+ its test), `ClipEditor.tsx:105`; red-first: choosing "Circle" calls `updateClip` with `{ mask: { kind: 'circle' } }` and pushes one history entry; the radius slider only exists for `rounded`; the section is absent for audio and for overlay clips. Ceilings: `ClipEditor.rerender.test.tsx` counts unchanged. **1 PR-day.**
6. **Preview parity test** — `components/Preview/PreviewPlayer.rendering.test.tsx`: a masked clip in the store makes the preview issue the same three calls in the same order as the export does for the same clip (the shared-renderer claim, `apps/artist/CLAUDE.md:587`, made a test). **0.5 PR-day.**
7. **The handoff mapping** — `utils/overlayPlacement.ts` (new `maskForPlacement` + `OVERLAY_CORNER_RADIUS_FRACTION`), `store/clipSlice.ts:137-139`; red-first in `utils/overlayPlacement.test.ts` (`'circle'` → `{kind:'circle'}`; `'rectangle'` → rounded whose radius reproduces CRAFT's 8 px at 1280 and scales with the frame) and the `placeTakeOnTimeline` take test (the webcam clip carries the mask, the primary carries none). **0.5 PR-day.**
8. **Headless + e2e parity** — `services/headless-artist/test/ffprobe.ts` gains a `frameCornerRGB` sibling (`crop=8:8:0:0,scale=1:1`; today's `frameMeanRGB` at line 71 averages the whole frame and would blur the signal); a masked case in `services/headless-artist/src/verify.chromium.test.ts` built by **patching the loaded fixture in-test**, the way the two-clip case is built at lines 97-112 and `apps/e2e/tests/headless/render-bundle.spec.ts:86` patches resolution — leave `apps/e2e/fixtures/headless/project.json` untouched so no existing golden moves. Assertion: corner ≈ black, centre ≈ red. **0.5 PR-day.**
9. **Docs + changeset** — `apps/artist/CLAUDE.md:205-206` (and the draw-path note near 587), `utils/overlayPlacement.ts:74-75`, `ESCAPE-SUITE-DOCUMENTATION.md`, a changeset. **0.25 PR-day.**

Total ≈ 5.25 PR-days.

**On "byte-identical":** no test proves byte equality between a browser export and a headless render, and none can — `verify.chromium.test.ts:180-186` compares the *manifest's* sha256 to the delivered file (self-consistency), and identity across pipelines is structural, guaranteed by `renderProject.ts:80-81` calling the same engine. The mask's parity evidence is therefore (i) task 6's call-for-call preview/export comparison and (ii) task 8's pixel probe. Don't promise byte-identity in the ticket.

## (g) Open questions only the operator can answer

1. **Circle = inscribed circle or ellipse fitted to the box?** The ask says "an ellipse fitted to the clip's drawn box", but CRAFT draws an inscribed *circle* (`overlayGeometry.ts:139-142`). On a 16:9 webcam clip a fitted ellipse is a 16:9 oval and will **not** look like the composited preview. I recommend inscribed circle (and a separate `'ellipse'` kind later if box-filling is wanted). Operator decides.
2. **Radius: fraction of the shorter side (recommended, 0-0.5) or pixels?** Fraction is resolution- and scale-independent; px matches how a designer thinks and how CRAFT wrote it.
3. **Do text/shape overlay clips take a mask, or media only?** I recommend media only in v1 (rounding a rectangle overlay is a no-op; masking text is niche).
4. **Keyframeable — never, or later?** Recommend never for `kind`; "later, if asked" for `radius`.
5. **Should the mask show in the timeline thumbnail** (and in the preview's selection box / hit test, which stay rectangular — `components/Preview/hitTest.ts`, `selectionOverlay.ts`)? Recommend no for v1, and say so in the ticket so it isn't read as a bug.
6. **Does a masked webcam clip keep CRAFT's white 3 px border** (`overlayGeometry.ts:174-178`)? It is part of "looks like the composited preview" but is a *stroke*, not a mask — a separate feature.

## (h) Risks

- **`ctx.roundRect` support.** Safari gained it in 16.4 and the e2e suite runs WebKit (`pnpm test:e2e:browsers`); CRAFT already calls it unconditionally (`overlayGeometry.ts:171`) but only in a Chromium-favoured recording path. Build the rounded path from `arcTo` in `core/clipMask.ts`, or feature-detect and fall back — a throw here kills the whole preview frame, not just the mask.
- **Name collision** with the existing `ShapeSection`/`ShapeOverlayData` vocabulary (`ClipEditor/ShapeSection.tsx`, `store/types.ts:200-226`). Choosing the word "shape" for the new field would make every future grep ambiguous; `mask` keeps them apart.
- **Two draw functions, not one.** `drawClipToCanvas` and `drawImageToCanvasWithModifiers` are near-duplicates (canvasRenderer.ts:325 vs 452); adding the mask to one and not the other gives videos a mask and images none. The shared helper plus a test per function is the guard.
- **The blur-shape scratch path** re-captures the canvas at the identity transform and hands it back (canvasRenderer.ts:244-247). A masked clip *under* a blur shape is fine, but a masked clip drawn *after* one is worth one explicit test.
- **Perf-scene drift.** Adding a mask to an existing perf-scene clip would move the plain ceilings and break the "same scene as the browser benchmark" contract (`perfScene.ts:1-16`, `apps/e2e/utils/perf.ts`). Add a *variant*, never edit the scene.
- **Fixture blast radius.** `apps/e2e/fixtures/headless/project.json` backs at least five specs plus the service's manifest tests; patch in-test rather than editing it.
