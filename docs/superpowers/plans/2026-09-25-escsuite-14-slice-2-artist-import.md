# ESCSUITE-14 slice 2 — ARTIST imports a multi-part take and places it on the timeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the `?loadVideo=` handoff from ESCAPECRAFT resolves the take's parts by `takeId`, adds every part to ESCAPEARTIST's media library, and **places them on the timeline in one undo step** — the primary on a video track, the webcam part on a track above it at its `startOffset` with its transform seeded from the take's `overlayPlacement`, and mic/system parts on tracks of their own — for **every** handoff, a single-file take included.

**Architecture:** Three new pure modules and one new store action, wired into the one hook that already owns the handoff. `utils/overlayPlacement.ts` turns the stored `OverlayPlacement` into a `ClipTransform` using the live compositor's geometry (`drawWebcamOverlay`'s corner margin and `size × frame width`), with the aspect taken from the webcam part's own pixels and scale read as ARTIST reads it — 1 means native pixels. `utils/takeParts.ts` mirrors CRAFT's `utils/takeOrder.ts` grouping (`part.takeId === primary.id`) and ranks the roles. `app/takeImport.ts` does the async half: read the siblings' blobs and thumbnails, add each part with `addSourceVideo`, skip a part whose blob is gone, and return the list of parts to place. `store/clipSlice.ts` gains `placeTakeOnTimeline(parts)` — one `set`, one `pushToHistory`, tracks and clips built from the same `projectFactory` helpers `addClipToTimeline` uses, appended at the end of whatever the timeline already holds. `useHostIntegration` calls the two in sequence and reports through the existing one-slot notice.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (ten slices, `src/store/projectStore.ts` the only entry point), shared IndexedDB (`video-editor-db`, `DB_VERSION` stays 1), Vitest + Testing Library (jsdom) with `src/test/doubles/*` and `src/test/appDoubles.ts`, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md` — "Decisions" **7** and **8**, the ARTIST-import bullet of "Consequences the decisions fix in the design", and the slice-2 row of "Estimate, revised for the decisions". Read it before Task 1. Slice 1 is what this consumes: `apps/craft/CLAUDE.md`'s "A take can be several files" and the root `CLAUDE.md` Data Flow paragraph describe the stored shape, and `packages/shared/src/types/index.ts` declares it.

**Out of scope (later slices — do not build any of it here):** mic/system recording (slice 3 — the roles are *handled* here so slice 3 needs no ARTIST change, but nothing in CRAFT produces them yet), composite MP4/M4A and `UPLOAD_RECORDING.parts` (slice 4), clip shape/mask (ESCSUITE-65 — `overlayPlacement.shape` is read and **ignored**).

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure quoted in the step notes, before the implementation step. The steps below are ordered that way; do not reorder them.
2. **No existing test may be deleted or weakened.** These stay green and untouched: `src/App.rerender.test.tsx`, `src/App.session.test.tsx`, `src/App.project.test.tsx`, `src/App.shortcuts.test.tsx`, and every existing case in `src/app/useHostIntegration.test.ts` and `src/App.messages.test.tsx` — including "does not add a recording that is already in the library" and "revokes the thumbnail it created when the editor goes away", both of which this work must keep true by construction. Two files gain *inputs* only, never looser assertions, and each change is named in the task that makes it: `src/test/appDoubles.ts` (the storage double gains `getAllVideoMetadata`) and `src/app/appFormat.test.ts` (a new describe block).
3. **`App.rerender.test.tsx` selector contract:** no new `App`-level store selector. `useHostIntegration` reaches the new action through `useEditorStore.getState().placeTakeOnTimeline(...)`, exactly as it already reaches `clearHistory()`; `App`'s props to the hook are unchanged, so `App.tsx` is not edited at all in this slice.
4. **Coverage floors only go up.** Artist's floors are **99 / 98 / 93 / 98** (lines/statements/branches/functions) against achieved 99.37 / 98.70 / 93.38 / 98.94. Every new line and every new branch must execute in a test. Finish with `pnpm --filter @escapesuite/artist test:coverage`; if a figure crosses a whole percent, raise the floor in `apps/artist/vite.config.ts` **and** `scripts/coverage-report.mjs` **and** the root `CLAUDE.md` coverage table. Never lower one.
5. **Type-only declarations go in `src/store/types.ts`** (artist) or `packages/shared/src/types/index.ts` (shared). Both are excluded from coverage `include`; a *new* type-only module would report 0% and break the lines floor. `TakeClipPart` therefore lives in `src/store/types.ts`, not beside the action.
6. **New runtime modules go in `src/utils/`, `src/app/` or `src/store/`** — never into a module some suite `vi.mock`s wholesale. `src/core/storage.ts`, `src/core/videoProcessor.ts`, `src/core/projectManager.ts` and `src/utils/integration.ts` are mocked wholesale by the `App.*.test.tsx` files and by `useHostIntegration.test.ts`; put nothing new in them. A module *imported by* the hook (`src/app/takeImport.ts`) inherits those mocks, which is what makes it testable with the same doubles.
7. **Copy is pinned by tests.** Every user-visible string below is exact — `Loaded recording: <name>`, `Loaded recording: <name> (<n> tracks)`, `Loaded recording: <name> — <n> missing part(s) skipped`, `Recording not found`, `Failed to load recording`. Do not paraphrase in code or in tests.
8. **The shared package is not touched.** Slice 1 already added `takeId`, `role`, `startOffset`, `overlayPlacement`, `hasWebcam`, `RecordingRole` and `OverlayPlacement`. Nothing here needs another field, and `DB_VERSION` stays 1.
9. **Typecheck and lint every task:** `pnpm --filter @escapesuite/artist typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/artist lint`; for e2e work `pnpm --filter @escapesuite/e2e typecheck` and `pnpm --filter @escapesuite/e2e lint`.
10. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

11. Branch `feat/escsuite-14-slice-2` off `main`. No push and no PR unless asked.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/utils/overlayPlacement.ts` | `overlayPlacementToTransform()` and the one constant the compositor's corner margin becomes. Pure: a placement, a project resolution and a part's pixel size in, a `ClipTransform` out. No store, no React |
| `apps/artist/src/utils/overlayPlacement.test.ts` | The geometry, pinned against `Compositor.drawWebcamOverlay`'s own numbers |
| `apps/artist/src/utils/takeParts.ts` | The grouping ARTIST mirrors from CRAFT's `utils/takeOrder.ts`: `orderTakeParts()`, `partRoleRank()`, `isPlaceableRole()`. Pure over a metadata list |
| `apps/artist/src/utils/takeParts.test.ts` | Ordering, the unknown role, the orphan and the plain take |
| `apps/artist/src/app/takeImport.ts` | The async half of the handoff: resolve the parts, read each one's blob and thumbnail, add it to the library, report the ones whose blob is gone, and return the parts to place |
| `apps/artist/src/app/takeImport.test.ts` | Its four cases, against the App suite's storage and video-processor doubles |
| `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts` | The placement action: tracks, positions, the transform, one undo step, append-at-end |
| `apps/e2e/tests/escapeartist/take-import.spec.ts` | Chromium (and, locally, Firefox/WebKit): a two-part take seeded into the shared IndexedDB, opened with `?loadVideo=`, two clips on two tracks and the webcam clip's transform read off the inspector |
| `.changeset/artist-take-import.md` | `@escapesuite/artist: minor` — including the placement behaviour change for single takes |

**Modified**

| File | Change |
|---|---|
| `apps/artist/src/store/types.ts` | Re-export `RecordingRole` and `OverlayPlacement` from the shared package; add `TakeClipPart`; `EditorState` gains `placeTakeOnTimeline` |
| `apps/artist/src/store/clipSlice.ts` | The `placeTakeOnTimeline` action and its name in `ClipSlice`'s `Pick` |
| `apps/artist/src/app/appFormat.ts` | `takeLoadedMessage()` — the handoff's notice, with its pluralisation spelled once |
| `apps/artist/src/app/appFormat.test.ts` | A describe block for it |
| `apps/artist/src/app/useHostIntegration.ts` | The `?loadVideo=` branch imports the take, places it, and revokes *every* thumbnail URL it made |
| `apps/artist/src/app/useHostIntegration.test.ts` | New cases for the multi-part handoff, the missing companion, the unknown role, the single-take placement and the two paths that must **not** place |
| `apps/artist/src/App.messages.test.tsx` | One case: a two-part handoff through the rendered editor |
| `apps/artist/src/test/appDoubles.ts` | The storage double gains `getAllVideoMetadata` |
| `apps/artist/CLAUDE.md`, `CLAUDE.md`, `apps/artist/src/utils/integration.ts` | Documentation and the protocol comment |
| `apps/artist/vite.config.ts`, `scripts/coverage-report.mjs` | Only if a whole-percent floor rises |

---

### Task 1: The webcam transform — `overlayPlacementToTransform`

**Files:**
- Create: `apps/artist/src/utils/overlayPlacement.ts`
- Create: `apps/artist/src/utils/overlayPlacement.test.ts`
- Modify: `apps/artist/src/store/types.ts:1-12` (the shared re-export block)

**Interfaces:**
- Consumes: `OverlayPlacement` from `@escapesuite/shared/types` (slice 1), `ClipTransform` and `DEFAULT_TRANSFORM` from `../store/types`.
- Produces: `OVERLAY_MARGIN_FRACTION: number`; `interface PixelSize { width: number; height: number }`; `overlayPlacementToTransform(placement: OverlayPlacement, projectResolution: PixelSize, partSize: PixelSize): ClipTransform`.

**Four things this task pins, all argued in the commit message:**

- **The margin is a fraction of the frame width, not 20 pixels.** The compositor pads by a flat `20` px on a canvas capped at **1280** px wide (`compositor.ts:42-52`, `:66`), so the inset a user actually saw is `20 / 1280` of the frame. Carrying the pixel count over would put the overlay four times closer to the edge on a 4K project than it looked while recording.
- **The aspect comes from the webcam part's own pixels, not from the compositor's box.** `drawWebcamOverlay` hard-codes `webcamHeight = webcamWidth * 9 / 16` and then either centre-crops to a circle or *stretches* a rectangular camera into it. The separate-tracks part is the camera's real frame, and ARTIST draws it un-stretched; matching the compositor's stretch would be reproducing a bug. The **width** is the compositor's exactly — `size × frame width` — so the overlay is the size the user chose.
- **Scale 1 is native pixels.** `canvasRenderer.drawImageToCanvas` draws `videoWidth * animated.scaleX` at a centre of `animated.x * canvasWidth`, so the scale is the ratio of the wanted width to the part's own width, and x/y are the clip's **centre**, not its corner.
- **`shape` is read and ignored** (ESCSUITE-65). It stays in the type because that is where CRAFT wrote it; the day ARTIST has a clip mask, it maps here.

- [ ] **Step 1: Write the failing test** — create `apps/artist/src/utils/overlayPlacement.test.ts`

```ts
// Where the webcam clip lands when a take is handed over (ESCSUITE-14,
// decision 8).
//
// The numbers are the live compositor's. ESCAPECRAFT draws the overlay in
// `Compositor.drawWebcamOverlay` (apps/craft/src/core/compositor.ts) as
//
//   webcamWidth  = canvasWidth * webcamSize
//   webcamHeight = webcamWidth * 9 / 16
//   x            = padding                              (left corners)
//                = canvasWidth - webcamWidth - padding  (right corners)
//   y            = padding                              (top corners)
//                = canvasHeight - webcamHeight - padding (bottom corners)
//
// with `padding` 20 on a canvas capped at 1280 wide. This helper has to put the
// clip in the same place, so every case below reconstructs the drawn rectangle
// from the transform and compares it with those literals. ARTIST cannot import
// craft's compositor (different app), so the numbers are written out here with
// the formula that produced them; slice 4 extracts a shared `drawOverlay` and
// this is the test that will be pointed at it.
import { describe, it, expect } from 'vitest'
import { overlayPlacementToTransform, OVERLAY_MARGIN_FRACTION } from './overlayPlacement'
import { DEFAULT_TRANSFORM } from '../store/types'
import type { OverlayPlacement } from '@escapesuite/shared/types'

/** The rectangle `canvasRenderer` will draw for this transform, in project pixels. */
function drawnRect(
  transform: { x: number; y: number; scaleX: number; scaleY: number },
  project: { width: number; height: number },
  part: { width: number; height: number }
) {
  const width = part.width * transform.scaleX
  const height = part.height * transform.scaleY
  return {
    left: transform.x * project.width - width / 2,
    top: transform.y * project.height - height / 2,
    width,
    height,
  }
}

const placement = (position: OverlayPlacement['position'], size = 0.2): OverlayPlacement => ({
  position,
  size,
  shape: 'circle',
})

/** The compositor's own canvas for a 16:9 take: 1280 wide, padding 20. */
const COMPOSITOR_FRAME = { width: 1280, height: 720 }
/** A 16:9 camera, so the compositor's 9/16 box and the part's own aspect agree. */
const SIXTEEN_BY_NINE_CAMERA = { width: 1280, height: 720 }

describe('overlayPlacementToTransform', () => {
  it.each([
    // position, the compositor's x, its y — webcamWidth 256, webcamHeight 144
    ['top-left', 20, 20],
    ['top-right', 1280 - 256 - 20, 20],
    ['bottom-left', 20, 720 - 144 - 20],
    ['bottom-right', 1280 - 256 - 20, 720 - 144 - 20],
  ] as const)('puts the clip where the compositor drew it: %s', (position, expectedX, expectedY) => {
    const transform = overlayPlacementToTransform(
      placement(position),
      COMPOSITOR_FRAME,
      SIXTEEN_BY_NINE_CAMERA
    )

    const rect = drawnRect(transform, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA)
    expect(rect.left).toBeCloseTo(expectedX, 6)
    expect(rect.top).toBeCloseTo(expectedY, 6)
    expect(rect.width).toBeCloseTo(256, 6)
    expect(rect.height).toBeCloseTo(144, 6)
  })

  it('keeps the overlay the same fraction of the frame at any project resolution', () => {
    // The compositor's 20px padding is 20/1280 of its canvas, so on a 1080p
    // project the inset is 30px — the same *proportion* of the frame the user
    // saw, rather than the same number of pixels four times closer to the edge.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('bottom-right'), project, {
      width: 1280,
      height: 720,
    })

    const rect = drawnRect(transform, project, { width: 1280, height: 720 })
    expect(rect.width).toBeCloseTo(1920 * 0.2, 6)
    expect(rect.left).toBeCloseTo(1920 - 384 - 30, 6)
    expect(rect.top).toBeCloseTo(1080 - 216 - 30, 6)
    expect(OVERLAY_MARGIN_FRACTION).toBe(20 / 1280)
  })

  it('takes the aspect from the camera, not from the compositor 16:9 box', () => {
    // drawWebcamOverlay always makes a 16:9 box and stretches a 4:3 camera into
    // it. The separate-tracks part is the camera's real frame and ARTIST draws
    // it un-stretched, so a 4:3 part is 4:3 on the timeline. Its *width* is
    // still the compositor's — size x frame width — so it is the size the user
    // chose while recording.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('bottom-right', 0.25), project, {
      width: 640,
      height: 480,
    })

    const rect = drawnRect(transform, project, { width: 640, height: 480 })
    expect(rect.width).toBeCloseTo(480, 6)
    expect(rect.height).toBeCloseTo(360, 6)
    expect(transform.scaleX).toBeCloseTo(0.75, 6)
    expect(transform.scaleY).toBeCloseTo(0.75, 6)
  })

  it('falls back to a 16:9 box at native size when the part has no dimensions', () => {
    // A stored part with no width or height was not written by ESCAPECRAFT.
    // Corner-right at native size beats a clip 0 pixels wide or no clip at all.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('top-left'), project, {
      width: 0,
      height: 0,
    })

    expect(transform.scaleX).toBe(DEFAULT_TRANSFORM.scaleX)
    expect(transform.scaleY).toBe(DEFAULT_TRANSFORM.scaleY)
    // The overlay box is still 0.2 x 1920 = 384 wide and 216 high (16:9), so
    // the centre sits one margin plus half a box in from the top-left corner.
    expect(transform.x).toBeCloseTo((30 + 192) / 1920, 10)
    expect(transform.y).toBeCloseTo((30 + 108) / 1080, 10)
  })

  it('leaves rotation, opacity and the aspect lock at their defaults', () => {
    const transform = overlayPlacementToTransform(
      placement('bottom-right'),
      COMPOSITOR_FRAME,
      SIXTEEN_BY_NINE_CAMERA
    )

    // The shape is ignored (ESCSUITE-65): a circle placement produces an
    // ordinary rectangular clip, so nothing here says anything about masking.
    expect(transform.rotation).toBe(DEFAULT_TRANSFORM.rotation)
    expect(transform.opacity).toBe(DEFAULT_TRANSFORM.opacity)
    expect(transform.scaleLocked).toBe(DEFAULT_TRANSFORM.scaleLocked)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/overlayPlacement.test.ts`
Expected: FAIL — `Failed to resolve import "./overlayPlacement" from "src/utils/overlayPlacement.test.ts"`.

- [ ] **Step 3: Add the shared type re-exports**

In `apps/artist/src/store/types.ts`, extend the import and the re-export at the top of the file (lines 1-12) so the app-side modules spell these names from one place:

```ts
// Shared types - imported from shared package
import type {
  MediaType,
  MediaSource,
  WaveformPeak,
  SourceVideo,
  RecordingRole,
  OverlayPlacement,
} from '@escapesuite/shared/types'

// Re-export shared types
export type { MediaType, MediaSource, WaveformPeak, SourceVideo, RecordingRole, OverlayPlacement }
```

- [ ] **Step 4: Implement the helper**

Create `apps/artist/src/utils/overlayPlacement.ts`:

```ts
// Where a handed-over webcam part lands on the timeline (ESCSUITE-14,
// decision 8).
//
// ESCAPECRAFT records the camera into a corner of the frame; a separate-tracks
// take stores that corner and that size on the take's primary part
// (`SourceVideo.overlayPlacement`) because the picture no longer carries it.
// This is the one place that turns it back into a clip transform, so the import
// looks like what the user saw while recording — and stays editable, which is
// the whole point of the separate track.
//
// Pure, and deliberately not in the store: the arithmetic is the half worth
// testing on its own, against the live compositor's numbers.
import { DEFAULT_TRANSFORM, type ClipTransform, type OverlayPlacement } from '../store/types';

/**
 * The compositor's corner inset, as a fraction of the frame's width.
 *
 * `Compositor` pads by a flat 20 px on a canvas capped at 1280 px wide
 * (`apps/craft/src/core/compositor.ts`), so what the user saw is 20/1280 of the
 * frame. Carrying the *pixel* count across would put the overlay four times
 * closer to the edge on a 4K project than it looked while recording.
 */
export const OVERLAY_MARGIN_FRACTION = 20 / 1280;

/**
 * The aspect used when a part's stored dimensions are unusable — the
 * compositor's own box, so an unknown camera still lands in the right corner at
 * the right width.
 */
const FALLBACK_OVERLAY_ASPECT = 16 / 9;

/** A width and a height in pixels: a project's resolution, or a part's frame. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * The transform a webcam clip is imported with.
 *
 * The overlay's **width** is the compositor's exactly (`size` x the frame's
 * width), so the clip is the size the user chose. Its **aspect** is the part's
 * own: `drawWebcamOverlay` builds a 16:9 box whatever the camera is and
 * stretches a 4:3 picture into it, and reproducing that here would be
 * reproducing a bug — the separate-tracks part is the camera's real frame.
 *
 * `x`/`y` are the clip's **centre** as a fraction of the canvas and `scaleX` is
 * the drawn width over the part's native width, because that is how
 * `core/canvasRenderer.ts` reads them: scale 1 means native pixels in ARTIST.
 *
 * `placement.shape` is read and **ignored** — a mask on every clip is
 * ESCSUITE-65, and when it exists the circle maps onto it here.
 */
export function overlayPlacementToTransform(
  placement: OverlayPlacement,
  projectResolution: PixelSize,
  partSize: PixelSize
): ClipTransform {
  const overlayWidth = projectResolution.width * placement.size;
  const margin = projectResolution.width * OVERLAY_MARGIN_FRACTION;

  // A part with no dimensions was not written by ESCAPECRAFT. It still belongs
  // in its corner: the box falls back to the compositor's 16:9 and the clip to
  // its native size, which beats a clip zero pixels wide.
  const hasSize = partSize.width > 0 && partSize.height > 0;
  const aspect = hasSize ? partSize.width / partSize.height : FALLBACK_OVERLAY_ASPECT;
  const scale = hasSize ? overlayWidth / partSize.width : DEFAULT_TRANSFORM.scaleX;
  const overlayHeight = overlayWidth / aspect;

  const isLeft = placement.position === 'top-left' || placement.position === 'bottom-left';
  const isTop = placement.position === 'top-left' || placement.position === 'top-right';

  const centreX = isLeft
    ? margin + overlayWidth / 2
    : projectResolution.width - margin - overlayWidth / 2;
  const centreY = isTop
    ? margin + overlayHeight / 2
    : projectResolution.height - margin - overlayHeight / 2;

  return {
    ...DEFAULT_TRANSFORM,
    x: centreX / projectResolution.width,
    y: centreY / projectResolution.height,
    scaleX: scale,
    scaleY: scale,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/overlayPlacement.test.ts`
Expected: PASS — 8 tests (the four corners are one `it.each`).

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/utils/overlayPlacement.ts apps/artist/src/utils/overlayPlacement.test.ts \
  apps/artist/src/store/types.ts
git commit -m "$(cat <<'EOF'
feat(artist): turn a take's overlay placement into a clip transform (ESCSUITE-14)

The corner and size ESCAPECRAFT recorded the camera at are stored on the take's
primary part; this is the one place that turns them back into a transform, so a
handed-over webcam clip starts where the user last saw it and stays editable.

Pinned against Compositor.drawWebcamOverlay's own numbers, with two deliberate
differences. The corner inset is 20/1280 of the frame rather than a flat 20px,
because that is what the compositor's capped canvas actually showed. And the
aspect is the camera's own: drawWebcamOverlay builds a 16:9 box whatever the
camera is and stretches a 4:3 picture into it, which is a bug to leave behind
rather than reproduce — the width, which is the size the user chose, is the
compositor's exactly. The shape is ignored until ESCSUITE-65.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 2: The take's parts — `orderTakeParts`

**Files:**
- Create: `apps/artist/src/utils/takeParts.ts`
- Create: `apps/artist/src/utils/takeParts.test.ts`

**Interfaces:**
- Consumes: `SourceVideo`, `RecordingRole` from `../store/types` (Task 1's re-export).
- Produces: `orderTakeParts(primary: SourceVideo, all: SourceVideo[]): SourceVideo[]`; `partRoleRank(role: string | undefined): number`; `isPlaceableRole(role: string | undefined): boolean`.

**The rules this task pins:**

- **Grouping is one equality, the same one CRAFT uses.** `apps/craft/src/utils/takeOrder.ts` calls a row a companion when `takeId !== undefined && takeId !== id`; here the primary is already known, so a companion is `part.takeId === primary.id && part.id !== primary.id`. A take is named by its primary in both directions.
- **The stack order is the role order** — `screen`, `webcam`, `mic`, `system` — not the storage order and not the parts' own timestamps. Two companions with the same rank fall back to their ids so the order is stable whatever `getAll` returned.
- **A role this build does not know ranks last and is not placeable.** `RecordingRole` is a compile-time union and IndexedDB is not type-checked: a record written by a newer ESCAPECRAFT, or a corrupt one, must not land somewhere arbitrary on the timeline. It joins the library — the user can see and delete it — and nothing else.

- [ ] **Step 1: Write the failing test** — create `apps/artist/src/utils/takeParts.test.ts`

```ts
// A take's parts, and the order they stack in (ESCSUITE-14).
//
// The mirror of ESCAPECRAFT's `utils/takeOrder.ts`: a take is named by its
// primary, so a part belongs to it when `part.takeId === primary.id`. Pure over
// the metadata list, so the grouping is asserted without storage —
// `app/takeImport.ts` is the only caller.
import { describe, it, expect } from 'vitest'
import { orderTakeParts, partRoleRank, isPlaceableRole } from './takeParts'
import type { SourceVideo } from '../store/types'

function part(id: string, extra: Partial<SourceVideo> = {}): SourceVideo {
  return {
    id,
    name: id,
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    ...extra,
  }
}

const primary = part('take-1', { takeId: 'take-1', role: 'screen' })

describe('orderTakeParts', () => {
  it('returns the primary alone when nothing else belongs to the take', () => {
    expect(orderTakeParts(primary, [primary, part('other')]).map((p) => p.id)).toEqual(['take-1'])
  })

  it('stacks the take by role: screen, webcam, mic, system', () => {
    const all = [
      part('sys', { takeId: 'take-1', role: 'system' }),
      part('cam', { takeId: 'take-1', role: 'webcam' }),
      primary,
      part('mic', { takeId: 'take-1', role: 'mic' }),
    ]

    // Storage order is whatever `getAll` returns, and the parts are written
    // within a millisecond or two of each other, so neither can decide the
    // stack. The role does: the camera goes over the screen, the audio above
    // that, and slice 3's parts need no change here to land in the right place.
    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual(['take-1', 'cam', 'mic', 'sys'])
  })

  it('ignores a part that belongs to another take', () => {
    const all = [primary, part('cam', { takeId: 'take-1', role: 'webcam' }), part('cam-2', { takeId: 'take-2', role: 'webcam' })]

    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual(['take-1', 'cam'])
  })

  it('puts a role this build does not know last, by id', () => {
    const all = [
      part('z-future', { takeId: 'take-1', role: 'hologram' as never }),
      part('a-future', { takeId: 'take-1', role: 'hologram' as never }),
      primary,
      part('cam', { takeId: 'take-1', role: 'webcam' }),
    ]

    // IndexedDB is not type-checked: a record written by a newer ESCAPECRAFT
    // has a role this build has never heard of. It still belongs to the take
    // and is still listed; where it ranks is decided rather than arbitrary.
    expect(orderTakeParts(primary, all).map((p) => p.id)).toEqual([
      'take-1',
      'cam',
      'a-future',
      'z-future',
    ])
  })

  it('never lists the primary twice, whatever storage holds', () => {
    expect(orderTakeParts(primary, [primary, primary]).map((p) => p.id)).toEqual(['take-1'])
  })
})

describe('isPlaceableRole', () => {
  it.each(['screen', 'webcam', 'mic', 'system'])('places a %s part', (role) => {
    expect(isPlaceableRole(role)).toBe(true)
    expect(Number.isFinite(partRoleRank(role))).toBe(true)
  })

  it.each([
    ['a role this build does not know', 'hologram'],
    ['no role at all', undefined],
  ])('does not place %s', (_label, role) => {
    expect(isPlaceableRole(role)).toBe(false)
    expect(partRoleRank(role)).toBe(Number.POSITIVE_INFINITY)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/takeParts.test.ts`
Expected: FAIL — `Failed to resolve import "./takeParts"`.

- [ ] **Step 3: Implement it**

Create `apps/artist/src/utils/takeParts.ts`:

```ts
// The parts of one take, and the order they stack in (ESCSUITE-14).
//
// The mirror of ESCAPECRAFT's `utils/takeOrder.ts`, which groups its library
// rows by the same rule: a take is named by its primary, so the primary's
// `takeId` is its own id and "belongs to this take" is one equality. Kept pure
// over the metadata list — `app/takeImport.ts` is the only caller, and the
// grouping is the half of it worth testing without storage.
import type { SourceVideo } from '../store/types';

/**
 * The roles this build knows how to place, in the order they stack: the screen
 * at the bottom, then the camera over it, then the audio parts.
 *
 * Typed as plain strings on purpose. `RecordingRole` is a compile-time union
 * and IndexedDB is not type-checked, so the question these answer — "is this a
 * role we know?" — has to be a runtime one.
 */
const ROLE_ORDER: readonly string[] = ['screen', 'webcam', 'mic', 'system'];

/**
 * Where a part sits in its take's stack. `Infinity` for a role this build does
 * not know, which is what keeps such a part off the timeline.
 */
export function partRoleRank(role: string | undefined): number {
  const rank = ROLE_ORDER.indexOf(role ?? '');
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

/** Whether a companion with this role can be put on the timeline at all. */
export function isPlaceableRole(role: string | undefined): boolean {
  return Number.isFinite(partRoleRank(role));
}

/**
 * The take's parts, primary first, then its companions in role order.
 *
 * Companions are not sorted by `recordedAt`: every part of a take is saved
 * within a millisecond or two of every other, and they are written in an order
 * that is the save path's business rather than the timeline's. Two parts of the
 * same rank fall back to their ids, so the answer does not depend on what
 * `getAllVideoMetadata()` happened to return first.
 */
export function orderTakeParts(primary: SourceVideo, all: SourceVideo[]): SourceVideo[] {
  const companions = all
    .filter((candidate) => candidate.id !== primary.id && candidate.takeId === primary.id)
    .sort((a, b) => {
      const byRole = partRoleRank(a.role) - partRoleRank(b.role);
      // Infinity - Infinity is NaN, which would leave two unknown-role parts in
      // an order the engine chose; ids decide instead.
      return Number.isNaN(byRole) || byRole === 0 ? a.id.localeCompare(b.id) : byRole;
    });

  return [primary, ...companions];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/utils/takeParts.test.ts`
Expected: PASS — 11 tests.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/utils/takeParts.ts apps/artist/src/utils/takeParts.test.ts
git commit -m "$(cat <<'EOF'
feat(artist): resolve a take's parts from the shared library (ESCSUITE-14)

The mirror of CRAFT's utils/takeOrder.ts on the reading side: a take is named
by its primary, so a part belongs to it when part.takeId === primary.id, and
the stack order is the role order — screen, webcam, mic, system — rather than
storage order or the parts' own timestamps, which are all within a millisecond
of each other.

A role this build does not know ranks last and is not placeable: IndexedDB is
not type-checked, and a record written by a newer ESCAPECRAFT should join the
library — visible, deletable — rather than land somewhere arbitrary on the
timeline. Slice 3's mic and system parts need no change here.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 3: The placement — `placeTakeOnTimeline`, one undo step

**Files:**
- Modify: `apps/artist/src/store/types.ts` (a new interface beside `Clip`, one line in `EditorState`)
- Modify: `apps/artist/src/store/clipSlice.ts:1-70` (imports, the `Pick` list, the new action)
- Create: `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts`

**Interfaces:**
- Consumes: `overlayPlacementToTransform` (Task 1); `createTrackAtTop`, `findEmptyTrack`, `calculateTimelineDuration` from `./projectFactory`; `pushToHistory` from `./storeHistory`; `DEFAULT_TRANSFORM`, `DEFAULT_EFFECTS`, `DEFAULT_TRANSITION` from `./types`.
- Produces: `interface TakeClipPart { sourceVideoId: string; name: string; duration: number; startOffset: number; width: number; height: number; overlayPlacement?: OverlayPlacement }` in `src/store/types.ts`; `placeTakeOnTimeline: (parts: TakeClipPart[]) => void` on `EditorState`, implemented in `clipSlice`.

**Four decisions this task pins, all argued in the commit message:**

- **One action rather than a run of `addClipToTimeline` calls.** The brief's route — call the existing action once per part and keep the history to one entry with a `skipHistory` flag — was considered and rejected for three reasons. (a) One `set` makes "one undo step" a property of the code rather than a convention every future caller has to uphold. (b) Each part's position is measured from the *same* timeline: a run of calls would measure the append offset against a timeline the previous call had already lengthened, which is a real bug and not a style question. (c) It changes no existing signature, so the thirteen clip actions and every one of their tests are untouched. The **semantics** of `addClipToTimeline` are kept by composing the same `projectFactory` helpers, and Step 1's first test pins that a plain take's clip is field-for-field the clip the media library produces — so the two cannot drift.
- **Append at the end, always.** `timelinePosition = calculateTimelineDuration(existing clips) + part.startOffset`. A handoff into a session that already holds work must not land on top of it, and an empty timeline measures 0 — so the ordinary import still starts at 0 and there is no special case, and no branch, for it.
- **The primary takes the track a library drag would take; every companion gets a new track above the one before it.** `findEmptyTrack` for the primary (the lowest-index empty track, else a new one at the top) is exactly `addClipToTimeline`'s rule. A companion may **not** reuse an empty track: decision 7 says the webcam goes *above* the screen, and an empty low-index track would put it underneath.
- **A part carrying an `overlayPlacement` is the one that gets a seeded transform.** The action knows nothing about roles: the placement travels on the part it applies to, which is the caller's mapping (Task 4 puts the primary's `overlayPlacement` on the webcam part). Everything else gets `DEFAULT_TRANSFORM`.

- [ ] **Step 1: Write the failing tests** — create `apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts`

```ts
// Putting a handed-over take on the timeline (ESCSUITE-14, decision 7).
//
// The store's other clip actions are one clip at a time; this one is a whole
// take — several clips on several tracks, in one undo step, at the end of
// whatever the timeline already holds.
import { describe, it, expect, beforeEach } from 'vitest'
import { store, resetStoreForTest, video } from '../../test/fixtures/projectStore'
import { overlayPlacementToTransform } from '../../utils/overlayPlacement'
import type { Clip, TakeClipPart } from '../types'

const screenPart: TakeClipPart = {
  sourceVideoId: 'screen-part',
  name: 'Recording 1/1/2026',
  duration: 6,
  startOffset: 0,
  width: 1920,
  height: 1080,
}

const webcamPart: TakeClipPart = {
  sourceVideoId: 'webcam-part',
  name: 'Recording 1/1/2026 — webcam',
  duration: 6,
  startOffset: 0.5,
  width: 1280,
  height: 720,
  overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
}

/** The clips on the timeline, in the order they were placed. */
const placedClips = (): Clip[] => store().project.timeline.clips

/** The track a clip sits on. */
const trackOf = (clip: Clip) =>
  store().project.timeline.tracks.find((track) => track.id === clip.trackId)!

beforeEach(() => {
  resetStoreForTest()
  store().clearHistory()
})

describe('placeTakeOnTimeline', () => {
  it('places a single-part take exactly as dropping it from the library would', () => {
    // The media library calls addClipToTimeline; a handoff must not produce a
    // subtly different clip. Everything but the generated id and the track is
    // compared, so a future change to either path fails here.
    store().addClipToTimeline({
      id: 'from-library',
      sourceVideoId: video.id,
      name: video.name,
      startTime: 0,
      endTime: 10,
      duration: 10,
    })
    const dropped = placedClips()[0]

    resetStoreForTest()
    store().clearHistory()
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: video.name, duration: 10, startOffset: 0, width: 1920, height: 1080 },
    ])
    const placed = placedClips()[0]

    expect({ ...placed, id: dropped.id, trackId: dropped.trackId }).toEqual(dropped)
  })

  it('puts the webcam part on a track above the primary, at its start offset', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const [screen, webcam] = placedClips()
    expect(screen.timelinePosition).toBe(0)
    expect(webcam.timelinePosition).toBe(0.5)
    // Higher index is higher in the stack (Timeline sorts descending), so this
    // is what "the webcam over the screen" means in the model.
    expect(trackOf(webcam).index).toBeGreaterThan(trackOf(screen).index)
    expect(store().project.timeline.duration).toBe(6.5)
  })

  it('seeds the webcam clip transform from the take overlay placement', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const webcam = placedClips()[1]
    expect(webcam.transform).toEqual(
      overlayPlacementToTransform(
        webcamPart.overlayPlacement!,
        store().project.resolution,
        { width: webcamPart.width, height: webcamPart.height }
      )
    )
    // The primary is not an overlay: it fills the frame the way any imported
    // clip does.
    expect(placedClips()[0].transform.x).toBe(0.5)
    expect(placedClips()[0].transform.scaleX).toBe(1)
  })

  it('gives every part its own track, in the order it was handed them', () => {
    const micPart: TakeClipPart = {
      sourceVideoId: 'mic-part',
      name: 'Recording — microphone',
      duration: 6,
      startOffset: 0,
      width: 0,
      height: 0,
    }
    store().placeTakeOnTimeline([screenPart, webcamPart, micPart])

    const tracks = placedClips().map((clip) => trackOf(clip).index)
    expect(new Set(tracks).size).toBe(3)
    expect(tracks[0]).toBeLessThan(tracks[1])
    expect(tracks[1]).toBeLessThan(tracks[2])
  })

  it('appends to the end of a timeline that already holds work', () => {
    store().addClipToTimeline(
      { id: 'existing', sourceVideoId: video.id, name: 'existing', startTime: 0, endTime: 4, duration: 4 },
      undefined,
      2
    )
    store().clearHistory()

    store().placeTakeOnTimeline([screenPart, webcamPart])

    // A handoff into a session that already holds work must not land on top of
    // it: the take starts where the timeline ends (2 + 4 = 6).
    const [, screen, webcam] = placedClips()
    expect(screen.timelinePosition).toBe(6)
    expect(webcam.timelinePosition).toBe(6.5)
  })

  it('is one undo step for the whole take, and undo leaves the media alone', () => {
    const before = store().history.past.length

    store().placeTakeOnTimeline([screenPart, webcamPart])

    expect(store().history.past).toHaveLength(before + 1)
    expect(placedClips()).toHaveLength(2)

    store().undo()

    // One Ctrl+Z takes the whole take off the timeline — not one part of it —
    // and the parts stay in the media library, exactly as undoing a drag from
    // the library does.
    expect(placedClips()).toHaveLength(0)
    expect(store().sourceVideos.map((v) => v.id)).toContain(video.id)
  })

  it('does nothing at all when there is nothing to place', () => {
    const before = store().history.past.length

    store().placeTakeOnTimeline([])

    // A take whose every part was missing still reaches here; it must not
    // record an undo step that undoes nothing, or add an empty track.
    expect(placedClips()).toHaveLength(0)
    expect(store().project.timeline.tracks).toHaveLength(1)
    expect(store().history.past).toHaveLength(before)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/__tests__/projectStore.takePlacement.test.ts`
Expected: FAIL — `store(...).placeTakeOnTimeline is not a function` (and a typecheck error on `TakeClipPart`, which vitest does not report).

- [ ] **Step 3: Add the type and the action's declaration**

In `apps/artist/src/store/types.ts`, immediately after the `Clip` interface:

```ts
/**
 * One part of a handed-over take, ready to be placed on the timeline
 * (ESCSUITE-14).
 *
 * A take used to be one file. Since ESCAPECRAFT can record the webcam as its
 * own track it can be several `SourceVideo`s sharing a `takeId`, and this is
 * what the host handoff reduces each of them to before the store places it:
 * enough to build a clip, and nothing about roles or storage.
 */
export interface TakeClipPart {
  /** The media library entry this clip plays. */
  sourceVideoId: string;
  /** The clip's name — the part's own, so the webcam half says so. */
  name: string;
  /** The part's length in seconds, already resolved against its blob. */
  duration: number;
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset: number;
  /** The part's own frame size, for the overlay-placement conversion. */
  width: number;
  height: number;
  /**
   * Where the webcam overlay sat while recording. Set on the **part it applies
   * to** — the take's webcam half — even though it is stored on the take's
   * primary, so the store needs to know nothing about roles: a part that
   * carries one is seeded from it, and every other part gets the default
   * transform.
   */
  overlayPlacement?: OverlayPlacement;
}
```

In `EditorState`, immediately after `addClipToTimeline`:

```ts
  /**
   * Place every part of a handed-over take, in one undo step.
   *
   * The first part takes the track a drop from the media library would take;
   * each one after it gets a new track above the last, which is what puts the
   * webcam over the screen. Positions are measured from the end of whatever the
   * timeline already holds, so a handoff into a session with work in it appends
   * rather than lands on top. An empty list places nothing and records nothing.
   */
  placeTakeOnTimeline: (parts: TakeClipPart[]) => void;
```

- [ ] **Step 4: Implement the action**

In `apps/artist/src/store/clipSlice.ts`, extend the imports:

```ts
import type { EditorState, Clip, ClipTransform, ClipEffects, BlendMode, Transition, ClipAnimation, TakeClipPart } from './types';
import { overlayPlacementToTransform } from '../utils/overlayPlacement';
```

add `'placeTakeOnTimeline'` to the `ClipSlice` `Pick` union (after `'addClipToTimeline'`), and add the action immediately after `addClipToTimeline`:

```ts
  // A whole take at once (ESCSUITE-14). Deliberately not a run of
  // addClipToTimeline calls: one `set` makes "one undo step" a property of the
  // code rather than a convention, and every part's position is measured
  // against the *same* timeline — a run would measure each part against a
  // timeline the part before it had already lengthened.
  placeTakeOnTimeline: (parts: TakeClipPart[]) => set((state) => {
    // Every part missing is a real case (Task's caller skips a part whose blob
    // is gone). Placing nothing must not record an undo step that undoes
    // nothing, or leave an empty track behind.
    if (parts.length === 0) return state;

    const timeline = state.project.timeline;
    // Append at the end of whatever is already there. An empty timeline
    // measures 0, so the ordinary import still starts at 0 and this needs no
    // special case for it.
    const takeStart = calculateTimelineDuration(timeline.clips);

    const tracks = [...timeline.tracks];
    const clips = [...timeline.clips];
    // The primary takes the track a drop from the media library would take —
    // the lowest-index empty one — which is addClipToTimeline's own rule. A
    // companion may never reuse an empty track: the webcam belongs *above* the
    // screen, and an empty low-index track would put it underneath.
    const primaryTrack = findEmptyTrack(tracks, clips);

    parts.forEach((part, index) => {
      let trackId: string;
      if (index === 0 && primaryTrack) {
        trackId = primaryTrack.id;
      } else {
        const created = createTrackAtTop(tracks);
        tracks.push(created);
        trackId = created.id;
      }

      clips.push({
        id: uuidv4(),
        sourceVideoId: part.sourceVideoId,
        name: part.name,
        startTime: 0,
        endTime: part.duration,
        duration: part.duration,
        trackId,
        timelinePosition: takeStart + part.startOffset,
        blendMode: 'normal',
        // The part that carries the overlay placement is the one the camera was
        // drawn into; everything else imports at native size, centred, like any
        // other clip.
        transform: part.overlayPlacement
          ? overlayPlacementToTransform(part.overlayPlacement, state.project.resolution, part)
          : { ...DEFAULT_TRANSFORM },
        effects: { ...DEFAULT_EFFECTS },
        transition: { ...DEFAULT_TRANSITION },
      });
    });

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...timeline,
          tracks,
          clips,
          duration: calculateTimelineDuration(clips),
        },
      },
      history: pushToHistory(state),
    };
  }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store/__tests__/projectStore.takePlacement.test.ts`
Expected: PASS — 7 tests.

Run: `pnpm --filter @escapesuite/artist exec vitest run src/store`
Expected: PASS — every pre-existing store suite, unchanged.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0. (`create<EditorState>` refuses to compile if the composition misses the new field, so a typecheck pass also proves the slice really provides it.)

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/store/types.ts apps/artist/src/store/clipSlice.ts \
  apps/artist/src/store/__tests__/projectStore.takePlacement.test.ts
git commit -m "$(cat <<'EOF'
feat(artist): place a whole take on the timeline in one undo step (ESCSUITE-14)

placeTakeOnTimeline takes a take's parts and writes them in one `set`: the
primary on the track a drop from the media library would take, each companion
on a new track above the last — which is what puts the webcam over the screen —
and the webcam's transform seeded from the take's stored overlay placement.

One action rather than a run of addClipToTimeline calls, for two reasons beyond
tidiness: one `set` makes "one undo step" a property of the code instead of a
convention every caller has to uphold, and every part's position is measured
against the same timeline — a run would measure each part against a timeline
the one before it had already lengthened. The clip it builds is pinned
field-for-field against addClipToTimeline's, so the two cannot drift.

Positions are measured from the end of whatever the timeline already holds, so
a handoff into a session with work in it appends rather than lands on top; an
empty timeline measures 0, so the ordinary import needs no special case.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 4: The import — `takeImport.ts` and the notice it raises

**Files:**
- Create: `apps/artist/src/app/takeImport.ts`
- Create: `apps/artist/src/app/takeImport.test.ts`
- Modify: `apps/artist/src/app/appFormat.ts` (one function)
- Modify: `apps/artist/src/app/appFormat.test.ts` (one describe block)
- Modify: `apps/artist/src/test/appDoubles.ts` (`storageDouble` gains `getAllVideoMetadata`)

**Interfaces:**
- Consumes: `orderTakeParts`, `isPlaceableRole` (Task 2); `TakeClipPart` (Task 3); `getAllVideoMetadata`, `getVideo`, `getThumbnail` from `../core/storage`; `resolveStoredDuration` from `../core/videoProcessor`.
- Produces: `interface ImportedTake { clipParts: TakeClipPart[]; thumbnailUrls: string[]; missingParts: number }`; `importTake(primary: { blob: Blob; metadata: SourceVideo }, addSourceVideo: (video: SourceVideo) => void): Promise<ImportedTake>`; `takeLoadedMessage(name: string, placed: number, missing: number): string` in `app/appFormat.ts`.

**Four rules this task pins:**

- **Siblings are only looked up when the primary carries a `takeId`.** A plain take — every recording made before ESCSUITE-14, and every composited PiP take after it — costs no extra storage read at all, which is also why every existing `?loadVideo=` test keeps passing untouched.
- **A companion whose blob is gone is skipped, and never blocks the take.** `getVideo` returning `undefined` for a part increments `missingParts` and the loop moves on. The primary is the opposite: a primary with no blob never reaches here (the caller reports `Recording not found`).
- **A companion whose own length cannot be read borrows the primary's.** Every part of a take is the same length by construction — one clock, one start, one stop — so falling back beats refusing to place it. `resolveStoredDuration` rejecting for the *primary* still propagates, because that is the take failing.
- **One notice, and the problem wins the slot.** `useNotification` is a single slot on a three-second timer, so two messages mean the first is never read. `takeLoadedMessage` folds all three facts into the one string, and the caller raises it as `'info'` when something was skipped and `'success'` otherwise.

- [ ] **Step 1: Write the failing notice test** — append to `apps/artist/src/app/appFormat.test.ts`

```ts
describe('takeLoadedMessage', () => {
  it('names a single-file recording exactly as it always has', () => {
    // Unchanged copy, deliberately: a plain take is the overwhelming majority
    // of handoffs and this is the sentence its tests already pin.
    expect(takeLoadedMessage('Screen recording', 1, 0)).toBe('Loaded recording: Screen recording')
  })

  it('says how many tracks a multi-part take came in on', () => {
    expect(takeLoadedMessage('Screen recording', 2, 0)).toBe(
      'Loaded recording: Screen recording (2 tracks)'
    )
  })

  it('says what was missing, and says it instead of the happy sentence', () => {
    // One toast slot on a three-second timer: two messages would mean the first
    // is never read, so the problem takes the slot.
    expect(takeLoadedMessage('Screen recording', 1, 1)).toBe(
      'Loaded recording: Screen recording — 1 missing part skipped'
    )
    expect(takeLoadedMessage('Screen recording', 1, 2)).toBe(
      'Loaded recording: Screen recording — 2 missing parts skipped'
    )
  })
})
```

Add `takeLoadedMessage` to that file's existing import from `./appFormat`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/appFormat.test.ts`
Expected: FAIL — `takeLoadedMessage is not a function`.

- [ ] **Step 3: Implement the message**

Append to `apps/artist/src/app/appFormat.ts`:

```ts
/**
 * What the toast says when an ESCAPECRAFT handoff lands.
 *
 * Three facts, one sentence, because `useNotification` is a single slot on a
 * three-second timer: raising two messages means the first is never read. A
 * plain take keeps the sentence it has always had; a take that arrived as
 * several tracks says so; and a take that left a part behind says *that*
 * instead, because it is the half the user can still do something about.
 */
export function takeLoadedMessage(name: string, placed: number, missing: number): string {
  if (missing > 0) {
    return `Loaded recording: ${name} — ${missing} missing part${missing === 1 ? '' : 's'} skipped`;
  }
  if (placed > 1) {
    return `Loaded recording: ${name} (${placed} tracks)`;
  }
  return `Loaded recording: ${name}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/appFormat.test.ts`
Expected: PASS — including every pre-existing case in the file.

- [ ] **Step 5: Teach the storage double the one call it is missing**

In `apps/artist/src/test/appDoubles.ts`, inside `storageDouble()`, beside `getVideo`:

```ts
    // The handoff asks for the whole library when the take it was given has a
    // takeId — that is how it finds the take's other parts (ESCSUITE-14).
    getAllVideoMetadata: vi.fn(() => Promise.resolve([] as SourceVideo[])),
```

Nothing else in the file changes; this is a capability the double gains, not an assertion that moves.

- [ ] **Step 6: Write the failing import tests** — create `apps/artist/src/app/takeImport.test.ts`

```ts
// Bringing a handed-over take into the media library.
//
// Storage and the media probe are the App suite's recording doubles — this
// module is a collaborator of `useHostIntegration`, mocked the same way there,
// so the two suites see the same boundaries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importTake } from './takeImport'
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
import { resolveStoredDuration } from '../core/videoProcessor'
import { sampleVideo } from '../test/appDoubles'
import type { SourceVideo } from '../store/types'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../core/videoProcessor', async () =>
  (await import('../test/appDoubles')).videoProcessorDouble()
)

const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

const primaryMetadata: SourceVideo = {
  ...sampleVideo,
  id: 'take-1',
  name: 'Screen recording',
  duration: 6,
  width: 1920,
  height: 1080,
  takeId: 'take-1',
  role: 'screen',
  startOffset: 0,
  overlayPlacement: PLACEMENT,
  hasWebcam: true,
}

const webcamMetadata: SourceVideo = {
  ...sampleVideo,
  id: 'take-1-webcam',
  name: 'Screen recording — webcam',
  duration: 6,
  width: 1280,
  height: 720,
  takeId: 'take-1',
  role: 'webcam',
  startOffset: 0.5,
  hasAudio: false,
}

const primary = { blob: new Blob(['screen'], { type: 'video/webm' }), metadata: primaryMetadata }

let added: SourceVideo[]
const addSourceVideo = (video: SourceVideo) => {
  added.push(video)
}

beforeEach(() => {
  added = []
  vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, webcamMetadata])
  vi.mocked(getVideo).mockResolvedValue({
    blob: new Blob(['webcam'], { type: 'video/webm' }),
    metadata: webcamMetadata,
  })
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
    Promise.resolve(metadata.duration)
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('importTake', () => {
  it('asks storage for nothing extra when the take is a single file', async () => {
    const plain = { blob: primary.blob, metadata: { ...sampleVideo, id: 'plain' } }

    const take = await importTake(plain, addSourceVideo)

    // A recording made before ESCSUITE-14, and every composited PiP take after
    // it, carries no takeId — so there is nothing to resolve and no reason to
    // read the whole library.
    expect(getAllVideoMetadata).not.toHaveBeenCalled()
    expect(added.map((v) => v.id)).toEqual(['plain'])
    expect(take.clipParts).toHaveLength(1)
    expect(take.missingParts).toBe(0)
  })

  it('adds every part of a take and hands the placement to the webcam half', async () => {
    const take = await importTake(primary, addSourceVideo)

    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-webcam'])
    expect(take.clipParts).toEqual([
      {
        sourceVideoId: 'take-1',
        name: 'Screen recording',
        duration: 6,
        startOffset: 0,
        width: 1920,
        height: 1080,
      },
      {
        sourceVideoId: 'take-1-webcam',
        name: 'Screen recording — webcam',
        duration: 6,
        startOffset: 0.5,
        width: 1280,
        height: 720,
        // Stored on the primary, carried onto the part it describes, so the
        // store needs to know nothing about roles.
        overlayPlacement: PLACEMENT,
      },
    ])
  })

  it('carries each part thumbnail as a blob URL for the caller to revoke', async () => {
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))

    const take = await importTake(primary, addSourceVideo)

    expect(added.every((v) => v.thumbnailUrl === 'blob:mock-url')).toBe(true)
    // The URLs live as long as the library entries, so they cannot be revoked
    // where they are made — the effect's cleanup hands them back.
    expect(take.thumbnailUrls).toHaveLength(2)
  })

  it('skips a part whose blob is gone, and still brings in the rest', async () => {
    vi.mocked(getVideo).mockResolvedValue(undefined)

    const take = await importTake(primary, addSourceVideo)

    // Storage cleared between the two writes, or a companion deleted by hand:
    // the screen recording is still the take's point and must arrive.
    expect(added.map((v) => v.id)).toEqual(['take-1'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    expect(take.missingParts).toBe(1)
  })

  it('gives a part whose length cannot be read the take own length', async () => {
    vi.mocked(resolveStoredDuration).mockImplementation((_blob, metadata) =>
      metadata.id === 'take-1' ? Promise.resolve(6) : Promise.reject(new Error('no duration'))
    )

    const take = await importTake(primary, addSourceVideo)

    // Every part of a take is the same length by construction — one clock, one
    // start, one stop — so borrowing the primary's beats refusing to place it.
    expect(take.clipParts[1].duration).toBe(6)
    expect(added[1].duration).toBe(6)
  })

  it('lists a part with an unknown role without placing it', async () => {
    const future = { ...webcamMetadata, id: 'take-1-hologram', role: 'hologram' as never }
    vi.mocked(getAllVideoMetadata).mockResolvedValue([primaryMetadata, future])

    const take = await importTake(primary, addSourceVideo)

    // It belongs to the take and the user can see and delete it; where it would
    // go on the timeline is not a question this build can answer.
    expect(added.map((v) => v.id)).toEqual(['take-1', 'take-1-hologram'])
    expect(take.clipParts.map((part) => part.sourceVideoId)).toEqual(['take-1'])
    expect(take.missingParts).toBe(0)
  })

  it('lets a primary that cannot be measured fail the take', async () => {
    vi.mocked(resolveStoredDuration).mockRejectedValue(new Error('no duration'))

    // The caller turns this into "Failed to load recording", which is what it
    // has always done — a take with no screen recording is not a take.
    await expect(importTake(primary, addSourceVideo)).rejects.toThrow('no duration')
  })
})
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/takeImport.test.ts`
Expected: FAIL — `Failed to resolve import "./takeImport"`.

- [ ] **Step 8: Implement `takeImport.ts`**

Create `apps/artist/src/app/takeImport.ts`:

```ts
// Bringing a handed-over take into the media library (ESCSUITE-14).
//
// `?loadVideo=<id>` names a take's **primary** part. Since ESCAPECRAFT can
// record the webcam as its own track, a take can be several `SourceVideo`s
// sharing a `takeId` — so the id is resolved to its parts here, each part is
// added to the library, and what comes back is the list the store places.
//
// It lives beside the hook rather than inside it for two reasons: the hook's
// effect is already the app's longest, and this is the half with the storage
// reads and the failure arms worth testing on their own.
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage';
import { resolveStoredDuration } from '../core/videoProcessor';
import { isPlaceableRole, orderTakeParts } from '../utils/takeParts';
import type { SourceVideo, TakeClipPart } from '../store/types';

/** What the handoff produced: what to place, what to revoke, what was lost. */
export interface ImportedTake {
  /** Every part that can be placed, primary first. */
  clipParts: TakeClipPart[];
  /** The blob URLs made for the parts' thumbnails. The caller owns revoking them. */
  thumbnailUrls: string[];
  /** Parts the take names whose blob is no longer in storage. */
  missingParts: number;
}

/**
 * The length to give a companion.
 *
 * Every part of a take is the same length by construction — one recorder, one
 * clock, one start, one stop — so a companion whose own file cannot be measured
 * borrows the take's length rather than being left off the timeline.
 */
async function resolvePartDuration(
  blob: Blob,
  part: SourceVideo,
  takeDuration: number
): Promise<number> {
  try {
    const duration = await resolveStoredDuration(blob, part);
    return Number.isFinite(duration) && duration > 0 ? duration : takeDuration;
  } catch {
    return takeDuration;
  }
}

/**
 * Add every part of a take to the media library and describe what to place.
 *
 * The primary's blob is already in hand (the caller fetched it to know the take
 * exists at all); each companion is fetched here. A companion whose blob is
 * gone is **skipped and counted** — it never costs the take its screen
 * recording — while a primary that cannot be measured throws, because that is
 * the take failing and the caller already reports it.
 */
export async function importTake(
  primary: { blob: Blob; metadata: SourceVideo },
  addSourceVideo: (video: SourceVideo) => void
): Promise<ImportedTake> {
  const { metadata } = primary;
  // Only a take that says it has parts costs a second storage read: a plain
  // take is every recording made before ESCSUITE-14 and every composited PiP
  // take after it.
  const parts =
    metadata.takeId === undefined
      ? [metadata]
      : orderTakeParts(metadata, await getAllVideoMetadata());

  // The stored duration is trusted unless it is unusable — a CRAFT take whose
  // WebM lost its Duration element is stored as Infinity — in which case the
  // length is recovered from the blob.
  const takeDuration = await resolveStoredDuration(primary.blob, metadata);

  const clipParts: TakeClipPart[] = [];
  const thumbnailUrls: string[] = [];
  let missingParts = 0;

  for (const part of parts) {
    const isPrimary = part.id === metadata.id;
    let duration = takeDuration;

    if (!isPrimary) {
      const stored = await getVideo(part.id);
      if (!stored) {
        // The take names a part storage no longer holds — cleared between the
        // two writes, or deleted by hand. Say so, and carry on: the screen
        // recording is the take's point.
        missingParts += 1;
        continue;
      }
      duration = await resolvePartDuration(stored.blob, part, takeDuration);
    }

    const thumbnailBlob = await getThumbnail(part.id);
    const thumbnailUrl = thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : undefined;
    if (thumbnailUrl) thumbnailUrls.push(thumbnailUrl);

    addSourceVideo({ ...part, duration, thumbnailUrl });

    // A companion with a role this build does not know is in the library, where
    // it can be seen and deleted, and nowhere else: where it belongs on the
    // timeline is not a question this build can answer.
    if (!isPrimary && !isPlaceableRole(part.role)) continue;

    clipParts.push({
      sourceVideoId: part.id,
      name: part.name,
      duration,
      startOffset: part.startOffset ?? 0,
      width: part.width,
      height: part.height,
      // The overlay geometry is stored on the take's primary and applies to its
      // camera, so it travels onto that part here — which is what lets the
      // store place a take without knowing what a role is.
      ...(part.role === 'webcam' && metadata.overlayPlacement !== undefined
        ? { overlayPlacement: metadata.overlayPlacement }
        : {}),
    });
  }

  return { clipParts, thumbnailUrls, missingParts };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/takeImport.test.ts src/app/appFormat.test.ts`
Expected: PASS — 7 + the appFormat file's cases.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/artist/src/app/takeImport.ts apps/artist/src/app/takeImport.test.ts \
  apps/artist/src/app/appFormat.ts apps/artist/src/app/appFormat.test.ts \
  apps/artist/src/test/appDoubles.ts
git commit -m "$(cat <<'EOF'
feat(artist): resolve a handed-over take into its parts (ESCSUITE-14)

?loadVideo= names a take's primary part, and a take can be several files
sharing a takeId. importTake resolves them, adds each to the media library with
its own thumbnail and its own resolved length, and returns what the store
places — with the take's stored overlay placement carried onto the webcam part
it describes, so the placement action needs to know nothing about roles.

Three failure arms, each chosen rather than defaulted: a companion whose blob is
gone is skipped and counted, never costing the take its screen recording; a
companion whose own length cannot be read borrows the take's, because every part
of a take is the same length by construction; and a primary that cannot be
measured still throws, because that is the take failing.

A take with no takeId — every recording made before this and every composited
PiP take after it — costs no extra storage read at all.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 5: The handoff itself — wiring `useHostIntegration`

**Files:**
- Modify: `apps/artist/src/app/useHostIntegration.ts:1-30` (imports), `:96-102` (the thumbnail URLs), `:117-155` (the `?loadVideo=` branch), `:169-173` (the cleanup)
- Modify: `apps/artist/src/app/useHostIntegration.test.ts` (new cases in the existing `?loadVideo=` describe, plus one in each of two others)
- Modify: `apps/artist/src/App.messages.test.tsx` (one case in "the ESCAPECRAFT handoff")

**Interfaces:**
- Consumes: `importTake` and `ImportedTake` (Task 4), `takeLoadedMessage` (Task 4), `placeTakeOnTimeline` on the store (Task 3).
- Produces: nothing new. `HostIntegrationDeps` is **unchanged**, so `App.tsx` is not edited and gains no selector — the action is reached through `useEditorStore.getState()`, exactly as `clearHistory()` already is.

**Three rules this task pins:**

- **Placement happens for every handoff, a single-file take included** (decision 7). This is the behaviour change named in the changeset and the docs.
- **`LOAD_VIDEO` and `?video=` still place nothing.** They fetch a file from a URL into the library; they are not take handoffs, they address no stored take, and a host that uses them today would find its editor's timeline written to without asking. Two tests pin it.
- **A take already in the library is skipped whole.** The existing early return stays exactly where it is, so a re-mount or a host re-navigating the same id cannot place a second copy of the take. The existing test that pins it is untouched.

- [ ] **Step 1: Write the failing tests** — in `apps/artist/src/app/useHostIntegration.test.ts`

Add to the imports at the top of the file:

```ts
import { getAllVideoMetadata, getThumbnail, getVideo } from '../core/storage'
```

(replacing the existing `import { getThumbnail, getVideo } from '../core/storage'`), and add to `beforeEach`, beside the other double defaults:

```ts
  vi.mocked(getAllVideoMetadata).mockResolvedValue([])
```

Then append these cases **inside** the existing `describe('the ?loadVideo= handoff from ESCAPECRAFT', ...)` block:

```ts
  it('puts a single-file take on the timeline as well as in the library', async () => {
    vi.mocked(getVideo).mockResolvedValue(recording as never)

    await mountIntegration({ loadVideoId: 'rec-1' })

    // ESCSUITE-14 decision 7: the handoff places clips for *every* take, not
    // only one recorded as separate tracks. This is the behaviour change.
    const clips = useEditorStore.getState().project.timeline.clips
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceVideoId).toBe('rec-1')
    expect(clips[0].timelinePosition).toBe(0)
    expect(deps.showNotification).toHaveBeenCalledWith('Loaded recording: Recording.webm', 'success')
  })

  describe('a take recorded as separate tracks', () => {
    const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

    const primary = {
      ...sampleVideo,
      id: 'take-1',
      name: 'Screen recording',
      duration: 6,
      width: 1920,
      height: 1080,
      takeId: 'take-1',
      role: 'screen' as const,
      startOffset: 0,
      overlayPlacement: PLACEMENT,
    }
    const webcam = {
      ...sampleVideo,
      id: 'take-1-webcam',
      name: 'Screen recording — webcam',
      duration: 6,
      width: 1280,
      height: 720,
      takeId: 'take-1',
      role: 'webcam' as const,
      startOffset: 0.5,
    }

    /** Both parts in storage, the way a separate-tracks take is stored. */
    const seedTake = (parts = [primary, webcam]) => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue(parts)
      vi.mocked(getVideo).mockImplementation((id) =>
        Promise.resolve(
          parts.some((part) => part.id === id)
            ? { blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: parts.find((p) => p.id === id)! }
            : undefined
        ) as never
      )
    }

    it('adds both parts and places them on two tracks, one above the other', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })

      expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)
      const { clips, tracks } = useEditorStore.getState().project.timeline
      expect(clips.map((c) => c.sourceVideoId)).toEqual(['take-1', 'take-1-webcam'])
      expect(clips[1].timelinePosition).toBe(0.5)
      const trackIndex = (id: string) => tracks.find((t) => t.id === id)!.index
      expect(trackIndex(clips[1].trackId)).toBeGreaterThan(trackIndex(clips[0].trackId))
      expect(deps.showNotification).toHaveBeenCalledWith(
        'Loaded recording: Screen recording (2 tracks)',
        'success'
      )
    })

    it('seeds the webcam clip transform from the placement the take was recorded at', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })

      const webcamClip = useEditorStore.getState().project.timeline.clips[1]
      // 1920 x 0.2 = 384 wide at a 30px inset, centred at 1698/1920 across and
      // (1080 - 30 - 108)/1080 down — the corner the compositor drew in.
      expect(webcamClip.transform.x).toBeCloseTo(1698 / 1920, 10)
      expect(webcamClip.transform.y).toBeCloseTo(942 / 1080, 10)
      expect(webcamClip.transform.scaleX).toBeCloseTo(0.3, 10)
    })

    it('is one undo step, and undo leaves both parts in the library', async () => {
      seedTake()

      await mountIntegration({ loadVideoId: 'take-1' })
      const pastBefore = useEditorStore.getState().history.past.length

      act(() => useEditorStore.getState().undo())

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
      expect(useEditorStore.getState().history.past).toHaveLength(pastBefore - 1)
    })

    it('says a part was skipped when its blob is gone, and still places the rest', async () => {
      vi.mocked(getAllVideoMetadata).mockResolvedValue([primary, webcam])
      vi.mocked(getVideo).mockImplementation((id) =>
        Promise.resolve(
          id === 'take-1'
            ? { blob: new Blob(['bytes'], { type: 'video/webm' }), metadata: primary }
            : undefined
        ) as never
      )

      await mountIntegration({ loadVideoId: 'take-1' })

      expect(useEditorStore.getState().project.timeline.clips).toHaveLength(1)
      expect(deps.showNotification).toHaveBeenCalledWith(
        'Loaded recording: Screen recording — 1 missing part skipped',
        'info'
      )
    })

    it('revokes every thumbnail it made when the editor goes away', async () => {
      seedTake()
      vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb']) as never)

      const { unmount } = await mountIntegration({ loadVideoId: 'take-1' })
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      unmount()

      // One per part: the URLs live as long as the library entries, so the
      // cleanup is the only place they can be handed back.
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    })
  })
```

Then one case in the `describe('inbound messages')` block:

```ts
  it('LOAD_VIDEO adds to the library and places nothing', async () => {
    await mountIntegration()

    await dispatch({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/clip.mp4' } })

    // A fetched URL is not a take handoff: it addresses no stored take, and a
    // host that loads one today must not find its timeline written to.
    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
  })
```

and one in `describe('the ?video= parameter')`:

```ts
  it('adds to the library and places nothing', async () => {
    await mountIntegration({ videos: ['https://host.example/a.mp4'] })

    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(0)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/useHostIntegration.test.ts`
Expected: FAIL — `expected [] to have a length of 1 but got +0` from the single-file placement test, and `expected "spy" to be called 2 times, but got 1 times` from the two-part test. The two "places nothing" cases pass already, which is the point of writing them now.

- [ ] **Step 3: Wire the hook**

In `apps/artist/src/app/useHostIntegration.ts`, extend the imports:

```ts
import { getVideo } from '../core/storage';
import { importTake } from './takeImport';
import { takeLoadedMessage } from './appFormat';
```

(`getThumbnail` and `resolveStoredDuration` move to `takeImport.ts`; drop them and the `processVideoFile`-adjacent import of `resolveStoredDuration` from this file, keeping `processVideoFile` itself.)

Replace the single-URL comment and variable (`:98-101`) with:

```ts
    // The ?loadVideo= thumbnails' blob URLs, handed back in the cleanup below.
    // They are handed to `addSourceVideo` and live as long as the media library
    // entries, so they cannot be revoked at the point they are created. A take
    // can be several parts since ESCSUITE-14, so there can be several.
    const thumbnailObjectUrls: string[] = [];
```

Replace the body of the `if (loadVideoId)` block (`:118-155`) with:

```ts
      (async () => {
        try {
          const videoData = await getVideo(loadVideoId);
          if (videoData) {
            // Check if video is already loaded
            const existingVideos = useEditorStore.getState().sourceVideos;
            if (!existingVideos.some(v => v.id === loadVideoId)) {
              // The id names a take's **primary** part, and a take can be
              // several files sharing a takeId (ESCSUITE-14). Every part joins
              // the library; every part that can be placed goes on the
              // timeline, in one undo step — for every take, not only one
              // recorded as separate tracks (decision 7).
              const take = await importTake(videoData, addSourceVideo);
              thumbnailObjectUrls.push(...take.thumbnailUrls);
              useEditorStore.getState().placeTakeOnTimeline(take.clipParts);

              showNotification(
                takeLoadedMessage(
                  videoData.metadata.name,
                  take.clipParts.length,
                  take.missingParts
                ),
                // One toast slot: a take that lost a part says so instead of
                // reporting a clean success the user would read as one.
                take.missingParts > 0 ? 'info' : 'success'
              );
            }
          } else {
            console.error('Video not found in IndexedDB:', loadVideoId);
            showNotification('Recording not found', 'error');
          }
        } catch (error) {
          console.error('Failed to load video from IndexedDB:', error);
          showNotification('Failed to load recording', 'error');
        }
      })();
```

and the cleanup (`:169-173`):

```ts
    return () => {
      cleanup();
      for (const url of thumbnailObjectUrls) URL.revokeObjectURL(url);
    };
```

Finally, extend the file's header comment, after the paragraph about the deps array:

```ts
// The `?loadVideo=` branch resolves a **take**, not a file: since ESCSUITE-14 a
// recording can be several parts sharing a `takeId`, so `takeImport.ts` brings
// them all into the library and `placeTakeOnTimeline` puts them on the timeline
// in one undo step. The store action is reached through `getState()` rather than
// taken as a dep, so `App` gains no selector (`App.rerender.test.tsx`).
```

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/app/useHostIntegration.test.ts`
Expected: PASS — every pre-existing case plus the eight new ones. In particular "does not add a recording the library already holds" and "says so when storage itself fails" are unchanged and still pass.

- [ ] **Step 5: Write the failing App-level test** — append inside `describe('the ESCAPECRAFT handoff', ...)` in `apps/artist/src/App.messages.test.tsx`

```ts
    it('places both parts of a separate-tracks take in the running editor', async () => {
      const primary = {
        ...sampleVideo,
        id: 'take-1',
        name: 'Screen recording',
        duration: 6,
        width: 1920,
        height: 1080,
        takeId: 'take-1',
        role: 'screen' as const,
        startOffset: 0,
        overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' } as const,
      }
      const webcam = {
        ...sampleVideo,
        id: 'take-1-webcam',
        name: 'Screen recording — webcam',
        duration: 6,
        width: 1280,
        height: 720,
        takeId: 'take-1',
        role: 'webcam' as const,
        startOffset: 0.5,
      }
      const parts = [primary, webcam]
      vi.mocked(getAllVideoMetadata).mockResolvedValue(parts)
      vi.mocked(getVideo).mockImplementation((id) =>
        Promise.resolve(
          parts.some((part) => part.id === id)
            ? { blob: new Blob(), metadata: parts.find((part) => part.id === id)! }
            : undefined
        ) as never
      )
      urlParams({ loadVideoId: 'take-1' })

      await renderApp()

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'Loaded recording: Screen recording (2 tracks)'
        )
      )
      // The editor the user sees: two clips on two tracks, the webcam half
      // above the screen half and half a second into it.
      expect(store().project.timeline.clips.map((c) => c.sourceVideoId)).toEqual([
        'take-1',
        'take-1-webcam',
      ])
      expect(store().project.timeline.tracks).toHaveLength(2)
      expect(await screen.findByText(/^2 clips · 2 tracks$/)).toBeInTheDocument()
    })
```

Add `getAllVideoMetadata` to that file's import from `./core/storage`.

- [ ] **Step 6: Run the App suites**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/App.messages.test.tsx src/App.rerender.test.tsx src/App.session.test.tsx`
Expected: PASS — all three files. `App.rerender.test.tsx`'s `toBeLessThanOrEqual(1)` is the selector contract; it must not have moved, because `App.tsx` was not edited.

Run: `pnpm --filter @escapesuite/artist test:run`
Expected: PASS — the whole artist suite. If any `App.*.test.tsx` file now reports "An update … was not wrapped in act(…)", the cause is the preview mounting media for the newly placed clip: wrap the assertion in `waitFor`/`await settleApp()` **in the test**, never by removing the placement.

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/artist/src/app/useHostIntegration.ts apps/artist/src/app/useHostIntegration.test.ts \
  apps/artist/src/App.messages.test.tsx
git commit -m "$(cat <<'EOF'
feat(artist): the ?loadVideo= handoff places the take it was handed (ESCSUITE-14)

The id names a take's primary part, so the handoff now resolves the take's
siblings by takeId, adds every part to the media library and places them on the
timeline: the primary on a video track, the webcam on a track above it at its
startOffset with its transform seeded from the placement it was recorded at, in
one undo step.

This is a behaviour change for a single-file take too (decision 7) — a handoff
used to leave the timeline empty and the user to drag the recording onto it. The
two library paths that are *not* take handoffs are unchanged and pinned as such:
LOAD_VIDEO and ?video= fetch a file from a URL, address no stored take, and
place nothing.

App gains no store selector: the action is reached through getState(), the way
clearHistory() already is, so App.rerender.test.tsx's contract is untouched and
App.tsx is not edited at all.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 6: End to end — a real two-part take in a real browser

**Files:**
- Create: `apps/e2e/tests/escapeartist/take-import.spec.ts`

**Interfaces:**
- Consumes: `ARTIST_URL` from `apps/e2e/utils/artist.ts`; the running dev servers `playwright.config.ts` already starts.
- Produces: nothing other code imports.

**Where this test lives, and why not in `tests/production/`.** The production-layout suite exists because CRAFT and ARTIST need **one origin** to share `video-editor-db`, and it costs a full `pnpm build:deploy` plus `serve-dist.mjs`. Nothing here needs CRAFT: the take is seeded into the database directly, and ARTIST reads it from its own origin. The dev-server suite is where it belongs — it runs on every `pnpm --filter @escapesuite/e2e test`, it gets Firefox and WebKit for free locally, and nothing about it depends on the production rewrites. `tests/production/indexeddb-sharing.spec.ts` already pins the cross-origin half that this would otherwise be duplicating.

- [ ] **Step 1: Write the failing e2e** — create `apps/e2e/tests/escapeartist/take-import.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL } from '../../utils/artist'

/**
 * A take recorded as separate tracks, handed to ESCAPEARTIST (ESCSUITE-14
 * slice 2).
 *
 * The take is seeded straight into the shared database rather than recorded,
 * because what is under test is the *import*: the id names the take's primary
 * part, and ESCAPEARTIST has to find its webcam half, add both to the media
 * library and place them on two tracks with the webcam's transform seeded from
 * the placement it was recorded at. Recording one for real is CRAFT's own e2e
 * (`tests/escapecraft/separate-tracks.spec.ts`).
 *
 * jsdom cannot hold any of this: there is no layout, so the inspector's
 * percentages are the only place the transform is visible as a user sees it.
 */

const DB_NAME = 'video-editor-db'
const TAKE_ID = 'e2e-take-primary'
const WEBCAM_ID = 'e2e-take-webcam'

/** The two records ESCAPECRAFT's save path writes for a separate-tracks take. */
const TAKE_PARTS = [
  {
    id: TAKE_ID,
    name: 'Handoff take',
    duration: 6,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 2048,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_000,
    hasAudio: true,
    hasWebcam: true,
    takeId: TAKE_ID,
    role: 'screen',
    startOffset: 0,
    overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
  },
  {
    id: WEBCAM_ID,
    name: 'Handoff take — webcam',
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_700_000_000_001,
    hasAudio: false,
    hasWebcam: true,
    takeId: TAKE_ID,
    role: 'webcam',
    startOffset: 0.5,
  },
]

/** Put the take's parts into the shared database, blobs and all. */
async function seedTake(page: Page) {
  await page.evaluate(
    ({ dbName, parts }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('videos', 'readwrite')
          const store = tx.objectStore('videos')
          for (const metadata of parts) {
            store.put({
              id: metadata.id,
              blob: new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'video/webm' }),
              metadata,
            })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    { dbName: DB_NAME, parts: TAKE_PARTS }
  )
}

/** The value beside one of the inspector's transform sliders, e.g. "88%". */
async function transformValue(page: Page, label: string): Promise<string> {
  const row = page
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
  return (await row.locator('span').last().innerText()).trim()
}

test.describe('ESCAPEARTIST imports a multi-part take', () => {
  test.beforeEach(async ({ page }) => {
    // The app creates the database on mount (it looks for a saved session), so
    // it has to load once before the seed can open it without a version.
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
    await seedTake(page)
  })

  test('places both parts on two tracks with the webcam above the screen', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)

    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    const clips = page.locator('[data-clip-id]')
    await expect(clips).toHaveCount(2)
    // Tracks render highest index first, so the first clip in the DOM is the
    // one on top — the webcam, which is what "on a track above it" means on
    // screen.
    await expect(clips.first()).toContainText('Handoff take — webcam')
    await expect(clips.last()).toContainText('Handoff take')
  })

  test('seeds the webcam clip with the corner it was recorded in', async ({ page }) => {
    await page.goto(`${ARTIST_URL}?loadVideo=${TAKE_ID}&suppressRestore=1`)
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-clip-id]').filter({ hasText: '— webcam' }).click()

    // 1920 x 0.2 = 384 wide, 16:9 so 216 high, inset 1920 x 20/1280 = 30px from
    // the bottom-right corner: centred at 1698/1920 = 88% across and
    // 942/1080 = 87% down, drawn at 384/1280 = 30% of the camera's own pixels.
    await expect(page.getByText('00:00.500')).toBeVisible()
    expect(await transformValue(page, 'Pos X')).toBe('88%')
    expect(await transformValue(page, 'Pos Y')).toBe('87%')
    expect(await transformValue(page, 'Scale')).toBe('30%')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapeartist/take-import.spec.ts --project=chromium`
Expected: FAIL on the first test — `expect(locator).toBeVisible() failed … waiting for getByText(/^2 clips · 2 tracks$/)` — if this is run against a working tree that does not yet have Tasks 1–5. Against a tree that does, it passes; run it once at this commit either way and record which.

- [ ] **Step 3: Run it for real, in all three browsers**

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapeartist/take-import.spec.ts`
Expected: PASS in chromium, and locally also firefox and webkit (CI runs chromium only).

If the inspector is not visible at the default 1280×720 viewport, the cause is the responsive breakpoint at 900px, not the placement — the default viewport is above it, so a failure here means the sidebar was collapsed by something else; do not widen the viewport to paper over it.

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no output, exit 0.

- [ ] **Step 4: Check the neighbours still pass**

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapeartist tests/integration --project=chromium`
Expected: PASS — `tests/integration/craft-to-artist.spec.ts` and `host-embedding.spec.ts` included.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/tests/escapeartist/take-import.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): a two-part take handed to ESCAPEARTIST lands on two tracks

Seeds a separate-tracks take into the shared IndexedDB — the two records
CRAFT's save path writes — opens ARTIST with ?loadVideo=<primary>, and asserts
what the user sees: two clips on two tracks with the webcam above the screen,
half a second in, and its transform seeded into the bottom-right corner at 88%
/ 87% / 30% — the corner and size the take was recorded at.

Lives in the dev-server suite rather than tests/production/: nothing here needs
CRAFT, so nothing here needs the one-origin production build. The percentages
are the only place the transform is visible as a user sees it, and jsdom has no
layout to show them in.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 7: Docs, the changeset, and the coverage measurement

**Files:**
- Modify: `apps/artist/CLAUDE.md` (the Integration API section's URL-params table, and a new subsection after it; the `src/app/` module table)
- Modify: `CLAUDE.md` (the URL-params bullet of "Integration API")
- Modify: `apps/artist/src/utils/integration.ts` (the protocol comment at the bottom)
- Create: `.changeset/artist-take-import.md`
- Modify (only if a floor rises): `apps/artist/vite.config.ts`, `scripts/coverage-report.mjs`, `CLAUDE.md` coverage table

- [ ] **Step 1: `apps/artist/CLAUDE.md` — the URL parameter and the new subsection**

In the "URL parameters" table, replace the `?loadVideo=<id>` row:

```markdown
| `?loadVideo=<id>` | Load a **take** from IndexedDB (ESCAPECRAFT handoff). The id names the take's primary part; every part of it joins the media library and is placed on the timeline — see "A handed-over take is several files" below |
```

Add this subsection immediately after the URL-parameter table:

```markdown
#### A handed-over take is several files

`?loadVideo=<id>` names a take's **primary** part. Since ESCSUITE-14 a take recorded with
ESCAPECRAFT's "Record webcam as a separate track" is several `SourceVideo`s sharing a
`takeId` (see the root `CLAUDE.md`'s Data Flow), so the handoff resolves the take before it
does anything with it — `app/takeImport.ts` reads `getAllVideoMetadata()` and keeps the parts
whose `takeId` is the primary's id, which is the same one equality ESCAPECRAFT groups its
library rows by (`apps/craft/src/utils/takeOrder.ts`). A take with **no** `takeId` — every
recording made before ESCSUITE-14 and every composited PiP take after it — costs no second
storage read at all.

**Every handoff now places clips** (spec decision 7), a single-file take included. It used to
add the recording to the library and leave the timeline empty for the user to drag it onto.
The primary lands on the track a drop from the media library would take, each companion on a
new track **above** the one before it in role order (`screen`, `webcam`, `mic`, `system` —
slice 3's audio parts need no change here), each at `position = startOffset`, and the whole
take is **one undo step**: `store/clipSlice.ts`'s `placeTakeOnTimeline` writes every track and
every clip in a single `set` with a single `pushToHistory`, so one Ctrl+Z takes the take off
the timeline and leaves its media in the library. Positions are measured from
`calculateTimelineDuration(existing clips)`, so a handoff into a session that already holds
work **appends at the end** rather than landing on top of it; an empty timeline measures 0, so
the ordinary import still starts there and there is no special case for it.

**The webcam clip's transform is seeded from the take's `overlayPlacement`** (decision 8), so
the import looks like what the user saw while recording and stays editable — which is the
whole point of the separate track. `utils/overlayPlacement.ts` owns the conversion and is
pinned against `Compositor.drawWebcamOverlay`'s own numbers, with two deliberate differences.
The corner inset is `20 / 1280` of the **frame width**, not a flat 20 px: the compositor pads
by 20 px on a canvas capped at 1280 px wide, so the pixel count would put the overlay four
times closer to the edge on a 4K project than it looked. And the aspect is the **camera's**,
not the compositor's hard-coded 16:9 box, which stretches a 4:3 picture — the width, which is
the size the user chose, is the compositor's exactly. `x`/`y` are the clip's centre as a
fraction of the canvas and the scale is the drawn width over the part's native width, because
that is how `core/canvasRenderer.ts` reads them: **scale 1 means native pixels**. The
placement's `shape` is read and **ignored** until ESCSUITE-65 gives every clip a mask.

Three things the import refuses to do, each chosen rather than defaulted:

- **A part whose blob is gone is skipped and counted**, never fatal — storage cleared between
  the two writes, or a companion deleted by hand. The toast says
  `Loaded recording: <name> — 1 missing part skipped` (`'info'`) *instead of* the success
  sentence, because `useNotification` is one slot on a three-second timer and two messages
  mean the first is never read. A companion whose own length cannot be read borrows the take's
  instead of being left off, because every part of a take is the same length by construction.
- **A part with a role this build does not know joins the library and nothing else.**
  IndexedDB is not type-checked; a record written by a newer ESCAPECRAFT is visible and
  deletable rather than placed somewhere arbitrary.
- **A take already in the library is skipped whole** — no re-add, no second placement, no
  notice. That guard predates this work and is what keeps a re-mount or a host re-navigating
  the same id from placing the take twice.

`LOAD_VIDEO` and `?video=` are **not** take handoffs: they fetch a file from a URL, address no
stored take, and still only add to the library. Both are pinned as placing nothing.

**One interaction worth knowing**: ESCAPECRAFT's standalone "Send to Editor" opens
`/artist/?loadVideo=<id>` with no `?suppressRestore=1`, so a user with a saved session can be
offered "Resume Previous Session?" *after* the take has been placed — and restoring replaces
the project, so the placed clips go while the media stays in the library (`setProject` plus a
per-video `addSourceVideo`). That is the pre-existing shape of session restore, newly visible
now that a handoff puts something on the timeline. A host that drives its own state should
pass `?suppressRestore=1`, which switches the prompt and the autosave off together.
```

In the `src/app/` module table, add a row after `useHostIntegration.ts`:

```markdown
| `takeImport.ts` | The storage half of the `?loadVideo=` handoff: resolve the take's parts, read each one's blob and thumbnail, add it to the library with a resolved duration, and return the parts to place. Lives beside the hook rather than inside it because the hook's effect is already the app's longest and these are the arms worth testing on their own |
```

and extend the `appFormat.ts` row's text to `…and `takeLoadedMessage`, the handoff's one sentence, which folds "how many tracks" and "what was missing" into the single toast slot`.

- [ ] **Step 2: Root `CLAUDE.md` — make the slice-2 sentence true**

Replace the `?loadVideo=<id>` clause of the "URL params (ARTIST)" bullet (which currently reads "… ARTIST resolving its siblings and placing them on the timeline is ESCSUITE-14 slice 2 —") with:

```markdown
  `?loadVideo=<id>` for the CRAFT handoff — the id addresses a take's **primary** part, and
  ARTIST resolves its siblings by `takeId`, adds every part to the media library and places
  them on the timeline in one undo step: the primary on a video track, the webcam on a track
  above it at its `startOffset` with its transform seeded from the primary's
  `overlayPlacement`, and the audio parts on tracks of their own. Placement happens for
  **every** handoff, a single-file take included (ESCSUITE-14 decision 7); a handoff into a
  session that already holds clips appends at the end of the timeline —
```

- [ ] **Step 3: The protocol comment**

In `apps/artist/src/utils/integration.ts`, replace the `loadVideo=<id>` line of the URL-parameters block at the bottom of the file:

```
 * - loadVideo=<id> - Load a take from IndexedDB (ESCAPECRAFT handoff). The id
 *   addresses a take's *primary* part. Since ESCSUITE-14 a take can be several
 *   records sharing a `takeId` (the primary's takeId is its own id), so the
 *   editor resolves the siblings itself, adds every part to the media library
 *   and places them on the timeline in one undo step - the primary on a video
 *   track, the webcam on a track above it at its startOffset with its transform
 *   seeded from the primary's overlayPlacement, mic and system parts on tracks
 *   of their own. Placement happens for every handoff, a single-file take
 *   included; a handoff into a session that already holds clips appends at the
 *   end of the timeline. A part whose blob is missing is skipped with a notice
 *   and never costs the take its primary. Unlike LOAD_VIDEO and ?video=, which
 *   fetch a file into the library and place nothing.
```

- [ ] **Step 4: The changeset**

Create `.changeset/artist-take-import.md`:

```markdown
---
'@escapesuite/artist': minor
---

A recording sent from ESCAPECRAFT now lands **on the timeline**, not just in the media
library — and a recording made with "Record webcam as a separate track" arrives as the two
clips it really is, the screen and the camera, on two tracks.

**This changes what a single-file handoff does too.** "Send to Editor" used to add the
recording to the media library and leave the timeline empty for you to drag it onto; it now
places it for you. The whole take is one undo step, so a single Ctrl+Z takes it back off the
timeline and leaves the media in your library. A handoff into an editor that already holds
work **appends at the end** of the timeline rather than landing on top of it.

For a take recorded as separate tracks, the webcam clip arrives in the corner and at the size
it was recorded in — and, unlike the composited recording, you can now move it, resize it,
animate it or delete it. Its rounded/circular *shape* is not carried over yet; that is
coming with the clip mask that will apply to every clip, not only this one.

If a part of a take is missing from storage — cleared, or deleted by hand — the rest still
arrives and the editor says one part was skipped. A part recorded by a newer ESCAPECRAFT than
this editor knows about is added to your media library, where you can see and delete it,
rather than placed somewhere arbitrary.

Loading media from a URL (`?video=` and the host's `LOAD_VIDEO` message) is unchanged: those
still add to the library and place nothing.
```

- [ ] **Step 5: Measure coverage and move the floors only if they rose**

Run: `pnpm --filter @escapesuite/artist test:coverage`
Expected: PASS with no threshold error.

Run: `pnpm coverage:report`
Expected: a table; read artist's four `actual% / threshold%` pairs. The baseline is **99.37 / 98.70 / 93.38 / 98.94** against floors **99 / 98 / 93 / 98**.

If a figure has crossed a whole percent (the likely one is branches, which sits at 93.38 with the nearest floor at 94), update all three places in one commit: `thresholds` in `apps/artist/vite.config.ts`, artist's entry in `scripts/coverage-report.mjs`, and the root `CLAUDE.md` coverage table *plus* one sentence in the "Where it stands" paragraph naming this work and the date, in the same voice as the entries already there — e.g. "`@escapesuite/artist` was re-measured 2026-09-25 at the end of ESCSUITE-14 slice 2 (the handoff resolving a take's parts and placing them): …". If a figure is *below* a floor, add the missing test rather than touching the floor; the branches most likely to be short are `overlayPlacement`'s `hasSize` fallback, `takeParts`' NaN comparator arm, `takeImport`'s missing-blob and unknown-role `continue`s, and `placeTakeOnTimeline`'s empty-list and no-empty-track arms — every one of them has a test in Tasks 1–4, so a gap means a test is not reaching it.

- [ ] **Step 6: Full verification before the last commit**

Run each and confirm the stated result:

- `pnpm --filter @escapesuite/artist test:run` → PASS
- `pnpm --filter @escapesuite/artist typecheck` → exit 0, no output
- `pnpm --filter @escapesuite/artist lint` → exit 0
- `pnpm --filter @escapesuite/artist test:coverage` → PASS
- `pnpm --filter @escapesuite/shared test:run` → PASS (nothing here touches it; this proves it)
- `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint` → exit 0
- `pnpm --filter @escapesuite/e2e exec playwright test tests/escapeartist tests/integration --project=chromium` → all pass

- [ ] **Step 7: Commit**

```bash
git add apps/artist/CLAUDE.md CLAUDE.md apps/artist/src/utils/integration.ts \
  .changeset/artist-take-import.md apps/artist/vite.config.ts scripts/coverage-report.mjs
git commit -m "$(cat <<'EOF'
docs(artist): the handoff resolves a take and places it (ESCSUITE-14 slice 2)

apps/artist/CLAUDE.md gains "A handed-over take is several files": the takeId
resolution, the track stack and the append-at-end rule, the one undo step, the
transform seeding and its two deliberate differences from the live compositor
(the inset is a fraction of the frame, the aspect is the camera's), the three
things the import refuses to do, and the session-restore interaction a handoff
without ?suppressRestore=1 can still meet.

The root CLAUDE.md's "placing them on the timeline is ESCSUITE-14 slice 2" is
now a description of what happens rather than a promise, and integration.ts's
protocol comment says the same to an embedder — including that LOAD_VIDEO and
?video= are not take handoffs and still place nothing.

The changeset names the behaviour change for single-file handoffs first,
because that is the one every existing user will notice.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage.** Decision 7 — "the `?loadVideo=` handoff places clips on the timeline, for every take, not only companion takes: the primary at position 0 on a video track, the webcam on a track above it at its `startOffset`, the mic and system parts on audio tracks" → Task 3 (the action, the track stack, the positions), Task 4 (role handling, including `mic`/`system` ranked and placeable now so slice 3 needs no ARTIST change), Task 5 (the wiring and the single-take case). "This is a behaviour change for single-take imports too and is named in ARTIST's changeset and the integration docs" → Task 7, Steps 1, 2 and 4, each naming it explicitly. Decision 8 — "the webcam clip carries the PiP position and size as transform defaults … the **shape** is deferred to ESCSUITE-65" → Task 1, whose helper ignores `shape` and says so in the code, the test and the docs. The "Consequences" bullet — "`useHostIntegration` resolves siblings by `takeId` from the shared DB, adds every part with `addSourceVideo`, then places clips with explicit `trackId` and `position = startOffset`" → Tasks 4 and 5; the explicit `trackId`/`position` requirement is satisfied by `placeTakeOnTimeline` computing both rather than by passing them to `addClipToTimeline`, and Task 3's first test pins that the resulting clip is field-for-field the one `addClipToTimeline` builds, which is the property that requirement exists to protect. The slice-2 estimate row's "integration docs" → Task 7. The brief's robustness clauses — missing blob skipped with a notice, unknown role added but not placed — are Task 4's fourth and sixth tests and Task 5's fourth. Session/undo hygiene → Task 3 (one undo step, append-at-end) and Task 7's documented `?suppressRestore=1` interaction; nothing in this plan touches `useSessionRestore` or `useSessionAutosave`, which is what "unchanged" means. Out-of-scope items appear nowhere except as named exclusions.

**2. Placeholder scan.** No "TBD", no "add error handling", no "write tests for the above", no "similar to Task N". Every notice string (`Loaded recording: <name>`, `… (<n> tracks)`, `… — <n> missing part(s) skipped`, `Recording not found`, `Failed to load recording`), every constant (`OVERLAY_MARGIN_FRACTION = 20 / 1280`, `ROLE_ORDER`), every e2e assertion (`2 clips · 2 tracks`, `00:00.500`, `88%`, `87%`, `30%`) is written out and asserted somewhere. The only values not fixed in advance are the four coverage figures in Task 7 Step 5, which is why that step names the command that produces them, the baseline they are compared against, and the three files to change if one crosses a percent.

**3. Type consistency.** `TakeClipPart` is declared once in Task 3 (`src/store/types.ts`) with fields `sourceVideoId`, `name`, `duration`, `startOffset`, `width`, `height`, `overlayPlacement?`, and is built with exactly those names in Task 4's `importTake` and consumed with exactly those names in Task 3's action and tests. `PixelSize { width, height }` is Task 1's, and `TakeClipPart` structurally satisfies it, which is why `overlayPlacementToTransform(..., part)` compiles at the action's call site. `overlayPlacementToTransform(placement, projectResolution, partSize)` has the same three-argument order in its definition (Task 1), in the action (Task 3) and in the store test's expectation (Task 3, Step 1). `orderTakeParts(primary, all)`, `partRoleRank(role)` and `isPlaceableRole(role)` are named identically in Task 2's module, its test and Task 4's importer. `ImportedTake { clipParts, thumbnailUrls, missingParts }` is defined in Task 4 and destructured under those three names in Task 5's hook. `takeLoadedMessage(name, placed, missing)` has the same signature in Task 4's implementation, its test and Task 5's call. `placeTakeOnTimeline` is the one name used in `EditorState`, `ClipSlice`'s `Pick`, the action, the store test and the hook. `HostIntegrationDeps` is unchanged, which is why `App.tsx` appears in no task's file list.
