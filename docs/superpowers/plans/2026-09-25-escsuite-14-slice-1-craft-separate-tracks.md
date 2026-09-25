# ESCSUITE-14 slice 1 — CRAFT records the webcam as a separate track

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an opt-in "Record webcam as a separate track" mode in ESCAPECRAFT that records a screen+webcam take as **two frame-aligned WebM files from one recorder, two `VideoEncoder`s and two Mediabunny outputs off the one recording clock**, stores them as two `SourceVideo`s sharing a `takeId`, and shows them in the library as a primary row with its webcam companion directly underneath.

**Architecture:** One `WebCodecsRecorder` instance grows a second video pipeline (encoder + `Output` + `MediaStreamTrackProcessor` reader) for the webcam track. Both pipelines are stamped by the same private `nextFrameTiming()` from the same `startTime`/`pausedDuration`, so alignment is a shared-clock property rather than a measurement; each pipeline keeps its **own** strictly-increasing guard and keyframe schedule, because each encoder is fed its own presentation timeline. `recorder-factory.ts` gains a `separateTracks` input that lets a PiP take reach WebCodecs (composited PiP stays on MediaRecorder, untouched); `useRecordingController` runs the compositor **preview-only** in the new mode and hands the recorder the raw screen and raw webcam tracks; `useRecordingSave` writes two `storeVideo` + two `storeThumbnail` records; `loadRecordings` groups by `takeId`.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand, WebCodecs (`VideoEncoder`, `MediaStreamTrackProcessor`), Mediabunny (`WebMOutputFormat`, `EncodedVideoPacketSource`), shared IndexedDB (`video-editor-db`, `DB_VERSION` stays 1), Vitest + Testing Library (jsdom) with `src/test/doubles/*`, Playwright (Chromium) for e2e and benchmarks.

**Spec:** `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md` — in particular "Decisions" (1, 2, 5, 6), "Consequences the decisions fix in the design" and the "Estimate, revised for the decisions" row for slice 1. Read it before Task 1; every design choice below is argued from it.

**Out of scope (named in the spec, later slices — do not build any of it here):** ARTIST sibling resolution and clip placement (slice 2), mic/system audio companions (slice 3), composite MP4/M4A and `UPLOAD_RECORDING.parts` (slice 4). In slice 1 the mixed audio stays on the **screen (primary)** output exactly as today and the webcam output has **no audio track**.

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure quoted in the commit or step notes, before the implementation step. Steps below are ordered that way; do not reorder them.
2. **Pure moves are byte-unchanged in every existing test at that commit.** Task 4 is a pure move: `git diff --stat` at that commit must show **no** changes under `src/**/*.test.ts(x)`.
3. **No existing test may be deleted or weakened.** The pinned suites stay green and untouched: `src/App.rerender.test.tsx`, `src/App.mp4rerender.test.tsx`, `src/core/compositor.perf.test.ts`, `src/core/recorder.perf.test.ts`, `apps/e2e/tests/escapecraft/pip-seekable.spec.ts`, `apps/e2e/tests/production/pip-seekable.spec.ts`, and the `craft-pip-recording` / `craft-screen-recording` tripwires in `apps/e2e/utils/craftPerf.ts`. Three existing test files gain *inputs* (never looser assertions) and each change is named in the task that makes it: `src/utils/recordingMetadata.test.ts` (three `buildSourceVideo` calls gain `hasWebcam`), `src/test/appHarness.tsx` (one store field), `src/test/doubles/recorder.ts` + `src/test/doubles/mediastream.ts` (doubles gain capability).
4. **Coverage floors only go up, and craft's lines floor is 100.00 with zero headroom** — every new line must execute in a test. Finish with `pnpm --filter @escapesuite/craft test:coverage`; if a figure rises past a whole percent, raise the floor in `apps/craft/vite.config.ts` **and** `scripts/coverage-report.mjs` and update the root `CLAUDE.md` coverage table. Never lower one.
5. **Per-frame ceilings:** conservation laws exact (frames created == closed, one `encode` per captured frame **per encoder**, one `flush` per encoder, two `finalize`s); every other count is 2× the measured value rounded up, with the measured value and the date in a comment beside it.
6. **`App.rerender.test.tsx` selector contract:** no new `App`-level store selector for anything a leaf can subscribe to. The toggle's storage-headroom gate is subscribed in a new self-subscribing leaf, `WebcamOverlaySettingsPanel`, exactly as `SourceTogglesPanel` owns `audioLevels`.
7. **New modules go in `src/utils`, `src/hooks`, `src/components`, `src/core`** — never into a module some suite `vi.mock`s wholesale. `src/core/thumbnailGenerator.ts` and `src/core/converter.ts` are mocked wholesale by five suites; put nothing new in them.
8. **Type-only declarations go in `src/store/types.ts`** (craft) or `packages/shared/src/types/index.ts` (shared). Both are excluded from craft's coverage `include`/counted as interfaces; a *new* type-only module would report 0% and break the 100 lines floor.
9. **Copy is pinned by tests.** Every user-visible string below is exact; do not paraphrase in code or in tests.
10. **`DB_VERSION` stays 1.** Every new `SourceVideo` field is optional, and a take recorded in the default composited mode is stored exactly as it is today except for the one new truthful `hasWebcam` flag (Task 1 argues that deviation).
11. **Typecheck and lint every task:** `pnpm --filter @escapesuite/craft typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/craft lint`; for e2e work `pnpm --filter @escapesuite/e2e typecheck` and `pnpm --filter @escapesuite/e2e lint`.
12. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

13. Branch `feat/craft-separate-tracks` off `main`. No push and no PR unless asked.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/craft/src/core/webcodecsSupport.ts` | The two synchronous capability questions — `isWebCodecsRecordingSupported()` (moved verbatim out of `webcodecs-recorder.ts`) and `canRecordSeparateTracks()`. Imports nothing, so a component may ask without pulling `mediabunny` into its module graph |
| `apps/craft/src/utils/separateTracksReadiness.ts` | `separateTracksBlockedReason()` and the two sentences it can return. The mirror of `utils/recordReadiness.ts`: a pure gate, with its reasons beside it |
| `apps/craft/src/utils/takeOrder.ts` | `orderTakes()` — newest take first, each take's companion rows directly under their primary. Pure over the list, so the ordering is tested without storage |
| `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.tsx` | The overlay panel's one subscription (`hasSeparateTracksSpace`) and the blocked reason it computes, so `App` gains no selector |
| `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` | Chromium e2e: a real separate-tracks take, two blobs in IndexedDB with a shared `takeId`, both loading with a finite duration, and the two library rows |

**Modified**

| File | Change |
|---|---|
| `packages/shared/src/types/index.ts` | `RecordingRole`, `OverlayPlacement`; `SourceVideo` gains `takeId`, `role`, `startOffset`, `overlayPlacement`, `hasWebcam` (all optional) |
| `apps/craft/src/store/types.ts` | Re-export the two new shared types; `CompanionPart`, `RecorderStopCallback`; `RecordingConfig.separateTracks`; `Recording.takeId`/`role`; `RecorderStore.hasSeparateTracksSpace` |
| `apps/craft/src/utils/recordingMetadata.ts` | Both builders carry the new fields; the webcam half is named after its take |
| `apps/craft/src/hooks/useRecordingSave.ts` | Two-part save: two `storeVideo`, two `storeThumbnail`, two list entries |
| `apps/craft/src/store/recorderStore.ts` | `loadRecordings` reads the new fields, fixes `hasWebcam`, orders through `orderTakes`; `refreshStorageSpace` measures the double-bitrate headroom too |
| `apps/craft/src/core/webcodecs-recorder.ts` | Per-pipeline `FrameTiming`, extracted output/encoder/capture helpers, the webcam pipeline, two-blob `stop()` |
| `apps/craft/src/core/recorder.ts` | One type change: `onStop` is the shared `RecorderStopCallback` |
| `apps/craft/src/core/recorder-factory.ts` | `separateTracks` as the third input to all three functions |
| `apps/craft/src/core/compositor.ts` | `startPreviewOnly()` beside `start()`, over a shared private `beginRender()` |
| `apps/craft/src/hooks/useRecordingController.ts` | Resolve the mode once; preview-only compositor; raw tracks to the recorder; companion through to the save |
| `apps/craft/src/hooks/useRecordingLibrary.ts` | Deleting a primary deletes its companions |
| `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx` | The toggle, its help text and its visible reason |
| `apps/craft/src/components/RecordingsList/RecordingsList.tsx` | Companion rows: label, no MP4/M4A, editor sends the take; the primary's interim note |
| `apps/craft/src/components/RecordingsList/RecordingsListPanel.tsx` | Upload carries `role` and `takeId` |
| `apps/craft/src/utils/uploadToHost.ts` | Optional third argument added to the payload |
| `apps/craft/src/App.tsx` | Renders `WebcamOverlaySettingsPanel` |
| `apps/craft/src/test/doubles/mediastream.ts` | The track-processor double serves one queue **per** processor |
| `apps/craft/src/test/doubles/recorder.ts` | The factory double records `separateTracks`; `stop()` can deliver a companion |
| `apps/craft/src/test/appHarness.tsx` | `hasSeparateTracksSpace: true` |
| `apps/craft/src/core/webcodecsRecorder.perf.test.ts` | A separate-tracks ceiling suite |
| `apps/e2e/utils/craftPerf.ts` | Per-encoder frame attribution, the third arm's tripwires, the toggle click |
| `apps/e2e/tests/perf/craft-recording.spec.ts` | The `craft-separate-tracks-recording` arm |
| `apps/e2e/scripts/perf-report.mjs` | `ORDER` + two `METRICS` entries |
| `docs/performance/2026-09-17-craft-baseline.md` | The fourth benchmark and its first numbers |
| `apps/craft/CLAUDE.md`, `CLAUDE.md`, `.changeset/craft-separate-tracks.md` | Documentation and release note |

---

### Task 1: Storage model — shared types and the two record builders

**Files:**
- Modify: `packages/shared/src/types/index.ts:1-40`
- Modify: `apps/craft/src/store/types.ts:1-31` and `:114-189`
- Modify: `apps/craft/src/utils/recordingMetadata.ts` (whole file)
- Test: `apps/craft/src/utils/recordingMetadata.test.ts`

**Interfaces:**
- Produces (shared): `RecordingRole = 'screen' | 'webcam' | 'mic' | 'system'`; `OverlayPlacement { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size: number; shape: 'circle' | 'rectangle' }`; `SourceVideo` + `takeId?: string`, `role?: RecordingRole`, `startOffset?: number`, `overlayPlacement?: OverlayPlacement`, `hasWebcam?: boolean`.
- Produces (craft): `RecordingConfig.separateTracks: boolean` (required in the config, `false` in `defaultConfig`); `Recording.takeId?: string`, `Recording.role?: RecordingRole`; `CompanionPart { role: 'webcam'; blob: Blob; startOffset: number }`; `RecorderStopCallback = (blob: Blob, companion?: CompanionPart | null) => void`.
- Produces: `buildSourceVideo(input: BuildSourceVideoInput): SourceVideo` where `BuildSourceVideoInput` gains required `hasWebcam: boolean` and optional `takeId`, `role`, `startOffset`, `overlayPlacement`; `buildRecordingEntry` whose `sourceVideo` is now `Pick<SourceVideo, 'id' | 'name' | 'duration' | 'takeId' | 'role'>`.

**Two decisions this task pins, both argued in the commit message:**

- **`takeId` is the primary's own id.** A take is named by its screen part, so a companion take is `{ primary.takeId === primary.id, companion.takeId === primary.id }`. No extra identifier, grouping is a single equality, and "delete the primary, delete its companions" is `r.takeId === deletedId`.
- **`hasWebcam` is a new stored field, and it is the only way the `hasWebcam: false // TODO` in `loadRecordings` can be fixed.** Nothing stored today says whether a take had a camera in it. This is the exact shape ESCSUITE-60 used for `hasAudio` — written by `buildSourceVideo` from the config, read back as `m.hasWebcam ?? false`. It is written for *every* take, composited PiP included, which is a hair's-breadth departure from the spec's "a fallback take is byte-for-byte a pre-feature take" (§6): that sentence is about the take's *mode* — MediaRecorder, `fixWebMMetadata`, one blob, no companion — all of which stay true. Nothing is gated on `hasWebcam`, so `?? false` costs a legacy row nothing.

- [ ] **Step 1: Write the failing tests** — append to `apps/craft/src/utils/recordingMetadata.test.ts`

```ts
describe('buildSourceVideo for a separate-tracks take', () => {
  const placement = { position: 'bottom-right', size: 0.2, shape: 'circle' } as const

  it('writes takeId, role, startOffset and the overlay placement on the primary', () => {
    const sourceVideo = buildSourceVideo({
      id: 'take-1',
      now: 0,
      blob: new Blob(['screen'], { type: 'video/webm' }),
      duration: 6,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasWebcam: true,
      takeId: 'take-1',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: placement,
    })

    // The take is named by its primary, so the primary's takeId is its own id.
    expect(sourceVideo).toMatchObject({
      takeId: 'take-1',
      role: 'screen',
      startOffset: 0,
      overlayPlacement: placement,
      hasWebcam: true,
    })
  })

  it('names the webcam half after its take and carries no overlay placement', () => {
    const now = 1_700_000_000_000
    const sourceVideo = buildSourceVideo({
      id: 'part-2',
      now,
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      duration: 6,
      width: 640,
      height: 480,
      // Slice 1: the mixed audio stays on the primary, so the webcam half is
      // silent and must be stored as such — its M4A button is never offered,
      // and ARTIST will read this back in slice 2.
      hasAudio: false,
      hasWebcam: true,
      takeId: 'take-1',
      role: 'webcam',
      startOffset: 0,
    })

    expect(sourceVideo.name).toBe(`Recording ${new Date(now).toLocaleString()} — webcam`)
    expect(sourceVideo.hasAudio).toBe(false)
    expect('overlayPlacement' in sourceVideo).toBe(false)
  })

  it('leaves a plain take with no companion fields at all', () => {
    const sourceVideo = buildSourceVideo({
      id: 'r',
      now: 0,
      blob: new Blob(),
      duration: 1,
      width: 1,
      height: 1,
      hasAudio: true,
      hasWebcam: false,
    })

    // Absent keys rather than `undefined` ones: a reader (ARTIST, slice 2) must
    // not have to tell a real absence from a written undefined, and this is
    // what keeps a composited take's stored record what it has always been.
    expect('takeId' in sourceVideo).toBe(false)
    expect('role' in sourceVideo).toBe(false)
    expect('startOffset' in sourceVideo).toBe(false)
    expect('overlayPlacement' in sourceVideo).toBe(false)
    expect(sourceVideo.hasWebcam).toBe(false)
  })
})

describe('buildRecordingEntry for a separate-tracks take', () => {
  it('carries takeId and role from the stored record onto the list entry', () => {
    const entry = buildRecordingEntry({
      sourceVideo: {
        id: 'part-2',
        name: 'Recording 1/1/2026 — webcam',
        duration: 42,
        takeId: 'take-1',
        role: 'webcam',
      },
      now: 123,
      size: 456,
      thumbnailUrl: 'blob:thumb',
      config: { webcamEnabled: true },
      hasAudio: false,
    })

    // The library groups and labels from the list entry, so both facts have to
    // survive the trip out of storage and into memory.
    expect(entry).toMatchObject({ takeId: 'take-1', role: 'webcam' })
  })
})
```

- [ ] **Step 2: Add `hasWebcam` to the three existing `buildSourceVideo` calls in that file**

In `apps/craft/src/utils/recordingMetadata.test.ts`, the three existing `buildSourceVideo({...})` inputs (`rec-1`, `rec-3`, `rec-2`) each gain one line — `hasWebcam: false,` — and the first test's exact `toEqual({...})` gains `hasWebcam: false,` after `hasAudio: true,`. Nothing else in the file changes: no assertion is removed or loosened.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/recordingMetadata.test.ts`
Expected: FAIL — `Object literal may not specify... ` is a typecheck-only error, so at runtime the failures are `expected undefined to be 'take-1'` (`toMatchObject` on `takeId`) and `expected 'Recording …' to be 'Recording … — webcam'`.

- [ ] **Step 4: Add the shared types**

In `packages/shared/src/types/index.ts`, above `SourceVideo`:

```ts
/**
 * Which capture one stored part of a take came from.
 *
 * A take used to be exactly one file, so nothing needed saying. A
 * separate-tracks take (ESCSUITE-14) is several files sharing a `takeId`, and
 * this is what tells the screen half from the webcam half. `'mic'` and
 * `'system'` are here because the audio companions (slice 3) will use them and
 * a reader written now should not have to be widened then.
 */
export type RecordingRole = 'screen' | 'webcam' | 'mic' | 'system'

/**
 * Where the webcam overlay sat while a take was recorded — written on the
 * take's primary part only.
 *
 * It is stored because the picture no longer carries it: a composited take has
 * the camera burned into the frame, while a separate-tracks take has it in a
 * second file that has to be put back somewhere. ESCAPEARTIST seeds the webcam
 * clip's transform from this (slice 2) and CRAFT's composite MP4 draws through
 * it (slice 4).
 *
 * The unions are spelled out here rather than imported from ESCAPECRAFT's
 * `WebcamPosition`/`WebcamShape`: this package is shared and must not depend on
 * an app. They are structurally identical, which is what lets the recorder hand
 * its config values straight over.
 */
export interface OverlayPlacement {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Fraction of the frame's width the overlay occupied, 0.1–0.4. */
  size: number
  shape: 'circle' | 'rectangle'
}
```

and inside `SourceVideo`, after `hasAudio?: boolean`:

```ts
  /**
   * The take this file is one part of. Absent on a single-file take, which is
   * every recording made before ESCSUITE-14 and every composited PiP take
   * after it. The take's primary part carries its own id here, so grouping is
   * `part.takeId === primary.id` and nothing needs a second identifier.
   */
  takeId?: string
  /** Which half of the take this is. Absent whenever `takeId` is. */
  role?: RecordingRole
  /** Seconds after the take's start at which this part's first frame was captured. */
  startOffset?: number
  /** Primary part only: where the webcam overlay sat while recording. */
  overlayPlacement?: OverlayPlacement
  /**
   * Whether the take captured the webcam at all. Written since ESCSUITE-14 the
   * way `hasAudio` has been written since ESCSUITE-60; a recording stored
   * before it has no field and is read back as `false`, which is the answer it
   * has always been given.
   */
  hasWebcam?: boolean
```

- [ ] **Step 5: Add the craft-side types**

In `apps/craft/src/store/types.ts`, extend the re-export at the top and add the rest:

```ts
// Types shared with ESCAPEARTIST - imported from shared package
export type {
  MediaType,
  MediaSource,
  SourceVideo,
  RecordingRole,
  OverlayPlacement,
} from '@escapesuite/shared/types'

import type { RecordingRole } from '@escapesuite/shared/types'
```

```ts
/**
 * The second blob a separate-tracks take produces, handed to the save path by
 * the recorder's `onStop`.
 *
 * `startOffset` is 0 in slice 1 and is carried anyway: both parts are stamped
 * from one clock by one `start()`, so "the webcam begins where the screen
 * does" is a fact worth writing down rather than one to rediscover when the
 * audio companions (slice 3) start later than the video.
 */
export interface CompanionPart {
  role: 'webcam';
  blob: Blob;
  startOffset: number;
}

/**
 * What a recorder calls when a take is finished.
 *
 * Both recorders declare this signature even though only `WebCodecsRecorder`
 * ever passes a companion: one type means the controller's single `onStop` is
 * assignable to either recorder's callbacks, with no union narrowing at the
 * call site. `Recorder` (MediaRecorder) calls it with the blob alone.
 */
export type RecorderStopCallback = (blob: Blob, companion?: CompanionPart | null) => void;
```

In `RecordingConfig`, after `webcamShape`:

```ts
  /**
   * Record the webcam as its own file instead of compositing it into the
   * screen (ESCSUITE-14). Off by default; only ever true for a screen+webcam
   * take in a browser with WebCodecs and room for two tracks.
   */
  separateTracks: boolean;
```

In `defaultConfig`, after `webcamShape: 'circle',`: `separateTracks: false,`.

In `Recording`, after `hasAudio: boolean;`:

```ts
  /** The take this row belongs to; absent on a single-file take. */
  takeId?: string;
  /** Which half of the take this row is; absent on a single-file take. */
  role?: RecordingRole;
```

In `RecorderStore`, after `hasStorageSpace: boolean;`:

```ts
  /**
   * Whether there is room for a take at roughly double the bitrate — the
   * separate-tracks toggle's second gate. Measured beside `hasStorageSpace`,
   * off the click path, by the same `refreshStorageSpace()`.
   */
  hasSeparateTracksSpace: boolean;
```

- [ ] **Step 6: Implement the builders**

Replace `apps/craft/src/utils/recordingMetadata.ts`'s two functions with:

```ts
import type {
  SourceVideo,
  Recording,
  RecordingConfig,
  RecordingRole,
  OverlayPlacement,
} from '../store/types';

export interface BuildSourceVideoInput {
  id: string;
  now: number;
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  /**
   * Whether the take captured any audio. Computed once by the caller and
   * handed to `buildRecordingEntry` as well, so the stored metadata and the
   * list entry cannot disagree — see `useRecordingSave`, which owns the one
   * expression.
   */
  hasAudio: boolean;
  /**
   * Whether the take captured the webcam. Required, like `hasAudio`: this is
   * the only record of it that survives a reload, and `loadRecordings` read a
   * hard-coded `false` until ESCSUITE-14.
   */
  hasWebcam: boolean;
  /** Set on both parts of a separate-tracks take; the primary's own id. */
  takeId?: string;
  /** Which half of the take this record is. Absent whenever `takeId` is. */
  role?: RecordingRole;
  /** Seconds after the take's start at which this part begins. */
  startOffset?: number;
  /** Primary only: the overlay geometry the take was recorded with. */
  overlayPlacement?: OverlayPlacement;
}

/** The SourceVideo metadata written to storage alongside a finished recording's blob. */
export function buildSourceVideo({
  id,
  now,
  blob,
  duration,
  width,
  height,
  hasAudio,
  hasWebcam,
  takeId,
  role,
  startOffset,
  overlayPlacement,
}: BuildSourceVideoInput): SourceVideo {
  const takeName = `Recording ${new Date(now).toLocaleString()}`;
  return {
    id,
    // Both parts of a take are saved with the same `now`, so the webcam half's
    // name is the take's name with its half named — which is what its own WebM
    // download is called and what ARTIST will show as the source's name.
    name: role === 'webcam' ? `${takeName} — webcam` : takeName,
    duration,
    width,
    height,
    frameRate: 30,
    mimeType: blob.type,
    size: blob.size,
    mediaType: 'video',
    source: 'recording',
    recordedAt: now,
    // The list entry's `hasAudio` only lives as long as the tab. This is the
    // copy a reload reads back, and the M4A button is gated on it — see
    // `loadRecordings` in `store/recorderStore.ts`.
    hasAudio,
    hasWebcam,
    // Spread rather than assign: a take with no companion is stored with no
    // companion keys at all, so its record is what it was before ESCSUITE-14
    // and a reader cannot mistake a written `undefined` for a real absence.
    ...(takeId !== undefined ? { takeId } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(overlayPlacement !== undefined ? { overlayPlacement } : {}),
  };
}

export interface BuildRecordingEntryInput {
  sourceVideo: Pick<SourceVideo, 'id' | 'name' | 'duration' | 'takeId' | 'role'>;
  now: number;
  size: number;
  thumbnailUrl: string;
  config: Pick<RecordingConfig, 'webcamEnabled'>;
  /**
   * Whether the take captured any audio — the same value `buildSourceVideo`
   * was given. Passed in rather than derived from the config here, because the
   * config cannot answer it: ticking "System Audio" only *asks* for it, and
   * the browser's share dialog has the last word (ESCSUITE-62).
   */
  hasAudio: boolean;
}

/** The recorder's own Recording list entry for a finished recording. */
export function buildRecordingEntry({
  sourceVideo,
  now,
  size,
  thumbnailUrl,
  config,
  hasAudio,
}: BuildRecordingEntryInput): Recording {
  return {
    id: sourceVideo.id,
    name: sourceVideo.name,
    duration: sourceVideo.duration,
    createdAt: now,
    size,
    thumbnailUrl,
    hasWebcam: config.webcamEnabled,
    hasAudio,
    // Same rule as the stored record: absent on a single-file take, so the
    // library's grouping sees nothing to group.
    ...(sourceVideo.takeId !== undefined ? { takeId: sourceVideo.takeId } : {}),
    ...(sourceVideo.role !== undefined ? { role: sourceVideo.role } : {}),
  };
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/recordingMetadata.test.ts`
Expected: PASS (all tests in the file).

Run: `pnpm --filter @escapesuite/craft typecheck`
Expected: FAIL — `useRecordingSave.ts` does not yet pass `hasWebcam`, and `defaultConfig` consumers are fine. Fix only `useRecordingSave.ts`'s single `buildSourceVideo` call by adding `hasWebcam: config.webcamEnabled,` next to `hasAudio,`. Re-run: no output, exit 0.

Run: `pnpm --filter @escapesuite/shared test:run && pnpm --filter @escapesuite/craft exec vitest run src/store src/utils`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/index.ts apps/craft/src/store/types.ts \
  apps/craft/src/utils/recordingMetadata.ts apps/craft/src/utils/recordingMetadata.test.ts \
  apps/craft/src/hooks/useRecordingSave.ts
git commit -m "$(cat <<'EOF'
feat(craft): a stored take can be several parts sharing a takeId (ESCSUITE-14)

SourceVideo gains takeId, role, startOffset and overlayPlacement — all
optional, so DB_VERSION stays 1 and a take stored before this keeps behaving
as a single-file take. The take is named by its primary part: the primary's
takeId is its own id, so grouping a companion to it is one equality and
deleting a take is `takeId === deletedId`.

hasWebcam joins them because `loadRecordings` had no way to answer it —
`hasWebcam: false // TODO` was a known lie since nothing stored said whether a
take had a camera in it. Written from the config exactly as hasAudio has been
since ESCSUITE-60, read back as `?? false` for records saved before the field.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 2: The save path writes two parts

**Files:**
- Modify: `apps/craft/src/hooks/useRecordingSave.ts:32-143`
- Test: `apps/craft/src/hooks/useRecordingSave.test.ts`

**Interfaces:**
- Consumes: `buildSourceVideo` / `buildRecordingEntry` (Task 1), `CompanionPart` (Task 1).
- Produces: `SaveRecording = (rawBlob: Blob, recordedDuration: number, companion?: CompanionPart | null) => Promise<void>` — Task 7's controller calls it with the recorder's companion.

**The rules this task pins:**
- The companion is stored with its **own** id, `takeId` = the primary's id, `role: 'webcam'`, `startOffset` from the recorder, and `hasAudio: false` (slice 1 keeps the mix on the primary).
- The companion's thumbnail is generated **from its own blob**: the pre-captured preview frame is the *composited* picture, which is not the webcam alone.
- The companion is added to the list **first**, because `addRecording` prepends — adding it second would leave the webcam row above its own primary.
- Only the primary is ever repaired. A companion exists only in the WebCodecs mode, whose output needs no repair, and `recorderTypeRef` says `'webcodecs'` for that take.

- [ ] **Step 1: Write the failing tests** — append to `apps/craft/src/hooks/useRecordingSave.test.ts`

```ts
describe('useRecordingSave for a separate-tracks take', () => {
  const COMPANION = new Blob(['webcam-bytes'], { type: 'video/webm' })

  /** What the WebCodecs recorder hands over as the take's second half. */
  const companionPart = { role: 'webcam' as const, blob: COMPANION, startOffset: 0 }

  it('stores both parts under one takeId, the placement on the primary only', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({
      webcamEnabled: true,
      separateTracks: true,
      webcamPosition: 'top-left',
      webcamSize: 0.3,
      webcamShape: 'rectangle',
    })

    await result.current(RAW, 6, companionPart)

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(2)
    const primary = stored.find(m => m.role === 'screen')!
    const webcam = stored.find(m => m.role === 'webcam')!
    // One take: the primary names it, the companion points at the primary.
    expect(primary.takeId).toBe(primary.id)
    expect(webcam.takeId).toBe(primary.id)
    expect(webcam.id).not.toBe(primary.id)
    expect(primary.startOffset).toBe(0)
    expect(webcam.startOffset).toBe(0)
    // The overlay geometry is the primary's, copied from the config at save
    // time: it is what ARTIST seeds the webcam clip's transform from (slice 2)
    // and what the composite MP4 draws through (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'top-left',
      size: 0.3,
      shape: 'rectangle',
    })
    expect('overlayPlacement' in webcam).toBe(false)
    // Slice 1 leaves the mixed audio on the primary, so only it claims sound.
    expect(primary.hasAudio).toBe(true)
    expect(webcam.hasAudio).toBe(false)
  })

  it('stores a thumbnail for each part, the companion decoded from its own blob', async () => {
    recorderTypeRef.current = 'webcodecs'
    capturedThumbnailRef.current = new Blob(['preview-frame'], { type: 'image/jpeg' })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, companionPart)

    const stored = await getRecordingsMetadata()
    for (const part of stored) {
      await expect(getThumbnail(part.id)).resolves.toBeDefined()
    }
    // The pre-captured frame is the *composited* preview, which is not the
    // webcam alone — so the companion's thumbnail comes out of its own file.
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledWith(COMPANION)
  })

  it('puts the companion under its primary in the list, not above it', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, companionPart)

    // addRecording prepends, so the companion is added first: the list ends up
    // [primary, companion, ...older] and the webcam row is never above the
    // screen row it belongs to.
    expect(added.map(entry => entry.role)).toEqual(['webcam', 'screen'])
  })

  it('never repairs the companion — a WebCodecs take needs none', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, companionPart)

    expect(converterModule.fixWebMMetadata).not.toHaveBeenCalled()
  })

  it('saves one part when there is no companion, exactly as before', async () => {
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6)

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(1)
    expect('takeId' in stored[0]).toBe(false)
    expect('role' in stored[0]).toBe(false)
    expect(added).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useRecordingSave.test.ts`
Expected: FAIL — `expected [ { … } ] to have a length of 2 but got 1`, and `expected undefined to be 'screen'` from the `find` on `role`.

- [ ] **Step 3: Implement the two-part save**

In `apps/craft/src/hooks/useRecordingSave.ts`, change the type and the body:

```ts
/** Save a finished take. `recordedDuration` is what the recorder timed. */
export type SaveRecording = (
  rawBlob: Blob,
  recordedDuration: number,
  /**
   * The take's second half, when the recorder produced one. Only the
   * separate-tracks mode does — see `core/webcodecs-recorder.ts`.
   */
  companion?: CompanionPart | null
) => Promise<void>;
```

After the existing `hasAudio` expression and before `buildSourceVideo`, add:

```ts
    // A companion take is one take in two files: the primary names it (its own
    // id is the takeId), carries the mixed audio and the overlay geometry, and
    // the companion carries the camera. Both are written here rather than in
    // two passes so a half-saved take cannot reach the library.
    const isCompanionTake = companion != null;
    const overlayPlacement = isCompanionTake
      ? {
          position: config.webcamPosition,
          size: config.webcamSize,
          shape: config.webcamShape,
        }
      : undefined;

    const sourceVideo = buildSourceVideo({
      id,
      now,
      blob,
      duration,
      width: metadata.width,
      height: metadata.height,
      hasAudio,
      hasWebcam: config.webcamEnabled,
      ...(isCompanionTake
        ? { takeId: id, role: 'screen' as const, startOffset: 0, overlayPlacement }
        : {}),
    });

    await storeVideo(id, blob, sourceVideo);
    await storeThumbnail(id, thumbnail);

    if (companion) {
      const companionId = uuidv4();
      const companionMetadata = await extractVideoMetadata(companion.blob, recordedDuration);
      // The frame grabbed off the live preview is the *composited* picture, so
      // it is the primary's thumbnail and not this part's. Decode one from the
      // companion's own file, with the same placeholder behind it as the
      // primary's fallback chain.
      let companionThumbnail: Blob;
      try {
        companionThumbnail = await generateThumbnail(companion.blob);
      } catch {
        companionThumbnail = await createPlaceholderThumbnail();
      }
      const companionSourceVideo = buildSourceVideo({
        id: companionId,
        now,
        blob: companion.blob,
        duration:
          Number.isFinite(companionMetadata.duration) && companionMetadata.duration > 0
            ? companionMetadata.duration
            : recordedDuration,
        width: companionMetadata.width,
        height: companionMetadata.height,
        // Slice 1 keeps the whole mix on the primary output, so this half has
        // no audio track at all — and must not be offered an M4A download.
        hasAudio: false,
        hasWebcam: true,
        takeId: id,
        role: 'webcam',
        startOffset: companion.startOffset,
      });

      await storeVideo(companionId, companion.blob, companionSourceVideo);
      await storeThumbnail(companionId, companionThumbnail);

      // Added FIRST because `addRecording` prepends: the primary then lands on
      // top of it and the webcam row sits directly under the take it belongs
      // to, which is the order `loadRecordings` rebuilds after a reload.
      addRecording(buildRecordingEntry({
        sourceVideo: companionSourceVideo,
        now,
        size: companion.blob.size,
        thumbnailUrl: createBlobUrl(companionThumbnail),
        config,
        hasAudio: false,
      }));
    }

    addRecording(buildRecordingEntry({
      sourceVideo,
      now,
      size: blob.size,
      thumbnailUrl: createBlobUrl(thumbnail),
      config,
      hasAudio,
    }));
```

Add `CompanionPart` to the type import from `../store/types`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useRecordingSave.test.ts src/App.saving.test.tsx`
Expected: PASS — both files, including every pre-existing test.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/craft/src/hooks/useRecordingSave.ts apps/craft/src/hooks/useRecordingSave.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the save path writes a take's two parts (ESCSUITE-14)

A companion take is two storeVideo + two storeThumbnail calls under one
takeId: the primary keeps the mixed audio and carries the overlay geometry
copied from the config at save time, the companion is stored silent with
role 'webcam'. The companion's thumbnail is decoded from its own blob — the
frame grabbed off the live preview is the composited picture, which is not
the webcam alone — and it is added to the list first, because addRecording
prepends and the webcam row belongs under its primary.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 3: The library reads a take back — grouping and the `hasWebcam` fix

**Files:**
- Create: `apps/craft/src/utils/takeOrder.ts`
- Create: `apps/craft/src/utils/takeOrder.test.ts`
- Modify: `apps/craft/src/store/recorderStore.ts:123-149`
- Test: `apps/craft/src/store/recorderStore.test.ts`

**Interfaces:**
- Produces: `orderTakes(recordings: Recording[]): Recording[]` — used by `loadRecordings` and by nothing else.
- Consumes: `Recording.takeId` / `Recording.role` (Task 1).

**The rule this task pins:** deleting a companion **demotes its primary by construction**. A primary whose `takeId` is its own id and which has no companion under it renders exactly as a plain take, so nothing rewrites stored metadata on delete — the demotion is a property of the grouping.

- [ ] **Step 1: Write the failing test** — create `apps/craft/src/utils/takeOrder.test.ts`

```ts
// The order the library shows takes in.
//
// A take can be several rows now (ESCSUITE-14), and a row's neighbours are
// what say so: the webcam half is meaningful directly under its primary and
// meaningless three takes away. The ordering is pure over the list so it can be
// asserted without storage — `loadRecordings` is the only caller.
import { describe, it, expect } from 'vitest'
import { orderTakes } from './takeOrder'
import type { Recording } from '../store/types'

function row(id: string, createdAt: number, extra: Partial<Recording> = {}): Recording {
  return {
    id,
    name: id,
    duration: 6,
    createdAt,
    size: 1024,
    hasWebcam: false,
    hasAudio: true,
    ...extra,
  }
}

describe('orderTakes', () => {
  it('keeps newest-first when every take is a single file', () => {
    expect(orderTakes([row('older', 1000), row('newer', 3000)]).map(r => r.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('puts a companion directly under its primary, wherever the primary sorts', () => {
    const ordered = orderTakes([
      row('webcam-of-old', 1001, { takeId: 'old', role: 'webcam', hasWebcam: true }),
      row('newest', 5000),
      row('old', 1000, { takeId: 'old', role: 'screen', hasWebcam: true }),
    ])

    // The companion follows its primary rather than its own timestamp: it was
    // saved a moment after the primary, so by date alone it would sort above it.
    expect(ordered.map(r => r.id)).toEqual(['newest', 'old', 'webcam-of-old'])
  })

  it('demotes a primary whose companion is gone, without touching it', () => {
    const ordered = orderTakes([row('take', 2000, { takeId: 'take', role: 'screen', hasWebcam: true })])

    // Deleting the companion alone leaves the primary's own takeId in place;
    // with nothing grouped under it the row is a plain take again, so nothing
    // has to rewrite stored metadata on a delete.
    expect(ordered.map(r => r.id)).toEqual(['take'])
  })

  it('still shows an orphan companion, newest-first, after the takes', () => {
    const ordered = orderTakes([
      row('orphan', 4000, { takeId: 'deleted-primary', role: 'webcam', hasWebcam: true }),
      row('take', 2000),
    ])

    // A companion whose primary is missing — storage cleared mid-take, or a
    // half-saved take — is a row rather than a hidden file the user cannot
    // delete.
    expect(ordered.map(r => r.id)).toEqual(['take', 'orphan'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/takeOrder.test.ts`
Expected: FAIL — `Failed to resolve import "./takeOrder"`.

- [ ] **Step 3: Implement `orderTakes`**

Create `apps/craft/src/utils/takeOrder.ts`:

```ts
// The order the library shows takes in: newest take first, and each take's
// companion rows directly under the primary they belong to.
//
// Kept out of the store so it is pure over the list — `loadRecordings` is its
// only caller, and the ordering is the half of that function worth testing on
// its own. A take is identified by its primary (a primary's `takeId` is its own
// id, see `utils/recordingMetadata.ts`), so grouping is one equality.
import type { Recording } from '../store/types';

/**
 * Newest take first; a take's companions immediately after its primary, oldest
 * companion first; then any companion whose primary is missing.
 *
 * Sorting companions by their own `createdAt` would break the grouping: both
 * parts are saved within the same millisecond or two and the companion is
 * written second, so by date alone a webcam row would float above the screen
 * row it describes.
 */
export function orderTakes(recordings: Recording[]): Recording[] {
  const companionsByTake = new Map<string, Recording[]>();
  const primaries: Recording[] = [];

  for (const recording of recordings) {
    // A primary carries its own id as its takeId, so "not the primary of its
    // own take" is exactly what makes a row a companion.
    if (recording.takeId !== undefined && recording.takeId !== recording.id) {
      const group = companionsByTake.get(recording.takeId);
      if (group) group.push(recording);
      else companionsByTake.set(recording.takeId, [recording]);
    } else {
      primaries.push(recording);
    }
  }

  primaries.sort((a, b) => b.createdAt - a.createdAt);

  const ordered: Recording[] = [];
  for (const primary of primaries) {
    ordered.push(primary);
    const companions = companionsByTake.get(primary.id);
    if (companions) {
      companions.sort((a, b) => a.createdAt - b.createdAt);
      ordered.push(...companions);
      companionsByTake.delete(primary.id);
    }
  }

  // Whatever is left has no primary to sit under — storage cleared between the
  // two writes, or a primary deleted by a build that did not cascade. Shown
  // rather than hidden: a row the user cannot see is a file they cannot delete.
  const orphans = [...companionsByTake.values()]
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);

  return [...ordered, ...orphans];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/takeOrder.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing store test** — append inside `recorderStore.test.ts`'s `loadRecordings` describe

```ts
    // ESCSUITE-14. Two stored records, one take: the library has to rebuild the
    // grouping the save path wrote, and `hasWebcam` — a hard-coded `false` with
    // a TODO beside it until now — has to come back from the metadata.
    it('rebuilds a take from its parts and reads hasWebcam back', async () => {
      vi.mocked(getRecordingsMetadata).mockResolvedValue([
        {
          id: 'webcam-part',
          name: 'Recording — webcam',
          duration: 6,
          size: 200,
          recordedAt: 2001,
          takeId: 'screen-part',
          role: 'webcam',
          hasAudio: false,
          hasWebcam: true,
        } as SourceVideo,
        { id: 'plain', name: 'Plain', duration: 3, size: 50, recordedAt: 5000 } as SourceVideo,
        {
          id: 'screen-part',
          name: 'Recording',
          duration: 6,
          size: 900,
          recordedAt: 2000,
          takeId: 'screen-part',
          role: 'screen',
          hasAudio: true,
          hasWebcam: true,
          overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
        } as SourceVideo,
      ])
      vi.mocked(getThumbnail).mockResolvedValue(undefined)

      await useRecorderStore.getState().loadRecordings()

      const { recordings } = useRecorderStore.getState()
      expect(recordings.map(r => r.id)).toEqual(['plain', 'screen-part', 'webcam-part'])
      expect(recordings.map(r => r.role)).toEqual([undefined, 'screen', 'webcam'])
      expect(recordings[1].takeId).toBe('screen-part')
      // The `hasWebcam: false // TODO` this replaces: a PiP take came back
      // claiming no camera however it was recorded.
      expect(recordings[1].hasWebcam).toBe(true)
      expect(recordings[0].hasWebcam).toBe(false)
    })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/store/recorderStore.test.ts`
Expected: FAIL — `expected [ 'webcam-part', 'plain', 'screen-part' ] to deeply equal [ 'plain', 'screen-part', 'webcam-part' ]`.

- [ ] **Step 7: Implement it in `loadRecordings`**

In `apps/craft/src/store/recorderStore.ts`, add `import { orderTakes } from '../utils/takeOrder'` and replace the body of the `metadata.map` callback's return plus the sort:

```ts
        return {
          id: m.id,
          name: m.name,
          duration: m.duration,
          createdAt: m.recordedAt || 0,
          size: m.size,
          thumbnailUrl,
          // Written by `buildSourceVideo` since ESCSUITE-14. Before that
          // nothing stored said whether a take had a camera in it, which is
          // what the `hasWebcam: false // TODO` here used to admit; a record
          // saved then keeps the answer it used to get.
          hasWebcam: m.hasWebcam ?? false,
          // Written by `buildSourceVideo` since ESCSUITE-60. Recordings saved
          // before that have no field at all, and keep the answer they used
          // to get — a take that did have audio would otherwise lose its M4A
          // button for good, which is worse than the stale offer.
          hasAudio: m.hasAudio ?? true,
          ...(m.takeId !== undefined ? { takeId: m.takeId } : {}),
          ...(m.role !== undefined ? { role: m.role } : {}),
        };
      })
    );

    // Newest take first, each take's companion rows directly under its primary
    // — the grouping ESCSUITE-14's save path wrote, rebuilt for the panel.
    set({ recordings: orderTakes(recordings) });
```

(Delete the previous `recordings.sort(...)` and `set({ recordings })`.)

- [ ] **Step 8: Run the store tests and the whole suite**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/store/recorderStore.test.ts`
Expected: PASS, including the pre-existing `sorts recordings newest-first…` and `hasWebcam` assertions.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS (whole craft suite).

- [ ] **Step 9: Commit**

```bash
git add apps/craft/src/utils/takeOrder.ts apps/craft/src/utils/takeOrder.test.ts \
  apps/craft/src/store/recorderStore.ts apps/craft/src/store/recorderStore.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the library groups a take's parts and tells the truth about hasWebcam

loadRecordings orders through a pure orderTakes(): newest take first, each
take's companion rows directly under the primary they belong to, and an
orphan companion still shown rather than left as a file nobody can delete. A
primary with nothing grouped under it renders as a plain take, which is what
makes "delete the companion alone" a demotion with no metadata rewrite.

hasWebcam is read back from the stored record instead of the hard-coded
`false // TODO`, which had every PiP take claiming it had no camera.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 4: Recorder refactor — one clock, per-encoder timing, extracted pipeline helpers (PURE MOVE)

**Files:**
- Create: `apps/craft/src/core/webcodecsSupport.ts`
- Modify: `apps/craft/src/core/webcodecs-recorder.ts` (imports, `:29-36`, `:101-110`, `:253-332`, `:453-465`, `:470-524`)

**Interfaces:**
- Produces: `isWebCodecsRecordingSupported(): boolean` (moved; still re-exported from `core/webcodecs-recorder.ts`, so every existing import is unchanged), `canRecordSeparateTracks(): boolean`.
- Produces (private, for Task 5): `interface FrameTiming { lastFrameTimestampUs: number; nextKeyFrameUs: number }`, `newFrameTiming(): FrameTiming`, `videoBitrateFor(width: number, height: number): number`, `WebCodecsRecorder#createVideoOutput()`, `#createVideoEncoder(sourceOf, width, height)`, `#captureFromTrackProcessor(reader, timing, active, encoderOf, onFrameEncoded)`, `#nextFrameTiming(timing, now?)`.

**This task changes no behaviour.** Constraint 2 applies: at this commit, `git diff --stat` shows no test file changed.

- [ ] **Step 1: Create `core/webcodecsSupport.ts`, moving the function verbatim**

```ts
// The two synchronous capability questions the recorder and the UI both ask.
//
// They live here rather than in `webcodecs-recorder.ts` because a *component*
// has to ask one of them — the separate-tracks toggle is disabled with a
// visible reason where the browser cannot serve it — and importing the recorder
// would pull `mediabunny` into that component's module graph (and into every
// App suite that mocks the recorder factory but not the muxer). This module
// imports nothing.

/**
 * Check if WebCodecs recording is supported
 */
export function isWebCodecsRecordingSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

/**
 * Whether this browser can record the webcam as a separate track.
 *
 * WebCodecs, plus `MediaStreamTrackProcessor`: the webcam pipeline reads frames
 * from a track processor and has **no** `<video>`+canvas fallback. The primary
 * pipeline keeps its fallback because a take must record *something*; a second
 * hidden `<video>` and a second capture canvas is a cost the opt-in mode does
 * not need to pay, and every browser with WebCodecs shipped the track processor
 * alongside it. Firefox and Safari have neither, so the toggle is disabled
 * there with the reason said out loud (`utils/separateTracksReadiness.ts`).
 */
export function canRecordSeparateTracks(): boolean {
  return isWebCodecsRecordingSupported() && 'MediaStreamTrackProcessor' in globalThis;
}
```

- [ ] **Step 2: Re-export it from the recorder and thread the per-pipeline timing through**

In `apps/craft/src/core/webcodecs-recorder.ts`:

1. Delete the `isWebCodecsRecordingSupported` definition and add, under the imports:

```ts
// Moved to `webcodecsSupport.ts` so a component can ask without importing the
// muxer; re-exported here because this is where every caller imports it from.
export { isWebCodecsRecordingSupported } from './webcodecsSupport';
```

and `import { isWebCodecsRecordingSupported } from './webcodecsSupport';` for the class's own use.

2. Replace the two private fields `lastFrameTimestampUs` / `nextKeyFrameUs` with the per-pipeline record, declared above the class:

```ts
/**
 * One encoder's presentation bookkeeping.
 *
 * The recording **clock** is shared — one `startTime`, one `pausedDuration`,
 * read by `nextFrameTiming()` for every pipeline — and that shared clock is
 * what makes a separate-tracks take's two blobs aligned by construction rather
 * than by measurement. These two numbers are per encoder, because each encoder
 * is fed its own monotonically increasing presentation timeline and owes its
 * own viewer a keyframe once a second; sharing them would have two interleaved
 * pipelines pushing each other's timestamps forward and handing the second
 * pipeline only the keyframes the first did not claim.
 */
interface FrameTiming {
  /** Microsecond timestamp of the last frame handed to this encoder; -1 before
   *  the first, so a take that starts on the clock's own zero still stamps 0. */
  lastFrameTimestampUs: number;
  /** Recording-clock microsecond mark at which this encoder's next keyframe is due. */
  nextKeyFrameUs: number;
}

function newFrameTiming(): FrameTiming {
  return { lastFrameTimestampUs: -1, nextKeyFrameUs: 0 };
}

/** Bitrate for a video pipeline of this size. */
function videoBitrateFor(width: number, height: number): number {
  const pixels = width * height;
  if (pixels >= 1920 * 1080) return 8_000_000; // 8 Mbps for 1080p+
  if (pixels >= 1280 * 720) return 5_000_000; // 5 Mbps for 720p
  return 2_500_000; // 2.5 Mbps for smaller
}
```

with `private screenTiming: FrameTiming = newFrameTiming();` on the class, `start()` doing `this.screenTiming = newFrameTiming();` where it previously reset the two numbers, and `nextFrameTiming` becoming:

```ts
  private nextFrameTiming(
    timing: FrameTiming,
    now = performance.now()
  ): { timestamp: number; keyFrame: boolean } {
    const elapsedUs = Math.round((now - this.startTime - this.pausedDuration) * 1000);
    const timestamp =
      elapsedUs > timing.lastFrameTimestampUs ? elapsedUs : timing.lastFrameTimestampUs + 1;
    timing.lastFrameTimestampUs = timestamp;

    const keyFrame = timestamp >= timing.nextKeyFrameUs;
    if (keyFrame) {
      timing.nextKeyFrameUs = timestamp + 1_000_000;
    }

    return { timestamp, keyFrame };
  }
```

Keep the whole existing doc comment above it and add one sentence to it: *"`timing` is the calling pipeline's own bookkeeping; the clock it is measured against is the recorder's, which is what keeps two pipelines' frames on one timeline."* The three existing call sites become `this.nextFrameTiming(this.screenTiming, now)` / `this.nextFrameTiming(this.screenTiming)`.

- [ ] **Step 3: Extract the output, encoder and capture-loop helpers**

Replace the Mediabunny/encoder block of `initialize` (`:253-303`) with calls to the two new private methods, keeping every field name and the call order (`addVideoTrack` → `addAudioTrack` → `output.start()`):

```ts
    // Set up Mediabunny output
    const primary = this.createVideoOutput();
    this.target = primary.target;
    this.output = primary.output;
    this.videoSource = primary.packetSource;

    // Create audio packet source (Opus) if we have audio
    if (this.mixedAudioStream.getAudioTracks().length > 0) {
      this.audioSource = new EncodedAudioPacketSource('opus');
      this.output.addAudioTrack(this.audioSource);
    }

    // Start the output
    await this.output.start();

    // Set up video encoder
    this.videoEncoder = await this.createVideoEncoder(
      () => this.videoSource,
      this.width,
      this.height
    );
```

and add:

```ts
  /**
   * A WebM output with one VP9 video track. The caller adds any audio track and
   * then starts it, because the primary output mixes audio in and the webcam
   * companion does not.
   */
  private createVideoOutput(): {
    output: Output;
    target: BufferTarget;
    packetSource: EncodedVideoPacketSource;
  } {
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const packetSource = new EncodedVideoPacketSource('vp9');
    output.addVideoTrack(packetSource, { frameRate: this.frameRate });
    return { output, target, packetSource };
  }

  /**
   * A configured VP9 encoder writing into `sourceOf()`'s packet source.
   *
   * The source is read through a function rather than captured, because
   * `cleanup()` nulls it: an encoder output that lands after a take has been
   * torn down must find nothing to add to rather than write into a finalized
   * muxer.
   */
  private async createVideoEncoder(
    sourceOf: () => EncodedVideoPacketSource | null,
    width: number,
    height: number
  ): Promise<VideoEncoder> {
    const encoder = new VideoEncoder({
      output: async (chunk, meta) => {
        const source = sourceOf();
        if (source) {
          await source.add(EncodedPacket.fromEncodedChunk(chunk), meta);
        }
      },
      error: (e) => {
        console.error('Video encoder error:', e);
        this.callbacks.onError?.(new Error(`Video encoder error: ${e.message}`));
      },
    });

    await encoder.configure({
      codec: 'vp09.00.10.08', // VP9 Profile 0
      width,
      height,
      bitrate: videoBitrateFor(width, height),
      framerate: this.frameRate,
    });

    return encoder;
  }
```

Then split the track-processor loop so a second pipeline can run the same code, keeping the existing doc comment on the public entry point:

```ts
  /**
   * Start frame capture using MediaStreamTrackProcessor (preferred method)
   */
  private async startTrackProcessorCapture(): Promise<void> {
    if (!this.frameReader || !this.videoEncoder) return;

    await this.captureFromTrackProcessor(
      this.frameReader,
      this.screenTiming,
      () => this.frameReaderActive,
      () => this.videoEncoder,
      () => {
        this.frameCount++;
      }
    );
  }

  /**
   * Read one track's frames, re-stamp each with the recording clock and hand it
   * to that track's encoder, until the pipeline is stopped or the track ends.
   *
   * Parameterised rather than written twice: a separate-tracks take runs this
   * loop once per video track, and the throttle (`lastFrameTime`) is a local so
   * each track is throttled against its own delivery rate rather than against
   * the other's.
   */
  private async captureFromTrackProcessor(
    reader: ReadableStreamDefaultReader<VideoFrame>,
    timing: FrameTiming,
    active: () => boolean,
    encoderOf: () => VideoEncoder | null,
    onFrameEncoded: () => void
  ): Promise<void> {
    const targetFrameInterval = 1000 / this.frameRate;
    let lastFrameTime = 0;

    try {
      while (active() && this.isRecordingActive) {
        const { value: sourceFrame, done } = await reader.read();

        if (done) break;
        if (!sourceFrame) continue;

        // Throttle to target frame rate
        const now = performance.now();
        if (now - lastFrameTime < targetFrameInterval * 0.8) {
          sourceFrame.close();
          continue;
        }
        lastFrameTime = now;

        if (this.isPausedState) {
          sourceFrame.close();
          continue;
        }

        const encoder = encoderOf();
        if (encoder && encoder.state !== 'closed') {
          try {
            // Re-stamp the frame with the recording clock (see nextFrameTiming),
            // reusing the reading the throttle above already took.
            const { timestamp, keyFrame } = this.nextFrameTiming(timing, now);
            const frame = new VideoFrame(sourceFrame, { timestamp });
            // Close source frame immediately - we've copied the data we need
            sourceFrame.close();

            encoder.encode(frame, { keyFrame });
            // Close frame after encoding - encoder copies the data it needs
            frame.close();

            onFrameEncoded();
          } catch (e) {
            console.error('Frame encoding error:', e);
            sourceFrame.close();
          }
        } else {
          sourceFrame.close();
        }
      }
    } catch (e) {
      // Reader was cancelled or track ended
      if (this.isRecordingActive) {
        console.warn('Track processor read error:', e);
      }
    }
  }
```

- [ ] **Step 4: Run every suite that touches the recorder and confirm nothing moved**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/webcodecs-recorder.test.ts src/core/webcodecsRecorder.perf.test.ts src/core/recorder-factory.test.ts`
Expected: PASS, with the same test count as before the change.

Run: `git status --porcelain` and `git diff --stat`
Expected: the only changed/added files are `src/core/webcodecs-recorder.ts` and `src/core/webcodecsSupport.ts` — **no** `*.test.ts` in the list.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/craft/src/core/webcodecsSupport.ts apps/craft/src/core/webcodecs-recorder.ts
git commit -m "$(cat <<'EOF'
refactor(craft): give the recorder per-encoder frame timing and reusable pipeline parts

Pure move, no behaviour change: every recorder test is byte-unchanged and green
at this commit.

- isWebCodecsRecordingSupported moves to core/webcodecsSupport.ts (re-exported,
  so every import is unchanged) and canRecordSeparateTracks joins it there,
  because a component must be able to ask without importing mediabunny.
- lastFrameTimestampUs/nextKeyFrameUs become a FrameTiming record passed into
  nextFrameTiming(). The clock stays shared — that is what will align two
  tracks — while the strictly-increasing guard and the keyframe schedule become
  per encoder, which is what they always were in meaning.
- The Mediabunny output, the VP9 encoder, the bitrate ladder and the
  track-processor read loop come out as reusable parts, with the packet source
  read through a function so cleanup()'s null still stops a late output.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 5: The webcam pipeline — two encoders, two outputs, one clock, two blobs

**Files:**
- Modify: `apps/craft/src/test/doubles/mediastream.ts:87-185`
- Modify: `apps/craft/src/core/webcodecs-recorder.ts`
- Modify: `apps/craft/src/core/recorder.ts:6-13`
- Test: `apps/craft/src/core/webcodecs-recorder.test.ts`, `apps/craft/src/core/webcodecsRecorder.perf.test.ts`

**Interfaces:**
- Consumes: `FrameTiming`, `newFrameTiming`, `createVideoOutput`, `createVideoEncoder`, `captureFromTrackProcessor` (Task 4); `CompanionPart`, `RecorderStopCallback` (Task 1).
- Produces: `WebCodecsRecorderCallbacks.onStop?: RecorderStopCallback` — `stop()` calls it with `(primaryBlob, companionPart | null)`; `RecorderCallbacks.onStop?: RecorderStopCallback` in `core/recorder.ts` (type only; `Recorder` still calls it with one argument).
- Produces (test double): `TrackProcessorControl.pushFrameTo(trackId, frame)`, one queue and one reader **per** constructed processor.

**Behaviour this task pins:**
1. `config.separateTracks && screenEnabled && webcamEnabled && webcamStream` → a second `VideoEncoder`, a second `Output`, a second track-processor reader; the screen encoder is constructed first (so `VideoEncoderDouble.instances[0]` is the screen).
2. Two frames captured at the same clock reading get the **same** timestamp; each encoder's first frame is a keyframe.
3. The webcam output has **no** audio track; the mix stays on the primary.
4. A webcam track that ends mid-take stops only its own loop — the screen keeps recording and `stop()` finalizes a shorter companion.
5. A companion that encoded **no** frames, or whose finalize threw, is delivered as `null`: no empty row in the library, and never at the cost of the primary blob.
6. `pause()`/`resume()` are shared: a paused take stamps neither pipeline.

- [ ] **Step 1: Give the track-processor double one queue per processor**

In `apps/craft/src/test/doubles/mediastream.ts`, replace the section from `interface QueuedItem` through `trackProcessorControl()` with the per-processor version (the single-processor semantics of every existing call are unchanged):

```ts
interface QueuedItem {
  type: 'frame' | 'done' | 'error'
  value?: unknown
  error?: Error
}

/** One processor's own queue, reader and waiters. */
interface ProcessorLane {
  track: MediaStreamTrack
  queue: QueuedItem[]
  waiters: Array<(item: QueuedItem) => void>
  reader: { read(): Promise<{ value?: unknown; done: boolean }>; cancel(): Promise<void> }
  cancels: number
}

export interface TrackProcessorControl {
  /** Tracks the processor was constructed for, oldest first. */
  readonly tracks: MediaStreamTrack[]
  /** Hand the next pending (or future) read() on the FIRST processor this frame. */
  pushFrame(frame: unknown): void
  /** The same, addressed to the processor built for the track with this id. */
  pushFrameTo(trackId: string, frame: unknown): void
  /** End every processor's stream: the next read() resolves { done: true }. */
  finish(): void
  /** End one processor's stream, as a single capture track dying does. */
  finishTrack(trackId: string): void
  /** Make the next read() on the first processor reject, as a torn-down track does. */
  failNextRead(error: Error): void
  /** How many times consumers called reader.cancel(), across every processor. */
  cancelCalls(): number
  /** Reads currently blocked, across every processor. */
  readonly pendingReads: number
}

export function installTrackProcessorDouble(): TrackProcessorControl {
  // A lane per constructed processor rather than one shared queue: a
  // separate-tracks take builds two processors and reads them in two loops, so
  // a shared queue would hand the screen's frame to whichever loop happened to
  // be waiting. With one processor this behaves exactly as it did before.
  const lanes: ProcessorLane[] = []

  const deliver = (lane: ProcessorLane, item: QueuedItem) => {
    const waiter = lane.waiters.shift()
    if (waiter) waiter(item)
    else lane.queue.push(item)
  }

  const laneFor = (trackId: string): ProcessorLane => {
    const lane = lanes.find(l => l.track.id === trackId)
    if (!lane) throw new Error(`No MediaStreamTrackProcessor was built for track '${trackId}'`)
    return lane
  }

  const firstLane = (): ProcessorLane => {
    const lane = lanes[0]
    if (!lane) throw new Error('No MediaStreamTrackProcessor has been constructed')
    return lane
  }

  class MediaStreamTrackProcessorDouble {
    readonly readable: { getReader: () => ProcessorLane['reader'] }

    constructor(options: { track: MediaStreamTrack }) {
      const lane: ProcessorLane = {
        track: options.track,
        queue: [],
        waiters: [],
        cancels: 0,
        reader: {
          async read(): Promise<{ value?: unknown; done: boolean }> {
            const item =
              lane.queue.shift() ??
              (await new Promise<QueuedItem>(resolve => lane.waiters.push(resolve)))
            if (item.type === 'error') throw item.error
            if (item.type === 'done') return { value: undefined, done: true }
            return { value: item.value, done: false }
          },
          async cancel(): Promise<void> {
            lane.cancels++
            // A cancelled reader releases anything blocked on it.
            while (lane.waiters.length > 0) lane.waiters.shift()!({ type: 'done' })
          },
        },
      }
      lanes.push(lane)
      this.readable = { getReader: () => lane.reader }
    }
  }

  const g = globalThis as unknown as Record<string, unknown>
  if (!installed) {
    originalTrackProcessor = g.MediaStreamTrackProcessor
    installed = true
  }
  g.MediaStreamTrackProcessor = MediaStreamTrackProcessorDouble

  control = {
    get tracks() {
      return lanes.map(lane => lane.track)
    },
    pushFrame(frame) {
      deliver(firstLane(), { type: 'frame', value: frame })
    },
    pushFrameTo(trackId, frame) {
      deliver(laneFor(trackId), { type: 'frame', value: frame })
    },
    finish() {
      for (const lane of lanes) deliver(lane, { type: 'done' })
    },
    finishTrack(trackId) {
      deliver(laneFor(trackId), { type: 'done' })
    },
    failNextRead(error) {
      deliver(firstLane(), { type: 'error', error })
    },
    cancelCalls: () => lanes.reduce((total, lane) => total + lane.cancels, 0),
    get pendingReads() {
      return lanes.reduce((total, lane) => total + lane.waiters.length, 0)
    },
  }
  return control
}
```

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/webcodecs-recorder.test.ts`
Expected: PASS, unchanged — the double's single-processor behaviour is identical.

- [ ] **Step 2: Write the failing behaviour tests** — append a describe to `apps/craft/src/core/webcodecs-recorder.test.ts`

```ts
  // --- separate tracks (ESCSUITE-14) ---------------------------------------

  describe('separate tracks', () => {
    const separateConfig: RecordingConfig = {
      ...defaultConfig,
      webcamEnabled: true,
      separateTracks: true,
    }

    let processor: TrackProcessorControl
    let webcamTrack: TrackDouble
    let webcamStream: MediaStream

    beforeEach(() => {
      processor = installTrackProcessorDouble()
      webcamTrack = createTrackDouble('video', {
        id: 'webcam-video',
        label: 'FaceTime HD',
        settings: { width: 640, height: 480 },
      })
      webcamStream = createStreamDouble([webcamTrack])
    })

    /** A frame as the track processor delivers one. */
    function sourceFrame(): VideoFrame {
      return new VideoFrameDouble({}, { timestamp: 0 }) as unknown as VideoFrame
    }

    /** The screen encoder is constructed first, so instances are [screen, webcam]. */
    const screenEncoder = () => VideoEncoderDouble.instances[0]
    const webcamEncoder = () => VideoEncoderDouble.instances[1]

    it('builds a second encoder and a second WebM output, the webcam one silent', async () => {
      await recorder.initialize(screenStream, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      const state = getMediabunnyState()
      expect(state.outputs).toHaveLength(2)
      expect(state.formats.map(f => f.name)).toEqual(['webm', 'webm'])
      expect(VideoEncoderDouble.instances).toHaveLength(2)
      // Sized from its own track, not from the screen's.
      expect(screenEncoder().configureCalls[0]).toMatchObject({ width: 1920, height: 1080 })
      expect(webcamEncoder().configureCalls[0]).toMatchObject({ width: 640, height: 480 })
      // Slice 1: the mix stays on the primary. One audio track in the take,
      // and it is on the screen output.
      expect(state.outputs[0].addAudioTrack).toHaveBeenCalledTimes(1)
      expect(state.outputs[1].addAudioTrack).not.toHaveBeenCalled()
      expect(AudioEncoderDouble.instances).toHaveLength(1)
    })

    it('stamps both encoders from the one clock — same tick, same timestamp', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()

      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      // One clock: the two blobs are aligned by construction rather than by
      // measurement, which is the whole reason this is one recorder and not two.
      expect(screenEncoder().encodes[0].data.timestamp).toBe(40_000)
      expect(webcamEncoder().encodes[0].data.timestamp).toBe(40_000)
      // Per-encoder keyframe schedules: each stream's first frame is a keyframe,
      // because each will be decoded on its own.
      expect(screenEncoder().encodes[0].options).toEqual({ keyFrame: true })
      expect(webcamEncoder().encodes[0].options).toEqual({ keyFrame: true })
    })

    it('excludes paused time from both pipelines', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 100
      recorder.pause()
      now += 500
      recorder.resume()
      now += 100

      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      expect(screenEncoder().encodes[0].data.timestamp).toBe(200_000)
      expect(webcamEncoder().encodes[0].data.timestamp).toBe(200_000)
    })

    it('flushes both encoders, finalizes both outputs and delivers two blobs', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      await recorder.stop()

      expect(screenEncoder().flushCalls).toBe(1)
      expect(webcamEncoder().flushCalls).toBe(1)
      expect(getMediabunnyState().outputs.every(o => o.finalizeCalls === 1)).toBe(true)
      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toEqual({
        role: 'webcam',
        blob: expect.any(Blob),
        startOffset: 0,
      })
    })

    it('keeps recording the screen when the webcam dies mid-take', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('webcam-video', sourceFrame())
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      webcamTrack.end()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      // The camera stopping is not the take stopping: the screen keeps going
      // and the webcam half simply ends where the camera did.
      expect(recorder.isRecording()).toBe(true)
      expect(screenEncoder().encodes).toHaveLength(2)
      expect(webcamEncoder().encodes).toHaveLength(1)

      await recorder.stop()
      expect(callbacks.onStop.mock.calls[0][1]).toMatchObject({ role: 'webcam' })
    })

    it('delivers no companion when the webcam never produced a frame', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      await recorder.stop()

      // An empty webcam file would be a library row that plays nothing and a
      // second source ARTIST would import for no reason.
      expect(callbacks.onStop.mock.calls[0][1]).toBeNull()
    })

    it('still delivers the primary when the companion cannot be written', async () => {
      await recorder.initialize(screenStream, webcamStream, null, separateConfig)
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      await flush()

      // The companion's output is the second one; make its finalize throw.
      getMediabunnyState().outputs[1].finalize.mockRejectedValueOnce(new Error('muxer died'))

      await recorder.stop()

      const [blob, companion] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companion).toBeNull()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The webcam companion could not be finalized:',
        expect.any(Error)
      )
    })

    it('records the screen alone when the webcam stream has no video track', async () => {
      await recorder.initialize(screenStream, createStreamDouble([]), null, separateConfig)

      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(1)
      expect(consoleWarn).toHaveBeenCalledWith(
        'Separate tracks asked for, but the webcam stream has no video track — recording the screen alone'
      )
    })

    it('records the screen alone where there is no MediaStreamTrackProcessor', async () => {
      uninstallTrackProcessorDouble()

      await recorder.initialize(screenStream, webcamStream, null, separateConfig)

      // The gate on the toggle asks the same question
      // (`canRecordSeparateTracks`), so reaching here means the API went away
      // between the click and the take — the take is still recorded.
      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(consoleWarn).toHaveBeenCalledWith(
        'No MediaStreamTrackProcessor — recording the screen alone'
      )
    })

    it('ignores the flag for a webcam-only take', async () => {
      await recorder.initialize(null, webcamStream, null, {
        ...separateConfig,
        screenEnabled: false,
      })

      // There is nothing to separate the webcam *from*: it is the take.
      expect(VideoEncoderDouble.instances).toHaveLength(1)
      expect(getMediabunnyState().outputs).toHaveLength(1)
    })
  })
```

Add `type TrackDouble`, `type TrackProcessorControl`, `installTrackProcessorDouble` to the `doubles/mediastream` import list if any are missing, and `defaultConfig` already exists as a local const in the file.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/webcodecs-recorder.test.ts -t 'separate tracks'`
Expected: FAIL — `expected [ OutputDouble ] to have a length of 2 but got 1`, and `expected undefined to be … ` from `VideoEncoderDouble.instances[1]`.

- [ ] **Step 4: Implement the companion pipeline**

In `apps/craft/src/core/webcodecs-recorder.ts`:

```ts
import type { AudioLevels, CompanionPart, RecorderStopCallback, RecordingConfig } from '../store/types';

export interface WebCodecsRecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  /**
   * The finished take. A separate-tracks take delivers its webcam half as the
   * second argument (see `CompanionPart`); every other take delivers the blob
   * alone, and so does `Recorder`.
   */
  onStop?: RecorderStopCallback;
  onError?: (error: Error) => void;
  onAudioLevels?: (levels: AudioLevels) => void;
}

/**
 * The webcam half of a separate-tracks take: its own encoder, its own
 * Mediabunny output, its own frame reader — and the recorder's *shared* clock,
 * which is what makes the two blobs frame-aligned by construction.
 *
 * Track-processor only, deliberately: the primary pipeline keeps its
 * `<video>`+canvas fallback because a take has to record something, while the
 * opt-in mode is gated on `canRecordSeparateTracks()` and simply records the
 * screen alone where the API is missing.
 */
interface CompanionPipeline {
  readonly track: MediaStreamTrack;
  encoder: VideoEncoder | null;
  output: Output | null;
  target: BufferTarget | null;
  packetSource: EncodedVideoPacketSource | null;
  reader: ReadableStreamDefaultReader<VideoFrame> | null;
  readerActive: boolean;
  timing: FrameTiming;
  /** Frames this pipeline encoded; 0 means there is no companion worth storing. */
  frameCount: number;
}
```

Field: `private companion: CompanionPipeline | null = null;`

At the end of `initialize`, just before `this.startAudioLevelMonitoring();`:

```ts
    // A separate-tracks take (ESCSUITE-14): the webcam gets its own encoder and
    // its own output, stamped from the same clock as the screen's. Only a
    // screen+webcam take can have one — a webcam-only take *is* the webcam.
    if (
      config.separateTracks &&
      config.screenEnabled &&
      config.webcamEnabled &&
      webcamStream
    ) {
      await this.initializeCompanion(webcamStream);
    }
```

and the new methods:

```ts
  /**
   * Build the webcam pipeline, or record the screen alone and say why.
   *
   * Both refusals are warnings rather than throws: the take the user asked for
   * is mostly the screen, and losing it because the camera track was missing
   * would be a worse outcome than a take with no companion.
   */
  private async initializeCompanion(webcamStream: MediaStream): Promise<void> {
    const track = webcamStream.getVideoTracks()[0];
    if (!track) {
      console.warn(
        'Separate tracks asked for, but the webcam stream has no video track — recording the screen alone'
      );
      return;
    }
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      console.warn('No MediaStreamTrackProcessor — recording the screen alone');
      return;
    }

    const settings = track.getSettings();
    const { output, target, packetSource } = this.createVideoOutput();
    // No audio track: slice 1 keeps the whole mix on the primary output.
    await output.start();

    this.companion = {
      track,
      encoder: await this.createVideoEncoder(
        () => this.companion?.packetSource ?? null,
        settings.width || 1280,
        settings.height || 720
      ),
      output,
      target,
      packetSource,
      reader: new MediaStreamTrackProcessor({ track }).readable.getReader(),
      readerActive: false,
      timing: newFrameTiming(),
      frameCount: 0,
    };

    // A camera that stops is not a take that stops: end this pipeline and let
    // the screen keep recording. stop() then finalizes a shorter companion, or
    // none at all if no frame ever arrived.
    const companionEnded = () => {
      console.warn(`Webcam track ended: ${track.label}`);
      if (this.companion) this.companion.readerActive = false;
    };
    track.addEventListener('ended', companionEnded);
    this.trackEndedHandlers.set(track, companionEnded);
  }

  /** Read the webcam track into its own encoder, on the shared clock. */
  private async startCompanionCapture(): Promise<void> {
    const companion = this.companion;
    if (!companion?.reader) return;

    await this.captureFromTrackProcessor(
      companion.reader,
      companion.timing,
      () => companion.readerActive,
      () => companion.encoder,
      () => {
        companion.frameCount++;
      }
    );
  }

  /**
   * Finalize the webcam half and hand back its blob, or null when there is
   * nothing worth storing.
   *
   * Two cases end as "no companion" rather than as an empty row in the library:
   * a webcam that delivered no frame (the take recorded the screen alone), and
   * a muxer that could not write. The second is swallowed into a warning on
   * purpose — the primary blob is the take, and losing it because the
   * companion's finalize threw would be the worse outcome by far.
   */
  private async finalizeCompanion(): Promise<CompanionPart | null> {
    const companion = this.companion;
    if (!companion || companion.frameCount === 0) return null;

    try {
      await companion.output?.finalize();
      const buffer = companion.target?.buffer;
      if (!buffer) return null;
      // 0 in this slice: one clock, one start(), both pipelines' first frame
      // stamped from the same origin. Written down rather than assumed, because
      // the audio companions (slice 3) will not all start at zero.
      return {
        role: 'webcam',
        blob: new Blob([buffer], { type: 'video/webm' }),
        startOffset: 0,
      };
    } catch (e) {
      console.warn('The webcam companion could not be finalized:', e);
      return null;
    }
  }
```

In `start()`, after `this.screenTiming = newFrameTiming();` and the primary's capture start:

```ts
    if (this.companion) {
      this.companion.timing = newFrameTiming();
      this.companion.frameCount = 0;
      this.companion.readerActive = true;
      void this.startCompanionCapture();
    }
```

In `stop()`, after `this.frameReaderActive = false;`:

```ts
    if (this.companion) this.companion.readerActive = false;
```

after the primary reader's cancel:

```ts
    if (this.companion?.reader) {
      try {
        await this.companion.reader.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
```

inside the `try`, after the primary video encoder's flush/close and before the audio encoder's:

```ts
      const companionEncoder = this.companion?.encoder;
      if (companionEncoder && companionEncoder.state !== 'closed') {
        await companionEncoder.flush();
        companionEncoder.close();
      }
```

and replace the delivery with:

```ts
      // Finalize output
      if (this.output) {
        await this.output.finalize();
      }

      const companion = await this.finalizeCompanion();

      // Get the result blob
      const buffer = this.target?.buffer;
      if (buffer) {
        const blob = new Blob([buffer], { type: 'video/webm' });
        this.callbacks.onStop?.(blob, companion);
      } else {
        this.callbacks.onError?.(new Error('Recording failed: no data was written'));
      }
```

In `cleanup()`, before the `videoEncoder = null` block:

```ts
    if (this.companion) {
      const { reader } = this.companion;
      if (reader) {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // Ignore errors
        }
      }
      this.companion.encoder = null;
      this.companion.output = null;
      this.companion.target = null;
      this.companion.packetSource = null;
      this.companion = null;
    }
```

In `dispose()`, inside the `if (this.isRecordingActive)` block: `if (this.companion) this.companion.readerActive = false;`.

In `apps/craft/src/core/recorder.ts`, change the callback type only:

```ts
import type { AudioLevels, RecorderStopCallback, RecordingConfig } from '../store/types';

export interface RecorderCallbacks {
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  /**
   * The finished take. Shared with `WebCodecsRecorder` so one controller
   * callback is assignable to either recorder; MediaRecorder never produces a
   * companion, so this class always calls it with the blob alone.
   */
  onStop?: RecorderStopCallback;
  onError?: (error: Error) => void;
  onAudioLevels?: (levels: AudioLevels) => void;
}
```

- [ ] **Step 5: Run the behaviour tests to verify they pass**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/webcodecs-recorder.test.ts src/core/recorder.test.ts`
Expected: PASS — the whole file, new describe included.

- [ ] **Step 6: Write the failing ceiling suite** — append to `apps/craft/src/core/webcodecsRecorder.perf.test.ts`

```ts
  describe('one take of separate tracks', () => {
    /**
     * Frames offered to each pipeline. The track-processor path is driven by
     * hand here (rather than the setTimeout canvas path the suites above use),
     * because what is being counted is per-encoder conservation and this is the
     * path a real separate-tracks take runs on.
     */
    const FRAMES_PER_TRACK = 30

    it('encodes each frame once per encoder, closes every frame, flushes twice', async () => {
      const processor = installTrackProcessorDouble()
      const webcamStream = createStreamDouble([
        createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
      ])
      try {
        await recorder.initialize(screenStream, webcamStream, micStream, {
          ...baseConfig,
          webcamEnabled: true,
          separateTracks: true,
          microphoneEnabled: true,
          systemAudioEnabled: true,
        })
        recorder.start()

        for (let i = 0; i < FRAMES_PER_TRACK; i++) {
          now += 1000 / CAPTURE_FPS
          processor.pushFrameTo('screen-video', new VideoFrameDouble({}, { timestamp: 0 }))
          processor.pushFrameTo('webcam-video', new VideoFrameDouble({}, { timestamp: 0 }))
          await flush()
        }

        const [screen, webcam] = VideoEncoderDouble.instances
        // Exact conservation, per encoder: one encode per frame offered, and
        // nothing encoded twice. A frame counted on the wrong encoder is a
        // frame in the wrong file.
        expect(VideoEncoderDouble.instances).toHaveLength(2)
        expect(screen.encodes).toHaveLength(FRAMES_PER_TRACK)
        expect(webcam.encodes).toHaveLength(FRAMES_PER_TRACK)
        // Exact: every VideoFrame the take made is closed — the source frames
        // the reader handed over and the re-stamped ones handed to the encoders.
        // A VideoFrame that outlives its encode pins a decoded image in memory,
        // and this mode makes two of them per tick.
        expect(allFramesClosed()).toBe(true)
        // Measured 2026-09-25: 120 VideoFrames for 60 offered (one source frame
        // plus one re-stamped frame per pipeline per tick). Ceiling at 2x.
        expect(getCreatedFrames('VideoFrame').length).toBeLessThanOrEqual(
          4 * 2 * FRAMES_PER_TRACK
        )

        await recorder.stop()

        // Exact: one flush per encoder, one finalize per output, one audio
        // encoder for the whole take — the mix belongs to the primary.
        expect(screen.flushCalls).toBe(1)
        expect(webcam.flushCalls).toBe(1)
        expect(lastAudioEncoder().flushCalls).toBe(1)
        expect(AudioEncoderDouble.instances).toHaveLength(1)
        expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1])
        // Exact: one AudioContext, closed. Two video pipelines must not mean
        // two audio graphs.
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
        expect(raf.pending()).toBe(0)
      } finally {
        uninstallTrackProcessorDouble()
      }
    })
  })
```

Add to that file's imports: `AudioEncoderDouble`, `VideoEncoderDouble`, `VideoFrameDouble`, `getCreatedFrames` from `../test/doubles/webcodecs`; `getMediabunnyState` from `../test/doubles/mediabunny`; `installTrackProcessorDouble`, `uninstallTrackProcessorDouble` from `../test/doubles/mediastream`.

- [ ] **Step 7: Run the ceilings**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/webcodecsRecorder.perf.test.ts`
Expected: PASS (existing ceilings plus the new suite). If `getCreatedFrames('VideoFrame').length` reports something other than 120, correct the comment to the measured figure and keep the assertion at 2× it, rounded up.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/craft/src/core/webcodecs-recorder.ts apps/craft/src/core/recorder.ts \
  apps/craft/src/core/webcodecs-recorder.test.ts apps/craft/src/core/webcodecsRecorder.perf.test.ts \
  apps/craft/src/test/doubles/mediastream.ts
git commit -m "$(cat <<'EOF'
feat(craft): the WebCodecs recorder can record two video tracks on one clock

A separate-tracks take builds a second VideoEncoder and a second Mediabunny
output for the webcam, read through its own MediaStreamTrackProcessor and
stamped by the same nextFrameTiming() as the screen: frames captured at one
clock reading carry one timestamp, so the two blobs are aligned by
construction rather than by measurement. Each encoder keeps its own keyframe
schedule, because each stream is decoded on its own.

The mix stays on the primary output (audio companions are slice 3). A camera
that dies mid-take ends its own pipeline and leaves the screen recording; a
companion with no frames, or one whose muxer refuses, is delivered as null
rather than as an empty row — never at the cost of the primary blob.

The track-processor double gains a queue per processor, without which two
loops would share one frame queue. Ceilings: one encode per frame per encoder,
every frame closed, two flushes, two finalizes, one AudioContext.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 6: Wiring — the factory, a preview-only compositor, and the controller

**Files:**
- Modify: `apps/craft/src/core/recorder-factory.ts` (whole file)
- Modify: `apps/craft/src/core/compositor.ts:108-130`
- Modify: `apps/craft/src/hooks/useRecordingController.ts:298-410`
- Modify: `apps/craft/src/test/doubles/recorder.ts:14-19`, `:53-118`, `:148-200`
- Test: `apps/craft/src/core/recorder-factory.test.ts`, `apps/craft/src/core/compositor.test.ts`, `apps/craft/src/hooks/useRecordingController.test.ts`

**Interfaces:**
- Produces: `canUseWebCodecsRecorder(isPiP?: boolean, hasVideoSource?: boolean, separateTracks?: boolean): boolean`; `createRecorder(callbacks, isPiP?, hasVideoSource?, separateTracks?): AnyRecorder`; `getRecorderType(isPiP?, hasVideoSource?, separateTracks?): 'webcodecs' | 'mediarecorder'`; `Compositor#startPreviewOnly(frameRate?: number): void`.
- Consumes: `canRecordSeparateTracks()` (Task 4), `SaveRecording`'s third argument (Task 2), `CompanionPart` (Task 1).
- Produces (test double): `RecorderDouble.separateTracks`, `RecorderDouble.companionPart`.

- [ ] **Step 1: Write the failing factory and compositor tests**

Append to `apps/craft/src/core/recorder-factory.test.ts`, inside the existing describes:

```ts
    it('lets a PiP take reach WebCodecs when it is recording separate tracks', () => {
      // The compositor's hidden <video> elements are what break WebCodecs frame
      // capture, and a separate-tracks take does not capture through it: the
      // recorder reads the raw screen and webcam tracks, and the compositor
      // only draws the preview.
      expect(canUseWebCodecsRecorder(true, true, true)).toBe(true)
      expect(getRecorderType(true, true, true)).toBe('webcodecs')
    })

    it('still refuses an audio-only take that asks for separate tracks', () => {
      expect(canUseWebCodecsRecorder(false, false, true)).toBe(false)
    })
```

and in the `createRecorder` describe:

```ts
    it('should create WebCodecsRecorder for a separate-tracks PiP take', () => {
      const recorder = createRecorder(callbacks, true, true, true)
      expect(recorder).toBeInstanceOf(WebCodecsRecorder)
      recorder.dispose()
    })
```

Append to `apps/craft/src/core/compositor.test.ts`:

```ts
  it('startPreviewOnly draws without capturing a stream', () => {
    const compositor = new Compositor(1280, 720)
    compositor.setScreenStream(createStreamDouble([createTrackDouble('video')]))

    compositor.startPreviewOnly()

    // A separate-tracks take records the raw tracks, so the canvas is only what
    // the preview shows: captureStream() would sample 30 frames a second into a
    // MediaStream track nothing reads.
    expect(compositor.getOutputStream()).toBeNull()
    expect(compositor.getCanvas()).toBeInstanceOf(HTMLCanvasElement)
    compositor.dispose()
  })
```

(Match the file's existing helpers for building streams; if it already has a local `screenStreamDouble()`, use that instead of the two calls above.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/recorder-factory.test.ts src/core/compositor.test.ts`
Expected: FAIL — `expected false to be true` for the PiP+separateTracks case, and `compositor.startPreviewOnly is not a function`.

- [ ] **Step 3: Implement the factory and the compositor**

`apps/craft/src/core/recorder-factory.ts`:

```ts
/**
 * Check if WebCodecs-based recording can be used for the given mode.
 *
 * WebCodecs recording produces seekable WebM with proper keyframes and Cues.
 * It works reliably for screen-only and webcam-only modes where the video
 * source is a direct stream (not a compositor canvas).
 *
 * **Composited** PiP mode uses MediaRecorder because the compositor's hidden
 * video elements cause frame capture issues with WebCodecs (browsers optimize
 * away decoding for non-visible elements). A **separate-tracks** PiP take is
 * the exception and not a contradiction: there the recorder reads the raw
 * screen and webcam tracks and the compositor only draws the preview, so no
 * frame is ever captured through it (ESCSUITE-14).
 *
 * An audio-only take (both video sources switched off, which SourceToggles
 * allows) also uses MediaRecorder: WebCodecsRecorder is built around a video
 * track and throws 'No video track available for recording' without one, while
 * MediaRecorder records the mixed audio track perfectly well on its own.
 *
 * @param isPiP - Whether PiP mode is active
 * @param hasVideoSource - Whether the take captures screen or webcam at all
 * @param separateTracks - Whether the webcam is recorded as its own file
 */
export function canUseWebCodecsRecorder(
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): boolean {
  if (!hasVideoSource) return false;
  if (isPiP && !separateTracks) return false;
  // Two pipelines need the track processor as well as WebCodecs; one does not.
  return separateTracks ? canRecordSeparateTracks() : isWebCodecsRecordingSupported();
}

export function createRecorder(
  callbacks: AnyRecorderCallbacks,
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): AnyRecorder {
  if (canUseWebCodecsRecorder(isPiP, hasVideoSource, separateTracks)) {
    console.log(
      `Using WebCodecs-based recorder (seekable output)${separateTracks ? ' (separate tracks)' : ''}`
    );
    return new WebCodecsRecorder(callbacks);
  } else {
    console.log(`Using MediaRecorder-based recorder${isPiP ? ' (PiP mode)' : ''}`);
    return new Recorder(callbacks);
  }
}

export function getRecorderType(
  isPiP: boolean = false,
  hasVideoSource: boolean = true,
  separateTracks: boolean = false
): 'webcodecs' | 'mediarecorder' {
  return canUseWebCodecsRecorder(isPiP, hasVideoSource, separateTracks)
    ? 'webcodecs'
    : 'mediarecorder';
}
```

with `import { WebCodecsRecorder, type WebCodecsRecorderCallbacks } from './webcodecs-recorder';` and `import { canRecordSeparateTracks, isWebCodecsRecordingSupported } from './webcodecsSupport';`.

**Note:** the existing `pip-seekable` guard asserts the console line `Using MediaRecorder-based recorder (PiP mode)`, which is unchanged — the composited arm's string must stay exactly as it is.

`apps/craft/src/core/compositor.ts` — split `start()` over a shared private:

```ts
  /**
   * Start compositing and return the output stream.
   */
  start(frameRate: number = 30): MediaStream {
    this.beginRender(frameRate);
    this.outputStream = this.canvas.captureStream(frameRate);
    return this.outputStream;
  }

  /**
   * Start compositing for the preview alone — no `captureStream`.
   *
   * A separate-tracks take (ESCSUITE-14) records the raw screen and webcam
   * tracks, and the preview is already the canvas itself (`useMediaStreams`
   * appends it to the preview container). Capturing a stream nothing records
   * would sample the canvas 30 times a second for no reader.
   */
  startPreviewOnly(frameRate: number = 30): void {
    this.beginRender(frameRate);
  }

  /** The draw loop both entry points share. */
  private beginRender(frameRate: number): void {
    // A start() on a running compositor replaces its loop. Without this the
    // new chain's handle overwrote the old one's, so stop() cancelled only the
    // newer chain and the first kept drawing until the page went away
    // (ESCSUITE-58). Nothing calls start() twice today; this is the contract.
    // Only the loop is replaced: the previous captureStream() belongs to
    // whoever was handed it, and a canvas capture track is theirs to stop.
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.targetFrameRate = frameRate;
    // 0 is always in the past, so the first render draws immediately.
    this.nextFrameDue = 0;
    this.render();
  }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/core/recorder-factory.test.ts src/core/compositor.test.ts src/core/compositor.perf.test.ts`
Expected: PASS — including `compositor.perf.test.ts`'s untouched `TARGET_FPS + 1` draw count.

- [ ] **Step 5: Teach the recorder double the new argument and the companion**

In `apps/craft/src/test/doubles/recorder.ts`:

```ts
export interface RecorderCallbacksLike {
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: (blob: Blob, companion?: CompanionPart | null) => void
  onError?: (error: Error) => void
  onAudioLevels?: (levels: { microphone: number; system: number }) => void
}
```

`RecorderDouble` gains:

```ts
  /** Whether the take records the webcam as its own file. */
  readonly separateTracks: boolean
  /** The companion handed to onStop, or null for a single-file take. */
  companionPart: CompanionPart | null
```

`createRecorderDouble(callbacks, isPiP, hasVideoSource, separateTracks)` sets `separateTracks`, `companionPart: null`, and `stop()` becomes:

```ts
    stop: vi.fn(async () => {
      if (!recording) return
      recording = false
      paused = false
      callbacks.onStop?.(double.stopBlob, double.companionPart)
    }),
```

`createRecorder` in the factory double takes and forwards the fourth argument; `getRecorderType` mirrors the real rule:

```ts
    getRecorderType: vi.fn((
      isPiP: boolean = false,
      hasVideoSource: boolean = true,
      separateTracks: boolean = false
    ) =>
      !hasVideoSource || (isPiP && !separateTracks) ? 'mediarecorder' : factory.recorderType
    ),
```

Import `type CompanionPart` from `'../../store/types'`.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS — the doubles' defaults keep every existing suite's behaviour (`companionPart` is null, so `onStop` is called with `(blob, null)` and every existing `onStop` handler ignores the second argument).

- [ ] **Step 6: Write the failing controller tests** — append to `apps/craft/src/hooks/useRecordingController.test.ts`

```ts
describe('a separate-tracks take', () => {
  /** The take the toggle asks for: screen + webcam, separateTracks on. */
  function separateHarness(): Harness {
    return makeHarness(
      { screenEnabled: true, webcamEnabled: true, separateTracks: true },
      { screen: screenStreamWithAudio(), webcam: webcamStream() }
    )
  }

  it('hands the recorder the raw screen and webcam tracks', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    const recorder = recorderFactory.last()
    expect(recorder.separateTracks).toBe(true)
    const [call] = recorder.initializeCalls
    // The raw display capture, not the compositor's canvas track: the whole
    // point of the mode is that the webcam is never drawn into the recording.
    expect(call.screen).toBe(harness.streams.screen)
    expect(call.webcam).toBe(harness.streams.webcam)
    expect(call.config.separateTracks).toBe(true)
  })

  it('runs the compositor for the preview only', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    // The canvas is still the preview (useMediaStreams appends it), so PiP is
    // still "active" — but nothing captures a stream off it.
    expect(harness.setIsPiPActive).toHaveBeenCalledWith(true)
    expect(harness.deps.compositorRef.current!.getOutputStream()).toBeNull()
    expect(harness.setPreviewStream).toHaveBeenCalledWith(harness.streams.screen)
  })

  it('labels the take webcodecs, so the save path repairs nothing', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    expect(harness.deps.recorderTypeRef.current).toBe('webcodecs')
  })

  it('passes the companion through to the save', async () => {
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionPart = {
      role: 'webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      startOffset: 0,
    }
    act(() => { recorder.start() })

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      recorder.companionPart
    )
  })

  it('composites into MediaRecorder when the browser cannot serve two tracks', async () => {
    // jsdom has no MediaStreamTrackProcessor, so the real gate answers no here;
    // the factory double's getRecorderType applies the real rule.
    recorderFactory.recorderType = 'webcodecs'
    harness = separateHarness()
    const { result } = renderHook(() => useRecordingController(harness.deps))

    await act(async () => { await result.current.handleStartRecording() })

    const recorder = recorderFactory.last()
    // The mode is resolved ONCE and handed to everything: the factory, the
    // recorder type and the config the recorder initializes with. A config that
    // still said `true` here would have the recorder building a pipeline the
    // browser cannot read.
    expect(recorder.separateTracks).toBe(false)
    expect(recorder.initializeCalls[0].config.separateTracks).toBe(false)
    expect(harness.deps.recorderTypeRef.current).toBe('mediarecorder')
    // ...and the compositor is back in the recording path, as today.
    expect(recorder.initializeCalls[0].screen).not.toBe(harness.streams.screen)
  })
})
```

Add `separateTracks: false` to `resetStore`'s config only if a test needs it explicitly — `defaultConfig` already carries it.

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useRecordingController.test.ts -t 'separate-tracks'`
Expected: FAIL — `expected false to be true` on `recorder.separateTracks`, and `expected MediaStream to be MediaStream` (the compositor's canvas track was handed over instead of the raw screen).

- [ ] **Step 8: Implement the controller wiring**

In `apps/craft/src/hooks/useRecordingController.ts`, add `canUseWebCodecsRecorder` to the factory import, then replace the preview/compositor block and the `isPiP` derivation (`:298-330`) with:

```ts
      // Which take this is, decided once and handed to everything below: the
      // compositor's mode, the factory, the recorder type the save path keys
      // the container repair off, and the config the recorder initializes with.
      // A config that still claimed `separateTracks` in a browser that cannot
      // serve it would have the recorder building a pipeline it cannot read.
      const isPiP = config.screenEnabled && config.webcamEnabled && !!screen && !!webcam;
      const separateTracks =
        isPiP && config.separateTracks && canUseWebCodecsRecorder(true, true, true);
      // Whether there is a video track to encode at all — the same test both
      // recorders apply when they pick one (a stream AND its toggle). Without
      // one the take is audio only, which the WebCodecs recorder cannot serve.
      const hasVideoSource = (config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam);

      // Set up preview
      // This avoids canvas.captureStream() issues with hidden video elements
      if (isPiP && screen && webcam) {
        const videoTrack = screen.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        compositorRef.current = new Compositor(
          settings.width || 1920,
          settings.height || 1080,
          {
            webcamPosition: config.webcamPosition,
            webcamSize: config.webcamSize,
            webcamShape: config.webcamShape,
          }
        );
        compositorRef.current.setScreenStream(screen);
        compositorRef.current.setWebcamStream(webcam);
        if (separateTracks) {
          // The overlay is only what the user watches: the recorder takes the
          // raw tracks, so there is no reader for a canvas capture stream.
          compositorRef.current.startPreviewOnly();
          setPreviewStream(screen);
        } else {
          setPreviewStream(compositorRef.current.start());
        }
        setIsPiPActive(true);
      } else if (screen) {
        setPreviewStream(screen);
      } else if (webcam) {
        setPreviewStream(webcam);
      }
```

Pass the resolved flag on:

```ts
      }, isPiP, hasVideoSource, separateTracks);
      recorderTypeRef.current = getRecorderType(isPiP, hasVideoSource, separateTracks);
```

The recording stream:

```ts
      // This avoids canvas.captureStream() issues with hidden video elements
      let recordingScreen: MediaStream | null = screen;

      if (isPiP && !separateTracks && compositorRef.current) {
        // Composited PiP - use compositor's existing output stream (already created by start())
        // Avoids calling captureStream() a second time, which would double CPU cost
        const compositorStream = compositorRef.current.getOutputStream();
        if (compositorStream) {
          recordingScreen = new MediaStream([
            ...compositorStream.getVideoTracks(),
            ...(screen?.getAudioTracks() || []),
          ]);
        }
      }
      // For single-source recordings (screen-only or webcam-only), and for a
      // separate-tracks take, the recorder gets the raw streams.

      await recorderRef.current.initialize(recordingScreen, webcam, mic, {
        ...config,
        separateTracks,
      });
```

and the stop callback:

```ts
        onStop: (blob, companion) => {
          ...
          saveRecording(blob, recordedDuration, companion).then(() => {
```

- [ ] **Step 9: Run the controller and App suites**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/hooks/useRecordingController.test.ts src/App.recording.test.tsx src/App.saving.test.tsx src/App.rerender.test.tsx`
Expected: PASS — all four, `App.rerender.test.tsx` untouched.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/craft/src/core/recorder-factory.ts apps/craft/src/core/recorder-factory.test.ts \
  apps/craft/src/core/compositor.ts apps/craft/src/core/compositor.test.ts \
  apps/craft/src/hooks/useRecordingController.ts apps/craft/src/hooks/useRecordingController.test.ts \
  apps/craft/src/test/doubles/recorder.ts
git commit -m "$(cat <<'EOF'
feat(craft): route a separate-tracks take through WebCodecs, compositor for preview only

recorder-factory gains a third input. Composited PiP still forces
MediaRecorder — the pip-seekable guard's subject and its console line are
untouched — while a separate-tracks PiP take reaches WebCodecs, because there
nothing captures frames through the compositor's hidden video elements.

The controller resolves the mode once and hands the same answer to the
factory, to recorderTypeRef and to the config the recorder initializes with,
so a browser without MediaStreamTrackProcessor silently records the take it
always did. Compositor.startPreviewOnly() draws without captureStream(): the
canvas is already what the preview shows, and nothing would read the track.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 7: The gate and the toggle — say why, do not hide

**Files:**
- Create: `apps/craft/src/utils/separateTracksReadiness.ts`, `apps/craft/src/utils/separateTracksReadiness.test.ts`
- Create: `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.tsx`, `…/WebcamOverlaySettingsPanel.test.tsx`
- Modify: `apps/craft/src/store/recorderStore.ts:19-27`, `:47-60`, `:85-96`
- Modify: `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx`
- Modify: `apps/craft/src/App.tsx:15`, `:209-215`
- Modify: `apps/craft/src/test/appHarness.tsx:60-78`
- Test: `apps/craft/src/store/recorderStore.test.ts`, `…/WebcamOverlaySettings.test.tsx`

**Interfaces:**
- Produces: `SEPARATE_TRACKS_NO_WEBCODECS_REASON`, `SEPARATE_TRACKS_NO_SPACE_REASON`, `separateTracksBlockedReason(supported: boolean, hasSpace: boolean): string | null`; `SEPARATE_TRACKS_HELP`, `SEPARATE_TRACKS_HELP_ID` (exported from `WebcamOverlaySettings.tsx`); `WebcamOverlaySettings` gains the prop `separateTracksReason: string | null`; `WebcamOverlaySettingsPanel({ config, disabled, onChange })`.
- Consumes: `canRecordSeparateTracks()` (Task 4), `RecorderStore.hasSeparateTracksSpace` (Task 1), `RecordingConfig.separateTracks` (Task 1).

**Exact copy, pinned by the tests below:**

| String | Value |
|---|---|
| Toggle label / `aria-label` | `Record webcam as a separate track` |
| Help paragraph | `Records the screen and the webcam as two files, so the webcam can be moved, resized or removed in the editor. Uses about twice the CPU and storage.` |
| No WebCodecs | `This browser cannot record two tracks at once — Chrome or Edge can.` |
| No headroom | `Not enough storage for two tracks — delete a recording first.` |

- [ ] **Step 1: Write the failing readiness test** — create `apps/craft/src/utils/separateTracksReadiness.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  SEPARATE_TRACKS_NO_SPACE_REASON,
  SEPARATE_TRACKS_NO_WEBCODECS_REASON,
  separateTracksBlockedReason,
} from './separateTracksReadiness'

describe('separateTracksBlockedReason', () => {
  it('is null when the browser can serve it and there is room', () => {
    expect(separateTracksBlockedReason(true, true)).toBeNull()
  })

  it('blames the browser first — that is the fact the user cannot act on', () => {
    expect(separateTracksBlockedReason(false, false)).toBe(SEPARATE_TRACKS_NO_WEBCODECS_REASON)
  })

  it('blames storage when the browser could have served it', () => {
    expect(separateTracksBlockedReason(true, false)).toBe(SEPARATE_TRACKS_NO_SPACE_REASON)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/separateTracksReadiness.test.ts`
Expected: FAIL — `Failed to resolve import "./separateTracksReadiness"`.

- [ ] **Step 3: Implement the readiness helper**

Create `apps/craft/src/utils/separateTracksReadiness.ts`:

```ts
// Why "Record webcam as a separate track" cannot be switched on, and the
// sentence the toggle says out loud when it cannot.
//
// The mirror of `utils/recordReadiness.ts`: a pure gate with its reasons beside
// it rather than in `utils/notices.ts`, because nothing has gone wrong — the
// same reason `NO_STORAGE_SPACE` lives next to the record button's gate and the
// MP4 button's reasons live next to the codec probe.

/**
 * No WebCodecs (Firefox, Safari), or no `MediaStreamTrackProcessor`.
 *
 * The mode needs two `VideoEncoder`s on one clock; two MediaRecorders would
 * produce two files with no shared start time, which is the one property the
 * feature exists for. Naming the browsers that can is the actionable half.
 */
export const SEPARATE_TRACKS_NO_WEBCODECS_REASON =
  'This browser cannot record two tracks at once — Chrome or Edge can.'

/**
 * The storage headroom check, run for roughly double the bitrate.
 *
 * Two encoders write two files, so the same take needs about twice the room.
 * The check errs toward letting you record (see `hasSpaceForRecording`), so
 * reaching this sentence means the browser really did say no.
 */
export const SEPARATE_TRACKS_NO_SPACE_REASON =
  'Not enough storage for two tracks — delete a recording first.'

/**
 * Why the separate-tracks toggle is disabled, or null when it is offered.
 *
 * The browser's answer comes first: a user in Safari cannot act on "not enough
 * storage", and the browser is the truer reason when both are true.
 */
export function separateTracksBlockedReason(
  supported: boolean,
  hasSpace: boolean
): string | null {
  if (!supported) return SEPARATE_TRACKS_NO_WEBCODECS_REASON
  if (!hasSpace) return SEPARATE_TRACKS_NO_SPACE_REASON
  return null
}
```

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/separateTracksReadiness.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write the failing store test** — append to `recorderStore.test.ts`'s `refreshStorageSpace` describe

```ts
    // ESCSUITE-14. Two encoders write two files, so the separate-tracks toggle
    // needs its own headroom answer — measured here, off the click path, beside
    // the one the record button reads.
    it('measures the headroom for two tracks as well as for one', async () => {
      vi.mocked(hasSpaceForRecording).mockImplementation(async (size: number) => size < 80 * 1024 * 1024)

      await useRecorderStore.getState().refreshStorageSpace()

      const { hasStorageSpace, hasSeparateTracksSpace } = useRecorderStore.getState()
      expect(hasStorageSpace).toBe(true)
      expect(hasSeparateTracksSpace).toBe(false)
      expect(hasSpaceForRecording).toHaveBeenCalledWith(50 * 1024 * 1024)
      expect(hasSpaceForRecording).toHaveBeenCalledWith(100 * 1024 * 1024)
    })

    it('treats an estimate that threw as room for both', async () => {
      vi.mocked(hasSpaceForRecording).mockRejectedValue(new Error('no estimate'))

      await useRecorderStore.getState().refreshStorageSpace()

      // Unknown is not full — the same direction this check errs in everywhere.
      expect(useRecorderStore.getState().hasStorageSpace).toBe(true)
      expect(useRecorderStore.getState().hasSeparateTracksSpace).toBe(true)
    })
```

Run: `pnpm --filter @escapesuite/craft exec vitest run src/store/recorderStore.test.ts -t headroom`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 5: Implement the store half**

In `apps/craft/src/store/recorderStore.ts`:

```ts
/**
 * What a separate-tracks take is assumed to cost, as a multiple of a plain one.
 *
 * Two `VideoEncoder`s each carry their own bitrate — the webcam is fewer pixels
 * but VP9 is configured per encoder, not per take — so double is the honest
 * working figure. `hasSpaceForRecording` applies its own buffer and relative
 * floor on top of whatever this asks for.
 */
const SEPARATE_TRACKS_SIZE_FACTOR = 2;
```

initial state, beside `hasStorageSpace: true,`: `hasSeparateTracksSpace: true,`

```ts
  refreshStorageSpace: async () => {
    try {
      // Both answers from one call each, off the click path: the record button
      // reads the first and the separate-tracks toggle the second.
      const [hasStorageSpace, hasSeparateTracksSpace] = await Promise.all([
        hasSpaceForRecording(ESTIMATED_RECORDING_BYTES),
        hasSpaceForRecording(ESTIMATED_RECORDING_BYTES * SEPARATE_TRACKS_SIZE_FACTOR),
      ]);
      set({ hasStorageSpace, hasSeparateTracksSpace });
    } catch {
      // An estimate that threw is "unknown", and unknown is not full — the
      // same call this whole check errs toward everywhere else.
      set({ hasStorageSpace: true, hasSeparateTracksSpace: true });
    }
  },
```

Add `hasSeparateTracksSpace: true,` to `resetRecorderStore` in `apps/craft/src/test/appHarness.tsx`, beside `hasStorageSpace: true,`.

Run: `pnpm --filter @escapesuite/craft exec vitest run src/store/recorderStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing UI tests** — append to `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.test.tsx`

```ts
describe('the separate-tracks toggle', () => {
  it('is off by default, and says what the mode costs', () => {
    renderSettings({ separateTracksReason: null })

    const toggle = screen.getByRole('button', { name: 'Record webcam as a separate track' })
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    // The cost is said before the choice, not after it — the same shape as the
    // silent-MP4 note under the library.
    expect(
      screen.getByText(
        'Records the screen and the webcam as two files, so the webcam can be moved, resized or removed in the editor. Uses about twice the CPU and storage.'
      )
    ).toBeInTheDocument()
  })

  it('reports the config patch when switched on', async () => {
    const { onChange } = renderSettings({ separateTracksReason: null })

    await userEvent.click(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    )

    expect(onChange).toHaveBeenCalledWith({ separateTracks: true })
  })

  it('stays on screen, disabled, with the reason said out loud', () => {
    renderSettings({
      separateTracksReason: 'This browser cannot record two tracks at once — Chrome or Edge can.',
    })

    const toggle = screen.getByRole('button', { name: 'Record webcam as a separate track' })
    expect(toggle).toBeDisabled()
    // Say why, do not hide: the reason is in the title AND in the paragraph the
    // toggle's aria-describedby points at, exactly as the record button and the
    // MP4 button do it.
    expect(
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.')
    ).toBeInTheDocument()
    expect(toggle).toHaveAttribute(
      'aria-describedby',
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.').id
    )
  })

  it('is disabled mid-take like every other overlay control', () => {
    renderSettings({ separateTracksReason: null, disabled: true })

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeDisabled()
  })
})
```

Extend the file's existing render helper so it passes `separateTracksReason` (default `null`) and returns `onChange`; if the file has no helper, add:

```ts
function renderSettings(
  overrides: { separateTracksReason?: string | null; disabled?: boolean; config?: Partial<RecordingConfig> } = {}
) {
  const onChange = vi.fn<(patch: Partial<RecordingConfig>) => void>()
  render(
    <WebcamOverlaySettings
      config={{ ...defaultConfig, screenEnabled: true, webcamEnabled: true, ...overrides.config }}
      disabled={overrides.disabled ?? false}
      separateTracksReason={overrides.separateTracksReason ?? null}
      onChange={onChange}
    />
  )
  return { onChange }
}
```

Create `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.test.tsx`:

```ts
// The overlay panel's own subscription.
//
// The blocked reason is the panel's to compute, not App's: App must not gain a
// selector for a field only this leaf draws (see `App.rerender.test.tsx` and
// the `SourceTogglesPanel` precedent).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WebcamOverlaySettingsPanel } from './WebcamOverlaySettingsPanel'
import { useRecorderStore } from '../../store/recorderStore'
import { defaultConfig } from '../../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
} from '../../test/doubles/webcodecs'
import {
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
} from '../../test/doubles/mediastream'

function renderPanel() {
  render(
    <WebcamOverlaySettingsPanel
      config={{ ...defaultConfig, screenEnabled: true, webcamEnabled: true }}
      disabled={false}
      onChange={vi.fn()}
    />
  )
}

afterEach(() => {
  uninstallTrackProcessorDouble()
  uninstallWebCodecsDoubles()
})

describe('WebcamOverlaySettingsPanel', () => {
  it('offers the toggle where the browser and the storage both allow it', () => {
    installWebCodecsDoubles()
    installTrackProcessorDouble()
    useRecorderStore.setState({ hasSeparateTracksSpace: true })

    renderPanel()

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeEnabled()
  })

  it('disables it with the storage reason when there is no room for two tracks', () => {
    installWebCodecsDoubles()
    installTrackProcessorDouble()
    useRecorderStore.setState({ hasSeparateTracksSpace: false })

    renderPanel()

    expect(
      screen.getByRole('button', { name: 'Record webcam as a separate track' })
    ).toBeDisabled()
    expect(
      screen.getByText('Not enough storage for two tracks — delete a recording first.')
    ).toBeInTheDocument()
  })

  it('disables it with the browser reason where WebCodecs is missing', () => {
    // jsdom, i.e. Firefox and Safari: no VideoEncoder at all.
    useRecorderStore.setState({ hasSeparateTracksSpace: true })

    renderPanel()

    expect(
      screen.getByText('This browser cannot record two tracks at once — Chrome or Edge can.')
    ).toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/WebcamOverlaySettings`
Expected: FAIL — `Failed to resolve import "./WebcamOverlaySettingsPanel"` and `Unable to find an accessible element with the role "button" and name "Record webcam as a separate track"`.

- [ ] **Step 7: Implement the toggle and the panel**

In `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx`, add above the component:

```ts
/**
 * What the separate-tracks mode is for and what it costs, said before the
 * choice rather than after it.
 *
 * Two encoders and two files: about twice the CPU while recording and about
 * twice the bytes afterwards. The wording is pinned by this component's test.
 */
export const SEPARATE_TRACKS_HELP =
  'Records the screen and the webcam as two files, so the webcam can be moved, resized or removed in the editor. Uses about twice the CPU and storage.';

/**
 * The id the toggle's `aria-describedby` points at — the one paragraph that
 * carries either the help text or the reason the toggle is disabled. One
 * paragraph rather than two, because they are never both true.
 */
export const SEPARATE_TRACKS_HELP_ID = 'separate-tracks-help';
```

Extend the props:

```ts
  /**
   * Why the webcam cannot be recorded as its own track, or null when it can.
   * Computed by `WebcamOverlaySettingsPanel` — a fact about the browser and the
   * storage rather than about this panel.
   */
  separateTracksReason: string | null;
```

and add, inside `<div className={styles.webcamControls}>` after the shape toggle:

```tsx
        <div className={styles.sourceToggle} title={separateTracksReason ?? SEPARATE_TRACKS_HELP}>
          <span className={styles.sourceLabel}>Record webcam as a separate track</span>
          <button
            className={`${styles.toggle} ${config.separateTracks ? styles.active : ''}`}
            onClick={() => onChange({ separateTracks: !config.separateTracks })}
            disabled={disabled || separateTracksReason !== null}
            aria-pressed={config.separateTracks}
            aria-label="Record webcam as a separate track"
            aria-describedby={SEPARATE_TRACKS_HELP_ID}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
        <p className={styles.mp4BlockedReason} id={SEPARATE_TRACKS_HELP_ID}>
          {separateTracksReason ?? SEPARATE_TRACKS_HELP}
        </p>
```

Create `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.tsx`:

```tsx
import { useRecorderStore } from '../../store/recorderStore';
import { canRecordSeparateTracks } from '../../core/webcodecsSupport';
import { separateTracksBlockedReason } from '../../utils/separateTracksReadiness';
import { WebcamOverlaySettings } from './WebcamOverlaySettings';
import type { RecordingConfig } from '../../store/types';

interface WebcamOverlaySettingsPanelProps {
  config: RecordingConfig;
  /** True while a take is in progress — the overlay is baked in by then. */
  disabled: boolean;
  /** A partial config patch, exactly as the store's `setConfig` takes it. */
  onChange: (config: Partial<RecordingConfig>) => void;
}

/**
 * The overlay panel's one subscription: whether there is storage headroom for a
 * take at roughly double the bitrate.
 *
 * It is selected here rather than in `App` for the same reason
 * `SourceTogglesPanel` owns `audioLevels` and `RecordingsListPanel` owns
 * `mp4Support`: a field `App` merely passes through still re-renders `App` and
 * every hook it calls. `App.rerender.test.tsx` is the net.
 *
 * `canRecordSeparateTracks()` is asked on every render instead of remembered,
 * exactly as `RecordingsListPanel` asks `isEmbedded()`: it is two `typeof`
 * checks and an `in`, which is cheaper than a store field to keep in step. It
 * comes from `core/webcodecsSupport.ts` rather than from the recorder, so
 * asking it does not pull the muxer into this component's module graph.
 */
export function WebcamOverlaySettingsPanel({
  config,
  disabled,
  onChange,
}: WebcamOverlaySettingsPanelProps) {
  const hasSeparateTracksSpace = useRecorderStore((s) => s.hasSeparateTracksSpace);

  return (
    <WebcamOverlaySettings
      config={config}
      disabled={disabled}
      separateTracksReason={separateTracksBlockedReason(
        canRecordSeparateTracks(),
        hasSeparateTracksSpace
      )}
      onChange={onChange}
    />
  );
}
```

In `apps/craft/src/App.tsx`, swap the import and the element (props unchanged):

```tsx
import { WebcamOverlaySettingsPanel } from './components/WebcamOverlaySettings/WebcamOverlaySettingsPanel';
```

```tsx
          {/* Webcam overlay settings — the panel owns the separate-tracks gate,
              so App gains no selector for it. */}
          {config.screenEnabled && config.webcamEnabled && (
            <WebcamOverlaySettingsPanel
              config={config}
              disabled={isRecordingActive}
              onChange={setConfig}
            />
          )}
```

- [ ] **Step 8: Run the UI tests, the App suites and the rerender contract**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/WebcamOverlaySettings src/App.settings.test.tsx src/App.rerender.test.tsx src/App.mp4rerender.test.tsx`
Expected: PASS — all four; `App.rerender.test.tsx` and `App.mp4rerender.test.tsx` are unmodified.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/craft/src/utils/separateTracksReadiness.ts apps/craft/src/utils/separateTracksReadiness.test.ts \
  apps/craft/src/store/recorderStore.ts apps/craft/src/store/recorderStore.test.ts \
  apps/craft/src/components/WebcamOverlaySettings apps/craft/src/App.tsx apps/craft/src/test/appHarness.tsx
git commit -m "$(cat <<'EOF'
feat(craft): the separate-tracks toggle, off by default, with its reason said out loud

"Record webcam as a separate track" appears in the Webcam Overlay panel — so
only while the webcam is on — and states what the mode costs before the choice
is made: about twice the CPU and storage. Where it cannot be served it stays on
screen, disabled, with the reason in its title and in the paragraph its
aria-describedby points at: the browser's answer first (no WebCodecs or no
MediaStreamTrackProcessor — Firefox and Safari), then the storage headroom,
measured for roughly double the bitrate beside the record button's own check.

The gate is subscribed in a new WebcamOverlaySettingsPanel rather than in App,
the same trade SourceTogglesPanel makes for audioLevels.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 8: The library — companion rows, cascade delete, the interim MP4 note, per-row upload

**Files:**
- Modify: `apps/craft/src/components/RecordingsList/RecordingsList.tsx`
- Modify: `apps/craft/src/components/RecordingsList/RecordingsListPanel.tsx:82-118`
- Modify: `apps/craft/src/utils/uploadToHost.ts`
- Modify: `apps/craft/src/hooks/useRecordingLibrary.ts:50-55`
- Test: `…/RecordingsList.test.tsx`, `…/RecordingsListPanel.test.tsx`, `apps/craft/src/utils/uploadToHost.test.ts`, `apps/craft/src/hooks/useRecordingLibrary.test.ts`

**Interfaces:**
- Produces: `SEPARATE_TRACKS_MP4_NOTE` (exported from `RecordingsList.tsx`); `uploadToHost(id: string, name: string, part?: { role?: RecordingRole; takeId?: string }): Promise<'posted' | 'missing'>`.
- Consumes: `Recording.takeId` / `Recording.role` (Task 1), `orderTakes`'s ordering (Task 3).

**Row behaviour, pinned below:**
- A companion row (`role === 'webcam'`) shows `Webcam track • ` in front of its duration and size; keeps Play, Download WebM, Open in Editor, Delete (+ Upload when embedded); shows **no** MP4 and **no** M4A button.
- "Open in Editor" on either row sends the **primary's** id (`recording.takeId ?? recording.id`).
- The primary of a take that *has* a companion in the list carries the visible interim note — exact copy: `MP4 and M4A cover the screen track only — the webcam track is not included yet.` — and its MP4/M4A buttons point at it. It stays **enabled**: a screen-only MP4 is a real file, and slice 4 makes it a composite.
- Deleting a primary deletes its companions; deleting a companion leaves the primary a plain take (Task 3's grouping).
- Upload posts **that row's own** blob, with `role` and `takeId` added to the payload when the row has them. A plain take's payload is byte-identical to today's.

- [ ] **Step 1: Write the failing list tests** — append to `RecordingsList.test.tsx`

```ts
describe('a take recorded as separate tracks', () => {
  const primary = makeRecording({
    id: 'take-1',
    name: 'Standup Demo',
    takeId: 'take-1',
    role: 'screen',
    hasWebcam: true,
  })
  const companion = makeRecording({
    id: 'part-2',
    name: 'Standup Demo — webcam',
    takeId: 'take-1',
    role: 'webcam',
    hasWebcam: true,
    hasAudio: false,
  })

  it('labels the companion row as the webcam half of its take', () => {
    renderList([primary, companion])

    // The row's own name already ends in "— webcam"; the meta line says what
    // the row *is*, next to the numbers that say how big it is.
    expect(screen.getByText(/^Webcam track • /)).toBeInTheDocument()
  })

  it('offers the companion play, WebM and delete — and no conversions', () => {
    renderList([primary, companion])

    expect(screen.getByRole('button', { name: 'Play Standup Demo — webcam' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Standup Demo — webcam' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Standup Demo — webcam' })).toBeEnabled()
    // MP4 and M4A live on the primary row only: they are the take's downloads,
    // not the part's.
    expect(
      screen.queryByRole('button', { name: 'Download Standup Demo — webcam as MP4' })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Download Standup Demo — webcam as audio (M4A)' })
    ).toBeNull()
  })

  it('sends the take, not the part, to the editor from either row', async () => {
    const { calls } = renderList([primary, companion])

    await userEvent.click(screen.getByRole('button', { name: 'Open Standup Demo — webcam in Editor' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open Standup Demo in Editor' }))

    // One take opens one project: the editor is handed the primary's id both
    // times, and resolves the siblings itself (slice 2).
    expect(calls.onSendToEditor.mock.calls).toEqual([['take-1'], ['take-1']])
  })

  it('says on the primary row that its MP4 is screen-only for now', () => {
    renderList([primary, companion])

    const note = screen.getByText(
      'MP4 and M4A cover the screen track only — the webcam track is not included yet.'
    )
    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' })
    // Enabled: a screen-only MP4 is a real file, and slice 4 makes it a
    // composite. What is not allowed is offering it silently.
    expect(mp4).toBeEnabled()
    expect(mp4.getAttribute('aria-describedby')).toContain(note.id)
  })

  it('drops the note once the companion is gone', () => {
    renderList([primary])

    // The note is about a webcam the download leaves out. With no companion in
    // the list there is nothing left out.
    expect(
      screen.queryByText(
        'MP4 and M4A cover the screen track only — the webcam track is not included yet.'
      )
    ).toBeNull()
  })

  it('says nothing of the sort on a plain take', () => {
    renderList([makeRecording()])

    expect(screen.queryByText(/not included yet/)).toBeNull()
  })
})
```

Extend `renderList` to return `calls` if it does not already.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/RecordingsList/RecordingsList.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /^Webcam track • /`, and the companion's MP4 button is found where it should be absent.

- [ ] **Step 3: Implement the row changes**

In `apps/craft/src/components/RecordingsList/RecordingsList.tsx`, add above the component:

```ts
/**
 * Said on the primary row of a take that has a webcam companion, for as long as
 * MP4 and M4A are the screen part alone.
 *
 * Slice 4 of ESCSUITE-14 makes both downloads composite — the converter will
 * draw the webcam through the take's stored `overlayPlacement` — and this note
 * goes with it. Until then the interim behaviour is acceptable *only* because
 * it is visible: a user who asked for a webcam and got an MP4 without one
 * would otherwise have to find that out by watching the file.
 */
export const SEPARATE_TRACKS_MP4_NOTE =
  'MP4 and M4A cover the screen track only — the webcam track is not included yet.';

/** The id of one row's interim note — one per row, since it is about that take. */
function separateTracksNoteId(id: string): string {
  return `separate-tracks-note-${id}`;
}
```

Inside the component, before `recordings.map`:

```tsx
        {/* Which takes still have a webcam half in the library. A primary whose
            companion was deleted is a plain take again (see `utils/takeOrder.ts`),
            so its downloads leave nothing out and it says nothing. */}
```

```ts
  const takesWithCompanion = new Set(
    recordings
      .filter((recording) => recording.role === 'webcam' && recording.takeId !== undefined)
      .map((recording) => recording.takeId)
  );
```

and inside the row, after the `m4aReason` computation:

```ts
            const isCompanion = recording.role === 'webcam';
            const hasCompanion = takesWithCompanion.has(recording.id);
            const noteId = hasCompanion ? separateTracksNoteId(recording.id) : null;
            // Both notes can apply at once: one is about the browser, one about
            // this take. aria-describedby takes a list.
            const conversionDescribedBy =
              [mp4Note && !converting ? MP4_NOTE_ID : null, noteId]
                .filter((id): id is string => id !== null)
                .join(' ') || undefined;
```

The meta line:

```tsx
                  <div className={styles.recordingMeta}>
                    {isCompanion && 'Webcam track • '}
                    {formatDuration(recording.duration)} •{' '}
                    {(recording.size / 1024 / 1024).toFixed(1)} MB
                  </div>
```

Wrap the two conversion buttons in `{!isCompanion && (<> … </>)}`, using `aria-describedby={conversionDescribedBy}` in place of the previous expression on both, and change the editor button's handler:

```tsx
                  <button
                    className={styles.iconButton}
                    onClick={() => onSendToEditor(recording.takeId ?? recording.id)}
                    title="Open in Editor"
                    aria-label={`Open ${recording.name} in Editor`}
                  >
```

with a comment above it:

```tsx
                  {/* One take opens one project: either row hands over the
                      primary's id and the editor resolves the siblings. */}
```

After the `converting && (…)` block, inside the row:

```tsx
                {noteId && (
                  <p className={styles.mp4BlockedReason} id={noteId}>
                    {SEPARATE_TRACKS_MP4_NOTE}
                  </p>
                )}
```

- [ ] **Step 4: Run the list tests**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/components/RecordingsList/RecordingsList.test.tsx`
Expected: PASS — the whole file, existing tests included.

- [ ] **Step 5: Write the failing upload and delete tests**

Append to `apps/craft/src/utils/uploadToHost.test.ts`:

```ts
  it('names the part when the row is half of a take', async () => {
    // Slice 1 keeps UPLOAD_RECORDING per row: each row posts its own bytes, and
    // the two new fields say which half the host is being handed. Slice 4 adds
    // `payload.parts` and the adoption note for hosts that want the whole take.
    vi.mocked(getVideoBlob).mockResolvedValue(BLOB)

    await uploadToHost('part-2', 'Standup Demo — webcam', { role: 'webcam', takeId: 'take-1' })

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'UPLOAD_RECORDING',
        payload: { id: 'part-2', name: 'Standup Demo — webcam', blob: BLOB, role: 'webcam', takeId: 'take-1' },
      },
      '*'
    )
  })
```

(Use the file's own double names for `getVideoBlob`, `postMessage` and its blob constant; the existing test asserting the three-field payload must keep passing untouched.)

Append to `apps/craft/src/hooks/useRecordingLibrary.test.ts`:

```ts
  it('deletes a take with its webcam companion', async () => {
    const primary = recording('take-1', 'Standup Demo')
    const companion = { ...recording('part-2', 'Standup Demo — webcam'), takeId: 'take-1', role: 'webcam' as const }
    const { result } = mountLibrary([{ ...primary, takeId: 'take-1', role: 'screen' as const }, companion])

    await act(async () => { await result.current.handleDeleteRecording('take-1') })

    // One take is one thing to delete. A companion left behind would be a
    // webcam file with no take, taking room the user thought they freed.
    expect(vi.mocked(deleteVideo).mock.calls.map(([id]) => id)).toEqual(['take-1', 'part-2'])
    expect(removed).toEqual(['take-1', 'part-2'])
  })

  it('leaves the primary alone when the companion is deleted', async () => {
    const companion = { ...recording('part-2', 'Standup Demo — webcam'), takeId: 'take-1', role: 'webcam' as const }
    const { result } = mountLibrary([{ ...recording('take-1', 'Standup Demo'), takeId: 'take-1', role: 'screen' as const }, companion])

    await act(async () => { await result.current.handleDeleteRecording('part-2') })

    // The primary keeps its own takeId; with nothing grouped under it the row
    // renders as a plain take, so no stored metadata is rewritten.
    expect(vi.mocked(deleteVideo).mock.calls.map(([id]) => id)).toEqual(['part-2'])
    expect(removed).toEqual(['part-2'])
  })
```

(Match the file's existing helper names — `recording(...)`, `mountLibrary(...)`, the `removed` array — adding them if absent.)

Append to `RecordingsListPanel.test.tsx`:

```ts
  it('hands the host the part it clicked, named', async () => {
    const companion = { ...baseRecording, id: 'part-2', name: 'Take — webcam', takeId: 'take-1', role: 'webcam' as const }
    renderPanel([{ ...baseRecording, id: 'take-1', takeId: 'take-1', role: 'screen' as const }, companion])

    await userEvent.click(screen.getByRole('button', { name: 'Upload Take — webcam to host' }))

    expect(uploadToHostMock).toHaveBeenCalledWith('part-2', 'Take — webcam', {
      role: 'webcam',
      takeId: 'take-1',
    })
  })
```

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/uploadToHost.test.ts src/hooks/useRecordingLibrary.test.ts src/components/RecordingsList/RecordingsListPanel.test.tsx`
Expected: FAIL — `expected "postMessage" to have been called with …` (extra fields missing) and `expected [ 'take-1' ] to deeply equal [ 'take-1', 'part-2' ]`.

- [ ] **Step 6: Implement upload, the panel lookup and the cascade**

`apps/craft/src/utils/uploadToHost.ts`:

```ts
export const uploadToHost = async (
  id: string,
  name: string,
  /**
   * Which half of which take this row is, when it is one.
   *
   * Slice 1 keeps the message per row: each row posts its own bytes, and these
   * two optional fields say what the host is holding. A host that knows nothing
   * of takes receives exactly the payload it always did, because the fields are
   * only added when the row has them. `payload.parts` — one message listing
   * every part — is slice 4, with its own adoption note.
   */
  part?: { role?: RecordingRole; takeId?: string }
): Promise<'posted' | 'missing'> => {
  const blob = await getVideoBlob(id);
  // The row is drawn from store metadata, which can outlive the blob — a
  // failed save, or storage cleared under the tab. Nothing is posted then;
  // the caller says so through the app's one notice channel.
  if (!blob) return 'missing';

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
      },
    },
    targetOrigin
  );
  return 'posted';
};
```

with `import type { RecordingRole } from '../store/types';`.

In `RecordingsListPanel.tsx`, inside `handleUploadToHost` (the `RecordingsList` wiring is unchanged, so its own test stays as it is):

```ts
      // The row's own bytes, with which half of which take it is. The panel
      // already has the list, so the component does not need a wider prop.
      const row = recordings.find((recording) => recording.id === id);
      if ((await uploadToHost(id, name, { role: row?.role, takeId: row?.takeId })) === 'missing') {
        setNotice(UPLOAD_UNAVAILABLE);
      }
```

In `useRecordingLibrary.ts`:

```ts
  // Delete a recording, and the companions that belong to it
  const handleDeleteRecording = async (id: string) => {
    // A take is one thing to delete even when it is several files: deleting the
    // screen part takes its webcam part with it. Deleting the companion alone
    // deletes only the companion — the primary keeps its takeId and renders as
    // a plain take (see `utils/takeOrder.ts`), so nothing is rewritten.
    const companions = recordings.filter((r) => r.takeId === id && r.id !== id);

    await deleteVideo(id);
    removeRecording(id);
    for (const companion of companions) {
      await deleteVideo(companion.id);
      removeRecording(companion.id);
    }
    // Never rejects — see the store action.
    void refreshStorageSpace();
  };
```

- [ ] **Step 7: Run the affected suites and the whole craft suite**

Run: `pnpm --filter @escapesuite/craft exec vitest run src/utils/uploadToHost.test.ts src/hooks/useRecordingLibrary.test.ts src/components/RecordingsList`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft test:run`
Expected: PASS (whole suite).

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/craft/src/components/RecordingsList apps/craft/src/utils/uploadToHost.ts \
  apps/craft/src/utils/uploadToHost.test.ts apps/craft/src/hooks/useRecordingLibrary.ts \
  apps/craft/src/hooks/useRecordingLibrary.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the webcam companion is its own library row (ESCSUITE-14)

The companion sits directly under its primary, labelled "Webcam track", and is
playable, WebM-downloadable and deletable on its own. MP4 and M4A live on the
primary row only — and while they still cover the screen part alone, that row
carries a visible note saying so: "MP4 and M4A cover the screen track only —
the webcam track is not included yet." Slice 4 makes both composite and takes
the note with it; the interim behaviour is acceptable only because it is said.

"Open in Editor" on either row hands over the take (the primary's id).
Deleting a primary deletes its companions; deleting the companion leaves a
plain take. Upload stays per row and posts that row's own blob, with role and
takeId added to the payload only when the row has them — a host that knows
nothing of takes receives exactly what it received before.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 9: End-to-end — a real separate-tracks take in Chromium

**Files:**
- Create: `apps/e2e/tests/escapecraft/separate-tracks.spec.ts`

**Interfaces:**
- Consumes: `mockSyntheticMedia`, `grantMediaPermissions` (`apps/e2e/utils/media-mocks.ts`), the drive-a-take shape of `tests/escapecraft/pip-seekable.spec.ts` and `m4a-download.spec.ts`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'

/**
 * ESCAPECRAFT records the webcam as its own file (ESCSUITE-14, slice 1).
 *
 * The take is real: `mockSyntheticMedia` hands the app an animated canvas for
 * the screen, a second one for the camera and an oscillator for the microphone,
 * so `WebCodecsRecorder` genuinely runs two `VideoEncoder`s and two Mediabunny
 * outputs off one clock. What is asserted is the user-visible outcome on both
 * sides of storage: two blobs under one `takeId`, each loading in a `<video>`
 * with a finite duration, and two library rows with the right labels and the
 * right buttons.
 *
 * Chromium only, and that is the feature rather than the test: the mode needs
 * `VideoEncoder` and `MediaStreamTrackProcessor`, and in a browser without them
 * the toggle is disabled with the reason said out loud
 * (`apps/craft/src/utils/separateTracksReadiness.ts`).
 */

const CRAFT_URL = 'http://localhost:5174'

interface StoredPart {
  id: string
  takeId?: string
  role?: string
  hasAudio?: boolean
  hasWebcam?: boolean
  overlayPlacement?: { position: string; size: number; shape: string }
  size: number
  /** What a <video> made of the stored blob: a real number, or "Infinity". */
  reportedDuration: string
}

/**
 * Every stored recording, with what a `<video>` makes of its blob.
 *
 * Read from the page rather than from the app's store: the claim is about what
 * reached IndexedDB, which is what ESCAPEARTIST will open (slice 2).
 */
async function readStoredParts(page: Page): Promise<StoredPart[]> {
  return page.evaluate(
    () =>
      new Promise<StoredPart[]>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        request.onblocked = () => reject(new Error('video-editor-db is blocked by another connection'))
        request.onsuccess = () => {
          let getAll: IDBRequest<unknown[]>
          try {
            getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          } catch (error) {
            reject(new Error(`could not open the videos store — ${String(error)}`))
            return
          }
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = async () => {
            const records = getAll.result as { id: string; blob: Blob; metadata: Record<string, unknown> }[]
            const probe = (blob: Blob) =>
              new Promise<string>((done, fail) => {
                const video = document.createElement('video')
                video.preload = 'metadata'
                const url = URL.createObjectURL(blob)
                video.onloadedmetadata = () => {
                  URL.revokeObjectURL(url)
                  done(String(video.duration))
                }
                video.onerror = () => {
                  URL.revokeObjectURL(url)
                  fail(new Error(`a stored blob would not load in a <video> (${blob.size} bytes)`))
                }
                video.src = url
              })
            try {
              resolve(
                await Promise.all(
                  records.map(async (record) => ({
                    id: record.id,
                    takeId: record.metadata.takeId as string | undefined,
                    role: record.metadata.role as string | undefined,
                    hasAudio: record.metadata.hasAudio as boolean | undefined,
                    hasWebcam: record.metadata.hasWebcam as boolean | undefined,
                    overlayPlacement: record.metadata.overlayPlacement as StoredPart['overlayPlacement'],
                    size: record.blob.size,
                    reportedDuration: await probe(record.blob),
                  }))
                )
              )
            } catch (error) {
              reject(error as Error)
            }
          }
        }
      })
  )
}

test.describe('ESCAPECRAFT separate-tracks recording', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The mode needs WebCodecs and MediaStreamTrackProcessor, and only Chromium can be granted camera permission headlessly'
  )

  test('stores the screen and the webcam as two parts of one take', async ({ page }) => {
    test.setTimeout(120_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Capability detection is async; the source toggles stay disabled until it
    // answers, and a take started before then acquires no stream.
    const sourceButton = (label: string) =>
      page.locator('[class*="sourceToggle"]').filter({ hasText: label }).last().getByRole('button', { name: label })

    await expect(sourceButton('Screen')).toBeEnabled({ timeout: 30_000 })
    const webcam = sourceButton('Webcam')
    await expect(webcam).toBeEnabled({ timeout: 30_000 })
    await webcam.click()
    await expect(webcam).toHaveAttribute('aria-pressed', 'true')

    // The toggle exists only while the webcam is on, and is off by default.
    const separateTracks = page.getByRole('button', { name: 'Record webcam as a separate track' })
    await expect(separateTracks).toBeEnabled({ timeout: 30_000 })
    await expect(separateTracks).toHaveAttribute('aria-pressed', 'false')
    await separateTracks.click()
    await expect(separateTracks).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    // Two rows, so both parts were saved.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(2, {
      timeout: 60_000,
    })

    const parts = await readStoredParts(page)
    expect(parts).toHaveLength(2)
    const primary = parts.find((part) => part.role === 'screen')!
    const companion = parts.find((part) => part.role === 'webcam')!
    // One take in two files.
    expect(primary.takeId).toBe(primary.id)
    expect(companion.takeId).toBe(primary.id)
    // Both are real, seekable WebM — Mediabunny writes Duration and Cues, so
    // neither needs the MediaRecorder repair.
    for (const part of [primary, companion]) {
      expect(part.size).toBeGreaterThan(1000)
      expect(Number.isFinite(Number(part.reportedDuration))).toBe(true)
      expect(Number(part.reportedDuration)).toBeGreaterThan(0)
    }
    // Slice 1 leaves the mixed audio on the primary; the webcam half is silent.
    expect(primary.hasAudio).toBe(true)
    expect(companion.hasAudio).toBe(false)
    expect(primary.hasWebcam).toBe(true)
    // The overlay geometry the take was recorded with, for ARTIST (slice 2) and
    // for the composite MP4 (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'bottom-right',
      size: 0.2,
      shape: 'circle',
    })
    expect(companion.overlayPlacement).toBeUndefined()

    // ...and the library says which row is which, with the right buttons.
    await expect(page.getByText(/^Webcam track • /)).toHaveCount(1)
    await expect(
      page.getByText('MP4 and M4A cover the screen track only — the webcam track is not included yet.')
    ).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Download .+ — webcam as MP4/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Download .+ — webcam as audio \(M4A\)/ })).toHaveCount(0)
    // One WebM download per row, so the webcam file is reachable on its own.
    await expect(page.getByRole('button', { name: /^Download (?!.*as ).+/ })).toHaveCount(2)
  })
})
```

- [ ] **Step 2: Run it and expect it to pass against a dev server**

Check nothing is already on the port: `lsof -nP -iTCP:5174 -sTCP:LISTEN`. The e2e config starts CRAFT itself; if a server is already running it is reused.

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft/separate-tracks.spec.ts --project=chromium`
Expected: `1 passed`. A failure here is a real one — read it rather than loosening the spec. The two most likely: `toHaveCount(2)` on the editor buttons timing out (the companion was not saved — check the browser console for `Separate tracks asked for…` or `No MediaStreamTrackProcessor…`), and `a stored blob would not load in a <video>` (the companion's output was finalized without frames, which Task 5 should have turned into *no* companion).

- [ ] **Step 3: Confirm the guard specs still pass**

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft --project=chromium`
Expected: all pass, `pip-seekable` included — the composited path is untouched.

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/tests/escapecraft/separate-tracks.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): a real separate-tracks take stores two parts of one take

Chromium drives the toggle and a three-second take, then reads IndexedDB: two
blobs sharing a takeId, roles screen and webcam, each loading in a <video> with
a finite duration, the mixed audio and the overlay placement on the primary
only. The library half is asserted in the same spec — the "Webcam track" label,
the interim screen-only note, and no MP4/M4A on the companion row.

Skipped outside Chromium, which is the feature and not the test: without
VideoEncoder and MediaStreamTrackProcessor the toggle is disabled with the
reason said out loud.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 10: The benchmark — `craft-separate-tracks-recording`

**Files:**
- Modify: `apps/e2e/utils/craftPerf.ts:88-206`, `:306-341`, `:381-526`
- Modify: `apps/e2e/tests/perf/craft-recording.spec.ts:51-140`
- Modify: `apps/e2e/scripts/perf-report.mjs:41-50`, `:76-107`
- Modify: `docs/performance/2026-09-17-craft-baseline.md`

**Interfaces:**
- Produces: `CraftPerfCounters.encodesByEncoder: number[]`; `openCraft(page, { webcam, separateTracks? })`; `measureTake(page, cdp, { webcam, separateTracks? }, profileName?)` returning `TakeMeasurement` + `framesEncodedPerEncoder: number[]`.
- Produces (report): benchmark name `craft-separate-tracks-recording` in `ORDER`; metrics `screenFramesEncoded`, `webcamFramesEncoded`.

**Why instance identity and not `codedWidth`:** both synthetic devices are 1280×720 here (`CAPTURE_SIZE`), so a frame's size cannot say which encoder it went to. The wrapper keys a `WeakMap` on the encoder instance and numbers them in the order they first encoded — and the screen pipeline is built and starts first, so index 0 is the screen. Documented in the code, and the tripwire (`length === 2`, both `> 0`) is what fails if that ever stops being true.

- [ ] **Step 1: Attribute encodes per encoder in `craftPerf.ts`**

Replace the counter bag and add the second wrapper inside `installCraftPerfInstrumentation`'s init script:

```ts
/** The extra counter bag this module's init script installs on `window`. */
interface CraftPerfCounters {
  videoDraws: number
  /**
   * Frames handed to each `VideoEncoder`, in the order the encoders first
   * encoded one.
   *
   * A separate-tracks take runs two encoders on the main thread and the shared
   * `encodeCount` cannot tell them apart. Attribution is by **instance
   * identity**, not by the frame's size: both synthetic capture devices here
   * are {@link CAPTURE_SIZE}, so `codedWidth` is the same on both pipelines'
   * frames. The screen pipeline is built and started first
   * (`WebCodecsRecorder.initialize`), so index 0 is the screen — and the
   * benchmark's tripwire is what fails if that stops being true.
   */
  encodesByEncoder: number[]
}
```

```ts
    let encoderIndices = new WeakMap<object, number>()

    const resetShared = window.__perfReset
    window.__perfReset = () => {
      resetShared()
      counters.videoDraws = 0
      counters.encodesByEncoder.length = 0
      // A fresh map with the array: an index kept across a reset would point
      // past the end of it.
      encoderIndices = new WeakMap<object, number>()
    }
```

```ts
    const videoEncoder = (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
    if (videoEncoder) {
      // Chained on top of `installPerfInstrumentation`'s wrapper — init scripts
      // run in the order they were added — so the shared `encodeCount` is
      // unchanged and this only adds the attribution.
      const chainedEncode = videoEncoder.prototype.encode
      videoEncoder.prototype.encode = function attributedEncode(
        this: VideoEncoder,
        ...args: Parameters<VideoEncoder['encode']>
      ) {
        let index = encoderIndices.get(this)
        if (index === undefined) {
          index = counters.encodesByEncoder.length
          encoderIndices.set(this, index)
          counters.encodesByEncoder.push(0)
        }
        counters.encodesByEncoder[index]++
        return chainedEncode.apply(this, args)
      }
    }
```

with `const counters: CraftPerfCounters = { videoDraws: 0, encodesByEncoder: [] }`.

- [ ] **Step 2: Teach `openCraft` and `measureTake` the third arm**

`openCraft`:

```ts
export async function openCraft(
  page: Page,
  options: { webcam: boolean; separateTracks?: boolean }
): Promise<void> {
```

and, after the webcam toggle's `aria-pressed` assertion:

```ts
    if (options.separateTracks) {
      // The opt-in mode (ESCSUITE-14): one recorder, two VideoEncoders, two
      // Mediabunny outputs, and the compositor drawing for the preview only.
      // Confirmed rather than assumed — a click that did not land would report
      // a composited PiP take under this benchmark's name.
      const separate = page.getByRole('button', { name: 'Record webcam as a separate track' })
      await expect(separate).toBeEnabled({ timeout: 30_000 })
      await separate.click()
      await expect(separate).toHaveAttribute('aria-pressed', 'true')
    }
```

`TakeMeasurement` gains:

```ts
  /**
   * Frames handed to each encoder inside the window, screen first. Empty for a
   * MediaRecorder take, which constructs no `VideoEncoder` at all.
   */
  framesEncodedPerEncoder: number[]
```

`measureTake`'s signature becomes `options: { webcam: boolean; separateTracks?: boolean }`; both snapshots read `encodesByEncoder: [...window.__perfCraft.encodesByEncoder]`, and after `const videoDraws = …`:

```ts
  const framesEncodedPerEncoder = end.encodesByEncoder.map(
    (total, index) => total - (start.encodesByEncoder[index] ?? 0)
  )
```

Replace the two-way tripwire branch with three arms:

```ts
  if (options.separateTracks) {
    // This arm's whole claim is "two encoders ran on the main thread and the
    // compositor only drew the preview". Both halves are pinned, because both
    // have a plausible-looking failure: a mode that silently fell back to
    // composited PiP encodes nothing here, and a companion that never started
    // leaves one encoder doing all the work at a respectable rate.
    expect(
      framesEncodedPerEncoder.length,
      `the separate-tracks take ran ${framesEncodedPerEncoder.length} encoder(s), not 2 — the webcam pipeline was not built, or the take fell back to composited PiP`
    ).toBe(2)
    expect(
      Math.min(...framesEncodedPerEncoder),
      `one pipeline encoded nothing (${framesEncodedPerEncoder.join(' / ')}) — a blob with no frames in it is not a track`
    ).toBeGreaterThan(0)
    expect(
      videoDraws,
      'the separate-tracks take did not composite for the preview — the user was watching nothing'
    ).toBeGreaterThan(0)
    // The same /2 divisor as the PiP arm, for the same reason: one screen draw
    // plus one webcam draw per composited preview frame.
    expect(
      videoDraws % 2,
      `the separate-tracks take drew ${videoDraws} videos — an odd count means a capture track was not ready for some frames, so the two-draws-per-composited-frame divisor is wrong`
    ).toBe(0)
  } else if (options.webcam) {
    // …existing PiP assertions, unchanged…
  } else {
    // …existing screen assertions, unchanged…
  }
```

and in the returned object: `framesEncodedPerEncoder,`, plus the two rates made honest for this arm — the encode rate is real here, and so is the composited preview rate:

```ts
    framesPerSecond:
      options.webcam && !options.separateTracks ? 0 : round(framesEncoded / elapsedSeconds),
    ...
    compositedFps: options.webcam ? round(compositedFrames / elapsedSeconds) : 0,
```

and the per-frame divisor:

```ts
  // A separate-tracks take encodes on the main thread like the screen arm does,
  // so its cost divides by frames encoded (both pipelines' frames) rather than
  // by composited preview frames.
  const framesForCost =
    options.webcam && !options.separateTracks ? compositedFrames : framesEncoded
```

Update the class comment's mode table to three entries, and add a sentence to `installCraftPerfInstrumentation`'s doc: *"A separate-tracks take draws into the compositor canvas **and** encodes on the main thread, which is why `videoDraws` and `framesEncoded` are both non-zero there and neither is a fallback signal on its own."*

- [ ] **Step 3: Add the arm to the spec**

In `apps/e2e/tests/perf/craft-recording.spec.ts`, add the third entry to `TAKE_MODES`:

```ts
  {
    name: 'craft-separate-tracks-recording',
    title: 'separate tracks (screen + webcam)',
    webcam: true,
    separateTracks: true,
    mode: 'screen + webcam (separate tracks)',
    recorder: 'webcodecs',
    profile: 'craft-separate-tracks',
  },
```

give the other two entries `separateTracks: false`, pass the flag through both call sites (`openCraft(page, { webcam: arm.webcam, separateTracks: arm.separateTracks })` and `measureTake(page, cdp, { webcam: arm.webcam, separateTracks: arm.separateTracks })`), and publish the two extra numbers:

```ts
        // Per-encoder, screen first: a mode whose whole point is two encoders
        // should report what each of them did. Zero on the other two arms,
        // which keeps one JSON shape across the three rows.
        screenFramesEncoded: median(at('framesEncodedPerEncoder').map((per) => per[0] ?? 0)),
        webcamFramesEncoded: median(at('framesEncodedPerEncoder').map((per) => per[1] ?? 0)),
```

and extend the file's doc comment: the table gains the third row (`craft-separate-tracks-recording` → `WebCodecsRecorder` with two encoders on one clock, compositor for the preview only) and the tripwire paragraph gains "two encoders' frames counted, and the compositor drawing for the preview only".

- [ ] **Step 4: Add it to the report**

In `apps/e2e/scripts/perf-report.mjs`, `ORDER` gains `'craft-separate-tracks-recording',` after `'craft-pip-recording',`, and `METRICS` gains, after `framesPerSecond`:

```js
  screenFramesEncoded: { label: 'Frames encoded (screen)' },
  webcamFramesEncoded: { label: 'Frames encoded (webcam)' },
```

- [ ] **Step 5: Run the benchmark and record the numbers**

Run: `pnpm --filter @escapesuite/e2e exec playwright test --config=playwright.perf.config.ts craft-recording`
Expected: `3 passed`, and three `craft-*` JSON files in `apps/e2e/perf-results/`. Read the console line `craft-separate-tracks-recording runs: […]`.

Run: `node apps/e2e/scripts/perf-report.mjs`
Expected: a Markdown table with `craft-separate-tracks-recording` between the PiP and MP4 rows, carrying both `Frames encoded (screen)` and `Frames encoded (webcam)`.

Then add to `docs/performance/2026-09-17-craft-baseline.md`: a fourth row in the "What is measured" table —

```
| `craft-separate-tracks-recording` | screen + webcam, opt-in: two `MediaStreamTrackProcessor` readers → two `VideoEncoder.encode` **on the main thread** → two Mediabunny muxes, with the `Compositor` drawing the preview only | `WebCodecsRecorder` |
```

— four rows in the tripwire table (`separate tracks` / `framesEncodedPerEncoder.length === 2`; `min(framesEncodedPerEncoder) > 0`; `videoDraws > 0`; `videoDraws % 2 === 0`, each with what a failure means, in the same voice as the existing rows), and a new dated section at the end:

```markdown
## craft-separate-tracks-recording — first measurement, 2026-09-25

Added by ESCSUITE-14 slice 1. Same machine, same launch args and the same
three-runs-median as the numbers above; `pnpm perf` reports it beside the other
three.

| Metric | Median of 3 |
|---|---|
| Frames encoded (screen) | … |
| Frames encoded (webcam) | … |
| Frames/s | … |
| Composited fps (preview only) | … |
| Renderer task duration (ms) | … |
| Renderer task per frame (ms) | … |
| Animation frames/s | … |
| Long tasks / total (ms) | … / … |
| Heap delta (bytes) | … |
| Output size (bytes, screen part) | … |

Fill each cell from this run's `perf-report.json` entry for
`craft-separate-tracks-recording`. What the row is *for* is the comparison
against `craft-pip-recording` directly above it: the same capture, one mode
encoding on the main thread twice over and the other handing one composited
stream to MediaRecorder. `outputBytes` is the **screen** part alone (the
benchmark reads the newest stored blob), so it understates the take's total
bytes by roughly the webcam part — which is the "about twice the storage" the
toggle warns about.
```

Replace every `…` with the measured value from the run; no cell may be left as an ellipsis.

- [ ] **Step 6: Confirm the other two benchmarks did not move in shape**

Run: `git diff apps/e2e/perf-results` is not applicable (gitignored). Instead check the report: the `craft-screen-recording` and `craft-pip-recording` rows still carry the same metric keys they did (the two new keys are present as 0 on both), and their tripwires are unchanged in `craftPerf.ts`.

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint && pnpm --filter @escapesuite/e2e test:scripts`
Expected: no output from the first two; `test:scripts` passes (it covers `profile-top.mjs`, untouched here).

- [ ] **Step 7: Commit**

```bash
git add apps/e2e/utils/craftPerf.ts apps/e2e/tests/perf/craft-recording.spec.ts \
  apps/e2e/scripts/perf-report.mjs docs/performance/2026-09-17-craft-baseline.md
git commit -m "$(cat <<'EOF'
perf(e2e): benchmark a separate-tracks take, with both encoders counted

craft-separate-tracks-recording joins the three ESCAPECRAFT benchmarks, next to
the composited PiP take it is the alternative to. Frames are attributed per
encoder by instance identity — both synthetic devices are 1280x720, so a
frame's codedWidth cannot say which pipeline it came from — and the screen
pipeline is built first, so index 0 is the screen.

Four tripwires, all saying the benchmark measured the wrong thing rather than
that the machine was slow: exactly two encoders ran, neither encoded nothing,
the compositor drew for the preview, and its draw count is even. The existing
two arms' tripwires and metric keys are untouched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 11: Docs, changeset, coverage

**Files:**
- Modify: `apps/craft/CLAUDE.md` (Recording Modes, Core Modules, Recorder lifecycle, Frame timestamps, Download Formats, the module table)
- Modify: `CLAUDE.md` (Data Flow, Integration API)
- Create: `.changeset/craft-separate-tracks.md`
- Modify (only if a floor rises): `apps/craft/vite.config.ts`, `scripts/coverage-report.mjs`, `CLAUDE.md` coverage table

- [ ] **Step 1: `apps/craft/CLAUDE.md` — Recording Modes**

Add under the existing list:

```markdown
- **Picture-in-Picture, separate tracks** (opt-in): the same sources recorded as **two**
  files — the screen and the webcam — instead of one composited overlay

**The two PiP modes are two pipelines, and only one of them is the default.** Composited
PiP is unchanged: the `Compositor` draws the overlay, `canvas.captureStream(30)` feeds
MediaRecorder, and `fixWebMMetadata()` repairs the container at save time — which is what
the `pip-seekable` specs guard. **Separate tracks** (ESCSUITE-14, off by default, toggled in
the Webcam Overlay panel) routes the take through `WebCodecsRecorder` instead: one recorder
holding **two `VideoEncoder`s and two Mediabunny outputs**, both stamped by the one
`nextFrameTiming()` clock, so the two blobs are frame-aligned by construction rather than by
measurement — which is exactly what two MediaRecorders started back to back could not give.
The compositor still runs in that mode but **only for the preview**
(`Compositor.startPreviewOnly()`, no `captureStream`), because its canvas is already what
the preview shows and nothing would read the track.

The mode is **Chromium/Edge only** and says so: `canRecordSeparateTracks()`
(`core/webcodecsSupport.ts`) wants WebCodecs *and* `MediaStreamTrackProcessor`, and
`utils/separateTracksReadiness.ts` turns a "no" into the sentence on the disabled toggle —
the browser's answer first, then the storage headroom, which is measured for roughly double
the bitrate beside the record button's own check. The webcam pipeline is deliberately
track-processor only: the primary keeps its `<video>`+canvas fallback because a take must
record *something*, and where the processor is missing the recorder warns and records the
screen alone.
```

- [ ] **Step 2: `apps/craft/CLAUDE.md` — Core Modules, the module table, the lifecycle and timestamp sections**

- `core/recorder-factory.ts`'s bullet: add "…or the take records separate tracks, which is the one PiP take that *does* reach WebCodecs, because nothing captures frames through the compositor there".
- `core/webcodecs-recorder.ts`'s bullet: "…and, for a separate-tracks take, a second encoder and output for the webcam on the same clock".
- Add `core/webcodecsSupport.ts`: "`isWebCodecsRecordingSupported()` and `canRecordSeparateTracks()` — the two synchronous capability questions, in a module that imports nothing so a component can ask one without pulling `mediabunny` into its graph".
- Add three module-table rows: `utils/separateTracksReadiness.ts` (the gate and its two sentences), `utils/takeOrder.ts` (the library's grouping), `components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.tsx` (the panel's one subscription, `App` gains no selector).
- "Recorder lifecycle": after the `ended` list, add "**A separate-tracks take has a second capture track, and it does not end the take.** The webcam track's `ended` stops only the companion pipeline — the screen keeps recording and `stop()` finalizes a shorter webcam file, or none at all if no frame ever arrived. A companion with no frames, and a companion whose `finalize()` threw, are both delivered as `null`: an empty row in the library and a second ARTIST source with nothing in it are worse than no companion, and neither may ever cost the take its primary blob."
- "Frame timestamps and keyframes": add "**One clock, one bookkeeping record per encoder.** `nextFrameTiming(timing, now)` reads the recorder's shared `startTime`/`pausedDuration` — which is what makes two pipelines' frames one timeline — while the strictly-increasing guard and the once-a-second keyframe rule live in a per-pipeline `FrameTiming`. Sharing those two numbers would have interleaved pipelines pushing each other's timestamps forward and handing the second stream only the keyframes the first did not claim. `webcodecs-recorder.test.ts` pins the property directly: two frames captured at one clock reading carry one timestamp, and each stream's first frame is a keyframe."

- [ ] **Step 3: `apps/craft/CLAUDE.md` — library, storage model and Download Formats**

Add a new subsection after "Download Formats":

```markdown
### A take can be several files

**Storage.** `SourceVideo` carries four optional fields for this (ESCSUITE-14): `takeId`,
`role: 'screen' | 'webcam' | 'mic' | 'system'`, `startOffset` (seconds) and, on the primary
only, `overlayPlacement: { position, size, shape }` copied from the `RecordingConfig` at
save time — the geometry ARTIST seeds the webcam clip's transform from (slice 2) and the
composite MP4 draws through (slice 4). All optional, so **`DB_VERSION` stays 1** and a take
stored before this keeps behaving as a single file. **The take is named by its primary**: the
primary's `takeId` is its own id, so grouping is one equality and cascade delete is
`takeId === deletedId`. A plain take is stored with *no* companion keys at all — absent, not
`undefined` — so a reader cannot mistake one for the other. `hasAudio` is per part, and in
slice 1 the webcam part is silent because the whole mix stays on the primary output.

`hasWebcam` is the fifth field and the reason the `hasWebcam: false // TODO` in
`loadRecordings` is gone: nothing stored said whether a take had a camera in it. It is
written from the config by `buildSourceVideo` exactly as `hasAudio` has been since
ESCSUITE-60, and read back as `m.hasWebcam ?? false` for records saved before it. Nothing is
gated on it, so the fallback costs a legacy row nothing.

**Library.** `loadRecordings` orders through `utils/takeOrder.ts`: newest take first, a
take's companions directly under its primary (by the primary's date, never by the
companion's own — both parts are saved within a millisecond or two and the companion is
written second), and an orphan companion still shown, because a row nobody can see is a file
nobody can delete. The companion row is labelled `Webcam track • …`, is playable,
WebM-downloadable and deletable on its own, and carries **no** MP4 or M4A button: those are
the take's downloads and live on the primary row. "Open in Editor" on either row hands over
`takeId ?? id`, i.e. the take. Deleting the primary deletes its companions; deleting the
companion alone **demotes the primary by construction** — its own `takeId` stays, and with
nothing grouped under it the row renders as a plain take, so no stored metadata is rewritten
on a delete.

**Interim, until slice 4:** MP4 and M4A on a companion take convert the **screen part
alone**. That is acceptable only because it is said out loud — the primary row of a take with
a companion carries `SEPARATE_TRACKS_MP4_NOTE`, "MP4 and M4A cover the screen track only —
the webcam track is not included yet.", and both buttons' `aria-describedby` point at it
(alongside the app-wide `mp4Note` when that applies too). The buttons stay **enabled**: a
screen-only MP4 is a real file. The note goes away when the composite lands, and it goes away
for a row whose companion was deleted, because then nothing is left out.

**`UPLOAD_RECORDING` is still per row** in slice 1: each row posts its own bytes, with
`role` and `takeId` added to the payload only when the row has them — so a host that knows
nothing of takes receives exactly the `{ id, name, blob }` it always did. One message
listing every part (`payload.parts`) is slice 4, with the adoption note for embedders.
```

- [ ] **Step 4: Root `CLAUDE.md`**

Data Flow — replace the diagram block's trailing line with an added note:

```markdown
A **take** is not always one file. Since ESCSUITE-14 a recording made with "Record webcam as
a separate track" is several `SourceVideo`s sharing a `takeId`, each with a `role`
(`'screen' | 'webcam' | 'mic' | 'system'`) and a `startOffset`; the take is named by its
primary (the primary's `takeId` is its own id), and the primary carries the
`overlayPlacement` the webcam was recorded at. Every field is optional and `DB_VERSION` stays
1, so a single-file take — which is every recording made before it and every composited PiP
take after it — is read exactly as before. A consumer that resolves one id should expect
siblings: `getAllVideoMetadata()` filtered on `takeId`.
```

Integration API — extend the CRAFT→host upload bullet:

```markdown
  Since ESCSUITE-14 the payload may also carry `role` and `takeId` (both optional, both
  absent on a single-file take), because a take can be several files and each row posts its
  own bytes. A host that ignores them receives exactly what it received before. One message
  carrying every part of a take is planned as `payload.parts` and will come with its own
  adoption note.
```

and the `?loadVideo=<id>` mention in the URL-params bullet gains: "— the id addresses a take's **primary** part; ARTIST resolving its siblings and placing them on the timeline is ESCSUITE-14 slice 2."

- [ ] **Step 5: The changeset**

Create `.changeset/craft-separate-tracks.md`:

```markdown
---
'@escapesuite/craft': minor
'@escapesuite/shared': minor
---

ESCAPECRAFT can record the webcam as its own track. "Record webcam as a separate track" is a
new opt-in in the Webcam Overlay panel, shown only while the webcam is on and **off by
default**: a take recorded with it on produces two files — the screen and the webcam — from
one recorder driving two encoders off one clock, so the two are frame-aligned by
construction. The webcam half appears as its own row in the library directly under its take,
playable, downloadable and deletable on its own; deleting the take deletes both.

It costs about **twice the CPU and twice the storage**, which the toggle says before you
choose it, and it is **Chromium/Edge only** — it needs WebCodecs and
`MediaStreamTrackProcessor`. Where a browser cannot serve it, or where there is not enough
room for two tracks, the toggle stays on screen and disabled with the reason said out loud;
the composited overlay recording is unchanged and is still what every other browser and every
default take gets.

One interim limit, named on the row it applies to: **MP4 and M4A of a separate-tracks take
cover the screen track only for now** — the webcam track is not included yet. Download the
webcam part's own WebM from its row until the composite lands.

`@escapesuite/shared`: `SourceVideo` gains five optional fields — `takeId`, `role`,
`startOffset`, `overlayPlacement` and `hasWebcam` — and the `RecordingRole` /
`OverlayPlacement` types beside them. The database version is unchanged and every existing
recording is read exactly as before.
```

- [ ] **Step 6: Coverage**

Run: `pnpm --filter @escapesuite/craft test:coverage`
Expected: PASS with no threshold error. Then `pnpm coverage:report` and read craft's four `actual% / threshold%` pairs.

If any *whole percent* floor has risen (lines is already 100, so this is statements, branches or functions), update all three places in one commit: `thresholds` in `apps/craft/vite.config.ts`, craft's entry in `scripts/coverage-report.mjs`, and the root `CLAUDE.md` coverage table plus one sentence in the "Where it stands" paragraph naming this work and the date, in the same voice as the entries already there. If a file is short of 100% lines, add the missing test rather than touching a floor — the likely gaps are `finalizeCompanion`'s two null arms, `initializeCompanion`'s two warnings, and the orphan branch in `orderTakes`, all of which have tests in Tasks 3–5.

Run: `pnpm --filter @escapesuite/shared test:coverage`
Expected: PASS — the shared change is types only, so no line moved.

- [ ] **Step 7: Full verification before the last commit**

Run each and confirm the stated result:

- `pnpm --filter @escapesuite/craft test:run` → PASS
- `pnpm --filter @escapesuite/craft typecheck` → exit 0, no output
- `pnpm --filter @escapesuite/craft lint` → exit 0
- `pnpm --filter @escapesuite/shared test:run && pnpm --filter @escapesuite/shared typecheck` → PASS, exit 0
- `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint` → exit 0
- `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft --project=chromium` → all pass
- `pnpm --filter @escapesuite/craft test:coverage` → PASS

- [ ] **Step 8: Commit**

```bash
git add apps/craft/CLAUDE.md CLAUDE.md .changeset/craft-separate-tracks.md \
  apps/craft/vite.config.ts scripts/coverage-report.mjs
git commit -m "$(cat <<'EOF'
docs(craft): the separate-tracks mode, the storage model and the interim MP4 limit

apps/craft/CLAUDE.md gains the second PiP pipeline (two encoders on one clock,
compositor for the preview only, Chromium-only with the reason said out loud),
"A take can be several files" for the storage model and the library's grouping,
and the note that MP4/M4A cover the screen part alone until slice 4. The root
CLAUDE.md says a take can be several SourceVideos sharing a takeId, in Data
Flow and in the Integration API, and that UPLOAD_RECORDING may now carry role
and takeId without changing what an older host receives.

Changeset: craft minor, shared minor (five optional SourceVideo fields, no
database version change).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage.** Every slice-1 line of the spec's table and of "Consequences the decisions fix in the design" maps to a task: `separateTracks` mode in the WebCodecs recorder → Tasks 4–5; the toggle with its gates → Task 7; two-part save → Task 2; `takeId`/`role`/`startOffset`/`overlayPlacement` metadata → Task 1; grouped library rows and the `hasWebcam` TODO → Tasks 3 and 8; cascade delete → Task 8; benchmark → Task 10. Decision 1 (composited PiP stays the default, MediaRecorder, `pip-seekable` untouched) → Task 6's factory rule plus the guard runs in Tasks 9 and 11. Decision 2 (companion is its own row, labelled, playable, WebM-downloadable, deletable; delete cascades; "Send to Editor" sends the take; MP4/M4A on the primary only) → Task 8. Decision 5 (off by default, disabled with a visible reason for WebCodecs and for headroom at ~double bitrate, label states ~2× CPU and storage, no mid-take mode switch) → Task 7, and "never switches mode mid-take" is structural: Task 6 resolves the flag once, before the countdown, and hands the same answer to the factory, the recorder type and the recorder's config. Decision 6 (the `pip-seekable` guard is moot) → Task 6 keeps the composited arm and its console string byte-identical. Decision 4's `parts` array, decisions 7 and 8's ARTIST placement, and the audio companions are explicitly out of scope and appear only as documented interim behaviour (Task 8's per-row upload with `role`/`takeId`, Task 11's docs and changeset).

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N" — the recorder's two warnings, the two disabled reasons, the help text, the companion name suffix, the `Webcam track • ` prefix and `SEPARATE_TRACKS_MP4_NOTE` are all written out verbatim, and each is asserted somewhere. The one place values cannot be known in advance is the baseline doc's measurement table (Task 10, Step 5), which is why that step names the command that produces them and forbids leaving a cell unfilled.

**3. Type consistency.** `CompanionPart { role: 'webcam'; blob: Blob; startOffset: number }` is defined in Task 1 and used unchanged in Tasks 2, 5 and 6; `RecorderStopCallback` is the single `onStop` type in both recorders (Task 5) and the reason the controller's one callback is assignable to either. `canUseWebCodecsRecorder` / `createRecorder` / `getRecorderType` all take `(isPiP, hasVideoSource, separateTracks)` in that order, in the real factory (Task 6), in the double (Task 6) and at the controller's call sites. `separateTracksBlockedReason(supported, hasSpace)` matches its caller in `WebcamOverlaySettingsPanel`. `orderTakes` is named identically in Task 3's helper, its test and `loadRecordings`. `FrameTiming` / `newFrameTiming` are introduced in Task 4 and consumed in Task 5. `hasSeparateTracksSpace` is the one store field name used in Task 1's type, Task 7's store, its test and the panel. `framesEncodedPerEncoder` (the measurement) and `encodesByEncoder` (the in-page counter) are two deliberately different names for the windowed and cumulative forms, and each is used only where it is defined.
