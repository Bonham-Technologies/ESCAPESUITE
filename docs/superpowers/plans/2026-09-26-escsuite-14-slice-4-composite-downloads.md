# ESCSUITE-14 slice 4 — composite MP4, mixed M4A, and `UPLOAD_RECORDING.parts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the last slice of ESCSUITE-14 — "Download as MP4" on the primary row of a separate-tracks take produces **one** MP4 whose picture is the screen with the webcam drawn back into the corner it was recorded in, `UPLOAD_RECORDING` grows an optional `parts` array listing every part of a take in one message, and the interim "the webcam track is not included yet" note is retired because it is no longer true.

**Architecture:** The overlay geometry the live compositor draws 30 times a second is lifted, unchanged, into a pure `drawOverlay()` in a new `core/overlayGeometry.ts`; `Compositor.drawFrame` then *calls* it, so the offline composite and the live preview cannot drift apart. `convertToMP4` grows a fourth optional argument carrying the camera part: a second `<video>`, started alongside the first, whose current frame is drawn through `drawOverlay` into the capture canvas the converter already encodes from — so the plain path's per-frame work is byte-identical and the composite's is exactly one more `drawImage` plus the clip. The MP4's audio is the primary's own track, because the primary *is* the mix (`webcodecs-recorder.ts` taps the mic and system tracks a second time rather than diverting them), which is why **M4A is unchanged in bytes**. `useMp4Download` resolves the camera part out of storage before it converts and says, through the app's one notice channel, when the file it wrote is the screen alone. `uploadToHost` reads every part of the take out of storage when the row it was given *is* the take, and adds them as `payload.parts` beside the unchanged `payload.blob`.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand, WebCodecs (`VideoEncoder`, `AudioEncoder`, `VideoFrame`), Mediabunny (`Mp4OutputFormat`, `EncodedVideoPacketSource`), Canvas 2D, shared IndexedDB (`video-editor-db`, `DB_VERSION` stays 1), Vitest + Testing Library (jsdom) with `src/test/doubles/*`, Playwright (Chromium) for e2e and benchmarks.

**Spec:** `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md` — **decision 3** (MP4 and M4A include the webcam; MP4 on a companion take is a re-composite through the take's stored `RecordingConfig` geometry; the screen-only MP4 is not offered as a separate thing — a user who wants a part alone downloads its WebM from its row), **decision 4** (`UPLOAD_RECORDING` grows an optional `parts` array, the existing fields unchanged, with an adoption note in four places and an ESCAPEPOD row), the **"Converter"** bullet under "Consequences the decisions fix in the design" (two `<video>` elements started together, a pure `drawOverlay` shared with the compositor and pinned by one test, per-frame ceilings measured and set at 2×), the **"Downloads"** bullet under §5, and the **slice-4 row** of "Estimate, revised for the decisions" (3–4 PR-days). Read it before Task 1; every design choice below is argued from it.

**What slices 1–3 already shipped, and that this slice consumes rather than builds:** `SourceVideo.takeId` / `role` / `startOffset` / `overlayPlacement` / `hasWebcam` (`packages/shared/src/types/index.ts`); the primary's `takeId` is its own id; a separate-tracks take is up to four stored parts and up to four library rows, ordered by `utils/takeOrder.ts`; the **mixed audio stays on the primary output** (`core/webcodecs-recorder.ts`, `AudioCompanionPipeline`'s doc comment says so in as many words: "a *second* tap on a track the mix is already reading … the composite (slice 4) still has the mix to draw on"); `utils/companionParts.ts` owns the per-role words; `uploadToHost(id, name, part?)` already posts `role` and `takeId` per row; `Compositor.startPreviewOnly()` exists.

**Out of scope — do not build any of it here:**
- Any ARTIST change at all. ARTIST is untouched by this slice; the one file this slice edits under `apps/artist/` is the protocol **comment** at the bottom of `apps/artist/src/utils/integration.ts`.
- ESCSUITE-65 (a shape/mask option on every ARTIST clip). The composite reproduces the circle/rounded-rect *here*, in CRAFT, by clipping — which is what the live compositor does and is unrelated to the ARTIST feature.
- ESCSUITE-66 / 67 / 68 / 69 / 70 hygiene follow-ups.
- `remuxToWebM` / `isWebMRemuxSupported`. They stay unwired. `captureFramesViaPlayback` is shared with `remuxToWebM`, which passes **no** overlay and must come out behaviourally unchanged; its own tests are the proof.
- A per-part MP4 or M4A button. Conversions stay on the primary row only.
- Removing the companion rows' "Upload to host" button (Task 5 argues for keeping it).

---

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure quoted in the step notes or the commit body, before the implementation step. The steps below are ordered that way; do not reorder them.
2. **Task 1 is a pure move plus two new pure helpers.** At Task 1's commit, **no existing test file may have changed**. Check it:
   `git diff --stat HEAD~1 -- 'apps/craft/src/**/*.test.ts' 'apps/craft/src/**/*.test.tsx' | grep -v overlayGeometry.test.ts` must print nothing.
3. **No existing test may be deleted or weakened.** These suites stay green and byte-unchanged:
   `src/App.rerender.test.tsx`, `src/App.mp4rerender.test.tsx`, `src/core/compositor.test.ts`, `src/core/compositor.perf.test.ts`, `src/core/recorder.perf.test.ts`, `src/core/webcodecsRecorder.perf.test.ts`, `src/utils/takeOrder.test.ts`, `src/utils/companionParts.test.ts`, `apps/e2e/tests/escapecraft/pip-seekable.spec.ts`, `apps/e2e/tests/production/pip-seekable.spec.ts`, and the `craft-screen-recording` / `craft-pip-recording` / `craft-separate-tracks-recording` / `craft-mp4-conversion` tripwires in `apps/e2e/utils/craftPerf.ts`.
   **The existing ceilings in `src/core/converter.perf.test.ts` are byte-identical.** Task 2 appends a new `describe` block and touches nothing above it.
   Six existing test files gain *inputs* (never looser assertions), and each change is named in the task that makes it:
   - `src/core/converter.test.ts` (Task 2: one new `describe`, one new local helper; nothing above it changes)
   - `src/core/converter.perf.test.ts` (Task 2: one new `describe` appended)
   - `src/hooks/useMp4Download.test.ts` (Task 3: one new `describe`)
   - `src/components/RecordingsList/RecordingsList.test.tsx` (Task 4: four tests **converted** to "no note" assertions — argued in Task 4)
   - `src/utils/uploadToHost.test.ts` (Task 5: one new `describe`)
   - `src/components/RecordingsList/RecordingsListPanel.test.tsx` (Task 5: one new test)
   - `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` (Task 4: one assertion flips from `toHaveCount(1)` to `toHaveCount(0)`; Task 6: a setup helper is extracted with its assertions unchanged, and a second test is added)
   - `apps/e2e/tests/integration/host-embedding.spec.ts` (Task 6: one new test, two new helpers, one widened captured-message shape)
4. **The one deliberate copy deletion is `SEPARATE_TRACKS_MP4_NOTE`.** It is retired, not softened — see Task 4's argument. Its four tests are **converted to "no note" assertions** rather than deleted, so the code path that used to render it stays pinned as absent.
5. **Coverage floors only go up, and craft's lines floor is 100.00 with zero headroom** — every new line must execute in a test. This branch starts from craft **100 / 99 / 97 / 99** (measured 100.00 / 99.39 / 97.36 / 99.52 at the head of slice 3). Finish with `pnpm --filter @escapesuite/craft test:coverage`; if a figure rises past a whole percent, raise the floor in **both** `apps/craft/vite.config.ts` and `scripts/coverage-report.mjs`, and update the root `CLAUDE.md` coverage table and its narrative. Never lower one.
6. **Per-frame ceilings:** conservation laws exact (`VideoFrame`s created == closed == encoded; one `drawImage` of the screen per encoded frame; one `drawImage` of the camera per encoded frame; `save` count == `restore` count; one `flush`); every other count is 2× the measured value rounded up, with the measured value and the date in a comment beside it. **The plain path's existing ceilings do not move.**
7. **`App.rerender.test.tsx` / `App.mp4rerender.test.tsx` contracts:** no new `App`-level store selector, and no new store field. Everything this slice adds is read from storage inside `useMp4Download` (which `RecordingsListPanel` calls) or from storage inside `utils/uploadToHost.ts`. `App` gains nothing.
8. **New modules go in `src/utils` or `src/core`** — never into a module some suite `vi.mock`s wholesale. `src/core/thumbnailGenerator.ts` and `src/core/converter.ts` are mocked wholesale by five suites. `core/overlayGeometry.ts` is new and is **not** mocked anywhere, which is what lets `compositor.test.ts` keep exercising the real geometry; `utils/takeParts.ts` is new and must stay unmocked for the same reason.
9. **Type-only declarations go in `src/store/types.ts`** (craft) or `packages/shared/src/types/index.ts` (shared). Both are excluded from craft's coverage `include`. **This slice adds no new shared type and does not touch `packages/shared`** — `OverlayPlacement` is already exactly what the composite needs.
10. **`DB_VERSION` stays 1** and nothing new is written to storage. Every read this slice adds is a read.
11. **Copy is pinned by tests.** Every user-visible string below is exact; do not paraphrase it in code or in tests. New copy in this slice, in full:
    - `'Loading the webcam track…'` — the converter's one new progress message (note the single-character ellipsis, matching `convertToM4A`'s `'Extracting audio…'`).
    - `MP4_SAVED_WITHOUT_WEBCAM` = `'Saved as MP4 — without the webcam: its own track could not be read'` (em dash; no trailing full stop, matching `MP4_SAVED_WITHOUT_AUDIO`).
    Unchanged and **not** to be reworded: `'Download MP4'`, `'Download audio only (M4A)'`, `Download ${name} as MP4`, `Download ${name} as audio (M4A)`, `MP4_BUSY_REASON`, `MP4_CHECKING_REASON`, `MP4_UNSUPPORTED_REASON`, `NO_AUDIO_TRACK_REASON`, `MP4_SAVED_WITHOUT_AUDIO`, `mp4ConversionFailed`, the `Webcam track • ` / `Microphone track • ` / `System audio track • ` prefixes, `Record webcam as a separate track`.
    Deleted: `SEPARATE_TRACKS_MP4_NOTE`.
12. **Typecheck and lint every task:** `pnpm --filter @escapesuite/craft typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/craft lint`; for e2e work `pnpm --filter @escapesuite/e2e typecheck` and `pnpm --filter @escapesuite/e2e lint`.
13. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

14. Branch `feat/escsuite-14-slice-4`, off `main` once slice 3 has merged (off `feat/escsuite-14-slice-3` if it has not). No push and no PR unless asked.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/craft/src/core/overlayGeometry.ts` | The webcam overlay's geometry and the one function that draws it: `drawOverlay()` (moved verbatim out of `Compositor.drawWebcamOverlay`), `overlayGeometryFor()` and `overlayPaddingFor()`, plus `COMPOSITOR_MAX_WIDTH` and `DEFAULT_OVERLAY_PADDING`. Pure — no element lookup, no canvas creation, no state. The live compositor and the offline composite both go through it, which is what makes "they cannot drift" a property rather than a promise |
| `apps/craft/src/core/overlayGeometry.test.ts` | The geometry pinned at the numbers `compositor.test.ts` already pins, plus the padding rule and the `OverlayPlacement` → `OverlayGeometry` mapping |
| `apps/craft/src/utils/takeParts.ts` | Reading a take's parts back out of storage: `loadWebcamCompanion()` (the camera half, ready for the converter, with `'none'` and `'unavailable'` told apart) and `loadTakeParts()` (every part with its bytes, primary first, for `UPLOAD_RECORDING.parts`) |
| `apps/craft/src/utils/takeParts.test.ts` | Both lookups over real `fake-indexeddb`: a plain take, a full take, a deleted camera row, a camera row whose bytes are gone, a part that will not read |
| `.changeset/craft-composite-downloads.md` | `@escapesuite/craft`: minor — the composite MP4, `payload.parts` with its adoption note, the retired interim note |

**Modified**

| File | Change |
|---|---|
| `apps/craft/src/core/compositor.ts` | `CompositorConfig` becomes an alias of `OverlayGeometry`; `drawFrame` calls `drawOverlay`; `drawWebcamOverlay` is deleted; the two magic numbers become the new module's constants. **No behaviour change** |
| `apps/craft/src/utils/companionParts.ts` | `COMPANION_ROLE_ORDER` and `companionRank` move here from `takeOrder.ts` and are exported. **No behaviour change** |
| `apps/craft/src/utils/takeOrder.ts` | Imports the two it used to declare. **No behaviour change** |
| `apps/craft/src/core/converter.ts` | `CompositeCompanion` / `CompositeOptions`; a fourth optional argument to `convertToMP4`; a second `<video>` with its own metadata load and its own failure fallback; an `overlay` parameter on `captureFramesViaPlayback` |
| `apps/craft/src/core/converter.test.ts` | One new `describe` for the composite path, with its own `startComposite` helper |
| `apps/craft/src/core/converter.perf.test.ts` | One new `describe` for the composite path's ceilings, appended |
| `apps/craft/src/utils/notices.ts` | `MP4_SAVED_WITHOUT_WEBCAM` |
| `apps/craft/src/hooks/useMp4Download.ts` | `getVideo` instead of `getVideoBlob`; the companion lookup for `'mp4'`; the composite hand-off; the screen-only notice and its precedence |
| `apps/craft/src/hooks/useMp4Download.test.ts` | One new `describe` |
| `apps/craft/src/components/RecordingsList/RecordingsList.tsx` | `SEPARATE_TRACKS_MP4_NOTE`, `separateTracksNoteId`, `takesWithCompanion`, `hasCompanion` and `noteId` deleted; `aria-describedby` back to the app-wide note alone |
| `apps/craft/src/components/RecordingsList/RecordingsList.test.tsx` | Four tests converted from "the note is there" to "there is no note" |
| `apps/craft/src/utils/uploadToHost.ts` | `payload.parts`, built by `loadTakeParts` when the row *is* the take |
| `apps/craft/src/utils/uploadToHost.test.ts` | One new `describe` |
| `apps/craft/src/components/RecordingsList/RecordingsListPanel.test.tsx` | One new test: the primary row names its own take, which is what reaches the `parts` path |
| `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` | The note assertion flips to `toHaveCount(0)`; the recording steps become a helper; a second test converts the take to a composite MP4 and decodes it |
| `apps/e2e/tests/integration/host-embedding.spec.ts` | `seedCraftTake`, `clearHostMessages`, `CapturedMessage.parts`, and one new test |
| `apps/e2e/utils/craftPerf.ts` | `recordSeparateTracksTake()`; `measureMp4Conversion` takes an options object and reports `videoDraws`; the composite tripwire |
| `apps/e2e/tests/perf/craft-recording.spec.ts` | The `craft-composite-mp4-conversion` arm |
| `apps/e2e/scripts/perf-report.mjs` | `ORDER`, `PROFILE_LABELS`, `PROFILE_ORDER` |
| `docs/performance/2026-09-17-craft-baseline.md` | The fifth benchmark, its tripwires and its first numbers |
| `apps/craft/CLAUDE.md`, `CLAUDE.md`, `apps/artist/src/utils/integration.ts` | Download Formats, "A take can be several files", the module table, the Integration API and the protocol comment — all with the `parts` adoption note |
| `apps/craft/vite.config.ts`, `scripts/coverage-report.mjs` | Coverage floors, if a figure crossed a whole percent |

---

### Task 1: `drawOverlay` out of the compositor (PURE MOVE + two pure helpers)

**Files:**
- Create: `apps/craft/src/core/overlayGeometry.ts`
- Create: `apps/craft/src/core/overlayGeometry.test.ts`
- Modify: `apps/craft/src/core/compositor.ts:1-11`, `:40-68`, `:215-344`
- Modify: `apps/craft/src/utils/companionParts.ts` (append)
- Modify: `apps/craft/src/utils/takeOrder.ts:1-24`

**Interfaces:**
- Produces: `COMPOSITOR_MAX_WIDTH = 1280`; `DEFAULT_OVERLAY_PADDING = 20`;
  `interface OverlayGeometry { webcamPosition: WebcamPosition; webcamSize: number; webcamShape: WebcamShape; padding: number }`;
  `overlayPaddingFor(frameWidth: number): number`;
  `overlayGeometryFor(placement: OverlayPlacement, frameWidth: number): OverlayGeometry`;
  `drawOverlay(ctx: CanvasRenderingContext2D, webcam: HTMLVideoElement, frame: { readonly width: number; readonly height: number }, geometry: OverlayGeometry): void`.
- Produces: `type CompositorConfig = OverlayGeometry` (still exported from `core/compositor.ts`, where its only user is that file).
- Produces: `COMPANION_ROLE_ORDER: readonly string[]` and `companionRank(role: string | undefined): number`, exported from `utils/companionParts.ts`.
- Consumes: `WebcamPosition` / `WebcamShape` from `../store/types`; `OverlayPlacement` from `@escapesuite/shared/types`.

**Three decisions this task pins, all three argued in the commit message:**

- **Only the overlay moves — not the screen draw, and not the black fill.** The spec's Converter bullet sketches `drawOverlay(ctx, screen, webcam, placement)`. What can actually drift between the live compositor and the offline composite is the **geometry**: the 16:9 derivation, the four corners, the circle's radius and centre, the centre-crop, the two clip paths and the border. The screen draw is one `ctx.drawImage(video, 0, 0, w, h)` with nothing to get wrong, and its guard is about a **live `MediaStream` track's** `readyState`, which is a different question from a loaded blob's. Folding `fillRect('#000')` in would make the composite paint black under a frame that always covers it — a per-frame operation the ceilings would then have to allow for no reason. So the shared function is exactly the overlay, and the screen draw stays one line in each caller.
- **The geometry parameter is the compositor's own config object, field names included.** `Compositor.render` runs on every animation frame for the whole length of a recording. Taking `{ position, size, shape }` — the shared `OverlayPlacement` shape — would force the compositor to build a new object 30 times a second to call it. `OverlayGeometry` is therefore `CompositorConfig`'s shape (`webcamPosition` / `webcamSize` / `webcamShape` / `padding`), `CompositorConfig` becomes an alias of it, and the compositor passes `this.config` and `this.canvas` straight through with **zero allocation per frame**. `overlayGeometryFor()` is the adapter the *converter* calls, once per conversion, to turn a stored `OverlayPlacement` into it.
- **`padding` is scaled by the frame width, and that is why `overlayPaddingFor` exists.** `webcamSize` is a fraction of the frame's width, so the overlay's *size* reproduces itself at any resolution. `padding` is 20 **pixels**, and the compositor measures it against a canvas capped at 1280 px wide (`compositor.ts:44`). A separate-tracks take records the **raw** screen, which may be 1920 wide — where a flat 20 px would be a visibly tighter inset than the preview the user watched. `overlayPaddingFor(frameWidth)` is `20 × frameWidth ÷ min(frameWidth, 1280)`: exactly 20 for any frame the preview was not capped for, 30 at 1920, and the same *fraction of the width* in both. `OverlayPlacement` is deliberately **not** widened to store the padding — it is already shipped in slice 1, ARTIST already reads it, and a stored pixel padding would need this same scaling anyway.

- [ ] **Step 1: Write the failing test** — create `apps/craft/src/core/overlayGeometry.test.ts`

```ts
// The webcam overlay's geometry, on its own.
//
// Every number here is a number `compositor.test.ts` already asserts, and that
// is the point of the file: the live compositor now *calls* `drawOverlay`, so a
// change that moved the circle in a downloaded MP4 would move it in the preview
// too and fail there as well. Before this module existed the composite would
// have been a second copy of the arc, the crop and the clip, and the difference
// would only ever have shown up in a file somebody downloaded.
//
// The canvas context is the recording double `src/test/setup.ts` installs
// globally, reached through a real <canvas>; the camera is a real <video> with
// its intrinsic size forced on, because that is all `drawOverlay` reads of it.
import { describe, it, expect } from 'vitest'
import {
  COMPOSITOR_MAX_WIDTH,
  DEFAULT_OVERLAY_PADDING,
  drawOverlay,
  overlayGeometryFor,
  overlayPaddingFor,
  type OverlayGeometry,
} from './overlayGeometry'
import { getCanvasContext, type RecordingCanvasRenderingContext2D } from '../test/doubles/canvas'

function ctxFor(width: number, height: number): RecordingCanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')
  const ctx = getCanvasContext(canvas)
  if (!ctx) throw new Error('the canvas double is not installed')
  return ctx
}

/** A camera element with an intrinsic size — the only two fields read of it. */
function webcamElement(videoWidth = 640, videoHeight = 480): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: videoWidth, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: videoHeight, configurable: true })
  return video
}

const RECTANGLE: OverlayGeometry = {
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'rectangle',
  padding: 20,
}
const CIRCLE: OverlayGeometry = { ...RECTANGLE, webcamShape: 'circle' }

describe('overlayPaddingFor', () => {
  it('is the recorded 20px for a frame the preview was never capped for', () => {
    // The compositor's canvas *is* the source below the cap, so the preview's
    // inset and the recording's are the same pixels.
    expect(overlayPaddingFor(COMPOSITOR_MAX_WIDTH)).toBe(DEFAULT_OVERLAY_PADDING)
    expect(overlayPaddingFor(640)).toBe(DEFAULT_OVERLAY_PADDING)
  })

  it('grows with the frame, so a 1080p composite has the inset the preview showed', () => {
    // The preview was 1280 wide with a 20px inset — 1.5625% of the width. The
    // recording is 1920 wide, so the same fraction is 30px. A flat 20 would put
    // the camera visibly closer to the edge than the user saw it.
    expect(overlayPaddingFor(1920)).toBe(30)
    expect(overlayPaddingFor(2560)).toBe(40)
  })

  it('answers the default for a frame with no width at all', () => {
    // A source with no picture has no corners. The conversion fails on its own
    // 0x0 encoder configuration a moment later; this stays total rather than
    // handing NaN coordinates to a canvas.
    expect(overlayPaddingFor(0)).toBe(DEFAULT_OVERLAY_PADDING)
  })
})

describe('overlayGeometryFor', () => {
  it('turns a stored placement into the geometry, padding scaled to the frame', () => {
    expect(
      overlayGeometryFor({ position: 'top-left', size: 0.3, shape: 'rectangle' }, 1920)
    ).toEqual({
      webcamPosition: 'top-left',
      webcamSize: 0.3,
      webcamShape: 'rectangle',
      padding: 30,
    })
  })
})

describe('drawOverlay', () => {
  it.each([
    ['top-left', 20, 20],
    ['top-right', 1280 - 256 - 20, 20],
    ['bottom-left', 20, 720 - 144 - 20],
    ['bottom-right', 1280 - 256 - 20, 720 - 144 - 20],
  ] as const)('positions a %s rectangular overlay at (%i, %i)', (webcamPosition, x, y) => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement()

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, {
      ...RECTANGLE,
      webcamPosition,
    })

    // 256 = 1280 * 0.2, 144 = 256 * 9/16 — the same four positions
    // compositor.test.ts pins for the live overlay.
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, x, y, 256, 144)
    expect(ctx.roundRect).toHaveBeenCalledWith(x, y, 256, 144, 8)
  })

  it('centre-crops a landscape camera into the circular overlay', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement(640, 480)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, CIRCLE)

    // radius = min(256,144)/2 = 72; centre = (1004+128, 556+72)
    expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
    // a landscape source is cropped to a 480x480 square, horizontally centred
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 80, 0, 480, 480, 1060, 556, 144, 144)
  })

  it('centre-crops a portrait camera into the circular overlay', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement(480, 640)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, CIRCLE)

    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 0, 80, 480, 480, 1060, 556, 144, 144)
  })

  it('clips before it draws and strokes the border after, outside the clip', () => {
    const ctx = ctxFor(1280, 720)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcamElement(), ctx.canvas, RECTANGLE)

    const order = ctx.calls.map((call) => call.method)
    expect(order.indexOf('clip')).toBeLessThan(order.lastIndexOf('drawImage'))
    expect(order.lastIndexOf('drawImage')).toBeLessThan(order.indexOf('stroke'))
    expect(order.indexOf('restore')).toBeLessThan(order.indexOf('stroke'))
    expect(ctx.strokeStyle).toBe('rgba(255, 255, 255, 0.8)')
    expect(ctx.lineWidth).toBe(3)
  })

  it('leaves the context stack exactly as it found it', () => {
    const ctx = ctxFor(1280, 720)

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcamElement(), ctx.canvas, CIRCLE)

    // Exact: one save, one restore. An extra restore() is a no-op on a real
    // canvas, which is why nothing looked wrong when this drew two — but it
    // would silently undo a save() made by a caller that wrapped this draw,
    // and `convertToMP4` is now exactly such a caller.
    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })

  it('scales the overlay with the size, and honours a zero padding', () => {
    const ctx = ctxFor(1280, 720)
    const webcam = webcamElement()

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, webcam, ctx.canvas, {
      ...RECTANGLE,
      webcamSize: 0.4,
      padding: 0,
    })

    // 512 = 1280 * 0.4, 288 = 512 * 9/16; bottom-right with no padding sits
    // exactly on the frame's edge.
    expect(ctx.drawImage).toHaveBeenCalledWith(webcam, 1280 - 512, 720 - 288, 512, 288)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/overlayGeometry.test.ts`
Expected: FAIL — `Failed to resolve import "./overlayGeometry"`.

- [ ] **Step 3: Create `core/overlayGeometry.ts`, moving the body out of the compositor verbatim**

```ts
// The webcam overlay's geometry: where the camera sits inside a frame, and the
// one function that draws it there.
//
// It lives on its own because two things draw the same overlay and must not
// drift apart. `Compositor` draws it live, at the take's target frame rate,
// into the canvas the user watches — and, for a composited PiP take, into the
// canvas MediaRecorder captures. `convertToMP4` draws it again, offline, when it
// re-composites a separate-tracks take into one MP4 (ESCSUITE-14 decision 3):
// the camera is a second *file* there, and this is the geometry that puts it
// back where it was recorded. Two copies of the arc, the centre-crop and the
// clip would be two places for a rounding difference to live, and the
// difference would only ever be visible in a file somebody downloaded.
//
// Pure: it reads its arguments and calls the context. No element lookup, no
// canvas creation, no state, no `this`.
import type { OverlayPlacement } from '@escapesuite/shared/types';
import type { WebcamPosition, WebcamShape } from '../store/types';

/**
 * The widest the compositor lets its canvas be, in pixels.
 *
 * The live preview is capped here (`Compositor`'s constructor), which is why
 * `overlayPaddingFor` needs the number: a padding measured in pixels of the
 * *preview* is a different fraction of a 1920-wide recording.
 */
export const COMPOSITOR_MAX_WIDTH = 1280;

/** The inset a take is recorded with unless a caller asks for another. */
export const DEFAULT_OVERLAY_PADDING = 20;

/**
 * Where the camera goes in a frame, and what shape it is.
 *
 * Field names are the recording config's (`webcamPosition`, `webcamSize`,
 * `webcamShape`) rather than the stored `OverlayPlacement`'s (`position`,
 * `size`, `shape`) for one reason: `Compositor` calls `drawOverlay` on every
 * animation frame for the whole length of a take and passes `this.config`
 * straight through, so the hot loop allocates nothing. `overlayGeometryFor()`
 * is the adapter the converter calls, once per conversion, to come the other
 * way.
 */
export interface OverlayGeometry {
  webcamPosition: WebcamPosition;
  /** Fraction of the frame's width the overlay occupies, 0.1 to 0.4. */
  webcamSize: number;
  webcamShape: WebcamShape;
  /** Inset from the frame's edges, in pixels **of this frame**. */
  padding: number;
}

/**
 * The inset that reproduces the recorded 20 px inset in a frame this wide.
 *
 * `webcamSize` is a fraction of the width, so the overlay's *size* reproduces
 * itself at any resolution for free. The padding does not: it is 20 pixels, and
 * the compositor measured it against a canvas capped at `COMPOSITOR_MAX_WIDTH`.
 * A separate-tracks take records the **raw** screen, so a 1920-wide composite
 * drawn with a flat 20 px would put the camera visibly closer to the edge than
 * the preview the user watched did. Scaling by
 * `frameWidth / min(frameWidth, cap)` is exactly 1 for any frame the preview
 * was not capped for, and 1.5 at 1920.
 *
 * A frame with no width has no corners; the conversion fails on its own 0x0
 * encoder configuration a moment later, and answering the default here keeps
 * this total rather than handing NaN coordinates to a canvas.
 */
export function overlayPaddingFor(frameWidth: number): number {
  if (frameWidth <= 0) return DEFAULT_OVERLAY_PADDING;
  return (DEFAULT_OVERLAY_PADDING * frameWidth) / Math.min(frameWidth, COMPOSITOR_MAX_WIDTH);
}

/**
 * The geometry a take's stored `overlayPlacement` describes, in a frame this
 * wide — what `convertToMP4` builds once, before it starts encoding.
 */
export function overlayGeometryFor(
  placement: OverlayPlacement,
  frameWidth: number
): OverlayGeometry {
  return {
    webcamPosition: placement.position,
    webcamSize: placement.size,
    webcamShape: placement.shape,
    padding: overlayPaddingFor(frameWidth),
  };
}

/**
 * Draw `webcam` into the corner of `frame` that `geometry` names, clipped to
 * its shape and given its border.
 *
 * `frame` is `{ width, height }` rather than a canvas so the caller may pass
 * its canvas element (both do) without this module knowing what a canvas is.
 * `webcam` is an `HTMLVideoElement` because the circular crop needs the
 * source's intrinsic size, which only a media element carries.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  webcam: HTMLVideoElement,
  frame: { readonly width: number; readonly height: number },
  geometry: OverlayGeometry
): void {
  const { width, height } = frame;
  const { webcamPosition, webcamSize, webcamShape, padding } = geometry;

  // Calculate webcam dimensions
  const webcamWidth = width * webcamSize;
  const webcamHeight = (webcamWidth * 9) / 16; // 16:9 aspect ratio

  // Calculate position
  let x: number, y: number;

  switch (webcamPosition) {
    case 'top-left':
      x = padding;
      y = padding;
      break;
    case 'top-right':
      x = width - webcamWidth - padding;
      y = padding;
      break;
    case 'bottom-left':
      x = padding;
      y = height - webcamHeight - padding;
      break;
    case 'bottom-right':
    default:
      x = width - webcamWidth - padding;
      y = height - webcamHeight - padding;
      break;
  }

  // Save context state. Each branch below restores it again once the webcam
  // frame is drawn, so the border is stroked outside the clip path — that
  // restore is the only one, and the pair stays balanced. An extra restore()
  // on the way out is a no-op on a real canvas, but it is a stack operation
  // per frame for nothing and it would silently undo a save() made by any
  // future caller that wrapped this draw.
  ctx.save();

  if (webcamShape === 'circle') {
    // Draw circular webcam overlay
    const radius = Math.min(webcamWidth, webcamHeight) / 2;
    const centerX = x + webcamWidth / 2;
    const centerY = y + webcamHeight / 2;

    // Create circular clip path
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Draw webcam video (centered and cropped to circle)
    const videoAspect = webcam.videoWidth / webcam.videoHeight;
    let srcWidth = webcam.videoWidth;
    let srcHeight = webcam.videoHeight;
    let srcX = 0;
    let srcY = 0;

    // Center crop to square for circle
    if (videoAspect > 1) {
      srcWidth = srcHeight;
      srcX = (webcam.videoWidth - srcWidth) / 2;
    } else {
      srcHeight = srcWidth;
      srcY = (webcam.videoHeight - srcHeight) / 2;
    }

    ctx.drawImage(
      webcam,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );

    // Draw border
    ctx.restore();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    // Draw rectangular webcam overlay
    // Create rounded rectangle clip path
    const borderRadius = 8;
    ctx.beginPath();
    ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
    ctx.closePath();
    ctx.clip();

    // Draw webcam video
    ctx.drawImage(webcam, x, y, webcamWidth, webcamHeight);

    // Draw border
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
```

The only edits to the moved body: `this.canvas` → `frame`, `this.config` → `geometry`, `this.ctx` → `ctx`, `this.webcamVideo` → `webcam`, and the `if (!this.webcamVideo) return;` guard dropped — it was TypeScript narrowing for a call site (`drawFrame`) that had already tested the same thing, so it was an unreachable branch and its removal moves branch coverage **up**.

- [ ] **Step 4: Rewire the compositor**

In `apps/craft/src/core/compositor.ts`, replace the head of the file:

```ts
// Canvas-based compositor for Picture-in-Picture mode
// Combines screen capture with webcam overlay

import {
  COMPOSITOR_MAX_WIDTH,
  DEFAULT_OVERLAY_PADDING,
  drawOverlay,
  type OverlayGeometry,
} from './overlayGeometry';

/**
 * How the compositor is configured — which is, exactly, where the webcam
 * overlay goes. The geometry and the function that draws it live in
 * `overlayGeometry.ts`, shared with the offline composite in
 * `core/converter.ts` so the two cannot draw the camera in different places;
 * this alias keeps the name every caller here already uses.
 */
export type CompositorConfig = OverlayGeometry;
```

In the constructor, replace the two literals (nothing else):

```ts
    // Cap compositor resolution to 720p — reduces draw cost by ~55% vs 1080p
    // MediaRecorder re-encodes anyway so full resolution isn't needed here
    const maxDim = COMPOSITOR_MAX_WIDTH;
```

```ts
      // ?? not || — a zero padding is a real choice (overlay flush against the
      // canvas edge), whereas a zero webcam size is nonsense input.
      padding: config.padding ?? DEFAULT_OVERLAY_PADDING,
```

In `drawFrame`, replace the overlay branch:

```ts
    // Draw webcam overlay — through the geometry `convertToMP4` also draws
    // through, so the offline composite of a separate-tracks take puts the
    // camera exactly where the preview had it.
    if (this.webcamVideo && this.webcamVideo.readyState >= 2) {
      drawOverlay(this.ctx, this.webcamVideo, this.canvas, this.config);
    }
```

Delete the whole `private drawWebcamOverlay(): void { ... }` method.

- [ ] **Step 5: Move the role order into `companionParts.ts`**

Append to `apps/craft/src/utils/companionParts.ts`:

```ts
/**
 * The order a take's companion parts are listed in, everywhere: the camera
 * first, then the microphone, then the system audio.
 *
 * Typed as plain strings on purpose. `CompanionRole` is a compile-time union
 * and IndexedDB is not type-checked, so "is this a role we know?" has to be a
 * runtime question — a part written by a newer ESCAPECRAFT sorts last rather
 * than crashing the sort.
 *
 * It lives beside `COMPANION_PARTS` because this is the module that exists so
 * the roles are described in exactly one place; `utils/takeOrder.ts` (the
 * library's row order) and `utils/takeParts.ts` (the upload's part order) both
 * read it, and a fourth role is one entry here rather than two greps.
 */
export const COMPANION_ROLE_ORDER: readonly string[] = ['webcam', 'mic', 'system']

/** Where a companion sits in its take's stack; last for a role we do not know. */
export function companionRank(role: string | undefined): number {
  const rank = COMPANION_ROLE_ORDER.indexOf(role ?? '')
  return rank === -1 ? COMPANION_ROLE_ORDER.length : rank
}
```

In `apps/craft/src/utils/takeOrder.ts`, delete the private `COMPANION_ROLE_ORDER` and `companionRank` (lines 13–24 including their comment) and import them instead:

```ts
import { companionRank } from './companionParts';
```

Nothing else in that file changes; `companionRank` is called exactly where it was.

- [ ] **Step 6: Run the new test, then everything the move touched**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/overlayGeometry.test.ts`
Expected: PASS (12 tests).

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/compositor.test.ts src/core/compositor.perf.test.ts src/utils/takeOrder.test.ts src/utils/companionParts.test.ts`
Expected: PASS, every pre-existing test, **unmodified** — including `compositor.perf.test.ts`'s `count('save') === 1`, `count('restore') === count('save')`, `count('fillRect') === 1` and `firstFrame.length <= 24`. If any of those moved, the move was not pure: put the difference back.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS (whole craft suite).

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 7: Prove the move was pure**

Run: `git status --porcelain` and confirm the only test file touched is the new `src/core/overlayGeometry.test.ts`. After committing, run:

`git diff --stat HEAD~1 -- 'apps/craft/src/**/*.test.ts' 'apps/craft/src/**/*.test.tsx' | grep -v overlayGeometry.test.ts`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add apps/craft/src/core/overlayGeometry.ts apps/craft/src/core/overlayGeometry.test.ts \
  apps/craft/src/core/compositor.ts apps/craft/src/utils/companionParts.ts \
  apps/craft/src/utils/takeOrder.ts
git commit -m "$(cat <<'EOF'
refactor(craft): the webcam overlay's geometry is one function both draws call (ESCSUITE-14)

drawOverlay() moves out of Compositor.drawWebcamOverlay verbatim into
core/overlayGeometry.ts, and the compositor calls it. The offline composite MP4
(slice 4) draws the same overlay from a second *file*, so without this there
would be two copies of the arc, the centre-crop and the two clip paths — and a
rounding difference between them would only ever be visible in a downloaded
file. Now the live preview and the composite share the code, so the numbers
compositor.test.ts pins are the numbers the MP4 gets.

Only the overlay moves. The screen draw is one drawImage with no geometry to
get wrong and a guard about a live capture track's readiness, and the black
fill would be a per-frame operation under a frame that always covers it.

The geometry argument keeps the config's field names so the compositor can pass
`this.config` and `this.canvas` through with no per-frame allocation;
overlayGeometryFor() is the adapter the converter calls once. overlayPaddingFor()
scales the 20px inset by the frame width, because the preview measured it
against a canvas capped at 1280 and a separate-tracks take records the raw
screen — a flat 20 would sit visibly tighter at 1920 than what the user watched.

COMPANION_ROLE_ORDER and companionRank move to utils/companionParts.ts, the
module that exists so a role is described once; takeOrder reads them there and
utils/takeParts.ts will too.

No behaviour change: every existing test is byte-unchanged and green.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 2: the converter re-composites a take, and its new ceilings

**Files:**
- Modify: `apps/craft/src/core/converter.ts:130-299` (`captureFramesViaPlayback`), `:675-860` (`convertToMP4`), `:1130-1147` (`remuxToWebM`'s call site — one argument list, unchanged in meaning)
- Test: `apps/craft/src/core/converter.test.ts` (one new `describe`, appended inside the top-level `describe('converter', …)`)
- Test: `apps/craft/src/core/converter.perf.test.ts` (one new `describe`, appended at the end)

**Interfaces:**
- Consumes: `drawOverlay`, `overlayGeometryFor`, `type OverlayGeometry` from `./overlayGeometry` (Task 1).
- Produces:
  ```ts
  export interface CompositeCompanion {
    blob: Blob
    placement: OverlayPlacement
    startOffset: number
  }
  export interface CompositeOptions {
    companion: CompositeCompanion
    onCompanionSkipped?: () => void
  }
  export function convertToMP4(
    webmBlob: Blob,
    onProgress: ProgressCallback,
    signal?: AbortSignal,
    composite?: CompositeOptions
  ): Promise<Blob>
  ```
- Produces (private): `interface FrameOverlay { video: HTMLVideoElement; geometry: OverlayGeometry; startOffset: number }`, and `captureFramesViaPlayback(…, onProgress?, overlay?)`.

**Four decisions this task pins, all argued in the commit message:**

- **A fourth optional argument, not a `convertTakeToMP4`.** The alternative — a second exported entry point — either duplicates 180 lines of encoder setup, mux and cleanup, or turns the existing function into a wrapper. Both give the composite its own copy of the audio pass, the abort cadence and the two `finally` releases. A fourth *optional* positional argument leaves every existing call at three arguments, so `converter.test.ts` and `converter.perf.test.ts` are byte-unchanged above the new blocks, the plain path's ceilings cannot move, and there is exactly one encode loop to reason about. It also keeps `signal` in the position every caller already passes it in, which a leading options object would not.
- **The composite's audio is the primary's own track, and nothing else.** `WebCodecsRecorder` writes the mic and system companions as a *second tap* on tracks the mix is already reading (`AudioCompanionPipeline`'s own doc comment), so the primary's audio track already **is** the mix. Decoding the audio parts and summing them would re-derive a buffer that is already in the file, at the cost of two more `decodeAudioData` passes over the whole take and a resampling sum that can only differ from the real mix. So `extractAudio(webmBlob)` is untouched, and a test pins that exactly one `AudioContext` is constructed and exactly the primary's bytes are decoded. **This is also why M4A needs no change at all** (Task 3 pins that).
- **A camera part that cannot be used costs the take its overlay and nothing else.** Two things can go wrong — its bytes are missing (Task 3's lookup answers that) or its container will not decode (this function answers that). Either way the conversion **still succeeds**: a screen-only MP4 is a real file, and refusing to write one would leave the user with no MP4 at all after minutes of encoding. `onCompanionSkipped` is how the caller learns the file is not what was asked for, so it can say so; the failure is *not* thrown.
- **Sync is a shared start, not a per-frame seek.** Both elements play at 1× from the same moment, and each captured frame draws whatever the camera element is currently showing. Drift within a frame is accepted — the alternative is a seek per frame, which is the minutes-instead-of-real-time cost `captureFramesViaPlayback` exists to avoid, and a 33 ms offset between two halves of the same take is not visible. `startOffset` shifts the camera's time base by deferring its `play()` until the screen has played that far; it is 0 for every take this recorder writes (one `start()`, one clock) and is honoured anyway because it is stored per part.

- [ ] **Step 1: Write the failing behaviour tests** — append a new `describe` inside `converter.test.ts`'s top-level `describe('converter', …)`, directly after the existing `describe('convertToMP4', …)` block

```ts
  // The composite: one MP4 from a take's two video files (ESCSUITE-14 decision
  // 3). What is asserted is that the camera goes back exactly where the live
  // compositor had it — the numbers come from `core/overlayGeometry.test.ts`,
  // which pins the same ones the preview is pinned at — that the take's audio
  // is the primary's and only the primary's, and that a camera part that
  // cannot be read costs the overlay and not the file.
  describe('convertToMP4 for a take with a webcam companion', () => {
    const COMPANION = new Blob(['webcam'], { type: 'video/webm' })

    const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

    interface StartedComposite {
      promise: Promise<Blob>
      screen: VideoElementDouble
      webcam: VideoElementDouble
      progress: ConversionProgress[]
      onCompanionSkipped: ReturnType<typeof vi.fn>
    }

    /**
     * Start a composite conversion and hand back both elements.
     *
     * The screen element is created first and the camera second, so
     * `getVideoDoubles()` is [screen, camera] — which is why the plain path's
     * own `start()` helper above, which reaches for the *last* element, still
     * addresses the right one for a three-argument call.
     */
    function startComposite(
      options: {
        startOffset?: number
        placement?: typeof PLACEMENT
        width?: number
        height?: number
        duration?: number
      } = {}
    ): StartedComposite {
      const progress: ConversionProgress[] = []
      const onCompanionSkipped = vi.fn()
      const promise = convertToMP4(
        SOURCE,
        (p) => progress.push(p),
        undefined,
        {
          companion: {
            blob: COMPANION,
            placement: options.placement ?? PLACEMENT,
            startOffset: options.startOffset ?? 0,
          },
          onCompanionSkipped,
        }
      )
      promise.catch(() => {})

      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({
        videoWidth: options.width ?? 1280,
        videoHeight: options.height ?? 720,
        duration: options.duration ?? 0.1,
      })
      screen.fireLoadedMetadata()
      return { promise, screen, webcam, progress, onCompanionSkipped }
    }

    /** Give the camera element a decoded frame and let its metadata land. */
    function readyWebcam(webcam: VideoElementDouble): void {
      webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: 0.1 })
      webcam.fireLoadedMetadata()
    }

    it('draws the screen, then the camera through the take\'s stored placement', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // The screen fills the frame, once per captured frame, exactly as the
      // plain conversion does.
      expect(ctx.drawImage).toHaveBeenCalledWith(composite.screen.element, 0, 0, 1280, 720)
      // …and the camera lands in the circle the take was recorded with: radius
      // min(256,144)/2 = 72, centre (1132, 628), a landscape source cropped to
      // 480x480. The same numbers `overlayGeometry.test.ts` pins, which are the
      // same numbers `compositor.test.ts` pins for the live preview.
      expect(ctx.arc).toHaveBeenCalledWith(1132, 628, 72, 0, Math.PI * 2)
      expect(ctx.drawImage).toHaveBeenCalledWith(
        composite.webcam.element,
        80,
        0,
        480,
        480,
        1060,
        556,
        144,
        144
      )
    })

    it('scales the recorded 20px inset to the frame it is encoding', async () => {
      const composite = startComposite({
        width: 1920,
        height: 1080,
        placement: { position: 'top-left', size: 0.2, shape: 'rectangle' },
      })
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // 384 = 1920 * 0.2, 216 = 384 * 9/16, and the inset is 30 rather than 20
      // because the preview measured 20 against a canvas capped at 1280 — see
      // `overlayPaddingFor`.
      expect(ctx.drawImage).toHaveBeenCalledWith(composite.webcam.element, 30, 30, 384, 216)
    })

    it('plays both halves from the same moment and says it is loading the camera', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Started together, from zero, and played rather than seeked: both run at
      // 1x off the same wall clock, which is what keeps the two pictures
      // together without a seek per frame.
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
      expect(composite.webcam.element.currentTime).toBe(0)
      expect(composite.progress.map((p) => p.message)).toContain('Loading the webcam track…')
    })

    it('holds the camera back until the screen reaches its startOffset', async () => {
      const composite = startComposite({ startOffset: 0.5, duration: 1 })
      readyWebcam(composite.webcam)
      await settle()

      // Fourteen frames is 0.466s — not yet.
      for (let i = 0; i < 14; i++) composite.screen.presentFrame(i / 30)
      expect(composite.webcam.play).not.toHaveBeenCalled()

      // The fifteenth is 0.5s exactly, which is where this part begins.
      composite.screen.presentFrame(14 / 30)
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)

      composite.screen.fireEnded()
      await settle()
      await composite.promise
      // Started once, not once per frame.
      expect(composite.webcam.play).toHaveBeenCalledTimes(1)
    })

    it('draws no camera on a frame it has no picture for yet', async () => {
      const composite = startComposite()
      // Metadata, but no decoded frame: readyState stays 0.
      composite.webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 0 })
      composite.webcam.fireLoadedMetadata()
      await playThroughRvfc(composite.screen, 3)
      await composite.promise

      const ctx = getLastCanvasContext()!
      // The screen frames are still encoded — a screen-only frame is better
      // than a throw, and the same `readyState >= 2` guard `Compositor.drawFrame`
      // applies to the live overlay.
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
      expect(ctx.save).not.toHaveBeenCalled()
    })

    it('takes its audio from the primary alone — that file already is the mix', async () => {
      audio.decodeResult = createAudioBufferDouble({ length: 4 })
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Exactly one decode, of the primary's ten bytes. The mic and system
      // parts are a *second tap* on tracks the mix already read
      // (`core/webcodecs-recorder.ts`), so the primary's track is the mix —
      // decoding them would re-derive a buffer that is already in the file.
      expect(audio.contexts).toHaveLength(1)
      expect(audio.contexts[0].decodedByteLengths).toEqual([SOURCE.size])
    })

    it('writes the screen alone, and says so, when the camera part will not load', async () => {
      const composite = startComposite()
      composite.webcam.fireError()
      await playThroughRvfc(composite.screen, 3)

      const blob = await composite.promise
      // The file is still written: minutes of encoding must not be thrown away
      // because one of two files would not decode.
      expect(blob.type).toBe('video/mp4')
      const ctx = getLastCanvasContext()!
      expect(ctx.drawImage).toHaveBeenCalledTimes(3)
      expect(ctx.save).not.toHaveBeenCalled()
      // …and the caller is told, because the file is not what was asked for.
      expect(composite.onCompanionSkipped).toHaveBeenCalledTimes(1)
    })

    it('releases both object URLs however it leaves', async () => {
      const composite = startComposite()
      readyWebcam(composite.webcam)
      await playThroughRvfc(composite.screen, 2)
      await composite.promise

      // Two elements, two blob URLs, two revokes: the camera's is created
      // outside the try so the finally can release it whatever happened.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(2)
    })

    it('stops the camera element when the conversion is cancelled', async () => {
      const controller = new AbortController()
      const progress: ConversionProgress[] = []
      const promise = convertToMP4(
        SOURCE,
        (p) => progress.push(p),
        controller.signal,
        { companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 } }
      )
      promise.catch(() => {})
      const [screen, webcam] = getVideoDoubles()
      screen.enableRequestVideoFrameCallback()
      screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: 1 })
      screen.fireLoadedMetadata()
      readyWebcam(webcam)
      await settle()
      screen.presentFrame(0)

      controller.abort()
      await expect(promise).rejects.toBeInstanceOf(ConversionAbortedError)

      // A cancelled conversion leaves neither element playing: the camera is
      // paused with the screen, in the one cleanup both go through.
      expect(screen.pause).toHaveBeenCalled()
      expect(webcam.pause).toHaveBeenCalled()
    })
  })
```

Add to the file's existing imports: `getVideoDoubles` from `../test/doubles/video` (the module is already imported; add the name), and `ConversionAbortedError` if it is not already imported there.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/converter.test.ts`
Expected: FAIL — `Expected 2 arguments, but got 4` is a typecheck-only error, so at runtime the fourth argument is simply ignored: `expected "spy" to be called with arguments: [ …, 80, 0, 480, 480, … ]`, `expected "spy" to be called 1 times, but got 0 times` (the camera element is never created, so `getVideoDoubles()` has one entry and `composite.webcam` is `undefined` — the first failures will be `Cannot read properties of undefined (reading 'setMetadata')`).

- [ ] **Step 3: Add the composite types and the overlay parameter to the capture loop**

In `apps/craft/src/core/converter.ts`, add to the imports at the top:

```ts
import type { OverlayPlacement } from '@escapesuite/shared/types';
import { drawOverlay, overlayGeometryFor, type OverlayGeometry } from './overlayGeometry';
```

Above `captureFramesViaPlayback`, add:

```ts
/**
 * The camera half of a separate-tracks take, for the composite MP4.
 *
 * A take recorded with "Record webcam as a separate track" is two video files,
 * and MP4 is the format that puts them back together (ESCSUITE-14 decision 3):
 * the screen with the camera drawn into the corner it was recorded in. The
 * screen-only MP4 is deliberately not offered as a second option — a user who
 * wants one part alone downloads its WebM from its own row.
 *
 * There is no audio here on purpose. The primary's own track **is** the mix:
 * `WebCodecsRecorder` writes the microphone and system companions as a second
 * tap on tracks the mix is already reading rather than diverting them, so the
 * MP4's audio (and the whole M4A download) needs nothing from the parts.
 */
export interface CompositeCompanion {
  /** The webcam part's stored WebM. */
  blob: Blob;
  /**
   * Where the overlay sat while the take was recorded — the primary's stored
   * `overlayPlacement`. It is stored because the picture no longer carries it.
   */
  placement: OverlayPlacement;
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset: number;
}

export interface CompositeOptions {
  companion: CompositeCompanion;
  /**
   * Called once, before any frame is encoded, when the camera part could not be
   * used and the MP4 will be the screen alone.
   *
   * The conversion still resolves: a screen-only MP4 is a real file, and
   * refusing to write one would leave the user with nothing after minutes of
   * encoding. This is how the caller learns the file is not what was asked for
   * — `hooks/useMp4Download.ts` turns it into a notice.
   */
  onCompanionSkipped?: () => void;
}

/** The second picture a composite frame draws, and where it goes. */
interface FrameOverlay {
  video: HTMLVideoElement;
  geometry: OverlayGeometry;
  /** Seconds into the screen part at which this picture begins. */
  startOffset: number;
}
```

Change `captureFramesViaPlayback`'s signature — one parameter appended:

```ts
async function captureFramesViaPlayback(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  videoEncoder: VideoEncoder,
  frameRate: number,
  totalFrames: number,
  keyFrameInterval: number,
  signal?: AbortSignal,
  onProgress?: (frameIndex: number, totalFrames: number) => void,
  /**
   * A second picture to draw on top of each captured frame. Absent for every
   * conversion but the composite of a separate-tracks take, and absent is what
   * keeps the plain path's per-frame work exactly one `drawImage`.
   */
  overlay?: FrameOverlay
): Promise<void> {
```

Inside the returned Promise, after `let isFinished = false;`:

```ts
    let overlayPlaying = false;

    /**
     * Play the camera part, once the screen has played as far as the point
     * where that part begins.
     *
     * Both elements then run at 1x off the same wall clock, so the two pictures
     * stay together within a frame for the whole conversion and the drift does
     * not accumulate — which is what lets each captured frame draw whatever the
     * camera element is currently showing. The alternative is a seek per frame,
     * which is the minutes-instead-of-real-time cost this whole function exists
     * to avoid.
     *
     * `startOffset` is 0 for every take ESCAPECRAFT records: both parts come
     * from one `start()` on one clock (`core/webcodecs-recorder.ts`), so this
     * fires on the call below and the in-loop call never does anything. It is
     * honoured anyway because it is stored per part, and a recorder that
     * started them apart would otherwise silently misalign them.
     */
    const startOverlayIfDue = (elapsed: number): void => {
      if (!overlay || overlayPlaying || elapsed < overlay.startOffset) return;
      overlayPlaying = true;
      overlay.video.currentTime = 0;
      void overlay.video.play();
    };
```

In `cleanup`, after `video.pause();`:

```ts
      // The camera element is stopped with the screen: a cancelled conversion
      // must not leave a second <video> decoding behind a row that is idle.
      overlay?.video.pause();
```

In `captureCurrentFrame`, replace the draw:

```ts
    const captureCurrentFrame = () => {
      if (frameIndex >= totalFrames || isFinished) return false;

      startOverlayIfDue(frameIndex * frameDuration);

      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // …and the camera on top of it, where it was recorded. Guarded on a
      // decoded frame exactly as `Compositor.drawFrame` guards the live
      // overlay: the first frames of a conversion can arrive before the second
      // element has one, and a screen-only frame is better than a throw.
      if (overlay && overlay.video.readyState >= 2) {
        drawOverlay(ctx, overlay.video, canvas, overlay.geometry);
      }
```

Immediately before `if (hasRVFC) {`, add:

```ts
    // Both halves start together (see `startOverlayIfDue`): the screen's own
    // `play()` is a few lines below, in whichever branch runs.
    startOverlayIfDue(0);
```

- [ ] **Step 4: Give `convertToMP4` the companion path**

Change the signature and the element setup:

```ts
/**
 * Convert WebM blob to MP4
 * @param webmBlob - The WebM blob to convert
 * @param onProgress - Progress callback
 * @param signal - Optional AbortSignal for cancellation
 * @param composite - The take's camera half, when it has one, to draw back into
 *   the corner it was recorded in (ESCSUITE-14 decision 3). Absent for every
 *   other conversion, and absent is what keeps that path's per-frame work and
 *   its ceilings exactly what they were.
 */
export async function convertToMP4(
  webmBlob: Blob,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  composite?: CompositeOptions
): Promise<Blob> {
```

After `const videoUrl = URL.createObjectURL(webmBlob);` add:

```ts
  // The camera half's element and URL, created here rather than inside the try
  // so the finally below can release them however this function leaves.
  // `muted` for the same reason the screen element is: this file has no audio
  // track (the mix is on the primary), and nothing should be able to make a
  // noise out of a conversion.
  let companionVideo: HTMLVideoElement | null = null;
  let companionUrl: string | null = null;
  if (composite) {
    companionVideo = document.createElement('video');
    companionVideo.playsInline = true;
    companionVideo.muted = true;
    companionVideo.preload = 'auto';
    companionUrl = URL.createObjectURL(composite.companion.blob);
  }
```

Inside the `try`, immediately after `const totalFrames = Math.ceil(duration * frameRate);`:

```ts
    // The camera half, loaded alongside. Its geometry is built once, here, from
    // the placement the take was recorded with and the frame this conversion is
    // actually encoding — see `overlayGeometryFor`.
    let overlay: FrameOverlay | null = null;
    if (composite && companionVideo && companionUrl) {
      onProgress({ phase: 'preparing', progress: 3, message: 'Loading the webcam track…' });
      const companionElement = companionVideo;
      const companionSrc = companionUrl;
      try {
        await new Promise<void>((resolve, reject) => {
          companionElement.onloadedmetadata = () => resolve();
          companionElement.onerror = () => reject(new Error('Failed to load the webcam track'));
          companionElement.src = companionSrc;
        });
        overlay = {
          video: companionElement,
          geometry: overlayGeometryFor(composite.companion.placement, width),
          startOffset: composite.companion.startOffset,
        };
      } catch (error) {
        // A camera part that will not decode costs the take its overlay and
        // nothing else. Refusing here would spend the whole conversion and then
        // hand back no file at all, which is strictly worse than a screen-only
        // MP4 the caller is told about.
        console.warn('The webcam track could not be read; converting the screen alone:', error);
        composite.onCompanionSkipped?.();
      }
    }
```

Pass it to the capture loop — the tenth argument, after the progress callback:

```ts
    // Use play-based frame capture (much faster than seek-based)
    await captureFramesViaPlayback(
      video,
      canvas,
      ctx,
      videoEncoder,
      frameRate,
      totalFrames,
      30, // keyframe every 30 frames (1 second)
      signal,
      (frameIndex, total) => {
        const progress = 18 + (frameIndex / total) * 70;
        onProgress({
          phase: 'encoding',
          progress,
          message: `Encoding frame ${frameIndex} of ${total}...`
        });
      },
      overlay ?? undefined
    );
```

And in the `finally`, after `URL.revokeObjectURL(videoUrl);`:

```ts
    if (companionUrl) {
      URL.revokeObjectURL(companionUrl);
    }
```

`remuxToWebM`'s call to `captureFramesViaPlayback` is left exactly as it is: it passes nine arguments, `overlay` is `undefined`, and its behaviour and tests are unchanged.

- [ ] **Step 5: Run the behaviour tests**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/converter.test.ts`
Expected: PASS — all 10 new tests and every pre-existing one, including `describe('remuxToWebM')`.

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/converter.perf.test.ts`
Expected: PASS, unchanged — `draws` is still `FRAMES` and `ctx.calls.length / FRAMES` is still ≤ 2 on the plain path.

- [ ] **Step 6: Write the composite ceilings** — append at the end of `apps/craft/src/core/converter.perf.test.ts`

```ts
// The composite path's per-frame work (ESCSUITE-14 slice 4).
//
// A composite frame is the plain frame plus one overlay: one more `drawImage`,
// one clip path, one balanced save/restore and one border stroke. The
// conservation laws here are the ones that would let the composite quietly cost
// twice what it should — a second pass over the same screen pixels, an overlay
// drawn more than once, a save() the stroke never restores — and they are
// exact. The one ceiling that is a cost rather than a law is 2x the measured
// value, as everywhere else.
describe('composite (screen + webcam) per-frame work', () => {
  const COMPANION = new Blob(['webcam-bytes'], { type: 'video/webm' })
  const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  /** Convert a companion take whose screen half presents `count` frames. */
  async function convertComposite(count: number): Promise<void> {
    const promise = convertToMP4(SOURCE, () => {}, undefined, {
      companion: { blob: COMPANION, placement: PLACEMENT, startOffset: 0 },
    })
    promise.catch(() => {})

    const [screen, webcam] = getVideoDoubles()
    screen.enableRequestVideoFrameCallback()
    screen.setMetadata({ videoWidth: 1280, videoHeight: 720, duration: count / 30 })
    screen.fireLoadedMetadata()
    webcam.setMetadata({ videoWidth: 640, videoHeight: 480, readyState: 2, duration: count / 30 })
    webcam.fireLoadedMetadata()

    await settle()
    for (let i = 0; i < count; i++) screen.presentFrame(i / 30)
    screen.fireEnded()
    await settle()

    await promise
  }

  it('creates, closes and encodes exactly one frame per presented frame', async () => {
    await convertComposite(FRAMES)

    const frames = getCreatedFrames('VideoFrame')
    // Exact, and the same law the plain path is held to: one composited frame
    // is one `VideoFrame`, and a frame that is not closed again is pixels the
    // browser cannot reclaim until the tab goes away. Two video elements do not
    // make two frames.
    expect(frames).toHaveLength(FRAMES)
    expect(frames.filter((f) => f.closed)).toHaveLength(FRAMES)
    expect(allFramesClosed()).toBe(true)
    expect(lastVideoEncoder().encodes).toHaveLength(FRAMES)
    expect(lastVideoEncoder().flushCalls).toBe(1)
  })

  it('draws the screen once and the camera once per encoded frame', async () => {
    await convertComposite(FRAMES)

    const ctx = getLastCanvasContext()!
    const draws = ctx.calls.filter((c) => c.method === 'drawImage')

    // Exact: two draws a frame and not three. A third would mean the screen was
    // passed over twice, which at 1280x720 is the single most expensive thing
    // this loop could do twice.
    expect(draws).toHaveLength(FRAMES * 2)
    // One canvas, not one per layer: a second canvas would be a second
    // full-frame allocation and a blit between them.
    expect(ctx.canvas.width).toBe(1280)
    expect(ctx.canvas.height).toBe(720)
    // Exact: the screen frame covers the canvas, so nothing clears it first.
    expect(ctx.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0)
  })

  it('balances every save with a restore, and stays inside its per-frame ceiling', async () => {
    await convertComposite(FRAMES)

    const ctx = getLastCanvasContext()!
    const count = (method: string) => ctx.calls.filter((c) => c.method === method).length

    // Exact: one save and one restore per frame. The overlay strokes its border
    // *outside* the clip, so the restore comes before the stroke and the pair
    // has to stay balanced — an extra restore() would pop a state this loop's
    // caller pushed.
    expect(count('save')).toBe(FRAMES)
    expect(count('restore')).toBe(FRAMES)
    // Exact: one clip path established per frame, and one only.
    expect(count('clip')).toBe(FRAMES)
    // Measured 2026-09-26: 11 canvas calls per composite frame — the screen
    // draw, then save, beginPath, arc, closePath, clip, the camera draw,
    // restore, beginPath, arc, stroke. (The live compositor measures 12 for the
    // same overlay: it clears to black first, and the composite has no reason
    // to, because the screen frame covers the canvas.)
    expect(ctx.calls.length / FRAMES).toBeLessThanOrEqual(22)
  })

  it('leaves neither element playing and nothing scheduled', async () => {
    await convertComposite(FRAMES)

    const [screen, webcam] = getVideoDoubles()
    expect(screen.pause).toHaveBeenCalled()
    expect(webcam.pause).toHaveBeenCalled()
    // The rVFC fast path must not have fallen back to the rAF loop, and one
    // AudioContext was opened and closed — the camera part is never decoded for
    // audio, because the primary's track already is the mix.
    expect(raf.pending()).toBe(0)
    expect(audio.contexts).toHaveLength(1)
    expect(audio.contexts.every((c) => c.state === 'closed')).toBe(true)
  })
})
```

Add `getVideoDoubles` to the existing `../test/doubles/video` import in that file.

- [ ] **Step 7: Run the ceilings, and check the measurement**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/converter.perf.test.ts`
Expected: PASS — the four new tests and the six pre-existing ones.

Then confirm the measured value is the 11 the comment claims. Temporarily change the last assertion to `expect(ctx.calls.length / FRAMES).toBe(11)`, run the file, and put the `toBeLessThanOrEqual(22)` back. If the exact count is not 11, set the ceiling to 2× whatever it is, rounded up, and correct the comment's list of calls and its number — the comment must describe what was measured, and the date must be the day this task ran.

- [ ] **Step 8: Typecheck, lint, whole suite**

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/craft/src/core/converter.ts apps/craft/src/core/converter.test.ts \
  apps/craft/src/core/converter.perf.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the MP4 conversion re-composites a take's two video files (ESCSUITE-14)

convertToMP4 grows a fourth optional argument carrying the take's camera half:
a second <video>, started alongside the first, whose current frame is drawn
through the shared drawOverlay() into the capture canvas the encoder already
reads from. So the camera goes back exactly where the live compositor had it —
the geometry is the same function, and the inset is scaled to the frame being
encoded because the preview measured 20px against a canvas capped at 1280.

A fourth optional argument rather than a second entry point: every existing
call is still three arguments, so the plain path's tests and its per-frame
ceilings are byte-unchanged and there is one encode loop to reason about
instead of two.

The audio is the primary's own track and nothing else. WebCodecsRecorder taps
the mic and system tracks a second time rather than diverting them, so the
primary IS the mix — decoding the audio parts would re-derive a buffer that is
already in the file, twice over.

Sync is a shared start, not a seek per frame: both elements run at 1x from the
same moment and each captured frame draws whatever the camera is showing.
Drift within a frame is accepted; a seek per frame is the
minutes-instead-of-real-time cost this loop exists to avoid. startOffset defers
the camera's play() and is 0 for every take this recorder writes.

A camera part that will not decode costs the overlay and not the file: the
conversion resolves with a screen-only MP4 and calls onCompanionSkipped, so the
caller can say the file is not what was asked for. Spending minutes and then
handing back nothing would be strictly worse.

New ceilings, composite path: frames created == closed == encoded (exact), two
drawImage per encoded frame and not three (exact), one balanced save/restore
and one clip per frame (exact), no fillRect at all, and 22 canvas calls per
frame — 2x the 11 measured 2026-09-26.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 3: the library converts the take, and says when it could not

**Files:**
- Create: `apps/craft/src/utils/takeParts.ts`
- Create: `apps/craft/src/utils/takeParts.test.ts`
- Modify: `apps/craft/src/utils/notices.ts` (append one constant)
- Modify: `apps/craft/src/hooks/useMp4Download.ts:20-28`, `:195-233`
- Test: `apps/craft/src/hooks/useMp4Download.test.ts` (one new `describe`)

**Interfaces:**
- Consumes: `CompositeCompanion`, `CompositeOptions` (Task 2); `companionRank` (Task 1).
- Produces:
  ```ts
  export type WebcamCompanionLookup =
    | { kind: 'none' }
    | { kind: 'ready'; companion: CompositeCompanion }
    | { kind: 'unavailable' }
  export function loadWebcamCompanion(primary: SourceVideo): Promise<WebcamCompanionLookup>
  export interface UploadPart { id: string; role: RecordingRole; name: string; blob: Blob; startOffset: number }
  export function loadTakeParts(takeId: string): Promise<UploadPart[]>
  ```
  (`loadTakeParts` is written here and first *used* in Task 5, so both halves of this module land together and neither task ships a function nobody calls.)
- Produces: `MP4_SAVED_WITHOUT_WEBCAM` in `utils/notices.ts`.
- Unchanged: `startMp4Download(id, name, format?)`, `Mp4Download`, `Mp4DownloadDeps`. The hook gains **no** new dependency and the panel is not touched — everything it needs is in storage, which is what keeps `App.mp4rerender.test.tsx`'s contract intact.

**Three decisions this task pins, all argued in the commit message:**

- **The lookup reads storage, not the store.** The placement the composite draws through is `SourceVideo.overlayPlacement`, which lives in stored metadata and *not* on the in-memory `Recording` row. Putting it on `Recording` would mean a new store field, a new `loadRecordings` line, a new `buildRecordingEntry` field and a change to `App`'s prop flow — for a value read once per click. `getVideo(id)` returns the blob **and** the metadata in one transaction, which is one read fewer than the `getVideoBlob(id)` it replaces, and the companion's id comes from `getAllVideoMetadata()`. `App` gains nothing and the panel gains nothing.
- **M4A is unchanged, in bytes.** The primary's audio track is the mix, so the audio-only download was already complete on a separate-tracks take. The lookup is therefore gated on `format === 'mp4'`: an M4A conversion does not read the part list, and a plain take's MP4 does not either (the lookup short-circuits on `takeId === undefined` before touching storage). A test pins both.
- **Three answers, not two.** "There is no camera part" and "there is a camera part I cannot read" are different facts and get different treatment. A take whose camera row was **deleted** is a plain take again by construction (`utils/takeOrder.ts` demotes it), nothing is left out, and nothing is said. A camera part that is *listed* and whose bytes are gone means the MP4 the user gets is missing something they recorded, so it raises `MP4_SAVED_WITHOUT_WEBCAM` — the same shape `uploadToHost`'s `'missing'` already has. The converter's own decode failure lands on the same notice through `onCompanionSkipped`, because the sentence is true either way.

- [ ] **Step 1: Write the failing lookup tests** — create `apps/craft/src/utils/takeParts.test.ts`

```ts
// Reading a take's parts back out of storage.
//
// Storage is real (fake-indexeddb), because the questions here are storage
// questions: which records belong to this take, in what order, and which of
// them still have bytes behind them. The two callers are the MP4 conversion
// (which wants the camera half and the placement to draw it with) and the host
// upload (which wants every part with its bytes).
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { loadTakeParts, loadWebcamCompanion } from './takeParts'
import { storeVideo, getDB } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import type { RecordingRole, SourceVideo } from '../store/types'

const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

function metadata(
  id: string,
  role: RecordingRole | undefined,
  extra: Partial<SourceVideo> = {}
): SourceVideo {
  return {
    id,
    name: `Recording — ${role ?? 'take'}`,
    duration: 6,
    width: 1280,
    height: 720,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 100,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
    ...(role !== undefined ? { role } : {}),
    ...extra,
  }
}

/** Store one part with bytes behind it. */
async function seed(id: string, role: RecordingRole | undefined, extra: Partial<SourceVideo> = {}) {
  const record = metadata(id, role, extra)
  await storeVideo(id, new Blob([id], { type: 'video/webm' }), record)
  return record
}

/** A four-part take: screen, camera, microphone, system audio. */
async function seedTake(): Promise<SourceVideo> {
  const primary = await seed('take-1', 'screen', {
    takeId: 'take-1',
    startOffset: 0,
    overlayPlacement: PLACEMENT,
    hasWebcam: true,
  })
  await seed('part-webcam', 'webcam', { takeId: 'take-1', startOffset: 0, hasWebcam: true })
  await seed('part-mic', 'mic', { takeId: 'take-1', startOffset: 0 })
  await seed('part-system', 'system', { takeId: 'take-1', startOffset: 0 })
  return primary
}

beforeEach(async () => {
  await clearAllRecordings()
})

describe('loadWebcamCompanion', () => {
  it('finds the camera half and carries the primary\'s placement with it', async () => {
    const primary = await seedTake()

    const lookup = await loadWebcamCompanion(primary)

    expect(lookup.kind).toBe('ready')
    if (lookup.kind !== 'ready') throw new Error('unreachable')
    expect(await lookup.companion.blob.text()).toBe('part-webcam')
    // The geometry is the *primary's*: it is the take's, written once at save
    // time, and the camera part carries none of its own.
    expect(lookup.companion.placement).toEqual(PLACEMENT)
    expect(lookup.companion.startOffset).toBe(0)
  })

  it('carries the camera part\'s own startOffset', async () => {
    const primary = await seed('take-2', 'screen', {
      takeId: 'take-2',
      overlayPlacement: PLACEMENT,
    })
    await seed('late-camera', 'webcam', { takeId: 'take-2', startOffset: 1.5 })

    const lookup = await loadWebcamCompanion(primary)

    if (lookup.kind !== 'ready') throw new Error('expected a companion')
    expect(lookup.companion.startOffset).toBe(1.5)
  })

  it('reads nothing at all for a plain take', async () => {
    // A recording made before ESCSUITE-14, or a composited PiP take: no takeId,
    // so there is nothing to look for and no storage read to make.
    const lookup = await loadWebcamCompanion(metadata('plain', undefined))

    expect(lookup).toEqual({ kind: 'none' })
  })

  it('answers none for a take whose camera row was deleted', async () => {
    const primary = await seed('take-3', 'screen', {
      takeId: 'take-3',
      overlayPlacement: PLACEMENT,
    })
    await seed('part-mic-only', 'mic', { takeId: 'take-3' })

    // Deleting the camera row on its own demotes the take to a plain one (see
    // `utils/takeOrder.ts`), so nothing is left out of the MP4 and nothing is
    // worth saying about it.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'none' })
  })

  it('answers none for a primary that carries no placement to draw with', async () => {
    const primary = await seed('take-4', 'screen', { takeId: 'take-4' })
    await seed('orphan-camera', 'webcam', { takeId: 'take-4' })

    // Without the geometry there is nowhere to put the camera. Nothing claims
    // the take ever had one either, so this is an absence rather than a loss.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'none' })
  })

  it('answers unavailable when the camera part is listed and its bytes are gone', async () => {
    const primary = await seedTake()
    const db = await getDB()
    await db.delete('videos', 'part-webcam')
    // Put the metadata back with no blob behind it — a half-failed save, or
    // storage cleared under the tab.
    await db.put('videos', {
      id: 'part-webcam',
      blob: undefined as unknown as Blob,
      metadata: metadata('part-webcam', 'webcam', { takeId: 'take-1' }),
    })

    // Listed but not readable: the MP4 is still worth writing, and the caller
    // is the one that says what is missing from it.
    expect(await loadWebcamCompanion(primary)).toEqual({ kind: 'unavailable' })
  })
})

describe('loadTakeParts', () => {
  it('lists every part with its bytes, the primary first then camera and sound', async () => {
    await seedTake()

    const parts = await loadTakeParts('take-1')

    // Role order, not storage order: every part of a take shares one
    // `recordedAt`, so the timestamp cannot order them and `getAll` returns
    // uuid order, which is a coin toss.
    expect(parts.map((part) => part.role)).toEqual(['screen', 'webcam', 'mic', 'system'])
    expect(parts.map((part) => part.id)).toEqual([
      'take-1',
      'part-webcam',
      'part-mic',
      'part-system',
    ])
    expect(parts.map((part) => part.name)).toEqual([
      'Recording — screen',
      'Recording — webcam',
      'Recording — mic',
      'Recording — system',
    ])
    expect(parts.every((part) => part.startOffset === 0)).toBe(true)
    expect(await parts[1].blob.text()).toBe('part-webcam')
  })

  it('lists nothing for a take that is one file', async () => {
    await seed('solo', 'screen', { takeId: 'solo', overlayPlacement: PLACEMENT })

    // `parts` exists to name files a host would not otherwise know about. A
    // list holding only the blob already on `payload.blob` names none of them,
    // so there is nothing to send.
    expect(await loadTakeParts('solo')).toEqual([])
  })

  it('leaves out a part whose bytes are gone rather than listing it empty', async () => {
    await seedTake()
    const db = await getDB()
    await db.put('videos', {
      id: 'part-mic',
      blob: undefined as unknown as Blob,
      metadata: metadata('part-mic', 'mic', { takeId: 'take-1' }),
    })

    // A host reading `parts` iterates blobs; an entry it cannot read is worse
    // than an entry that is not there.
    const parts = await loadTakeParts('take-1')
    expect(parts.map((part) => part.role)).toEqual(['screen', 'webcam', 'system'])
  })

  it('sorts a role it does not know last, without dropping it', async () => {
    await seedTake()
    await seed('part-future', 'captions' as RecordingRole, { takeId: 'take-1' })

    // A part written by a newer ESCAPECRAFT is still the host's to have.
    const parts = await loadTakeParts('take-1')
    expect(parts[parts.length - 1].id).toBe('part-future')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/takeParts.test.ts`
Expected: FAIL — `Failed to resolve import "./takeParts"`.

- [ ] **Step 3: Implement `utils/takeParts.ts`**

```ts
// Reading a take's parts back out of storage.
//
// A take is several files since ESCSUITE-14, and two things need them back: the
// MP4 conversion, which re-composites the screen and the camera into one file
// (decision 3), and "Upload to host", which hands the embedding page every part
// in one message (decision 4). Both are the same storage question — which
// records share this `takeId`, in what order, and which of them still have
// bytes — so both live here rather than in the hook and the poster.
//
// The take is named by its primary: a primary's `takeId` is its own id (see
// `utils/recordingMetadata.ts`), so grouping is one equality and no part needs
// a second identifier.
import { getAllVideoMetadata, getVideoBlob } from '../core/storage';
import { companionRank } from './companionParts';
import type { CompositeCompanion } from '../core/converter';
import type { RecordingRole, SourceVideo } from '../store/types';

/**
 * What a take's camera half turned out to be — three answers, because two of
 * them are not the same fact.
 *
 * `'none'` is an *absence*: a plain take, a take recorded before ESCSUITE-14,
 * or a take whose camera row was deleted on its own — which demotes it to a
 * plain take by construction (`utils/takeOrder.ts`). Nothing is left out of the
 * MP4, so nothing is worth saying about it.
 *
 * `'unavailable'` is a *loss*: the camera part is listed and its bytes are not
 * readable. The MP4 is still worth writing, and the caller is what tells the
 * user the file is missing something they recorded.
 */
export type WebcamCompanionLookup =
  | { kind: 'none' }
  | { kind: 'ready'; companion: CompositeCompanion }
  | { kind: 'unavailable' };

/**
 * The camera half of `primary`'s take, ready for `convertToMP4`.
 *
 * The placement comes from the **primary**, which is where it is stored: it is
 * the take's geometry, written once at save time from the recording config, and
 * the camera part carries none of its own. Without it there is nowhere to put
 * the camera, and nothing claiming the take ever had one, so that is an absence
 * rather than a loss.
 */
export async function loadWebcamCompanion(
  primary: SourceVideo
): Promise<WebcamCompanionLookup> {
  // A plain take: no storage read at all, which is what keeps a conversion of
  // an ordinary recording exactly as cheap as it was before this existed.
  if (primary.takeId === undefined || primary.overlayPlacement === undefined) {
    return { kind: 'none' };
  }

  const part = (await getAllVideoMetadata()).find(
    (metadata) => metadata.takeId === primary.takeId && metadata.role === 'webcam'
  );
  if (!part) return { kind: 'none' };

  const blob = await getVideoBlob(part.id);
  if (!blob) return { kind: 'unavailable' };

  return {
    kind: 'ready',
    companion: {
      blob,
      placement: primary.overlayPlacement,
      // 0 for every take this recorder writes — both halves come from one
      // `start()` on one clock — and read back rather than assumed, because it
      // is stored per part.
      startOffset: part.startOffset ?? 0,
    },
  };
}

/** One part of a take, as `UPLOAD_RECORDING.parts` lists it. */
export interface UploadPart {
  id: string;
  role: RecordingRole;
  name: string;
  blob: Blob;
  startOffset: number;
}

/** Where a part sits in the take's list: the primary, then its companions in role order. */
function partRank(role: string | undefined): number {
  // -1 rather than 0: the primary comes before `companionRank`'s first entry
  // without that function having to know the primary exists.
  return role === undefined || role === 'screen' ? -1 : companionRank(role);
}

/**
 * Every part of the take named by `takeId`, primary first, each with its bytes
 * — or an empty list when this take is one file.
 *
 * Empty for a single-file take on purpose: `parts` exists to name files the
 * host would not otherwise know about, and a list holding only the blob already
 * on `payload.blob` names none of them.
 */
export async function loadTakeParts(takeId: string): Promise<UploadPart[]> {
  const records = (await getAllVideoMetadata()).filter(
    (metadata) => metadata.takeId === takeId
  );
  if (records.length < 2) return [];

  // Role order, and the id as the tie-break so the answer never depends on what
  // the engine's sort happened to do: every part of a take shares one
  // `recordedAt`, so the timestamp cannot order them and `getAll` returns them
  // in uuid order.
  const ordered = [...records].sort(
    (a, b) => partRank(a.role) - partRank(b.role) || a.id.localeCompare(b.id)
  );

  const parts: UploadPart[] = [];
  for (const record of ordered) {
    const blob = await getVideoBlob(record.id);
    // A part whose bytes are gone is left out rather than listed with nothing
    // in it: a host reading `parts` iterates blobs, and an entry it cannot read
    // is worse than an entry that is not there.
    if (!blob) continue;
    parts.push({
      id: record.id,
      // A record with no role is the take itself — the shape every recording
      // made before ESCSUITE-14 has.
      role: record.role ?? 'screen',
      name: record.name,
      blob,
      startOffset: record.startOffset ?? 0,
    });
  }
  return parts;
}
```

- [ ] **Step 4: Run the lookup tests**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/takeParts.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing hook tests** — append to `apps/craft/src/hooks/useMp4Download.test.ts`

```ts
describe('useMp4Download for a take recorded as separate tracks', () => {
  const PLACEMENT = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  /** Seed a take: the primary with its placement, and the camera half. */
  async function seedTake(options: { camera: boolean }): Promise<void> {
    await storeVideo('take-1', new Blob(['screen-bytes'], { type: 'video/webm' }), {
      ...metadata('take-1', 'Standup Demo'),
      takeId: 'take-1',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: PLACEMENT,
      hasWebcam: true,
      hasAudio: true,
    })
    if (options.camera) {
      await storeVideo('part-2', new Blob(['camera-bytes'], { type: 'video/webm' }), {
        ...metadata('part-2', 'Standup Demo — webcam'),
        takeId: 'take-1',
        role: 'webcam',
        startOffset: 0,
        hasWebcam: true,
        hasAudio: false,
      })
    }
  }

  it('hands the converter the camera half and the take\'s placement', async () => {
    await seedTake({ camera: true })
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo')
    })

    const [blob, , , composite] = converterModule.convertToMP4.mock.calls[0]
    // The screen half's bytes, as always — and the camera's beside them, with
    // the geometry the take was recorded with.
    expect(await (blob as Blob).text()).toBe('screen-bytes')
    expect(await composite!.companion.blob.text()).toBe('camera-bytes')
    expect(composite!.companion.placement).toEqual(PLACEMENT)
    expect(composite!.companion.startOffset).toBe(0)
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'standup_demo.mp4' }])
    // A composite that worked is not worth a sentence: the file is what was
    // asked for, and the channel is cleared as it is after any conversion.
    expect(setNotice.mock.calls).toEqual([[null]])
  })

  it('asks for no companion at all on a plain take', async () => {
    await seed('plain', 'Plain Take')
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('plain', 'Plain Take')
    })

    // Three arguments, exactly as before this feature existed: a recording with
    // no `takeId` is not a take with parts, and the lookup makes no storage
    // read to discover that.
    expect(converterModule.convertToMP4.mock.calls[0][3]).toBeUndefined()
  })

  it('asks for no companion for an M4A, because the primary is already the mix', async () => {
    await seedTake({ camera: true })
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo', 'm4a')
    })

    // convertToM4A takes three arguments and always will: the microphone and
    // system parts are a second tap on tracks the mix already read, so the
    // primary's audio track *is* the mix and the audio-only download was
    // complete the day slice 1 shipped.
    expect(converterModule.convertToM4A).toHaveBeenCalledTimes(1)
    expect(converterModule.convertToM4A.mock.calls[0]).toHaveLength(3)
  })

  it('says the file has no webcam in it when the camera part is listed and gone', async () => {
    await seedTake({ camera: true })
    // The row is in storage; its bytes are not.
    const db = await getDB()
    await db.put('videos', {
      id: 'part-2',
      blob: undefined as unknown as Blob,
      metadata: {
        ...metadata('part-2', 'Standup Demo — webcam'),
        takeId: 'take-1',
        role: 'webcam',
      },
    })
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo')
    })

    // The MP4 is still written and still downloaded — a screen-only MP4 is a
    // real file — and the user is told what is not in it.
    expect(converterModule.convertToMP4.mock.calls[0][3]).toBeUndefined()
    expect(clicks).toHaveLength(1)
    expect(setNotice).toHaveBeenLastCalledWith(MP4_SAVED_WITHOUT_WEBCAM)
  })

  it('says the same thing when the converter could not decode the camera part', async () => {
    await seedTake({ camera: true })
    converterModule.convertToMP4.mockImplementation(async (blob, onProgress, _signal, composite) => {
      onProgress({ phase: 'preparing', progress: 0, message: 'Preparing conversion...' })
      // What the real converter does with a camera part that will not load: it
      // says so and writes the screen alone.
      composite?.onCompanionSkipped?.()
      return new Blob([blob as Blob], { type: 'video/mp4' })
    })
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo')
    })

    expect(clicks).toHaveLength(1)
    expect(setNotice).toHaveBeenLastCalledWith(MP4_SAVED_WITHOUT_WEBCAM)
  })

  it('says nothing about a webcam when the camera row was simply deleted', async () => {
    await seedTake({ camera: false })
    const { result } = renderMp4Download()

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo')
    })

    // Deleting the camera row demotes the take to a plain one, so nothing is
    // left out and there is nothing to report.
    expect(setNotice.mock.calls).toEqual([[null]])
  })

  it('prefers the missing webcam to the missing audio when both are true', async () => {
    await seedTake({ camera: true })
    const db = await getDB()
    await db.put('videos', {
      id: 'part-2',
      blob: undefined as unknown as Blob,
      metadata: { ...metadata('part-2', 'webcam'), takeId: 'take-1', role: 'webcam' },
    })
    const { result } = renderMp4Download(MP4_SILENT)

    await act(async () => {
      await result.current.startMp4Download('take-1', 'Standup Demo')
    })

    // There is one notice channel, and the silent-MP4 warning was already said
    // *before* the conversion, under the library, where the camera loss could
    // not yet be known. So the surprising fact wins the one slot.
    expect(setNotice).toHaveBeenLastCalledWith(MP4_SAVED_WITHOUT_WEBCAM)
  })
})
```

Add to that file's imports: `MP4_SAVED_WITHOUT_WEBCAM` from `../utils/notices`, and `getDB` from `../core/storage`.

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useMp4Download.test.ts`
Expected: FAIL — `MP4_SAVED_WITHOUT_WEBCAM` is not exported (`SyntaxError`), and once it is, `expected undefined to be defined` on `composite!.companion`.

- [ ] **Step 7: Add the notice**

Append to `apps/craft/src/utils/notices.ts`:

```ts
/**
 * Said after a conversion that could not include the take's camera part.
 *
 * Two things reach it: the part was listed and its bytes were gone
 * (`utils/takeParts.ts` answers `'unavailable'`), or its container would not
 * decode (`convertToMP4` calls `onCompanionSkipped`). One sentence for both,
 * because the fact the user can act on is the same — the MP4 they now have is
 * the screen alone, and the camera is still downloadable as WebM from its own
 * row.
 *
 * It wins the channel over `MP4_SAVED_WITHOUT_AUDIO` when both are true: the
 * silent-MP4 warning is said *before* the conversion too, under the library,
 * where a camera loss cannot yet be known.
 */
export const MP4_SAVED_WITHOUT_WEBCAM =
  'Saved as MP4 — without the webcam: its own track could not be read'
```

Update that file's own header comment count: `// The app's whole vocabulary of notices — eleven strings and one one-argument string`. (The module table entry in `apps/craft/CLAUDE.md` says "ten strings"; Task 8 corrects it.)

- [ ] **Step 8: Wire the hook**

In `apps/craft/src/hooks/useMp4Download.ts`, change the storage import and add two:

```ts
import { getVideo } from '../core/storage'
import { loadWebcamCompanion } from '../utils/takeParts'
import { mp4ConversionFailed, MP4_SAVED_WITHOUT_AUDIO, MP4_SAVED_WITHOUT_WEBCAM } from '../utils/notices'
```

Replace the body of `startMp4Download` from `try {` down to the `downloadBlob(...)` line:

```ts
    try {
      // The blob *and* its metadata in one read. The metadata is what says
      // whether this recording is one part of a take and where the overlay sat
      // while it was recorded — neither of which the in-memory `Recording` row
      // carries, and neither of which is worth a store field for a value read
      // once per click.
      const record = await getVideo(id)
      if (!record) return

      // A take recorded as separate tracks is put back together here: the MP4
      // is the screen with the camera drawn into the corner it was recorded in
      // (ESCSUITE-14 decision 3). M4A asks for none of this — the mix is on the
      // primary, so the audio-only download was already the whole take.
      const lookup = format === 'mp4'
        ? await loadWebcamCompanion(record.metadata)
        : ({ kind: 'none' } as const)
      // True when the camera part was *listed* and could not be used — its
      // bytes were gone (here) or it would not decode (inside the converter).
      // A take whose camera row was deleted is a plain take again and leaves
      // nothing out, so it never sets this.
      let webcamSkipped = lookup.kind === 'unavailable'

      const report = ({ message, progress }: ConversionProgress) =>
        setConverting({ id, format, message, progress })

      const converted =
        format === 'm4a'
          ? await convertToM4A(record.blob, report, controller.signal)
          : await convertToMP4(
              record.blob,
              report,
              controller.signal,
              lookup.kind === 'ready'
                ? {
                    companion: lookup.companion,
                    onCompanionSkipped: () => {
                      webcamSkipped = true
                    },
                  }
                : undefined
            )

      // Abort does not always reject. `convertToMP4` checks the signal while
      // it encodes, but there is no check between the last frame and the
      // muxer's `finalize()` — and on a take with no audio, none after frame
      // capture at all — so a late cancel comes back as a finished MP4. The
      // user asked for no file.
      if (controller.signal.aborted) return

      analytics.recordingDownloaded()
      // A conversion that worked makes any earlier "MP4 conversion failed"
      // untrue, and this is the one channel, so it is cleared here. It clears
      // whatever is in the region, not only an MP4 notice — the price of
      // having exactly one. Where the browser had no AAC encoder the file that
      // just landed is silent, and that is what the channel says instead: the
      // same fact the note said beforehand, now about a file they have.
      // An M4A only ever runs where the probe said AAC is there, so that is
      // `null` for it by construction — the silent-file warning is an MP4 fact.
      //
      // A missing camera outranks a missing AAC encoder. Both can be true, and
      // there is one slot: the silent-MP4 warning was already said under the
      // library *before* the conversion, where the camera loss could not be
      // known, so the surprising fact is the one that gets said afterwards.
      setNotice(
        webcamSkipped
          ? MP4_SAVED_WITHOUT_WEBCAM
          : mp4Support.audio
            ? null
            : MP4_SAVED_WITHOUT_AUDIO
      )
      downloadBlob(converted, `${safeFileName(name)}.${format}`)
```

Add `ConversionProgress` to the type import from `../core/converter`.

Update the hook's header comment, after the first paragraph:

```
// A take recorded as separate tracks is put back together on the way out: the
// MP4 is the screen with the camera drawn back into the corner it was recorded
// in, resolved out of storage here by `utils/takeParts.ts`. M4A is unchanged —
// the primary's audio track already is the mix.
```

- [ ] **Step 9: Run the hook tests and the pinned render contracts**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useMp4Download.test.ts`
Expected: PASS — the 7 new tests and every pre-existing one, including "does nothing when the stored blob has gone missing" (`getVideo` returns `undefined` for an id with no record, exactly as `getVideoBlob` did).

Run: `pnpm --filter @escapesuite/craft exec vitest run src/App.mp4rerender.test.tsx src/App.rerender.test.tsx`
Expected: PASS, both files unmodified — the hook still lives in `RecordingsListPanel`, still subscribes to nothing new, and a progress tick still costs `App` zero renders.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/craft/src/utils/takeParts.ts apps/craft/src/utils/takeParts.test.ts \
  apps/craft/src/utils/notices.ts apps/craft/src/hooks/useMp4Download.ts \
  apps/craft/src/hooks/useMp4Download.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): "Download as MP4" on a take gives you the take (ESCSUITE-14)

The primary row's MP4 is now the composite: useMp4Download resolves the take's
camera half out of storage and hands it to convertToMP4 with the geometry the
take was recorded with. The lookup reads storage rather than the store, because
the overlayPlacement lives in stored metadata and nothing else needs it — so App
gains no selector, the panel gains no prop, and the render contract in
App.mp4rerender.test.tsx is untouched. getVideo() returns the blob and the
metadata in one transaction, which is one read fewer than the getVideoBlob it
replaces.

M4A is unchanged, in bytes, and that is a fact rather than a deferral: the
microphone and system companions are a second tap on tracks the mix already
read, so the primary's audio track IS the mix and the audio-only download has
been the whole take since slice 1. The companion lookup is gated on 'mp4', and a
plain take's MP4 makes no extra storage read at all.

Three answers, not two. A take whose camera row was deleted is a plain take by
construction (takeOrder demotes it) — nothing is left out, nothing is said. A
camera part that is listed and unreadable, or one the converter cannot decode,
still produces an MP4 and raises MP4_SAVED_WITHOUT_WEBCAM: refusing after
minutes of encoding would be strictly worse than a screen-only file the user is
told about. It outranks the silent-MP4 warning in the one notice channel,
because that one is also said beforehand, where a camera loss cannot be known.

utils/takeParts.ts also lands loadTakeParts(), which UPLOAD_RECORDING.parts
uses next — both halves of the module are the same storage question.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 4: retire the interim note

**Files:**
- Modify: `apps/craft/src/components/RecordingsList/RecordingsList.tsx:56-80`, `:136-180`, `:309-313`
- Test: `apps/craft/src/components/RecordingsList/RecordingsList.test.tsx:503-556`, `:611-621`
- Test: `apps/e2e/tests/escapecraft/separate-tracks.spec.ts:259-261`

**Interfaces:**
- Removes: `SEPARATE_TRACKS_MP4_NOTE` (was exported from `RecordingsList.tsx`) and the private `separateTracksNoteId`.
- Unchanged: every prop of `RecordingsList`, `MP4_NOTE_ID`, `companionPartFor`'s use for the row label and for hiding the two conversion buttons, and `onSendToEditor(recording.takeId ?? recording.id)`.

**Why the note is retired rather than softened, and why four tests are converted rather than deleted:**

The note said: *"MP4 and M4A cover the screen track only — the webcam track is not included yet."* Both halves of that sentence are now false. MP4 includes the webcam (Task 2 and Task 3); M4A never left anything out, because the primary's track is the mix. A softer note would have to say something true and useful, and there is nothing left: the composite is what "Download MP4" means now, and the one case where a webcam really is missing from the file is a **runtime** fact about a file the user already has, which is `MP4_SAVED_WITHOUT_WEBCAM` in the notice channel rather than a standing claim on a row. A note that says nothing is a paragraph that moves the page and teaches the user to ignore notes.

Its four tests are **converted, not deleted**, because the absence is worth pinning: three of them become "there is no such note" assertions on exactly the rows that used to carry one, and the fourth — the one that pinned `aria-describedby` listing *two* ids — becomes the assertion that the conversion buttons are described by the app-wide note and nothing else. The fifth (`says nothing of the sort on a plain take`) already asserted absence and is byte-unchanged. Net: nothing is lost, the code path is still pinned, and one of the deleted lines was the only reason `RecordingsList` walked the whole list on every render.

- [ ] **Step 1: Write the failing tests** — edit `apps/craft/src/components/RecordingsList/RecordingsList.test.tsx`

Replace the test `it('says on the primary row that its MP4 is screen-only for now', …)` with:

```ts
  it('claims nothing about a missing webcam on the primary row', () => {
    renderList([primary, companion])

    // The interim note — "MP4 and M4A cover the screen track only" — is gone
    // because both halves of it stopped being true: MP4 draws the camera back
    // into the corner it was recorded in, and M4A always had the whole mix (the
    // audio parts are a second tap, not a diversion). The one case where a file
    // really is missing the camera is a fact about a file the user already has,
    // and it goes through the notice channel as MP4_SAVED_WITHOUT_WEBCAM.
    expect(screen.queryByText(/not included yet/)).toBeNull()
    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' })
    expect(mp4).toBeEnabled()
    // Nothing describes it, because there is nothing app-wide to say either.
    expect(mp4.getAttribute('aria-describedby')).toBeNull()
  })
```

Replace `it('drops the note once the companion is gone', …)` with:

```ts
  it('says nothing of the sort on a take whose camera row is gone either', () => {
    renderList([primary])

    expect(screen.queryByText(/not included yet/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Download Standup Demo as MP4' })
    ).toBeEnabled()
  })
```

Replace `it('carries both notes at once when the browser note and the take note both apply', …)` with:

```ts
  it('is described by the app-wide note alone, on both conversion buttons', () => {
    // There used to be two notes to list here — one about the browser, one
    // about the take. The take's is retired, so `aria-describedby` is one id
    // again, and both buttons carry it because every sentence the app-wide note
    // can hold is true of both formats.
    const silent = 'MP4 will have no audio in this browser (no AAC encoder)'
    renderList([primary, companion], { mp4Note: silent })

    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' })
    const describedBy = mp4.getAttribute('aria-describedby')!
    expect(describedBy.split(' ')).toHaveLength(1)
    expect(document.getElementById(describedBy)).toHaveTextContent(silent)

    const m4a = screen.getByRole('button', { name: 'Download Standup Demo as audio (M4A)' })
    expect(m4a.getAttribute('aria-describedby')).toBe(describedBy)
  })
```

Replace `it('keeps the interim MP4 note on the take with a camera in it', …)` with:

```ts
  it('claims nothing about a missing webcam however many parts the take has', () => {
    renderList([primary, companion, micRow, systemRow])

    // Four rows, four chances to say something no longer true.
    expect(screen.queryByText(/not included yet/)).toBeNull()
    expect(screen.queryByText(/screen track only/)).toBeNull()
  })
```

Leave `it('says nothing of the sort on a plain take', …)` exactly as it is.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/RecordingsList/RecordingsList.test.tsx`
Expected: FAIL — `expected null not to be null` on the `queryByText(/not included yet/)` assertions, and `expected [ 'mp4-note', 'separate-tracks-note-take-1' ] to have a length of 1`.

- [ ] **Step 3: Delete the note from the component**

In `apps/craft/src/components/RecordingsList/RecordingsList.tsx`:

Delete the whole `SEPARATE_TRACKS_MP4_NOTE` doc comment and constant, and the `separateTracksNoteId` function with its comment (lines 58–74 in the current file, between `MP4_NOTE_ID` and `FORMAT_LABELS`).

Delete the `takesWithCompanion` block at the top of the component body (the `const takesWithCompanion = new Set(...)` and its comment), so the function body starts at `return (`.

Inside the `recordings.map` callback, delete `const hasCompanion = ...` and `const noteId = ...`, and replace the `conversionDescribedBy` computation with:

```ts
            // Every companion row — camera or sound — says which track it is
            // and carries no conversions: those are the take's downloads and
            // live on the primary row.
            const companionLabel = companionPartFor(recording.role);
            // One note for the whole library, and only while there is one: it
            // is a fact about the app (a codec the browser lacks, a conversion
            // already running) rather than about this take.
            const conversionDescribedBy =
              mp4Note && !converting ? MP4_NOTE_ID : undefined;
```

Delete the trailing `{noteId && (<p className={styles.mp4BlockedReason} id={noteId}>{SEPARATE_TRACKS_MP4_NOTE}</p>)}` block.

In the component's doc comment, delete nothing and add nothing — it never named the interim note.

- [ ] **Step 4: Flip the e2e assertion**

In `apps/e2e/tests/escapecraft/separate-tracks.spec.ts`, replace:

```ts
    await expect(
      page.getByText('MP4 and M4A cover the screen track only — the webcam track is not included yet.')
    ).toHaveCount(1)
```

with:

```ts
    // Nothing on the primary row claims the downloads leave the camera out:
    // slice 4 made MP4 the composite, and M4A always had the whole mix.
    await expect(page.getByText(/not included yet/)).toHaveCount(0)
```

- [ ] **Step 5: Run everything that touches the library**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/RecordingsList`
Expected: PASS — both files, every test.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint && pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no output, exit 0.

Run: `grep -rn "SEPARATE_TRACKS_MP4_NOTE\|not included yet\|screen track only" apps/craft/src apps/e2e/tests`
Expected: only the three `queryByText`/`getByText` absence assertions in `RecordingsList.test.tsx` and the one in `separate-tracks.spec.ts`. (`apps/craft/CLAUDE.md` still mentions it — Task 8 fixes that.)

- [ ] **Step 6: Commit**

```bash
git add apps/craft/src/components/RecordingsList/RecordingsList.tsx \
  apps/craft/src/components/RecordingsList/RecordingsList.test.tsx \
  apps/e2e/tests/escapecraft/separate-tracks.spec.ts
git commit -m "$(cat <<'EOF'
feat(craft): retire the interim "screen track only" note (ESCSUITE-14)

"MP4 and M4A cover the screen track only — the webcam track is not included
yet." is now false in both halves: MP4 draws the camera back into the corner it
was recorded in, and M4A never left anything out, because the primary's audio
track is the mix. A softer note would have to say something true and useful and
there is nothing left to say; the one case where a file really is missing the
camera is a fact about a file the user already has, and that goes through the
notice channel as MP4_SAVED_WITHOUT_WEBCAM.

Its four tests are converted rather than deleted: three now assert there is no
such note on exactly the rows that used to carry one, and the one that pinned
two aria-describedby ids now pins that the conversion buttons are described by
the app-wide note alone. The fifth already asserted absence and is unchanged.

The component stops walking the whole list on every render to find which
primaries still have a camera — that set was the note's only reader.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 5: `UPLOAD_RECORDING.parts`

**Files:**
- Modify: `apps/craft/src/utils/uploadToHost.ts` (whole file)
- Test: `apps/craft/src/utils/uploadToHost.test.ts` (one new `describe`)
- Test: `apps/craft/src/components/RecordingsList/RecordingsListPanel.test.tsx` (one new test)

**Interfaces:**
- Consumes: `loadTakeParts(takeId: string): Promise<UploadPart[]>` (Task 3).
- **Unchanged signature:** `uploadToHost(id: string, name: string, part?: { role?: RecordingRole; takeId?: string }): Promise<'posted' | 'missing'>`. `RecordingsListPanel` is **not modified** — it already passes `{ role, takeId }` for any row that has them, which for the primary row means `takeId === id`, and that equality is the whole trigger.
- Produces (protocol): `payload.parts?: Array<{ id: string; role: RecordingRole; name: string; blob: Blob; startOffset: number }>`.

**Four decisions this task pins, all argued in the commit message:**

- **`payload.blob`, `id` and `name` stay the primary's, and `parts` is additive.** An older host reads exactly the three fields it always read and behaves exactly as it always did (decision 4). A host that opts in reads `parts` and gets every file of the take in one message.
- **The trigger is `part.takeId === id`, which is precisely "this row *is* the take."** The primary of a take carries its own id as its `takeId` (`utils/recordingMetadata.ts`), so no new argument and no new flag is needed, and a companion row — whose `takeId` names a different record — posts itself alone exactly as it has since slice 1.
- **`parts` is omitted when the take is one file.** A one-element array holding the same Blob that is already on `payload.blob` tells a host nothing and gives it a second code path to write for no gain. `loadTakeParts` returns `[]` below two records and the spread drops the key.
- **The companion rows keep their Upload button.** The primary's message now carries every part, so the per-row buttons are strictly redundant for a host that adopted `parts` — and they are harmless, already documented, already tested, and the only way a host that has *not* adopted `parts` can be handed one specific part. Removing them would be a behaviour regression for every embedder that shipped against slice 1. They stay, and Task 8 documents that they do.

- [ ] **Step 1: Write the failing tests** — append to `apps/craft/src/utils/uploadToHost.test.ts`

```ts
  describe('a take recorded as separate tracks', () => {
    /** Every part's bytes, keyed by id, as storage would hand them back. */
    const blobs: Record<string, Blob> = {
      'take-1': new Blob(['screen'], { type: 'video/webm' }),
      'part-webcam': new Blob(['camera'], { type: 'video/webm' }),
      'part-mic': new Blob(['mic'], { type: 'audio/webm' }),
    }

    beforeEach(() => {
      getVideoBlobMock.mockImplementation(async (id: string) => blobs[id]);
      getAllVideoMetadataMock.mockResolvedValue([
        {
          id: 'part-mic',
          name: 'Standup Demo — microphone',
          takeId: 'take-1',
          role: 'mic',
          startOffset: 0,
        },
        {
          id: 'take-1',
          name: 'Standup Demo',
          takeId: 'take-1',
          role: 'screen',
          startOffset: 0,
        },
        {
          id: 'part-webcam',
          name: 'Standup Demo — webcam',
          takeId: 'take-1',
          role: 'webcam',
          startOffset: 0,
        },
      ] as unknown as Awaited<ReturnType<typeof getAllVideoMetadata>>);
    });

    it('carries every part of the take, primary first, in one message', async () => {
      const result = await uploadToHost('take-1', 'Standup Demo', {
        role: 'screen',
        takeId: 'take-1',
      });

      expect(result).toBe('posted');
      const [message] = postMessage.mock.calls[0] as [
        { payload: { id: string; name: string; blob: Blob; parts: Array<{ id: string; role: string; name: string; blob: Blob; startOffset: number }> } },
        string,
      ];
      // The three fields a host that knows nothing of takes reads are exactly
      // what they always were: the primary's id, name and bytes.
      expect(message.payload.id).toBe('take-1');
      expect(message.payload.name).toBe('Standup Demo');
      expect(message.payload.blob).toBe(blobs['take-1']);
      // …and `parts` lists every file, the primary included, in role order —
      // never storage order, which is uuid order because every part of a take
      // shares one `recordedAt`.
      expect(message.payload.parts.map((part) => part.role)).toEqual([
        'screen',
        'webcam',
        'mic',
      ]);
      expect(message.payload.parts.map((part) => part.id)).toEqual([
        'take-1',
        'part-webcam',
        'part-mic',
      ]);
      expect(message.payload.parts[1].name).toBe('Standup Demo — webcam');
      expect(message.payload.parts[1].startOffset).toBe(0);
      // The same Blob, not a copy of it: a structured clone of a Blob is a
      // handle, so listing the primary twice costs a reference and not bytes.
      expect(message.payload.parts[0].blob).toBe(message.payload.blob);
    });

    it('posts a companion row on its own, with no parts list', async () => {
      await uploadToHost('part-webcam', 'Standup Demo — webcam', {
        role: 'webcam',
        takeId: 'take-1',
      });

      // A companion row's `takeId` names a different record, so this row is not
      // the take — it is one part of it, and it posts itself. Unchanged from
      // slice 1, and the only way a host that has not adopted `parts` can be
      // handed one specific part.
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'UPLOAD_RECORDING',
          payload: {
            id: 'part-webcam',
            name: 'Standup Demo — webcam',
            blob: blobs['part-webcam'],
            role: 'webcam',
            takeId: 'take-1',
          },
        },
        '*'
      );
    });

    it('sends no parts list for a take that is one file', async () => {
      getAllVideoMetadataMock.mockResolvedValue([
        { id: 'solo', name: 'Solo', takeId: 'solo', role: 'screen' },
      ] as unknown as Awaited<ReturnType<typeof getAllVideoMetadata>>);
      getVideoBlobMock.mockResolvedValue(blob);

      await uploadToHost('solo', 'Solo', { role: 'screen', takeId: 'solo' });

      // `parts` exists to name files the host would not otherwise know about. A
      // list holding only the blob already on `payload.blob` names none of them
      // — and would give the host a second code path for nothing.
      const [message] = postMessage.mock.calls[0] as [{ payload: Record<string, unknown> }, string];
      expect('parts' in message.payload).toBe(false);
    });

    it('leaves out a part whose bytes are gone rather than listing it empty', async () => {
      getVideoBlobMock.mockImplementation(async (id: string) =>
        id === 'part-mic' ? undefined : blobs[id]
      );

      await uploadToHost('take-1', 'Standup Demo', { role: 'screen', takeId: 'take-1' });

      const [message] = postMessage.mock.calls[0] as [
        { payload: { parts: Array<{ role: string }> } },
        string,
      ];
      expect(message.payload.parts.map((part) => part.role)).toEqual(['screen', 'webcam']);
    });
  });
```

Extend that file's `vi.mock('../core/storage')` factory and its typed handles:

```ts
vi.mock('../core/storage', () => ({
  getVideoBlob: vi.fn(),
  getAllVideoMetadata: vi.fn(async () => []),
}));

const getVideoBlobMock = getVideoBlob as Mock<typeof getVideoBlob>;
const getAllVideoMetadataMock = getAllVideoMetadata as Mock<typeof getAllVideoMetadata>;
```

and add `getAllVideoMetadata` to the `import { getVideoBlob } from '../core/storage'` line. In the existing top-level `beforeEach`, after `getVideoBlobMock.mockResolvedValue(blob);`, add `getAllVideoMetadataMock.mockResolvedValue([]);` — which is what makes every pre-existing test in the file (all of which pass no `takeId`, or a `takeId` that is not the row's own id) keep asserting exactly the payload it asserts today.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/uploadToHost.test.ts`
Expected: FAIL — `expected undefined to be an array` / `Cannot read properties of undefined (reading 'map')` on `message.payload.parts`.

- [ ] **Step 3: Implement it**

Replace `apps/craft/src/utils/uploadToHost.ts`:

```ts
// Hands a finished recording's bytes to the page embedding ESCAPECRAFT.
//
// The shared IndexedDB is enough when the host's editor is same-origin — that
// is what `sendToEditor` relies on — but a host that wants the file itself
// (to upload it, to attach it, to keep it) cannot reach into another origin's
// database. So this posts the blob out: `UPLOAD_RECORDING` carries the stored
// `Blob` by structured clone, which is how a `Blob` crosses a postMessage
// boundary without `arrayBuffer()` copying a gigabyte take into the heap
// twice.
//
// Since ESCSUITE-14 a take can be several files, and the primary row's message
// carries all of them at once as `payload.parts` — see the adoption note in the
// root `CLAUDE.md`. `payload.blob`, `payload.id` and `payload.name` are the
// primary's, unchanged, so a host that knows nothing of takes receives exactly
// what it always received.
//
// Only an embedded CRAFT can do this — there is no one to post to otherwise —
// but the decision is the caller's: `RecordingsListPanel` asks `isEmbedded()`
// and only then offers the button. No analytics event: what a host does with
// its own recordings is the host's business.

import { parseHostOrigin } from '@escapesuite/shared/config';
import { getVideoBlob } from '../core/storage';
import { loadTakeParts } from './takeParts';
import type { RecordingRole } from '../store/types';

export const uploadToHost = async (
  id: string,
  name: string,
  /**
   * Which half of which take this row is, when it is one.
   *
   * Two things follow from it. `role` and `takeId` are added to the payload,
   * so a host can say what it is holding — added only when the row has them, so
   * a plain take's payload is byte-for-byte what it was before this feature
   * existed. And when `takeId` is the row's **own** id the row *is* the take
   * (a primary carries its own id as its `takeId`, see
   * `utils/recordingMetadata.ts`), which is what makes this message the one
   * that carries every part.
   */
  part?: { role?: RecordingRole; takeId?: string }
): Promise<'posted' | 'missing'> => {
  const blob = await getVideoBlob(id);
  // The row is drawn from store metadata, which can outlive the blob — a
  // failed save, or storage cleared under the tab. Nothing is posted then;
  // the caller says so through the app's one notice channel.
  if (!blob) return 'missing';

  // Every part of the take, in one message, when this row names the take.
  // A companion row's `takeId` names a different record, so it posts itself
  // alone exactly as it has since slice 1 — which is still the only way a host
  // that has not adopted `parts` can be handed one specific part.
  const parts = part?.takeId === id ? await loadTakeParts(id) : [];

  // A host that named itself with `?hostOrigin=` gets the post addressed to
  // that origin; otherwise it goes to whoever is framing us.
  const targetOrigin = parseHostOrigin() ?? '*';
  window.parent.postMessage(
    {
      type: 'UPLOAD_RECORDING',
      payload: {
        id,
        name,
        blob,
        ...(part?.role !== undefined ? { role: part.role } : {}),
        ...(part?.takeId !== undefined ? { takeId: part.takeId } : {}),
        // Absent for a take that is one file: a list holding only the blob
        // already above it names nothing the host does not have.
        ...(parts.length > 0 ? { parts } : {}),
      },
    },
    targetOrigin
  );
  return 'posted';
};
```

- [ ] **Step 4: Write the failing panel test** — append to `RecordingsListPanel.test.tsx`'s upload describe

```ts
  it('names the take on the primary row, which is what carries every part', async () => {
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    renderPanel([
      { ...baseRecording, id: 'take-1', name: 'Standup Demo', takeId: 'take-1', role: 'screen' as const },
      { ...baseRecording, id: 'part-2', name: 'Standup Demo — webcam', takeId: 'take-1', role: 'webcam' as const },
    ])

    await user.click(screen.getByRole('button', { name: 'Upload Standup Demo to host' }))

    // `takeId === id` on the primary row is the whole trigger for
    // `payload.parts` (see `utils/uploadToHost.ts`), so the panel passing the
    // row's own takeId through is load-bearing rather than incidental — it has
    // been true since slice 1 and this is what keeps it true.
    expect(uploadToHostMock).toHaveBeenCalledWith('take-1', 'Standup Demo', {
      role: 'screen',
      takeId: 'take-1',
    })
  })
```

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/uploadToHost.test.ts src/components/RecordingsList/RecordingsListPanel.test.tsx`
Expected: PASS — the 4 new `uploadToHost` tests, the new panel test, and every pre-existing test in both files. In particular `posts UPLOAD_RECORDING to the parent with the id, the name and the stored blob` must still assert the exact three-field payload, and `names the part when the row is half of a take` must still assert the exact five-field one.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/craft/src/utils/uploadToHost.ts apps/craft/src/utils/uploadToHost.test.ts \
  apps/craft/src/components/RecordingsList/RecordingsListPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(craft): UPLOAD_RECORDING carries every part of a take (ESCSUITE-14)

The primary row's message gains an optional payload.parts — [{ id, role, name,
blob, startOffset }] for every file of the take, the primary included, in role
order. payload.blob, payload.id and payload.name are still the primary's, so a
host that knows nothing of takes receives exactly what it always received
(decision 4) and every embedder that shipped against slice 1 is unaffected.

No signature change: the trigger is `part.takeId === id`, which is precisely
"this row is the take" — a primary carries its own id as its takeId. So
RecordingsListPanel is untouched, and a companion row still posts itself alone,
which stays the only way a host that has not adopted `parts` can be handed one
specific part. The companion rows keep their Upload button for that reason.

parts is omitted when the take is one file: a one-element list holding the same
Blob as payload.blob tells a host nothing and costs it a second code path. A
part whose bytes are gone is left out rather than listed empty — a host reading
parts iterates blobs.

Message size is a reference count, not a copy: a Blob crosses a structured
clone as a handle, so listing the primary in both places costs nothing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 6: e2e — a composite MP4 that decodes, and a take that arrives whole

**Files:**
- Modify: `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` (extract the recording steps; add one test)
- Modify: `apps/e2e/tests/integration/host-embedding.spec.ts` (two helpers, one widened captured shape, one test)

**Interfaces:**
- Produces (spec-local): `recordSeparateTracksTake(page: Page): Promise<void>` in `separate-tracks.spec.ts`; `probeMp4(page: Page, base64: string): Promise<Mp4Probe>` in the same file.
- Produces (spec-local): `seedCraftTake(page: Page, name: string): Promise<{ primaryId: string; webcamId: string; micId: string }>` and `clearHostMessages(page: Page): Promise<void>` in `host-embedding.spec.ts`; `CapturedMessage.parts`.
- Consumes: `canConvertToMp4` from `../../utils/webcodecs`.

**What the composite e2e claims, and why that claim rather than a pixel colour:** it decodes the downloaded MP4 in the page, checks its dimensions against the primary part's stored size and its duration, and then samples two equal boxes of one frame — the overlay's own box in the bottom-right corner, and its mirror on the left at the same height. `mockSyntheticMedia` paints a **flat** `hsl()` fill with one line of text near the vertical centre, so a screen-only MP4's corner is uniform to within codec noise while a composite's is not: the overlay's white border, the circular clip's edges and the camera's own picture put a large spread into that box and nowhere else. Asserting a *colour* would depend on which hue two independently-started canvas animations happened to be on; asserting **uniform here, not uniform there** depends only on the overlay existing.

- [ ] **Step 1: Extract the recording steps in `separate-tracks.spec.ts`**

Move the body of the existing test, from `await mockSyntheticMedia(page)` down to and including the `await page.getByRole('button', { name: 'Stop recording' }).click()` line, into a function above `test.describe`, and leave every assertion in the test exactly as it is:

```ts
/**
 * Record one real four-part take: screen, camera, microphone and system audio.
 *
 * Shared by both tests in this file, because both need the same take and only
 * one of them is about how it was made. Every wait and every `aria-pressed`
 * check is the original test's, unchanged — a click that did not land would
 * otherwise show up as a missing part rather than as a missing click.
 */
async function recordSeparateTracksTake(page: Page): Promise<void> {
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)

  await page.goto(CRAFT_URL)
  await page.waitForLoadState('networkidle')

  // …the existing body, verbatim, down to the Stop click…
}
```

The existing test then becomes:

```ts
  test('stores the screen, the webcam and each audio source as parts of one take', async ({ page }) => {
    test.setTimeout(120_000)

    await recordSeparateTracksTake(page)

    // Four rows, so every part was saved.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(4, {
      timeout: 60_000,
    })

    // …the rest of the existing assertions, unchanged (including the
    // `not included yet` count of 0 from Task 4)…
  })
```

- [ ] **Step 2: Add the composite MP4 test** — append inside the same `test.describe`

```ts
  /** What the page makes of a downloaded MP4, and of one frame of it. */
  interface Mp4Probe {
    width: number
    height: number
    duration: number
    /** Widest per-channel range inside the overlay's own box. */
    overlaySpread: number
    /** …and inside a box of the same size on the other side of the frame. */
    plainSpread: number
  }

  /**
   * Decode `base64` in the page, draw a frame from the middle of it, and measure
   * how much the pixels vary in two boxes.
   *
   * `mockSyntheticMedia` paints a flat `hsl()` fill with one line of text near
   * the vertical centre, so a screen-only frame is uniform in *both* boxes to
   * within codec noise. The overlay — its white border, the circular clip's
   * edges, the camera's own picture — is the only thing that can put a large
   * range into one box and not the other, which makes this claim independent of
   * which hue either source canvas happened to be on.
   */
  async function probeMp4(page: Page, base64: string): Promise<Mp4Probe> {
    return page.evaluate(async (encoded) => {
      const binary = atob(encoded)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error('the downloaded MP4 would not load in a <video>'))
          video.src = url
        })
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve()
          video.onerror = () => reject(new Error('the downloaded MP4 would not seek'))
          video.currentTime = video.duration / 2
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)

        // The overlay's box: bottom-right, 20% of the width, 16:9, 20px inset —
        // the default placement, which is what this take was recorded with.
        const boxWidth = Math.round(canvas.width * 0.2)
        const boxHeight = Math.round((boxWidth * 9) / 16)
        const inset = 20
        const spread = (x: number, y: number): number => {
          const { data } = ctx.getImageData(x, y, boxWidth, boxHeight)
          const min = [255, 255, 255]
          const max = [0, 0, 0]
          for (let i = 0; i < data.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
              const value = data[i + channel]
              if (value < min[channel]) min[channel] = value
              if (value > max[channel]) max[channel] = value
            }
          }
          return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
        }

        const boxY = canvas.height - boxHeight - inset
        return {
          width: canvas.width,
          height: canvas.height,
          duration: video.duration,
          overlaySpread: spread(canvas.width - boxWidth - inset, boxY),
          plainSpread: spread(inset, boxY),
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }, base64)
  }

  test('downloads one MP4 with the webcam composited back into it', async ({ page }) => {
    test.setTimeout(240_000)

    await recordSeparateTracksTake(page)
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(4, {
      timeout: 60_000,
    })
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    const parts = await readStoredParts(page)
    const primary = parts.find((part) => part.role === 'screen')!

    // One MP4 button in the whole library, on the primary row: the conversions
    // are the take's, not a part's.
    const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ })
    await expect(mp4Button).toHaveCount(1)
    await expect(mp4Button).toBeEnabled()

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    await mp4Button.click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp4$/)
    const bytes = readFileSync(await download.path())
    expect(bytes.byteLength).toBeGreaterThan(1000)

    // Not merely "a file arrived": the bytes go back into the page and are
    // decoded there. An MP4 the browser cannot read is not a video.
    const probe = await probeMp4(page, bytes.toString('base64'))
    // The composite is the *screen's* frame with the camera drawn into it, so
    // it is the screen part's size and not the camera's.
    expect(probe.width).toBe(primary.width)
    expect(probe.height).toBe(primary.height)
    expect(probe.duration).toBeGreaterThan(1)

    // The synthetic screen is a flat fill, so the left-hand box is uniform to
    // within codec noise…
    expect(probe.plainSpread).toBeLessThanOrEqual(12)
    // …and the corner the overlay was recorded in is not. This is the claim:
    // without the composite these two numbers would be the same.
    expect(probe.overlaySpread).toBeGreaterThan(60)

    // Back to idle: no progress row, and the button live again.
    await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0)
    await expect(mp4Button).toBeEnabled()
    // Nothing was said: the file is what was asked for. (A camera part that
    // could not be read would say so — see MP4_SAVED_WITHOUT_WEBCAM.)
    await expect(page.getByText(/without the webcam/)).toHaveCount(0)
  })
```

Add to that file's imports: `import { readFileSync } from 'node:fs'` and `import { canConvertToMp4 } from '../../utils/webcodecs'`.

- [ ] **Step 3: Add the `parts` case to `host-embedding.spec.ts`**

Widen the captured shape:

```ts
/** One part of a take as the host page can see it (Blobs reduced to what survives evaluate). */
interface CapturedPart {
  id: string
  role: string
  name: string
  startOffset: number
  blobSize: number
  blobType: string
}

/** A message as captured by the host window (Blobs reduced to what survives evaluate). */
interface CapturedMessage {
  type: string
  format?: string
  name?: string
  id?: string
  blobSize?: number
  blobType?: string
  /** Every part of a take, since ESCSUITE-14 — absent for a single-file take. */
  parts?: CapturedPart[]
}
```

and in `hostMessages`'s mapper, after `blobType`:

```ts
          // `parts` is a list of Blobs, which cannot cross the evaluate
          // boundary either — reduced to what a test can assert on.
          parts: Array.isArray(payload.parts)
            ? (payload.parts as Record<string, unknown>[]).map((part) => ({
                id: String(part.id),
                role: String(part.role),
                name: String(part.name),
                startOffset: Number(part.startOffset),
                blobSize: part.blob instanceof Blob ? part.blob.size : 0,
                blobType: part.blob instanceof Blob ? part.blob.type : '',
              }))
            : undefined,
```

Add the two helpers, beside `seedCraftRecording`:

```ts
/** Forget everything the host has heard, without dropping the frame. */
async function clearHostMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __hostMessages: unknown[] }).__hostMessages = []
  })
}

/**
 * Write a three-part take into ESCAPECRAFT's storage directly: the screen, the
 * camera and the microphone, sharing one `takeId`.
 *
 * The take is named by its primary — the primary's `takeId` is its own id — so
 * the ids here are what `payload.parts` has to come back with.
 */
async function seedCraftTake(
  page: Page,
  name: string
): Promise<{ primaryId: string; webcamId: string; micId: string }> {
  return page.evaluate(async (takeName) => {
    const primaryId = crypto.randomUUID()
    const webcamId = crypto.randomUUID()
    const micId = crypto.randomUUID()
    const recordedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      }
      request.onerror = () => reject(new Error('open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('videos', 'readwrite')
        const store = tx.objectStore('videos')
        store.put({
          id: primaryId,
          blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }),
          metadata: {
            id: primaryId,
            name: takeName,
            duration: 5,
            width: 64,
            height: 48,
            frameRate: 30,
            mimeType: 'video/webm',
            size: 2048,
            mediaType: 'video',
            source: 'recording',
            recordedAt,
            takeId: primaryId,
            role: 'screen',
            startOffset: 0,
            hasAudio: true,
            hasWebcam: true,
            overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
          },
        })
        store.put({
          id: webcamId,
          blob: new Blob([new Uint8Array(1024)], { type: 'video/webm' }),
          metadata: {
            id: webcamId,
            name: `${takeName} — webcam`,
            duration: 5,
            width: 32,
            height: 24,
            frameRate: 30,
            mimeType: 'video/webm',
            size: 1024,
            mediaType: 'video',
            source: 'recording',
            recordedAt,
            takeId: primaryId,
            role: 'webcam',
            startOffset: 0,
            hasAudio: false,
            hasWebcam: true,
          },
        })
        store.put({
          id: micId,
          blob: new Blob([new Uint8Array(512)], { type: 'audio/webm' }),
          metadata: {
            id: micId,
            name: `${takeName} — microphone`,
            duration: 5,
            width: 0,
            height: 0,
            frameRate: 0,
            mimeType: 'audio/webm',
            size: 512,
            mediaType: 'audio',
            source: 'recording',
            recordedAt,
            takeId: primaryId,
            role: 'mic',
            startOffset: 0,
            hasAudio: true,
          },
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error('write failed'))
      }
    })
    return { primaryId, webcamId, micId }
  }, name)
}
```

And the test, after the existing `'ESCAPECRAFT hands a recording\'s bytes to the host'`:

```ts
  test('ESCAPECRAFT hands the host every part of a take in one message', async ({ page }) => {
    test.setTimeout(60_000)

    await openHostPage(page, CRAFT_ORIGIN)
    const take = await seedCraftTake(page, 'Seeded Take')

    const frame = await embed(page, '/')
    const uploadTake = frame.getByRole('button', { name: 'Upload Seeded Take to host' })
    await expect(uploadTake).toBeVisible({ timeout: 30_000 })

    await uploadTake.click()

    const message = await waitForHostMessage(page, 'UPLOAD_RECORDING')
    // The three fields a host that knows nothing of takes reads are still the
    // primary's, byte for byte what they were before ESCSUITE-14.
    expect(message.id).toBe(take.primaryId)
    expect(message.name).toBe('Seeded Take')
    expect(message.blobSize).toBe(2048)
    expect(message.blobType).toContain('webm')
    // …and `parts` lists every file of the take, the primary first, each with
    // real bytes that crossed the frame boundary by structured clone.
    expect(message.parts?.map((part) => part.role)).toEqual(['screen', 'webcam', 'mic'])
    expect(message.parts?.map((part) => part.id)).toEqual([
      take.primaryId,
      take.webcamId,
      take.micId,
    ])
    expect(message.parts?.map((part) => part.blobSize)).toEqual([2048, 1024, 512])
    expect(message.parts?.map((part) => part.startOffset)).toEqual([0, 0, 0])
    expect(message.parts?.[2].blobType).toContain('audio')

    // A companion row still posts itself alone, which is the only way a host
    // that has not adopted `parts` can be handed one specific part.
    await clearHostMessages(page)
    await frame.getByRole('button', { name: 'Upload Seeded Take — webcam to host' }).click()

    const partMessage = await waitForHostMessage(page, 'UPLOAD_RECORDING')
    expect(partMessage.id).toBe(take.webcamId)
    expect(partMessage.parts).toBeUndefined()
  })
```

- [ ] **Step 4: Typecheck, lint and run both specs**

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no output, exit 0.

Run (dev servers up, per `apps/e2e/README.md`): `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft/separate-tracks.spec.ts --project=chromium`
Expected: 2 passed.

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/integration/host-embedding.spec.ts --project=chromium`
Expected: all passed, the new case included.

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft/mp4-download.spec.ts tests/escapecraft/m4a-download.spec.ts tests/escapecraft/pip-seekable.spec.ts --project=chromium`
Expected: all passed, unchanged — the plain conversion and the PiP seekability guard are untouched by this slice.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/tests/escapecraft/separate-tracks.spec.ts \
  apps/e2e/tests/integration/host-embedding.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): the composite MP4 decodes, and a take reaches the host whole (ESCSUITE-14)

separate-tracks.spec.ts records a real four-part take, converts the primary row
to MP4 and decodes the downloaded file back in the page: the screen part's
dimensions, a duration over a second, and — the actual claim — that the corner
the overlay was recorded in is *not* uniform while a box of the same size on the
other side of the frame is. The synthetic screen is a flat hsl() fill, so
without the composite those two numbers would be equal; asserting a colour
would instead depend on which hue two independently-started canvas animations
happened to be on.

The recording steps become a helper so both tests use the same take; every
assertion in the original test is unchanged.

host-embedding.spec.ts seeds a three-part take and pins the protocol from the
host's side: payload.id/name/blob are still the primary's, payload.parts lists
screen, webcam and mic with real bytes that crossed the frame boundary by
structured clone, and a companion row's own Upload still posts that row alone
with no parts list.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 7: the `craft-composite-mp4-conversion` benchmark arm

**Files:**
- Modify: `apps/e2e/utils/craftPerf.ts:339-350` (`recordPlainTake`'s neighbourhood), `:734-844` (`measureMp4Conversion`)
- Modify: `apps/e2e/tests/perf/craft-recording.spec.ts` (one new `test.describe`, and the two existing `measureMp4Conversion` call sites)
- Modify: `apps/e2e/scripts/perf-report.mjs:42-52`, `:157-180`

**Interfaces:**
- Produces: `recordSeparateTracksTake(page: Page): Promise<void>`.
- Produces: `measureMp4Conversion(page: Page, cdp: CDPSession, options?: { composite?: boolean; profileName?: string }): Promise<Mp4ConversionMeasurement>`, and `Mp4ConversionMeasurement.videoDraws: number`.
- Consumes: `openCraft(page, { webcam, separateTracks })`, `canConvertToMp4(page)`.

**Why the arm is warranted, and what its tripwire is:** the composite is the only path in the app that draws **two** videos into the encode canvas on every frame, and `taskMsPerFrame` for the plain conversion is already the number the converter is judged on. Without a second arm, a change that doubled the composite's per-frame cost — a second full-frame pass, a per-frame geometry allocation, a seek instead of a play — would move nothing anyone measures. The tripwire is exact and cheap: `videoDraws === 2 × framesEncoded`. Anything else means either the overlay was not drawn at all (the benchmark is reporting a plain conversion under this arm's name) or the screen was passed over twice. The plain arm's `framesEncoded > 0` tripwire is **unchanged** and gains no new assertion.

- [ ] **Step 1: Add the separate-tracks recording helper**

In `apps/e2e/utils/craftPerf.ts`, after `recordPlainTake`:

```ts
/**
 * Record one separate-tracks take, measuring nothing.
 *
 * The composite MP4 benchmark needs a take with a camera half in it and does
 * not care what making it cost — `craft-separate-tracks-recording` is the arm
 * that measures that. Driven through the same two helpers `measureTake` uses,
 * so the files it converts are the files the recording benchmarks produce.
 *
 * Three rows, not one: the screen, the camera and the microphone, which is what
 * `openCraft(page, { webcam: true, separateTracks: true })` asks for with
 * ESCAPECRAFT's defaults left alone (system audio is off). Waiting for fewer
 * would pass on a transient half-saved library.
 */
export async function recordSeparateTracksTake(page: Page): Promise<void> {
  const rowsBefore = await recordingRows(page).count()
  await startTake(page)
  await page.waitForTimeout(TAKE_SECONDS * 1000)
  await stopTake(page, rowsBefore + 3)
}
```

- [ ] **Step 2: Give `measureMp4Conversion` the composite tripwire**

In the same file, add to `Mp4ConversionMeasurement`:

```ts
  /**
   * `drawImage(<video>)` calls inside the conversion. One per encoded frame for
   * a plain conversion; **two** for the composite of a separate-tracks take —
   * the screen and then the camera. Nothing else in the page draws a video
   * while a conversion runs (the compositor stops at Stop, and thumbnailing
   * happens before the counters are reset), so this is the converter's own
   * count.
   */
  videoDraws: number
```

Change the signature and the two reads:

```ts
export async function measureMp4Conversion(
  page: Page,
  cdp: CDPSession,
  options: {
    /**
     * Whether the newest take is a separate-tracks one, so the conversion is
     * the composite. Turns on the two-draws-per-frame tripwire below; the plain
     * arm's assertions are untouched by it.
     */
    composite?: boolean
    profileName?: string
  } = {}
): Promise<Mp4ConversionMeasurement> {
```

`withCpuProfile(page, cdp, options.profileName, …)` replaces `withCpuProfile(page, cdp, profileName, …)`.

The counter read gains one field:

```ts
  const counters = await page.evaluate(() => ({
    framesEncoded: window.__perf.encodeCount,
    encoderQueueHighWater: window.__perf.encodeQueueHighWater,
    videoDraws: window.__perfCraft.videoDraws,
  }))
```

After the existing `framesEncoded > 0` expectation (which is unchanged), add:

```ts
  if (options.composite) {
    // Exact, and the whole reason this arm exists: a composite frame is the
    // screen drawn once and the camera drawn once. Anything else means either
    // the overlay was never drawn — in which case this is a plain conversion
    // reported under the composite's name — or the screen was passed over
    // twice, which at this capture size is the most expensive thing the loop
    // could do twice.
    expect(
      counters.videoDraws,
      'the composite did not draw exactly two videos per encoded frame'
    ).toBe(counters.framesEncoded * 2)
  }
```

and add `videoDraws: counters.videoDraws,` to the returned object.

Extend `measureMp4Conversion`'s doc comment with:

```
 * With `composite: true` the newest take is a separate-tracks one and the
 * conversion re-composites it (ESCSUITE-14 decision 3): the same encode loop
 * with a second `<video>` drawn through `drawOverlay` into the same canvas. The
 * cost difference is one `drawImage` and one clip path per frame, which is what
 * `taskMsPerFrame` between the two arms measures.
```

- [ ] **Step 3: Add the arm**

In `apps/e2e/tests/perf/craft-recording.spec.ts`, update the two existing call sites — `measureMp4Conversion(page, cdp)` is unchanged, and `measureMp4Conversion(page, cdp, 'craft-mp4')` becomes `measureMp4Conversion(page, cdp, { profileName: 'craft-mp4' })` — then append:

```ts
test.describe('perf: ESCAPECRAFT composite MP4 conversion', () => {
  test(`converts a ${TAKE_SECONDS}s separate-tracks take to one MP4, ${PERF_RUNS} times`, async ({
    page,
  }) => {
    await installCraftPerfInstrumentation(page)
    await openCraft(page, { webcam: true, separateTracks: true })

    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    // One take, converted three times, exactly as the plain arm does: the
    // conversion is bound by the take's own length, so re-recording between
    // runs would add six seconds a run and change nothing measured.
    await recordSeparateTracksTake(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    const measurements: Mp4ConversionMeasurement[] = []
    for (let run = 0; run < PERF_RUNS; run++) {
      measurements.push(await measureMp4Conversion(page, cdp, { composite: true }))
    }

    const at = (key: keyof Mp4ConversionMeasurement) => measurements.map((m) => m[key])

    writePerfResult({
      name: 'craft-composite-mp4-conversion',
      runs: PERF_RUNS,
      captureSize: CAPTURE_SIZE_LABEL,
      takeSeconds: TAKE_SECONDS,
      wallMs: round(median(at('wallMs'))),
      framesEncoded: median(at('framesEncoded')),
      framesPerSecond: round(median(at('framesPerSecond'))),
      // Published here and nowhere else: the plain arm's is one per frame by
      // construction, and this arm's is the two the overlay costs.
      videoDraws: median(at('videoDraws')),
      taskDurationMs: round(median(at('taskDurationMs'))),
      taskMsPerFrame: round(median(at('taskMsPerFrame')), 3),
      heapDeltaBytes: median(at('heapDeltaBytes')),
      encoderQueueHighWater: Math.max(...at('encoderQueueHighWater')),
      outputBytes: median(at('outputBytes')),
    })

    console.log('craft-composite-mp4-conversion runs:', JSON.stringify(measurements))

    if (PERF_PROFILE) {
      await measureMp4Conversion(page, cdp, { composite: true, profileName: 'craft-composite-mp4' })
    }
  })
})
```

Add `recordSeparateTracksTake` to the import from `../../utils/craftPerf`, and add a fifth row to the file's benchmark table in its header comment:

```
 * | `craft-composite-mp4-conversion` | `convertToMP4` again, with a second `<video>` drawn through `drawOverlay` into the same canvas — the composite of a separate-tracks take |
```

and one sentence to the list of what the `expect`s say: `…and a composite conversion whose two videos were not drawn once each per encoded frame (either the overlay was never drawn, or the screen was passed over twice).`

- [ ] **Step 4: Teach the report about it**

In `apps/e2e/scripts/perf-report.mjs`, add `'craft-composite-mp4-conversion'` to `ORDER` directly after `'craft-mp4-conversion'`; add `'craft-composite-mp4': 'ESCAPECRAFT composite MP4 conversion'` to `PROFILE_LABELS` after `'craft-mp4'`; add `'craft-composite-mp4'` to `PROFILE_ORDER` after `'craft-mp4'`. `METRICS` needs nothing — `videoDraws` is already a key there.

- [ ] **Step 5: Run it**

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no output, exit 0.

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/perf/craft-recording.spec.ts --project=chromium`
Expected: 5 passed. Every arm's JSON lands in `perf-results/`, and the composite arm's `videoDraws` is exactly twice its `framesEncoded`.

Run: `pnpm --filter @escapesuite/e2e exec node scripts/perf-report.mjs` (or the repo's `pnpm perf:report`, per `apps/e2e/package.json`)
Expected: the report table has five ESCAPECRAFT rows, `craft-composite-mp4-conversion` immediately after `craft-mp4-conversion`, with a "Video draws" cell.

Keep the console output of this run: Task 8's baseline-doc step fills its table from these numbers.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/utils/craftPerf.ts apps/e2e/tests/perf/craft-recording.spec.ts \
  apps/e2e/scripts/perf-report.mjs
git commit -m "$(cat <<'EOF'
test(e2e): a benchmark arm for the composite MP4 conversion (ESCSUITE-14)

craft-composite-mp4-conversion converts a separate-tracks take through the same
convertToMP4 the plain arm measures, with a second <video> drawn through
drawOverlay into the same canvas. It is the only path in the app that draws two
videos per encoded frame, and without an arm of its own a change that doubled
its per-frame cost — a second full-frame pass, a per-frame geometry allocation,
a seek instead of a play — would move nothing anyone measures. The difference
between the two arms' taskMsPerFrame is what one overlay costs.

Its tripwire is exact: videoDraws === 2 x framesEncoded. Anything else means the
overlay was never drawn (a plain conversion reported under this name) or the
screen was passed over twice. The plain arm's assertions are unchanged;
measureMp4Conversion takes an options object so the flag does not reach it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 8: docs, the changeset, coverage, and the ESCAPEPOD row

**Files:**
- Modify: `CLAUDE.md` (Integration API; coverage narrative and table)
- Modify: `apps/artist/src/utils/integration.ts` (the protocol comment, `UPLOAD_RECORDING`)
- Modify: `apps/craft/CLAUDE.md` (Core Modules, the module table, Download Formats, "A take can be several files")
- Modify: `docs/performance/2026-09-17-craft-baseline.md`
- Create: `.changeset/craft-composite-downloads.md`
- Modify (if a figure crossed a whole percent): `apps/craft/vite.config.ts`, `scripts/coverage-report.mjs`

**Interfaces:** none — this task writes prose, a release note, and two numbers per config file.

**What this task must NOT do:** touch `/Users/littlemac/.claude/projects/-Users-littlemac-Projects-ESCAPESUITE/memory/escapesuite-escapepod-upstream-requests.md`. That page is Confluence-backed and regenerated by the controller; Step 7 below produces the exact row text for the controller to add, in the report, and nothing else.

- [ ] **Step 1: The root `CLAUDE.md` Integration API, with the adoption note**

In `CLAUDE.md`, replace the **CRAFT → host (upload)** bullet's last paragraph (the one beginning "Since ESCSUITE-14 the payload may also carry `role` and `takeId`…") with:

```markdown
  Since ESCSUITE-14 a take can be several files, and the payload says so two ways. `role` and
  `takeId` (both optional, both absent on a single-file take) name **which** part a row's bytes
  are. And the primary row's message carries `parts` — every file of the take, the primary
  included, in role order:
  `parts?: Array<{ id: string; role: 'screen' | 'webcam' | 'mic' | 'system'; name: string; blob: Blob; startOffset: number }>`.
  `startOffset` is seconds after the take's start at which that part's first frame was captured
  (0 for every part ESCAPECRAFT records today — one recorder, one clock).

  **Adopting `parts`.** It is additive and nothing about the existing fields moved.
  - *An older host* reads `payload.id`, `payload.name` and `payload.blob` and gets exactly what
    it has always got: the **screen** part's bytes, under the take's name. It never sees `parts`
    and needs no change. Every host that shipped against slice 1 keeps working.
  - *A new host* reads `payload.parts` when it is there and falls back to `payload.blob` when it
    is not — `parts` is **absent** for a take that is one file, so `payload.parts ?? [{ id,
    name, blob, role: 'screen', startOffset: 0 }]` is the whole adoption. Each entry's `id`
    addresses the same record in the shared IndexedDB that `payload.id` does.
  - *Message size* is not a concern: a `Blob` crosses a structured clone as a handle, not a
    copy, so a four-part take's message is four references and the primary appearing in both
    `blob` and `parts[0]` costs nothing. The bytes are never read into the heap on either side.
  - *The per-row buttons stay.* A companion row's own "Upload to host" still posts that row
    alone, with `role` and `takeId` and no `parts`. It is redundant for a host that adopted
    `parts` and is the only way a host that has not can be handed one specific part.
```

Run: `grep -n "payload.parts" CLAUDE.md` — expected: the lines just written, and nothing claiming `parts` is "planned".

- [ ] **Step 2: The protocol comment in ARTIST**

In `apps/artist/src/utils/integration.ts`, replace the `UPLOAD_RECORDING` entry of the CRAFT → host section (the paragraph currently beginning `* - UPLOAD_RECORDING: { id: string, name: string, blob: Blob } - A recording's`) with:

```
 * - UPLOAD_RECORDING: { id: string, name: string, blob: Blob, role?, takeId?,
 *   parts? } - A recording's own bytes, handed to the host to do what it likes
 *   with (upload, attach, keep). Posted only when CRAFT is embedded, from a
 *   per-row "Upload to host" button that standalone CRAFT does not draw at all -
 *   there would be no one to post to. The Blob crosses by structured clone, so
 *   the host receives the file itself and does not need to reach into the shared
 *   IndexedDB; `id` still addresses the same record there, and `name` is the
 *   recording's name in the library, without an extension. Unlike
 *   SEND_TO_EDITOR, whose id is useless to a page that cannot reach CRAFT's
 *   origin, this message carries the file itself - so with no ?hostOrigin= the
 *   '*' fallback hands the bytes to whatever page is framing CRAFT, and a host
 *   that ships this action should name its origin and set frame-ancestors. See
 *   apps/craft/src/utils/uploadToHost.ts.
 *
 *   Since ESCSUITE-14 a take can be several files. `role`
 *   ('screen' | 'webcam' | 'mic' | 'system') and `takeId` are optional and
 *   absent on a single-file take, and say which part a row's bytes are. On the
 *   take's PRIMARY row the message also carries every part at once:
 *     parts?: Array<{ id: string, role: RecordingRole, name: string,
 *                     blob: Blob, startOffset: number }>
 *   - primary first, then the camera, then the sound, `startOffset` in seconds
 *   after the take's start (0 for every part CRAFT records today).
 *
 *   ADOPTING parts: it is additive. An older host reads id/name/blob and gets
 *   exactly what it always got - the screen part, under the take's name - and
 *   needs no change. A new host reads `payload.parts` when present and falls
 *   back to `payload.blob` when not; `parts` is absent for a take that is one
 *   file. Message size is not a concern, because a Blob crosses a structured
 *   clone as a handle rather than a copy: the primary appearing in both `blob`
 *   and `parts[0]` costs a reference. A companion row's own button still posts
 *   that row alone, with no `parts` - redundant for a host that adopted `parts`,
 *   and the only way one that has not can be handed a single part.
```

Run: `pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint`
Expected: no output, exit 0. (A comment cannot break either, but ARTIST is otherwise untouched by this slice and this proves it.)

- [ ] **Step 3: `apps/craft/CLAUDE.md` — Download Formats**

Replace the **MP4** bullet in the "Three options per row" list with:

```markdown
- **MP4** re-encodes that blob to H.264 + AAC in the page — `convertToMP4()` in
  `core/converter.ts`: WebCodecs decode and encode, Mediabunny mux,
  `requestVideoFrameCallback` frame capture (~real-time rather than the minutes a
  seek-based loop takes) and `MessageChannel` yielding so the conversion is not throttled
  in a background tab. Nothing leaves the machine; the offline build converts with the
  same code, which `apps/e2e/tests/standalone/craft.spec.ts` asserts alongside its
  no-off-origin-requests check. **On a take recorded as separate tracks it is a
  re-composite** — see "The composite MP4" below.
```

Then insert a new subsection immediately after the "Follow-up, inherited from `core/converter.ts`…" bullet list and before "**Still unwired:**":

```markdown
**The composite MP4** (ESCSUITE-14 decision 3). A take recorded as separate tracks is two
video files, and MP4 is the format that puts them back together: one file whose picture is
the screen with the camera drawn into the corner it was recorded in — position, size **and
shape**, the circle or rounded rectangle clipped exactly as the live compositor clips it.
The screen-only MP4 is deliberately not offered as a second option; a user who wants one
part alone downloads its WebM from that part's own row.

- **The geometry is one function, shared with the live compositor.** `drawOverlay()` in
  `core/overlayGeometry.ts` was `Compositor.drawWebcamOverlay`, and the compositor now calls
  it. So the numbers `compositor.test.ts` pins for the preview are the numbers a downloaded
  MP4 gets, and a change to one is a change to both — which was the whole point of moving it:
  two copies of the arc, the centre-crop and the two clip paths would be two places for a
  rounding difference to live, and the difference would only ever have been visible in a file
  somebody downloaded. `overlayGeometry.test.ts` pins the same values a second time so the
  shared function is red on its own.
- **The inset is scaled to the frame.** `webcamSize` is a fraction of the width and
  reproduces itself at any resolution; the 20 px padding does not, because the compositor
  measured it against a canvas capped at 1280 px while a separate-tracks take records the
  **raw** screen. `overlayPaddingFor(frameWidth)` is `20 × frameWidth ÷ min(frameWidth, 1280)`
  — 20 below the cap, 30 at 1920, the same fraction of the width either way.
- **Its audio is the primary's own track, and that is already the mix.**
  `WebCodecsRecorder` writes the microphone and system companions as a *second tap* on tracks
  the mix is already reading rather than diverting them, so the primary's audio track is the
  whole mix. The composite reads no audio from any part — one `AudioContext`, one
  `decodeAudioData`, of the primary — and **M4A on a separate-tracks take is unchanged, in
  bytes**: it was already the whole take the day slice 1 shipped. A test pins both.
- **Sync is a shared start, not a seek per frame.** Both `<video>` elements play at 1× from
  the same moment and each captured frame draws whatever the camera element is currently
  showing. Drift within a frame is accepted; a seek per frame is the
  minutes-instead-of-real-time cost `captureFramesViaPlayback` exists to avoid, and 33 ms
  between two halves of one take is not visible. `startOffset` shifts the camera's time base
  by deferring its `play()` until the screen has played that far — it is 0 for every take
  this recorder writes (one `start()`, one clock) and is honoured because it is stored per
  part.
- **A camera part that cannot be used costs the overlay and not the file.** Two things reach
  that: its bytes are gone (`loadWebcamCompanion` answers `'unavailable'`) or its container
  will not decode (`convertToMP4` warns and calls `onCompanionSkipped`). Either way the
  conversion **succeeds** with a screen-only MP4 — refusing after minutes of encoding would
  leave the user with nothing — and the notice channel says
  `MP4_SAVED_WITHOUT_WEBCAM` ("Saved as MP4 — without the webcam: its own track could not be
  read"). It outranks `MP4_SAVED_WITHOUT_AUDIO` when both are true, because the silent-MP4
  warning is also said *beforehand*, under the library, where a camera loss cannot yet be
  known.
- **Signature.** `convertToMP4(webmBlob, onProgress, signal?, composite?)` — a fourth
  *optional* argument rather than a second exported entry point, so every existing call is
  still three arguments, the plain path's tests and its per-frame ceilings are byte-unchanged,
  and there is one encode loop instead of two. Its per-frame ceilings
  (`converter.perf.test.ts`) are exact where they are laws — frames created == closed ==
  encoded, two `drawImage` per frame and not three, one balanced `save`/`restore`, one
  `clip`, no `fillRect` — and 2× the measured 11 canvas calls where they are a cost.
- **Benchmarked separately.** `craft-composite-mp4-conversion` (`apps/e2e/tests/perf/craft-recording.spec.ts`)
  converts a separate-tracks take through the same code the plain arm measures; the gap
  between the two arms' `taskMsPerFrame` is what one overlay costs. Its tripwire is
  `videoDraws === 2 × framesEncoded`.
```

- [ ] **Step 4: `apps/craft/CLAUDE.md` — "A take can be several files", Core Modules and the module table**

In **"A take can be several files"**, replace the whole **Interim, until slice 4** paragraph with:

```markdown
**MP4 and M4A cover the whole take.** MP4 re-composites it (see "The composite MP4" under
"Download Formats") and M4A always did, because the mix is on the primary. The interim note
that said otherwise — `SEPARATE_TRACKS_MP4_NOTE`, "MP4 and M4A cover the screen track only
— the webcam track is not included yet." — is **retired**, along with the per-row
`aria-describedby` target it needed, because both halves of that sentence became false. The
conversion buttons are described by the app-wide `mp4Note` alone again. The one case where a
file really is missing the camera is a fact about a file the user already has and goes
through the notice channel as `MP4_SAVED_WITHOUT_WEBCAM`, not as a standing claim on a row.
Nothing about the buttons' placement changed: MP4 and M4A are still the take's downloads and
still live on the primary row only, and every part is still reachable on its own through
Download WebM on its row.
```

And replace the **`UPLOAD_RECORDING` is still per row** paragraph with:

```markdown
**`UPLOAD_RECORDING` carries the take.** The primary row's message gains
`payload.parts` — `[{ id, role, name, blob, startOffset }]` for every file of the take, the
primary included, primary-first then camera then sound (`utils/takeParts.ts`
`loadTakeParts`). `payload.blob`, `payload.id` and `payload.name` are still the **primary's**,
so a host that knows nothing of takes receives exactly the `{ id, name, blob }` it always
did, and `role`/`takeId` are still added only when the row has them. The trigger is
`part.takeId === id`, which is precisely "this row *is* the take" — a primary carries its own
id as its `takeId` — so `RecordingsListPanel` needed no change and a **companion** row still
posts itself alone, with no `parts`. `parts` is **omitted** for a take that is one file: a
one-element list holding the same Blob as `payload.blob` names nothing the host does not
have. A part whose bytes are gone is left out rather than listed empty. The companion rows
keep their Upload button: redundant for a host that adopted `parts`, and the only way one
that has not can be handed a single part. The adoption note for embedders is in the root
`CLAUDE.md` Integration API and in `apps/artist/src/utils/integration.ts`; the ESCAPEPOD
upstream-requests page has its own row.
```

In **Core Modules**, add after the `compositor.ts` entry:

```markdown
- `overlayGeometry.ts`: `drawOverlay()` — where the webcam sits in a frame and how it is
  drawn there (the 16:9 derivation, the four corners, the circular centre-crop, both clip
  paths, the border) — plus `overlayGeometryFor()` / `overlayPaddingFor()` and the two
  constants `COMPOSITOR_MAX_WIDTH` / `DEFAULT_OVERLAY_PADDING`. Pure: no element lookup, no
  canvas creation, no state. It exists because **two** things draw this overlay — `Compositor`
  live, and `convertToMP4` offline from a second *file* — and a rounding difference between
  two copies would only ever be visible in a downloaded MP4. Nothing mocks it, which is what
  keeps `compositor.test.ts` exercising the real geometry
```

and extend the `converter.ts` entry's sentence about `convertToMP4` with:

```markdown
  `convertToMP4()`'s fourth optional argument is the take's camera half, which makes it the
  composite (see "Download Formats")
```

In the module table, add two rows after `utils/takeOrder.ts`:

```markdown
| `utils/takeParts.ts` | Reading a take's parts back out of storage, for the two things that need them: `loadWebcamCompanion(primary)` — the camera half plus the primary's `overlayPlacement`, for the composite MP4, with **three** answers because "there is no camera part" (a plain take, or one whose camera row was deleted, which demotes it) and "there is one I cannot read" are different facts; and `loadTakeParts(takeId)` — every part with its bytes, primary first then camera then sound, empty for a take that is one file, for `UPLOAD_RECORDING.parts`. The role order comes from `companionParts.companionRank`, not from a second list |
```

and update the `utils/companionParts.ts` row to end with: `It also owns `COMPANION_ROLE_ORDER` and `companionRank` — the one role order, read by `takeOrder` (the library's rows) and `takeParts` (the upload's parts).`

Update the `utils/notices.ts` row: `ten strings` → `eleven strings`.

Update the `components/RecordingsList/RecordingsList.tsx` row: delete the clause `— and so which of them show \`SEPARATE_TRACKS_MP4_NOTE\` and hand \`onSendToEditor\` the take (\`recording.takeId ?? recording.id\`)` and replace it with `, which is what hides MP4 and M4A on a companion row and hands \`onSendToEditor\` the take (\`recording.takeId ?? recording.id\`)`, and delete `It also derives, from the list it is given, which primary rows still have a *camera* half (\`role === 'webcam'\`, since the note is about the picture the conversions leave out)` — that set went with the note.

Update the `hooks/useMp4Download.ts` row by appending: `On an MP4 it first resolves the take's camera half out of storage (`utils/takeParts.ts`) and hands it to the converter with the take's stored `overlayPlacement`, so "Download as MP4" on a separate-tracks take gives you the take; `getVideo(id)` fetches the blob and that metadata in one transaction. An M4A asks for none of it — the primary's audio track is already the mix. A camera part that was listed and could not be used raises `MP4_SAVED_WITHOUT_WEBCAM`, which outranks the silent-MP4 warning in the one channel.`

Run: `grep -n "SEPARATE_TRACKS_MP4_NOTE\|slice 4\|not included yet" apps/craft/CLAUDE.md CLAUDE.md`
Expected: only the two deliberate historical mentions written above (the retirement paragraph and the Download Formats cross-reference), and **no** remaining "slice 4 will…" promise.

- [ ] **Step 5: The baseline doc**

In `docs/performance/2026-09-17-craft-baseline.md`:

Add a fifth row to the "What is measured" table:

```markdown
| `craft-composite-mp4-conversion` | `convertToMP4` again, with the take's camera half in a second `<video>` drawn through `drawOverlay` into the same canvas — the composite of a separate-tracks take (ESCSUITE-14 decision 3) | — |
```

Add one row to the tripwire table:

```markdown
| composite conversion | `videoDraws === 2 × framesEncoded` | either the overlay was never drawn — a plain conversion reported under the composite's name — or the screen was passed over twice, which at this capture size is the most expensive thing the loop could do twice |
```

Add a section after `### craft-mp4-conversion`'s table:

```markdown
### `craft-composite-mp4-conversion` — convertToMP4 with the overlay, 1280x720 source

First measured <DATE>, three runs, median. Produced by:

```bash
pnpm --filter @escapesuite/e2e exec playwright test tests/perf/craft-recording.spec.ts --project=chromium
pnpm perf:report
```

| Metric | Median |
| --- | --- |
| **Renderer task per frame** |  |
| Wall time |  |
| Frames encoded |  |
| Frames/s |  |
| Video draws |  |
| Renderer task duration |  |
| Encoder queue high-water |  |
| Heap delta |  |
| Output size (MP4) |  |

Read against `craft-mp4-conversion` on the same machine and the same run: the gap in
**renderer task per frame** is what one overlay costs — one `drawImage` of a 256x144 camera
frame, one circular clip path and one border stroke — and `Video draws` is exactly twice
`Frames encoded` by construction.
```

Fill every cell from the run kept at the end of Task 7, and put the run's date in `<DATE>`. **Do not leave a cell empty**; if a metric did not come out of the report, say which and why in a line under the table.

- [ ] **Step 6: The changeset**

Create `.changeset/craft-composite-downloads.md`:

```markdown
---
'@escapesuite/craft': minor
---

**"Download as MP4" on a recording made with "Record webcam as a separate track" now gives you
one file with the webcam in it** — the screen with the camera back in the corner, at the size
and in the shape it was recorded in, circle or rounded rectangle. It is the same picture the
preview showed you while you were recording, drawn by the same code, so the two cannot come
out differently.

The note that used to sit under such a take — "MP4 and M4A cover the screen track only — the
webcam track is not included yet" — is gone, because it is no longer true. **M4A was never
missing anything**: the mixed sound has always been on the screen recording, so the audio-only
download has always been the whole take.

Each part is still downloadable on its own as WebM from its own row, and MP4 and M4A are still
the whole take's downloads, on the take's first row.

If the webcam's own file cannot be read — cleared, deleted by hand, or unreadable — you still
get an MP4 of the screen rather than nothing at all, and ESCAPECRAFT says the webcam is not in
it instead of letting you find out by watching the file.

**For pages that embed ESCAPECRAFT:** `UPLOAD_RECORDING` may now carry an extra
`payload.parts` — every file of the take at once, the screen part included, each with its own
id, role, name, bytes and start offset. `payload.id`, `payload.name` and `payload.blob` are
unchanged and are still the screen part, so **a host that ignores `parts` needs no change and
behaves exactly as it does today**. A host that wants the whole take reads `payload.parts`
when it is there and falls back to `payload.blob` when it is not — it is absent for a
recording that is a single file. The message does not get bigger in any way that matters: the
files cross as references, not as copies. A single part's row still has its own "Upload to
host" button, which posts that part alone, for hosts that would rather ask for one thing at a
time.
```

- [ ] **Step 7: Write the ESCAPEPOD row text into the report (do not touch the memory file)**

The upstream-requests page is Confluence-backed (`https://bonham.atlassian.net/wiki/pages/52232193`) and is regenerated by the controller; the memory file carries a `DO NOT EDIT` banner. Produce the row **in the task's report** for the controller to add, in the page's own row format, filling `#<PR>` and `<merge sha>` from the merge of this branch and nothing else:

```markdown
- **10 craft — `UPLOAD_RECORDING.parts`: every file of a take in one message.** New from
  SUITE rather than requested by POD, and it is the half of ESCSUITE-14 that changes what the
  host receives. A take recorded with "Record webcam as a separate track" is up to four
  files (screen, webcam, microphone, system audio) sharing a `takeId`. **What CRAFT now
  sends:** the primary row's `UPLOAD_RECORDING` carries `payload.parts?: Array<{ id: string;
  role: 'screen' | 'webcam' | 'mic' | 'system'; name: string; blob: Blob; startOffset:
  number }>` — every part, the primary included, primary-first then camera then sound —
  beside the **unchanged** `payload.id`, `payload.name` and `payload.blob`, which are still
  the screen part's. `role` and `takeId` (slice 1, `landed@7ce6894`) are unchanged too.
  **How POD adopts it:** read `payload.parts` when present, fall back to
  `[{ id: payload.id, name: payload.name, blob: payload.blob, role: 'screen', startOffset: 0 }]`
  when it is not — `parts` is absent for a single-file recording, so the fallback is the whole
  migration. No message-size work is needed: a `Blob` crosses a structured clone as a handle,
  so a four-part take is four references and the primary appearing twice costs nothing.
  **Nothing breaks if POD does nothing:** ignoring `parts` leaves today's behaviour exactly as
  it is, which is why no `suite-patches/` entry is needed either. A companion row's own
  "Upload to host" still posts that row alone, with no `parts`, if POD would rather ask for one
  part at a time. Also in this row: "Download as MP4" on such a take is now a single
  composited file (screen + webcam in the corner it was recorded in), so a POD flow that
  offered the user CRAFT's MP4 no longer hands them a video with the camera missing.
  LANDED as PR #<PR> → main `<merge sha>`. POD: `landed@<merge sha>`, no patch to delete.
  Protocol text: root `CLAUDE.md` "Integration API" (with the "Adopting `parts`" note),
  `apps/artist/src/utils/integration.ts`, `apps/craft/CLAUDE.md` "A take can be several files".
```

- [ ] **Step 8: Coverage**

Run: `pnpm --filter @escapesuite/craft test:coverage`
Expected: PASS, and **lines exactly 100.00** — this branch adds `core/overlayGeometry.ts` and `utils/takeParts.ts`, both fully exercised by their own suites, plus new lines in `converter.ts`, `useMp4Download.ts`, `notices.ts` and `uploadToHost.ts`, all of which have a test above. If a line is uncovered, the missing test is the fix; never the floor.

Run: `pnpm coverage:report`
Read the four craft figures. For each one that has risen past a whole percent above its floor, raise the floor in **both** places:
- `apps/craft/vite.config.ts` → `test.coverage.thresholds`
- `scripts/coverage-report.mjs` → the `@escapesuite/craft` entry

The starting floors on this branch are `{ lines: 100, statements: 99, branches: 97, functions: 99 }`. Then update `CLAUDE.md`'s coverage table row for `@escapesuite/craft` to the measured figures, and append one sentence to the narrative above it, in the existing voice — for example:

```markdown
`@escapesuite/craft` was re-measured 2026-09-26 at the end of ESCSUITE-14 slice 4 (the
composite MP4, `UPLOAD_RECORDING.parts`, the retired interim note): lines still exactly
100.00, and statements, branches and functions each up a fraction — the two new modules are
small, pure and fully covered, and the retired note took an uncovered render branch with it —
with no floor crossed, so craft's floors stay 100 / 99 / 97 / 99.
```

Replace "no floor crossed … stay 100 / 99 / 97 / 99" with what actually happened if a floor did move.

- [ ] **Step 9: Final full verification**

Run, and quote each result in the commit or the report:

```bash
pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint
pnpm --filter @escapesuite/artist typecheck && pnpm --filter @escapesuite/artist lint
pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint
pnpm --filter @escapesuite/craft test:coverage
pnpm --filter @escapesuite/shared test:run
```

Expected: all green; shared unchanged (this slice adds no shared type).

Run: `git diff --stat main -- 'apps/artist/src'`
Expected: exactly one file, `apps/artist/src/utils/integration.ts`, and only inside the protocol comment — ARTIST is out of scope and this proves it.

- [ ] **Step 10: Commit**

```bash
git add CLAUDE.md apps/craft/CLAUDE.md apps/artist/src/utils/integration.ts \
  docs/performance/2026-09-17-craft-baseline.md .changeset/craft-composite-downloads.md \
  apps/craft/vite.config.ts scripts/coverage-report.mjs
git commit -m "$(cat <<'EOF'
docs(craft): the composite MP4, UPLOAD_RECORDING.parts and its adoption note

apps/craft/CLAUDE.md gains "The composite MP4" under Download Formats — one
shared drawOverlay so the preview and the file cannot differ, the inset scaled
to the frame, the audio taken from the primary because that track IS the mix (so
M4A is unchanged in bytes), a shared start rather than a seek per frame, and a
camera part that cannot be read costing the overlay and not the file. "A take can
be several files" records the interim note's retirement and that the primary
row's upload now carries every part; the module table gains utils/takeParts.ts
and core/overlayGeometry.ts.

The root CLAUDE.md Integration API and the protocol comment in
apps/artist/src/utils/integration.ts both document payload.parts with the
"Adopting parts" note: what an older host sees (exactly what it sees today),
what a new host reads (parts, with payload.blob as the fallback), and that
message size is a reference count because a Blob crosses a structured clone as a
handle. That comment is the only line of ARTIST this slice touches.

The baseline doc gains the fifth benchmark, its tripwire and its first numbers.
Changeset: craft minor.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage.** Every slice-4 obligation in the spec maps to a task.

*Decision 3* — "MP4 on a companion take is a re-composite: the converter plays the screen and webcam parts together and draws each frame through the same overlay geometry the live compositor uses (position, size and shape from the take's stored `RecordingConfig`), then encodes" → Task 1 (the shared geometry, shape included, since the clipping is what the compositor does), Task 2 (two elements played together, per-frame draw, encode), Task 3 (the stored `overlayPlacement` resolved and handed over). "M4A, and the MP4's audio, mix the mic and system parts" is the one place this plan **deliberately diverges from the spec's wording and says so**: the parts are a second *tap* on tracks the mix already reads (`AudioCompanionPipeline`'s own doc comment, written in slice 3 after this spec), so the primary's track already **is** the mix — mixing the parts would re-derive a buffer that is in the file, at two extra whole-file `decodeAudioData` passes plus a resampling sum that can only differ from the real thing. The *outcome* the decision asks for (the MP4's audio and the M4A both carry the whole take's sound) is delivered exactly; the mechanism is "read the file that already has it". Pinned by Task 2's "takes its audio from the primary alone" and Task 3's "asks for no companion for an M4A", and documented in Task 8. "The screen-only MP4 is not offered" → Task 4 keeps MP4/M4A on the primary row only and adds no second button; the screen-only MP4 exists only as the *fallback* when the camera part cannot be read, which is a failure outcome rather than an offer.

*Decision 4* — the optional `parts` array listing every part including the primary, `payload.blob` still the primary, an adoption note in `integration.ts` + root `CLAUDE.md` + `apps/craft/CLAUDE.md` + the changeset, and an ESCAPEPOD row → Task 5 (behaviour), Task 6 (proved in a real iframe), Task 8 (all four documents plus the row text).

*The "Converter" consequence bullet* — "two `<video>` elements started together", "a pure `drawOverlay(ctx, screen, webcam, placement)` extracted from `Compositor.drawWebcamOverlay` so the live and the offline composite cannot drift apart (pinned by a shared unit test)", "per-frame ceilings for the composite path are measured and set at 2× per policy" → Tasks 1 and 2. The signature diverges — `drawOverlay(ctx, webcam, frame, geometry)`, with the screen draw left in each caller — and Task 1's decision block argues it: the screen draw has no geometry to get wrong, its guard asks a different question in each caller, and folding the black fill in would add a per-frame operation under a frame that always covers it.

*The "Downloads" consequence under §5* — "MP4/M4A on a companion take re-composite and mix the parts, which is new converter work with its own per-frame ceilings" → Tasks 2 and 3.

*The slice-4 estimate row* — "composite MP4 + mixed M4A (shared `drawOverlay`), `UPLOAD_RECORDING.parts`, adoption notes, ESCAPEPOD row" → all eight tasks; nothing in the row is unassigned.

Beyond the spec, three obligations came from the shipped state of slices 1–3 and each has a task: the interim `SEPARATE_TRACKS_MP4_NOTE` (Task 4, with its retirement argued and its tests converted rather than deleted), the e2e assertion that used to require that note (Task 4), and the `craft-composite-mp4-conversion` benchmark arm the plan recommends and builds (Task 7).

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no step that describes code without showing it. Every new user-visible string is written out verbatim and asserted somewhere: `'Loading the webcam track…'` (Task 2), `MP4_SAVED_WITHOUT_WEBCAM` (Tasks 3 and 8), and the deletion of `SEPARATE_TRACKS_MP4_NOTE` (Task 4, with the absence pinned four ways). Three places hold values that cannot be known before the code runs, and each names the command that produces them and forbids leaving them unfilled: the composite ceiling's *measured* count (Task 2 Step 7 — the plan states the expected 11 and the derived 22, and Step 7 verifies the 11 exactly and corrects both the number and its date if it differs), the baseline doc's measurement table (Task 8 Step 5), and the coverage figures and any floor they cross (Task 8 Step 8, which states the starting floors and the rule). The ESCAPEPOD row (Task 8 Step 7) has exactly two unfillable tokens, `#<PR>` and `<merge sha>`, both named as merge-time values.

**3. Type consistency.** `OverlayGeometry` is defined once (Task 1) with the field names `webcamPosition` / `webcamSize` / `webcamShape` / `padding`, and is used under that name in `CompositorConfig`'s alias, in `overlayGeometryFor`'s return, in `drawOverlay`'s fourth parameter and in the converter's private `FrameOverlay.geometry`. `drawOverlay(ctx, webcam, frame, geometry)` has that argument order in the module, in both callers and in `overlayGeometry.test.ts`. `overlayPaddingFor(frameWidth)` and `overlayGeometryFor(placement, frameWidth)` take the frame **width** (never the height) everywhere. `CompositeCompanion { blob, placement, startOffset }` is declared in `core/converter.ts` (Task 2) and is what `loadWebcamCompanion` returns inside `{ kind: 'ready', companion }` (Task 3) and what the hook spreads into `CompositeOptions.companion`; `CompositeOptions { companion, onCompanionSkipped? }` is the fourth parameter of `convertToMP4` in the module, in `converter.test.ts`, in `converter.perf.test.ts`, in the hook and in `useMp4Download.test.ts`'s replacement implementation. `WebcamCompanionLookup`'s three `kind`s are `'none' | 'ready' | 'unavailable'` in the type, in `takeParts.test.ts` and in the hook's two reads of it. `UploadPart { id, role, name, blob, startOffset }` is the same five fields in `loadTakeParts`, in `uploadToHost`'s payload, in `uploadToHost.test.ts`, in `host-embedding.spec.ts`'s `CapturedPart`, and in all four documents. `companionRank(role: string | undefined)` keeps its exact signature through the move (Task 1) and is called by `takeOrder.orderTakes` and by `takeParts.partRank`. `measureMp4Conversion(page, cdp, options?)` takes `{ composite?, profileName? }` in the util and at all three call sites in the perf spec. `recordSeparateTracksTake` is the name in `craftPerf.ts` and in the perf spec's import; the same-purpose helper inside `separate-tracks.spec.ts` is deliberately spec-local and separately named in its own file's scope — neither imports the other, and neither file is in the other's module graph.
