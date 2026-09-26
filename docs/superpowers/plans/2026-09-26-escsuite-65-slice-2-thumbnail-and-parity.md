# ESCSUITE-65 slice 2 — the mask shows in the thumbnail, and the parity that proves it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the mask a user puts on a media clip is visible **where the user looks for the clip** — on the timeline, as a per-clip thumbnail clipped to that same shape (decision 5) — and the claim that the one renderer draws the mask everywhere stops being prose: a masked and stroked clip is rendered through the real headless bundle in real Chromium and probed with ffmpeg, and a handed-over webcam clip is shown arriving in the inspector with its circle and its border at the pixel weight the recording had. Then the documentation says all of it, including the two things that deliberately stay rectangular.

**Architecture:** One new pure module, `apps/artist/src/utils/maskClipPath.ts`, turns a `ClipMask` into a CSS `clip-path` string by asking slice 1's `core/clipMask.ts` `maskPathFor` for the shape of a 16:9 box of the thumbnail's height and translating its answer — so the inscribed-circle rule, the 0.5 clamp and "a rounded rectangle with square corners is a rectangle" have exactly one implementation shared by the canvas and the DOM. `components/Timeline/TimelineTrack.tsx` renders one `<img>` of the clip's *source* thumbnail inside `.clipContent`, absolutely positioned and out of flow, sized from `track.height` and shaped by that string; the source lookup is the `sourceVideos.find(...)` the row already does for `AudioWaveform`, so the timeline gains no store subscription. On the verification side, `services/headless-artist/test/ffprobe.ts` gains a `frameRegionRGB` primitive and the two named samplers `frameCornerRGB` / `frameEdgeRGB` (today's `frameMeanRGB` averages the whole frame and would blur every signal this needs), and `src/verify.chromium.test.ts` gains a masked-and-stroked case built by **patching the loaded fixture in-test**. `apps/e2e/tests/escapeartist/take-import.spec.ts` gains two cases against the two takes it already seeds. No product code outside `TimelineTrack.tsx` and the one new util is touched.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (ten slices, `src/store/projectStore.ts` the only entry point), CSS Modules, Vitest + Testing Library (jsdom) with `src/test/doubles/*` and `src/test/fixtures/*`, Vitest + Playwright-launched headless Chromium + ffmpeg/ffprobe for `services/headless-artist`, Playwright for e2e, changesets for release notes.

**Spec:** `docs/superpowers/specs/2026-09-25-escsuite-65-clip-mask-design.md` — section (f) tasks **8, 9 and 10** are this slice, and all six operator decisions in section (g) are binding. **Decision 5 is what Task 8 delivers** ("The mask shows in the thumbnail… so the user sees what they expect to see"), and decision 5's second half — that the preview's selection box and hit test stay rectangular, and that the media-library card stays unmasked — is what Task 10 writes down so the shipped behaviour is not read as a bug. Read the spec before Task 8, and read slice 1's plan (`docs/superpowers/plans/2026-09-25-escsuite-65-slice-1-mask-and-stroke.md`) only for the modules it built: `ClipMask`/`ClipStroke` on `Clip`, `core/clipMask.ts`, `MaskSection`, `maskForPlacement`/`strokeForPlacement`.

**What slice 1 already shipped (do not rebuild any of it):** `mask?: ClipMask` / `stroke?: ClipStroke` on `Clip` (`src/store/types.ts`), `core/clipMask.ts` (`maskPathFor`, `visibleClipStroke`, `applyClipMask`, `applyClipStroke`, `drawWithMaskAndStroke`), both media draws in `core/canvasRenderer.ts` calling the shared helper, per-frame ceilings for a masked scene, the `MaskSection` inspector section, preview/export parity, and the ESCAPECRAFT handoff (`maskForPlacement`, `strokeForPlacement`, craft's three named border constants). Slice 1 is on `feat/escsuite-65-slice-1` at `a26f541`, PR #451, merging.

**Out of scope:** any change to what the canvas draws; keyframing either field; text and shape overlays; the preview's selection box or hit test; the media-library card; a stroke on the thumbnail (v1 — Task 8 says so and Task 10 documents it); the two follow-ups slice 1 parked, which are **not** this slice's to take — one history entry per slider input event (**ESCSUITE-75**, filed) and the `useId()`/`htmlFor` label-association pass across the whole `ClipEditor` directory (a follow-up ticket, because the gap is pre-existing house style: `src/test/domQueries.ts:3-8`, `ShapeSection.tsx:58-88`). Slice 1 also parked "the plain perf cases are upper bounds only — consider one exact count per plain case"; still not this slice.

---

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure text quoted in the step notes, before the implementation step. Task 8 is genuinely red-first (nothing draws a thumbnail today). Task 9 is **not**, and says so plainly: slice 1 already made its assertions true, so each of its two new cases is expected to pass on the first run and each has an explicit **mutation step** that makes the red real rather than assumed — with the mutation, the run, the recorded failure text and the revert as numbered steps. Task 10 is documentation, a changeset and a measurement; its steps are verification-driven, and the greps that prove each stale sentence is gone are named.
2. **Media clips only** (decision 3). The thumbnail is drawn when, and only when, the clip is not audio, not a text overlay, not a shape overlay, **and** its source carries a `thumbnailUrl` — which `processVideoFile` (`core/videoProcessor.ts:248-250`) and `processImageFile` (`:371`) write and `extractAudioMetadata` does not. Each of those four arms gets its own test.
3. **The thumbnail is DOM and CSS, never canvas.** One `<img>` plus an inline `clip-path`. No `<canvas>`, no `Path2D`, no rasteriser: the timeline draws no picture at all today and a canvas per clip would put a second rasteriser on the gesture path (`AudioWaveform` is the one canvas here and it is capped at 4000px of backing store for exactly that kind of reason).
4. **No new store subscription in the Timeline.** `sourceVideos` is already a `Timeline.tsx` selector (line 43) and already a `TimelineTrack` prop (line 278 → the `sourceVideos` prop), and the row already does `sourceVideos.find(s => s.id === clip.sourceVideoId)` at `TimelineTrack.tsx:94` for the waveform and the type styling. **That lookup is the thumbnail's source lookup** — the same `const`, not a second one. `clip.mask` comes off the clip the row is already rendering. Nothing new is read from the store anywhere.
5. **`timelineGestures.perf.test.ts` and `App.rerender.test.tsx` counts are unchanged, and both files are byte-unchanged.** Verified with `git diff --stat` in Task 8. An `<img>` is not a listener, not a rect read and not a render; and the benchmark scene's source (`src/test/fixtures/perfScene.ts:89-98`, `sceneSource`) carries **no** `thumbnailUrl`, so the gesture suite renders no thumbnail at all and the counts cannot move for a second reason. The shared `video` fixture (`src/test/fixtures/projectStore.ts:12-21`) has no `thumbnailUrl` either, so **no existing artist test starts rendering an `<img>`** — the blast radius of Task 8 is the tests Task 8 writes.
6. **The `<img>`'s five load-bearing properties.** `aria-hidden="true"`, `alt=""` (the clip's name is already its label; `alt=""` is also what keeps `apps/e2e/utils/accessibility.ts`'s `checkImageAltText` counting it as *decorative* rather than `withoutAlt`), `draggable={false}` (no native drag racing the clip drag), `pointer-events: none`, and a **fixed height taken from the clip row** with a 16:9 width derived from it. It lives **inside `.clipContent`** and is `position: absolute` there, so it is out of flow: the name/duration flex layout is byte-identical, the trim handles keep their `z-index: 5` above it, and the hit geometry is untouched — `timelineGeometry.ts` reads no DOM at all, `useTrackAreaCache.ts:73` measures only `[data-track-id]` rows and the container, and `useTimelineSeek.ts:108` / `useTimelineMarquee.ts:190` find the clip with `target.closest('[data-clip-id]')`, which an element inside the clip cannot change (and which nothing can reach anyway, at `pointer-events: none`).
7. **The stroke is NOT drawn on the thumbnail.** v1 shows the *shape*, not the border. `maskClipPathFor` takes no stroke and the `<img>` gets no `border`, `outline` or `box-shadow`. This is pinned by asserting the img's **entire** inline `style` attribute, and stated in the changeset and in `apps/artist/CLAUDE.md`.
8. **The geometry is not written twice.** `maskClipPathFor` calls slice 1's `maskPathFor` and translates its `MaskPath`; it re-derives no radius, re-clamps nothing and re-implements no "is there a mask" rule. One test asserts the thumbnail's circle radius **is** `maskPathFor`'s, so the shared-implementation claim is a test and not a comment.
9. **No fixture on disk is edited.** `apps/e2e/fixtures/headless/project.json` backs at least five consumers (`apps/e2e/tests/headless/render-bundle.spec.ts`, `apps/e2e/tests/integration/host-embedding.spec.ts`, `apps/e2e/utils/perf.ts`, `services/headless-artist/src/perf.bench.test.ts`, `apps/e2e/README.md` / `fixtures/headless/make-fixture.md`), and its twin `services/headless-artist/test/fixtures/manifest/project.json` backs the two golden single-clip verify cases plus the service's manifest tests. Every variant is built by patching the **loaded** copy in-test, the way the two-clip case is built at `verify.chromium.test.ts:97-112` and the way `render-bundle.spec.ts:86` patches the resolution. Task 9 proves it with `git diff --name-only`.
10. **Coverage floors only go up.** Artist's floors are **99 / 98 / 93 / 98** (lines/statements/branches/functions — `apps/artist/vite.config.ts:224-229`, `scripts/coverage-report.mjs:29-33`, root `CLAUDE.md:536`); `services/headless-artist`'s are **99 / 99 / 98 / 98** (`services/headless-artist/vitest.config.ts:40-45`, root `CLAUDE.md:538`, achieved 99.45 / 99.36 / 98.16 / 98.51). Every new line, every new branch and every new function must execute in a test: `maskClipPathFor`'s three shape arms and its degenerate-box arm, `px`'s float rounding, and each of `TimelineTrack`'s four thumbnail guards. Two facts make this smaller than it looks — `services/headless-artist`'s coverage config **excludes `test/**`** and its `test:coverage` script **excludes `*.chromium.test.ts`**, so nothing Task 9 writes is measured by anything; and `src/store/types.ts` is excluded from artist's coverage `include`. Finish with `pnpm --filter @escapesuite/artist test:coverage` and `pnpm --filter @escapesuite/craft test:coverage`. Never lower a floor.
11. **No existing test may be deleted or weakened.** These files gain cases or inputs only: `apps/artist/src/components/Timeline/TimelineTrack.test.tsx`, `services/headless-artist/src/verify.chromium.test.ts`, `apps/e2e/tests/escapeartist/take-import.spec.ts`. The one **refactor** of existing test code this slice makes is named and bounded: Task 9 extracts `verify.chromium.test.ts`'s manifest-writing boilerplate into one `writeManifestDir` helper and routes the existing two-clip case through it, because the alternative is thirty lines of copy-paste in the same `beforeAll`. The two-clip test's own assertions are **byte-unchanged**, and the step verifies that with `git diff`.
12. **Typecheck and lint every task.** `pnpm --filter @escapesuite/artist typecheck` and `... lint` (vitest does not type-check) for Tasks 8 and 10; `pnpm --filter @escapesuite/headless-artist typecheck` / `lint` and `pnpm --filter @escapesuite/e2e typecheck` / `lint` for Task 9.
13. **Playwright: Task 9's implementer only, one spec at a time.** The implementers of Tasks 8 and 10 run **no** Playwright and no browser suite — nothing in either needs one. Task 9's implementer **may and should** run, locally: the headless Chromium verification suite (`pnpm --filter @escapesuite/headless-artist exec cross-env HEADLESS_BUILD=1 vitest run src/verify.chromium.test.ts`, which needs `ffmpeg` and `ffprobe` on PATH or the whole file skips) and the **two** named Playwright specs — `apps/e2e/tests/escapeartist/take-import.spec.ts` and `apps/e2e/tests/headless/render-bundle.spec.ts`. **One at a time, `--project=chromium`**, never the whole suite and never in parallel: Task 9's implementer is the only local Playwright user in this slice, the Playwright config auto-starts three dev servers (`apps/e2e/playwright.config.ts:94-116`, `reuseExistingServer: true`), and two browser suites sharing a CPU are two suites measuring each other. Do not run the perf project — that is the controller's (see Controller Steps).
14. **The `timeline-interaction` benchmark is the CONTROLLER's, before and after Task 8.** Not an implementer step. See Controller Steps below.
15. **Line numbers in this plan were verified against the worktree `/Users/littlemac/Projects/ESCAPESUITE-e65` at `a26f541`.** Corrections to the spec and to slice 1's notes, for the record: **there is no `TimelineTrack.module.css`** — `TimelineTrack.tsx` imports `./Timeline.module.css` (line 7), and that is the only stylesheet this slice touches. The clip row renders at `TimelineTrack.tsx:103-177` (the spec said 103-140); the source lookup is line 94, `hasWaveform` line 101, `AudioWaveform` 116-125, the `.clipContent` div 139, the type icons 140-171, the name and duration 172-173. In `Timeline.module.css`: `.clip` is 379-390 (`top: 4px; height: calc(100% - 8px); min-height: 40px; overflow: hidden`), `.clipContent` 449-459, `.clipIcon` 529-533, `.trimHandle` 582-591 (`z-index: 5`). `ffprobe.ts`'s `frameMeanRGB` is at 71-92 ✓. `verify.chromium.test.ts`'s two-clip patch is 97-112 ✓, its constants 35-50, its `beforeAll` 85-148. `render-bundle.spec.ts:86` ✓. `take-import.spec.ts`: `TAKE_PARTS` 26-64, `SMALL_TAKE_PARTS` 78-97, `transformValue` 256-263, the describe 265-398. `apps/artist/CLAUDE.md`: the ESCSUITE-65 take-import sentences are **211-217** (already written by slice 1 — do not rewrite them, append one sentence), the `TimelineTrack.tsx` table row **747**, the ClipEditor module table **802-820** with the `clipEditorOptions.ts` row at **808**, the preview's shared-renderer claim **663-668**, and the headless one **1265-1268**. Root `CLAUDE.md`: the `?loadVideo=` handoff bullet **201-212**, "Where it stands" **457-528**, the coverage table **532-538**. `apps/craft/CLAUDE.md`'s `overlayGeometry.ts` bullet is **331-340**, its constants sentence **333-334**. `ESCAPE-SUITE-DOCUMENTATION.md`'s ESCAPEARTIST features are **64-72**.
16. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

17. Branch **`feat/escsuite-65-slice-2` off `main`, created once PR #451 has merged** — not off `feat/escsuite-65-slice-1`. Every file this slice reads from slice 1 is on main by then. No push and no PR unless asked.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/utils/maskClipPath.ts` | A `ClipMask` as a CSS `clip-path` string for a 16:9 thumbnail of a given height, and the thumbnail's aspect. Pure: it asks `core/clipMask.ts` for the shape and translates the answer. No React, no store, no DOM |
| `apps/artist/src/utils/maskClipPath.test.ts` | The three strings, the three ways of saying "no mask", the 0.5 clamp, the float rounding, and the parity assertion against `maskPathFor` |
| `.changeset/artist-timeline-mask-thumbnail.md` | `@escapesuite/artist: patch` |

**Modified**

| File | Change |
|---|---|
| `apps/artist/src/components/Timeline/TimelineTrack.tsx` | Two module constants, one derived `thumbnailUrl`/`thumbHeight` per clip, one `<img>` as `.clipContent`'s first child |
| `apps/artist/src/components/Timeline/Timeline.module.css` | `.clipContent` gains `position: relative`; a new `.clipThumb` block after it |
| `apps/artist/src/components/Timeline/TimelineTrack.test.tsx` | One describe block, eleven cases |
| `services/headless-artist/test/ffprobe.ts` | `frameRegionRGB`, `frameCornerRGB`, `frameEdgeRGB` |
| `services/headless-artist/src/verify.chromium.test.ts` | Five constants, a `writeManifestDir` helper (the two-clip case routed through it), one masked-and-stroked case |
| `apps/e2e/tests/escapeartist/take-import.spec.ts` | An `openSection` and a `maskKindSelect` helper, two cases |
| `apps/artist/CLAUDE.md` | The Timeline table row, a new two-paragraph thumbnail note, one sentence on the take-import paragraph, one on the headless shared-renderer claim, a `MaskSection.tsx` table row, and "four"→"five" option lists |
| `CLAUDE.md` (root) | The take-handoff bullet; the artist and craft coverage rows re-measured, with a dated "Where it stands" sentence |
| `apps/craft/CLAUDE.md` | The `overlayGeometry.ts` bullet names five constants, not two |
| `ESCAPE-SUITE-DOCUMENTATION.md` | Two ESCAPEARTIST feature bullets |
| `apps/artist/vite.config.ts`, `scripts/coverage-report.mjs` | Only if a whole-percent floor rises |

---

## Controller Steps (NOT the implementers')

- [ ] **C1: Create the branch.** Once PR #451 has merged: `git fetch origin && git switch main && git pull && git switch -c feat/escsuite-65-slice-2`. Confirm `git log --oneline -1` shows slice 1's merge and that `apps/artist/src/core/clipMask.ts` and `apps/artist/src/components/ClipEditor/MaskSection.tsx` both exist on the branch.

- [ ] **C2: Baseline the `timeline-interaction` benchmark, before Task 8 is dispatched.** The timeline's per-pointer-move layout count is a published number and this slice puts an element inside every media clip; risk (h) asks for it to be *seen* rather than guessed. Run once, alone, with nothing else on the machine:

```bash
pnpm --filter @escapesuite/e2e exec playwright test --config=playwright.perf.config.ts tests/perf/timeline-interaction.spec.ts
cp apps/e2e/perf-results/timeline-interaction.json /tmp/timeline-interaction-before.json
```

Record `clipDragLayoutsPerFrame`, `marqueeLayoutsPerFrame` and `playheadScrubLayoutsPerFrame` (plus each gesture's `JsMsPerFrame`) in the ledger. The published figures to compare against are the 2026-09-13 round: **0.82 and 0.98 forced layouts per frame** for clipDrag and marquee (`apps/artist/CLAUDE.md:780`). The benchmark imports a real MP4 through the file input (`apps/e2e/utils/perf.ts:700-705`), so `processVideoFile` gives its source a `thumbnailUrl` and the browser scene **does** draw twelve thumbnails after Task 8 — which is exactly why this baseline is worth taking, and why the jsdom gesture suite (whose `sceneSource` has no thumbnail) cannot answer the question.

- [ ] **C3: Re-run it after Task 8 is complete and reviewed, and compare.** Same command, alone. Copy to `/tmp/timeline-interaction-after.json` and diff the three `LayoutsPerFrame` figures. **Expected: unchanged**, because the `<img>` is out of flow, fixed-size and `pointer-events: none`, so no pointer frame reads or invalidates its box. If any of the three has risen, stop: that is a real regression and the fix belongs in Task 8 before Task 9 starts (first thing to check is that `.clipThumb` is still `position: absolute` and that nothing sized it in a percentage). Record both runs' numbers and the verdict in the ledger either way — a benchmark whose result is not written down was not run.

- [ ] **C4: Dispatch Tasks 8 → 9 → 10 in order.** They are sequenced, not parallel: Task 10 re-measures coverage *at the end of the slice* and documents what 8 and 9 built. Task 9's brief must carry Global Constraint 13 verbatim (it is the only task allowed a browser), and Task 8's and Task 10's briefs must carry the prohibition.

---

### Task 8: the timeline clip thumbnail, masked

**Files:**
- Create: `apps/artist/src/utils/maskClipPath.ts`
- Create: `apps/artist/src/utils/maskClipPath.test.ts`
- Modify: `apps/artist/src/components/Timeline/TimelineTrack.tsx` (imports at 1-7; two module constants above `TimelineTrackProps` at line 9; two derived values after `hasWaveform` at line 101; one `<img>` as the first child of the `.clipContent` div at line 139)
- Modify: `apps/artist/src/components/Timeline/Timeline.module.css` (`.clipContent` at 449-459 gains one declaration; a new `.clipThumb` block after line 459)
- Modify: `apps/artist/src/components/Timeline/TimelineTrack.test.tsx` (one describe block appended after `describe('TimelineTrack keyframes')`, which closes at line 366)

**Interfaces:**

- Consumes: `maskPathFor` from `../core/clipMask` (slice 1) and `ClipMask` from `../store/types`; in the component, the `track`, `clips` and `sourceVideos` props it already takes and the `sourceMedia` lookup it already makes at line 94.
- Produces, both in `apps/artist/src/utils/maskClipPath.ts`:

```ts
/** The thumbnail's aspect ratio: the box its `clip-path` is resolved against. */
export const CLIP_THUMB_ASPECT = 16 / 9;

/**
 * `circle(<h/2>px at 50% 50%)` for a circle mask,
 * `inset(0 round <fraction x h>px)` for a rounded one,
 * `undefined` for no mask at all.
 */
export function maskClipPathFor(
  mask: ClipMask | undefined,
  thumbHeightPx: number
): string | undefined;
```

- Produces in `TimelineTrack.tsx`: **no prop change and no export change.** `TimelineTrackProps` is untouched, `React.memo` is untouched, and the row gains two module-level constants (`CLIP_BOX_VERTICAL_INSET = 8`, `MIN_CLIP_BOX_HEIGHT = 40`), two per-clip locals (`thumbnailUrl`, `thumbHeight`) and one `<img className={styles.clipThumb}>`.
- Produces in `Timeline.module.css`: one new class, `.clipThumb`.

**Six decisions this task pins, all argued in the commit message:**

- **The string is translated, never re-derived.** `maskClipPathFor` asks `maskPathFor` for the shape of a `(thumbHeightPx x CLIP_THUMB_ASPECT) x thumbHeightPx` box and switches on the `MaskPath` it gets back. The thumbnail's shorter side **is** its height, so `min(w, h)` is `h` and the fraction resolves against exactly what the canvas resolves it against. That is what makes the inscribed circle, the clamp to half the shorter side and "a rounded rectangle with square corners is a rectangle" one implementation rather than two that agree today.
- **`'rect'` becomes `undefined`, and that is the whole "no mask" rule.** `maskPathFor` answers `'rect'` for `kind: 'none'`, for a rounded mask with a zero or absent radius, and for a degenerate box — three ways of saying "nothing to clip". One `if` covers all three, and React drops an `undefined` style property, so an unmasked clip's `<img>` carries no `clip-path` at all rather than `clip-path: none`.
- **Pixels, rounded to a hundredth.** CSS percentages in `circle()` resolve against a formula involving the box's diagonal, which on a 16:9 box is not the inscribed circle; the radius has to be a pixel length, which is why the height is computed in JS. `0.35 x 44` is `15.399999999999999` in IEEE 754 and an inline style is a string, so the value is rounded to two decimals — otherwise the DOM, and every test reading it, would carry that.
- **The thumbnail is out of flow.** `position: absolute` inside `.clipContent` (which gains `position: relative`), so the name/duration flex layout is byte-identical to what it was. In flow it would not be: `.clipContent` is `flex-wrap: wrap` with a `width: 100%` duration forcing a second row, so a 52px-tall item in a 52px-tall box would have pushed the duration out of the clip and `overflow: hidden` would have eaten it. Out of flow there is no reflow to reason about, which is also why the `timeline-interaction` layout count cannot move.
- **The box is one number, written once.** `thumbHeight = max(track.height - 8, 40)` mirrors `.clip`'s own `top: 4px; height: calc(100% - 8px); min-height: 40px` exactly, and the width is `round(height x 16/9)`. They go on the `<img>` as the `width`/`height` **attributes** — which are presentational hints mapped to the CSS properties, so they size the element *and* give it an intrinsic ratio before the blob URL decodes — leaving the inline `style` to carry the `clip-path` alone. That is what lets one assertion on the whole `style` attribute prove the thumbnail is masked *and* not stroked.
- **No stroke on the thumbnail, and the name is drawn over the picture.** v1 shows the shape (decision 5's "so the user sees what they expect to see"); the border stays in the frame. The `<img>` is held at 45% opacity because the clip's white 11px name sits over its right-hand side — the arrangement every NLE uses — and at that opacity the masked silhouette still reads clearly against the flat clip background while the label stays legible. Where a clip also has a waveform, the thumb covers its first ~92px semi-transparently; the waveform is a sibling earlier in the DOM, so the paint order is deliberate and not an accident.

- [ ] **Step 1: Write the failing unit test for the string** — create `apps/artist/src/utils/maskClipPath.test.ts`

```ts
// A clip mask as a CSS `clip-path` for the timeline's thumbnail (ESCSUITE-65).
//
// Every number here is checked twice over: once against the string the DOM will
// carry, and once — for the circle — against `core/clipMask.ts`'s own answer for
// the same box, because "the thumbnail shows the same shape the frame draws" is
// this module's entire reason to exist and a second copy of the geometry is the
// way it would stop being true.
import { describe, it, expect } from 'vitest'
import { CLIP_THUMB_ASPECT, maskClipPathFor } from './maskClipPath'
import { maskPathFor } from '../core/clipMask'
import type { ClipMask } from '../store/types'

/** The thumbnail on a default 60px track: `.clip` is that height less 8. */
const H = 52

describe('maskClipPathFor', () => {
  it('inscribes a circle of half the thumb’s height, centred', () => {
    // The thumb is 16:9, so its shorter side is its height and the inscribed
    // circle is h/2 — the same rule `core/clipMask.ts` applies to a drawn box.
    expect(maskClipPathFor({ kind: 'circle' }, H)).toBe('circle(26px at 50% 50%)')
  })

  it('is the same circle core/clipMask.ts draws for the same box', () => {
    const path = maskPathFor('circle', undefined, 0, 0, H * CLIP_THUMB_ASPECT, H)
    // Not a restatement of the assertion above: this one fails if the two ever
    // stop sharing an implementation, which is the only way they can drift.
    expect(path.shape).toBe('circle')
    expect(maskClipPathFor({ kind: 'circle' }, H)).toBe(
      `circle(${path.shape === 'circle' ? path.radius : NaN}px at 50% 50%)`
    )
  })

  it('carries a half-pixel radius rather than rounding a shape away', () => {
    // An odd row height is reachable: track heights are stored numbers.
    expect(maskClipPathFor({ kind: 'circle' }, 45)).toBe('circle(22.5px at 50% 50%)')
  })

  it.each([
    // radius (fraction of the shorter side) → the string, at h = 52
    [0.05, 'inset(0 round 2.6px)'],
    [0.25, 'inset(0 round 13px)'],
    // 0.35 x 52 is 18.200000000000003 in IEEE 754. The DOM must not carry that.
    [0.35, 'inset(0 round 18.2px)'],
    // Clamped to half the shorter side: past that a real roundRect throws.
    [0.5, 'inset(0 round 26px)'],
    [0.9, 'inset(0 round 26px)'],
  ])('rounds the corners by %s of the thumb’s height', (radius, expected) => {
    expect(maskClipPathFor({ kind: 'rounded', radius }, H)).toBe(expected)
  })

  it.each<[string, ClipMask | undefined]>([
    ['no mask at all', undefined],
    ['an explicit none', { kind: 'none' }],
    ['a rounded mask with square corners', { kind: 'rounded', radius: 0 }],
    ['a rounded mask with no radius', { kind: 'rounded' }],
    ['a negative radius', { kind: 'rounded', radius: -1 }],
  ])('clips nothing for %s', (_label, mask) => {
    // `undefined`, not `'none'`: React drops an undefined style property, so the
    // element carries no clip-path at all — which is what an unmasked clip's
    // thumbnail has to look like in the DOM.
    expect(maskClipPathFor(mask, H)).toBeUndefined()
  })

  it.each([0, -4])('clips nothing for a thumb of %s pixels', (height) => {
    // A row collapsed to nothing has no shape. `maskPathFor` answers its
    // degenerate-box arm here and this is the reader that makes it reachable
    // from the timeline.
    expect(maskClipPathFor({ kind: 'circle' }, height)).toBeUndefined()
  })
})

describe('CLIP_THUMB_ASPECT', () => {
  it('is 16:9, the aspect the thumbnail box is laid out at', () => {
    // Exported rather than repeated in the component: the width the <img> is
    // given and the box this module resolves the clip-path against have to be
    // the same box.
    expect(CLIP_THUMB_ASPECT).toBeCloseTo(16 / 9, 10)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/maskClipPath.test.ts`
Expected: FAIL — `Failed to resolve import "./maskClipPath" from "src/utils/maskClipPath.test.ts"`. Quote it in the step notes.

- [ ] **Step 3: Implement the module** — create `apps/artist/src/utils/maskClipPath.ts`

```ts
// A media clip's mask as a CSS `clip-path`, for the thumbnail the timeline draws
// on the clip (ESCSUITE-65, decision 5).
//
// It exists so the shape the user sees on the timeline is the shape the renderer
// draws in the frame, and so that is true by construction rather than by two
// pieces of arithmetic agreeing: `core/clipMask.ts`'s `maskPathFor` answers what
// shape a mask describes inside a box, and this module only says that answer in
// CSS. The inscribed-circle rule (decision 1), the clamp to half the shorter
// side (decision 2) and "a rounded rectangle with square corners is a
// rectangle" therefore have exactly one implementation each.
//
// DOM and CSS, never canvas. The timeline drew no picture at all before this,
// and a canvas per clip would put a second rasteriser on the gesture path that
// `timelineGestures.perf.test.ts` and the `timeline-interaction` benchmark exist
// to protect.
import { maskPathFor } from '../core/clipMask';
import type { ClipMask } from '../store/types';

/**
 * The thumbnail's aspect ratio — the box a `clip-path` percentage or centre is
 * resolved against, and the width the `<img>` is given for a height.
 *
 * Exported so `TimelineTrack` sizes the element with the same number this module
 * measures against; a second `16 / 9` in the component would be a second box.
 * 16:9 is the thumbnail's own frame, not the clip's drawn box — a masked clip
 * whose media is 4:3 is still *drawn* masked to its own box by
 * `core/canvasRenderer.ts`, and the thumbnail is an indication of shape rather
 * than a preview of composition. The source thumbnail itself is cropped into
 * this box by `object-fit: cover`.
 */
export const CLIP_THUMB_ASPECT = 16 / 9;

/**
 * A pixel length as CSS, rounded to a hundredth of a pixel.
 *
 * `0.35 * 52` is `18.200000000000003` in IEEE 754 and an inline style is a
 * string: without this the DOM would carry that, and so would every test that
 * reads it. A hundredth of a pixel is below anything a screen or a user can
 * tell apart.
 */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/**
 * The `clip-path` for a mask on a thumbnail `thumbHeightPx` tall, or
 * `undefined` when there is nothing to clip.
 *
 * The thumb is 16:9, so its **shorter side is its height** — which is why one
 * number is enough, and why the stored radius (a fraction of the clip's shorter
 * side, decision 2) resolves here against exactly what it resolves against in
 * the frame.
 *
 * `undefined` rather than `'none'` for the no-mask case: React omits an
 * undefined style property, so an unmasked clip's thumbnail carries no
 * `clip-path` at all and is byte-identical in the DOM to one from before this
 * feature existed.
 *
 * The **stroke is deliberately not drawn here** (v1): the thumbnail shows the
 * shape, and the border stays in the frame. This function takes no stroke, and
 * nothing else writes to the element's style.
 */
export function maskClipPathFor(
  mask: ClipMask | undefined,
  thumbHeightPx: number
): string | undefined {
  const path = maskPathFor(
    mask?.kind ?? 'none',
    mask?.radius,
    0,
    0,
    thumbHeightPx * CLIP_THUMB_ASPECT,
    thumbHeightPx
  );

  if (path.shape === 'circle') return `circle(${px(path.radius)} at 50% 50%)`;
  if (path.shape === 'rounded') return `inset(0 round ${px(path.radius)})`;
  // `'rect'` is `maskPathFor`'s way of saying there is nothing to mask — a
  // rectangle the size of the box is the box. It covers `kind: 'none'`, a
  // rounded mask with a zero or absent radius, and a box with no area, so this
  // one line is the whole "no mask" rule and there is no second copy of it.
  return undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/maskClipPath.test.ts`
Expected: PASS — 15 tests (3 + 5 from the radius table + 5 from the no-mask table + 2 from the degenerate table + 1 for the aspect; report the real count).

Run: `pnpm --filter @escapesuite/artist typecheck`
Expected: exit 0, no output.

- [ ] **Step 5: Write the failing component tests** — append to `apps/artist/src/components/Timeline/TimelineTrack.test.tsx`, after the closing `})` of `describe('TimelineTrack keyframes')` (line 366)

```tsx
describe('TimelineTrack clip thumbnails', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  /** A source with a thumbnail, which is what `processVideoFile` writes. */
  const withThumb: SourceVideo = { ...video, thumbnailUrl: 'blob:thumb-video' }
  /**
   * An audio source that somehow has one. `extractAudioMetadata` writes no
   * thumbnail, so the gate below is asserted against data that *would* draw if
   * the gate were only "has a thumbnail" — the absence of the field is not what
   * is under test.
   */
  const audioWithThumb: SourceVideo = {
    ...withThumb,
    id: 'audio1',
    mediaType: 'audio',
    thumbnailUrl: 'blob:thumb-audio',
  }

  function thumbOf(root: HTMLElement): HTMLImageElement | null {
    return root.querySelector<HTMLImageElement>(`img.${styles.clipThumb}`)
  }

  it('draws the source thumbnail at the head of a video clip', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)
    expect(thumb).not.toBeNull()
    expect(thumb).toHaveAttribute('src', 'blob:thumb-video')
    // 60px track → a 52px clip box (`.clip` is `top: 4px; height: calc(100% -
    // 8px)`), and 16:9 of 52 is 92. On the attributes rather than in the style,
    // so the element has its box and its ratio before the blob URL decodes.
    expect(thumb).toHaveAttribute('height', '52')
    expect(thumb).toHaveAttribute('width', '92')
  })

  it('draws it for an image clip too', () => {
    const image: SourceVideo = { ...withThumb, id: 'image1', mediaType: 'image' }
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: image.id })],
      sourceVideos: [video, image],
    })

    expect(thumbOf(root)).toHaveAttribute('src', 'blob:thumb-video')
  })

  it('is decoration, not content, and cannot be dragged', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)!
    // The clip's name is already its label; announcing the picture too would say
    // the same thing twice. `alt=""` is also what keeps the e2e suite's
    // `checkImageAltText` counting this as decorative rather than as an image
    // missing alt text (apps/e2e/utils/accessibility.ts).
    expect(thumb).toHaveAttribute('alt', '')
    expect(thumb).toHaveAttribute('aria-hidden', 'true')
    // A native image drag would race the timeline's own clip drag.
    expect(thumb).toHaveAttribute('draggable', 'false')
  })

  it('sits inside .clipContent, where the hit geometry cannot see it', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    const thumb = thumbOf(root)!
    expect(thumb.parentElement).toHaveClass(styles.clipContent)
    // The timeline finds the clip under the pointer with
    // `target.closest('[data-clip-id]')` (useTimelineSeek.ts:108,
    // useTimelineMarquee.ts:190) and measures only `[data-track-id]` rows and
    // the container (useTrackAreaCache.ts:73), so an element *inside* a clip
    // changes neither. This is that claim, asserted.
    expect(thumb.closest('[data-clip-id]')).toBe(clipEls(root)[0])
    // And the trim handles are still the row's outermost interactive children.
    expect(clipEls(root)[0].querySelectorAll(`.${styles.trimHandle}`)).toHaveLength(2)
  })

  it('clips the thumbnail to the clip’s own circle, and writes nothing else', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { mask: { kind: 'circle' } })],
      sourceVideos: [withThumb],
    })

    // The whole inline style, not just the clip-path: this is also the pin that
    // the *stroke* is not drawn on the thumbnail in v1 (no border, no outline,
    // no box-shadow). A stroked clip is the next case.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: circle(26px at 50% 50%);')
  })

  it('leaves a stroked clip’s thumbnail unstroked (v1)', () => {
    const { root } = renderTrack({
      clips: [
        makeClip('clip1', 0, 2, {
          mask: { kind: 'circle' },
          stroke: { color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 },
        }),
      ],
      sourceVideos: [withThumb],
    })

    // The border stays in the frame. The thumbnail shows the shape.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: circle(26px at 50% 50%);')
  })

  it('rounds the corners by the same fraction the frame uses', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { mask: { kind: 'rounded', radius: 0.25 } })],
      sourceVideos: [withThumb],
    })

    // 0.25 of the thumb's 52px shorter side is 13px — the same fraction, of the
    // same shorter side, that `core/clipMask.ts` resolves against the drawn box.
    expect(thumbOf(root)).toHaveAttribute('style', 'clip-path: inset(0 round 13px);')
  })

  it('leaves an unmasked clip’s thumbnail unclipped', () => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos: [withThumb] })

    // No `clip-path: none` — no style at all, so the element is what it would
    // have been if this feature had never been written.
    expect(thumbOf(root)!.getAttribute('style')).toBe('')
  })

  it('never shrinks below the clip box’s own minimum height', () => {
    const { root } = renderTrack({
      track: makeTrack({ height: 30 }),
      clips: [makeClip('clip1', 0)],
      sourceVideos: [withThumb],
    })

    // `.clip` has `min-height: 40px`, so a shorter track stops shrinking the
    // box and the thumb has to stop shrinking with it — otherwise the picture
    // would float in a box taller than itself.
    expect(thumbOf(root)).toHaveAttribute('height', '40')
    expect(thumbOf(root)).toHaveAttribute('width', '71')
  })

  it('draws no thumbnail for an audio clip, even one whose source has one', () => {
    const { root } = renderTrack({
      clips: [makeClip('clip1', 0, 2, { sourceVideoId: audioWithThumb.id })],
      sourceVideos: [video, audioWithThumb],
    })

    // Media clips only (decision 3). An audio part carries no picture.
    expect(thumbOf(root)).toBeNull()
  })

  it.each<['text' | 'shape']>([['text'], ['shape']])(
    'draws no thumbnail for a %s overlay',
    (overlayType) => {
      const { root } = renderTrack({
        clips: [makeClip('clip1', 0, 2, { overlayType })],
        sourceVideos: [withThumb],
      })

      // An overlay has no drawn box a mask could mean anything against, which is
      // the same reason `ClipEditor` hides the Mask & Stroke section for one.
      expect(thumbOf(root)).toBeNull()
    }
  )

  it.each<[string, SourceVideo[]]>([
    ['the source has no thumbnail', [video]],
    ['the clip has no source at all', []],
  ])('draws no thumbnail when %s', (_label, sourceVideos) => {
    const { root } = renderTrack({ clips: [makeClip('clip1', 0)], sourceVideos })

    expect(thumbOf(root)).toBeNull()
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Timeline/TimelineTrack.test.tsx`
Expected: FAIL. The first failure is `expected null not to be null` from 'draws the source thumbnail at the head of a video clip' — `styles.clipThumb` is `undefined` until the CSS class exists, so the query is `img.undefined` and finds nothing, and there is no `<img>` to find in any case. Quote it. The five negative cases (`toBeNull`) **pass** already; record that, and that they are the ones the implementation must keep passing rather than the ones it makes pass.

- [ ] **Step 7: Add the class, then render the element**

In `apps/artist/src/components/Timeline/Timeline.module.css`, add one declaration to `.clipContent` (449-459) and a new block after it:

```css
.clipContent {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  height: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  overflow: hidden;
  gap: 2px;
  /* The containing block for `.clipThumb` (ESCSUITE-65). The thumbnail is the
     only absolutely positioned thing in here, and it is positioned against this
     element's padding box — which is the clip's whole box, since `.clip` has no
     padding of its own. */
  position: relative;
}

/* The per-clip thumbnail (ESCSUITE-65, decision 5): the clip's mask, shown where
   the user looks for the clip.

   Out of flow on purpose. In flow it would be the tallest item in a
   `flex-wrap: wrap` row whose duration is `width: 100%`, so it would push that
   duration past `overflow: hidden` and out of sight; absolutely positioned, the
   name/duration layout is exactly what it was before this existed — which is
   also why no pointer frame has anything new to lay out and the
   `timeline-interaction` benchmark's per-move layout count does not move.

   Its box is the `width`/`height` attributes, computed from the track's height in
   `TimelineTrack.tsx` (CSS cannot read a track height, and the `clip-path` needs
   the height in pixels). Its shape is an inline `clip-path` from
   `utils/maskClipPath.ts`. Nothing here draws a border: the clip's stroke stays
   in the frame in v1.

   `pointer-events: none` so it can never be an event target — the timeline finds
   the clip under the pointer with `closest('[data-clip-id]')` and the trim
   handles sit above it at `z-index: 5`. Held under half opacity because the
   clip's name is drawn over its right-hand side; at 0.45 the masked silhouette
   still reads against the flat clip background and the white label stays
   legible. */
.clipThumb {
  position: absolute;
  left: 0;
  top: 0;
  object-fit: cover;
  opacity: 0.45;
  pointer-events: none;
}
```

In `apps/artist/src/components/Timeline/TimelineTrack.tsx`, add to the imports (after line 5's `AudioWaveform` import):

```ts
import { CLIP_THUMB_ASPECT, maskClipPathFor } from '../../utils/maskClipPath';
```

Add two constants above `interface TimelineTrackProps` (line 9):

```ts
/**
 * How much shorter a clip's box is than its track row, in pixels.
 *
 * `.clip` is `top: 4px; height: calc(100% - 8px)` (`Timeline.module.css`), so
 * this mirrors one CSS declaration and exists because the thumbnail's height has
 * to be a number in JS — CSS cannot read `track.height`, and
 * `maskClipPathFor` needs the height in pixels to place a circle's radius.
 */
const CLIP_BOX_VERTICAL_INSET = 8;

/**
 * The shortest clip box there is, mirroring `.clip`'s own `min-height: 40px`: a
 * track dragged shorter than that stops shrinking the box, so the thumbnail has
 * to stop shrinking with it or it would float inside a box taller than itself.
 */
const MIN_CLIP_BOX_HEIGHT = 40;
```

Inside the `clips.map` callback, after `hasWaveform` (line 101):

```ts
        // The masked thumbnail (ESCSUITE-65, decision 5): the clip's own mask,
        // shown where the user looks for the clip.
        //
        // Media clips only — an audio part carries no picture and an overlay has
        // no drawn box a mask could mean anything against — and only when the
        // source actually has a thumbnail, which `processVideoFile` and
        // `processImageFile` write and `extractAudioMetadata` does not.
        //
        // It costs this row **no new store read**: `sourceMedia` above is the
        // lookup the waveform and the type styling already need, and `clip.mask`
        // is on the clip being rendered. That is why `App.rerender.test.tsx`'s
        // Timeline counts and `timelineGestures.perf.test.ts`' per-move counts
        // are unchanged by this feature.
        const thumbnailUrl =
          !isAudioClip && !isTextOverlay && !isShapeOverlay ? sourceMedia?.thumbnailUrl : undefined;
        const thumbHeight = Math.max(
          track.height - CLIP_BOX_VERTICAL_INSET,
          MIN_CLIP_BOX_HEIGHT
        );
```

And as the **first child** of the `.clipContent` div (line 139), before the audio icon:

```tsx
            <div className={styles.clipContent}>
              {thumbnailUrl && (
                <img
                  className={styles.clipThumb}
                  src={thumbnailUrl}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  width={Math.round(thumbHeight * CLIP_THUMB_ASPECT)}
                  height={thumbHeight}
                  style={{ clipPath: maskClipPathFor(clip.mask, thumbHeight) }}
                />
              )}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Timeline/TimelineTrack.test.tsx`
Expected: PASS — 12 pre-existing cases plus the new block (report the real total; the previous total is what the file had before this task, not a number to assume).

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Timeline`
Expected: PASS — every timeline suite, including `timelineGestures.perf.test.ts` with every count exactly as it was.

- [ ] **Step 9: Prove the two pinned files did not move, then typecheck, lint and measure**

Run: `git diff --stat apps/artist/src/components/Timeline/timelineGestures.perf.test.ts apps/artist/src/App.rerender.test.tsx apps/artist/src/test/fixtures/perfScene.ts`
Expected: **no output.** All three untouched — the perf scene included, because a thumbnail on the benchmark scene would change what the benchmark measures.

Run: `pnpm --filter @escapesuite/artist test:run`
Expected: PASS, whole suite.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: exit 0, no output.

Run: `pnpm --filter @escapesuite/artist test:coverage`
Expected: PASS with no threshold error. Then check the two new files specifically in the printed table: `src/utils/maskClipPath.ts` must be **100% on all four metrics**, and `TimelineTrack.tsx`'s figures must not fall. If a branch in either is short, the missing arm is one of: the three overlay/audio guards, the `sourceMedia?.` optional chain, the `Math.max` clamp (not a branch), or one of `maskClipPathFor`'s three shape arms — each already has a test above, so a gap means a test is not reaching it rather than that a test is missing. Record the four artist figures; Task 10 needs them.

- [ ] **Step 10: Commit**

```bash
git add apps/artist/src/utils/maskClipPath.ts apps/artist/src/utils/maskClipPath.test.ts \
  apps/artist/src/components/Timeline/TimelineTrack.tsx \
  apps/artist/src/components/Timeline/TimelineTrack.test.tsx \
  apps/artist/src/components/Timeline/Timeline.module.css
git commit -m "$(cat <<'EOF'
feat(artist): a media clip shows its mask on the timeline (ESCSUITE-65)

The operator's reason, in their words: "so the user sees what they expect to
see." A mask was visible in the preview and in an export, and the timeline —
where a user actually looks for a clip — drew no picture at all. Each media clip
whose source has a thumbnail now draws one, clipped to that clip's own mask.

DOM and CSS, never canvas. One <img> per clip plus an inline clip-path, because
the timeline's per-pointer-move cost is a published benchmark number and a
canvas per clip would put a second rasteriser on the gesture path.

The geometry is not a second copy. utils/maskClipPath.ts asks core/clipMask.ts's
maskPathFor for the shape of a 16:9 box of the thumb's height and only says the
answer in CSS, so the inscribed circle, the clamp to half the shorter side and
"a rounded rectangle with square corners is a rectangle" have one implementation
each. The thumb's shorter side *is* its height, so the stored radius — a
fraction of the clip's shorter side — resolves here against exactly what it
resolves against in the frame. One test asserts the thumbnail's radius IS
maskPathFor's answer, so that claim fails loudly if the two ever part.

Four things about the element are load-bearing and each is asserted. It is
absolutely positioned inside .clipContent, so it is out of flow: in flow it
would have been the tallest item in a wrapping row whose duration is width:100%
and would have pushed that duration out of sight. It is pointer-events: none and
draggable={false}, so it can never be an event target nor start a native drag
racing the clip drag — the hit geometry reads only [data-track-id] rows and
closest('[data-clip-id]'), and a test pins both. Its box is the width/height
attributes, computed once from the track height. And it is aria-hidden with
alt="": the clip's name is already its label.

It costs the timeline no store subscription. The source lookup is the one the
waveform already needs, so timelineGestures.perf.test.ts and
App.rerender.test.tsx are byte-unchanged and green, which is the proof.

Two deliberate limits, both stated where a reader will hit them: the stroke is
not drawn on the thumbnail in v1 (the whole inline style attribute is asserted,
which pins that), and an unmasked clip's thumbnail carries no clip-path at all
rather than clip-path: none.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 9: headless and e2e parity — the mask survives a real render, and arrives in a real inspector

**Files:**
- Modify: `services/headless-artist/test/ffprobe.ts` (three functions after `frameMeanRGB`, which ends at line 92)
- Modify: `services/headless-artist/src/verify.chromium.test.ts` (the import at line 9; five constants after `TWO_CLIP_ALPHA_FRAME` at line 50; a `maskedManifest` declaration beside `twoClipManifest` at line 81; a `writeManifestDir` helper and the `beforeAll` at 85-148 routed through it; one case after the two-clip case, which ends at line 251)
- Modify: `apps/e2e/tests/escapeartist/take-import.spec.ts` (two helpers after `transformValue` at 256-263; two cases after the "measures the corner from the screen recording" case, which ends at line 352)

**Interfaces:**

- Consumes: `runJob` / `probe` / the fixture manifest machinery this file already has; slice 1's `ClipMask` / `ClipStroke` through `RenderFileInput['project']`, which is artist's own `Project` (`services/headless-artist/src/types.ts:1` imports it from `apps/artist/src/headless/types`), so `clip.mask = { kind: 'circle' }` typechecks without a cast; `MaskSection`'s rendered DOM (the `CollapsibleSection` toggle button named "Mask & Stroke", the `<select>` over `CLIP_MASK_KINDS`, and the "Stroke Width" row's readout from `strokePixels`).
- Produces, in `services/headless-artist/test/ffprobe.ts`:

```ts
export async function frameRegionRGB(
  file: string, frameIndex: number, x: number, y: number, width: number, height: number
): Promise<[number, number, number]>
// -vf select=eq(n\,N),format=rgb24,crop=<w>:<h>:<x>:<y>,scale=1:1

export async function frameCornerRGB(
  file: string, frameIndex: number, size = 8
): Promise<[number, number, number]>
// -vf select=eq(n\,N),format=rgb24,crop=8:8:0:0,scale=1:1

export async function frameEdgeRGB(
  file: string, frameIndex: number, x: number, y: number, size = 4
): Promise<[number, number, number]>
// a size x size sample CENTRED on (x, y); at (8, 24) with the default size:
// -vf select=eq(n\,N),format=rgb24,crop=4:4:6:22,scale=1:1
```

- Produces, in `verify.chromium.test.ts`: a private `writeManifestDir(name, patch: (project: Project) => void): Promise<string>`. The in-test fixture patch shape is exactly:

```ts
    maskedManifest = await writeManifestDir('masked', (project) => {
      const [clip0] = project.timeline.clips
      clip0.mask = { kind: 'circle' }
      clip0.stroke = { color: '#ffffff', width: MASKED_STROKE_WIDTH_FRACTION }
    })
```

- Produces, in `take-import.spec.ts`: `openSection(page, title)` and `maskKindSelect(page)`. The assertion strings are exactly `'circle'` / `'Circle'` for the kind, **`'4.5px'`** for the 1920-wide take and **`'3px'`** for the 1280-wide take.

**Five decisions this task pins, all argued in the commit message:**

- **`frameMeanRGB` is the wrong probe for a mask, and that is why this adds three.** It averages the whole frame (`ffprobe.ts:71`), which for a circle-masked red clip on black is a muddy dark red whose value says nothing about whether the mask was applied — the circle is 59% of a 64x48 frame, so the answer lands near "half red" whichever way the bug goes. The new primitive crops **first**, so the caller chooses what is averaged, and the two named wrappers are the two questions this feature asks: is the corner gone, and is there a line on the outline.
- **`format=rgb24` goes before the crop.** On a subsampled `yuv420p` stream ffmpeg snaps an odd crop offset onto the chroma grid and silently measures a different rectangle; converting first makes every offset exact. `scale=1:1` still does the averaging, exactly as in `frameMeanRGB`, and every region these cases sample is uniform by construction — so the scaler's choice of filter cannot change the answer.
- **The fixture on disk is not touched, and the two golden cases are the negative control.** `test/fixtures/manifest/project.json` backs the two single-clip goldens and the manifest tests, and `apps/e2e/fixtures/headless/project.json` (its twin) backs five Playwright consumers; the masked case patches the **loaded** copy, as the two-clip case already does at lines 97-112 and as `render-bundle.spec.ts:86` does for the resolution. That is also what makes those goldens a control rather than a risk: they assert the whole frame is red at `r > 200, g < 40, b < 40`, which a circle-masked frame with a white ring **cannot** produce. If a future change ever put the mask on the shared fixture, they go red.
- **The stroke under test is 8 px, not craft's 3/1280.** 3/1280 of a 64-wide frame is 0.15 px: no encoder would keep it and no probe could read it. What this case verifies is the **path** — that the bundle's engine draws the mask and then the outline outside the clip region — not the handoff's weight, which is `utils/overlayPlacement.test.ts`' job and the take-import e2e's. So it is sized to be measurable: a ring 8 px thick, four pixels either side of the circle, wide enough to sample the middle of.
- **The e2e asserts both takes, because one number is the bug and the other is the fix.** The seeded 1920x1080 take in a 1920x1080 project reads **4.5px** (craft draws 3 px of a canvas it caps at 1280, so 1920/1280 x 3) and the seeded 1280x720 take in the same project reads **3px** (flat, at the cap). A stroke stored as the flat `3/1280` fraction reads 4.5px for *both* — which is exactly the regression slice 1's final review caught (`f89638b`), and the second case is where a user would have seen it. The two takes are already seeded by this file's `beforeEach`, so the case costs no fixture.

- [ ] **Step 1: Teach `ffprobe.ts` to read a region** — append to `services/headless-artist/test/ffprobe.ts`

```ts
/**
 * The mean colour of a rectangle of one frame, as `[r, g, b]` in 0-255.
 *
 * {@link frameMeanRGB} averages the *whole* frame, which is the right probe for
 * "is this clip still red after the round trip" and the wrong one for anything
 * local: a circle-masked red clip on black averages to a muddy dark red whose
 * value says nothing about whether the mask was applied. This crops first, so
 * the caller chooses what is averaged.
 *
 * `format=rgb24` comes **before** the crop deliberately. On a subsampled
 * yuv420p stream ffmpeg snaps an odd crop offset onto the chroma grid and
 * silently measures a different rectangle; converting first makes every offset
 * exact. `scale=1:1` then does the averaging, as it does in `frameMeanRGB`.
 * Frames are zero-indexed, matching `select=eq(n,...)`.
 */
export async function frameRegionRGB(
  file: string,
  frameIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', file,
      // The comma inside eq() is escaped so the filter parser reads it as an
      // argument separator rather than the end of the `select` filter.
      '-vf', `select=eq(n\\,${frameIndex}),format=rgb24,crop=${width}:${height}:${x}:${y},scale=1:1`,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    { encoding: 'buffer' },
  )

  if (stdout.length < 3) {
    throw new Error(
      `frame ${frameIndex} of "${file}" at ${width}x${height}+${x}+${y} produced ${stdout.length} bytes, expected 3`,
    )
  }
  return [stdout[0], stdout[1], stdout[2]]
}

/**
 * The mean colour of the frame's top-left `size` x `size` block — the corner a
 * mask cuts away.
 *
 * Filter: `select=eq(n\,N),format=rgb24,crop=8:8:0:0,scale=1:1`. 8 px because it
 * is big enough to be unaffected by an encoder's ringing at a distant edge and
 * small enough to stay well clear of a circle inscribed in the frame — on a
 * 64x48 frame the nearest point of this block to that circle's centre is 30 px
 * away against a radius of 24, so a masked frame has nothing drawn here at all.
 */
export async function frameCornerRGB(
  file: string,
  frameIndex: number,
  size = 8,
): Promise<[number, number, number]> {
  return frameRegionRGB(file, frameIndex, 0, 0, size, size)
}

/**
 * The mean colour of a `size` x `size` block **centred on** `(x, y)` — a point
 * on a mask's outline, which is where a stroke either is or is not.
 *
 * Filter, for the default size centred on (8, 24):
 * `select=eq(n\,N),format=rgb24,crop=4:4:6:22,scale=1:1`. Small, because a
 * stroke is a band a few pixels wide and a sample wider than the band would
 * average in whatever lies either side of it. The caller picks a point at least
 * `size / 2` from the frame's edges: an outline that touches the edge has half
 * its line outside the frame, which is not a thing to measure.
 */
export async function frameEdgeRGB(
  file: string,
  frameIndex: number,
  x: number,
  y: number,
  size = 4,
): Promise<[number, number, number]> {
  return frameRegionRGB(
    file,
    frameIndex,
    Math.max(0, Math.round(x - size / 2)),
    Math.max(0, Math.round(y - size / 2)),
    size,
    size,
  )
}
```

Run: `pnpm --filter @escapesuite/headless-artist typecheck && pnpm --filter @escapesuite/headless-artist lint`
Expected: exit 0. Nothing is measured by coverage — this package's `coverage.include` is `src/**` and it excludes `test/**` outright (`vitest.config.ts`), and nothing in `dist/cli.js`'s import graph reaches `test/` (the file's own header says so), so these three functions ship nowhere.

- [ ] **Step 2: Write the masked verify case**

In `services/headless-artist/src/verify.chromium.test.ts`, change the import at line 9:

```ts
import { frameCornerRGB, frameEdgeRGB, frameMeanRGB, frameRegionRGB, hasFfmpeg, probe } from '../test/ffprobe'
```

Add after `TWO_CLIP_ALPHA_FRAME` (line 50):

```ts
/**
 * The masked case's stroke width, as a fraction of the frame width — 8 px on
 * this 64-wide fixture.
 *
 * Deliberately not ESCAPECRAFT's 3/1280, which is 0.15 px here: no encoder would
 * keep it and no probe could read it. What this case verifies is the *path* — the
 * bundle's engine masking the picture and then stroking the outline outside the
 * clip region — not the handoff's own weight, which is
 * `apps/artist/src/utils/overlayPlacement.test.ts`' job and the take-import
 * e2e's. So it is sized to be measurable.
 */
const MASKED_STROKE_WIDTH_FRACTION = 0.125
/** The middle of the 1 s, 30 fps timeline: a frame with the clip fully drawn. */
const MASKED_FRAME = 15
/**
 * A point on the mask's own outline, where the stroke is.
 *
 * The source is 64x48 and the clip is drawn at `scaleX: 1` — `core/canvasRenderer.ts`
 * reads scale 1 as native pixels — so the drawn box is the whole 64x48 frame and
 * `core/clipMask.ts` inscribes `min(64, 48) / 2 = 24` centred on (32, 24). The
 * circle's left extreme is therefore (8, 24), and an 8 px stroke centred on the
 * path spans x 4 to 12 there: a 4x4 sample centred on the point is all band, with
 * black outside it and red inside.
 */
const CIRCLE_EDGE_X = 8
const CIRCLE_EDGE_Y = 24
/** A block wholly inside the circle and wholly inside the stroke's inner edge. */
const CIRCLE_INSIDE = { x: 28, y: 20, width: 8, height: 8 }
```

Add beside `twoClipManifest` (line 81):

```ts
  let maskedManifest: string
```

Replace the `beforeAll` body's manifest section (lines 91-130) with a call to one helper, and add the helper after `render` (line 177):

```ts
    // Two manifest dirs of their own (project.json + a copy of the source beside
    // it), so each variant goes through loadManifest exactly as a customer's job
    // would.
    twoClipManifest = await writeManifestDir('two-clip', (project) => {
      const [track0] = project.timeline.tracks
      const [clip0] = project.timeline.clips
      project.timeline.tracks.push({ ...track0, id: 'track-1', name: 'V2', index: 1 })
      project.timeline.clips.push({
        ...clip0,
        id: 'clip-1',
        trackId: 'track-1',
        timelinePosition: 0.5,
        transform: { ...clip0.transform, opacity: 0.5 },
      })
      project.timeline.duration = 1.5
    })

    maskedManifest = await writeManifestDir('masked', (project) => {
      const [clip0] = project.timeline.clips
      clip0.mask = { kind: 'circle' }
      clip0.stroke = { color: '#ffffff', width: MASKED_STROKE_WIDTH_FRACTION }
    })
```

```ts
  /**
   * A manifest dir of its own, from the fixture project with `patch` applied.
   *
   * The fixture on disk is never edited. `test/fixtures/manifest/project.json`
   * backs the two golden single-clip cases above and this service's manifest
   * tests, and its twin `apps/e2e/fixtures/headless/project.json` backs five
   * Playwright consumers — so every variant is built by patching the *loaded*
   * copy, the way `apps/e2e/tests/headless/render-bundle.spec.ts:86` patches the
   * resolution. Extracted from the two-clip setup rather than copied for the
   * masked one: the boilerplate is thirty lines and the only interesting part is
   * the patch.
   */
  async function writeManifestDir(
    name: string,
    patch: (project: Project) => void,
  ): Promise<string> {
    const dir = path.join(tmpRoot, name)
    await fs.mkdir(dir, { recursive: true })

    const { project } = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'project.json'), 'utf8'),
    ) as { project: Project }
    patch(project)

    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ project }))
    await fs.copyFile(FIXTURE_SOURCE, path.join(dir, 'src-0.mp4'))
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        project: { $ref: './project.json' },
        sources: [
          {
            id: 'src-0',
            file: 'src-0.mp4',
            mimeType: 'video/mp4',
            name: 'clip.mp4',
            width: EXPECTED_WIDTH,
            height: EXPECTED_HEIGHT,
            duration: 1,
          },
        ],
      }),
    )
    return path.join(dir, 'manifest.json')
  }
```

And the case itself, after the two-clip test (line 251):

```ts
  it('renders a masked and stroked clip through the real engine (ESCSUITE-65)', async () => {
    const { outputPath } = await render('verify-masked', 'mp4', maskedManifest)

    const probed = await probe(outputPath)
    expect(videoStream(probed).width).toBe(EXPECTED_WIDTH)
    expect(videoStream(probed).height).toBe(EXPECTED_HEIGHT)

    // The corner is outside the inscribed circle — the nearest point of this 8x8
    // block to the centre (32, 24) is (7, 7), 30 px away against a radius of 24 —
    // so a masked frame draws nothing there and the export's black background
    // shows through. Unmasked it is the fixture's red, which is precisely what
    // the two golden cases above render from this same project.json: they assert
    // the whole frame at r > 200, g < 40, b < 40, which a circle-masked frame
    // with a white ring cannot produce. That is why the mask is patched in here
    // rather than written to the fixture, and it is this case's control.
    const [cornerR, cornerG, cornerB] = await frameCornerRGB(outputPath, MASKED_FRAME)
    expect(cornerR).toBeLessThan(60)
    expect(cornerG).toBeLessThan(60)
    expect(cornerB).toBeLessThan(60)

    // ...and the middle is still the clip. Without this, the assertion above
    // would pass just as well for a render that drew nothing at all.
    const [insideR, insideG, insideB] = await frameRegionRGB(
      outputPath,
      MASKED_FRAME,
      CIRCLE_INSIDE.x,
      CIRCLE_INSIDE.y,
      CIRCLE_INSIDE.width,
      CIRCLE_INSIDE.height,
    )
    expect(insideR).toBeGreaterThan(200)
    expect(insideG).toBeLessThan(40)
    expect(insideB).toBeLessThan(40)

    // The stroke: white, on the mask's own outline, drawn after the picture and
    // after the clip region was dropped (`core/clipMask.ts`'s inner restore) —
    // which is the whole reason that inner save/restore pair exists. Inside the
    // clip region, half of every line would have been eaten. This sample is the
    // middle of the band, so it is the line and nothing else.
    const [edgeR, edgeG, edgeB] = await frameEdgeRGB(
      outputPath,
      MASKED_FRAME,
      CIRCLE_EDGE_X,
      CIRCLE_EDGE_Y,
    )
    expect(edgeR).toBeGreaterThan(150)
    expect(edgeG).toBeGreaterThan(150)
    expect(edgeB).toBeGreaterThan(150)
  }, RENDER_TIMEOUT_MS)
```

- [ ] **Step 3: Run it — it should pass, then make the red real**

Run: `pnpm --filter @escapesuite/headless-artist exec cross-env HEADLESS_BUILD=1 vitest run src/verify.chromium.test.ts`
Expected: **PASS**, all five cases. Say so in the notes and say why: slice 1 already made every one of these assertions true — this task is verification, not behaviour, so there is no honest red to write first. (If the suite reports `SKIPPED: ffmpeg and ffprobe must both be on PATH`, stop: the case is not verified and the step is not done. Install both and re-run.)

Then make the failure real rather than assumed. Change **one line** of the patch:

```ts
      clip0.mask = { kind: 'none' }
```

Run the same command. Expected: FAIL at the corner assertion — `expected 229 to be less than 60` or thereabouts (the exact red is whatever the fixture's red encodes to; quote the number the run prints). That is the proof this case can fail and that it is measuring the mask rather than the black borders of a frame.

Then run it once more with `clip0.stroke` deleted but the mask restored. Expected: FAIL at the edge assertion — `expected <a small number> to be greater than 150`, because the point on the outline is then the boundary between black and red. Quote it.

**Restore both lines** and re-run: PASS. Record all three runs.

- [ ] **Step 4: Write the two e2e cases**

In `apps/e2e/tests/escapeartist/take-import.spec.ts`, add after `transformValue` (line 263):

```ts
/** Open one of the inspector's collapsed sections by its title. */
async function openSection(page: Page, title: string) {
  await page.getByRole('button', { name: title }).click()
}

/**
 * The Mask & Stroke section's kind dropdown.
 *
 * Found by the options it holds rather than by position: the inspector renders
 * several `<select>`s for a media clip (transition, blend mode, the two animation
 * groups) and only this one offers a rounded rectangle.
 */
function maskKindSelect(page: Page) {
  return page.locator('select').filter({ has: page.locator('option[value="rounded"]') })
}
```

and the two cases after the "measures the corner from the screen recording" test (line 352):

```ts
  test('the webcam clip arrives with the circle it was recorded in (ESCSUITE-65)', async ({
    page,
  }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()
    // Collapsed by default (`MaskSection` passes `defaultOpen={false}`), exactly
    // as Blend Mode is.
    await openSection(page, 'Mask & Stroke')

    // The take was recorded with `shape: 'circle'`, and `maskForPlacement` maps
    // that to `{ kind: 'circle' }` with no radius at all — `core/clipMask.ts`
    // inscribes the circle at min(w, h) / 2, which is precisely the circle
    // ESCAPECRAFT drew. jsdom cannot see any of this: the inspector is the only
    // place the handed-over mask is visible as a user sees it.
    await expect(maskKindSelect(page)).toHaveValue('circle')
    expect(await maskKindSelect(page).locator('option:checked').innerText()).toBe('Circle')

    // And the border, in the pixels the user reads rather than the fraction that
    // is stored. This take's screen half is 1920x1080 and the project is
    // ARTIST's own 1920x1080 default, so the camera sat in a 1920-wide frame:
    // craft draws 3 px of a canvas it caps at 1280, which is 1920/1280 x 3 =
    // 4.5 px of that frame, stored as 4.5/1920 and printed back against the
    // project's width by `MaskSection`'s strokePixels.
    expect(await transformValue(page, 'Stroke Width')).toBe('4.5px')
  })

  test('the border is the recording’s 3 px, not the project’s (ESCSUITE-65)', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${SMALL_TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()
    await openSection(page, 'Mask & Stroke')

    // The same circle — the shape does not depend on the capture's size...
    await expect(maskKindSelect(page)).toHaveValue('circle')

    // ...but the border's weight does. This take's screen half is 1280x720, at
    // the compositor's cap, where craft's border is a flat 3 px. Stored as
    // 3/1920 — the *project's* width is what the renderer multiplies back — and
    // printed as 3px. A stroke stored as the flat 3/1280 fraction reads 4.5px
    // here, which is the regression this pins: the two widths coincide on the
    // commonest take (1920 in 1920) and differ the moment they do not, and this
    // is where a user would have seen a border half again as heavy as the
    // recording's.
    expect(await transformValue(page, 'Stroke Width')).toBe('3px')
  })
```

- [ ] **Step 5: Run them — one spec, one browser, then make that red real too**

Run: `pnpm --filter @escapesuite/e2e exec playwright test --project=chromium tests/escapeartist/take-import.spec.ts`
Expected: **PASS**, six cases (four pre-existing plus two). WebKit is skipped by the file's own `test.skip` (it cannot put a Blob in IndexedDB under Playwright) and `--project=chromium` keeps this to one browser and one dev-server start. Nothing else may run at the same time.

Then make the second case's failure real: in `apps/artist/src/utils/overlayPlacement.ts`, temporarily change `strokeForPlacement`'s first line to the flat fraction the reviewer caught —

```ts
  const widthInFramePixels = OVERLAY_STROKE_WIDTH_FRACTION * resolution.width;
```

Re-run the spec. Expected: FAIL — `expected '4.5px' to be '3px'` on the second case, and the first case still green (the two widths coincide there, which is exactly why the bug survived to review). Quote it, **revert the change**, and re-run: PASS. This is the step that shows the second case is load-bearing rather than a restatement of the first.

- [ ] **Step 6: Prove no fixture moved, then typecheck and lint**

Run: `git status --short services/headless-artist/test/fixtures apps/e2e/fixtures`
Expected: **no output.** Neither `project.json` nor either `src-0.mp4`/`source.mp4` was touched.

Run: `git diff services/headless-artist/src/verify.chromium.test.ts | grep -E '^-' | grep -v '^---'`
Expected: only the manifest-writing lines that moved into `writeManifestDir` and the import line. **No removed `expect(`** — the two-clip case's assertions, and the two goldens', are byte-unchanged.

Run: `pnpm --filter @escapesuite/headless-artist test:run`
Expected: PASS — the unit suite, which excludes the chromium files and is unaffected.

Run: `pnpm --filter @escapesuite/headless-artist typecheck && pnpm --filter @escapesuite/headless-artist lint`
Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: exit 0 for all four.

Run: `pnpm --filter @escapesuite/e2e exec playwright test --project=chromium tests/headless/render-bundle.spec.ts`
Expected: PASS. This is the second and last Playwright spec this task runs, and its point is the fixture: it reads `apps/e2e/fixtures/headless/project.json` and would be the first thing to break if a variant had been written to disk instead of patched in-test.

- [ ] **Step 7: Commit**

```bash
git add services/headless-artist/test/ffprobe.ts \
  services/headless-artist/src/verify.chromium.test.ts \
  apps/e2e/tests/escapeartist/take-import.spec.ts
git commit -m "$(cat <<'EOF'
test: a masked clip survives a real render, and arrives in a real inspector (ESCSUITE-65)

Two claims slice 1 made in prose, made into tests in the only two places that
can hold them.

The first is "one engine, no fork": renderProject calls the same exportToMP4 the
editor does, so a mask drawn in the editor is a mask drawn by the service. The
verification suite now renders a circle-masked, stroked clip through the real
bundle in real Chromium and probes the file with ffmpeg — the frame's corner
comes back black, its centre red, and a point on the circle's own outline white.
Three samples rather than one because frameMeanRGB averages the whole frame, and
for a circle on black that lands near "half red" whichever way the bug goes. So
ffprobe.ts gains a crop-first primitive and the two named samplers the feature
actually asks for: frameCornerRGB (is the corner gone) and frameEdgeRGB (is
there a line on the outline). format=rgb24 precedes the crop, or ffmpeg would
snap an odd offset onto the chroma grid and silently measure elsewhere.

The stroke under test is 8 px of a 64-wide fixture, not craft's 3/1280 — which
is 0.15 px there, and unmeasurable. What is under test is the path: mask, draw,
drop the clip region, stroke. The weight is the unit tests' subject and the e2e's.

No fixture was edited. The masked case patches the loaded copy, the way the
two-clip case already did and the way render-bundle.spec.ts patches the
resolution — and the two golden cases are this one's control, because they
assert the whole frame is red at r > 200, g < 40, b < 40, which a masked frame
with a white ring cannot produce. The two-clip setup and the masked one now share
one writeManifestDir helper rather than thirty lines of copy-paste; every
existing assertion in the file is byte-unchanged.

The second claim is the handoff's: a webcam part arrives masked and bordered. The
take-import spec now opens the inspector's Mask & Stroke section on the seeded
take and reads "Circle" and 4.5px, and on the smaller seeded take reads 3px. Both
numbers, not one: 1920-in-1920 is 4.5 px either way, which is why storing the
flat 3/1280 fraction looked right until review, and the 1280-in-1920 case is
where a user would have seen a border half again as heavy as the recording's.

Both cases pass on the first run, because slice 1 made them true. Each was
therefore mutation-proved — mask to 'none', stroke deleted, strokeForPlacement
back to the flat fraction — with the failures recorded before the revert.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 10: the documentation sweep, the changeset, and the coverage re-measure

**Files:**
- Modify: `apps/artist/CLAUDE.md` — line **747** (the `TimelineTrack.tsx` table row), a new note between line **788** and `### ClipEditor` at **790**, one sentence appended to the ESCSUITE-65 paragraph ending at **217**, one sentence appended to the headless bullet ending at **1268**, a new table row after **815**, and line **808**
- Modify: `CLAUDE.md` (root) — the `?loadVideo=` bullet at **201-212**, the artist and craft rows of the coverage table at **535-536**, and one dated sentence at the end of "Where it stands" (**457-528**)
- Modify: `apps/craft/CLAUDE.md` — the constants sentence at **333-334**
- Modify: `ESCAPE-SUITE-DOCUMENTATION.md` — the ESCAPEARTIST feature list at **64-72**
- Create: `.changeset/artist-timeline-mask-thumbnail.md`
- Modify, **only if a whole-percent floor rises**: `apps/artist/vite.config.ts` (thresholds at 224-229), `scripts/coverage-report.mjs` (the artist entry at 29-33)

**Interfaces:**
- Consumes: the finished Tasks 8 and 9, and the four coverage figures `pnpm coverage:report` prints.
- Produces: no code. One changeset, `@escapesuite/artist: patch` — a patch and not a minor because slice 1's minor already announced the feature; this adds where it is *shown*. **No craft changeset**: no craft source file is touched in this slice (`git diff --name-only main -- apps/craft` proves it). **No headless-artist changeset**: Task 9 changed `test/ffprobe.ts` and a `*.chromium.test.ts`, neither of which ships — `dist/cli.js` is bundled from `src/cli.ts`'s import graph, which never reaches `test/`, and the kit's `files` list excludes `test/` entirely (`ffprobe.ts`'s own header states both).

**Four things this task pins, argued in the commit message:**

- **Every stale sentence slice 1 left, named and fixed.** Slice 1 corrected `apps/artist/CLAUDE.md:211` and deferred the rest; the ledger parked the stale root coverage rows explicitly for this sweep. Two more were found while verifying line numbers and belong here too: `apps/artist/CLAUDE.md:808` still says `clipEditorOptions.ts` holds "four" option lists when `CLIP_MASK_KINDS` made it five, and the ClipEditor module table has no `MaskSection.tsx` row at all — a table that lists every module in a directory is wrong the moment it does not. `apps/craft/CLAUDE.md:333-334` still says `overlayGeometry.ts` exports "two constants" when slice 1 made it five.
- **Decision 5's second half is documented, not omitted.** The preview's selection box and hit test stay rectangular and the media-library card stays unmasked. Both are decisions, and a reader who finds them undocumented reads them as bugs — so they are written down beside the thumbnail, with the files that own them named (`components/Preview/hitTest.ts`, `selectionOverlay.ts`, `VideoUploader.tsx`).
- **The coverage rows are re-measured, not adjusted.** The artist row has read `99.38 / 98.71 / 93.51 / 98.95` since the end of ESCSUITE-14 slice 2; slice 1 finished at `99.39 / 98.73 / 93.68 / 98.97` and did not update it. The row is therefore measured fresh at the end of *this* slice and the stale hundredths are corrected in the same sentence that explains why, in the voice of the eleven re-measurements already in that paragraph. Craft is re-measured too, and expected to come back unchanged — asserting that it did is cheaper than assuming it.
- **A patch, and what it tells a user.** The feature shipped in slice 1's minor; this release note is about where the mask is now *visible*, and it says the two things a user would otherwise file: the border is not on the thumbnail, and the selection box in the preview is still a rectangle.

- [ ] **Step 1: The Timeline section of `apps/artist/CLAUDE.md`**

Line **747**, in the module table — replace:

> | `TimelineTrack.tsx` | One track row: its clips (only the ones the virtualiser passed), the drag preview, the trim's live sizing, and each clip's label, waveform and keyframe diamonds. …

with the same row reading `…and each clip's label, **masked thumbnail**, waveform and keyframe diamonds. …` (leave the rest of the cell, including the `React.memo` sentence, exactly as it is).

Then insert this note after the round-2 paragraph that ends at line **788** and before `### ClipEditor` at **790**:

```md
**A media clip carries its own masked thumbnail (ESCSUITE-65, decision 5).** `TimelineTrack`
draws one `<img>` of the clip's *source* thumbnail at the head of the clip and shapes it with an
inline CSS `clip-path` from `utils/maskClipPath.ts`: `circle(<h/2>px at 50% 50%)` for a circle
mask, `inset(0 round <fraction x h>px)` for a rounded one, and nothing at all for neither. The
geometry is not a second copy — `maskClipPathFor` asks `core/clipMask.ts`'s `maskPathFor` for
the shape of a 16:9 box of the thumb's height and only says the answer in CSS, so the inscribed
circle, the clamp to half the shorter side and "a rounded rectangle with square corners is a
rectangle" have one implementation each, and one test asserts the thumbnail's radius *is*
`maskPathFor`'s. The thumb's shorter side is its height, which is why one number is enough and
why the stored radius (a fraction of the clip's shorter side) resolves here against exactly what
it resolves against in the frame. DOM and CSS, never a canvas: the timeline drew no picture at
all before this, and a canvas per clip would put a second rasteriser on the gesture path.

Four properties of that `<img>` are load-bearing and each is asserted in
`TimelineTrack.test.tsx`. It is **`position: absolute` inside `.clipContent`**, so it is out of
flow — in flow it would be the tallest item in a `flex-wrap: wrap` row whose duration is
`width: 100%`, and it would push that duration past `overflow: hidden` and out of sight; out of
flow the name/duration layout is byte-identical, the trim handles keep their `z-index: 5` above
it, and no pointer frame has anything new to lay out. It is **`pointer-events: none`** and
**`draggable={false}`**, so it can never be an event target nor start a native drag racing the
clip drag — the hit geometry is `target.closest('[data-clip-id]')` plus a measurement of
`[data-track-id]` rows (`useTrackAreaCache.ts`), and an element inside a clip changes neither.
Its box is **one number each, on the `width`/`height` attributes**, computed from `track.height`
in the component because CSS cannot read a track's height and a `clip-path` circle needs a pixel
radius — leaving the inline `style` to carry the `clip-path` alone, which is what lets one
assertion on the whole style attribute prove the thumbnail is masked *and* not stroked. And it
is **`aria-hidden` with `alt=""`**: the clip's name is already its label, and this is decoration.
It costs the row no store read — `sourceMedia` is the lookup the waveform already needs — and
`timelineGestures.perf.test.ts` and `App.rerender.test.tsx` are byte-unchanged and green, which
is the proof it costs no listener, no rect read, no render and no subscription. The
`timeline-interaction` benchmark was re-run before and after, and its forced layouts per frame
did not move.

Three deliberate limits, so none of them reads as a bug. **The stroke is not drawn on the
thumbnail** — v1 shows the shape; the border stays in the frame. **The preview's selection box
and hit test stay rectangular** (`components/Preview/hitTest.ts`, `selectionOverlay.ts`): a
circle-masked clip is still selected, dragged, resized and rotated by its drawn rectangle. And
**the media library's card stays unmasked** (`VideoUploader.tsx`), because that thumbnail belongs
to the *source* file and one source can back several clips with different masks — which is also
why the mask could not simply be put there instead.
```

- [ ] **Step 2: The take-import and headless notes in `apps/artist/CLAUDE.md`**

At the end of the ESCSUITE-65 paragraph that closes at line **217** ("…flat at or below `COMPOSITOR_MAX_WIDTH`, proportional above it."), append one sentence:

```md
 The handed-over mask is visible on the timeline as well as in the frame: the webcam clip's
thumbnail is clipped to the same circle (see the Timeline section). Its border is not — the
thumbnail shows the shape only.
```

At the end of the third bullet of `## Headless Render Bundle`, after "…the **same** `exportToMP4`/`exportToWebM` the editor uses. No engine fork." (line **1268**), append:

```md
  That is a claim `services/headless-artist/src/verify.chromium.test.ts` now **tests** rather
  than asserts: a clip masked to a circle and given an outline is rendered through this bundle in
  real Chromium and probed with ffmpeg — the frame's corner comes back black, its centre red and
  a point on the circle's own edge white (ESCSUITE-65). The case patches the loaded fixture
  rather than the file on disk, which is what keeps the two golden single-clip cases as its
  control: they assert the whole frame is red, which a masked frame cannot be.
```

- [ ] **Step 3: The ClipEditor table in `apps/artist/CLAUDE.md`**

Line **808** — replace "The **four** `{ value, label }` option lists the dropdowns render — transitions, blend modes, animation presets, easings" with:

> | `clipEditorOptions.ts` | The **five** `{ value, label }` option lists the dropdowns render — transitions, blend modes, clip mask kinds, animation presets, easings (the last re-exported from `utils/easingOptions.ts`) |

Insert a new row immediately after the `BlendModeSection.tsx` row (line **815**), so the table's order still follows `ClipEditor.tsx`'s:

> | `MaskSection.tsx` | "Mask & Stroke": the mask kind over `CLIP_MASK_KINDS`, a corner-radius slider shown for `rounded` only, and the stroke's width and colour — the width labelled in **pixels at the project's resolution**, because what is stored is a fraction of the frame width and a fraction is not a number anyone can act on. Collapsed by default. Media clips only, gated exactly as Blend Mode is. It normalises nothing: "`none` with a radius" and "a width of 0 with a colour" are things a user can express, and turning them into absent fields is `useClipEditorActions`' job |

- [ ] **Step 4: The take-handoff bullet in the root `CLAUDE.md`**

In the `?loadVideo=<id>` bullet (**201-212**), replace "the webcam on a track above it at its `startOffset` with its transform seeded from the primary's `overlayPlacement`" with:

```md
  the webcam on a track above it at its `startOffset` with its transform, its **mask** and its
  **border** all seeded from the primary's `overlayPlacement` (ESCSUITE-65: a `'circle'`
  placement arrives as `clip.mask = { kind: 'circle' }` and ESCAPECRAFT's white border as
  `clip.stroke`, carried at the weight the *capture* had rather than the project's — visible in
  the preview, in an export, and as the shape of that clip's thumbnail on the timeline),
```

- [ ] **Step 5: The constants sentence in `apps/craft/CLAUDE.md`**

In the `overlayGeometry.ts` bullet (**331-340**), replace "plus `overlayGeometryFor()` / `overlayPaddingFor()` and the two constants `COMPOSITOR_MAX_WIDTH` / `DEFAULT_OVERLAY_PADDING`" with:

```md
  plus `overlayGeometryFor()` / `overlayPaddingFor()` and **five** constants:
  `COMPOSITOR_MAX_WIDTH`, `DEFAULT_OVERLAY_PADDING`, and the camera's own
  `OVERLAY_BORDER_COLOR` / `OVERLAY_BORDER_WIDTH` / `OVERLAY_CORNER_RADIUS` — the last three
  named (ESCSUITE-65) because ESCAPEARTIST now reproduces that border on a handed-over webcam
  clip and names the same numbers on its side (`OVERLAY_STROKE_COLOR`,
  `OVERLAY_STROKE_WIDTH_FRACTION`, `OVERLAY_CORNER_RADIUS_FRACTION` in
  `apps/artist/src/utils/overlayPlacement.ts`), so a change to the border here cannot silently
  stop matching what the editor draws. Naming them changed no pixel: the compositor's preview, a
  composited PiP recording and a re-composited MP4 all paint what they painted before.
```

- [ ] **Step 6: `ESCAPE-SUITE-DOCUMENTATION.md`**

In the ESCAPEARTIST "Key Features" list (**64-72**), add one bullet after "Text & shape overlays" and one after "Audio waveform visualization…":

```md
- Clip masks (circle or rounded rectangle) and clip borders, drawn identically in the preview, in
  every export and by the headless renderer
- Per-clip thumbnails on the timeline, clipped to that clip's own mask
```

- [ ] **Step 7: The changeset**

Create `.changeset/artist-timeline-mask-thumbnail.md`:

```markdown
---
'@escapesuite/artist': patch
---

**A masked clip now looks masked on the timeline.** A video or image clip shows a small picture
of itself at its left edge, clipped to whatever shape you gave the clip — so a clip you made
circular is a circle on the timeline, not a rectangle you have to remember is a circle. It
follows the mask: change the shape or take it off and the clip on the timeline changes with it.
A webcam clip handed over from ESCAPECRAFT arrives showing the circle it was recorded in.

Two things it deliberately does not do. The clip's **border** is not drawn on the timeline
picture — the picture is there to show the shape, and the border is in the frame. And the
**selection box in the preview stays a rectangle**: a circular clip is still selected, moved and
resized by the box around it, which is the handle you already know. The thumbnail in your media
library is unchanged too, because that one belongs to the file rather than to one clip of it, and
two clips of the same file can have different shapes.
```

*If `.changeset/artist-clip-mask.md` and `.changeset/craft-overlay-border-constants.md` are still present* (the release chained on #451 had not yet consumed them), leave both exactly as they are — they describe slice 1 and this is a separate note.

- [ ] **Step 8: Re-measure coverage and write the rows**

Run: `pnpm --filter @escapesuite/artist test:coverage`
Run: `pnpm --filter @escapesuite/craft test:coverage`
Expected: PASS with no threshold error for both.

Run: `pnpm coverage:report`
Expected: a table. Read the artist and craft `actual% / threshold%` pairs. The baselines to compare against: the root table currently reads artist **99.38 / 98.71 / 93.51 / 98.95** and craft **100.00 / 99.46 / 97.55 / 100.00**, and slice 1 finished at artist **99.39 / 98.73 / 93.68 / 98.97** (measured in Task 7 of that slice, never written to the table — that is the staleness this step fixes) and craft unchanged.

Then, in the root `CLAUDE.md`:

1. Update the artist row (**536**) and the craft row (**535**) to the measured figures.
2. Append one sentence to the end of the "Where it stands" paragraph (after the sentence ending "…rather than 257." at line **528**), in the voice of the eleven re-measurements above it and with **the real numbers, not these**:

```md
`@escapesuite/artist` was re-measured 2026-09-26 at the end of ESCSUITE-65 slice 2 (the masked
timeline thumbnail, the headless and e2e parity cases, and this sweep): <lines> / <statements> /
<branches> / <functions>, `utils/maskClipPath.ts` being a dozen lines of pure translation with a
test per arm and the thumbnail's four guards each having one — with **no floor crossed**, so
artist's floors stay 99 / 98 / 93 / 98. The row was also stale on all four figures: it still read
the 99.38 / 98.71 / 93.51 / 98.95 of the end of ESCSUITE-14 slice 2, while ESCSUITE-65 slice 1
finished at 99.39 / 98.73 / 93.68 / 98.97 without updating it, and it is corrected here.
`@escapesuite/craft` was re-measured the same day and came back unchanged at
100.00 / 99.46 / 97.55 / 100.00 — slice 2 touched no craft source at all, which
`git diff --name-only main -- apps/craft` says and this confirms.
```

3. **Only if a figure crossed a whole percent**, raise that floor in all three places in this same commit: `apps/artist/vite.config.ts` (224-229), the artist entry in `scripts/coverage-report.mjs` (29-33), and the table row. If a figure is *below* a floor, add the missing test rather than touching the floor — the arms most likely to be short are named in Task 8's Step 9.

- [ ] **Step 9: Verify the sweep is complete**

Each of these greps must return **no output**; each is one stale sentence this task removed.

```bash
grep -n "four \`{ value, label }\` option lists" apps/artist/CLAUDE.md
grep -n "and the two constants \`COMPOSITOR_MAX_WIDTH\`" apps/craft/CLAUDE.md
grep -n "each clip's label, waveform and keyframe diamonds" apps/artist/CLAUDE.md
grep -n "with its transform seeded from the primary's" CLAUDE.md
grep -n "99.38 | 98.71 | 93.51 | 98.95" CLAUDE.md
```

And each of these must return **at least one line** — the new material is actually there:

```bash
grep -n "MaskSection.tsx" apps/artist/CLAUDE.md
grep -n "maskClipPath" apps/artist/CLAUDE.md
grep -n "selection box and hit test stay rectangular" apps/artist/CLAUDE.md
grep -n "OVERLAY_BORDER_COLOR" apps/craft/CLAUDE.md
grep -n "clipped to that clip's own mask" ESCAPE-SUITE-DOCUMENTATION.md
grep -n "ESCSUITE-65 slice 2" CLAUDE.md
```

Then confirm nothing outside documentation moved in this task, and that the slice as a whole is green:

```bash
git diff --name-only HEAD   # only .md files, .changeset/, and (if a floor rose) the two config files
pnpm --filter @escapesuite/artist test:run
pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint
pnpm --filter @escapesuite/craft test:run
pnpm --filter @escapesuite/shared test:run
pnpm --filter @escapesuite/headless-artist test:run
git diff --name-only main -- apps/craft   # no output: no craft source in this slice
```

Expected: all green, and `git diff --name-only main -- apps/craft` silent — which is the evidence for "no craft changeset".

- [ ] **Step 10: Commit**

```bash
git add apps/artist/CLAUDE.md apps/craft/CLAUDE.md CLAUDE.md ESCAPE-SUITE-DOCUMENTATION.md \
  .changeset/artist-timeline-mask-thumbnail.md \
  apps/artist/vite.config.ts scripts/coverage-report.mjs
git commit -m "$(cat <<'EOF'
docs: the mask on the timeline, and the sentences slice 1 left behind (ESCSUITE-65)

The thumbnail is documented where a reader meets it — the Timeline section of
apps/artist/CLAUDE.md — with the four properties of that <img> that are
load-bearing rather than incidental: absolutely positioned inside .clipContent so
it is out of flow, pointer-events: none and draggable={false} so it can never be
an event target, its box one number each on the width/height attributes, and
aria-hidden with alt="" because the clip's name is already its label. And with
the reason the geometry is not a second copy: maskClipPathFor asks maskPathFor
for the shape and only says the answer in CSS.

Three limits are written down so none of them is read as a bug: the stroke is
not on the thumbnail, the preview's selection box and hit test stay rectangular,
and the media-library card stays unmasked because it belongs to the source file
and two clips of one file can have different shapes.

Four stale sentences, all found by verifying line numbers rather than by trusting
them. The ClipEditor module table listed no MaskSection.tsx at all and still
called clipEditorOptions.ts four option lists when CLIP_MASK_KINDS made it five;
craft's overlayGeometry.ts bullet still said "two constants" when slice 1 named
five; the root take-handoff bullet still said the webcam clip arrives with only a
transform; and the TimelineTrack row listed a clip's label, waveform and
diamonds. A table that claims to list every module in a directory is wrong the
moment it does not.

The headless bullet's "no engine fork" now names the test that proves it instead
of asserting it.

Coverage: artist re-measured at the end of the slice, and the row corrected — it
had read the figures from the end of ESCSUITE-14 slice 2 while ESCSUITE-65 slice
1 finished a hundredth or two above them on all four metrics without updating the
table. Craft re-measured too and unchanged, which is what a slice that touched no
craft source should read and is cheaper to check than to assume.

The changeset is a patch, not a minor: slice 1's minor announced the feature and
this says where it is now visible. It leads with what a user sees, and names the
two things they would otherwise file as bugs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage — section (f) tasks 8-10, and decision 5.**

| Spec requirement | Where it lives |
|---|---|
| (f8) `TimelineTrack` renders one `<img>` of its source's thumbnail at the head of a media clip (video or image with a `thumbnailUrl`) | Task 8, Steps 5 and 7; the video case and the image case are separate tests |
| (f8) Fixed height = the clip row's inner height, 16:9 | Task 8, Step 7: `thumbHeight = max(track.height - 8, 40)` mirroring `.clip`'s three CSS declarations, width `round(h x CLIP_THUMB_ASPECT)`; asserted as `height="52" width="92"` on a 60px track and `40`/`71` at the clamp |
| (f8) `aria-hidden`, `alt=""`, `draggable={false}`, `pointer-events: none` | Global Constraint 6; Task 8's 'is decoration, not content' case (three attributes) and the `.clipThumb` CSS (`pointer-events`) |
| (f8) `style={{ clipPath }}` from a pure `utils/maskClipPath.ts` | Task 8, Step 3 and Step 7 |
| (f8) `maskClipPathFor(mask, thumbHeightPx)` → `circle(<h/2>px at 50% 50%)` / `inset(0 round <fraction x h>px)` / `undefined` | Task 8's Interfaces block, Step 1's tests (`circle(26px at 50% 50%)`, `inset(0 round 13px)`, `undefined`) and Step 3's implementation |
| (f8) "the thumb's shorter side is its height, so the fraction resolves against it exactly as the canvas path does" | Task 8, decision 1 and Step 3's docstring; asserted twice — the string, and the parity case against `maskPathFor` |
| (f8) The stroke is **not** drawn on the thumbnail (v1; say so) | Global Constraint 7; Task 8 decision 6; the 'leaves a stroked clip's thumbnail unstroked' case asserting the **whole** style attribute; the changeset; `apps/artist/CLAUDE.md` (Task 10, Step 1) |
| (f8) Red-first: a video clip renders the img with its source's URL | Task 8, Steps 5-6-8 |
| (f8) Red-first: an audio clip, and a clip whose source has no thumbnail, render none | Task 8's audio case (against a source that *does* have a thumbnail, so the gate is what is tested), plus the `it.each` over "the source has no thumbnail" and "no source at all", plus the two overlay cases |
| (f8) Red-first: the three mask kinds give the three `clipPath` values | Task 8, Step 1 (unit, all three plus five no-mask inputs) and Step 5 (rendered: circle, rounded, none) |
| (f8) The thumb is inside `.clipContent` so `timelineGeometry.ts` hit geometry is untouched | Global Constraint 6; the 'sits inside .clipContent' case, which asserts the parent class, `closest('[data-clip-id]')` and the two trim handles |
| (f8) Ceiling: `timelineGestures.perf.test.ts` counts unchanged | Global Constraint 5; Task 8 Step 8 (suite green) and Step 9 (`git diff --stat` silent). Also true for a second reason recorded in the constraint: `perfScene.ts`'s `sceneSource` has no `thumbnailUrl` |
| (f8) Ceiling: `App.rerender.test.tsx` Timeline counts unchanged — no new subscription, the source lookup is `AudioWaveform`'s | Global Constraint 4 (with the three verified line numbers: `Timeline.tsx:43`, `:278`, `TimelineTrack.tsx:94`); Task 8 Step 9's `git diff --stat` |
| (f9) `ffprobe.ts` gains `frameCornerRGB` (`crop=8:8:0:0,scale=1:1`) and `frameEdgeRGB` for the stroke | Task 9, Step 1, with the exact filter strings in the Interfaces block and in each docstring — plus the `format=rgb24` prefix the task justifies and a `frameRegionRGB` primitive the two share |
| (f9) "today's `frameMeanRGB` at line 71 averages the whole frame and would blur the signal" | Task 9, decision 1, with the arithmetic (a circle is 58.9% of a 64x48 frame) |
| (f9) A masked+stroked case in `verify.chromium.test.ts`, built by patching the loaded fixture in-test the way lines 97-112 and `render-bundle.spec.ts:86` do | Task 9, Step 2, with the exact patch shape in the Interfaces block; the boilerplate extracted into `writeManifestDir` and the two-clip case routed through it |
| (f9) Leave `apps/e2e/fixtures/headless/project.json` untouched so no golden moves | Global Constraint 9 (naming all five consumers and the fixture's twin); Task 9 Step 6's `git status --short` on both fixture dirs, and the `render-bundle.spec.ts` run |
| (f9) Assertion: corner ≈ black, centre ≈ red, a point on the circle's edge ≈ white | Task 9, Step 2's three samples, each with the geometry derived in a comment and the derivation checked in this plan (corner 30 px from a radius-24 circle; centre block within 5.7 px of the centre; the 8 px band spanning x 4-12 at y 24) |
| (f9) One ESCAPEARTIST e2e: a handed-over webcam part shows "Circle" and a stroke width of 3 px at 1280x720 | Task 9, Step 4 — **two** cases, because the spec's "3 px at 1280" is the *`SMALL_TAKE`* case (a 1280-wide capture in the 1920-wide default project reads `3px`) while the already-seeded 1920-wide take reads `4.5px`. Both are asserted and the difference is the point; see the corrections note below |
| (f10) `apps/artist/CLAUDE.md` — the ESCSUITE-65 paragraph, the draw-path note, the timeline thumbnail note | Task 10, Steps 1-3 — at the **verified** lines 211-217, 1265-1268, 747 and 788/790, not the spec's 205-206 and 587 |
| (f10) `utils/overlayPlacement.ts:74-75`'s "shape is ignored" sentence | **Already done in slice 1** (Task 7 replaced it at the corrected lines 111-112); nothing left here. Verified: `grep -n "read and \*\*ignored\*\*" apps/artist/src/utils/overlayPlacement.ts` is empty on `a26f541` |
| (f10) `apps/craft/CLAUDE.md` (the named border constants) | Task 10, Step 5 |
| (f10) Root `CLAUDE.md`'s take-handoff bullet (the webcam clip now arrives masked and stroked) | Task 10, Step 4 |
| (f10) `ESCAPE-SUITE-DOCUMENTATION.md` | Task 10, Step 6 |
| (f10) An artist changeset; a craft changeset only if craft changes | Task 10, Step 7 (artist **patch**, not minor — slice 1's minor already announced the feature) and the Interfaces block's argument for no craft and no headless-artist changeset, with `git diff --name-only main -- apps/craft` as the evidence |
| (f10) Coverage rows re-measured for artist AND craft, with a dated "Where it stands" sentence | Task 10, Step 8, including the stale-hundredths correction the slice-1 ledger parked for this sweep |
| (g5) "The mask shows in the thumbnail… so the user sees what they expect to see" | **Task 8 entire** — this is what the task delivers |
| (g5) CSS `clip-path`, no canvas | Global Constraint 3; Task 8 decision 1 and Step 3's module header |
| (g5) The preview's selection box and hit test stay rectangular, **stated in the docs so it is not read as a bug** | Task 10, Step 1's third paragraph, naming `components/Preview/hitTest.ts` and `selectionOverlay.ts`; and the changeset's second paragraph, in a user's words |
| (g5) The media-library card is per source and stays unmasked | Task 10, Step 1 (with the reason: one source backs several clips) and the changeset |
| (g1) Inscribed circle | Inherited by construction — `maskClipPathFor` calls `maskPathFor`; asserted by the parity case |
| (g2) Radius is a fraction, 0-0.5, clamped | Inherited the same way; the clamp asserted at 0.5 and 0.9 |
| (g3) Media clips only | Global Constraint 2; four guard tests |
| (g6) The stroke is a clip layer option of its own | Untouched by this slice, and explicitly not rendered on the thumbnail (Global Constraint 7) |
| (h) "The timeline thumbnail is DOM, not canvas… keep the img fixed-size, `pointer-events: none`, `draggable={false}`, inside `.clipContent`, and re-run that benchmark once before and after task 8" | Global Constraints 3 and 6; **Controller Steps C2 and C3**, which take the baseline, re-run, compare the three `LayoutsPerFrame` figures against the published 0.82 / 0.98, and record the verdict either way. Explicitly the controller's, not an implementer's |
| (h) `inset(… round …)` needs no prefix in the three engines the e2e suite runs | No prefix is written; and jsdom round-trips both strings verbatim, which the plan verified before writing the assertions |
| (h) Fixture blast radius | Global Constraint 9; Task 9 Steps 2 and 6 |

**2. Placeholder scan.** No "TBD", no "add appropriate tests", no "similar to Task N", no "and so on". Every string, number and command is written out: the two `clip-path` forms and every value they take (`circle(26px at 50% 50%)`, `circle(22.5px at 50% 50%)`, `inset(0 round 2.6px)`, `inset(0 round 13px)`, `inset(0 round 18.2px)`, `inset(0 round 26px)`); the whole style attribute both assertions read (`'clip-path: circle(26px at 50% 50%);'` and `''`); the box attributes (`height="52" width="92"`, and `40`/`71` at the clamp); the two component constants (`CLIP_BOX_VERTICAL_INSET = 8`, `MIN_CLIP_BOX_HEIGHT = 40`) and the exported `CLIP_THUMB_ASPECT = 16 / 9`; the CSS class name `.clipThumb` and every declaration in it including `opacity: 0.45`; the three ffmpeg filter strings; the verify case's five constants (`0.125`, frame `15`, `(8, 24)`, the inside block `28,20,8,8`) and all nine of its thresholds; the e2e's four assertion strings (`'circle'`, `'Circle'`, `'4.5px'`, `'3px'`) with the arithmetic that produces each; every doc sentence in full, with the line it replaces; and every run command with its expected result.

Three deliberate exceptions, each with a rule instead of a value. **Task 8 Step 8's and Step 9's test totals** — the plan says "report the real count" rather than guessing, because slice 1's ledger recorded four brief-vs-reality count mismatches and a wrong count in a plan costs a review cycle for nothing. **Task 9 Step 3's and Step 5's red failure numbers** — the corner's red value and the edge's dark value depend on the encoder, so the step names the assertion that must fail and asks for the printed number to be quoted. **Task 10 Step 8's four coverage figures** — that step's entire subject is the measurement; it names the command, the two baselines to compare against (the table's stale row and slice 1's real figures), the whole-percent rule, the three files a risen floor touches, and the "add the test, never lower the floor" instruction.

**Where this plan corrects the spec or slice 1, each flagged at the point of use.** (a) **There is no `TimelineTrack.module.css`** — the row's styles are in `Timeline.module.css`, which is what this slice edits (Global Constraint 15). (b) The spec's f9 asks for "a stroke width of 3 px at 1280x720"; on the take the spec's e2e file actually seeds (1920x1080 capture, 1920x1080 project) the inspector reads **4.5px**, and `3px` is the *other* seeded take — a 1280-wide capture in the same project. Both are asserted, and the pair is stronger than either, because a stroke stored as the flat `3/1280` fraction reads 4.5px for both and that was a real bug caught in slice 1's final review (Task 9, decision 5). (c) `maskClipPathFor` **reuses** `maskPathFor` rather than reimplementing the three formulas, which the spec's task list did not specify and which is what makes decision 5's "the mask shows in the thumbnail" true by construction rather than by coincidence. (d) Three stale documentation lines beyond the spec's list are fixed in Task 10: `apps/artist/CLAUDE.md:808`'s "four" option lists, the missing `MaskSection.tsx` table row, and `apps/craft/CLAUDE.md:333-334`'s "two constants". (e) The spec says "`frameCornerRGB` (`crop=8:8:0:0,scale=1:1`)"; this plan adds `format=rgb24` before the crop and a shared `frameRegionRGB` primitive, for the reasons in Task 9's decisions 1 and 2.

**3. Type consistency.** `maskClipPathFor(mask: ClipMask | undefined, thumbHeightPx: number): string | undefined` has that exact signature in its definition (Task 8 Step 3), in its Interfaces block, in every one of `maskClipPath.test.ts`'s calls (Step 1), and at its single call site (Step 7) — where the first argument is `clip.mask`, typed `ClipMask | undefined` on `Clip` since slice 1, and the second is `thumbHeight`, a `number`. No cast at either end.

`CLIP_THUMB_ASPECT: number` is declared once in `utils/maskClipPath.ts` and read in exactly two places: inside `maskClipPathFor`, to build the box it measures, and in `TimelineTrack.tsx`, to size the element — which is the point of exporting it rather than writing `16 / 9` twice, since the two must be the same box.

`maskPathFor(kind: ClipMaskKind, radius: number | undefined, x, y, width, height): MaskPath` is slice 1's and is called with that six-argument order, unchanged; `mask?.kind ?? 'none'` satisfies `ClipMaskKind` and `mask?.radius` satisfies `number | undefined` without a cast. `MaskPath` is discriminated on `shape`, and `maskClipPathFor` narrows on that one field in the same order slice 1's `traceMaskPath` does — `'circle'`, then `'rounded'`, then everything else — so a fourth variant added later would fall into the `undefined` arm rather than compile to something wrong, and `path.radius` is only read inside a narrowed branch.

In `TimelineTrack.tsx`, `thumbnailUrl: string | undefined` comes from `sourceMedia?.thumbnailUrl`, where `sourceMedia: SourceVideo | undefined` is the existing line-94 local and `thumbnailUrl?: string` is `SourceVideo`'s own optional field (`packages/shared/src/types/index.ts:67`) — so `{thumbnailUrl && …}` narrows it to `string` for the `src` prop and no non-null assertion appears anywhere. `thumbHeight: number` feeds both the `height` attribute and `maskClipPathFor`, which is what makes the CSS box and the clip-path box the same box by construction. `TimelineTrackProps` is unchanged, so `Timeline.tsx`'s call site (line 270-282) needs no edit and `React.memo`'s prop comparison is unaffected.

In `services/headless-artist`, `frameRegionRGB`, `frameCornerRGB` and `frameEdgeRGB` all return `Promise<[number, number, number]>`, matching `frameMeanRGB`'s existing shape, so the destructuring in the new case reads exactly like the destructuring in the four cases above it. `writeManifestDir(name: string, patch: (project: Project) => void): Promise<string>` uses the file's own `type Project = RenderFileInput['project']` alias (line 60) — which resolves to artist's `Project` through `services/headless-artist/src/types.ts:1`, which is why `clip0.mask = { kind: 'circle' }` and `clip0.stroke = { color, width }` typecheck against slice 1's optional `Clip` fields with no cast, and why `pnpm --filter @escapesuite/headless-artist typecheck` is the guard that the service and the app have not drifted.
