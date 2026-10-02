# ESCSUITE-34 — GIF export (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a third export format in ESCAPEARTIST — **GIF** — for short clips shared in chat tools. It reuses the frame machinery the WebM exporter already has and swaps the encoder: per frame, `ctx.getImageData` → `quantize` → `applyPalette` → `writeFrame`. 10/15/20 fps, 720p/480p/360p, a live size estimate while it runs and a heuristic before it starts, a soft warning past 30 seconds, the existing in/out points honoured so "Export Section" works unchanged, and no WebCodecs needed at all — so in a browser that cannot encode WebM *or* MP4, GIF is the one format that still works. The headless kit renders it too.

**Architecture:** three new modules in `apps/artist/src/core/` and nothing moved that did not have to move.

1. **`core/gifEncoder.ts`** — a thin wrapper over `gifenc` (MIT, pure JS, no dependencies, pinned at **1.0.3**). It owns the three-call-per-frame dance (`quantize` → `applyPalette` → `writeFrame`) and the running byte count, so `exportGIF.ts` never imports `gifenc` directly and the encoder can be mocked at one module boundary. `gifenc` ships **no type declarations**, so `apps/artist/src/types/gifenc.d.ts` declares the module, the way `src/types/mp4box.d.ts` already does for `mp4box`.
2. **`core/elementFrames.ts`** — the per-frame machinery `exportWebM.ts` has today, lifted out *unchanged*: loading each unique source into a `<video>`/`<img>`, rewinding them once, seeking them per frame, the single track-ordered interleaved draw pass, the transition draw, and the object-URL release. `exportWebM.ts` becomes a caller; `exportGIF.ts` is the second caller. The extraction makes **the same calls in the same order**, which is why `core/exportWebM.perf.test.ts` and `core/exportMP4.perf.test.ts` stay byte-identical and green.
3. **`core/exportGIF.ts`** — the frame loop: `composeFrame(t)` from (2), then one `getImageData` and one `addFrame` from (1). Bound to the frame loop, so an abort between frames stops it (ESCSUITE-98 run identity), and a failure wraps in `ExportError` with the export log, like the other two.

`ExportOptions['format']` widens to `'webm' | 'mp4' | 'gif'`, `ExportOptions['resolution']` gains `'360p'` (offered for GIF only), `ExportOptions` gains `fps?: GifFps`, and `ExportProgress` gains `estimatedBytes?: number` — which is how the live estimate reaches the dialog without a second callback. `ExportDialog.tsx` gains a GIF radio, an fps `<select>`, a GIF-only resolution list, the estimate line and the 30-second warning; the ESCSUITE-22 support probe treats GIF as always supported. The headless kit widens `FORMATS`, `RESOLUTIONS` and its two extension/MIME maps, accepts `fps` for GIF only, and gains one Chromium parity case.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand (`src/store/projectStore.ts` the only store entry point), CSS Modules, Vitest + Testing Library (jsdom) with `src/test/doubles/*` and `src/test/fixtures/*`; `gifenc@1.0.3` as the one new runtime dependency; Vitest + Playwright-launched headless Chromium for `services/headless-artist`; changesets for release notes.

**Spec:** `docs/superpowers/specs/2026-10-01-gif-export-design.md` — approved by the operator on 2026-10-01 ("all recommended") and **binding**. Read it before Task 1. Two places where the spec's prose and the code disagree, resolved here in the code's favour and called out again in the tasks that touch them:

- The spec writes the progress shape as `{ phase, percent, message }`. The real `ExportProgress` (`src/store/types.ts:807-811`) is `{ phase, progress, message }`. **`progress` is the field name**; the spec means "the same shape as the other two exporters", which is what this plan does.
- The spec says GIF "reads `timeRange`… so 'Export Section' works unchanged" and lists resolution presets as "720p / 480p / 360p (default 480p)". The dialog's resolution `<select>` today also offers `project` and `1080p`. For GIF the list is **exactly** `720p / 480p / 360p`; `project` and `1080p` are not offered for GIF, and switching to GIF from a `project`/`1080p` selection lands on `480p`.

**Out of scope (v1, from the spec's own non-goals):** audio of any kind; dithering options; a single global palette; transparency; looping controls (infinite loop is the `gifenc` default and stays); a worker-based encoder; any change to what the canvas *draws*; any change to the MP4 pipeline; the primary "Download WebM" button (GIF is reached through Advanced options, like MP4).

---

## Global Constraints

1. **Work only in the worktree `/Users/littlemac/Projects/ESCAPESUITE-e34`, on branch `feat/escsuite-34-gif-export`.** Never touch `/Users/littlemac/Projects/ESCAPESUITE` or any other worktree. `node_modules` is already installed there; if it is missing, run `pnpm install --offline` first.

2. **Red first for every behaviour change.** Write the failing test, *run* it, paste the exact failure text into the step notes, then implement, then run again green. Commit the test and the implementation **separately** where a task says so. A step that cannot be red first says so and carries an explicit mutation step instead (Task 2 is the only one).

3. **No coverage runs by implementers.** Do **not** run `test:coverage`, do **not** run Playwright, do **not** push, do **not** open a PR, do **not** dispatch subagents. The coordinator owns coverage measurement, the root `CLAUDE.md` coverage paragraph, the browser suites and the kit's Chromium suite. Artist's floors are **99 / 99 / 95 / 99** (`apps/artist/vite.config.ts:250-255`) against an achieved 99.71 / 99.11 / 95.21 / 99.65; the kit's are **99 / 99 / 98 / 98** (`services/headless-artist/vitest.config.ts:41-46`). Floors only ever go up and no implementer edits them.

4. **`core/exportWebM.perf.test.ts` and `core/exportMP4.perf.test.ts` stay byte-identical** — before and after the Task 2 extraction, and for the whole branch. Task 2 proves it with `git diff --stat` and by running both files green. No other `*.perf.test.ts` and no `App.*rerender*.test.tsx` file may change either.

5. **Every new conditional is reached from both sides by a test, or it is deleted.** An operand no caller can reach is removed, not tested. This is the rule the review will apply: a new `if`, `?:`, `??`, `||` or `&&` operand with one arm unexercised is a finding.

6. **Per-frame ceilings: 2× the measured value, rounded up, with the measurement and its date in a comment beside it.** Conservation laws (one `getImageData` per frame, one `quantize`/`applyPalette`/`writeFrame` per frame, balanced `save`/`restore`, one `getContext` for the whole export, zero `VideoFrame`s) are asserted **exactly**, not as budgets. Task 3 measures and then writes the numbers; it does not guess them.

7. **Update `apps/artist/CLAUDE.md`** where the behaviour is documented, and the two root-`CLAUDE.md` lines Task 6 names (the ESCAPEARTIST "Export formats" bullet and the Integration API's `EXPORT_COMPLETE` shape). **Do not edit the root `CLAUDE.md` coverage section** — the coordinator writes that paragraph.

8. **Two changesets, both `minor`** (Task 6): `.changeset/escsuite-34-artist-gif-export.md` with `'@escapesuite/artist': minor`, and `.changeset/escsuite-34-headless-gif-export.md` with `'@escapesuite/headless-artist': minor`. Artist's headline is the spec's own wording: *"Export a GIF: 10/15/20 fps, 720p/480p/360p, a live size estimate, and the section you have in/out points on"*.

9. **Per-task verification.** At the end of every task run, in the worktree:
   - `pnpm --filter @escapesuite/artist exec vitest run` (whole package suite), and
   - `pnpm --filter @escapesuite/artist exec tsc -b --noEmit` (vitest does not type-check), and
   - `pnpm --filter @escapesuite/artist exec eslint .`

   Task 5 runs the same three against `@escapesuite/headless-artist` instead. All three must be clean before the task's commit.

10. **No existing test may be deleted or weakened.** `core/exportWebM.test.ts`, `components/Export/ExportDialog.test.tsx`, `core/exportTypes.test.ts`, `headless/renderProject.test.ts` and `services/headless-artist/src/jobSpec.test.ts` gain cases only. Where a widened type forces a cast in an existing test, widen the type rather than the cast.

11. **The GIF radio's accessible name must not contain "WebM" or "MP4".** `ExportDialog.test.tsx` finds radios with `getByRole('radio', { name: /webm/i })` and `/mp4/i` (lines 219, 239-240, 258-259, 306-309, 410, 620, 680, 756, 830, 1181, 1214, 1239). A GIF label or hint mentioning either word makes those queries ambiguous and turns a dozen existing tests red. The strings this plan uses — `GIF (256 colours, no audio)` and `No WebCodecs needed` — are chosen for that reason.

12. **`gifenc` is pinned exactly.** `"gifenc": "1.0.3"` in `apps/artist/package.json` — no caret. The wrapper's unit test asserts exact byte counts from the real encoder, which is only sound against a pinned version.

13. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

14. **Line numbers in this plan were verified against the worktree at `834dabd`** (the spec commit, on `feat/escsuite-34-gif-export`). ESCSUITE-22 landed on 2026-10-01 and moved `exportTypes.ts`, `exportWebM.ts`, `exportMP4.ts` and `ExportDialog.tsx`; every reference below is post-ESCSUITE-22. Re-verify before editing — `grep` for the quoted text rather than trusting a number.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/types/gifenc.d.ts` | Ambient module declaration for `gifenc` (it ships none) |
| `apps/artist/src/core/gifEncoder.ts` | `createGifWriter()` — the three-call-per-frame `gifenc` dance and the running byte count |
| `apps/artist/src/core/gifEncoder.test.ts` | The wrapper against the **real** `gifenc`: a valid GIF, the delay in centiseconds, exact byte counts |
| `apps/artist/src/core/elementFrames.ts` | `loadElementSources` / `rewindElementSources` / `createFrameComposer` / `releaseElementSources` — `exportWebM.ts`'s per-frame machinery, lifted |
| `apps/artist/src/core/elementFrames.test.ts` | The lifted machinery's own unit cases |
| `apps/artist/src/core/exportGIF.ts` | `exportToGIF` and `estimateGifBytes` |
| `apps/artist/src/core/exportGIF.test.ts` | GIF export behaviour: frames, delays, range, abort, `ExportError`, no WebCodecs |
| `apps/artist/src/core/exportGIF.perf.test.ts` | Per-frame ceilings for the GIF pipeline |
| `.changeset/escsuite-34-artist-gif-export.md` | `@escapesuite/artist: minor` |
| `.changeset/escsuite-34-headless-gif-export.md` | `@escapesuite/headless-artist: minor` |

**Modified**

| File | Change |
|---|---|
| `apps/artist/package.json` | `"gifenc": "1.0.3"` |
| `apps/artist/src/store/types.ts` | `ExportOptions.format`, `.resolution`, new `.fps`; `ExportProgress.estimatedBytes` |
| `apps/artist/src/core/exportTypes.ts` | `'360p'` in `getResolution`; `GIF_FPS_OPTIONS`/`DEFAULT_GIF_FPS`/`gifFrameRate`; `GIF_RESOLUTIONS`/`resolutionForFormat`; `GIF_LONG_RANGE_SECONDS`/`GIF_LONG_RANGE_WARNING`; `GIF_ALWAYS_AVAILABLE_NOTE` |
| `apps/artist/src/core/exportTypes.test.ts` | `'360p'` cases and the new helpers' cases |
| `apps/artist/src/core/exportWebM.ts` | Calls `core/elementFrames.ts` instead of doing it inline |
| `apps/artist/src/core/exporter.ts` | Re-exports `exportToGIF`, `estimateGifBytes`, `isGIFExportSupported` |
| `apps/artist/src/components/Export/ExportDialog.tsx` | GIF radio, fps select, GIF resolution list, estimate line, 30 s warning, GIF dispatch, `.gif` file name, `EXPORT_COMPLETE` format |
| `apps/artist/src/components/Export/ExportDialog.test.tsx` | New `describe('GIF export')` block |
| `apps/artist/src/utils/analytics.ts` | `exportStarted`/`exportCompleted` format unions gain `'gif'` |
| `apps/artist/src/utils/integration.ts` | `EXPORT_COMPLETE` protocol comment |
| `apps/artist/src/headless/types.ts` | `RenderMeta.format` gains `'gif'` |
| `apps/artist/src/headless/renderProject.ts` | Routes `'gif'` to `exportToGIF` |
| `apps/artist/src/headless/renderProject.test.ts` | One routing case |
| `services/headless-artist/src/jobSpec.ts` | `FORMATS`, `RESOLUTIONS`, `OPTIONS_KEYS`, `fps` validation |
| `services/headless-artist/src/jobSpec.test.ts` | GIF / `360p` / `fps` cases |
| `services/headless-artist/src/sinks.ts`, `src/s3.ts` | `gif` / `image/gif` in both maps |
| `services/headless-artist/src/run.chromium.test.ts` | One GIF parity case (written here; the coordinator runs it) |
| `services/headless-artist/README.md` | `options.format`, new `options.fps`, `options.resolution`, the volume/S3/manifest/error lines |
| `apps/artist/CLAUDE.md` | A new "GIF Export" section, the export-resolution and dialog-support sections, the core-module list |
| `CLAUDE.md` (root) | The "Export formats" bullet and the `EXPORT_COMPLETE` line only |

---

## Controller Steps (NOT the implementers')

- [ ] **C1: Confirm the branch and the dependency install.** `git -C /Users/littlemac/Projects/ESCAPESUITE-e34 branch --show-current` is `feat/escsuite-34-gif-export`; `git log --oneline -1` is the spec commit. `ls apps/artist/node_modules` exists.
- [ ] **C2: Dispatch Tasks 1 → 2 → 3 → 4 → 5 → 6, in order.** They are sequenced, not parallel: Task 3 needs Task 1's wrapper and Task 2's helper; Task 4 needs Task 3's exporter; Task 6 documents all of it. Tasks 1 and 5 are the only two that could overlap, and Task 5's `RenderMeta` change depends on Task 3's `ExportOptions`.
- [ ] **C3: Run the kit's Chromium parity case** once Task 5 is reviewed: `pnpm --filter @escapesuite/headless-artist exec cross-env HEADLESS_BUILD=1 vitest run src/run.chromium.test.ts`. It builds the ARTIST headless bundle once and launches real Chromium. Record the GIF case's outcome in the ledger.
- [ ] **C4: Measure coverage for both packages** after Task 6 and write the root `CLAUDE.md` paragraph: `pnpm --filter @escapesuite/artist test:coverage` and `pnpm --filter @escapesuite/headless-artist test:coverage`, then `pnpm coverage:report`. Raise a whole-percent floor only if it actually rose.

---

### Task 1: `gifenc`, its missing types, and the `core/gifEncoder.ts` wrapper

**Files:**
- Modify: `apps/artist/package.json` (the `dependencies` block, after `"@vercel/analytics"` and before `"idb"` — the list is alphabetical)
- Create: `apps/artist/src/types/gifenc.d.ts`
- Create: `apps/artist/src/core/gifEncoder.ts`
- Create: `apps/artist/src/core/gifEncoder.test.ts`

**Interfaces:**

- Consumes: `gifenc@1.0.3`'s `GIFEncoder`, `quantize`, `applyPalette`. **Nothing else in the repo may import `gifenc`** — this wrapper is the only importer, which is what lets Task 3's tests mock one module boundary instead of a third-party package.
- Produces, in `apps/artist/src/core/gifEncoder.ts`:

```ts
/** Colours in a frame's palette. The GIF format's own ceiling. */
export const GIF_MAX_COLORS = 256;

export interface GifWriter {
  /**
   * Quantise one RGBA frame to its own 256-colour palette and write it.
   * `delayMs` is the frame's on-screen time in milliseconds.
   */
  addFrame(rgba: Uint8ClampedArray, width: number, height: number, delayMs: number): void;
  /** Bytes written to the GIF stream so far — the live size estimate's numerator. */
  bytesWritten(): number;
  /** Write the end-of-stream byte (once) and return the finished file. */
  finish(): Uint8Array;
}

export function createGifWriter(): GifWriter;
```

**Four decisions this task pins, all argued in the commit message:**

- **The wrapper exists so `gifenc` has exactly one importer.** `exportGIF.ts` would otherwise import three functions from an untyped package and the export tests would have to mock a node module to count frames. One seam, one double.
- **A per-frame palette, no dithering, infinite loop** — the spec's non-goals, and all three are `gifenc` defaults once `{ palette, delay }` is the only option passed. `writeFrame`'s `repeat` defaults to `0` ("forever") and is written into the Netscape extension on the first frame only, so nothing has to say so. A palette passed on a later frame becomes that frame's *local* colour table, which is exactly the per-frame palette the spec asks for.
- **`bytesWritten()` is `bytesView().byteLength`, not a counter we keep.** `gifenc`'s stream exposes a zero-copy view of everything written so far (`src/stream.js`: `bytesView()` is `contents.subarray(0, cursor)`), so the byte count is the encoder's own cursor rather than a number this wrapper could get wrong.
- **The delay the GIF file carries is centiseconds, and that is the format, not a bug.** `gifenc` writes `Math.round(delay / 10)` into each frame's Graphic Control Extension. 10 fps (100 ms) and 20 fps (50 ms) are exact; **15 fps (67 ms) becomes 7 cs**, so a 15 fps GIF actually plays at ≈14.3 fps. The test asserts the centisecond values so this is recorded in the suite rather than discovered later, and Task 6 writes it into `apps/artist/CLAUDE.md`.

- [ ] **Step 1: Add the dependency, pinned exactly**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
pnpm --filter @escapesuite/artist add --save-exact gifenc@1.0.3
```

Then confirm `apps/artist/package.json` reads `"gifenc": "1.0.3"` with **no caret** (`grep -n gifenc apps/artist/package.json`). If the network is unavailable the add will fail; in that case add the line by hand and run `pnpm install` so the lockfile is written.

- [ ] **Step 2: Write the failing wrapper test** — create `apps/artist/src/core/gifEncoder.test.ts`

```ts
// The GIF encoder wrapper, against the REAL gifenc (ESCSUITE-34).
//
// Deliberately not mocked: this is the one place the third-party encoder's API
// is verified rather than assumed, so the byte counts below are exact and come
// from running gifenc 1.0.3 — which is why the dependency is pinned without a
// caret. Everything downstream (exportGIF.ts and its two test files) mocks
// `./gifEncoder` and counts calls; nothing else ever touches gifenc.
import { describe, it, expect } from 'vitest'
import { createGifWriter, GIF_MAX_COLORS } from './gifEncoder'

/** A 2x2 frame of one opaque colour — one palette entry, so every byte count below is deterministic. */
function solidFrame(r: number, g: number, b: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(2 * 2 * 4)
  for (let i = 0; i < 4; i++) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/**
 * Every Graphic Control Extension's delay field, in centiseconds, in order.
 *
 * A GCE is `0x21 0xF9 0x04 <packed> <delayLo> <delayHi> <transparentIndex> 0x00`
 * (gifenc `src/index.js`'s `encodeGraphicControlExt`). Scanning for the
 * three-byte introducer is safe for these fixtures specifically: the whole file
 * is under a hundred bytes, the colour table holds one real colour plus one
 * black pad, and the LZW payload of a four-pixel single-colour image is six
 * bytes — there is no room for a false positive, and the assertions below pin
 * the file's total length so there never will be.
 */
function frameDelaysCs(bytes: Uint8Array): number[] {
  const delays: number[] = []
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      delays.push(bytes[i + 4] | (bytes[i + 5] << 8))
    }
  }
  return delays
}

describe('createGifWriter', () => {
  it('writes a GIF89a file that ends with the trailer byte', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    const bytes = writer.finish()

    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
    // 0x3B is the GIF end-of-stream trailer; `finish()` is the only writer of it.
    expect(bytes[bytes.length - 1]).toBe(0x3b)
  })

  it('carries each frame’s delay in centiseconds, rounded from milliseconds', () => {
    const writer = createGifWriter()
    // 10 fps and 15 fps. 100 ms is exactly 10 cs; 67 ms rounds to 7 cs, so a
    // "15 fps" GIF really plays at ~14.3 fps — the format's own granularity,
    // recorded here rather than left to be discovered.
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    writer.addFrame(solidFrame(0, 0, 255), 2, 2, 67)

    expect(frameDelaysCs(writer.finish())).toEqual([10, 7])
  })

  it('reports the bytes written so far, growing with each frame', () => {
    const writer = createGifWriter()
    expect(writer.bytesWritten()).toBe(0)

    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    const afterFirst = writer.bytesWritten()
    writer.addFrame(solidFrame(0, 0, 255), 2, 2, 67)
    const afterSecond = writer.bytesWritten()

    // Measured against gifenc 1.0.3 on 2026-10-01: 65 bytes after the first
    // frame (header + logical screen descriptor + global colour table +
    // Netscape extension + the frame itself) and 98 after the second. Exact
    // rather than a range, because this is the number the live size estimate
    // divides by and a stubbed encoder would not produce it.
    expect(afterFirst).toBe(65)
    expect(afterSecond).toBe(98)
    // finish() writes exactly one more byte — the trailer.
    expect(writer.finish().byteLength).toBe(afterSecond + 1)
  })

  it('refuses a frame written after finish()', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    writer.finish()

    expect(() => writer.addFrame(solidFrame(0, 255, 0), 2, 2, 100)).toThrow(
      /addFrame\(\) after finish\(\)/
    )
  })

  it('writes one trailer however many times finish() is called', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)

    const first = writer.finish()
    const second = writer.finish()

    // A second finish() must not append a second trailer: the dialog's own
    // error path can reach the finally after the happy path already finished.
    expect(second.byteLength).toBe(first.byteLength)
    expect(second[second.byteLength - 1]).toBe(0x3b)
  })
})

describe('GIF_MAX_COLORS', () => {
  it('is 256, the GIF format’s own ceiling', () => {
    expect(GIF_MAX_COLORS).toBe(256)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/gifEncoder.test.ts`
Expected: FAIL — `Failed to resolve import "./gifEncoder" from "src/core/gifEncoder.test.ts"`. Quote the exact text in the step notes.

- [ ] **Step 4: Declare the untyped module** — create `apps/artist/src/types/gifenc.d.ts`

```ts
/**
 * Type definitions for gifenc 1.0.3, which ships none.
 *
 * Written from the package's own source (`src/index.js`, `src/palettize.js`,
 * `src/pnnquant2.js`, `src/stream.js`) and its README, and verified by
 * `src/core/gifEncoder.test.ts` running the real package. Only the surface
 * `core/gifEncoder.ts` uses is declared; the quantiser's other exports
 * (`prequantize`, `nearestColorIndex`, `snapColorsToPalette`, …) are left out
 * on purpose, so adding a use of one is a visible change rather than a silent
 * `any`. Same shape and same reason as `src/types/mp4box.d.ts`.
 */
declare module 'gifenc' {
  /** A colour table: one `[r, g, b]` (or `[r, g, b, a]`) triple per entry, in bytes. */
  export type GifPalette = number[][];

  /** How a pixel is packed before quantisation. `rgb565` is the default and the only one used here. */
  export type GifPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface GifQuantizeOptions {
    format?: GifPixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** Reduce an RGBA frame to a palette of no more than `maxColors` colours. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: GifQuantizeOptions
  ): GifPalette;

  /** Map each pixel of an RGBA frame to its nearest palette index. One byte per pixel. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifPixelFormat
  ): Uint8Array;

  export interface GifWriteFrameOptions {
    /** Required on the first frame (global colour table); a later frame's becomes a local one. */
    palette?: GifPalette;
    /** Frame delay in **milliseconds**; gifenc rounds it to centiseconds on the way out. */
    delay?: number;
    /** `-1` once, `0` forever (the default), any positive integer a repeat count. First frame only. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** Only meaningful with `{ auto: false }`. */
    first?: boolean;
    dispose?: number;
    colorDepth?: number;
  }

  export interface GifEncoderHandle {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions
    ): void;
    /** Writes the GIF header. Only needed with `{ auto: false }`. */
    writeHeader(): void;
    /** Writes the end-of-stream trailer byte. */
    finish(): void;
    /** A copy of everything written so far. */
    bytes(): Uint8Array;
    /** A zero-copy view of everything written so far — its length is the stream cursor. */
    bytesView(): Uint8Array;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoderHandle;
}
```

- [ ] **Step 5: Implement the wrapper** — create `apps/artist/src/core/gifEncoder.ts`

```ts
// The one importer of `gifenc` (ESCSUITE-34).
//
// A GIF frame is three steps, not one: quantise the RGBA pixels down to a
// colour table, map every pixel to an index into that table, then write the
// indexed bitmap and its table into the stream. `gifenc` gives each step its
// own function so a caller can share a palette across frames or push the work
// into workers; v1 does neither — one palette per frame, no dithering, infinite
// loop — so the three calls always happen together and belong behind one
// method.
//
// Keeping them here also keeps `exportGIF.ts` testable: its unit and per-frame
// tests mock this module and count `addFrame` calls, rather than mocking a
// third-party package. `gifEncoder.test.ts` is the only test that runs the real
// encoder, which is why the dependency is pinned to an exact version.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** Colours in a frame's palette. The GIF format's own ceiling. */
export const GIF_MAX_COLORS = 256;

export interface GifWriter {
  /**
   * Quantise one RGBA frame to its own 256-colour palette and write it.
   * `delayMs` is the frame's on-screen time in milliseconds — which the GIF
   * container stores as centiseconds, so 67 ms (15 fps) lands as 7 cs.
   */
  addFrame(rgba: Uint8ClampedArray, width: number, height: number, delayMs: number): void;
  /** Bytes written to the GIF stream so far — the live size estimate's numerator. */
  bytesWritten(): number;
  /** Write the end-of-stream byte (once) and return the finished file. */
  finish(): Uint8Array;
}

/**
 * A GIF stream in `gifenc`'s "auto" mode: the header, the logical screen
 * descriptor and the Netscape looping extension are written on the first
 * `writeFrame`, so nothing here has to know whether a frame is the first one.
 */
export function createGifWriter(): GifWriter {
  const encoder = GIFEncoder();
  let finished = false;

  return {
    addFrame(rgba, width, height, delayMs) {
      if (finished) {
        throw new Error('GIF writer: addFrame() after finish()');
      }
      const palette = quantize(rgba, GIF_MAX_COLORS);
      const index = applyPalette(rgba, palette);
      encoder.writeFrame(index, width, height, { palette, delay: delayMs });
    },
    bytesWritten() {
      // The encoder's own stream cursor, not a count kept here: `bytesView()`
      // is a subarray of the buffer up to the cursor, so its length cannot
      // disagree with what was actually written.
      return encoder.bytesView().byteLength;
    },
    finish() {
      // Idempotent: an export's failure path can reach a finally after the
      // happy path has already finished, and a second trailer byte would
      // corrupt the file.
      if (!finished) {
        encoder.finish();
        finished = true;
      }
      return encoder.bytes();
    },
  };
}
```

- [ ] **Step 6: Run it green**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/gifEncoder.test.ts`
Expected: PASS, 6 tests. If `afterFirst`/`afterSecond` differ from 65/98, the installed `gifenc` is not 1.0.3 — fix the version rather than the numbers.

- [ ] **Step 7: Verify the package**

```bash
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
pnpm --filter @escapesuite/artist exec vitest run
```

All three clean. (`tsc` is the one that proves `gifenc.d.ts` is doing its job: without it, `core/gifEncoder.ts` fails with `Could not find a declaration file for module 'gifenc'`.)

- [ ] **Step 8: Commit**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/package.json pnpm-lock.yaml apps/artist/src/types/gifenc.d.ts \
        apps/artist/src/core/gifEncoder.ts apps/artist/src/core/gifEncoder.test.ts
git commit -m "$(cat <<'MSG'
feat(artist): a GIF encoder wrapper over gifenc (ESCSUITE-34)

One new runtime dependency, pinned exactly at gifenc 1.0.3 (MIT, pure JS, no
dependencies of its own), and one module that is allowed to import it.

A GIF frame is three gifenc calls, not one — quantise the RGBA pixels to a
colour table, map every pixel to an index into it, then write the indexed
bitmap and its table — and v1 always makes all three together: one palette per
frame, no dithering, the infinite loop gifenc writes by default. So they live
behind `createGifWriter().addFrame(rgba, w, h, delayMs)`, which also gives
`exportGIF.ts` (next) a module boundary its own tests can mock instead of
mocking a third-party package.

`bytesWritten()` is the encoder's own stream cursor via `bytesView().byteLength`
rather than a count kept here, because that is the numerator of the live size
estimate the dialog will show and a second tally is a second thing to get
wrong. `finish()` is idempotent: an export's failure path can reach a finally
after the happy path already finished, and a second trailer byte would corrupt
the file.

gifenc ships no type declarations, so `src/types/gifenc.d.ts` declares the
surface this wrapper uses and nothing more — the same shape, and the same
reason, as `src/types/mp4box.d.ts`. Adding a use of one of the quantiser's
other exports is then a visible change rather than a silent `any`.

`gifEncoder.test.ts` runs the real encoder and is the only test that ever will.
It pins the GIF89a header, the trailer byte, the exact byte counts after each
frame (65 and 98 for a two-frame 2x2 fixture, measured against 1.0.3 — which is
why the version carries no caret), and the delays as the container actually
stores them: centiseconds. 100 ms and 50 ms are exact; 67 ms rounds to 7 cs, so
a "15 fps" GIF plays at about 14.3 fps. That is the format's granularity, and
it is recorded in the suite rather than left to be found later.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

### Task 2: lift `exportWebM.ts`'s per-frame machinery into `core/elementFrames.ts`

**Files:**
- Create: `apps/artist/src/core/elementFrames.ts`
- Create: `apps/artist/src/core/elementFrames.test.ts`
- Modify: `apps/artist/src/core/exportWebM.ts` (imports 12-46; the media-load block **183-215**; the rewind loop **308-315**; `syncVideoToTime` **318-341**; `cleanup` **344-352**; the frame body **366-517**; the two `cleanup()` calls at **643** and **655**)
- **Must stay byte-identical:** `apps/artist/src/core/exportWebM.perf.test.ts`, `apps/artist/src/core/exportMP4.perf.test.ts`

**Interfaces:**

- Consumes (all already imported by `exportWebM.ts`): `getVideoBlob` from `./storage`; `getClipsAtTime` from `../store/projectStore`; `getAnimatedValues` from `../utils/animation`; `openOutputFrame` from `./outputTransform`; `getActiveTransition`, `loadVideoElement`, `loadImageElement`, `type MediaDrawOptions` from `./exportTypes`; `drawClipToCanvas`, `drawImageToCanvasWithModifiers`, `drawTransition`, `drawTextOverlayToCanvasAnimated`, `drawShapeOverlayToCanvasAnimated` from `./canvasRenderer`; `DEFAULT_TRANSFORM`, `DEFAULT_EFFECTS` from `../store/types`; `type PixelSize` from `./outputTransform`.
- Produces, in `apps/artist/src/core/elementFrames.ts`:

```ts
/** The `<video>` and `<img>` elements an export draws its media clips from, by source id. */
export interface ElementSources {
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
}

/** Whether each loaded `<video>` is playing, and where it was last asked to be. */
export type VideoPlaybackState = Map<string, { playing: boolean; targetTime: number }>;

/** Load every unique media source the clips reference into an element. */
export function loadElementSources(
  clips: Clip[],
  sourceMap: Map<string, SourceVideo>
): Promise<ElementSources>;

/** Pause and rewind every loaded `<video>`: the one-time setup before a frame loop. */
export function rewindElementSources(sources: ElementSources): VideoPlaybackState;

/** Pause every `<video>` and revoke every element's object URL. */
export function releaseElementSources(sources: ElementSources): void;

export interface FrameComposerParams {
  ctx: CanvasRenderingContext2D;
  /** The same canvas `ctx` belongs to — a background-blurring shape overlay reads it back. */
  canvas: HTMLCanvasElement;
  clips: Clip[];
  tracks: Track[];
  sources: ElementSources;
  playbackState: VideoPlaybackState;
  projectSize: PixelSize;
  outputSize: PixelSize;
  drawOptions: MediaDrawOptions;
  /** Output frame rate — the seek tolerance is half a frame of it. */
  frameRate: number;
}

/** Draw the whole timeline at one instant onto `ctx`. Resolves once the frame is complete. */
export type FrameComposer = (currentTime: number) => Promise<void>;

export function createFrameComposer(params: FrameComposerParams): FrameComposer;
```

**This task is a refactor, so it is NOT red first — and here is what replaces that.** Nothing about the behaviour changes, so there is no failing test to write. Two things make the safety real instead of asserted:

- **Step 1 is a mutation step**: before touching `exportWebM.ts`, break one line of the frame body, run `exportWebM.perf.test.ts` and `exportWebM.test.ts`, and record that they go red. That proves those two files actually cover the code about to move. Then revert.
- **Step 7 proves the two perf files are byte-unchanged** with `git diff --stat`, and runs both green.

**Four decisions this task pins, all argued in the commit message:**

- **The extraction moves code, it does not improve it.** Every line below is the line that was in `exportWebM.ts`, including the `console.warn` strings, the 500 ms seek fallback, the 300 ms readiness fallback, the `readyState >= 2` gate, the `videoPlaybackState` pause loop and the comment explaining why `activeClips`' own order is the composite order. A refactor that also tidies is a refactor whose regressions cannot be attributed.
- **The call order is preserved at the call site, not just inside the helper.** `loadElementSources` is called exactly where the inline loop was (after the "Loading media files…" progress report, before the mediabunny output is constructed); `rewindElementSources` exactly where the "Initialize all videos as paused" loop was (after both encoders are configured); `createFrameComposer` immediately after it. That is what keeps `exportWebM.perf.test.ts`'s `seeks` count (`1 + FRAMES × ACTIVE_MEDIA_CLIPS`) and its canvas-call split unchanged.
- **The composer takes `frameRate`, not a hard-coded 30.** `syncVideoToTime`'s "already close enough" tolerance is `(1 / frameRate) * 0.4`, which for WebM is the 30 fps it always was and for GIF is 10/15/20. This is the one parameter that had to become a parameter.
- **`openOutputFrame` stays the composer's first call and the frame's definition.** Both perf files split their recorded canvas calls into frames by looking for `setTransform` immediately followed by the full-raster `fillRect` — which is `openOutputFrame`. Moving it into the composer keeps that splitter valid for all three pipelines, and is why `exportGIF.perf.test.ts` can reuse it verbatim.

- [ ] **Step 1: Prove the existing tests cover the code about to move (the mutation step)**

In `apps/artist/src/core/exportWebM.ts`, temporarily change line **450** from

```ts
          if (video && video.readyState >= 2) {
```

to

```ts
          if (video && video.readyState >= 3) {
```

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportWebM.perf.test.ts src/core/exportWebM.test.ts`
Expected: FAIL. Record the exact failure text (the perf file's `drawImagesPerFrame` assertion and `exportWebM.test.ts`'s drawing cases). Then **revert the line** and re-run to confirm green before going on. This is the evidence that the two files guard the extraction.

- [ ] **Step 2: Write the helper's own unit test** — create `apps/artist/src/core/elementFrames.test.ts`

```ts
// The per-frame machinery both element-drawing exporters share (ESCSUITE-34).
//
// `exportWebM.ts` had all of this inline and `exportGIF.ts` needed the same
// thing, so it was lifted here rather than copied. The exporters' own suites
// (`exportWebM.test.ts`, `exportGIF.test.ts`) still cover it end to end; these
// cases cover the four exported functions directly, where a specific question —
// "does a source with no bytes get skipped", "is a seek inside half a frame of
// the target skipped" — is cheaper to ask than through a whole export.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createFrameComposer,
  loadElementSources,
  releaseElementSources,
  rewindElementSources,
} from './elementFrames'
import { storeVideo } from './storage'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip, SourceVideo } from '../store/types'

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>

const PROJECT = { width: 640, height: 360 }

beforeEach(() => {
  installCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  media.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
})

async function store(id: string, mimeType = 'video/webm', mediaType?: SourceVideo['mediaType']) {
  await storeVideo(
    id,
    new Blob([new Uint8Array(8)], { type: mimeType }),
    makeSourceVideo({ id, mediaType })
  )
}

function sourceMapOf(sources: SourceVideo[]): Map<string, SourceVideo> {
  return new Map(sources.map((s) => [s.id, s]))
}

/** A canvas plus its recording context, the way the exporters build one. */
function outputCanvas(): { canvas: HTMLCanvasElement; ctx: RecordingCanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = PROJECT.width
  canvas.height = PROJECT.height
  canvas.getContext('2d', { alpha: false })
  return { canvas, ctx: getLastCanvasContext() as RecordingCanvasRenderingContext2D }
}

describe('loadElementSources', () => {
  it('loads a video source into a <video> element', async () => {
    await store('v1')
    const sources = await loadElementSources([makeClip({ sourceVideoId: 'v1' })], sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    expect([...sources.videoElements.keys()]).toEqual(['v1'])
    expect(sources.imageElements.size).toBe(0)
  })

  it('loads an image source into an <img> element', async () => {
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })])
    )

    expect([...sources.imageElements.keys()]).toEqual(['i1'])
    expect(sources.videoElements.size).toBe(0)
  })

  it('skips an audio-only source: nothing visual is drawn from it', async () => {
    await store('a1', 'audio/webm', 'audio')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'a1' })],
      sourceMapOf([makeSourceVideo({ id: 'a1', mediaType: 'audio' })])
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(0)
  })

  it('skips a source with no bytes in storage rather than failing the export', async () => {
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'ghost' })],
      sourceMapOf([makeSourceVideo({ id: 'ghost' })])
    )

    expect(sources.videoElements.size).toBe(0)
  })

  it('ignores an overlay clip, which has no source id at all', async () => {
    const sources = await loadElementSources([makeClip({ sourceVideoId: '' })], new Map())

    expect(sources.videoElements.size).toBe(0)
  })

  it('loads each unique source once however many clips use it', async () => {
    await store('v1')
    const clips: Clip[] = [
      makeClip({ id: 'c1', sourceVideoId: 'v1' }),
      makeClip({ id: 'c2', sourceVideoId: 'v1' }),
    ]
    await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    expect(media.videos).toHaveLength(1)
  })

  it('falls back to loading a video that will not load as an image', async () => {
    await store('v1')
    media.script.video = { ...media.script.video, failLoad: true }

    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(1)
    expect(warns).toHaveBeenCalled()
  })
})

describe('rewindElementSources', () => {
  it('pauses and rewinds every loaded video, once', async () => {
    await store('v1')
    const sources = await loadElementSources([makeClip({ sourceVideoId: 'v1' })], sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    const state = rewindElementSources(sources)

    expect(media.seeks).toEqual([0])
    expect(state.get('v1')).toEqual({ playing: false, targetTime: 0 })
  })
})

describe('releaseElementSources', () => {
  it('revokes the object URL behind every element', async () => {
    await store('v1')
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'i1', mediaType: 'image' })])
    )
    vi.mocked(URL.revokeObjectURL).mockClear()

    releaseElementSources(sources)

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})

describe('createFrameComposer', () => {
  it('opens the frame by clearing the whole raster to black', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()

    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0)

    expect(ctx.argsFor('fillRect')).toEqual([[0, 0, PROJECT.width, PROJECT.height]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#000000')
    expect(ctx.argsFor('drawImage')).toHaveLength(1)
  })

  it('skips a seek that is already within half an output frame of the target', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 10,
    })
    const seeksBefore = media.seeks.length

    // The element sits at 0 after the rewind. At 10 fps the tolerance is
    // 0.4 / 10 = 40 ms, so a frame at t = 0.02 reuses the position it has and a
    // frame at t = 0.1 does not.
    await composeFrame(0.02)
    expect(media.seeks).toHaveLength(seeksBefore)

    await composeFrame(0.1)
    expect(media.seeks).toHaveLength(seeksBefore + 1)
  })
})
```

> **Note for the implementer:** `media.script.video.failLoad` and `media.script` are the names in `src/test/doubles/media.ts` at `834dabd` — read that file (`VideoScript`, `MediaDoubles`) and use whatever the double actually calls "make the next load fail". If the double has no such lever, drop the `falls back to loading a video that will not load as an image` case and say so in the report: that arm is already covered by `exportWebM.test.ts`, which this extraction leaves untouched, and inventing a lever in a shared double is a bigger change than this task should make.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/elementFrames.test.ts`
Expected: FAIL — `Failed to resolve import "./elementFrames"`. Quote the exact text.

- [ ] **Step 4: Create the helper** — `apps/artist/src/core/elementFrames.ts`

```ts
// The per-frame machinery an exporter that draws media *elements* needs
// (ESCSUITE-34).
//
// `exportWebM.ts` had all of this inline: load each unique source into a
// `<video>` or `<img>`, rewind them once, seek the live ones to their clip time
// each frame, draw every live clip in one track-ordered pass, draw the
// transition if one is running, and revoke the object URLs at the end. GIF
// export needs exactly the same thing with a different encoder at the end of the
// frame, so it was lifted here rather than copied — a per-frame drawing
// behaviour one pipeline has to remember to reproduce is a behaviour that
// drifts, which is the same argument `core/outputTransform.ts` was written on.
//
// `exportMP4.ts` is NOT a caller: it decodes through `VideoDecodeManager` and
// `frameSource.ts` and draws `VideoFrame`s, so it shares the renderer but not
// this. There are two element-drawing pipelines, not three.
//
// Lifted unchanged, deliberately — the same `console.warn` strings, the same
// 500 ms seek fallback and 300 ms readiness fallback, the same `readyState >= 2`
// gate. A move that also tidies is a move whose regressions cannot be
// attributed, and `exportWebM.perf.test.ts` is byte-identical across it.
import type { Clip, SourceVideo, Track } from '../store/types';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '../store/types';
import { getVideoBlob } from './storage';
import { getClipsAtTime } from '../store/projectStore';
import { getAnimatedValues } from '../utils/animation';
import { openOutputFrame, type PixelSize } from './outputTransform';
import {
  getActiveTransition,
  loadVideoElement,
  loadImageElement,
  type MediaDrawOptions,
} from './exportTypes';
import {
  drawClipToCanvas,
  drawImageToCanvasWithModifiers,
  drawTransition,
  drawTextOverlayToCanvasAnimated,
  drawShapeOverlayToCanvasAnimated,
} from './canvasRenderer';

/** The `<video>` and `<img>` elements an export draws its media clips from, by source id. */
export interface ElementSources {
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
}

/** Whether each loaded `<video>` is playing, and where it was last asked to be. */
export type VideoPlaybackState = Map<string, { playing: boolean; targetTime: number }>;

/**
 * Load every unique media source the clips reference into an element.
 *
 * A source with no bytes in storage, an audio-only source, and a clip with no
 * source id at all (every overlay) are all skipped rather than failing the
 * export: a timeline that references something missing renders without it, the
 * way the editor's own preview does.
 */
export async function loadElementSources(
  clips: Clip[],
  sourceMap: Map<string, SourceVideo>
): Promise<ElementSources> {
  const videoElements: Map<string, HTMLVideoElement> = new Map();
  const imageElements: Map<string, HTMLImageElement> = new Map();

  // Get unique source IDs, filtering out empty ones (overlay clips have no sourceVideoId)
  const uniqueSourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id && id.length > 0))];

  for (const sourceId of uniqueSourceIds) {
    const source = sourceMap.get(sourceId);
    const blob = await getVideoBlob(sourceId);

    if (blob) {
      if (source?.mediaType === 'image') {
        // Load as image
        const img = await loadImageElement(blob);
        imageElements.set(sourceId, img);
      } else if (source?.mediaType !== 'audio') {
        // Load as video (skip audio-only files for visual rendering)
        try {
          const video = await loadVideoElement(blob);
          videoElements.set(sourceId, video);
        } catch (e) {
          console.warn(`Failed to load video ${sourceId}, trying as image:`, e);
          // Try loading as image as fallback
          try {
            const img = await loadImageElement(blob);
            imageElements.set(sourceId, img);
          } catch {
            console.warn(`Failed to load media ${sourceId}`);
          }
        }
      }
    }
  }

  return { videoElements, imageElements };
}

/**
 * Pause and rewind every loaded `<video>`: the one-time setup a frame loop does
 * before its first frame. The returned map is the state the composer keeps.
 *
 * These are the seeks `exportWebM.perf.test.ts` discounts as `initSeeks` — one
 * per element, never part of the per-frame cost.
 */
export function rewindElementSources(sources: ElementSources): VideoPlaybackState {
  const playbackState: VideoPlaybackState = new Map();
  for (const [sourceId, video] of sources.videoElements) {
    video.pause();
    video.currentTime = 0;
    playbackState.set(sourceId, { playing: false, targetTime: 0 });
  }
  return playbackState;
}

/** Pause every `<video>` and revoke every element's object URL. */
export function releaseElementSources(sources: ElementSources): void {
  sources.videoElements.forEach((v) => {
    v.pause();
    URL.revokeObjectURL(v.src);
  });
  sources.imageElements.forEach((img) => {
    URL.revokeObjectURL(img.src);
  });
}

/**
 * Sync a video to a target time. Always seeks to the exact time for
 * frame-accurate export, skipping the seek when the element is already within
 * (a little under) half an output frame of it.
 */
async function syncVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  frameRate: number
): Promise<void> {
  // Always seek to exact time for frame-accurate export.
  // Skip if already within half a frame of the target.
  const frameDuration = 1 / frameRate;
  if (Math.abs(video.currentTime - targetTime) > frameDuration * 0.4) {
    video.currentTime = targetTime;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      setTimeout(resolve, 500);
    });
  }

  // Ensure frame data is decoded (readyState >= 2 = HAVE_CURRENT_DATA)
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (video.readyState >= 2) resolve();
        else requestAnimationFrame(check);
      };
      check();
      setTimeout(resolve, 300);
    });
  }
}

export interface FrameComposerParams {
  ctx: CanvasRenderingContext2D;
  /** The same canvas `ctx` belongs to — a background-blurring shape overlay reads it back. */
  canvas: HTMLCanvasElement;
  clips: Clip[];
  tracks: Track[];
  sources: ElementSources;
  playbackState: VideoPlaybackState;
  projectSize: PixelSize;
  outputSize: PixelSize;
  drawOptions: MediaDrawOptions;
  /** Output frame rate — the seek tolerance is a little under half a frame of it. */
  frameRate: number;
}

/** Draw the whole timeline at one instant onto `ctx`. Resolves once the frame is complete. */
export type FrameComposer = (currentTime: number) => Promise<void>;

/**
 * One frame of the timeline, drawn with media *elements*.
 *
 * The first call every frame makes is `openOutputFrame` — the project-to-output
 * transform followed immediately by the full-raster black fill — which is also
 * how both export perf files split their recorded canvas calls into frames. It
 * stays first here so that splitter holds for every element-drawing pipeline.
 */
export function createFrameComposer({
  ctx,
  canvas,
  clips,
  tracks,
  sources,
  playbackState,
  projectSize,
  outputSize,
  drawOptions,
  frameRate,
}: FrameComposerParams): FrameComposer {
  const { videoElements, imageElements } = sources;

  return async function composeFrame(currentTime: number): Promise<void> {
    // Check for active transition
    const activeTransition = getActiveTransition(clips, tracks, currentTime);

    // Get all clips at current time
    const activeClips = getClipsAtTime(clips, tracks, currentTime);

    // Clear the raster to black and put the context in project pixels: every
    // draw below is project-space, exactly as the preview's is.
    openOutputFrame(ctx, projectSize, outputSize);

    // Media clips need their source video synced to time (below) before
    // anything can be drawn; overlays don't. `activeClips` itself —
    // `getClipsAtTime`'s result — is already sorted by track index, and
    // stays the single source of composite order: see the draw loop below.
    const mediaClips: typeof activeClips = [];

    for (const clipData of activeClips) {
      if (!clipData.clip.overlayType) {
        mediaClips.push(clipData);
      }
    }

    // Sync all active videos to their target times
    const syncPromises: Promise<void>[] = [];
    const activeVideoIds = new Set<string>();

    for (const { clip, clipTime } of mediaClips) {
      const video = videoElements.get(clip.sourceVideoId);
      if (!video) continue;

      const sourceTime = clip.startTime + clipTime;
      activeVideoIds.add(clip.sourceVideoId);
      syncPromises.push(syncVideoToTime(video, sourceTime, frameRate));
    }

    // Also sync transition clips
    if (activeTransition) {
      const incomingVideo = videoElements.get(activeTransition.incomingClip.sourceVideoId);
      if (incomingVideo) {
        const clipEnd = activeTransition.outgoingClip.timelinePosition + activeTransition.outgoingClip.duration;
        const incomingClipTime = currentTime - clipEnd;
        const sourceTime = incomingClipTime >= 0
          ? activeTransition.incomingClip.startTime + incomingClipTime
          : activeTransition.incomingClip.startTime;
        activeVideoIds.add(activeTransition.incomingClip.sourceVideoId);
        syncPromises.push(syncVideoToTime(incomingVideo, sourceTime, frameRate));
      }
    }

    // Pause videos that are no longer active
    for (const [sourceId, video] of videoElements) {
      if (!activeVideoIds.has(sourceId)) {
        const state = playbackState.get(sourceId)!;
        if (state.playing) {
          video.pause();
          state.playing = false;
        }
      }
    }

    await Promise.all(syncPromises);

    // Helper to calculate clip time
    const getClipTime = (clip: Clip) => currentTime - clip.timelinePosition;

    // Composite media and overlay clips in one pass, in `activeClips`' own
    // track order — the same single interleaved pass the preview draws
    // (`components/Preview/drawFrame.ts`), so an overlay on a lower track
    // than a media clip is exactly as hidden behind it here as it is on
    // screen, and a blur shape only reaches the content actually below it.
    for (const { clip } of activeClips) {
      // Skip clips that are part of an active transition
      if (activeTransition &&
          (clip.id === activeTransition.outgoingClip.id || clip.id === activeTransition.incomingClip.id)) {
        continue;
      }

      if (!clip.overlayType) {
        const clipTime = getClipTime(clip);

        // Try video first, then image - require readyState >= 2 (frame data available)
        const video = videoElements.get(clip.sourceVideoId);
        if (video && video.readyState >= 2) {
          drawClipToCanvas(
            ctx, video, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
          );
          continue;
        }

        const image = imageElements.get(clip.sourceVideoId);
        if (image) {
          drawImageToCanvasWithModifiers(
            ctx, image, clip, clipTime, projectSize.width, projectSize.height, undefined, drawOptions
          );
        }
        continue;
      }

      const overlayClipTime = getClipTime(clip);

      // Build base transform from overlay's own properties
      let baseTransform = clip.transform || DEFAULT_TRANSFORM;

      if (clip.overlayType === 'text' && clip.textData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.textData.x,
          y: clip.textData.y,
          scaleX: clip.textData.scale ?? 1,
          scaleY: clip.textData.scale ?? 1,
          rotation: clip.textData.rotation ?? 0,
        };
      } else if (clip.overlayType === 'shape' && clip.shapeData) {
        baseTransform = {
          ...DEFAULT_TRANSFORM,
          ...clip.transform,
          x: clip.shapeData.x,
          y: clip.shapeData.y,
          rotation: clip.shapeData.rotation,
        };
      }

      const animated = getAnimatedValues(
        overlayClipTime,
        clip.duration,
        clip.animation,
        baseTransform,
        clip.effects || DEFAULT_EFFECTS
      );

      if (clip.overlayType === 'shape' && clip.shapeData) {
        drawShapeOverlayToCanvasAnimated(
          ctx, clip.shapeData, projectSize.width, projectSize.height, animated, canvas,
          undefined, drawOptions.filterScale
        );
      } else if (clip.overlayType === 'text' && clip.textData) {
        drawTextOverlayToCanvasAnimated(
          ctx, clip.textData, projectSize.width, projectSize.height, animated, drawOptions.filterScale
        );
      }
    }

    // Draw transition if active
    if (activeTransition) {
      drawTransition(
        ctx, videoElements, imageElements, activeTransition, currentTime,
        projectSize.width, projectSize.height, drawOptions
      );
    }
  };
}
```

- [ ] **Step 5: Run the helper's test green**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/elementFrames.test.ts`
Expected: PASS.

- [ ] **Step 6: Make `exportWebM.ts` the first caller**

Five edits, in file order. Nothing else in the file changes.

1. **Imports.** Delete `getVideoBlob`, `getClipsAtTime`, `getAnimatedValues`, the `openOutputFrame` import's `openOutputFrame` name (keep `projectToOutputScale`), `loadVideoElement`, `loadImageElement`, `getActiveTransition`, the whole `./canvasRenderer` import block, and `DEFAULT_TRANSFORM` / `DEFAULT_EFFECTS`. Add:

```ts
import { projectToOutputScale } from './outputTransform';
import {
  createFrameComposer,
  loadElementSources,
  releaseElementSources,
  rewindElementSources,
} from './elementFrames';
```

Keep every other import. `tsc` and `eslint`'s `no-unused-vars` will name anything left over — let them.

2. **The media-load block (183-215)** becomes one line, leaving the progress report above it where it is:

```ts
  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const sources = await loadElementSources(clips, sourceMap);
```

3. **The rewind loop (308-315), `syncVideoToTime` (318-341) and `cleanup` (344-352)** become, in the same place:

```ts
  // Pause and rewind every source before the frame loop: one seek per element,
  // never part of the per-frame cost.
  const playbackState = rewindElementSources(sources);

  const composeFrame = createFrameComposer({
    ctx,
    canvas,
    clips,
    tracks: exportTracks,
    sources,
    playbackState,
    projectSize,
    outputSize,
    drawOptions,
    frameRate,
  });
```

4. **The frame body (366-517)** — everything from `const currentTime = …` down to the end of the `if (activeTransition) { drawTransition(…) }` block — becomes:

```ts
      const currentTime = rangeStart + frameIndex / frameRate;

      await composeFrame(currentTime);
```

The `const exportTime = currentTime - rangeStart;` line and everything after it (the `VideoFrame`, the encode, the backpressure wait, the progress report) stays exactly as it is.

5. **Both `cleanup()` calls** (the success path at ~643 and the catch at ~655) become `releaseElementSources(sources);`.

- [ ] **Step 7: Prove the two perf files are byte-unchanged, and green**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git diff --stat -- apps/artist/src/core/exportWebM.perf.test.ts apps/artist/src/core/exportMP4.perf.test.ts
```

Expected: **empty output**. If either file appears, revert it (`git checkout --` that path) and fix the source instead — a ceiling file is never edited to accommodate a refactor.

```bash
pnpm --filter @escapesuite/artist exec vitest run \
  src/core/exportWebM.perf.test.ts src/core/exportMP4.perf.test.ts src/core/exportWebM.test.ts
```

Expected: PASS, all three. Record the counts. The ones most likely to catch a bad extraction, and what they mean if they move:

| Assertion | If it moves |
|---|---|
| `measured.seeks === 1 + FRAMES * ACTIVE_MEDIA_CLIPS` | `rewindElementSources` is being called more than once, or the per-frame sync loop changed |
| `measured.setTransformsPerFrame === 1` | `openOutputFrame` is no longer the composer's first call, or is called twice |
| `measured.savesPerFrame === measured.restoresPerFrame` | the draw loop lost a `restore` on the way across |
| `measured.getContexts === 1` | the helper is creating a canvas of its own, which it must not |
| `measured.animationLookups === FRAMES * ACTIVE_CLIPS` | a clip is being drawn twice, or the interleaved single pass became two passes |

- [ ] **Step 8: Verify the package**

```bash
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
pnpm --filter @escapesuite/artist exec vitest run
```

- [ ] **Step 9: Commit**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/src/core/elementFrames.ts apps/artist/src/core/elementFrames.test.ts \
        apps/artist/src/core/exportWebM.ts
git commit -m "$(cat <<'MSG'
refactor(artist): lift the WebM exporter's per-frame machinery into elementFrames.ts (ESCSUITE-34)

GIF export needs exactly what `exportWebM.ts` already does per frame — load each
unique source into a `<video>` or `<img>`, rewind them once, seek the live ones
to their clip time, draw every live clip in one track-ordered pass, draw the
transition if one is running, revoke the object URLs at the end — with a
different encoder at the end of the frame. So it is lifted into one module with
two callers rather than copied into a second exporter. A per-frame drawing
behaviour one pipeline has to remember to reproduce is a behaviour that drifts,
which is the argument `core/outputTransform.ts` was written on.

`exportMP4.ts` is deliberately not a caller: it decodes through
`VideoDecodeManager` and draws `VideoFrame`s. There are two element-drawing
pipelines, not three.

Lifted unchanged on purpose — the same `console.warn` strings, the same 500 ms
seek fallback and 300 ms readiness fallback, the same `readyState >= 2` gate,
the same comment explaining why `getClipsAtTime`'s own order is the composite
order. A move that also tidies is a move whose regressions cannot be
attributed. The one line that had to change is `syncVideoToTime`'s tolerance,
which now reads a `frameRate` parameter instead of a closed-over 30: WebM still
passes 30 and GIF will pass 10, 15 or 20.

The call *order* is preserved at the call site, not just inside the helper.
`loadElementSources` is called where the inline loop was, `rewindElementSources`
where the "initialize all videos as paused" loop was, and `createFrameComposer`
immediately after — which is what keeps `exportWebM.perf.test.ts`'s seek count
(1 + 30 x 2) and its canvas-call-per-frame split unchanged.

Both export ceiling files are byte-identical across this commit and green:
`git diff --stat` over `exportWebM.perf.test.ts` and `exportMP4.perf.test.ts` is
empty. Before touching anything, line 450's `readyState >= 2` was mutated to
`>= 3` and both `exportWebM.perf.test.ts` and `exportWebM.test.ts` went red,
which is the evidence that they actually cover the code this commit moves.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

### Task 3: `core/exportGIF.ts`, the widened types, and its two test files

**Files:**
- Modify: `apps/artist/src/store/types.ts` (`ExportOptions` **800-805**, `ExportProgress` **807-811**)
- Modify: `apps/artist/src/core/exportTypes.ts` (`getResolution`'s doc comment **~440-455** and its `targetHeights` map **476-480**; the new GIF constants and helpers appended after `getResolution`)
- Modify: `apps/artist/src/core/exportTypes.test.ts` (`describe('getResolution')` at **547**; new describes appended)
- Create: `apps/artist/src/core/exportGIF.ts`
- Create: `apps/artist/src/core/exportGIF.test.ts`
- Create: `apps/artist/src/core/exportGIF.perf.test.ts`
- Modify: `apps/artist/src/core/exporter.ts` (the barrel, 10-24)

**Interfaces:**

- Consumes: Task 1's `createGifWriter` from `./gifEncoder`; Task 2's four functions from `./elementFrames`; `checkAborted`, `getResolution`, `getBaseDimensions`, `yieldToMain`, `calculateTimelineDuration`, `ExportError`, `type ExportLogEntry`, `type MediaDrawOptions`, `type ProgressCallback` from `./exportTypes`; `projectToOutputScale` from `./outputTransform`.
- Produces in `apps/artist/src/store/types.ts`:

```ts
export interface ExportOptions {
  format: 'webm' | 'mp4' | 'gif';
  quality: 'low' | 'medium' | 'high';
  resolution: 'project' | '1080p' | '720p' | '480p' | '360p';
  timeRange?: { start: number; end: number };
  /** GIF only: 10, 15 (default) or 20. Ignored by the two video formats. */
  fps?: 10 | 15 | 20;
}

export interface ExportProgress {
  phase: 'preparing' | 'encoding' | 'muxing' | 'complete' | 'error';
  progress: number;       // 0-100
  message: string;
  /** GIF only: the projected finished size in bytes, from what has been written so far. */
  estimatedBytes?: number;
}
```

- Produces in `apps/artist/src/core/exportTypes.ts`:

```ts
export const GIF_FPS_OPTIONS = [10, 15, 20] as const;
export type GifFps = (typeof GIF_FPS_OPTIONS)[number];
export const DEFAULT_GIF_FPS: GifFps = 15;
export function gifFrameRate(fps: number | undefined): GifFps;

export const GIF_RESOLUTIONS = ['720p', '480p', '360p'] as const;
export const DEFAULT_GIF_RESOLUTION: ExportOptions['resolution'] = '480p';
export function resolutionForFormat(
  format: ExportOptions['format'],
  resolution: ExportOptions['resolution']
): ExportOptions['resolution'];

export const GIF_LONG_RANGE_SECONDS = 30;
export const GIF_LONG_RANGE_WARNING: string;
export const GIF_ALWAYS_AVAILABLE_NOTE: string;
export function isGIFExportSupported(): boolean;
```

- Produces in `apps/artist/src/core/exportGIF.ts`:

```ts
/**
 * Projected GIF size before a single frame has been encoded: pixels x frames x
 * ~0.3 bytes. The spec's own heuristic.
 */
export function estimateGifBytes(width: number, height: number, frames: number): number;

/** Export the timeline (or `options.timeRange` of it) as an animated GIF. */
export function exportToGIF(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<Blob>;
```

The argument list is `exportToWebM`'s and `exportToMP4`'s, in the same order, so the dialog's dispatch and the headless renderer's dispatch are one-line additions rather than a third calling convention.

**Seven decisions this task pins, all argued in the commit message:**

- **`'360p'` is on the shared resolution type, and `resolutionForFormat` is what keeps it GIF-only.** Splitting the type per format would mean a second resolution union, a second `getResolution` overload and a second headless `RESOLUTIONS` list. One union plus one pure function that answers "is this preset legal for this format, and if not what is" is smaller, and it is the function the dialog's radios and the headless validator both read.
- **`fps` lives on `ExportOptions`, not in a GIF-specific options object.** The exporters take one options type; a GIF-only second one would have to be threaded through the dialog, the headless job spec and the kit's `RenderFileInput`. `gifFrameRate(undefined)` is 15, so every existing caller keeps working untouched and a bad value lands on the default rather than encoding at 7 fps.
- **`estimatedBytes` rides on `ExportProgress` rather than a second callback.** The dialog already renders `progress` on every report; one optional field reaches it with no new plumbing, and the two video exporters never set it so nothing about their progress changes.
- **The estimate is bytes-so-far ÷ frames-done × frames-total, and it is only reported once a frame has been written.** Dividing by zero on the first report would put `Infinity` or `NaN` into the UI. Before the loop the dialog shows its own heuristic instead (`estimateGifBytes`), which is why that function is exported from here rather than inlined in the component.
- **GIF does not extract audio at all.** No `extractAndMixAudio` call, not even a discarded one — a GIF has no audio track and mixing the timeline's audio to throw it away is the most expensive no-op in the pipeline. The tests assert the mixer is never called.
- **The context is `{ alpha: false, willReadFrequently: true }`.** Every frame reads the whole raster back; without that hint a browser keeps the canvas GPU-backed and each `getImageData` is a readback stall. `alpha: false` matches the other two exporters — a GIF written from a frame with no transparency needs no alpha channel, and v1 has no transparency.
- **`getImageData` is called under the output transform and that is correct.** `getImageData` reads device pixels and ignores the current transformation matrix, so the frame handed to the encoder is the full output raster including any letterbox bar — exactly what the encoder should see. No `save`/`restore`/`setTransform` is added around it, which is why the ceiling file can assert one `setTransform` per frame.

- [ ] **Step 1: Write the failing type-and-helper tests** — append to `apps/artist/src/core/exportTypes.test.ts`

Inside the existing `describe('getResolution')` block, add:

```ts
  it('scales a GIF preset to 360p, keeping the project’s aspect', () => {
    // '360p' exists for GIF only (ESCSUITE-34) but is one entry on the shared
    // resolution union, so `getResolution` answers it the same way it answers
    // the other three: fixed height, width from the project's aspect, rounded
    // to even. 16:9 of 360 is 640.
    expect(getResolution('360p', 1920, 1080)).toEqual({ width: 640, height: 360 })
    expect(getResolution('360p', 640, 480, { width: 1280, height: 720 }))
      .toEqual({ width: 640, height: 360 })
  })

  it('rounds a 360p width up to even', () => {
    // 4:3 of 360 is 480 (even). A 1000x750 project is 4:3 too; pick an aspect
    // whose 360p width is odd: 1001/750 x 360 = 480.48 -> 480. Use 999x1000,
    // whose 360p width is 360 (even), and 1125x1000, whose is 405 -> 406.
    expect(getResolution('360p', 1125, 1000)).toEqual({ width: 406, height: 360 })
  })
```

Then append, after the file's last describe:

```ts
describe('gifFrameRate', () => {
  it.each(GIF_FPS_OPTIONS)('passes %s through, the three rates the dialog offers', (fps) => {
    expect(gifFrameRate(fps)).toBe(fps)
  })

  it('defaults to 15 when no rate was asked for', () => {
    // Every caller that predates GIF export leaves `options.fps` undefined.
    expect(gifFrameRate(undefined)).toBe(DEFAULT_GIF_FPS)
    expect(DEFAULT_GIF_FPS).toBe(15)
  })

  it.each([0, 7, 30, -5, 15.5, Number.NaN])('falls back to the default for %s', (fps) => {
    // A hand-built headless job spec or a stale saved setting can carry
    // anything. Landing on the default beats encoding a 90-second GIF at 0 fps.
    expect(gifFrameRate(fps)).toBe(DEFAULT_GIF_FPS)
  })
})

describe('resolutionForFormat', () => {
  it.each(GIF_RESOLUTIONS)('keeps %s when the format is gif', (resolution) => {
    expect(resolutionForFormat('gif', resolution)).toBe(resolution)
  })

  it.each(['project', '1080p'] as const)('lands %s on 480p when the format is gif', (resolution) => {
    // GIF offers exactly 720p/480p/360p, so switching to GIF from a selection
    // it does not offer has to land somewhere: the spec's default, 480p.
    expect(resolutionForFormat('gif', resolution)).toBe(DEFAULT_GIF_RESOLUTION)
    expect(DEFAULT_GIF_RESOLUTION).toBe('480p')
  })

  it.each(['webm', 'mp4'] as const)('lands 360p on 480p when the format is %s', (format) => {
    // The mirror: 360p is GIF-only, so switching away from GIF has to move off
    // it rather than configure a video encoder at a size no preset offers.
    expect(resolutionForFormat(format, '360p')).toBe('480p')
  })

  it.each(['project', '1080p', '720p', '480p'] as const)(
    'leaves %s alone when the format is webm',
    (resolution) => {
      expect(resolutionForFormat('webm', resolution)).toBe(resolution)
    }
  )
})

describe('isGIFExportSupported', () => {
  it('is true with no WebCodecs at all', () => {
    const restore = removeWebCodecsGlobals()

    // The whole point of the format: `gifenc` is pure JS, so a browser that can
    // encode neither VP9/VP8 nor H.264 can still export a GIF (ESCSUITE-34).
    expect(isGIFExportSupported()).toBe(true)

    restore()
  })

  it('is true with WebCodecs present', () => {
    expect(isGIFExportSupported()).toBe(true)
  })
})

describe('GIF_LONG_RANGE_WARNING', () => {
  it('names the 30-second threshold it is shown past, and suggests WebM', () => {
    // A soft warning, never a refusal (spec). The dialog compares the export's
    // own length against GIF_LONG_RANGE_SECONDS.
    expect(GIF_LONG_RANGE_SECONDS).toBe(30)
    expect(GIF_LONG_RANGE_WARNING).toMatch(/30 seconds/)
    expect(GIF_LONG_RANGE_WARNING).toMatch(/WebM/)
  })
})
```

Add `GIF_FPS_OPTIONS`, `DEFAULT_GIF_FPS`, `gifFrameRate`, `GIF_RESOLUTIONS`, `DEFAULT_GIF_RESOLUTION`, `resolutionForFormat`, `isGIFExportSupported`, `GIF_LONG_RANGE_SECONDS` and `GIF_LONG_RANGE_WARNING` to the file's existing `from './exportTypes'` import, and `removeWebCodecsGlobals` to its `from '../test/doubles/webcodecs'` import if it is not already there.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportTypes.test.ts`
Expected: FAIL — `No "gifFrameRate" export is defined on the "./exportTypes" mock` or, more likely, a transform error naming the missing exports. Quote the exact text.

- [ ] **Step 3: Widen the two types** — `apps/artist/src/store/types.ts`

Replace lines 800-811 with:

```ts
// Export options
export interface ExportOptions {
  format: 'webm' | 'mp4' | 'gif';
  quality: 'low' | 'medium' | 'high';
  resolution: 'project' | '1080p' | '720p' | '480p' | '360p';
  timeRange?: { start: number; end: number };
  /**
   * GIF only: 10, 15 (default) or 20 frames per second (ESCSUITE-34). The two
   * video formats always encode at 30 and ignore this. Read through
   * `gifFrameRate()` rather than directly, so a stale saved setting or a
   * hand-built headless job spec lands on the default instead of encoding at
   * whatever number it carried.
   */
  fps?: 10 | 15 | 20;
}

export interface ExportProgress {
  phase: 'preparing' | 'encoding' | 'muxing' | 'complete' | 'error';
  progress: number;       // 0-100
  message: string;
  /**
   * GIF only: the projected size of the finished file in bytes, from the bytes
   * actually written so far (ESCSUITE-34). Absent on every WebM and MP4 report,
   * and absent on a GIF report made before the first frame was written — the
   * dialog shows its own up-front heuristic until then.
   */
  estimatedBytes?: number;
}
```

- [ ] **Step 4: Teach `getResolution` about 360p and add the GIF helpers** — `apps/artist/src/core/exportTypes.ts`

In `getResolution`, change the map and its type (lines 476-480):

```ts
  const targetHeights: Partial<Record<'1080p' | '720p' | '480p' | '360p', number>> = {
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
  };
```

and amend the doc comment's sentence that enumerates the union:

```
 * `resolution` is exactly `'project' | '1080p' | '720p' | '480p' | '360p'` now
 * (ESCSUITE-34 added the last of those, which only the GIF format offers — see
 * `resolutionForFormat`), so a preset name outside that list can only reach this
 * function by bypassing the type system — there is no longer a typed caller (the
 * export dialog, the three exporters, or a validated headless job spec) that can
 * construct one. That used to fall back silently to `originalHeight`, which
 * produced a plausible-looking but meaningless size; it now throws instead
 * (review round 1, ESCSUITE-111).
```

Then append, after `getResolution`:

```ts
// ---------------------------------------------------------------------------
// GIF (ESCSUITE-34)
// ---------------------------------------------------------------------------

/**
 * The frame rates the GIF export offers. Low by design: a GIF carries one
 * 256-colour palette and one LZW-compressed bitmap per frame, so its size is
 * roughly linear in the frame count, and the format stores each frame's delay
 * in **centiseconds** — 20 fps (50 ms) and 10 fps (100 ms) are exact, while
 * 15 fps (67 ms) rounds to 7 cs and really plays at about 14.3 fps.
 */
export const GIF_FPS_OPTIONS = [10, 15, 20] as const;

export type GifFps = (typeof GIF_FPS_OPTIONS)[number];

export const DEFAULT_GIF_FPS: GifFps = 15;

/**
 * The frame rate an export will actually use, from whatever `options.fps`
 * carried. Anything that is not one of the three offered rates — `undefined`
 * from every caller that predates GIF export, a stale saved setting, a
 * hand-built headless job spec — lands on the default rather than being
 * encoded at.
 */
export function gifFrameRate(fps: number | undefined): GifFps {
  return fps !== undefined && (GIF_FPS_OPTIONS as readonly number[]).includes(fps)
    ? (fps as GifFps)
    : DEFAULT_GIF_FPS;
}

/**
 * The resolution presets GIF offers, and only GIF. A GIF at 1080p is enormous
 * and a GIF at the project's own resolution is unpredictable, so the list is
 * three fixed heights with the project's aspect — `getResolution` does the
 * actual arithmetic, the same way it does for the video formats.
 */
export const GIF_RESOLUTIONS = ['720p', '480p', '360p'] as const;

export const DEFAULT_GIF_RESOLUTION: ExportOptions['resolution'] = '480p';

/**
 * The resolution preset a format can actually be exported at, given the one
 * currently selected.
 *
 * `'360p'` is on the shared `ExportOptions['resolution']` union — one union, one
 * `getResolution`, one headless `RESOLUTIONS` list — and this is the function
 * that keeps it GIF-only. Both directions matter: switching **to** GIF from
 * `'project'` or `'1080p'` lands on 480p (GIF offers neither), and switching
 * **away** from GIF while 360p is selected lands on 480p too (no video preset is
 * 360p). Pure, so the dialog's radios and a headless validator read the same
 * rule.
 */
export function resolutionForFormat(
  format: ExportOptions['format'],
  resolution: ExportOptions['resolution']
): ExportOptions['resolution'] {
  if (format === 'gif') {
    return (GIF_RESOLUTIONS as readonly string[]).includes(resolution)
      ? resolution
      : DEFAULT_GIF_RESOLUTION;
  }
  return resolution === '360p' ? '480p' : resolution;
}

/** Past this many seconds of output, the dialog warns (but never refuses). */
export const GIF_LONG_RANGE_SECONDS = 30;

/**
 * Shown beside the GIF controls when the export would be longer than
 * {@link GIF_LONG_RANGE_SECONDS}. A warning, not a gate: a long GIF is a
 * legitimate thing to want, it is just usually not what someone meant.
 */
export const GIF_LONG_RANGE_WARNING =
  'GIFs above 30 seconds get large; consider WebM.';

/**
 * Shown alongside {@link EXPORT_NO_WEBCODECS_REASON}, because "this browser
 * cannot export" stopped being true when GIF landed: `gifenc` is pure
 * JavaScript, so the one format that needs no WebCodecs at all is still there.
 */
export const GIF_ALWAYS_AVAILABLE_NOTE =
  'GIF export needs no WebCodecs — choose GIF under Advanced options to export anyway.';

/**
 * Whether GIF export is possible. It always is.
 *
 * A function rather than a `true` constant so the export dialog reads all three
 * formats' support the same way, and so a future reason to refuse (a missing
 * `getImageData`, say) has one place to live. This is the asymmetry
 * `apps/artist/CLAUDE.md`'s "Export Dialog Browser Support" section describes:
 * MP4's support is a synchronous globals check, WebM's is a real asynchronous
 * codec probe, and GIF's is a constant.
 */
export function isGIFExportSupported(): boolean {
  return true;
}
```

- [ ] **Step 5: Run the helper tests green**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportTypes.test.ts`
Expected: PASS. If the `getResolution('360p', 1125, 1000)` case disagrees, compute the real answer (`Math.round(360 * 1125 / 1000)` = 405, odd, so 406) and fix the test's arithmetic rather than the implementation.

- [ ] **Step 6: Commit the types and helpers**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/src/store/types.ts apps/artist/src/core/exportTypes.ts \
        apps/artist/src/core/exportTypes.test.ts
git commit -m "$(cat <<'MSG'
feat(artist): a third export format, 360p, and a frame rate in ExportOptions (ESCSUITE-34)

`format` widens to 'webm' | 'mp4' | 'gif', `resolution` gains '360p', and
`ExportOptions` gains an optional `fps`. `ExportProgress` gains an optional
`estimatedBytes`, which is how a GIF export's live size estimate reaches the
dialog without a second callback — the two video exporters never set it, so
nothing about their progress reports changes.

'360p' is on the shared resolution union rather than a GIF-only one, and
`resolutionForFormat(format, resolution)` is what keeps it GIF-only. A second
union would mean a second `getResolution`, a second headless RESOLUTIONS list
and two places for the rule to live; one pure function that both the dialog's
radios and a headless validator read is smaller. It answers both directions:
switching to GIF from 'project' or '1080p' lands on 480p, because GIF offers
exactly 720p/480p/360p, and switching away from GIF while 360p is selected
lands on 480p too, because no video preset is 360p.

`fps` is read through `gifFrameRate()` and never directly, so `undefined` from
every caller that predates this ticket, a stale saved setting and a hand-built
headless job spec all land on 15 rather than encoding at whatever they carried.
The three rates are 10/15/20 for a format whose size is roughly linear in the
frame count — and because a GIF stores each frame's delay in centiseconds, 10
and 20 fps are exact while 15 fps (67 ms -> 7 cs) really plays at about
14.3 fps. That is written down beside the constant rather than left to be found.

`isGIFExportSupported()` returns true, as a function rather than a constant so
the dialog reads all three formats' support the same way. It is the third point
of an asymmetry the app's CLAUDE.md already documents: MP4's support is a
synchronous globals check, WebM's is a real asynchronous codec probe, and GIF's
is a constant, because `gifenc` is pure JavaScript and needs nothing from the
browser that a canvas has not already provided.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

- [ ] **Step 7: Write the failing exporter test** — create `apps/artist/src/core/exportGIF.test.ts`

```ts
// The GIF export pipeline (ESCSUITE-34).
//
// It shares `core/elementFrames.ts` with the WebM exporter — the media
// elements, the per-frame seek, the one track-ordered draw pass — and swaps the
// encoder: per frame one `getImageData` and one `addFrame`. So what this file
// covers is the frame loop's own arithmetic (how many frames, at what delay,
// over what range), the abort, the failure wrapping, the live size estimate, and
// the one thing that makes GIF different from both video formats: it works with
// no WebCodecs at all.
//
// Real storage, real canvas renderer, real animation engine, real
// `elementFrames`; doubles for the media elements, the 2D context and the
// encoder. `./gifEncoder` is mocked rather than run, because the canvas double's
// `getImageData` answers a 1x1 frame whatever it is asked for — the real encoder
// is exercised by `gifEncoder.test.ts`, which is the only place it needs to be.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToGIF, estimateGifBytes } from './exportGIF'
import { ExportAbortedError, ExportError } from './exportTypes'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { removeWebCodecsGlobals } from '../test/doubles/webcodecs'
import {
  makeClip,
  makeExportOptions,
  makeSourceVideo,
  makeTrack,
} from '../test/fixtures/clipFixtures'
import type { Clip, ExportOptions, ExportProgress, SourceVideo, Track } from '../store/types'

/** One recorded frame handed to the encoder. */
interface GifFrameRecord {
  width: number
  height: number
  delayMs: number
  rgbaLength: number
}

const { gifWriters, createGifWriter, BYTES_PER_FRAME } = vi.hoisted(() => {
  /** Bytes the double pretends each frame costs, so the size estimate is arithmetic a test can predict. */
  const BYTES_PER_FRAME = 100
  interface WriterRecord {
    frames: { width: number; height: number; delayMs: number; rgbaLength: number }[]
    finishes: number
    failOnFrame: number | null
  }
  const gifWriters: WriterRecord[] = []
  const createGifWriter = vi.fn(() => {
    const record: WriterRecord = { frames: [], finishes: 0, failOnFrame: null }
    gifWriters.push(record)
    return {
      addFrame(rgba: Uint8ClampedArray, width: number, height: number, delayMs: number) {
        if (record.failOnFrame === record.frames.length) {
          throw new Error('encoder exploded')
        }
        record.frames.push({ width, height, delayMs, rgbaLength: rgba.length })
      },
      bytesWritten: () => record.frames.length * BYTES_PER_FRAME,
      finish: () => {
        record.finishes += 1
        return new Uint8Array(record.frames.length * BYTES_PER_FRAME)
      },
    }
  })
  return { gifWriters, createGifWriter, BYTES_PER_FRAME }
})

vi.mock('./gifEncoder', () => ({ createGifWriter, GIF_MAX_COLORS: 256 }))

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

const mixAudio = vi.mocked(extractAndMixAudio)

/** The writer the export under test used. */
const writer = () => gifWriters[gifWriters.length - 1]
const frames = (): GifFrameRecord[] => writer().frames

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

interface RunOptions {
  clips?: Clip[]
  sources?: SourceVideo[]
  options?: Partial<ExportOptions>
  tracks?: Track[]
  signal?: AbortSignal
  projectResolution?: { width: number; height: number }
  onProgress?: (p: ExportProgress) => void
}

/** One second of timeline by default — 15 frames at the default 15 fps. */
const CLIP_DURATION = 1

function run({
  clips = [makeClip({ duration: CLIP_DURATION, endTime: CLIP_DURATION })],
  sources = [makeSourceVideo({ width: 640, height: 360 })],
  options = {},
  tracks = [makeTrack()],
  signal,
  projectResolution = { width: 640, height: 360 },
  onProgress = vi.fn(),
}: RunOptions = {}): Promise<Blob> {
  return exportToGIF(
    clips,
    sources,
    makeExportOptions({ format: 'gif', resolution: 'project', ...options }),
    onProgress,
    tracks,
    signal,
    projectResolution
  )
}

const ctx = () => getLastCanvasContext() as RecordingCanvasRenderingContext2D

beforeEach(async () => {
  gifWriters.length = 0
  createGifWriter.mockClear()
  mixAudio.mockClear()
  installCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeVideo('video1', new Blob([new Uint8Array(8)], { type: 'video/webm' }), makeSourceVideo())
})

afterEach(() => {
  media.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
  errors.mockRestore()
})

describe('exportToGIF preconditions', () => {
  it('refuses to export an empty timeline', async () => {
    await expect(run({ clips: [] })).rejects.toThrow('No clips to export')
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('throws ExportAbortedError for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(ExportAbortedError)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('rejects a 0x0 resolved resolution before any encoder is built', async () => {
    // The twin of exportWebM.ts's and exportMP4.ts's own door guard
    // (ESCSUITE-152): a hand-built projectResolution bypasses `parseProject`,
    // and this is clearer than whatever the canvas would do with it.
    const error = await run({ projectResolution: { width: 0, height: 0 } }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toMatch(/resolution/i)
    expect(createGifWriter).not.toHaveBeenCalled()
  })

  it('exports with no WebCodecs in the browser at all', async () => {
    // The whole reason the format exists: `gifenc` is pure JavaScript, so this
    // is the one export that works where neither VP9/VP8 nor H.264 can be
    // configured. The two video exporters both refuse outright here.
    const restore = removeWebCodecsGlobals()

    const blob = await run()

    expect(blob.type).toBe('image/gif')
    expect(frames()).toHaveLength(15)

    restore()
  })

  it('never extracts audio: a GIF has none', async () => {
    await run()

    // Not "extracts it and throws it away" — mixing the whole timeline's audio
    // is the most expensive no-op in the pipeline.
    expect(mixAudio).not.toHaveBeenCalled()
  })
})

describe('exportToGIF frames', () => {
  it('produces an image/gif blob carrying the encoder’s bytes', async () => {
    const blob = await run()

    expect(blob.type).toBe('image/gif')
    expect(blob.size).toBe(15 * BYTES_PER_FRAME)
    expect(writer().finishes).toBe(1)
  })

  it('writes one frame per output frame at the default 15 fps', async () => {
    await run()

    // 1 second at 15 fps. 1000/15 = 66.67 ms, rounded to 67 — which the GIF
    // container then stores as 7 centiseconds (see gifEncoder.test.ts).
    expect(frames()).toHaveLength(15)
    expect(frames().map((f) => f.delayMs)).toEqual(Array(15).fill(67))
  })

  it.each([
    [10, 10, 100],
    [15, 15, 67],
    [20, 20, 50],
  ])('writes %s frames at %s fps with a %s ms delay', async (_count, fps, delayMs) => {
    await run({ options: { fps: fps as ExportOptions['fps'] } })

    expect(frames()).toHaveLength(fps)
    expect(frames()[0].delayMs).toBe(delayMs)
  })

  it('falls back to 15 fps for a rate it does not offer', async () => {
    await run({ options: { fps: 7 as unknown as ExportOptions['fps'] } })

    expect(frames()).toHaveLength(15)
  })

  it('writes each frame at the resolved output size', async () => {
    await run({
      clips: [makeClip({ duration: 0.2, endTime: 0.2 })],
      options: { resolution: '360p' },
      projectResolution: { width: 1280, height: 720 },
    })

    // 360p of a 16:9 project is 640x360, and the canvas is sized to it.
    expect(frames()[0]).toMatchObject({ width: 640, height: 360 })
    expect(ctx().canvas.width).toBe(640)
    expect(ctx().canvas.height).toBe(360)
  })

  it('reads the whole raster back once per frame', async () => {
    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    // 0.2 s at 15 fps is 3 frames. One getImageData each, over the full output
    // raster — `getImageData` ignores the current transform, so the frame handed
    // to the encoder is the output raster including any letterbox bar.
    expect(ctx().argsFor('getImageData')).toEqual([
      [0, 0, 640, 360],
      [0, 0, 640, 360],
      [0, 0, 640, 360],
    ])
  })

  it('honours timeRange, so Export Section works unchanged', async () => {
    await run({
      clips: [makeClip({ duration: 2, endTime: 2 })],
      options: { fps: 10, timeRange: { start: 0.5, end: 1 } },
    })

    // Half a second at 10 fps.
    expect(frames()).toHaveLength(5)
    // The first frame drew the clip at timeline time 0.5, which is the source's
    // own 0.5 — so the element was seeked there rather than to 0.
    expect(media.seeks).toContain(0.5)
  })

  it('clears each frame to black before compositing', async () => {
    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    const fills = ctx().argsFor('fillRect')
    expect(fills).toHaveLength(3)
    expect(fills[0]).toEqual([0, 0, 640, 360])
    expect(ctx().stateFor('fillRect')[0].fillStyle).toBe('#000000')
  })

  it('releases every media element when it finishes', async () => {
    vi.mocked(URL.revokeObjectURL).mockClear()

    await run({ clips: [makeClip({ duration: 0.2, endTime: 0.2 })] })

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('exportToGIF progress', () => {
  it('reports a live size estimate once frames have been written', async () => {
    const reports: ExportProgress[] = []

    await run({ clips: [makeClip({ duration: 1, endTime: 1 })], onProgress: (p) => reports.push(p) })

    const withEstimate = reports.filter((p) => p.estimatedBytes !== undefined)
    expect(withEstimate.length).toBeGreaterThan(0)
    // bytes so far / frames done x frames total. The double charges 100 bytes a
    // frame, so for 15 frames every estimate is 1500 exactly.
    expect(withEstimate.map((p) => p.estimatedBytes)).toEqual(
      withEstimate.map(() => 15 * BYTES_PER_FRAME)
    )
  })

  it('leaves the estimate off the reports made before the first frame', async () => {
    const reports: ExportProgress[] = []

    await run({ onProgress: (p) => reports.push(p) })

    // Dividing by zero frames would put Infinity or NaN on screen; the dialog
    // shows `estimateGifBytes`'s own heuristic until the loop has written one.
    expect(reports[0].estimatedBytes).toBeUndefined()
    expect(reports[0].phase).toBe('preparing')
  })

  it('finishes at phase complete and 100%', async () => {
    const reports: ExportProgress[] = []

    await run({ onProgress: (p) => reports.push(p) })

    expect(reports[reports.length - 1]).toMatchObject({ phase: 'complete', progress: 100 })
  })
})

describe('exportToGIF abort', () => {
  it('stops between frames, keeping the frames already written', async () => {
    const controller = new AbortController()
    // Progress is reported every 5 frames, so aborting from the first report
    // lands between frame 5 and frame 6.
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'encoding' && p.message.includes('5/10')) controller.abort()
    }

    await expect(
      run({ options: { fps: 10 }, signal: controller.signal, onProgress })
    ).rejects.toBeInstanceOf(ExportAbortedError)

    expect(frames()).toHaveLength(5)
    expect(writer().finishes).toBe(0)
  })

  it('releases the media elements on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(ExportAbortedError)

    // Aborted before any element was loaded, so nothing to revoke — the point of
    // the case is that the early abort does not leave a half-built export.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})

describe('exportToGIF failures', () => {
  it('wraps an encoder failure in ExportError with the log and the frame it reached', async () => {
    const promise = run({ options: { fps: 10 } })
    // The writer is created inside the export, so arm it as soon as it exists.
    await Promise.resolve()
    writer().failOnFrame = 2

    const error = await promise.catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('encoder exploded')
    expect((error as ExportError).frameIndex).toBe(2)
    expect((error as ExportError).totalFrames).toBe(10)
    expect((error as ExportError).exportLog.length).toBeGreaterThan(0)
  })

  it('releases the media elements when a frame fails', async () => {
    const promise = run({ options: { fps: 10 } })
    await Promise.resolve()
    writer().failOnFrame = 0
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(promise).rejects.toBeInstanceOf(ExportError)

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('estimateGifBytes', () => {
  it('is pixels x frames x 0.3 bytes, the up-front heuristic', async () => {
    // What the dialog shows before a single frame exists. Deliberately crude:
    // a GIF's real size depends on how much of each frame actually changes.
    expect(estimateGifBytes(640, 360, 15)).toBe(Math.round(640 * 360 * 15 * 0.3))
  })

  it('is zero for an export with no frames', () => {
    expect(estimateGifBytes(640, 360, 0)).toBe(0)
  })
})
```

> **Note for the implementer:** two things here are worth checking against the real doubles before assuming the test is wrong.
> - `media.seeks` holds the values assigned to `video.currentTime`; `toContain(0.5)` tolerates floating-point exactness because `rangeStart + 0 / fps` is exactly `0.5`. If a later frame's time is not exact, use `expect(media.seeks.some((s) => Math.abs(s - 0.5) < 1e-9)).toBe(true)`.
> - The two failure cases arm `failOnFrame` after one microtask. If the export has not yet created its writer by then (it loads media first, which awaits storage), move the arming into `createGifWriter`'s own implementation for those cases — e.g. a module-level `armFailure` the hoisted factory reads — rather than guessing at a number of microtasks. Record whichever shape you used in the report.

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportGIF.test.ts`
Expected: FAIL — `Failed to resolve import "./exportGIF" from "src/core/exportGIF.test.ts"`. Quote the exact text.

- [ ] **Step 9: Implement the exporter** — create `apps/artist/src/core/exportGIF.ts`

```ts
// GIF export (ESCSUITE-34).
//
// The third format, and the only one that needs nothing from WebCodecs: it
// shares `core/elementFrames.ts` with the WebM exporter — the media elements,
// the per-frame seek, the single track-ordered draw pass, the transitions — and
// swaps the encoder. Per frame: `openOutputFrame` and the draw pass (inside
// `composeFrame`), then one `ctx.getImageData` and one `writer.addFrame`, which
// is `quantize` -> `applyPalette` -> `writeFrame` behind `core/gifEncoder.ts`.
//
// Everything a GIF cannot carry is simply absent rather than extracted and
// discarded: there is no audio mixing, no muxer, no encoder queue and no
// backpressure wait. What is left is the frame loop, which is also what makes
// cancellation work — the abort is checked at the top of every frame, so the
// export stops within one frame of the click (ESCSUITE-98 run identity).
import type { Clip, SourceVideo, Track, ExportOptions } from '../store/types';
import type { MediaDrawOptions, ProgressCallback } from './exportTypes';
import { projectToOutputScale } from './outputTransform';
import {
  checkAborted,
  getResolution,
  getBaseDimensions,
  yieldToMain,
  calculateTimelineDuration,
  gifFrameRate,
  ExportError,
  type ExportLogEntry,
} from './exportTypes';
import {
  createFrameComposer,
  loadElementSources,
  releaseElementSources,
  rewindElementSources,
} from './elementFrames';
import { createGifWriter } from './gifEncoder';

/**
 * Bytes per pixel per frame, for the estimate shown **before** an export starts.
 *
 * Deliberately crude: a GIF's real size depends on how much of each frame
 * actually changes, which nothing can know in advance. It is a figure to decide
 * "is this going to be enormous" by, and it is replaced by a real one
 * (bytes-so-far / frames-done x frames-total) as soon as the first frame has
 * been written.
 */
const GIF_BYTES_PER_PIXEL_FRAME = 0.3;

/** Projected GIF size before a single frame has been encoded. */
export function estimateGifBytes(width: number, height: number, frames: number): number {
  return Math.round(width * height * frames * GIF_BYTES_PER_PIXEL_FRAME);
}

/**
 * Export the timeline — or `options.timeRange` of it, which is how "Export
 * Section" works for GIF exactly as it does for the other two — as an animated
 * GIF.
 *
 * The argument list is `exportToWebM`'s and `exportToMP4`'s, in the same order,
 * so the export dialog and the headless renderer each gained one branch rather
 * than a third calling convention.
 */
export async function exportToGIF(
  clips: Clip[],
  sourceVideos: SourceVideo[],
  options: ExportOptions,
  onProgress: ProgressCallback,
  tracks?: Track[],
  signal?: AbortSignal,
  projectResolution?: { width: number; height: number }
): Promise<Blob> {
  // No capability check: there is nothing to check. `gifenc` is pure
  // JavaScript and a 2D canvas is all this pipeline needs, which is why
  // `isGIFExportSupported()` is a constant and why this export is still
  // offered in a browser where both video formats are refused.

  if (clips.length === 0) {
    throw new Error('No clips to export');
  }

  // Check for early abort
  checkAborted(signal);

  // The same diagnostic trail both other exporters keep, so a failure from any
  // of the three carries the same kind of log.
  const exportLog: ExportLogEntry[] = [];
  const log = (phase: string, detail: string) => {
    exportLog.push({ phase, detail, timestamp: performance.now() });
  };

  log('init', `Starting GIF export with ${clips.length} clips`);

  const exportTracks = tracks || [{ id: 'default', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 }];

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing export...' });

  const sourceMap = new Map(sourceVideos.map((v) => [v.id, v]));
  const { width: baseWidth, height: baseHeight } = getBaseDimensions(clips, exportTracks, sourceVideos);
  const { width, height } = getResolution(options.resolution, baseWidth, baseHeight, projectResolution);

  // The same door guard the other two exporters keep (ESCSUITE-152): a
  // hand-built `projectResolution` can still bypass `parseProject`, and this is
  // clearer than whatever the canvas or the quantiser would say about it.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new ExportError(
      `Cannot export at ${width}x${height}: resolved output resolution must be at least 2x2`,
      exportLog
    );
  }

  const frameRate = gifFrameRate(options.fps);
  // The GIF container stores a frame's on-screen time in centiseconds, so this
  // is rounded again on the way into the file: 100 ms and 50 ms are exact,
  // 67 ms becomes 7 cs (see `core/gifEncoder.ts`).
  const delayMs = Math.round(1000 / frameRate);

  // The space every draw call is in, as against the raster they land on — the
  // same reasoning as `exportWebM.ts`'s.
  const projectSize = projectResolution && projectResolution.width > 0 && projectResolution.height > 0
    ? { width: projectResolution.width, height: projectResolution.height }
    : { width: baseWidth, height: baseHeight };
  const outputSize = { width, height };
  const drawOptions: MediaDrawOptions = {
    filterScale: projectToOutputScale(projectSize, outputSize),
  };

  const fullDuration = calculateTimelineDuration(clips);
  const rangeStart = options.timeRange?.start ?? 0;
  const rangeEnd = options.timeRange?.end ?? fullDuration;
  const totalDuration = rangeEnd - rangeStart;
  const totalFrames = Math.ceil(totalDuration * frameRate);

  // One canvas for the whole export. `willReadFrequently` because every frame
  // reads the whole raster back: without the hint a browser keeps the backing
  // store on the GPU and each `getImageData` is a readback stall. `alpha: false`
  // matches the other two exporters — v1 writes no transparency.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;

  onProgress({ phase: 'preparing', progress: 12, message: 'Loading media files...' });

  const sources = await loadElementSources(clips, sourceMap);

  const playbackState = rewindElementSources(sources);

  const composeFrame = createFrameComposer({
    ctx,
    canvas,
    clips,
    tracks: exportTracks,
    sources,
    playbackState,
    projectSize,
    outputSize,
    drawOptions,
    frameRate,
  });

  onProgress({ phase: 'encoding', progress: 15, message: 'Encoding frames...' });
  log('frames', `Starting frame loop: ${totalFrames} total frames at ${frameRate}fps`);

  const writer = createGifWriter();
  let frameCount = 0;

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // The one place cancellation happens. There is no encoder queue to drain
      // and no muxer to finalize, so "between frames" is the whole of this
      // export's cancellation surface — and one frame is the longest a Cancel
      // click ever waits.
      checkAborted(signal);

      const currentTime = rangeStart + frameIndex / frameRate;

      await composeFrame(currentTime);

      // `getImageData` reads device pixels and ignores the current
      // transformation matrix, so this is the full output raster — including
      // any letterbox bar `openOutputFrame` painted — which is exactly what the
      // encoder should see. Nothing is saved, restored or re-transformed around
      // it, which is why the ceiling file can assert one `setTransform` a frame.
      const { data } = ctx.getImageData(0, 0, width, height);
      writer.addFrame(data, width, height, delayMs);

      frameCount++;

      if (frameCount % 5 === 0 || frameCount === totalFrames) {
        const progress = 18 + (frameCount / totalFrames) * 70;
        onProgress({
          phase: 'encoding',
          progress: Math.min(progress, 88),
          message: `Encoding frame ${frameCount}/${totalFrames}...`,
          // Bytes so far / frames done x frames total. Only ever reported from
          // inside the loop, where `frameCount` is at least one: dividing by
          // zero would put Infinity on screen.
          estimatedBytes: Math.round((writer.bytesWritten() / frameCount) * totalFrames),
        });

        // Yield to prevent UI blocking (MessageChannel, so a background tab
        // does not throttle it).
        await yieldToMain();
      }
    }

    log('frames', `Frame loop complete: ${frameCount} frames encoded`);

    onProgress({ phase: 'muxing', progress: 92, message: 'Finalizing GIF...' });

    const bytes = writer.finish();

    // A cancel that landed while we were finishing still counts: never hand
    // back an export the caller asked to stop.
    checkAborted(signal);

    releaseElementSources(sources);

    onProgress({ phase: 'complete', progress: 100, message: 'Export complete!' });

    return new Blob([bytes], { type: 'image/gif' });
  } catch (error) {
    releaseElementSources(sources);

    // Re-throw ExportAbortedError and ExportError as-is
    if (error instanceof ExportError || (error instanceof Error && error.name === 'ExportAbortedError')) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    log('error', `Export failed: ${message}`);
    throw new ExportError(message, exportLog, frameCount, totalFrames);
  }
}
```

- [ ] **Step 10: Export it from the barrel** — `apps/artist/src/core/exporter.ts`

```ts
// Public API - export functions
export { exportToWebM } from './exportWebM';
export { exportToMP4 } from './exportMP4';
export { exportToGIF, estimateGifBytes } from './exportGIF';

// Public API - capability checks
export {
  isMP4ExportSupported,
  isWebMExportSupported,
  isGIFExportSupported,
  EXPORT_NO_WEBCODECS_REASON,
  WEBM_NO_CODEC_REASON,
  GIF_ALWAYS_AVAILABLE_NOTE,
} from './exportTypes';
```

and add one line to the header comment's module list:

```
//   exportGIF.ts      - GIF export (gifenc, no WebCodecs)
//   elementFrames.ts  - the per-frame machinery exportWebM.ts and exportGIF.ts share
//   gifEncoder.ts     - the one importer of `gifenc`
```

- [ ] **Step 11: Run the exporter test green**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportGIF.test.ts`
Expected: PASS. If the abort case's `5/10` message never arrives, print the reports and match on whatever the message actually is — the point is to abort from inside the loop, not to match a particular string.

- [ ] **Step 12: Write the per-frame ceiling file** — create `apps/artist/src/core/exportGIF.perf.test.ts`

The third ceiling file, modelled on `exportWebM.perf.test.ts` — the same scene, the same splitter, the same heaviest second.

```ts
// Per-frame work ceilings for the GIF export pipeline.
//
// The third of the trio (`exportMP4.perf.test.ts` ESCSUITE-112's twin,
// `exportWebM.perf.test.ts`), over the same scene and split into frames by the
// same `openOutputFrame` marker. This pipeline shares `core/elementFrames.ts`
// with the WebM one, so its drawing cost is that file's cost; what is its own is
// the read-back and the encode: one `getImageData` over the whole raster per
// frame, and one `addFrame` — which is one `quantize`, one `applyPalette` and
// one `writeFrame` behind `core/gifEncoder.ts`.
//
// The scene's heaviest second (7-8 s) at the default 15 fps, which is 15 output
// frames. Ceilings are 2x the measured value rounded up, with the measurement
// and its date beside them. The conservation laws — one read-back per frame, one
// encoded frame per read-back, one `getContext` for the whole export, balanced
// save/restore, and **no `VideoFrame` at all** — are exact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToGIF } from './exportGIF'
import { storeVideo } from './storage'
import * as animation from '../utils/animation'
import {
  getContextCallCount,
  getLastCanvasContext,
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type CanvasCall,
  type OffscreenCanvasDouble,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { frameCounts, installWebCodecsDoubles, type WebCodecsDoubles } from '../test/doubles/webcodecs'
import {
  MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME,
  SCENE_RESOLUTION,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_ID,
  SCENE_SOURCE_WIDTH,
  SCENE_TRACKS,
  buildSceneClips,
  sceneSource,
} from '../test/fixtures/perfScene'
import { makeExportOptions } from '../test/fixtures/clipFixtures'
import type { ExportProgress } from '../store/types'

const { gifFrames, gifWriterCount, createGifWriter } = vi.hoisted(() => {
  const gifFrames: { width: number; height: number; rgbaLength: number }[] = []
  const gifWriterCount = { value: 0 }
  const createGifWriter = vi.fn(() => {
    gifWriterCount.value += 1
    return {
      addFrame(rgba: Uint8ClampedArray, width: number, height: number) {
        gifFrames.push({ width, height, rgbaLength: rgba.length })
      },
      bytesWritten: () => gifFrames.length * 64,
      finish: () => new Uint8Array(gifFrames.length * 64),
    }
  })
  return { gifFrames, gifWriterCount, createGifWriter }
})

// The encoder is counted, not run: `gifEncoder.test.ts` exercises the real one.
// What this file measures is how many times the pipeline asks for it.
vi.mock('./gifEncoder', () => ({ createGifWriter, GIF_MAX_COLORS: 256 }))

/** The scene's heaviest second, at the GIF export's default frame rate. */
const RANGE = { start: 7, end: 8 }
const FPS = 15
const FRAMES = 15
/** Media clips live over that second: the blurred V1 clip and the screen-blended V2 clip. */
const ACTIVE_MEDIA_CLIPS = MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME
/** Clips live over that second: the two media clips and the two overlays. */
const ACTIVE_CLIPS = 4

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  gifFrames.length = 0
  gifWriterCount.value = 0
  createGifWriter.mockClear()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({
    video: { videoWidth: SCENE_SOURCE_WIDTH, videoHeight: SCENE_SOURCE_HEIGHT, duration: 2 },
  })
  // Installed only so `frameCounts()` can prove this pipeline creates no
  // VideoFrame at all — it never constructs an encoder or a decoder.
  webcodecs = installWebCodecsDoubles()
  logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeVideo(
    SCENE_SOURCE_ID,
    new Blob([new Uint8Array(8)], { type: 'video/mp4' }),
    sceneSource
  )
})

afterEach(() => {
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  logs.mockRestore()
  warns.mockRestore()
  errors.mockRestore()
})

/**
 * Split the recorded calls into frames.
 *
 * Byte-for-byte the splitter `exportWebM.perf.test.ts` and
 * `exportMP4.perf.test.ts` use, and valid here for the same reason: every
 * export frame opens with `openOutputFrame` (`core/outputTransform.ts`) — the
 * project-to-output transform followed immediately by the full-raster black
 * fill — and nothing else makes those two calls back to back. Since ESCSUITE-34
 * that call is made by `core/elementFrames.ts` on all three pipelines' behalf.
 */
function splitFrames(calls: CanvasCall[]): CanvasCall[][] {
  const isFrameTransform = (args: unknown[]) =>
    args.length === 6 && args[1] === 0 && args[2] === 0 && args[4] === 0 && args[5] === 0
  const isClear = (call: CanvasCall | undefined) =>
    call?.method === 'fillRect' &&
    String(call.args) === String([0, 0, SCENE_RESOLUTION.width, SCENE_RESOLUTION.height])

  const frames: CanvasCall[][] = []
  for (const [index, call] of calls.entries()) {
    if (call.method === 'setTransform' && isFrameTransform(call.args) && isClear(calls[index + 1])) {
      frames.push([])
    }
    frames[frames.length - 1]?.push(call)
  }
  return frames
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

interface GifMeasurement {
  framesDrawn: number
  /** 2D-context method calls in the median frame. */
  callsPerFrame: number
  drawImagesPerFrame: number
  setTransformsPerFrame: number
  savesPerFrame: number
  restoresPerFrame: number
  getImageDataPerFrame: number
  animationLookupsPerFrame: number
  animationLookups: number
  /** getContext() calls for the whole export — the exporter makes one canvas. */
  getContexts: number
  seeks: number
  steadyStateSeeksPerFrame: number
  /** GIF writers constructed for the whole export. */
  writers: number
  /** Frames handed to the encoder. */
  framesEncoded: number
  /** WebCodecs VideoFrames created anywhere. This pipeline creates none. */
  videoFramesCreated: number
}

async function measureExport(): Promise<GifMeasurement> {
  const progress: ExportProgress[] = []
  const getAnimatedValues = vi.spyOn(animation, 'getAnimatedValues')
  const contextsBefore = getContextCallCount()
  const seeksBefore = media.seeks.length

  await exportToGIF(
    buildSceneClips(),
    [sceneSource],
    makeExportOptions({ format: 'gif', resolution: 'project', fps: FPS, timeRange: RANGE }),
    (p) => progress.push(p),
    SCENE_TRACKS,
    undefined,
    { ...SCENE_RESOLUTION }
  )

  const ctx = getLastCanvasContext()!
  const frames = splitFrames(ctx.calls)
  const lookups = getAnimatedValues.mock.calls.length
  const seeks = media.seeks.length - seeksBefore
  // One `video.currentTime = 0` per loaded element before the frame loop
  // starts (`rewindElementSources`) — never part of the per-frame cost.
  const initSeeks = media.videos.length

  const measurement: GifMeasurement = {
    framesDrawn: frames.length,
    callsPerFrame: median(frames.map((f) => f.length)),
    drawImagesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'drawImage').length)),
    setTransformsPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'setTransform').length)),
    savesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'save').length)),
    restoresPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'restore').length)),
    getImageDataPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'getImageData').length)),
    animationLookupsPerFrame: lookups / frames.length,
    animationLookups: lookups,
    getContexts: getContextCallCount() - contextsBefore,
    seeks,
    steadyStateSeeksPerFrame: (seeks - initSeeks) / frames.length,
    writers: gifWriterCount.value,
    framesEncoded: gifFrames.length,
    videoFramesCreated: frameCounts().created,
  }
  getAnimatedValues.mockRestore()
  return measurement
}

describe('GIF export per-frame work', () => {
  it('encodes 15 frames of the scene within its per-frame ceilings', async () => {
    const measured = await measureExport()

    expect(measured.framesDrawn).toBe(FRAMES)

    // MEASURE THIS, DO NOT GUESS IT. Run the file once, read the reported
    // numbers out of a failing assertion (or log them), then set each ceiling
    // to 2x the measured value rounded up and write the measured figure and
    // today's date into this comment. The derivation to expect:
    // `exportWebM.perf.test.ts` measured 25 calls per frame for this same scene
    // on 2026-09-27, and this pipeline makes the same drawing calls plus one
    // `getImageData` — so 26 calls per frame, ceiling 52. If the number is not
    // 26, something else changed and that is worth a sentence in the report.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(52)
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    expect(measured.animationLookupsPerFrame).toBeLessThanOrEqual(8)

    // **Exact, not a ceiling.** The transform is a property of the frame,
    // carried through the shared `openOutputFrame` helper, not of a clip — the
    // same reason it is exact in both twins. (It is 1 for *this* scene rather
    // than for any scene: a shape overlay that blurs its background resets the
    // transform itself, so a scene carrying one would legitimately measure 2.
    // The benchmark scene's shape does not blur.)
    expect(measured.setTransformsPerFrame).toBe(1)
    // Exact: an export that leaked a save() would drift the whole file.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact: one canvas for the whole export, not one per frame.
    expect(measured.getContexts).toBe(1)
    // Exact, and this pipeline's own law: one full-raster read-back per frame.
    // Two would double the most expensive thing a GIF export does.
    expect(measured.getImageDataPerFrame).toBe(1)
    // Exact: the two active media clips share one `<video>` element, so each
    // frame reassigns its position once per clip, plus the one rewind before
    // the loop.
    expect(measured.steadyStateSeeksPerFrame).toBe(ACTIVE_MEDIA_CLIPS)
    expect(measured.seeks).toBe(1 + FRAMES * ACTIVE_MEDIA_CLIPS)
  })

  it('encodes exactly one frame per drawn frame, through one writer', async () => {
    const measured = await measureExport()

    // Conservation: one `addFrame` per frame drawn — which is one `quantize`,
    // one `applyPalette` and one `writeFrame` behind `core/gifEncoder.ts`, so a
    // double-quantised frame cannot hide here.
    expect(measured.framesEncoded).toBe(FRAMES)
    // One encoder for the whole export: a writer per frame would write a GIF
    // header per frame.
    expect(measured.writers).toBe(1)
  })

  it('creates no VideoFrame at all', async () => {
    const measured = await measureExport()

    // The law that separates this pipeline from the other two. GIF export
    // constructs no `VideoEncoder`, no `VideoDecoder` and no `VideoFrame` — it
    // is why the format works in a browser with no WebCodecs, and a regression
    // that reintroduced one would quietly break exactly that browser.
    expect(measured.videoFramesCreated).toBe(0)
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  it('computes every live clip’s animated values exactly once per frame', async () => {
    const measured = await measureExport()

    // Exact, and a conservation law rather than a budget, for the same reason as
    // both twins: an export draws each clip time exactly once, so the lookup
    // count is frames x active clips and nothing else. 4 active clips over this
    // second of the scene (the full-frame V1 clip, the picture-in-picture V2
    // clip, and the text and shape overlays).
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
  })
})
```

- [ ] **Step 13: Measure, then set the ceilings**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/core/exportGIF.perf.test.ts`

If a ceiling fails, read the real number out of the failure, set the ceiling to **2× it rounded up**, and replace the "MEASURE THIS" paragraph with the measurement and today's date — e.g. *"Measured 2026-10-01: 26 calls, 2 drawImage, 4 animation lookups, 1 getImageData, 2 seeks per frame. Ceilings are 2x, rounded up."* Do **not** relax an exact assertion to make it pass: `setTransformsPerFrame`, `getImageDataPerFrame`, `getContexts`, `framesEncoded`, `writers`, `videoFramesCreated` and the two animation-lookup counts are laws. If one of those fails, the implementation is wrong.

Expected after the edit: PASS, 4 tests.

- [ ] **Step 14: Verify the package**

```bash
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
pnpm --filter @escapesuite/artist exec vitest run
git -C /Users/littlemac/Projects/ESCAPESUITE-e34 diff --stat -- \
  apps/artist/src/core/exportWebM.perf.test.ts apps/artist/src/core/exportMP4.perf.test.ts
```

The last command must print nothing.

- [ ] **Step 15: Commit the exporter**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/src/core/exportGIF.ts apps/artist/src/core/exportGIF.test.ts \
        apps/artist/src/core/exportGIF.perf.test.ts apps/artist/src/core/exporter.ts
git commit -m "$(cat <<'MSG'
feat(artist): export an animated GIF (ESCSUITE-34)

`exportToGIF` takes the same seven arguments in the same order as the other two
exporters, shares `core/elementFrames.ts` with the WebM one — the media
elements, the per-frame seek, the single track-ordered draw pass, the
transitions — and swaps the encoder: per frame, one `ctx.getImageData` over the
whole output raster and one `addFrame`, which is quantise, apply-palette and
write-frame behind `core/gifEncoder.ts`.

Everything a GIF cannot carry is absent rather than computed and discarded.
There is no audio mixing (not even a call whose result is dropped — mixing the
whole timeline to throw it away is the most expensive no-op in the pipeline, and
a test asserts the mixer is never called), no muxer, no encoder queue and no
backpressure wait. What is left is a frame loop, which is also what makes
cancellation work: the abort is checked at the top of every frame, so Cancel
stops the export within one frame, and a frame that fails wraps in `ExportError`
with the diagnostic log and the frame it reached, exactly as the other two do.

And it needs no WebCodecs. `gifenc` is pure JavaScript and a 2D canvas is the
only browser capability involved, so there is no capability check at the door at
all — which is the point: a browser that can configure neither VP9/VP8 nor
H.264 can still export this. There is a test that removes the WebCodecs globals
entirely and exports fifteen frames anyway.

Two details worth naming. The context is `{ alpha: false, willReadFrequently:
true }`, because every frame reads the entire raster back and without the hint
the backing store stays on the GPU and each read is a stall. And
`getImageData` is called under the output transform deliberately: it reads
device pixels and ignores the matrix, so the frame the encoder sees is the whole
output raster including any letterbox bar — nothing is saved, restored or
re-transformed around it, which is why the ceiling file can still assert one
`setTransform` per frame.

The progress reports carry `estimatedBytes` — bytes written so far divided by
frames done, times frames total — but only from inside the loop, where the
divisor is at least one. Before the first frame the dialog shows
`estimateGifBytes`'s cruder pixels x frames x 0.3, which is exported from here
rather than inlined in the component so the two estimates live together.

`exportGIF.perf.test.ts` is the third ceiling file, over the same scene and the
same `openOutputFrame` frame splitter as its two twins, at the default 15 fps.
Its own laws: one full-raster read-back per frame, one encoded frame per
read-back, one writer for the whole export, and no `VideoFrame` created
anywhere — that last one is what would quietly break the no-WebCodecs browser
if it ever moved. Both existing ceiling files are byte-identical and green.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

### Task 4: the export dialog — GIF radio, fps, GIF presets, the estimate and the 30-second warning

**Files:**
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx`
- Modify: `apps/artist/src/components/Export/ExportDialog.test.tsx` (one new `describe('GIF export')` block, appended; two existing cases amended where the plan says so)
- Modify: `apps/artist/src/utils/analytics.ts` (lines 16-19)

**Interfaces:**

- Consumes from `../../core/exporter`: `exportToGIF`, `estimateGifBytes`, `isGIFExportSupported`, `GIF_ALWAYS_AVAILABLE_NOTE` (all added by Task 3). From `../../core/exportTypes`: `getResolution` (already), plus `GIF_FPS_OPTIONS`, `DEFAULT_GIF_FPS`, `gifFrameRate`, `GIF_RESOLUTIONS`, `resolutionForFormat`, `GIF_LONG_RANGE_SECONDS`, `GIF_LONG_RANGE_WARNING`. From `../../utils/timeUtils`: `formatTime` (already) and `formatFileSize`.
- Produces: no new exported symbol. `LastExportSettings` gains `fps`.

**Eight decisions this task pins, all argued in the commit message:**

- **GIF lives under Advanced options, beside MP4.** The primary button stays "Download WebM" / "Export Section". WebM is the default for the same reason it always was; GIF is a deliberate choice, like MP4, and the spec asks for a radio beside the other two rather than a fourth primary button.
- **The GIF radio's accessible name contains neither "WebM" nor "MP4".** `ExportDialog.test.tsx` finds the other two radios by exactly those words in a dozen places. `GIF (256 colours, no audio)` with the hint `No WebCodecs needed` keeps every one of those queries unambiguous. This is a constraint on the copy, and it is why the hint does not read "unlike WebM and MP4".
- **The resolution `<select>`'s option list is per format, and switching format moves the selection.** GIF offers exactly `720p / 480p / 360p`; the video formats offer exactly `project / 1080p / 720p / 480p`. Every format radio's `onChange` runs the selection through `resolutionForFormat`, so a `1080p` selection becomes `480p` on the way into GIF and a `360p` selection becomes `480p` on the way out — the user never sees a `<select>` whose value is not in its own list.
- **GIF is always supported, so it is the one format the no-WebCodecs state leaves enabled.** `neitherFormatSupported` becomes `noVideoFormatSupported` (its old name stopped being true), and the alert it gates now carries a second sentence, `GIF_ALWAYS_AVAILABLE_NOTE`, saying what still works. The primary buttons stay disabled, because they are WebM's.
- **`effectiveAdvancedFormat` widens to three, and GIF is never blocked.** The Advanced button must gate on the format the click will actually run (ESCSUITE-22 review round 1, MAJOR 1). GIF bypasses the MP4-availability fallback entirely — it is always available — so `advancedBlockedReason` is null whenever GIF is chosen.
- **Two estimates, two moments.** Before the export: `estimateGifBytes(outputWidth, outputHeight, frames)`, from the chosen preset, fps and range. During it: `progress.estimatedBytes`, which the exporter computes from bytes actually written. Both are rendered through the existing `formatFileSize`, so one formatter covers both and the media library's "12.4 MB" and the export dialog's agree.
- **The 30-second warning is shown and never enforced.** It compares the export's own length — the in/out range when there is one, the timeline otherwise — against `GIF_LONG_RANGE_SECONDS`, and renders a `role="status"` line. No button is disabled by it.
- **The background-tab note is hidden when GIF is selected**, because it is about the two video formats' decoders and GIF has none. GIF gets its own one-line note instead, naming the two things a user is actually surprised by: it needs the tab visible, and it has no sound.

- [ ] **Step 1: Write the failing dialog tests** — append a new block to `apps/artist/src/components/Export/ExportDialog.test.tsx`

First, extend the file's module mock and helpers. In the `vi.hoisted` block at line 14, add `mockExportToGIF: vi.fn()`; in the `vi.mock('../../core/exporter', …)` factory at line 21, add `exportToGIF: mockExportToGIF`; in `beforeEach` (around line 117) add `mockExportToGIF.mockReset()` and `mockExportToGIF.mockResolvedValue(new Blob([new Uint8Array(1234)], { type: 'image/gif' }))`. Then add these helpers beside `advancedExport()`:

```ts
const gifArgs = () => mockExportToGIF.mock.calls[0] as unknown as ExportArgs
const gifRadio = () => screen.getByRole('radio', { name: /gif/i })
const fpsSelect = () => screen.getByLabelText(/frames per second/i)
/** Open Advanced options and choose GIF. */
const chooseGif = () => {
  fireEvent.click(advancedToggle())
  fireEvent.click(gifRadio())
}
```

`ExportArgs`' third element needs `fps?: number` added to its inline type (line 59).

Then append:

```ts
  describe('GIF export', () => {
    it('offers GIF as a third format under Advanced options', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(gifRadio()).toBeEnabled()
      expect(screen.getByText('GIF (256 colours, no audio)')).toBeInTheDocument()
      // The other two radios must still be findable by name — the GIF label and
      // hint deliberately contain neither "WebM" nor "MP4".
      expect(screen.getByRole('radio', { name: /webm/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeInTheDocument()
    })

    it('keeps the frame-rate control hidden until GIF is chosen', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(screen.queryByLabelText(/frames per second/i)).not.toBeInTheDocument()

      fireEvent.click(gifRadio())

      expect(fpsSelect()).toHaveValue('15')
      expect(screen.getByText('10 fps (smallest file)')).toBeInTheDocument()
      expect(screen.getByText('15 fps')).toBeInTheDocument()
      expect(screen.getByText('20 fps (smoothest)')).toBeInTheDocument()
    })

    it('offers only 720p, 480p and 360p for GIF, defaulting to 480p', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      // The project is 1920x1080 (the store's default), so the three widths
      // follow its 16:9 aspect — the same `getResolution` rule every format uses.
      expect(screen.getByText('720p — 1280×720')).toBeInTheDocument()
      expect(screen.getByText('480p — 854×480')).toBeInTheDocument()
      expect(screen.getByText('360p — 640×360')).toBeInTheDocument()
      expect(screen.queryByText(/^Project —/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^1080p —/)).not.toBeInTheDocument()
      // A GIF at the project's own resolution is unpredictable and one at 1080p
      // is enormous, so neither is offered — and choosing GIF while 1080p was
      // selected lands on the spec's default rather than leaving the select on a
      // value it no longer lists.
      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
    })

    it('moves a 1080p selection to 480p on the way into GIF', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.change(screen.getByDisplayValue(/^Project —/), { target: { value: '1080p' } })
      fireEvent.click(gifRadio())

      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
    })

    it('moves a 360p selection to 480p on the way back to WebM', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(screen.getByDisplayValue('480p — 854×480'), { target: { value: '360p' } })
      expect(screen.getByDisplayValue('360p — 640×360')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('radio', { name: /webm/i }))

      // 360p is GIF-only; no video preset is 360p, so the selection has to move.
      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
      expect(screen.queryByText('360p — 640×360')).not.toBeInTheDocument()
    })

    it('runs exportToGIF with the chosen fps, preset and range', async () => {
      store().setInPoint(1)
      store().setOutPoint(3)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(fpsSelect(), { target: { value: '20' } })
      fireEvent.click(advancedExport())
      await settle()

      expect(mockExportToGIF).toHaveBeenCalledTimes(1)
      expect(mockExportToWebM).not.toHaveBeenCalled()
      expect(mockExportToMP4).not.toHaveBeenCalled()
      expect(gifArgs()[2]).toMatchObject({
        format: 'gif',
        resolution: '480p',
        fps: 20,
        timeRange: { start: 1, end: 3 },
      })
    })

    it('downloads the GIF as <project name>.gif and tells the host so', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      expect(clickedLinks[0].download).toBe('Test Project.gif')
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EXPORT_COMPLETE',
          payload: expect.objectContaining({ format: 'gif', name: 'Test Project.gif' }),
        })
      )
      expect(mockAnalytics.exportStarted).toHaveBeenCalledWith('gif')
      expect(mockAnalytics.exportCompleted).toHaveBeenCalledWith('gif', expect.any(Number))
    })

    it('labels the Advanced button for GIF', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByRole('button', { name: /download gif/i })).toBeEnabled()
    })

    it('estimates the size before the export starts', () => {
      // 5 seconds of clip (the suite's own fixture), 480p of a 16:9 project is
      // 854x480, 15 fps -> 75 frames, at the pixels x frames x 0.3 heuristic.
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByText(/Estimated size/)).toBeInTheDocument()
      expect(screen.getByText(/75 frames/)).toBeInTheDocument()
    })

    it('re-estimates when the frame rate changes', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      const before = screen.getByText(/Estimated size/).textContent

      fireEvent.change(fpsSelect(), { target: { value: '10' } })

      expect(screen.getByText(/50 frames/)).toBeInTheDocument()
      expect(screen.getByText(/Estimated size/).textContent).not.toBe(before)
    })

    it('shows the live estimate the exporter reports while it runs', async () => {
      let report: ((p: ExportProgress) => void) | undefined
      mockExportToGIF.mockImplementation((...args: unknown[]) => {
        report = args[3] as (p: ExportProgress) => void
        return new Promise(() => {}) // never settles: the dialog stays on the progress view
      })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      act(() => {
        report!({ phase: 'encoding', progress: 40, message: 'Encoding frame 30/75...', estimatedBytes: 2_621_440 })
      })

      // Rendered through the same formatFileSize the media library uses, so one
      // formatter covers the whole app.
      expect(screen.getByText(/2\.5 MB/)).toBeInTheDocument()
    })

    it('warns past 30 seconds without refusing the export', () => {
      resetStoreForTest()
      store().setProject({ ...store().project, name: 'Test Project' })
      addClip('long', 0, 45)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByText(/GIFs above 30 seconds get large/)).toBeInTheDocument()
      // A warning, not a gate.
      expect(screen.getByRole('button', { name: /download gif/i })).toBeEnabled()
    })

    it('does not warn for an export inside 30 seconds', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.queryByText(/GIFs above 30 seconds get large/)).not.toBeInTheDocument()
    })

    it('warns on the range, not the timeline, when in/out points are set', () => {
      resetStoreForTest()
      store().setProject({ ...store().project, name: 'Test Project' })
      addClip('long', 0, 45)
      store().setInPoint(0)
      store().setOutPoint(5)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      // 45 seconds of timeline but a 5-second section: the warning is about what
      // will actually be encoded.
      expect(screen.queryByText(/GIFs above 30 seconds get large/)).not.toBeInTheDocument()
    })

    it('hides the background-tab note for GIF and says what GIF needs instead', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      expect(
        screen.getByText(/MP4 exports keep encoding in a background tab/)
      ).toBeInTheDocument()

      fireEvent.click(gifRadio())

      // That note is about the two video formats' decoders; GIF has none.
      expect(
        screen.queryByText(/MP4 exports keep encoding in a background tab/)
      ).not.toBeInTheDocument()
      expect(screen.getByText(/GIF export needs this tab visible and has no sound/)).toBeInTheDocument()
    })

    it('leaves GIF enabled, and says so, when the browser has no WebCodecs', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockIsWebMExportSupported.mockResolvedValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(primaryExport()).toBeDisabled())

      // The ESCSUITE-22 alert is still there, and now carries the sentence that
      // stops it being a dead end.
      expect(
        screen.getByText(/Exporting needs WebCodecs, which this browser does not provide/)
      ).toBeInTheDocument()
      expect(screen.getByText(/GIF export needs no WebCodecs/)).toBeInTheDocument()

      fireEvent.click(advancedToggle())
      expect(gifRadio()).toBeEnabled()
      expect(screen.getByRole('radio', { name: /webm/i })).toBeDisabled()
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeDisabled()

      fireEvent.click(gifRadio())
      const button = screen.getByRole('button', { name: /download gif/i })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('title')
    })

    it('exports GIF in a browser with no WebCodecs', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockIsWebMExportSupported.mockResolvedValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(primaryExport()).toBeDisabled())
      chooseGif()
      fireEvent.click(screen.getByRole('button', { name: /download gif/i }))
      await settle()

      expect(mockExportToGIF).toHaveBeenCalledTimes(1)
    })

    it('remembers the frame rate with the rest of the advanced settings', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(fpsSelect(), { target: { value: '10' } })
      fireEvent.click(advancedExport())
      await settle()

      expect(mockSetSetting).toHaveBeenCalledWith('lastExportSettings', {
        format: 'gif',
        quality: 'medium',
        resolution: '480p',
        fps: 10,
      })
    })

    it('restores a saved setting that predates the frame rate at the default', async () => {
      mockGetSetting.mockResolvedValue({ format: 'gif', quality: 'high', resolution: '480p' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(gifRadio()).toBeChecked())

      // A setting saved before this ticket carries no fps at all.
      expect(fpsSelect()).toHaveValue('15')
    })

    it('surfaces a failed GIF export inline, with no format fallback offered', async () => {
      mockExportToGIF.mockRejectedValue(new ExportError('quantiser gave up', []))
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      expect(screen.getByRole('alert')).toHaveTextContent('Export failed: quantiser gave up')
      // "Try MP4 Instead" is WebM's own recovery (ESCSUITE-29 Mechanism 1): a
      // GIF failure is not a codec problem another codec would solve.
      expect(screen.queryByRole('button', { name: /try mp4 instead/i })).not.toBeInTheDocument()
      expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('gif', 'ExportError', expect.any(Number))
    })

    it('stops a GIF export when Cancel is clicked', async () => {
      let signal: AbortSignal | undefined
      mockExportToGIF.mockImplementation((...args: unknown[]) => {
        signal = args[5] as AbortSignal
        return new Promise(() => {})
      })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(signal!.aborted).toBe(true)
      expect(onClose).toHaveBeenCalled()
    })
  })
```

> **Two existing cases need amending** (they enumerate the dialog's options and will now be short of one each). Amend them, do not weaken them:
> - `keeps the format, quality and resolution controls behind the advanced toggle` (line ~151): add `expect(screen.queryByText('GIF (256 colours, no audio)')).not.toBeInTheDocument()` before the click and `expect(screen.getByText('GIF (256 colours, no audio)')).toBeInTheDocument()` after it.
> - Any case asserting the exact number of radios or `<option>`s: update the count and say in the report which one it was.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Export/ExportDialog.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "radio" and name /gif/i`. Quote the exact text, and record how many of the pre-existing cases are red (expected: zero; if any are, the mock additions broke something and that is the first thing to fix).

- [ ] **Step 3: Widen the analytics events** — `apps/artist/src/utils/analytics.ts`

```ts
  // Export events
  exportStarted: (format: 'webm' | 'mp4' | 'gif') =>
    trackEvent('Export Started', { format }),
  exportCompleted: (format: 'webm' | 'mp4' | 'gif', durationSeconds: number) =>
    trackEvent('Export Completed', { format, duration: Math.round(durationSeconds) }),
```

`exportFailed` already takes `format: string` and needs no change.

- [ ] **Step 4: Implement the dialog**

Eleven edits, in file order.

1. **Imports** (4-19):

```ts
import {
  exportToWebM,
  exportToMP4,
  exportToGIF,
  estimateGifBytes,
  isMP4ExportSupported,
  isWebMExportSupported,
  ExportAbortedError,
  ExportError,
  EXPORT_NO_WEBCODECS_REASON,
  WEBM_NO_CODEC_REASON,
  GIF_ALWAYS_AVAILABLE_NOTE,
} from '../../core/exporter';
import {
  getResolution,
  gifFrameRate,
  resolutionForFormat,
  DEFAULT_GIF_FPS,
  GIF_FPS_OPTIONS,
  GIF_RESOLUTIONS,
  GIF_LONG_RANGE_SECONDS,
  GIF_LONG_RANGE_WARNING,
} from '../../core/exportTypes';
import { getSetting, setSetting } from '../../core/storage';
import { analytics } from '../../utils/analytics';
import { sendMessage } from '../../utils/integration';
import type { ExportOptions, ExportProgress } from '../../store/types';
import { formatTime, formatFileSize } from '../../utils/timeUtils';
```

2. **Two module constants** after `resolutionOptionLabel` (36), and the saved-settings shape (44-48):

```ts
/** The resolution presets a format offers, in the order the dropdown lists them. */
const VIDEO_RESOLUTIONS: ExportOptions['resolution'][] = ['project', '1080p', '720p', '480p'];

/** A preset's dropdown label — `'project'` reads as "Project", the rest as themselves. */
function resolutionPresetLabel(preset: ExportOptions['resolution']): string {
  return preset === 'project' ? 'Project' : preset;
}

interface LastExportSettings {
  format: ExportOptions['format'];
  quality: ExportOptions['quality'];
  resolution: ExportOptions['resolution'];
  /** GIF only, and absent from every setting saved before ESCSUITE-34. */
  fps?: ExportOptions['fps'];
}
```

3. **Initial advanced options** (64-68):

```ts
  const [advancedOptions, setAdvancedOptions] = useState<ExportOptions>({
    format: 'webm',
    quality: 'medium',
    resolution: 'project',
    fps: DEFAULT_GIF_FPS,
  });
```

4. **Rename `neitherFormatSupported`** (143) — its old name stopped being true the moment a format that needs no WebCodecs existed:

```ts
  // Neither *video* format can be exported — no WebCodecs in this browser at
  // all (Firefox/Safari before their recent VideoEncoder support, or any
  // browser with it disabled). Both primary buttons are disabled below, with
  // this sentence shown in the main body rather than behind the collapsed
  // Advanced panel — the ESCSUITE-22 fix for the dialog offering an enabled
  // "Download WebM" button that silently failed as soon as it was clicked.
  // Since ESCSUITE-34 it is no longer a dead end: GIF needs no WebCodecs, so
  // the alert carries GIF_ALWAYS_AVAILABLE_NOTE beside it and the GIF radio
  // stays enabled.
  const noVideoFormatSupported = !mp4Supported && !webmSupported;
```

Update its three other uses (151, 434, 505) to the new name. **Do not** gate the alert on anything new — the sentence is added inside it.

5. **`effectiveAdvancedFormat`** (164-166):

```ts
  // The Advanced "Download {format}" button must gate on the format the click
  // will actually run, not the one selected in the radio (ESCSUITE-22 review
  // round 1, MAJOR 1). GIF short-circuits the MP4 fallback entirely: it is
  // always available, so nothing can block it.
  const effectiveAdvancedFormat: ExportOptions['format'] =
    advancedOptions.format === 'gif'
      ? 'gif'
      : advancedOptions.format === 'mp4' && mp4Supported
        ? 'mp4'
        : 'webm';
  const advancedBlockedReason = effectiveAdvancedFormat === 'webm' ? webmBlockedReason : null;
```

6. **Four derived GIF values**, after `advancedBlockedReason`:

```ts
  // What a GIF export would actually produce, for the estimate and the warning.
  // Computed unconditionally (it is arithmetic over values already in scope) and
  // rendered only when GIF is the selected format.
  const gifFps = gifFrameRate(advancedOptions.fps);
  const timelineDuration = clips.reduce(
    (max, clip) => Math.max(max, clip.timelinePosition + clip.duration),
    0
  );
  // The length that will be encoded: the in/out section when there is one, the
  // whole timeline otherwise. The warning is about the output, not the project.
  const gifSeconds = timeRange ? timeRange.end - timeRange.start : timelineDuration;
  const gifFrames = Math.ceil(gifSeconds * gifFps);
  const gifOutput = getResolution(
    advancedOptions.resolution,
    projectResolution.width,
    projectResolution.height,
    projectResolution
  );
```

7. **Restoring saved settings** (169-182) — carry `fps` through `gifFrameRate` so a setting saved before this ticket lands on the default:

```ts
  useEffect(() => {
    if (isOpen) {
      getSetting<LastExportSettings>('lastExportSettings').then((saved) => {
        if (saved) {
          setAdvancedOptions({
            format: saved.format,
            quality: saved.quality,
            resolution: saved.resolution,
            fps: gifFrameRate(saved.fps),
          });
          setShowAdvanced(true);
        }
      });
    }
  }, [isOpen]);
```

8. **`handleExport`** (184): widen the override, add the GIF branch to the format decision, the dispatch and the saved settings, and widen the analytics cast:

```ts
  const handleExport = useCallback(async (formatOverride?: ExportOptions['format'], useAdvanced?: boolean, exportFullVideo?: boolean) => {
```

```ts
    const exportOptions: ExportOptions = useAdvanced
      ? { ...advancedOptions, timeRange: effectiveTimeRange }
      : { format: 'webm', quality: 'medium', resolution: 'project', timeRange: effectiveTimeRange };

    const requestedFormat = formatOverride || exportOptions.format;
    // GIF needs no WebCodecs, so it never falls back; MP4 still does.
    const format: ExportOptions['format'] =
      requestedFormat === 'gif' ? 'gif' : requestedFormat === 'mp4' && mp4Supported ? 'mp4' : 'webm';
    analytics.exportStarted(format);

    // Save advanced settings if using advanced options
    if (useAdvanced) {
      setSetting('lastExportSettings', {
        format: advancedOptions.format,
        quality: advancedOptions.quality,
        resolution: advancedOptions.resolution,
        fps: gifFrameRate(advancedOptions.fps),
      });
    }
```

```ts
      let blob: Blob;
      let extension: string;

      if (format === 'gif') {
        blob = await exportToGIF(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'gif';
      } else if (format === 'mp4') {
        blob = await exportToMP4(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'mp4';
      } else {
        blob = await exportToWebM(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
        extension = 'webm';
      }
```

```ts
      analytics.exportCompleted(extension as 'webm' | 'mp4' | 'gif', totalDuration);
```

In the catch, the diagnostic-log label and the fallback offer:

```ts
      if (err instanceof ExportError) {
        console.debug(`[${format.toUpperCase()} Export] Diagnostic log:`, err.exportLog);
      }
```

```ts
      if (isCurrentRun()) {
        if (format === 'mp4') {
          setMp4FailedError(errorMessage);
        } else {
          setError(errorMessage);
          // ESCSUITE-29 Mechanism 1: a WebM ExportError is a diagnosed codec
          // problem rather than a generic crash, so — when MP4 is actually
          // available — offer it as a one-click alternative here. A GIF failure
          // is not a codec problem another codec would solve, so it is offered
          // nothing further (ESCSUITE-34).
          setOfferMp4Fallback(format === 'webm' && err instanceof ExportError && mp4Supported);
        }
        setProgress(null);
      }
```

`handleExport`'s dependency list gains nothing: `advancedOptions` is already in it.

9. **The progress view** (413-426) gains the live estimate:

```tsx
            <div className={styles.progressSection}>
              <div className={styles.progressInfo}>
                <span className={styles.progressPhase}>{progress.phase}</span>
                <span className={styles.progressMessage}>{progress.message}</span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <span className={styles.progressPercent}>{Math.round(progress.progress)}%</span>
              {/* GIF only: the exporter projects the finished size from the
                  bytes it has actually written, which is the one number a user
                  wants while a GIF encodes. Absent on every WebM and MP4
                  report, so this row simply does not exist for them. */}
              {progress.estimatedBytes !== undefined && (
                <span className={styles.summary} role="status">
                  Estimated size: ~{formatFileSize(progress.estimatedBytes)}
                </span>
              )}
            </div>
```

10. **The two notes** above the Advanced section (519-523):

```tsx
              {/* MP4 decodes through WebCodecs (in a worker) when the decode worker
                  starts successfully; WebM always drives an HTMLVideoElement from
                  rAF, which the browser throttles once the tab is hidden — and so
                  does MP4 when it has fallen back to the same element path
                  (ESCSUITE-153 / ESCSUITE-29 Mechanism 2). Hidden when GIF is
                  selected: it is about the two video formats' decoders, and GIF
                  has none (ESCSUITE-34). */}
              {mp4Supported && advancedOptions.format !== 'gif' && (
                <div className={styles.summary}>
                  MP4 exports keep encoding in a background tab when the decoder is available. WebM needs this tab visible.
                </div>
              )}

              {/* The two things a GIF surprises people with, said once. */}
              {advancedOptions.format === 'gif' && (
                <div className={styles.summary}>
                  GIF export needs this tab visible and has no sound.
                </div>
              )}
```

11. **The Advanced panel**: the GIF radio, the fps control, the per-format resolution list, the estimate, the warning and the button label.

```tsx
                    <div className={styles.section}>
                      <label className={styles.label}>Format</label>
                      <div className={styles.radioGroup}>
                        <label className={`${styles.radio} ${!webmSupported ? styles.radioDisabled : ''}`}>
                          <input
                            type="radio"
                            name="format"
                            value="webm"
                            checked={advancedOptions.format === 'webm'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'webm',
                              resolution: resolutionForFormat('webm', advancedOptions.resolution),
                            })}
                            disabled={!webmSupported}
                          />
                          <span>WebM (VP9 + Opus)</span>
                          <span className={styles.radioHint}>
                            {webmSupported ? 'Smaller file size' : 'Not supported in this browser'}
                          </span>
                        </label>
                        <label className={`${styles.radio} ${!mp4Supported ? styles.radioDisabled : ''}`}>
                          <input
                            type="radio"
                            name="format"
                            value="mp4"
                            checked={advancedOptions.format === 'mp4'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'mp4',
                              resolution: resolutionForFormat('mp4', advancedOptions.resolution),
                            })}
                            disabled={!mp4Supported}
                          />
                          <span>MP4 (H.264 + AAC)</span>
                          <span className={styles.radioHint}>
                            {mp4Supported ? 'Best compatibility' : 'Not supported in this browser'}
                          </span>
                        </label>
                        {/* Never disabled: `gifenc` is pure JavaScript, so this is
                            the one format that works in a browser where both
                            others are refused. The label and hint deliberately
                            avoid the words "WebM" and "MP4" — the suite finds the
                            other two radios by exactly those words. */}
                        <label className={styles.radio}>
                          <input
                            type="radio"
                            name="format"
                            value="gif"
                            checked={advancedOptions.format === 'gif'}
                            onChange={() => setAdvancedOptions({
                              ...advancedOptions,
                              format: 'gif',
                              resolution: resolutionForFormat('gif', advancedOptions.resolution),
                            })}
                          />
                          <span>GIF (256 colours, no audio)</span>
                          <span className={styles.radioHint}>No WebCodecs needed</span>
                        </label>
                      </div>
                    </div>

                    <div className={styles.section}>
                      <label className={styles.label}>Quality</label>
                      <select
                        className={styles.select}
                        value={advancedOptions.quality}
                        onChange={(e) => setAdvancedOptions({ ...advancedOptions, quality: e.target.value as ExportOptions['quality'] })}
                      >
                        <option value="low">Low (faster export)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (slower export)</option>
                      </select>
                    </div>

                    {/* GIF only: 10/15/20, the three rates a format whose size is
                        roughly linear in its frame count can sensibly offer. */}
                    {advancedOptions.format === 'gif' && (
                      <div className={styles.section}>
                        <label className={styles.label} htmlFor="export-gif-fps">
                          Frames per second
                        </label>
                        <select
                          id="export-gif-fps"
                          className={styles.select}
                          value={gifFps}
                          onChange={(e) => setAdvancedOptions({
                            ...advancedOptions,
                            fps: Number(e.target.value) as ExportOptions['fps'],
                          })}
                        >
                          {GIF_FPS_OPTIONS.map((fps) => (
                            <option key={fps} value={fps}>
                              {fps === 10 ? '10 fps (smallest file)' : fps === 20 ? '20 fps (smoothest)' : '15 fps'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={styles.section}>
                      <label className={styles.label}>Resolution</label>
                      <select
                        className={styles.select}
                        value={advancedOptions.resolution}
                        onChange={(e) => setAdvancedOptions({ ...advancedOptions, resolution: e.target.value as ExportOptions['resolution'] })}
                      >
                        {/* Per format: GIF offers three fixed heights, the video
                            formats offer the project's own size and three
                            presets. Every format radio runs the current
                            selection through `resolutionForFormat`, so the value
                            is always one this list contains. */}
                        {(advancedOptions.format === 'gif' ? GIF_RESOLUTIONS : VIDEO_RESOLUTIONS).map((preset) => (
                          <option key={preset} value={preset}>
                            {resolutionOptionLabel(resolutionPresetLabel(preset), preset, projectResolution)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* The up-front estimate: pixels x frames x ~0.3 bytes, which
                        the exporter replaces with a real one (bytes written /
                        frames done x frames total) as soon as it has a frame. */}
                    {advancedOptions.format === 'gif' && (
                      <div className={styles.summary} role="status">
                        Estimated size: ~{formatFileSize(estimateGifBytes(gifOutput.width, gifOutput.height, gifFrames))}
                        {' '}at {gifOutput.width}×{gifOutput.height}, {gifFrames} frames
                      </div>
                    )}

                    {/* A warning, never a refusal. */}
                    {advancedOptions.format === 'gif' && gifSeconds > GIF_LONG_RANGE_SECONDS && (
                      <div className={styles.summary} role="status">
                        {GIF_LONG_RANGE_WARNING}
                      </div>
                    )}

                    <button
                      className={styles.advancedExportButton}
                      onClick={() => handleExport(undefined, true)}
                      disabled={clips.length === 0 || advancedBlockedReason !== null}
                      title={advancedBlockedReason ?? undefined}
                    >
                      Download {advancedOptions.format === 'gif' ? 'GIF' : advancedOptions.format === 'mp4' ? 'MP4' : 'WebM'}
                    </button>
```

12. **The no-WebCodecs alert** (434-443) gains its second sentence:

```tsx
              {noVideoFormatSupported && (
                <div className={styles.error} role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {EXPORT_NO_WEBCODECS_REASON} {GIF_ALWAYS_AVAILABLE_NOTE}
                </div>
              )}
```

- [ ] **Step 5: Run the dialog suite green**

Run: `pnpm --filter @escapesuite/artist exec vitest run src/components/Export/ExportDialog.test.tsx`
Expected: PASS, every case — the new block and every pre-existing one. If `75 frames` or `2.5 MB` disagree, recompute from the fixture (`addClip('clip1', 0, 5)` is 5 seconds; `formatFileSize(2_621_440)` is `'2.5 MB'`) and fix the test's arithmetic, not the component.

- [ ] **Step 6: Verify the package**

```bash
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
pnpm --filter @escapesuite/artist exec vitest run
```

Everything green. Note in the report whether any suite outside `components/Export/` needed a change — the answer should be none.

- [ ] **Step 7: Commit**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/src/components/Export/ExportDialog.tsx \
        apps/artist/src/components/Export/ExportDialog.test.tsx \
        apps/artist/src/utils/analytics.ts
git commit -m "$(cat <<'MSG'
feat(artist): GIF in the export dialog — fps, its own presets, a size estimate (ESCSUITE-34)

A third radio under Advanced options, beside MP4, and the four controls a GIF
needs that a video does not.

The GIF radio is never disabled, which is the point of the format: `gifenc` is
pure JavaScript, so in a browser that can configure neither VP9/VP8 nor H.264 it
is the one export that still works. The ESCSUITE-22 alert that used to end the
conversation there now carries a second sentence saying so, and
`neitherFormatSupported` is renamed `noVideoFormatSupported` because its old
name stopped being true. The primary buttons stay disabled — they are WebM's.

A frame-rate select (10/15/20, default 15) appears only for GIF. The resolution
list is now per format: GIF offers exactly 720p/480p/360p, the video formats
offer the project's own size and the three presets they always did, and every
format radio runs the current selection through `resolutionForFormat` on the way
across — so choosing GIF while 1080p is selected lands on 480p, leaving GIF
lands off 360p, and the select's value is always something its own list
contains.

Two size estimates, at the two moments there is something to say. Before the
export, `estimateGifBytes` over the chosen preset, rate and range — crude by
construction, since nothing can know how much of each frame changes. During it,
the exporter's own `progress.estimatedBytes`, from bytes actually written. Both
render through `formatFileSize`, the formatter the media library already uses,
so the whole app says "2.5 MB" the same way. Past 30 seconds of output a
`role="status"` line suggests WebM instead; nothing is disabled by it, and it
measures the in/out section rather than the timeline when there is one, because
that is what will be encoded.

The background-tab note is hidden for GIF — it is about the two video formats'
decoders — and replaced by the two things a GIF actually surprises people with:
it needs the tab visible, and it has no sound.

A failed GIF export is reported inline like a failed WebM one but is offered no
"Try MP4 Instead": that button exists because a WebM `ExportError` is a
diagnosed codec problem another codec might not have, and a GIF failure is not.

One constraint on the copy worth recording: the GIF radio's label and hint
contain neither "WebM" nor "MP4", because the dialog's suite finds the other two
radios by exactly those words in a dozen places. "GIF (256 colours, no audio)"
and "No WebCodecs needed" keep every one of those queries unambiguous.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

### Task 5: the headless kit renders GIF

**Files:**
- Modify: `apps/artist/src/headless/types.ts` (`RenderMeta.format`, line **35**)
- Modify: `apps/artist/src/headless/renderProject.ts` (the format decision and dispatch, lines **78-81**; the import at **2**)
- Modify: `apps/artist/src/headless/renderProject.test.ts` (one case, beside `routes webm to exportToWebM` at **56**)
- Modify: `services/headless-artist/src/jobSpec.ts` (`FORMATS` **4**, `RESOLUTIONS` **6**, `OPTIONS_KEYS` **11**, `parseOptions` **43-88**)
- Modify: `services/headless-artist/src/jobSpec.test.ts` (cases appended to both describes)
- Modify: `services/headless-artist/src/sinks.ts` (**14-22**), `services/headless-artist/src/s3.ts` (**18-26**)
- Modify: `services/headless-artist/src/run.chromium.test.ts` (one case; the coordinator runs it)
- Modify: `services/headless-artist/README.md`

**Interfaces:**

- Consumes: Task 3's `exportToGIF` (through `../core/exporter`) and the widened `ExportOptions`.
- Produces: no new exported symbol. `RenderMeta['format']` widens to `'mp4' | 'webm' | 'gif'`, which **forces** the two `Record<VerificationManifest['format'], string>` maps in `sinks.ts` and `s3.ts` to gain a `gif` key — the compiler finds them, which is why neither is easy to forget.

**Five decisions this task pins, all argued in the commit message:**

- **`fps` is accepted for GIF and rejected for the other two formats**, per the spec. A `format: "mp4", fps: 20` job is a caller who misunderstood something, and the kit's whole validation posture (ESCSUITE-83's `collectUnknownKeys`, the `jobId` path checks) is to say so before Chromium launches rather than render something other than what was asked for.
- **`'360p'` is accepted by `RESOLUTIONS` for any format, not just GIF.** The validator's job is to reject what cannot work; `getResolution('360p', …)` works for every format and an MP4 at 640×360 is a legitimate, if unusual, thing to ask a render farm for. The *dialog* is where 360p is GIF-only, because that is a product choice about what to offer, not a correctness one. This is a deliberate divergence from `resolutionForFormat` and is written down as such.
- **The widened `RenderMeta['format']` is the mechanism, not a courtesy.** Both sink files' extension/MIME maps are keyed on it, so widening the type is what makes `tsc` demand `gif: 'gif'` and `gif: 'image/gif'`. The volume sink's `${jobId}.${ext}` and `run.ts`'s `render.${format}` then need no change at all.
- **One Chromium parity case, not a suite.** The kit's value here is that it drives the editor's own exporter, so the question worth a real browser is "does a GIF come out of the real pipeline, through the real sink, with a manifest that agrees" — asserted by the `GIF89a` magic bytes. Everything else is already covered by the artist package's own tests.
- **`options.fps` is documented in the README's job-spec table**, beside `quality` and `resolution`, including the centisecond rounding. A field that only exists in a validator is a field nobody uses.

- [ ] **Step 1: Write the failing kit tests**

In `services/headless-artist/src/jobSpec.test.ts`, append to `describe('parseJobSpec')`:

```ts
  it('accepts gif as a format', () => {
    const spec = parseJobSpec(validSpec({ options: { format: 'gif' } }))
    expect(spec.options).toEqual({ format: 'gif', quality: 'high' })
  })

  it('keeps a 360p resolution', () => {
    // '360p' is accepted for any format, not just gif: `getResolution` answers
    // it for all three and an MP4 at 640x360 is a legitimate thing to ask a
    // render farm for. The export *dialog* is where 360p is gif-only, because
    // that is a choice about what to offer rather than about what works.
    const spec = parseJobSpec(validSpec({ options: { format: 'gif', resolution: '360p' } }))
    expect(spec.options.resolution).toBe('360p')
  })

  it.each([10, 15, 20])('keeps an fps of %s for a gif', (fps) => {
    const spec = parseJobSpec(validSpec({ options: { format: 'gif', fps } }))
    expect(spec.options.fps).toBe(fps)
  })

  it('leaves fps unset when a gif job does not ask for one', () => {
    // The exporter's own default (15) applies; the spec does not invent one.
    const spec = parseJobSpec(validSpec({ options: { format: 'gif' } }))
    expect(spec.options.fps).toBeUndefined()
  })

  it.each([7, 0, 30, '15', 15.5, null])('rejects an fps of %s', (fps) => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'gif', fps } }))).toThrow(
      /options\.fps must be one of 10, 15, or 20/
    )
  })

  it.each(['mp4', 'webm'])('rejects fps for a %s job', (format) => {
    // Silently ignoring it would render at 30 fps while the caller believed
    // otherwise — the failure mode `collectUnknownKeys` exists to prevent, for a
    // field that is known but inapplicable.
    expect(() => parseJobSpec(validSpec({ options: { format, fps: 15 } }))).toThrow(
      /options\.fps applies to "gif" only/
    )
  })

  it('names gif in the format error', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'avi' } }))).toThrow(
      /options\.format must be one of "mp4", "webm", or "gif"/
    )
  })

  it('names 360p in the resolution error', () => {
    expect(() => parseJobSpec(validSpec({ options: { format: 'gif', resolution: '240p' } }))).toThrow(
      /"720p", "480p", or "360p"/
    )
  })
```

and to `describe('collectUnknownKeys')`:

```ts
  it('does not flag fps, which the parser reads', () => {
    expect(collectUnknownKeys(validSpec({ options: { format: 'gif', fps: 15 } }))).toEqual([])
  })
```

In `apps/artist/src/headless/renderProject.test.ts`, add `exportToGIF` to the hoisted mock block and the `vi.mock('../core/exporter', …)` factory, add `exportToGIF.mockClear()` to the `beforeEach` at line 39, and add this case beside `routes webm to exportToWebM`:

```ts
  it('routes gif to exportToGIF, carrying the frame rate through', async () => {
    const input = baseInput()
    input.options = { format: 'gif', fps: 20 } as RenderInput['options']
    const res = await renderProject(input)

    expect(exportToGIF).toHaveBeenCalledTimes(1)
    expect(exportToMP4).not.toHaveBeenCalled()
    expect((exportToGIF.mock.calls[0] as unknown[])[2]).toMatchObject({ format: 'gif', fps: 20 })
    expect(res.meta.format).toBe('gif')
  })
```

The hoisted mock gains:

```ts
  exportToGIF: vi.fn(async () => new Blob([new Uint8Array([7])], { type: 'image/gif' })),
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @escapesuite/headless-artist exec vitest run src/jobSpec.test.ts
pnpm --filter @escapesuite/artist exec vitest run src/headless/renderProject.test.ts
```

Expected: both FAIL — the kit's with `options.format must be one of "mp4" or "webm"` thrown for `'gif'`, the artist's with `No "exportToGIF" export is defined on the "../core/exporter" mock`. Quote both.

- [ ] **Step 3: Widen `RenderMeta` and route the format** — `apps/artist/src/headless/`

In `types.ts`:

```ts
/** Describes the encoded OUTPUT (after resolution/timeRange options), for the verification manifest (Plan 2). */
export interface RenderMeta {
  format: 'mp4' | 'webm' | 'gif'
```

In `renderProject.ts`, line 2 and lines 78-81:

```ts
import { exportToGIF, exportToMP4, exportToWebM } from '../core/exporter'
```

```ts
  // One branch per format, in the same shape the export dialog uses. 'mp4' is
  // the fallback for an unrecognised value, which is what it has always been.
  const format: RenderMeta['format'] =
    options.format === 'webm' ? 'webm' : options.format === 'gif' ? 'gif' : 'mp4'
  const blob = format === 'webm'
    ? await exportToWebM(clips, sourceVideos, options, progress, tracks, undefined, resolution)
    : format === 'gif'
      ? await exportToGIF(clips, sourceVideos, options, progress, tracks, undefined, resolution)
      : await exportToMP4(clips, sourceVideos, options, progress, tracks, undefined, resolution)
```

`RenderMeta` is already imported there (line 6).

- [ ] **Step 4: Widen the validator** — `services/headless-artist/src/jobSpec.ts`

```ts
const FORMATS = ['mp4', 'webm', 'gif']
const QUALITIES = ['low', 'medium', 'high']
const RESOLUTIONS = ['project', '1080p', '720p', '480p', '360p']
const SINKS = ['volume', 's3', 'webhook', 'command']
/** GIF only. The three rates ESCAPEARTIST's own export offers (ESCSUITE-34). */
const GIF_FPS = [10, 15, 20]
```

```ts
const OPTIONS_KEYS = ['format', 'quality', 'resolution', 'timeRange', 'fps']
```

In `parseOptions`, the format message and the new `fps` block (after the `resolution` block, before `timeRange`):

```ts
  const format = value.format
  if (typeof format !== 'string' || !FORMATS.includes(format)) {
    throw new Error('options.format must be one of "mp4", "webm", or "gif"')
  }
```

```ts
  if (value.resolution !== undefined) {
    if (typeof value.resolution !== 'string' || !RESOLUTIONS.includes(value.resolution)) {
      throw new Error(
        'options.resolution must be one of "project", "1080p", "720p", "480p", or "360p"',
      )
    }
    options.resolution = value.resolution as NonNullable<JobSpec['options']['resolution']>
  }

  // GIF only, and said rather than ignored: a `format: "mp4", fps: 20` job is a
  // caller who misunderstood something, and rendering at 30 fps anyway is
  // exactly the quiet-wrong-output failure `collectUnknownKeys` exists to stop —
  // for a field that is known but inapplicable rather than misspelled.
  if (value.fps !== undefined) {
    if (format !== 'gif') {
      throw new Error('options.fps applies to "gif" only')
    }
    if (typeof value.fps !== 'number' || !GIF_FPS.includes(value.fps)) {
      throw new Error('options.fps must be one of 10, 15, or 20')
    }
    options.fps = value.fps as NonNullable<JobSpec['options']['fps']>
  }
```

Note the ordering: the format check comes first in the function, so `format` is already narrowed to one of the three by the time the `fps` block reads it.

- [ ] **Step 5: Add `gif` to both sink maps**

`services/headless-artist/src/sinks.ts` (14-22) and `services/headless-artist/src/s3.ts` (18-26), identically:

```ts
const FORMAT_TO_EXTENSION: Record<VerificationManifest['format'], string> = {
  mp4: 'mp4',
  webm: 'webm',
  gif: 'gif',
}

const FORMAT_TO_MIME: Record<VerificationManifest['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
}
```

Both are `Record<VerificationManifest['format'], …>`, so Step 3's widening is what makes `tsc` demand these four lines — run `pnpm --filter @escapesuite/headless-artist exec tsc -b --noEmit` before editing them and confirm it names both files. If it names a third, add that one too and say which in the report.

- [ ] **Step 6: Run the kit tests green**

```bash
pnpm --filter @escapesuite/headless-artist exec vitest run src/jobSpec.test.ts src/sinks.test.ts src/s3.test.ts src/run.test.ts
pnpm --filter @escapesuite/artist exec vitest run src/headless/renderProject.test.ts
```

Expected: PASS.

- [ ] **Step 7: Write the Chromium parity case** — `services/headless-artist/src/run.chromium.test.ts`

Add after the existing `renders a manifest job and delivers it through the volume sink` case. **Write it; do not run it** — it builds the ARTIST headless bundle and launches real Chromium, which is the coordinator's step (C3).

```ts
  it('renders the same job as a GIF', async () => {
    const spec: JobSpec = {
      ...makeSpec('e2e-gif'),
      options: { format: 'gif', quality: 'medium', fps: 10, resolution: '360p' },
    }

    const outcome = await runJob(spec, {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    // 360p of the fixture's 64x48 (4:3) project is 480x360, through the same
    // `getResolution` the two video formats use.
    expect(outcome.meta).toMatchObject({ format: 'gif', width: 480, height: 360, gpu: false })

    const outputPath = path.join(outDir, 'e2e-gif.gif')
    expect(outcome.outputLocation).toBe(outputPath)
    const bytes = await fs.readFile(outputPath)
    // Every GIF starts with the signature and version; this one must be 89a,
    // because an animated GIF needs the Graphic Control Extension that 87a
    // does not have.
    expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
    // And it ends with the trailer, which is how we know it was finished rather
    // than truncated.
    expect(bytes[bytes.byteLength - 1]).toBe(0x3b)

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'e2e-gif.manifest.json'), 'utf8')
    )
    expect(manifest.format).toBe('gif')
    expect(manifest.byteLength).toBe(bytes.byteLength)
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
  }, RENDER_TIMEOUT_MS)
```

`makeSpec` returns `options: { format: 'mp4', quality: 'medium' }`, so the spread-then-override above is how the existing helper is reused without changing it.

- [ ] **Step 8: Document it in the kit README**

Five edits in `services/headless-artist/README.md`:

1. The `options.format` row (line **116**):

```
| `options.format` | yes | `mp4` (H.264 + AAC), `webm` (VP9 + Opus) or `gif` (animated GIF, 256 colours per frame, no audio). |
```

2. A new `options.fps` row, immediately after `options.quality` (**117**):

```
| `options.fps` | no | **`gif` only** — `10`, `15` (default) or `20`. Rejected for the other two formats, which always encode at 30. A GIF stores each frame's delay in centiseconds, so 10 and 20 fps are exact while 15 fps really plays at about 14.3. |
```

3. The `options.resolution` row (**118**) — add `360p` and the note that `gif` is the only format the editor offers it for:

```
| `options.resolution` | no | `project` (default) uses the project's own resolution; `1080p`, `720p`, `480p` and `360p` scale to that height, keeping the *project's* aspect ratio (falling back to the bottom-most media clip's native aspect only when the project has no resolution of its own). Odd dimensions are rounded up to even. All five are accepted for every format; ESCAPEARTIST's own export dialog offers `360p` for `gif` only. |
```

4. The volume sink's output name (**208**) and the S3 sink's content type (**297**):

```
Writes `<dir>/<jobId>.<mp4|webm|gif>` and `<dir>/<jobId>.manifest.json`. The directory is created
```

```
from disk rather than buffered, and tagged `video/mp4` / `video/webm` / `image/gif` (the manifest
```

5. The webhook sink's content type (**262-263**), the manifest's `format` row (**392**) and the 400-error example (**619**):

```
JSON string) and `file` (the video, filename `<jobId>.<ext>`, content type `video/mp4`,
`video/webm` or `image/gif`). Any non-2xx response fails the job. `outputLocation` is the URL.
```

```
| `format` | `mp4`, `webm` or `gif`, as requested. |
```

```
| `400` | The body is not JSON, or the job spec is invalid. The job never started. | `{"error": "options.format must be one of \"mp4\", \"webm\", or \"gif\""}` |
```

Then `grep -n 'mp4" or "webm"\|<mp4|webm>\|mp4` or `webm`' README.md` and fix anything the list above missed; report what you found.

- [ ] **Step 9: Verify both packages**

```bash
pnpm --filter @escapesuite/headless-artist exec tsc -b --noEmit
pnpm --filter @escapesuite/headless-artist exec eslint .
pnpm --filter @escapesuite/headless-artist exec vitest run
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
pnpm --filter @escapesuite/artist exec vitest run
```

The kit's `vitest run` excludes `*.chromium.test.ts` by default, so Step 7's case is compiled by `tsc` and not executed here — which is the intent.

- [ ] **Step 10: Commit**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/src/headless/types.ts apps/artist/src/headless/renderProject.ts \
        apps/artist/src/headless/renderProject.test.ts \
        services/headless-artist/src/jobSpec.ts services/headless-artist/src/jobSpec.test.ts \
        services/headless-artist/src/sinks.ts services/headless-artist/src/s3.ts \
        services/headless-artist/src/run.chromium.test.ts services/headless-artist/README.md
git commit -m "$(cat <<'MSG'
feat(headless-artist): render a job as an animated GIF (ESCSUITE-34)

`options.format` accepts `gif`, `options.resolution` accepts `360p`, and a new
`options.fps` (10/15/20) is accepted for GIF and **rejected** for the other two.
Silently ignoring an `fps` on an MP4 job would render at 30 while the caller
believed otherwise, which is the quiet-wrong-output failure
`collectUnknownKeys` exists to prevent — for a field that is known but
inapplicable rather than misspelled.

`360p` is accepted for every format, not only GIF, and that divergence from the
editor is deliberate: `getResolution` answers it for all three and an MP4 at
640x360 is a legitimate thing to ask a render farm for. The export dialog's
GIF-only 360p is a choice about what to offer, not about what works.

Widening `RenderMeta['format']` is the mechanism rather than a courtesy: both
sinks' extension and MIME maps are `Record<VerificationManifest['format'],
string>`, so the compiler is what demands `gif: 'gif'` and `gif: 'image/gif'` in
`sinks.ts` and `s3.ts`. The volume sink's `${jobId}.${ext}`, the webhook sink's
upload and `run.ts`'s `render.${format}` needed no change at all.

One Chromium parity case, because the kit's whole claim is that it drives the
editor's own exporter: a real browser renders the manifest fixture to a real GIF
through the real volume sink, and the assertions are the signature (`GIF89a` —
89a specifically, since an animated GIF needs the Graphic Control Extension 87a
lacks), the trailer byte that proves it was finished rather than truncated, and
a manifest whose byteLength and sha256 agree with the file on disk.

The README documents all of it in the job-spec table, including the centisecond
rounding that makes a "15 fps" GIF play at about 14.3 — a field that exists only
in a validator is a field nobody uses.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

### Task 6: documentation and the two changesets

**Files:**
- Modify: `apps/artist/CLAUDE.md` (the `exporter.ts` bullet at **108-110**; a new "GIF Export" section after "WebM Export Reliability" which ends at **~2385**; the "Export Resolution" section at **2102**; the "Export Dialog Browser Support" section at **2386**; the doubles paragraph in "Testing" at **~2675**)
- Modify: `apps/artist/src/utils/integration.ts` (the `EXPORT_COMPLETE` protocol line at **336**)
- Modify: `CLAUDE.md` (root) — **exactly two lines**: the ESCAPEARTIST "Export formats" bullet at **145** and the Integration API's `EXPORT_COMPLETE` line at **173**
- Create: `.changeset/escsuite-34-artist-gif-export.md`
- Create: `.changeset/escsuite-34-headless-gif-export.md`

**Interfaces:** none. This task writes prose and two changesets; it changes no behaviour and adds no test.

**Reminder: do not touch the root `CLAUDE.md` coverage section** (its "Where it stands" paragraphs and the floors table). The coordinator measures and writes that. The two root lines below are the whole of this task's root-file edit, and `git diff CLAUDE.md` should show exactly those two hunks.

- [ ] **Step 1: The `exporter.ts` bullet** — `apps/artist/CLAUDE.md` 108-110

```
- `exporter.ts`: Three export paths — two through WebCodecs + `mediabunny` for muxing, one
  through neither:
  - **WebM**: VP9 video + Opus audio, frame-by-frame encoding with audio mixing
  - **MP4**: H.264 video + AAC audio, frame-by-frame encoding with WebCodecs decoding
  - **GIF**: `gifenc`, one 256-colour palette per frame, no audio, **no WebCodecs at all**
    (ESCSUITE-34) — see "GIF Export" below
- `elementFrames.ts`: the per-frame machinery the two *element-drawing* exporters share
  (ESCSUITE-34) — `loadElementSources` (each unique source into a `<video>`/`<img>`),
  `rewindElementSources` (one `currentTime = 0` apiece before the loop),
  `createFrameComposer` (one frame: `openOutputFrame`, the per-clip seek, the single
  track-ordered interleaved draw pass, the transition) and `releaseElementSources` (every object
  URL). `exportWebM.ts` had all of it inline; `exportGIF.ts` needed the same thing with a
  different encoder at the end of the frame, so it was lifted rather than copied. `exportMP4.ts`
  is **not** a caller — it decodes through `VideoDecodeManager` and draws `VideoFrame`s, so it
  shares `canvasRenderer.ts` but not this
- `gifEncoder.ts`: the one module in the repo allowed to import `gifenc`. `createGifWriter()`
  wraps the three calls a GIF frame always needs together — `quantize` → `applyPalette` →
  `writeFrame` — and exposes the stream's own byte cursor as `bytesWritten()`, which is the
  numerator of the live size estimate. `core/gifEncoder.test.ts` is the only test that runs the
  real package; everything downstream mocks this module and counts calls
```

- [ ] **Step 2: A new "GIF Export" section**, inserted after "WebM Export Reliability" and before "Export Dialog Browser Support"

```markdown
### GIF Export (`src/core/exportGIF.ts`, `src/core/gifEncoder.ts`, `src/core/elementFrames.ts`)

**The third format, and the only one that needs nothing from WebCodecs** (ESCSUITE-34). It is for
the thing a GIF is actually good at: a few seconds of a screen recording dropped into a chat tool
that will not play a video inline. `gifenc` (MIT, pure JS, no dependencies, pinned **exactly** at
1.0.3 — the wrapper's test asserts byte counts) does the encoding on the main thread inside the
frame loop, the same place the canvas draw already happens.

**It shares the frame machinery rather than copying it.** `core/elementFrames.ts` is
`exportWebM.ts`'s own per-frame code, lifted: the media elements, the one-time rewind, the
per-frame seek (tolerance is a little under half an *output* frame, so it scales with the chosen
fps), the single track-ordered interleaved draw pass, the transition. `exportGIF.ts` calls
`composeFrame(t)` and then does the one thing that is its own:

```
ctx.getImageData(0, 0, width, height)  ->  quantize(..., 256)  ->  applyPalette  ->  writeFrame
```

`getImageData` reads **device pixels and ignores the current transformation matrix**, so the frame
the encoder sees is the whole output raster — including any letterbox bar `openOutputFrame`
painted. Nothing is saved, restored or re-transformed around it, which is why
`core/exportGIF.perf.test.ts` can still assert one `setTransform` per frame. The canvas is created
`{ alpha: false, willReadFrequently: true }`: every frame reads the entire raster back, and
without the hint the backing store stays GPU-side and each read is a stall.

**What a GIF cannot carry is absent, not computed and discarded.** No `extractAndMixAudio` call —
mixing the whole timeline's audio to throw it away is the most expensive no-op available, and
`exportGIF.test.ts` asserts the mixer is never called. No muxer, no encoder queue, no
`waitForEncoderBackpressure`. What is left is a frame loop, which is also the whole of the
cancellation surface: `checkAborted(signal)` at the top of every frame, so Cancel stops the export
within one frame (ESCSUITE-98 run identity), and a frame that throws wraps in `ExportError` with
the diagnostic log and the frame it reached, exactly as the other two do.

**The options.**

| Option | Values | Notes |
|---|---|---|
| `fps` | 10, 15 (default), 20 | Read through `gifFrameRate()`, never directly, so `undefined` (every caller predating this ticket), a stale saved setting and a hand-built headless job spec all land on 15 |
| `resolution` | `720p`, `480p` (default), `360p` | `'360p'` is on the shared `ExportOptions['resolution']` union; `resolutionForFormat()` is what keeps it GIF-only in the dialog |
| `timeRange` | the existing in/out points | Unchanged — "Export Section" works for GIF exactly as it does for the other two |

**The delay a GIF file actually stores is centiseconds.** `gifenc` writes
`Math.round(delayMs / 10)` into each frame's Graphic Control Extension, so 10 fps (100 ms) and
20 fps (50 ms) are exact while **15 fps (67 ms) becomes 7 cs and really plays at about 14.3 fps**.
That is the container's granularity rather than a rounding bug, and
`core/gifEncoder.test.ts` pins the centisecond values so it stays recorded.

**Two size estimates, at the two moments there is something to say.** Before the export, the
dialog shows `estimateGifBytes(width, height, frames)` — pixels × frames × ~0.3 bytes, crude by
construction, because nothing can know in advance how much of each frame changes. Once the loop
has written a frame, every progress report carries `estimatedBytes`: bytes actually written ÷
frames done × frames total, computed only from inside the loop where the divisor is at least one.
Both render through `utils/timeUtils`' `formatFileSize`, the formatter the media library uses, so
the whole app says "2.5 MB" the same way. **`ExportProgress.estimatedBytes` is optional and the two
video exporters never set it**, which is how the estimate reaches the dialog with no new plumbing
and no change to WebM's or MP4's progress.

**Past 30 seconds the dialog warns and never refuses** (`GIF_LONG_RANGE_SECONDS`,
`GIF_LONG_RANGE_WARNING`). It measures what will actually be encoded — the in/out section when
there is one, the timeline otherwise — and disables nothing. A long GIF is a legitimate thing to
want; it is just usually not what someone meant.

**Not in v1, deliberately:** audio (a GIF has none), dithering, a shared global palette,
transparency, looping controls (infinite is `gifenc`'s default and stays), and a worker-based
encoder — which would mean bundling a worker into the single-file and headless builds for a format
whose whole appeal is that it needs nothing.

**Per-frame ceilings:** `core/exportGIF.perf.test.ts`, the third of the trio, over the same
benchmark scene and split into frames by the same `openOutputFrame` marker as
`exportWebM.perf.test.ts` and `exportMP4.perf.test.ts`. Its own laws, asserted exactly: one
full-raster `getImageData` per frame, one encoded frame per read-back, one writer for the whole
export, one `getContext`, balanced `save`/`restore`, and **no `VideoFrame` created anywhere** —
that last is what would quietly break the no-WebCodecs browser if it ever moved.
```

- [ ] **Step 3: Amend "Export Resolution"** (2102) — one sentence, where the section enumerates the presets

Find the sentence *"A resolution preset no longer produces that case beyond sub-pixel rounding, because `getResolution` derives a preset's width from the **project's** aspect: preset height is fixed (1080/720/480)…"* and amend the parenthesis and add a clause:

```
… because `getResolution` derives a preset's width from the **project's** aspect: preset height is
fixed (1080/720/480, and since ESCSUITE-34 also 360 — which only the GIF format offers, see "GIF
Export"), width is round-to-even(height x project aspect), and `'project'` stays exact.
```

- [ ] **Step 4: Amend "Export Dialog Browser Support"** (2386) — a third bullet and a widened table

Add a third bullet after `isWebMExportSupported`'s:

```
- **`isGIFExportSupported()`** is a constant: it returns `true` (ESCSUITE-34). `gifenc` is pure
  JavaScript and a 2D canvas is the only browser capability the GIF pipeline uses, so there is
  nothing to probe — `exportGIF.ts` has no capability check at its door at all. It is a function
  rather than a `true` constant so the dialog reads all three formats' support the same way, and
  so a future reason to refuse has one place to live. **This is the third point of the asymmetry
  below, and the useful one**: in a browser with no WebCodecs, GIF is the one format still
  offered.
```

In the three-support-states table, replace the "Neither is possible" row and add the new one:

```
| Neither *video* format is possible (no WebCodecs at all) | `EXPORT_NO_WEBCODECS_REASON` **plus `GIF_ALWAYS_AVAILABLE_NOTE`** as one `role="alert"` row in the dialog's **main body**, not behind "Advanced options". Every WebM-flavoured button — primary **and** Advanced — stays on screen and `disabled`, the same say-why-do-not-hide shape ESCAPECRAFT's MP4/M4A buttons use; the **GIF radio stays enabled** and its Advanced button works, because GIF needs none of what is missing (ESCSUITE-34). The flag is called `noVideoFormatSupported` for that reason: it used to be `neitherFormatSupported`, which stopped being true |
| GIF is selected | The background-tab note is hidden (it is about the two video formats' decoders) and replaced by the two things a GIF surprises people with: it needs this tab visible, and it has no sound. The fps control and the GIF-only resolution list appear, with the size estimate beneath them |
```

And amend `effectiveAdvancedFormat`'s paragraph:

```
`effectiveAdvancedFormat` recomputes that same fallback
(`advancedOptions.format === 'gif' ? 'gif' : advancedOptions.format === 'mp4' && mp4Supported ? 'mp4' : 'webm'`)
and the button disables exactly when *that* format is blocked, with the blocking reason as its
`title`. **GIF short-circuits the fallback entirely** — it is always available, so nothing can
block it (ESCSUITE-34).
```

- [ ] **Step 5: Amend the "Testing" doubles paragraph** (~2675) — one clause, so the next reader knows where the real encoder is exercised

After the `mediabunny.ts` clause, add:

```
  `./gifEncoder` is the one *application* module that is mocked by name rather than a browser
  boundary (ESCSUITE-34): `exportGIF.test.ts` and `exportGIF.perf.test.ts` count `addFrame` calls
  through it, because the canvas double's `getImageData` answers a 1x1 frame whatever size it is
  asked for and the real quantiser would be reading past the end of it. The real `gifenc` is run
  by `core/gifEncoder.test.ts`, which is the only place it needs to be — so "tests never mock the
  module under test" still holds: the module under test there *is* the wrapper.
```

- [ ] **Step 6: The integration protocol comment** — `apps/artist/src/utils/integration.ts` line 336

```
 * - EXPORT_COMPLETE: { blob: Blob, format: 'mp4' | 'webm' | 'gif', name: string } - Export
 *   finished. `format` is also the file extension, and `name` the download filename
 *   (`<project name>.<format>`). A host that only knows the two video formats sees `'gif'` as a
 *   new value of an existing field (ESCSUITE-34); nothing else about the message changed.
```

- [ ] **Step 7: The two root `CLAUDE.md` lines**

Line **145**:

```
- Export formats: WebM (VP9+Opus), MP4 (H.264+AAC) and GIF (`gifenc`, 256 colours per frame, no
  audio, no WebCodecs — 10/15/20 fps, 720p/480p/360p; see `apps/artist/CLAUDE.md`'s "GIF Export")
```

Line **173**:

```
  init, and `EXPORT_COMPLETE` with `{ blob: Blob, format: 'mp4' | 'webm' | 'gif', name: string }`
  after a successful export (`name` is the download filename; not sent on failure or
  cancellation). `'gif'` is additive (ESCSUITE-34): a host that handles the two video formats sees
  a new value of a field it already reads, and needs no change unless it wants to treat a GIF
  differently.
```

- [ ] **Step 8: The two changesets**

`.changeset/escsuite-34-artist-gif-export.md`:

```markdown
---
'@escapesuite/artist': minor
---

Export a GIF: 10/15/20 fps, 720p/480p/360p, a live size estimate, and the section you have in/out points on

GIF is now a third choice under Export → Advanced options, beside WebM and MP4. Pick a frame rate
(10, 15 or 20 — a GIF's size goes up roughly in step with its frame count) and a size (720p, 480p
or 360p, all following your project's own shape), and if you have in and out points set, "Export
Section" makes a GIF of just that part, exactly as it does for a video.

You get a size estimate before you start and a real one, counted from the bytes actually written,
while it runs — which is the number you want when you are deciding whether a clip is short enough
to paste into a chat. Past thirty seconds there is a note suggesting WebM instead; it is only a
note, and nothing stops you.

A GIF has no sound, and it needs the tab to stay visible while it encodes. But it needs nothing
else: GIF export does not use WebCodecs at all, so it is the one format that works in a browser
where WebM and MP4 cannot be exported — and in that browser the dialog now says so instead of
telling you there is nothing you can do.
```

`.changeset/escsuite-34-headless-gif-export.md`:

```markdown
---
'@escapesuite/headless-artist': minor
---

Render a job as an animated GIF

`options.format` now takes `"gif"` alongside `"mp4"` and `"webm"`, with a new `options.fps`
(`10`, `15` by default, or `20`) and a new `options.resolution` of `"360p"`. The output is written,
delivered and hashed exactly like a video — `<jobId>.gif` through the volume sink, `image/gif`
through S3 and the webhook, and a manifest whose `format` says `gif`.

`options.fps` applies to GIF only and a job that sets it on an MP4 or WebM render is rejected
before Chromium launches, rather than quietly encoding at 30. Note that a GIF stores each frame's
delay in hundredths of a second, so 10 and 20 fps are exact while 15 fps plays at about 14.3.
```

- [ ] **Step 9: Verify the documentation**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
# Exactly two hunks in the root file, and neither in the coverage section.
git diff CLAUDE.md
# Nothing left claiming two formats.
grep -n "Two export paths\|'mp4' | 'webm'" apps/artist/CLAUDE.md apps/artist/src/utils/integration.ts CLAUDE.md
grep -rn "WebM (VP9+Opus) and MP4" . --include='*.md'
# And the suite still passes — a documentation task should not move it.
pnpm --filter @escapesuite/artist exec vitest run
pnpm --filter @escapesuite/artist exec tsc -b --noEmit
pnpm --filter @escapesuite/artist exec eslint .
```

The two `grep`s should find nothing but the places where the old wording is being *quoted* historically. `ESCAPE-SUITE-DOCUMENTATION.md` also lists ESCAPEARTIST's features — check it (`grep -n "WebM\|MP4" ESCAPE-SUITE-DOCUMENTATION.md`) and add GIF to the export bullet if there is one. Report what you found either way.

- [ ] **Step 10: Commit**

```bash
cd /Users/littlemac/Projects/ESCAPESUITE-e34
git add apps/artist/CLAUDE.md apps/artist/src/utils/integration.ts CLAUDE.md \
        .changeset/escsuite-34-artist-gif-export.md \
        .changeset/escsuite-34-headless-gif-export.md
# plus ESCAPE-SUITE-DOCUMENTATION.md if it needed the GIF bullet
git commit -m "$(cat <<'MSG'
docs(artist): GIF export, and the three things it does differently (ESCSUITE-34)

A new "GIF Export" section in the app's CLAUDE.md, and the four existing
sections that stopped being accurate when a third format landed.

What the section is actually for is the three places GIF is not just "WebM with
a different encoder". It needs no WebCodecs, which is why `exportGIF.ts` has no
capability check at its door at all and why `isGIFExportSupported()` is a
constant — and why a browser that can export neither video format is now told
what it *can* do instead of being told there is nothing. It reads the whole
raster back every frame, which is why the canvas is `willReadFrequently` and why
`getImageData` is deliberately called under the output transform (it reads
device pixels and ignores the matrix, so the encoder sees the full raster
including any letterbox bar). And it stores each frame's delay in centiseconds,
so a "15 fps" GIF plays at about 14.3 — the container's granularity, recorded
here and pinned in `gifEncoder.test.ts` rather than left to be rediscovered.

Also written down: that `core/elementFrames.ts` is `exportWebM.ts`'s own
per-frame code lifted rather than copied, and that `exportMP4.ts` is
deliberately not a caller because it draws decoded `VideoFrame`s; that
`ExportProgress.estimatedBytes` is optional and the two video exporters never
set it, which is how the live estimate reaches the dialog with no new plumbing;
that `./gifEncoder` is the one application module mocked by name, with the
reason (the canvas double's `getImageData` answers 1x1 whatever it is asked
for) and where the real package is exercised instead; and the five things v1
leaves out on purpose, so each is read as a decision rather than an omission.

Two lines in the root CLAUDE.md — the export-formats bullet and
`EXPORT_COMPLETE`'s payload — plus the integration protocol comment in
`utils/integration.ts`, all three saying the same thing: `'gif'` is a new value
of a field hosts already read, and an existing host needs no change.

Two changesets, both minor: a feature in each package.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
MSG
)"
```

---

## Self-review against the spec

Every requirement in `docs/superpowers/specs/2026-10-01-gif-export-design.md`, and the task that delivers it:

| Spec requirement | Task |
|---|---|
| `gifenc` as the encoder, one new runtime dependency | 1 |
| `GIFEncoder` / `quantize` / `applyPalette` / `writeFrame` / `finish` / `bytes` | 1 (verified against the real package) |
| Runs on the main thread inside the export loop | 3 |
| No worker-based encoder (non-goal) | 1 — stated in the module header and in Task 6's section |
| Shared machinery extracted, not copied; same calls in the same order | 2 |
| WebM and MP4 perf ceilings byte-identical | 2 (`git diff --stat`), re-checked in 3 |
| `core/exportGIF.ts` reusing the output canvas, `openOutputFrame`, `syncVideoToTime`, the track-ordered draw loop, transitions | 3 |
| `getImageData` → `quantize` → `applyPalette` → `writeFrame(delay = round(1000/fps))` | 3 (the delay) + 1 (the three calls) |
| Reads `timeRange`, so "Export Section" works unchanged | 3 (test) + 4 (the dialog passes it) |
| fps 10/15/20, default 15 | 3 (`gifFrameRate`) + 4 (the control) |
| Resolutions 720p/480p/360p, default 480p; `'360p'` added to the type, GIF-only | 3 (`getResolution`, `resolutionForFormat`) + 4 (the list) |
| `getResolution` rescale path (ESCSUITE-94) applies | 3 — the exporter calls `getResolution` and `openOutputFrame` exactly as WebM does |
| Same `onProgress` shape, plus a live size estimate in the dialog | 3 (`estimatedBytes`) + 4 (the row) |
| Heuristic estimate before it starts (pixels × frames × ~0.3) | 3 (`estimateGifBytes`) + 4 (the line) |
| Soft warning above 30 s, never a refusal | 3 (the constants) + 4 (the line, with a test that the button stays enabled) |
| Errors wrap in `ExportError` with the export log | 3 |
| Abort between frames (ESCSUITE-98 run identity) | 3 (exporter) + 4 (the dialog's Cancel test) |
| Format radio "GIF" beside WebM and MP4 | 4 |
| Selecting it shows fps and the GIF presets, hides the codec-specific notes | 4 |
| `ExportOptions['format']` widens to three | 3 |
| ESCSUITE-22 probe treats GIF as always supported; the no-WebCodecs sentence says so | 3 (`isGIFExportSupported`, `GIF_ALWAYS_AVAILABLE_NOTE`) + 4 |
| `EXPORT_COMPLETE` posts `format: 'gif'`; file name `${projectName}.gif` | 4 |
| Kit: `FORMATS` + `'gif'`, `RESOLUTIONS` + `'360p'`, `gif`/`image/gif` in the sink maps | 5 |
| Kit: `parseOptions` accepts `fps` for GIF, rejects it otherwise | 5 |
| Kit: job-spec docs and README name the format | 5 |
| Kit: one Chromium parity case rendering a GIF | 5 (written) + Controller C3 (run) |
| `core/exportGIF.test.ts` — frames and delays, `finish` once, range, abort, `ExportError` | 3 |
| `core/exportGIF.perf.test.ts` — one `getImageData`, one quantise, one `writeFrame`, balanced save/restore, one `getContext`, dated ceilings | 3 |
| `ExportDialog.test.tsx` — radio, fps, presets, estimate, 30 s warning, no-WebCodecs leaves GIF enabled, `EXPORT_COMPLETE` with `'gif'` | 4 |
| Kit `jobSpec.test.ts` for the new format / fps / 360p | 5 |
| `apps/artist/CLAUDE.md` export section; root export-formats line; the integration comment; kit README and job-spec docs | 5 (README) + 6 (the rest) |
| Changesets: artist **minor**, headless-artist **minor** | 6 |

**Three places this plan decides something the spec left open**, each argued at the task that makes the call: the progress field is `progress` not `percent` (the code's name); GIF's resolution list excludes `project` and `1080p` and switching format moves the selection; and the headless validator accepts `360p` for every format while the dialog offers it for GIF only — a divergence between "what works" and "what we offer", stated as such in Task 5 and in the kit README.

**Nothing in this plan contains a placeholder**, a `TODO`, or a value to be filled in later, with one deliberate exception that is a *measurement* rather than a placeholder: Task 3 Step 13's three GIF per-frame ceilings, which the repo's own rule requires to be 2× an actual measurement. The step gives the derivation (26 calls per frame, from `exportWebM.perf.test.ts`'s measured 25 plus one `getImageData`), the expected ceiling (52), the command that measures it, and the instruction to write the measured figure and the date into the comment — and it names the assertions in that file that must **not** be relaxed to make it pass.
