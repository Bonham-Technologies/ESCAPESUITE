# ESCSUITE-14 slice 3 — CRAFT records the mic and the system audio as companion tracks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** in the existing opt-in "Record webcam as a separate track" mode, the microphone and the system audio are each encoded into their **own Opus-only WebM** by their own `AudioEncoder`, off the same recorder and the same recording clock as the screen and the webcam — stored as `SourceVideo`s with `role: 'mic'` / `'system'` under the take's `takeId`, listed as their own library rows, and lost one at a time rather than together.

**Architecture:** `WebCodecsRecorder`'s single `companion` pipeline becomes a **list** of companion pipelines: one video pipeline (the webcam, unchanged) and up to two audio pipelines. Each audio pipeline is its own `MediaStreamAudioSourceNode` → its own `ScriptProcessorNode` → its own `AudioEncoder` → its own Mediabunny `Output` carrying one Opus track and nothing else. **The primary output keeps the mixed audio track exactly as today** — a screen-only download still has sound, and slice 4's composite still has the mix — so the audio companions are strictly additional. `onStop` grows from `(blob, companion)` to `(blob, companions)`; `useRecordingSave` writes N parts in one pass; the controller, which is the only layer that knows how many companions the take asked for, says one sentence when it gets fewer than that.

**Tech Stack:** React 19 + TypeScript + Vite, Zustand, WebCodecs (`AudioEncoder`, `VideoEncoder`, `MediaStreamTrackProcessor`), Web Audio (`AudioContext`, `ScriptProcessorNode` — the codebase has no `AudioWorklet` anywhere; `webcodecs-recorder.ts:637` and `recorder.ts` both use `createScriptProcessor(4096, 2, 2)` and the doubles model that node, so the audio companions use the same node rather than introducing a second audio-capture mechanism in the same class), Mediabunny (`WebMOutputFormat`, `EncodedAudioPacketSource`), shared IndexedDB (`video-editor-db`, `DB_VERSION` stays 1), Vitest + Testing Library (jsdom) with `src/test/doubles/*`, Playwright (Chromium) for e2e and benchmarks.

**Spec:** `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md` — in particular **§4 "Audio: the same two options, same answer"** (two mono/stereo Opus-only WebMs, `role: 'mic' | 'system'`, same clock via `audioTimestamp`, `hasAudio` per part), the **Decisions** (1, 2, 5), the **Consequences** ("Storage model", "Firefox and Safari") and the **slice-3 row** of the revised estimate table ("CRAFT: mic and system as audio companions on the same clock; per-part `hasAudio`", 2 PR-days). Read it before Task 1.

**Predecessor:** `docs/superpowers/plans/2026-09-25-escsuite-14-slice-1-craft-separate-tracks.md` — slice 1 built everything this extends (the companion pipeline, the two-part save, `orderTakes`, the companion rows, the toggle). Read its Task 5 and Task 8 before Tasks 2–5 here.

**Out of scope (do not build any of it here):**
- Composite MP4 / mixed M4A and `UPLOAD_RECORDING.parts` (slice 4). The interim note on the primary row (`SEPARATE_TRACKS_MP4_NOTE`) stays exactly as it is, and no per-part MP4 or M4A button is added — not even M4A on an audio row. An audio companion's own bytes are reachable through Download WebM on its row, which is what the spec's "a user who wants a part alone downloads its WebM from its row" says.
- Any ARTIST change. Slice 2 already ranks all four roles (`apps/artist/src/utils/takeParts.ts:18`) and already places every part it can (`apps/artist/src/store/clipSlice.ts:132`, `timelinePosition: takeStart + part.startOffset`). Section "ARTIST follow-ups found while planning" below records two gaps; **do not fix them in this slice**.
- ESCSUITE-66 / 67 / 68 hygiene items.

## Global Constraints

1. **Red first for every behaviour change.** The failing test is written and *run*, with the failure quoted in the step notes or the commit message, before the implementation step. The steps below are ordered that way; do not reorder them.
2. **Task 2 is a pure move.** `git diff --stat` at that commit must show **no** file under `apps/craft/src/**/*.test.ts(x)` and no file under `apps/e2e/`. Behaviour, copy and the `onStop` contract are all identical at that commit.
3. **No existing test may be deleted or weakened.** These suites stay green and **untouched**: `apps/craft/src/App.rerender.test.tsx`, `apps/craft/src/App.mp4rerender.test.tsx`, `apps/craft/src/core/compositor.perf.test.ts`, `apps/craft/src/core/recorder.perf.test.ts`, `apps/craft/src/core/recorder.test.ts`, `apps/craft/src/core/recorder-factory.test.ts`, `apps/craft/src/core/webcodecsSupport.test.ts`, `apps/craft/src/utils/separateTracksReadiness.test.ts`, `apps/craft/src/store/recorderStore.test.ts`, `apps/e2e/tests/escapecraft/pip-seekable.spec.ts`, `apps/e2e/tests/production/pip-seekable.spec.ts`, `apps/e2e/tests/escapecraft/m4a-download.spec.ts`, and the `craft-pip-recording` / `craft-screen-recording` tripwires in `apps/e2e/utils/craftPerf.ts`.
   Exactly **seven** existing test files gain *inputs* or *corrected exact counts* (never looser assertions), and each is named in the task that makes the change:
   - `apps/craft/src/utils/recordingMetadata.test.ts` (Task 1 — four `buildRecordingEntry` inputs swap `config` for `hasWebcam`)
   - `apps/craft/src/core/webcodecs-recorder.test.ts` (Task 1 — two assertions read a one-element list; Task 3 — one suite's audio-graph counts become the slice-3 truth)
   - `apps/craft/src/hooks/useRecordingSave.test.ts` (Task 1 — nine call sites pass `[companionPart]`; Task 4 — the notice constant is renamed)
   - `apps/craft/src/hooks/useRecordingController.test.ts` (Task 1 — the double's field is renamed; Task 4 — the notice constant is renamed)
   - `apps/craft/src/test/doubles/recorder.ts` (Task 1 — `companionPart` → `companionParts`)
   - `apps/craft/src/core/webcodecsRecorder.perf.test.ts` (Task 3 — two exact counts corrected, one suite added)
   - `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` (Task 7 — the take gains two audio parts)
   Plus `apps/e2e/utils/craftPerf.ts` (Task 6), which is a utility rather than a suite.
4. **The webcam-companion ceilings are byte-identical apart from three named lines, and this is the plan's one deviation from "ceilings byte-identical".** `webcodecsRecorder.perf.test.ts`'s `'one take of separate tracks'` suite records a take with `microphoneEnabled: true` **and** `systemAudioEnabled: true` and a screen stream that carries an audio track, so after this slice that take genuinely has three `AudioEncoder`s and four `Output`s. Three assertions therefore change, and only these three (Task 3, Step 6):
   - `expect(AudioEncoderDouble.instances).toHaveLength(1)` → `toHaveLength(3)`
   - `expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1])` → `toEqual([1, 1, 1, 1])`
   - the comment above them, which says "one audio encoder for the whole take — the mix belongs to the primary"
   Every **video** assertion in that suite — `VideoEncoderDouble.instances` length 2, the per-encoder encode counts, `allFramesClosed()`, the `4 * 2 * FRAMES_PER_TRACK` frame ceiling, both flush counts, the one-`AudioContext` conservation, `raf.pending()` — is byte-unchanged. The **single-pipeline** ceilings (`'the audio-level monitor'` and `'one take of captured frames'`) are byte-unchanged in full: those takes have `separateTracks: false`, so they build no companion of any kind. `recorder.perf.test.ts` and `compositor.perf.test.ts` are untouched.
5. **New ceilings:** conservation laws **exact** (one `AudioData` per `onaudioprocess` per pipeline, one `encode` per `AudioData`, every `AudioData` closed, one `flush` per encoder, one `finalize` per output); every other count is **2× the measured value rounded up**, with the measured value and the date `2026-09-25` in a comment beside it.
6. **Coverage floors only go up, and craft's lines floor is 100.00 with zero headroom** — every new line must execute in a test. Finish with `pnpm --filter @escapesuite/craft test:coverage`; the floors are `lines: 100, statements: 99, branches: 96, functions: 99` in **both** `apps/craft/vite.config.ts:45-50` and `scripts/coverage-report.mjs:27`. If a figure rises past a whole percent, raise it in both places and in the root `CLAUDE.md` coverage table. Never lower one.
7. **`App.rerender.test.tsx` contract:** no new `App`-level store selector. This slice adds **no store field at all**, so `App.tsx`, `appHarness.tsx` and the rerender suites are not touched; if you find yourself editing `App.tsx`, stop and re-read the task.
8. **New modules go in `src/utils`** — never into `src/core/thumbnailGenerator.ts` or `src/core/converter.ts`, which five suites `vi.mock` wholesale.
9. **Type-only declarations go in `apps/craft/src/store/types.ts`** or `packages/shared/src/types/index.ts`. Both are excluded from craft's coverage `include`; a *new* type-only module would report 0% and break the 100 lines floor. `utils/companionParts.ts` is allowed because it carries runtime values that tests execute.
10. **`packages/shared` is not modified.** `RecordingRole` already declares `'mic'` and `'system'` (`packages/shared/src/types/index.ts:30`) and `SourceVideo` already carries `takeId` / `role` / `startOffset` / `hasAudio` / `hasWebcam`. `DB_VERSION` stays 1. The changeset is `@escapesuite/craft: minor` alone.
11. **Copy is pinned by tests.** Every user-visible and log string below is exact; do not paraphrase in code or in tests. The pinned strings this slice introduces or changes:
    - `SEPARATE_TRACK_NOT_SAVED` = `A separate track could not be saved — the screen recording was kept.`
    - `SEPARATE_TRACKS_HELP` = `Records the screen, the webcam and each audio source as separate files, so the webcam and the sound can be adjusted in the editor. Uses about twice the CPU and storage.`
    - library row prefixes: `Webcam track • ` (unchanged), `Microphone track • `, `System audio track • `
    - stored names: `Recording <date> — webcam` (unchanged), `Recording <date> — microphone`, `Recording <date> — system audio`
    - recorder warnings: `Webcam track encoder failed: <msg>` (unchanged), `Microphone track encoder failed: <msg>`, `System audio track encoder failed: <msg>`; `Webcam track could not be set up:` (unchanged), `Microphone track could not be set up:`, `System audio track could not be set up:`; `The webcam companion could not be flushed:` / `... finalized:` (unchanged), and the same two with `microphone` and `system audio`
    - save warnings: `Webcam track could not be saved:` (unchanged), `Microphone track could not be saved:`, `System audio track could not be saved:`
    - unchanged and **not** to be reworded: the toggle's label and `aria-label` `Record webcam as a separate track`, `SEPARATE_TRACKS_MP4_NOTE`, `SEPARATE_TRACKS_NO_WEBCODECS_REASON`, `SEPARATE_TRACKS_NO_SPACE_REASON`.
12. **Typecheck and lint every task:** `pnpm --filter @escapesuite/craft typecheck` (vitest does not type-check) and `pnpm --filter @escapesuite/craft lint`; for e2e work `pnpm --filter @escapesuite/e2e typecheck` and `pnpm --filter @escapesuite/e2e lint`.
13. **Commit trailers on every commit** (blank line before them):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

14. Branch `feat/escsuite-14-slice-3`, cut from the commit that merges slice 2 (or from `main` if slice 2 is already merged). No push and no PR unless asked.

## Decisions this plan pins

These are the open questions in the brief, answered once here so no task re-opens them.

**D1 — One toggle, and its help text grows.** The spec treats separate tracks as **one mode** (Decision 1: "an explicit opt-in, 'Record webcam as a separate track'"), and the storage gate prices one mode (`SEPARATE_TRACKS_SIZE_FACTOR = 2` in `recorderStore.ts`). A second toggle would let a user ask for a split camera and a mixed sound, which the one-clock design has no reason to offer and the headroom check cannot price. So: **the label and `aria-label` are unchanged** — they are pinned by `WebcamOverlaySettings.test.tsx`, by `separate-tracks.spec.ts:133` and by `craftPerf.ts:259`, and renaming them would be churn for nothing — and only `SEPARATE_TRACKS_HELP` grows to say the audio is split too.

**D2 — `onStop(blob, companions: CompanionPart[] | null)`, `null` when there are none.** A list, because a take now has between zero and three companions. `null` rather than `[]` for "none", because that is what every existing test and both consumers already read (`!companions`), because `Recorder` (MediaRecorder) keeps calling `onStop(blob)` with one argument, and because "this take had no companion" and "this take's companions were all lost" are the same fact to the recorder — telling them apart is the controller's job, and it does it by counting what the take asked for. When there are companions the array is in **role order**: webcam, mic, system.

**D3 — One generalised notice, renamed.** `WEBCAM_TRACK_NOT_SAVED` becomes `SEPARATE_TRACK_NOT_SAVED`, `A separate track could not be saved — the screen recording was kept.` Per-role notices would multiply the one notice channel by three for a sentence the user cannot act on differently, and the channel is deliberately single (`utils/notices.ts`'s header: "Anything that needs a second channel needs a design discussion first"). The **console** warnings stay per role, because those are for whoever is reading the log.

**D4 — Audio parts are stored as audio, and get no thumbnail.** An audio companion is written with `mediaType: 'audio'`, `frameRate: 0`, `width: 0`, `height: 0`, `mimeType: 'audio/webm'`, `hasAudio: true`, `hasWebcam: false` — byte-for-byte the shape ARTIST's own audio importer produces (`apps/artist/src/core/videoProcessor.ts:400-411`), which is what makes an imported audio part behave like an uploaded MP3 everywhere in the editor (`previewGeometry.ts:180`, `drawFrame.ts:131`, `exportMP4.ts:173`, `exportWebM.ts:122` all branch on `mediaType === 'audio'`). It does **not** go through `extractVideoMetadata` — that helper reports `width: video.videoWidth || 1920` (`thumbnailGenerator.ts:195`), i.e. it would store a 1920×1080 audio file — and it does **not** go through `generateThumbnail`, which would decode a file with no picture and land on the placeholder. Its duration is the recorder's `recordedDuration`, which is honest by construction: one recorder, one clock, one `start()`, one `stop()`. With no thumbnail stored, `getThumbnail` resolves `undefined`, `loadRecordings` leaves `thumbnailUrl` unset, and `RecordingsList` already draws the empty `<div className={styles.recordingThumbnail} />` (`RecordingsList.tsx:185`); ARTIST's `takeImport.ts` already treats a missing thumbnail as cosmetic.

**D5 — Each audio pipeline keeps its own presentation clock, from one origin.** The primary's mix counts its own samples into `this.audioTimestamp` (`webcodecs-recorder.ts:659, :666`); each audio companion counts its own into its own `timestampUs`. All of them are reset by the one `start()` and gated by the one `isRecordingActive` / `isPausedState` pair, and all three `ScriptProcessorNode`s are created and connected inside one `initialize()` on one `AudioContext`, so they share its block schedule. That is what "the same `audioTimestamp` clock" means in practice: one origin and one sample-rate arithmetic, not one shared mutable number — three callbacks advancing a single counter would interleave and stamp each other's audio. The residual risk is one 4096-sample buffer (~85 ms) if a callback lands exactly across `start()`, which is the same risk the primary's mix already carries against the two video pipelines.

**D6 — `takeOrder` ranks the roles.** Every part of a take is saved with one `now`, so `createdAt` cannot order three companions; `orderTakes`'s comparator gains a role rank (webcam < mic < system) ahead of its existing `createdAt` comparison, with the id as the final tie-break. Ranking first keeps the existing "oldest-first" test byte-identical (its two companions share a role) and makes the new case deterministic, exactly as ARTIST's `orderTakeParts` already does (`apps/artist/src/utils/takeParts.ts:44-52`).

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/craft/src/utils/companionParts.ts` | Everything that differs per companion role and nothing else: the two label forms and whether the part is sound. The stored name suffix, the library row prefix and five log sentences are all derived from it, so each piece of copy exists once |
| `apps/craft/src/utils/companionParts.test.ts` | Pins the three descriptors and the `screen`/`undefined` answers |

**Modified**

| File | Change |
|---|---|
| `apps/craft/src/store/types.ts` | `CompanionRole`; `CompanionPart.role` widens; `RecorderStopCallback` takes a list |
| `apps/craft/src/utils/recordingMetadata.ts` | Audio parts are written as audio; `buildRecordingEntry` takes `hasWebcam` instead of a config |
| `apps/craft/src/utils/takeOrder.ts` | Companions sort by role rank, then date, then id |
| `apps/craft/src/utils/notices.ts` | `WEBCAM_TRACK_NOT_SAVED` → `SEPARATE_TRACK_NOT_SAVED`, generalised |
| `apps/craft/src/core/webcodecs-recorder.ts` | One list of companion pipelines (Task 2, pure move); the two audio pipelines and the list `onStop` (Task 3) |
| `apps/craft/src/hooks/useRecordingSave.ts` | Writes N companions in reverse role order; the audio parts' own shape; one notice for any number of losses |
| `apps/craft/src/hooks/useRecordingController.ts` | Counts the companions the take asked for; raises the generalised notice |
| `apps/craft/src/components/RecordingsList/RecordingsList.tsx` | Any companion row is labelled and carries no conversions |
| `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx` | `SEPARATE_TRACKS_HELP` mentions the audio |
| `apps/craft/src/test/doubles/recorder.ts` | `companionPart` → `companionParts: CompanionPart[] | null` |
| `apps/e2e/utils/craftPerf.ts` | Three rows per separate-tracks take; a deterministic primary tie-break; an audio-encoder tripwire |
| `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` | A four-part take, the audio parts decoded in-page, the three companion rows |
| `docs/performance/2026-09-17-craft-baseline.md` | The separate-tracks arm re-measured with its audio companions |
| `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md` | The stale `position = startOffset` sentence |
| `apps/craft/CLAUDE.md`, `CLAUDE.md`, `.changeset/craft-audio-companions.md` | Documentation and release note |

## ARTIST follow-ups found while planning (record, do not build)

Raise these as their own tickets in Task 8, Step 6. Neither is a slice-3 change.

1. **An audio part reaches `addClipToTimeline` with `width: 0, height: 0`.** `apps/artist/src/store/clipSlice.ts` builds each take clip's transform from the part's dimensions; a 0×0 source falls through to `DEFAULT_TRANSFORM`, which is the right-looking answer for a clip that is never drawn (`previewGeometry.ts:193` returns `null` for `mediaType === 'audio'`) but is an accident rather than a decision. Worth an explicit "audio parts take no transform" branch.
2. **An imported audio part has no waveform.** `SourceVideo.waveformData` is populated by ARTIST's own uploader (`extractAudioMetadata` + the waveform pass); a part arriving through `takeImport.ts` never gets one, so its timeline clip draws empty. Worth generating it on import for `mediaType === 'audio'` parts.

---

### Task 1: One take, several companions — the shape

**Files:**
- Create: `apps/craft/src/utils/companionParts.ts`
- Create: `apps/craft/src/utils/companionParts.test.ts`
- Modify: `apps/craft/src/store/types.ts:44-67`
- Modify: `apps/craft/src/utils/recordingMetadata.ts` (whole file)
- Modify: `apps/craft/src/utils/takeOrder.ts:19-56`
- Modify: `apps/craft/src/core/webcodecs-recorder.ts:1018-1024` (two lines in `stop()`)
- Modify: `apps/craft/src/hooks/useRecordingSave.ts:32-56`, `:135-136`, `:161-219`
- Modify: `apps/craft/src/hooks/useRecordingController.ts:369-394`
- Modify: `apps/craft/src/test/doubles/recorder.ts:46-48`, `:73`, `:112`
- Test: `apps/craft/src/utils/recordingMetadata.test.ts`, `apps/craft/src/utils/takeOrder.test.ts`, `apps/craft/src/core/webcodecs-recorder.test.ts`, `apps/craft/src/hooks/useRecordingSave.test.ts`, `apps/craft/src/hooks/useRecordingController.test.ts`

**Interfaces:**
- Produces: `CompanionRole = 'webcam' | 'mic' | 'system'` (exported from `store/types.ts`); `CompanionPart { role: CompanionRole; blob: Blob; startOffset: number }`; `RecorderStopCallback = (blob: Blob, companions?: CompanionPart[] | null) => void`.
- Produces: `CompanionPartDescriptor { label: string; trackLabel: string; isAudio: boolean }`; `COMPANION_PARTS: Record<CompanionRole, CompanionPartDescriptor>`; `companionPartFor(role: RecordingRole | undefined): CompanionPartDescriptor | null`.
- Produces: `buildSourceVideo(input: BuildSourceVideoInput): SourceVideo` — unchanged signature, new behaviour for audio roles; `buildRecordingEntry(input: BuildRecordingEntryInput): Recording` where `BuildRecordingEntryInput` replaces `config: Pick<RecordingConfig, 'webcamEnabled'>` with `hasWebcam: boolean` and `thumbnailUrl` becomes optional.
- Produces: `SaveRecording = (rawBlob: Blob, recordedDuration: number, companions?: CompanionPart[] | null) => Promise<void>`.
- Consumes: nothing from a later task.

**What this task does not do:** it does not make the recorder produce more than one companion, and it does not change the save path's behaviour for the webcam companion. It changes the *shape* everything travels in, so Tasks 3 and 4 have somewhere to put the audio parts.

- [ ] **Step 1: Write the failing descriptor test** — create `apps/craft/src/utils/companionParts.test.ts`

```ts
// The one place the three companion roles differ in words.
//
// Every sentence about a part — its stored name, its library row, the five
// things the recorder and the save path can say went wrong with it — is
// derived from this table, so the copy exists once and a fourth role would be
// one entry rather than a grep.
import { describe, it, expect } from 'vitest'
import { COMPANION_PARTS, companionPartFor } from './companionParts'

describe('COMPANION_PARTS', () => {
  it('names each role twice — mid-sentence and sentence-initial', () => {
    expect(COMPANION_PARTS.webcam).toEqual({
      label: 'webcam',
      trackLabel: 'Webcam',
      isAudio: false,
    })
    expect(COMPANION_PARTS.mic).toEqual({
      label: 'microphone',
      trackLabel: 'Microphone',
      isAudio: true,
    })
    expect(COMPANION_PARTS.system).toEqual({
      label: 'system audio',
      trackLabel: 'System audio',
      isAudio: true,
    })
  })
})

describe('companionPartFor', () => {
  it('answers for each companion role', () => {
    expect(companionPartFor('webcam')).toBe(COMPANION_PARTS.webcam)
    expect(companionPartFor('mic')).toBe(COMPANION_PARTS.mic)
    expect(companionPartFor('system')).toBe(COMPANION_PARTS.system)
  })

  it('answers null for the primary and for a row that has no role at all', () => {
    // A primary is not a companion, and every recording made before
    // ESCSUITE-14 has no role stored. Both are "this row is the take".
    expect(companionPartFor('screen')).toBeNull()
    expect(companionPartFor(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing builder tests** — append to `apps/craft/src/utils/recordingMetadata.test.ts`

```ts
describe('buildSourceVideo for an audio companion', () => {
  const base = {
    now: 1_700_000_000_000,
    duration: 6,
    // An audio file has no picture, and saying 1920x1080 would be a lie the
    // editor reads. This is the exact shape ESCAPEARTIST's own audio importer
    // produces (core/videoProcessor.ts extractAudioMetadata).
    width: 0,
    height: 0,
    hasAudio: true,
    hasWebcam: false,
    takeId: 'take-1',
    startOffset: 0,
  }

  it('stores the microphone part as audio, named after its take', () => {
    const sourceVideo = buildSourceVideo({
      ...base,
      id: 'part-mic',
      blob: new Blob(['mic'], { type: 'audio/webm' }),
      role: 'mic',
    })

    expect(sourceVideo.name).toBe(
      `Recording ${new Date(base.now).toLocaleString()} — microphone`
    )
    expect(sourceVideo).toMatchObject({
      mediaType: 'audio',
      frameRate: 0,
      width: 0,
      height: 0,
      mimeType: 'audio/webm',
      hasAudio: true,
      hasWebcam: false,
      role: 'mic',
      takeId: 'take-1',
    })
  })

  it('stores the system-audio part as audio, named after its take', () => {
    const sourceVideo = buildSourceVideo({
      ...base,
      id: 'part-system',
      blob: new Blob(['system'], { type: 'audio/webm' }),
      role: 'system',
    })

    expect(sourceVideo.name).toBe(
      `Recording ${new Date(base.now).toLocaleString()} — system audio`
    )
    expect(sourceVideo.mediaType).toBe('audio')
    expect(sourceVideo.frameRate).toBe(0)
  })

  it('leaves the webcam part and the primary as video', () => {
    const webcam = buildSourceVideo({
      ...base,
      id: 'part-webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      width: 640,
      height: 480,
      hasAudio: false,
      hasWebcam: true,
      role: 'webcam',
    })
    const primary = buildSourceVideo({
      ...base,
      id: 'take-1',
      blob: new Blob(['screen'], { type: 'video/webm' }),
      width: 1280,
      height: 720,
      hasWebcam: true,
      role: 'screen',
    })

    expect(webcam.mediaType).toBe('video')
    expect(webcam.frameRate).toBe(30)
    expect(primary.mediaType).toBe('video')
    expect(primary.frameRate).toBe(30)
  })
})

describe('buildRecordingEntry carries hasWebcam rather than the config', () => {
  it('takes the answer it is given, so a part can differ from the take', () => {
    // The audio halves of a webcam take have no camera in them, and the list
    // entry has to say the same thing the stored record does — the same rule
    // `hasAudio` has followed since ESCSUITE-60.
    const entry = buildRecordingEntry({
      sourceVideo: {
        id: 'part-mic',
        name: 'Recording — microphone',
        duration: 6,
        takeId: 'take-1',
        role: 'mic',
      },
      now: 1_700_000_000_000,
      size: 2048,
      hasWebcam: false,
      hasAudio: true,
    })

    expect(entry).toMatchObject({
      id: 'part-mic',
      takeId: 'take-1',
      role: 'mic',
      hasWebcam: false,
      hasAudio: true,
    })
    // No thumbnail is stored for an audio part, so the row has none — and the
    // list draws its empty placeholder rather than a broken <img>.
    expect(entry.thumbnailUrl).toBeUndefined()
  })
})
```

- [ ] **Step 3: Update the four existing `buildRecordingEntry` inputs in that file**

In `apps/craft/src/utils/recordingMetadata.test.ts`, the four existing calls (lines ~77, ~103, ~116, ~207) pass `config: { webcamEnabled: X }`. Replace each with `hasWebcam: X`, keeping every assertion exactly as it is. This is an input change, not an assertion change — the entries built are identical.

- [ ] **Step 4: Write the failing ordering test** — append to `apps/craft/src/utils/takeOrder.test.ts`

```ts
  it('orders a take three companions deep by role, not by the order storage returned', () => {
    // Every part of a take is saved with one `now`, so `createdAt` cannot order
    // them and `getRecordingsMetadata()` returns key order, which is uuid order
    // — a coin toss. The role is what says which track is which.
    const ordered = orderTakes([
      row('system-part', 1000, { takeId: 'take', role: 'system', hasAudio: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
      row('mic-part', 1000, { takeId: 'take', role: 'mic', hasAudio: true }),
      row('webcam-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual([
      'take',
      'webcam-part',
      'mic-part',
      'system-part',
    ])
  })

  it('falls back to the id for two companions of one role saved in one millisecond', () => {
    // Rank and date both tie, so something has to decide, and it must not be
    // whatever the engine's sort happened to do.
    const ordered = orderTakes([
      row('b-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('a-part', 1000, { takeId: 'take', role: 'webcam', hasWebcam: true }),
      row('take', 1000, { takeId: 'take', role: 'screen', hasWebcam: true }),
    ])

    expect(ordered.map(r => r.id)).toEqual(['take', 'a-part', 'b-part'])
  })
```

- [ ] **Step 5: Write the failing list-delivery tests** — in `apps/craft/src/core/webcodecs-recorder.test.ts`, change **two** assertions inside the `'separate tracks'` describe

In `'flushes both encoders, finalizes both outputs and delivers two blobs'` (line ~1276):

```ts
      const [blob, companions] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      // A take can have up to three companions now (ESCSUITE-14 slice 3), so
      // the callback carries a list in role order — webcam, mic, system.
      expect(companions).toEqual([
        {
          role: 'webcam',
          blob: expect.any(Blob),
          startOffset: 0,
        },
      ])
```

In `'keeps recording the screen when the webcam dies mid-take'` (line ~1307):

```ts
      expect(callbacks.onStop.mock.calls[0][1]).toMatchObject([{ role: 'webcam' }])
```

Every `expect(companion).toBeNull()` in that describe stays **byte-identical**: `null` is still what a take with no companion delivers (D2).

- [ ] **Step 6: Run the four suites to verify they fail**

Run: `pnpm --filter @escapesuite/craft test -- src/utils/companionParts.test.ts src/utils/recordingMetadata.test.ts src/utils/takeOrder.test.ts src/core/webcodecs-recorder.test.ts`

Expected: FAIL — `Failed to resolve import "./companionParts"`; `expected 'Recording … ' to be 'Recording … — microphone'` and `expected 'video' to be 'audio'`; `expected [ 'take', 'mic-part', 'system-part', 'webcam-part' ] to deeply equal [ 'take', 'webcam-part', 'mic-part', 'system-part' ]`; `expected { role: 'webcam', … } to deeply equal [ { role: 'webcam', … } ]`.

- [ ] **Step 7: Create `apps/craft/src/utils/companionParts.ts`**

```ts
// The one place the three companion roles differ in words.
//
// A take is several files now (ESCSUITE-14), and almost everything that
// follows from that is the same sentence with a different noun in it: the
// stored part's name, the library row's prefix, and the five things that can
// be said to have gone wrong with a part. Keeping the nouns here means each
// piece of copy exists once, a fourth role is one entry rather than a grep,
// and the tests that pin the wording have one place to point at.
//
// Two forms of the same noun, because English: `label` goes mid-sentence
// ("the webcam companion could not be flushed"), `trackLabel` starts one
// ("Webcam track could not be saved"). Deriving one from the other would work
// for two of the three and break on "system audio".
import type { CompanionRole, RecordingRole } from '../store/types'

export interface CompanionPartDescriptor {
  /** Mid-sentence: "the {label} companion could not be finalized". */
  label: string
  /** Sentence-initial: "{trackLabel} track could not be saved". */
  trackLabel: string
  /** Whether this part is sound rather than pictures — see `recordingMetadata`. */
  isAudio: boolean
}

export const COMPANION_PARTS: Record<CompanionRole, CompanionPartDescriptor> = {
  webcam: { label: 'webcam', trackLabel: 'Webcam', isAudio: false },
  mic: { label: 'microphone', trackLabel: 'Microphone', isAudio: true },
  system: { label: 'system audio', trackLabel: 'System audio', isAudio: true },
}

/**
 * The descriptor for a stored part's role, or null when the part is the take
 * itself.
 *
 * `undefined` and `'screen'` are the same answer on purpose: a recording made
 * before ESCSUITE-14 has no role at all, and the primary of a companion take
 * has `'screen'`. Neither is a companion.
 */
export function companionPartFor(
  role: RecordingRole | undefined
): CompanionPartDescriptor | null {
  return role === undefined || role === 'screen' ? null : COMPANION_PARTS[role]
}
```

- [ ] **Step 8: Widen the craft types** — `apps/craft/src/store/types.ts`, replacing lines 44-67

```ts
/**
 * Which half of a take a companion file is. The primary is not one of these —
 * it is the take.
 */
export type CompanionRole = 'webcam' | 'mic' | 'system';

/**
 * One of the extra blobs a separate-tracks take produces, handed to the save
 * path by the recorder's `onStop`.
 *
 * `startOffset` is 0 for every part in this build: one clock, one `start()`,
 * every pipeline's first unit stamped from the same origin. It is carried
 * rather than assumed because it is a fact about a take worth writing down —
 * and because a future pipeline that genuinely starts late (a source attached
 * mid-take) would have nowhere else to say so.
 */
export interface CompanionPart {
  role: CompanionRole;
  blob: Blob;
  startOffset: number;
}

/**
 * What a recorder calls when a take is finished.
 *
 * The second argument is the take's companions, in role order — webcam, then
 * mic, then system — or `null` when there are none. `null` rather than an
 * empty array because that is what "this take is one file" has always meant on
 * this callback, and because the recorder cannot tell "never asked for one"
 * from "asked and lost them all": only the controller, which resolved the mode
 * before the countdown, knows how many the take asked for.
 *
 * Both recorders declare this signature even though only `WebCodecsRecorder`
 * ever passes companions: one type means the controller's single `onStop` is
 * assignable to either recorder's callbacks, with no union narrowing at the
 * call site. `Recorder` (MediaRecorder) calls it with the blob alone.
 */
export type RecorderStopCallback = (
  blob: Blob,
  companions?: CompanionPart[] | null
) => void;
```

- [ ] **Step 9: Rewrite the builders** — `apps/craft/src/utils/recordingMetadata.ts`

Replace the imports and the two functions' relevant parts:

```ts
import type {
  SourceVideo,
  Recording,
  RecordingRole,
  OverlayPlacement,
} from '../store/types';
import { companionPartFor } from './companionParts';
```

(`RecordingConfig` is no longer imported — `buildRecordingEntry` takes the answer rather than the config.)

In `buildSourceVideo`, replace the returned object's `name`, `frameRate` and `mediaType`:

```ts
  const takeName = `Recording ${new Date(now).toLocaleString()}`;
  // The role's own noun, from the one table that has it. Both parts of a take
  // are saved with the same `now`, so a companion's name is the take's name
  // with its half named — which is what its own WebM download is called and
  // what ARTIST shows as the source's name.
  const part = companionPartFor(role);
  return {
    id,
    name: part ? `${takeName} — ${part.label}` : takeName,
    duration,
    width,
    height,
    // An audio part has no frames to rate. 0 rather than 30 because that is
    // what ESCAPEARTIST's own audio importer writes (core/videoProcessor.ts),
    // and a part that arrived from a recording should be indistinguishable
    // from one that arrived from a file.
    frameRate: part?.isAudio ? 0 : 30,
    mimeType: blob.type,
    size: blob.size,
    // Everything in ARTIST that decides whether to draw a clip, decode a
    // frame or export a video track branches on this. A mic part written as
    // 'video' would be a black rectangle in the preview and a wasted encode
    // in the export.
    mediaType: part?.isAudio ? 'audio' : 'video',
    source: 'recording',
    recordedAt: now,
    hasAudio,
    hasWebcam,
    ...(takeId !== undefined ? { takeId } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(overlayPlacement !== undefined ? { overlayPlacement } : {}),
  };
```

Replace `BuildRecordingEntryInput` and `buildRecordingEntry`:

```ts
export interface BuildRecordingEntryInput {
  sourceVideo: Pick<SourceVideo, 'id' | 'name' | 'duration' | 'takeId' | 'role'>;
  now: number;
  size: number;
  /**
   * Absent for a part with no thumbnail — an audio companion, which has no
   * picture to decode one from. The list draws its own empty placeholder.
   */
  thumbnailUrl?: string;
  /**
   * Whether this part captured the webcam. Passed in rather than read off the
   * config, for the same reason `hasAudio` is: the config describes the
   * *take*, and the parts of one take do not all answer alike — the audio
   * halves of a webcam take have no camera in them.
   */
  hasWebcam: boolean;
  /**
   * Whether this part captured any audio — the same value `buildSourceVideo`
   * was given. The config cannot answer it: ticking "System Audio" only
   * *asks* for it, and the browser's share dialog has the last word
   * (ESCSUITE-62).
   */
  hasAudio: boolean;
}

/** The recorder's own Recording list entry for a finished recording. */
export function buildRecordingEntry({
  sourceVideo,
  now,
  size,
  thumbnailUrl,
  hasWebcam,
  hasAudio,
}: BuildRecordingEntryInput): Recording {
  return {
    id: sourceVideo.id,
    name: sourceVideo.name,
    duration: sourceVideo.duration,
    createdAt: now,
    size,
    thumbnailUrl,
    hasWebcam,
    hasAudio,
    // Same rule as the stored record: absent on a single-file take, so the
    // library's grouping sees nothing to group.
    ...(sourceVideo.takeId !== undefined ? { takeId: sourceVideo.takeId } : {}),
    ...(sourceVideo.role !== undefined ? { role: sourceVideo.role } : {}),
  };
}
```

- [ ] **Step 10: Rank the roles in `takeOrder`** — `apps/craft/src/utils/takeOrder.ts`

Add above `orderTakes`:

```ts
/**
 * The order a take's companions stack in, mirroring ESCAPEARTIST's
 * `utils/takeParts.ts`: the camera first, then the sound.
 *
 * Typed as plain strings on purpose. `RecordingRole` is a compile-time union
 * and IndexedDB is not type-checked, so "is this a role we know?" has to be a
 * runtime question.
 */
const COMPANION_ROLE_ORDER: readonly string[] = ['webcam', 'mic', 'system'];

/** Where a companion sits in its take's stack; last for a role we do not know. */
function companionRank(role: string | undefined): number {
  const rank = COMPANION_ROLE_ORDER.indexOf(role ?? '');
  return rank === -1 ? COMPANION_ROLE_ORDER.length : rank;
}
```

and replace the companion sort inside the loop (line 42):

```ts
      // Role first: every part of a take is saved with one `now`, so the date
      // cannot order three companions and storage returns them in uuid order.
      // Date second, for two companions of one role saved in two takes' worth
      // of milliseconds. The id last, so the answer never depends on what the
      // engine's sort happened to do.
      companions.sort(
        (a, b) =>
          companionRank(a.role) - companionRank(b.role) ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id)
      );
```

- [ ] **Step 11: Deliver a list from the recorder** — `apps/craft/src/core/webcodecs-recorder.ts`

At line 1018, change `stop()`'s finalize-and-deliver:

```ts
      const companion = await this.finalizeCompanion();

      // Get the result blob
      const buffer = this.target?.buffer;
      if (buffer) {
        const blob = new Blob([buffer], { type: 'video/webm' });
        // A list, because a take can have up to three companions — and `null`
        // rather than `[]` for none, because that is what an ordinary take has
        // always delivered on this callback.
        this.callbacks.onStop?.(blob, companion ? [companion] : null);
      } else {
```

- [ ] **Step 12: Take a list in the save path** — `apps/craft/src/hooks/useRecordingSave.ts`

Change the exported type and the callback's parameter (lines 32-56):

```ts
/** Save a finished take. `recordedDuration` is what the recorder timed. */
export type SaveRecording = (
  rawBlob: Blob,
  recordedDuration: number,
  /**
   * The take's other parts, when the recorder produced any. Only the
   * separate-tracks mode does — see `core/webcodecs-recorder.ts`.
   */
  companions?: CompanionPart[] | null
) => Promise<void>;
```

```ts
  const saveRecording = useCallback(async (
    rawBlob: Blob,
    recordedDuration: number,
    companions?: CompanionPart[] | null
  ) => {
```

At line 135, the take's shape question becomes list-shaped:

```ts
    const isCompanionTake = companions != null && companions.length > 0;
```

At line 161, wrap the existing webcam block in a loop of one. **Keep the body exactly as it is** — Task 4 rewrites it:

```ts
    for (const companion of companions ?? []) {
      try {
        // ... the existing body, unchanged, with `companion` now the loop
        // variable rather than the argument ...
      } catch (error) {
        console.warn('Webcam track could not be saved:', error);
        setNotice(WEBCAM_TRACK_NOT_SAVED);
      }
    }
```

Also swap the two `buildRecordingEntry` calls (lines 207 and 221) from `config,` to `hasWebcam: true,` and `hasWebcam: config.webcamEnabled,` respectively, matching the new input.

- [ ] **Step 13: Take a list in the controller** — `apps/craft/src/hooks/useRecordingController.ts:369-394`

```ts
        onStop: (blob, companions) => {
          if (cancelledRef.current) return;
          if (separateTracks && !companions) {
            setNotice(WEBCAM_TRACK_NOT_SAVED);
          }
          ...
          saveRecording(blob, recordedDuration, companions).then(() => {
```

(The notice's *condition* becomes a count in Task 4; here it only changes shape.)

- [ ] **Step 14: Rename the double's field** — `apps/craft/src/test/doubles/recorder.ts`

```ts
  /** The companions handed to onStop, or null for a single-file take. */
  companionParts: CompanionPart[] | null
```

Initialiser (line ~73): `companionParts: null,`. In `stop()` (line ~112): `callbacks.onStop?.(double.stopBlob, double.companionParts)`. And in `RecorderCallbacksLike`: `onStop?: (blob: Blob, companions?: CompanionPart[] | null) => void`.

Then in `apps/craft/src/hooks/useRecordingController.test.ts`, update the two tests that use it:

```ts
    recorder.companionParts = [{
      role: 'webcam',
      blob: new Blob(['webcam'], { type: 'video/webm' }),
      startOffset: 0,
    }]

    await act(async () => { await result.current.handleStopRecording() })

    expect(harness.saveRecording).toHaveBeenCalledWith(
      recorder.stopBlob,
      expect.any(Number),
      recorder.companionParts
    )
```

and, in `'says the webcam track was lost when the recorder delivers no companion'`, `expect(recorder.companionParts).toBeNull()`.

- [ ] **Step 15: Pass lists in the save tests** — `apps/craft/src/hooks/useRecordingSave.test.ts`

Every `await result.current(RAW, 6, companionPart)` (nine of them, lines ~311, ~342, ~363, ~377, ~388, ~400, ~430 and the two without a companion which are unchanged) becomes `await result.current(RAW, 6, [companionPart])`. No assertion changes.

- [ ] **Step 16: Run everything and verify it passes**

Run: `pnpm --filter @escapesuite/craft test`
Expected: PASS, all files.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no errors.

- [ ] **Step 17: Commit**

```bash
git add apps/craft/src/utils/companionParts.ts apps/craft/src/utils/companionParts.test.ts \
  apps/craft/src/utils/recordingMetadata.ts apps/craft/src/utils/recordingMetadata.test.ts \
  apps/craft/src/utils/takeOrder.ts apps/craft/src/utils/takeOrder.test.ts \
  apps/craft/src/store/types.ts apps/craft/src/core/webcodecs-recorder.ts \
  apps/craft/src/core/webcodecs-recorder.test.ts apps/craft/src/hooks/useRecordingSave.ts \
  apps/craft/src/hooks/useRecordingSave.test.ts apps/craft/src/hooks/useRecordingController.ts \
  apps/craft/src/hooks/useRecordingController.test.ts apps/craft/src/test/doubles/recorder.ts
git commit -m "$(cat <<'EOF'
feat(craft): a take carries a list of companions, not one (ESCSUITE-14)

The webcam is about to stop being the only extra file a take can have, so
everything the one companion travelled in becomes a list: onStop delivers
CompanionPart[] | null, the save path loops, and the controller passes it
through. null still means "no companion" — an ordinary take has always said
that on this callback, and the recorder cannot tell "never asked for one"
from "asked and lost them all".

The words each role differs by move into one table (utils/companionParts.ts)
so the copy exists once, and an audio part is now written as audio: the exact
shape ESCAPEARTIST's own audio importer produces — mediaType 'audio',
frameRate 0, 0x0 — because a part that arrived from a recording should be
indistinguishable from one that arrived from a file. buildRecordingEntry
takes hasWebcam rather than the config for the same reason hasAudio is passed
in: the config describes the take, and the audio halves of a webcam take have
no camera in them.

orderTakes ranks the roles ahead of the date, mirroring ARTIST's
takeParts.ts: every part of a take is saved with one `now`, so the date
cannot order three companions and storage returns them in uuid order.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 2: The recorder holds a list of pipelines (PURE MOVE)

**Files:**
- Modify: `apps/craft/src/core/webcodecs-recorder.ts` (the companion machinery: `:97-124`, `:184-185`, `:386-394`, `:400-568`, `:708-713`, `:969-1034`, `:1187-1201`, `:1220-1229`)
- Test: **none.** No test file may change in this commit.

**Interfaces:**
- Consumes: `CompanionRole`, `CompanionPart` (Task 1); `COMPANION_PARTS` (Task 1).
- Produces (private to the class, relied on by Task 3): `CompanionPipeline = VideoCompanionPipeline | AudioCompanionPipeline`; `private companions: CompanionPipeline[]`; `private failCompanion(companion: CompanionPipeline): void`; `private flushCompanions(): Promise<void>`; `private finalizeCompanions(): Promise<CompanionPart[]>`; `private startCompanionCaptures(): void`.

**Why this is its own commit:** the shape change and the audio pipelines are two different kinds of risk. With the list in place and every existing test still green and untouched, Task 3's diff is only the audio, and a reviewer can read it as such.

- [ ] **Step 1: Replace the pipeline interface with a discriminated pair** — `apps/craft/src/core/webcodecs-recorder.ts:97-124`

```ts
/**
 * What every companion pipeline has, whatever it is recording: its own
 * Mediabunny output, its own count of what it encoded, and its own answer to
 * "is this worth storing?".
 *
 * A companion never shares an output with another, which is the whole point:
 * every ARTIST read path and CRAFT's own converter are single-track by
 * construction (see the design spec, §2), so a second track inside one file
 * would be silently lost rather than visibly missing.
 */
interface CompanionPipelineBase {
  readonly role: CompanionRole;
  output: Output | null;
  target: BufferTarget | null;
  /**
   * Units this pipeline encoded — video frames, or audio buffers. 0 means
   * there is nothing worth storing: an empty row in the library and a second
   * ARTIST source with nothing in it are worse than no companion.
   */
  encodedCount: number;
  /**
   * Set once this pipeline has given up — its encoder errored, or would not
   * flush. The blob is then not worth delivering, so `stop()` leaves it out of
   * the list; the take itself is unaffected.
   */
  failed: boolean;
}

/**
 * The webcam half of a separate-tracks take: its own encoder, its own output,
 * its own frame reader — and the recorder's *shared* clock, which is what
 * makes the blobs frame-aligned by construction.
 *
 * Track-processor only, deliberately: the primary pipeline keeps its
 * `<video>`+canvas fallback because a take has to record something, while the
 * opt-in mode is gated on `canRecordSeparateTracks()` and simply records the
 * screen alone where the API is missing.
 */
interface VideoCompanionPipeline extends CompanionPipelineBase {
  readonly kind: 'video';
  readonly role: 'webcam';
  readonly track: MediaStreamTrack;
  encoder: VideoEncoder | null;
  packetSource: EncodedVideoPacketSource | null;
  reader: ReadableStreamDefaultReader<VideoFrame> | null;
  readerActive: boolean;
  timing: FrameTiming;
}

type CompanionPipeline = VideoCompanionPipeline;
```

(`AudioCompanionPipeline` arrives in Task 3; `CompanionPipeline` is an alias of one member here so nothing in this commit pretends to handle a kind that does not exist yet.)

Import the role table at the top of the file:

```ts
import { COMPANION_PARTS } from '../utils/companionParts';
import type { CompanionRole } from '../store/types';
```

(`CompanionRole` joins the existing type import block at `:15-20`.)

- [ ] **Step 2: Replace the field** — `:184-185`

```ts
  // Every extra file this take is producing beside the primary, in role order.
  // Empty for every take that is not in separate-tracks mode.
  private companions: CompanionPipeline[] = [];
```

- [ ] **Step 3: Build the webcam pipeline into the list** — rewrite `initializeCompanion` (`:400-486`)

The doc comment above it is unchanged. The body becomes:

```ts
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
    // The reader is taken before the guarded section on purpose: getting a
    // reader off a fresh processor's readable cannot fail on its own, and
    // holding it here means the catch below has exactly one definite thing to
    // release — the camera — rather than a set of maybes.
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();

    let companion: VideoCompanionPipeline;
    try {
      const { output, target, packetSource } = this.createVideoOutput();
      // No audio track: the mix stays on the primary output, and the audio
      // companions are their own outputs.
      await output.start();

      companion = {
        kind: 'video',
        role: 'webcam',
        track,
        encoder: null,
        output,
        target,
        packetSource,
        reader,
        readerActive: false,
        timing: newFrameTiming(),
        encodedCount: 0,
        failed: false,
      };

      companion.encoder = await this.createVideoEncoder(
        () => companion.packetSource,
        settings.width || 1280,
        settings.height || 720,
        // ...and the companion's encoder dying costs the take its companion
        // and nothing else. Routing this to onError would have the controller
        // dispose the recorder and throw away a screen recording that is
        // still being made.
        (e) => {
          console.warn(`${COMPANION_PARTS.webcam.trackLabel} track encoder failed: ${e.message}`);
          this.failCompanion(companion);
        }
      );
    } catch (e) {
      console.warn(`${COMPANION_PARTS.webcam.trackLabel} track could not be set up:`, e);
      // Nothing downstream can reach this half any more — it was never pushed
      // onto `companions`, so `stop()` and `cleanup()` both skip it — so let
      // the camera go here. An Output that was started is abandoned
      // unfinalized, exactly as a companion that encoded no frame is.
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors: the pipeline is being abandoned either way.
      }
      return;
    }

    this.companions.push(companion);

    // A camera that stops is not a take that stops: end this pipeline and let
    // the screen keep recording. stop() then finalizes a shorter companion, or
    // none at all if no frame ever arrived.
    const companionEnded = () => {
      console.warn(`Webcam track ended: ${track.label}`);
      companion.readerActive = false;
    };
    track.addEventListener('ended', companionEnded);
    this.trackEndedHandlers.set(track, companionEnded);
  }
```

Note the two behaviour-preserving details: `createVideoEncoder`'s `sourceOf` now closes over the local `companion` instead of reaching through `this.companion`, and the encoder is assigned after construction because the object has to exist first. A `configure()` that rejects still leaves nothing on `companions`, which is what the existing test `'records the screen alone when the webcam pipeline cannot be set up'` asserts (`processor.cancelCalls()` is 1 and exactly one pipeline captures).

- [ ] **Step 4: Loop the four lifecycle helpers** — replacing `:488-568`

```ts
  /** Read every video companion's track into its own encoder, on the shared clock. */
  private startCompanionCaptures(): void {
    for (const companion of this.companions) {
      if (companion.kind !== 'video' || !companion.reader) continue;
      const reader = companion.reader;
      void this.captureFromTrackProcessor(
        reader,
        companion.timing,
        () => companion.readerActive,
        () => companion.encoder,
        () => {
          companion.encodedCount++;
        }
      );
    }
  }

  /**
   * Give up on one companion without touching the take: stop reading its
   * source, and leave it out of what `stop()` delivers.
   */
  private failCompanion(companion: CompanionPipeline): void {
    companion.failed = true;
    if (companion.kind === 'video') companion.readerActive = false;
  }

  /**
   * Flush and close every companion's encoder, giving up a companion rather
   * than the take if one refuses.
   *
   * Its own try/catch, and not `stop()`'s: this runs *before* the primary's
   * `output.finalize()`, so a rejection that escaped here would skip the
   * finalize, land in the outer catch and report `onError` over a screen
   * recording that was already complete. Per companion rather than around the
   * loop, so one pipeline's refusal does not cost the others theirs.
   */
  private async flushCompanions(): Promise<void> {
    for (const companion of this.companions) {
      const encoder = companion.encoder;
      if (!encoder || encoder.state === 'closed') continue;
      try {
        await encoder.flush();
        encoder.close();
      } catch (e) {
        console.warn(
          `The ${COMPANION_PARTS[companion.role].label} companion could not be flushed:`,
          e
        );
        this.failCompanion(companion);
      }
    }
  }

  /**
   * Finalize every companion and hand back the parts worth storing, in the
   * order the pipelines were built — which is role order.
   *
   * Three cases end as "not a part" rather than as an empty row in the
   * library: a pipeline that encoded nothing, one that already gave up
   * (`failed`), and a muxer that could not write. The last is swallowed into a
   * warning on purpose — the primary blob is the take, and losing it because a
   * companion's finalize threw would be the worse outcome by far.
   */
  private async finalizeCompanions(): Promise<CompanionPart[]> {
    const parts: CompanionPart[] = [];
    for (const companion of this.companions) {
      if (companion.failed || companion.encodedCount === 0) continue;
      try {
        await companion.output?.finalize();
        const buffer = companion.target?.buffer;
        if (!buffer) continue;
        parts.push({
          role: companion.role,
          blob: new Blob([buffer], {
            type: companion.kind === 'audio' ? 'audio/webm' : 'video/webm',
          }),
          // 0 for every pipeline in this build: one clock, one start(), every
          // first unit stamped from the same origin.
          startOffset: 0,
        });
      } catch (e) {
        console.warn(
          `The ${COMPANION_PARTS[companion.role].label} companion could not be finalized:`,
          e
        );
      }
    }
    return parts;
  }
```

`companion.kind === 'audio'` is unreachable in this commit — `CompanionPipeline` has one member — and TypeScript will narrow it to `never`, which is fine and is what Task 3 fills in. If `noUnusedLocals`-style narrowing makes lint complain, write the blob type as `companion.kind === 'video' ? 'video/webm' : 'audio/webm'` instead; it is the same expression the other way round and both members exist by Task 3.

- [ ] **Step 5: Loop the four call sites**

`start()` (`:708-713`):

```ts
    for (const companion of this.companions) {
      companion.encodedCount = 0;
      if (companion.kind === 'video') {
        companion.timing = newFrameTiming();
        companion.readerActive = true;
      }
    }
    this.startCompanionCaptures();
```

`stop()` (`:974`, `:991-997`, `:1006`, `:1018`):

```ts
    for (const companion of this.companions) {
      if (companion.kind === 'video') companion.readerActive = false;
    }
```
```ts
    for (const companion of this.companions) {
      if (companion.kind !== 'video' || !companion.reader) continue;
      try {
        await companion.reader.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
```
```ts
      await this.flushCompanions();
```
```ts
      const parts = await this.finalizeCompanions();
      ...
        this.callbacks.onStop?.(blob, parts.length > 0 ? parts : null);
```

`cleanup()` (`:1187-1201`):

```ts
    for (const companion of this.companions) {
      if (companion.kind === 'video' && companion.reader) {
        try {
          companion.reader.cancel().catch(() => {});
        } catch {
          // Ignore errors
        }
      }
      companion.encoder = null;
      companion.output = null;
      companion.target = null;
      companion.packetSource = null;
    }
    this.companions.length = 0;
```

`dispose()` (`:1224`):

```ts
      for (const companion of this.companions) {
        if (companion.kind === 'video') companion.readerActive = false;
      }
```

- [ ] **Step 6: Confirm nothing moved**

Run: `pnpm --filter @escapesuite/craft test -- src/core src/hooks src/App.rerender.test.tsx src/App.mp4rerender.test.tsx`
Expected: PASS, every file, with no test file edited.

Run: `git diff --stat -- 'apps/craft/src/**/*.test.ts' 'apps/craft/src/**/*.test.tsx' apps/e2e`
Expected: **empty output.** If it is not, this is not a pure move — revert the test edit and change the implementation instead.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/craft/src/core/webcodecs-recorder.ts
git commit -m "$(cat <<'EOF'
refactor(craft): the recorder holds a list of companions (ESCSUITE-14)

Pure move. One `companion: CompanionPipeline | null` becomes
`companions: CompanionPipeline[]`, and the four lifecycle helpers — start,
fail, flush, finalize — take or loop a pipeline instead of reaching through
the field. The pipeline type gains a `kind` discriminant and a `role`, so a
pipeline that is not a camera has somewhere to say so, and the five sentences
the recorder can say about a companion read their noun from
utils/companionParts.ts.

No test file changed at this commit, and none needed to: onStop still
delivers exactly the companions it delivered before, wrapped in the list
Task 1 gave it, and every existing assertion — including the three that make
a companion fail to set up, flush or finalize — is byte-identical.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 3: The mic and the system audio get their own encoders

**Files:**
- Modify: `apps/craft/src/core/webcodecs-recorder.ts` (the pipeline union, `initialize`'s mode block, the new audio pipeline builder, `start()`)
- Test: `apps/craft/src/core/webcodecs-recorder.test.ts` (new `describe`, and two assertions inside the existing `'separate tracks'` describe corrected at Step 6), `apps/craft/src/core/webcodecsRecorder.perf.test.ts` (three named corrections and one new suite)

**Interfaces:**
- Consumes: `CompanionPipeline`, `this.companions`, `failCompanion`, `flushCompanions`, `finalizeCompanions` (Task 2); `COMPANION_PARTS` (Task 1).
- Produces: `AudioCompanionPipeline` joins the `CompanionPipeline` union; `private initializeAudioCompanions(context: AudioContext, screenStream: MediaStream | null, micStream: MediaStream | null, config: RecordingConfig): Promise<void>`; `private initializeAudioCompanion(context: AudioContext, role: 'mic' | 'system', track: MediaStreamTrack): Promise<void>`. `onStop` now delivers up to three parts in role order.

**Two rules this task pins:**
- **The mix is untouched.** The primary output keeps its `EncodedAudioPacketSource`, its `AudioEncoder` and its `ScriptProcessorNode`, and the level meters keep their analysers. A screen-only download still has sound, slice 4's composite still has the mix to draw on, and `setupAudioCapture()` is not edited at all.
- **A companion exists exactly when its source is in the mix.** `config.microphoneEnabled && micStream.getAudioTracks()[0]` and `config.systemAudioEnabled && screenStream.getAudioTracks()[0]` — the same two questions `initialize` already asks at `:274` and `:288` when wiring the mix. That is what makes `hasAudio = microphoneEnabled || (systemAudioEnabled && systemAudioShared)` in `useRecordingSave` and the set of audio companions agree by construction rather than by coincidence.

- [ ] **Step 1: Write the failing behaviour tests** — append to the `'separate tracks'` describe in `apps/craft/src/core/webcodecs-recorder.test.ts`, before its closing brace

```ts
    // --- audio companions (slice 3) ---------------------------------------

    /** A separate-tracks take with both audio sources really present. */
    async function initializeWithAudioCompanions(): Promise<void> {
      await recorder.initialize(screenStream, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })
    }

    /** The ScriptProcessor each pipeline drives: 0 is the mix, then mic, then system. */
    const processorFor = (index: number) => lastAudioContext().scriptProcessors[index]
    const audioBuffer = (length = 4) =>
      createAudioBufferDouble({ length, sample: (c, i) => c * 10 + i })

    it('gives the microphone and the system audio an Opus-only WebM each', async () => {
      await initializeWithAudioCompanions()

      const state = getMediabunnyState()
      // Primary, webcam, mic, system — in that order, so the webcam companion
      // is still outputs[1] for every test that addresses it that way.
      expect(state.outputs).toHaveLength(4)
      expect(state.formats.map(f => f.name)).toEqual(['webm', 'webm', 'webm', 'webm'])
      // The two audio companions carry one audio track and no video track at
      // all: every ARTIST read path and CRAFT's own converter are single-track
      // by construction, which is the whole reason these are separate files.
      for (const output of [state.outputs[2], state.outputs[3]]) {
        expect(output.tracks.map(t => t.kind)).toEqual(['audio'])
        expect(output.startCalls).toBe(1)
      }
      expect(state.audioSources.map(s => s.codec)).toEqual(['opus', 'opus', 'opus'])
      // ...and the mix is exactly where it was: on the primary.
      expect(state.outputs[0].addAudioTrack).toHaveBeenCalledTimes(1)
      expect(state.outputs[1].addAudioTrack).not.toHaveBeenCalled()
      // One encoder for the mix, one per companion.
      expect(AudioEncoderDouble.instances).toHaveLength(3)
      for (const encoder of AudioEncoderDouble.instances) {
        expect(encoder.configureCalls[0]).toMatchObject({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        })
      }
    })

    it('feeds each audio companion its own source, through its own processor', async () => {
      await initializeWithAudioCompanions()

      const ctx = lastAudioContext()
      // The mix's processor, then the microphone's, then the system audio's.
      expect(ctx.scriptProcessors).toHaveLength(3)
      for (const node of ctx.scriptProcessors) {
        expect(node.bufferSize).toBe(4096)
        expect(node.connect).toHaveBeenCalledWith(ctx.destination)
      }
      // Two analysers and no more: the meters read the mix's own sources, and
      // a companion must not add a third meter to a panel that draws two.
      expect(ctx.analysers).toHaveLength(2)
    })

    it('stamps every pipeline from the same origin, one buffer at a time', async () => {
      await initializeWithAudioCompanions()
      recorder.start()

      for (const index of [0, 1, 2]) {
        processorFor(index).onaudioprocess!({ inputBuffer: audioBuffer() })
        processorFor(index).onaudioprocess!({ inputBuffer: audioBuffer() })
      }

      const [mix, mic, system] = AudioEncoderDouble.instances
      for (const encoder of [mix, mic, system]) {
        expect(encoder.encodes).toHaveLength(2)
        // Every pipeline's first buffer is the take's zero, and every
        // pipeline's second is one buffer later — 4 frames at 48kHz. One
        // origin and one sample-rate arithmetic is what "the same clock"
        // means here; a shared counter would have three callbacks stamping
        // each other's audio.
        expect(encoder.encodes[0].data.init!.timestamp).toBe(0)
        expect(encoder.encodes[1].data.init!.timestamp).toBeCloseTo(
          (4 / 48000) * 1_000_000,
          5
        )
        expect(encoder.encodes[0].data.init!.format).toBe('f32-planar')
        // Planar layout, interleaved input: [L0..L3, R0..R3].
        expect(Array.from(encoder.encodes[0].data.init!.data as Float32Array)).toEqual([
          0, 1, 2, 3, 10, 11, 12, 13,
        ])
      }
      expect(getCreatedFrames('AudioData').every(f => f.closed)).toBe(true)
    })

    it('ignores audio companion callbacks before start and while paused', async () => {
      await initializeWithAudioCompanions()

      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(0)

      recorder.start()
      recorder.pause()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(0)

      recorder.resume()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      expect(AudioEncoderDouble.instances[1].encodes).toHaveLength(1)
      // Paused time is excluded from every pipeline the same way: the buffers
      // dropped while paused were never counted, so the first buffer after a
      // resume is still the second buffer of the recording.
      expect(AudioEncoderDouble.instances[1].encodes[0].data.init!.timestamp).toBe(0)
    })

    it('muxes each companion's audio into its own Opus packet source', async () => {
      await initializeWithAudioCompanions()
      recorder.start()

      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      const [mixSource, micSource, systemSource] = getMediabunnyState().audioSources
      expect(mixSource.packets).toHaveLength(0)
      expect(micSource.packets).toHaveLength(1)
      expect(systemSource.packets).toHaveLength(1)
    })

    it('delivers the take as four parts, in role order', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      const [blob, companions] = callbacks.onStop.mock.calls[0]
      expect(blob).toBeInstanceOf(Blob)
      expect(companions).toEqual([
        { role: 'webcam', blob: expect.any(Blob), startOffset: 0 },
        { role: 'mic', blob: expect.any(Blob), startOffset: 0 },
        { role: 'system', blob: expect.any(Blob), startOffset: 0 },
      ])
      // An audio companion is an audio file, and the save path reads the
      // blob's own type into the stored mimeType.
      expect(companions[1].blob.type).toBe('audio/webm')
      expect(companions[2].blob.type).toBe('audio/webm')
      expect(companions[0].blob.type).toBe('video/webm')
    })

    it('builds a companion only for the audio sources the take really has', async () => {
      // The microphone is on but was never acquired, and system audio is off.
      // The mix asks the same two questions, so the companions and the mix can
      // never disagree about what the take is recording.
      await recorder.initialize(screenStream, webcamStream, null, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: false,
      })

      expect(AudioEncoderDouble.instances).toHaveLength(0)
      expect(getMediabunnyState().outputs).toHaveLength(2)
    })

    it('builds a system companion only when the display capture carries audio', async () => {
      // Ticking "System Audio" only *asks* for it: the browser's share dialog
      // has the tick box, and the stream comes back with no audio track when
      // the user leaves it clear (ESCSUITE-62).
      const silentScreen = createStreamDouble([videoTrack])
      await recorder.initialize(silentScreen, webcamStream, micStream, {
        ...separateConfig,
        microphoneEnabled: true,
        systemAudioEnabled: true,
      })

      // The mix (mic only) and the microphone companion. No system anything.
      expect(AudioEncoderDouble.instances).toHaveLength(2)
      expect(getMediabunnyState().outputs).toHaveLength(3)
    })

    it('keeps the take when an audio companion encoder gives up', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      processorFor(2).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      AudioEncoderDouble.instances[1].emitError('mic encoder died')
      await flush()

      // A microphone hiccup at minute four of a screen recording cannot throw
      // the screen recording — or the camera, or the system audio — away.
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith('Microphone track encoder failed: mic encoder died')
      expect(recorder.isRecording()).toBe(true)

      await recorder.stop()

      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'system',
      ])
    })

    it('leaves out an audio companion that never got a buffer', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      // A take shorter than one 4096-sample buffer, or a source that went
      // silent at the socket: an empty Opus file is a library row that plays
      // nothing.
      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'mic',
      ])
    })

    it('still delivers the take when an audio companion will not flush', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      processorFor(1).onaudioprocess!({ inputBuffer: audioBuffer() })
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      await flush()

      AudioEncoderDouble.instances[1].failAt = 'flush'

      await recorder.stop()

      expect(getMediabunnyState().outputs[0].finalizeCalls).toBe(1)
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalledWith(
        'The microphone companion could not be flushed:',
        expect.any(Error)
      )
      expect(callbacks.onStop.mock.calls[0][1]).toBeNull()
    })

    it('records the take without the microphone when its pipeline cannot be set up', async () => {
      // `canRecordSeparateTracks()` proves WebCodecs is there; it cannot prove
      // this browser will configure a third Opus encoder. A refusal here costs
      // one track, never the take.
      const restore = refuseAudioEncoderConfigure(2)
      try {
        await expect(initializeWithAudioCompanions()).resolves.toBeUndefined()
      } finally {
        restore()
      }

      expect(consoleWarn).toHaveBeenCalledWith(
        'Microphone track could not be set up:',
        expect.any(Error)
      )
      expect(callbacks.onError).not.toHaveBeenCalled()

      recorder.start()
      now += 40
      processor.pushFrameTo('screen-video', sourceFrame())
      processor.pushFrameTo('webcam-video', sourceFrame())
      // The system companion is the third processor no more — the microphone's
      // was never connected.
      lastAudioContext().scriptProcessors[1].onaudioprocess!({ inputBuffer: audioBuffer() })
      await flush()

      await recorder.stop()

      const companions = callbacks.onStop.mock.calls[0][1]
      expect(companions.map((part: { role: string }) => part.role)).toEqual([
        'webcam',
        'system',
      ])
    })

    it('disconnects every audio companion processor when the take is torn down', async () => {
      await initializeWithAudioCompanions()
      recorder.start()
      const processors = [...lastAudioContext().scriptProcessors]

      recorder.dispose()

      // Three processors, three disconnects — the mix's included. A live
      // ScriptProcessorNode keeps its whole graph running after the recording
      // is over, and this take builds three of them.
      for (const node of processors) {
        expect(node.disconnect).toHaveBeenCalledTimes(1)
      }
    })
```

Add the audio-encoder refusal helper beside the existing `refuseEncoderConfigure` in the same describe:

```ts
    /**
     * Make the Nth AudioEncoder the recorder constructs refuse its
     * `configure()`. The mirror of `refuseEncoderConfigure`, and subclassing
     * for the same reason: every encoder in a take is constructed inside one
     * `initialize()` await chain, so there is no moment between them for a
     * test to reach in. Hands back the restore.
     */
    function refuseAudioEncoderConfigure(nth: 1 | 2 | 3): () => void {
      const g = globalThis as unknown as Record<string, unknown>
      const Installed = g.AudioEncoder as typeof AudioEncoderDouble
      class RefusingAudioEncoder extends Installed {
        constructor(...args: ConstructorParameters<typeof AudioEncoderDouble>) {
          super(...args)
          if (AudioEncoderDouble.instances.length === nth) this.failAt = 'configure'
        }
      }
      g.AudioEncoder = RefusingAudioEncoder
      return () => {
        g.AudioEncoder = Installed
      }
    }
```

The suite already imports `AudioEncoderDouble`, `lastAudioContext`, `createAudioBufferDouble`, `getMediabunnyState` and `getCreatedFrames`; add `AudioEncoderDouble` to the `../test/doubles/webcodecs` import if it is not there already.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft test -- src/core/webcodecs-recorder.test.ts -t "separate tracks"`
Expected: FAIL — `expected [ OutputDouble, OutputDouble ] to have a length of 4 but got 2`, `expected [ AudioEncoderDouble ] to have a length of 3 but got 1`, `expected [ ScriptProcessorDouble ] to have a length of 3 but got 1`, and the delivery test seeing one companion where it wants three.

- [ ] **Step 3: Add the audio pipeline to the union** — `apps/craft/src/core/webcodecs-recorder.ts`

```ts
/**
 * One audio source of a separate-tracks take, in its own Opus-only WebM: its
 * own `MediaStreamAudioSourceNode`, its own `ScriptProcessorNode`, its own
 * `AudioEncoder`, its own output.
 *
 * It is a *second* tap on a track the mix is already reading, not a diversion
 * of it: the primary output keeps the mixed audio exactly as before, so a
 * screen-only download still has sound and the composite (slice 4) still has
 * the mix to draw on. Two `MediaStreamAudioSourceNode`s on one track is
 * ordinary Web Audio — a source node is a reader, not an owner.
 */
interface AudioCompanionPipeline extends CompanionPipelineBase {
  readonly kind: 'audio';
  readonly role: 'mic' | 'system';
  encoder: AudioEncoder | null;
  packetSource: EncodedAudioPacketSource | null;
  /** Kept so `cleanup()` can disconnect it; the node is otherwise write-only. */
  processor: ScriptProcessorNode | null;
  /**
   * Microseconds of audio this pipeline has encoded — its own presentation
   * clock, reset by `start()` and advanced by its own sample count.
   *
   * Per pipeline rather than shared with `audioTimestamp`, and that is the
   * point: three callbacks advancing one counter would interleave and stamp
   * each other's audio. What they share is the *origin* — one `start()`, one
   * `AudioContext`, one gate — which is what puts the parts on one timeline.
   */
  timestampUs: number;
}

type CompanionPipeline = VideoCompanionPipeline | AudioCompanionPipeline;
```

- [ ] **Step 4: Build them in `initialize`** — extend the mode block at `:386-394`

```ts
    if (
      config.separateTracks &&
      config.screenEnabled &&
      screenStream &&
      config.webcamEnabled &&
      webcamStream
    ) {
      await this.initializeCompanion(webcamStream);
      // ...and each audio source that is really being recorded gets its own
      // file too (slice 3). After the webcam, so the companion list — and the
      // parts `stop()` delivers — is in role order.
      await this.initializeAudioCompanions(this.audioContext, screenStream, micStream, config);
    }
```

and add the two methods after `initializeCompanion`:

```ts
  /**
   * One Opus-only WebM per audio source the take is actually recording.
   *
   * The two conditions are the same two `initialize` already asked when it
   * wired the mix — a stream with an audio track in it AND its toggle — so
   * the set of audio companions and the mix can never disagree about what the
   * take is recording, and neither can `useRecordingSave`'s `hasAudio`
   * (`microphoneEnabled || (systemAudioEnabled && systemAudioShared)`).
   * Microphone before system audio, so the companion list is in role order.
   */
  private async initializeAudioCompanions(
    context: AudioContext,
    screenStream: MediaStream | null,
    micStream: MediaStream | null,
    config: RecordingConfig
  ): Promise<void> {
    const micTrack = config.microphoneEnabled ? micStream?.getAudioTracks()[0] : undefined;
    if (micTrack) await this.initializeAudioCompanion(context, 'mic', micTrack);

    const systemTrack = config.systemAudioEnabled
      ? screenStream?.getAudioTracks()[0]
      : undefined;
    if (systemTrack) await this.initializeAudioCompanion(context, 'system', systemTrack);
  }

  /**
   * Build one audio companion, or record the take without it and say why.
   *
   * Every refusal is a warning rather than a throw, exactly as the webcam
   * companion's is: the take the user asked for is mostly the screen, and
   * losing it because a third Opus encoder would not configure would be a far
   * worse outcome than a take with one track fewer. `stop()` then simply
   * leaves this role out of the list, and the controller — which knows how
   * many companions the take asked for — is what tells the user.
   */
  private async initializeAudioCompanion(
    context: AudioContext,
    role: 'mic' | 'system',
    track: MediaStreamTrack
  ): Promise<void> {
    const { trackLabel } = COMPANION_PARTS[role];
    let companion: AudioCompanionPipeline;

    try {
      const target = new BufferTarget();
      const output = new Output({ format: new WebMOutputFormat(), target });
      const packetSource = new EncodedAudioPacketSource('opus');
      // One audio track and no video track at all: every ARTIST read path and
      // CRAFT's own converter are single-track by construction.
      output.addAudioTrack(packetSource);
      await output.start();

      companion = {
        kind: 'audio',
        role,
        encoder: null,
        output,
        target,
        packetSource,
        processor: null,
        encodedCount: 0,
        timestampUs: 0,
        failed: false,
      };

      const encoder = new AudioEncoder({
        output: async (chunk, meta) => {
          // Read through the pipeline rather than captured, because cleanup()
          // nulls it: an encoder output that lands after a take has been torn
          // down must find nothing to add to rather than write into a
          // finalized muxer.
          const source = companion.packetSource;
          if (source) {
            await source.add(EncodedPacket.fromEncodedChunk(chunk), meta);
          }
        },
        error: (e) => {
          console.warn(`${trackLabel} track encoder failed: ${e.message}`);
          this.failCompanion(companion);
        },
      });

      await encoder.configure({
        codec: 'opus',
        sampleRate: this.sampleRate,
        numberOfChannels: 2,
        bitrate: 128000,
      });
      companion.encoder = encoder;
    } catch (e) {
      console.warn(`${trackLabel} track could not be set up:`, e);
      return;
    }

    // A second tap on the track the mix is already reading. The
    // ScriptProcessorNode is the same node the mix uses — 4096 samples at
    // 48kHz, ~85ms chunks — rather than an AudioWorklet, because this class
    // has exactly one audio-capture mechanism and a second one in the same
    // take would be two things to keep in step for no gain.
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const processor = context.createScriptProcessor(4096, 2, 2);

    processor.onaudioprocess = (event) => {
      if (!this.isRecordingActive || this.isPausedState || !companion.encoder) return;

      const leftChannel = event.inputBuffer.getChannelData(0);
      const rightChannel = event.inputBuffer.getChannelData(1);
      const numberOfFrames = leftChannel.length;

      const planarData = new Float32Array(numberOfFrames * 2);
      for (let i = 0; i < numberOfFrames; i++) {
        planarData[i] = leftChannel[i];
        planarData[numberOfFrames + i] = rightChannel[i];
      }

      try {
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: this.sampleRate,
          numberOfFrames,
          numberOfChannels: 2,
          timestamp: companion.timestampUs,
          data: planarData,
        });

        companion.encoder.encode(audioData);
        audioData.close();

        companion.timestampUs += (numberOfFrames / this.sampleRate) * 1_000_000;
        companion.encodedCount++;
      } catch (e) {
        console.error('Audio encoding error:', e);
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    companion.processor = processor;

    this.companions.push(companion);
  }
```

Note: a `getChannelData(1)` on a mono microphone would throw, land in the `catch` and be logged per buffer. That is the behaviour the **mix** already has (`setupAudioCapture` reads channel 1 unconditionally) and the `AudioContext`'s destination is created with 2 channels, so a mono source is up-mixed before it reaches either processor. Do not add a channel-count branch here; it would be a second rule the mix does not follow.

- [ ] **Step 5: Reset and release them** — two edits

In `start()`'s companion loop (Task 2, Step 5), add the audio arm:

```ts
    for (const companion of this.companions) {
      companion.encodedCount = 0;
      if (companion.kind === 'video') {
        companion.timing = newFrameTiming();
        companion.readerActive = true;
      } else {
        companion.timestampUs = 0;
      }
    }
```

In `cleanup()`'s companion loop, disconnect the processor before nulling the rest:

```ts
      if (companion.kind === 'audio' && companion.processor) {
        companion.processor.disconnect();
        companion.processor = null;
      }
```

- [ ] **Step 6: Correct the three named ceiling lines and add the new suite** — `apps/craft/src/core/webcodecsRecorder.perf.test.ts`

In the existing `'one take of separate tracks'` suite, replace the three lines named in Global Constraint 4:

```ts
        // Exact: one flush per encoder, one finalize per output. Three audio
        // encoders and four outputs, because this take really has three audio
        // pipelines — the mix on the primary, and one file each for the
        // microphone and the system audio (slice 3). The mix is still the
        // primary's, which is what keeps a screen-only download audible.
        expect(screen.flushCalls).toBe(1)
        expect(webcam.flushCalls).toBe(1)
        expect(lastAudioEncoder().flushCalls).toBe(1)
        expect(AudioEncoderDouble.instances).toHaveLength(3)
        expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1, 1, 1])
```

Every other line of that suite is unchanged, including `VideoEncoderDouble.instances` length 2, both per-encoder encode counts, `allFramesClosed()`, the `4 * 2 * FRAMES_PER_TRACK` ceiling, the single-`AudioContext` conservation and `raf.pending()`.

Then append a new suite to the same file:

```ts
  describe('one take of audio companions', () => {
    /** Buffers offered to each audio pipeline. */
    const BUFFERS_PER_PIPELINE = 12

    it('encodes each buffer once per pipeline, closes every AudioData, flushes each encoder once', async () => {
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

        // One frame down each video pipeline, so both have something worth
        // finalizing and this suite counts four outputs rather than two.
        now += 1000 / CAPTURE_FPS
        processor.pushFrameTo('screen-video', new VideoFrameDouble({}, { timestamp: 0 }))
        processor.pushFrameTo('webcam-video', new VideoFrameDouble({}, { timestamp: 0 }))
        await flush()

        const nodes = lastAudioContext().scriptProcessors
        for (let i = 0; i < BUFFERS_PER_PIPELINE; i++) {
          for (const node of nodes) {
            node.onaudioprocess!({
              inputBuffer: createAudioBufferDouble({ length: AUDIO_BUFFER_FRAMES }),
            })
          }
        }
        await flush()

        const [mix, mic, system] = AudioEncoderDouble.instances
        const audioData = getCreatedFrames('AudioData')

        // Exact conservation, per pipeline: one AudioData per callback, each
        // encoded once by its own encoder and closed. An AudioData that
        // outlives its encode pins a decoded buffer in memory, and this mode
        // makes three of them per buffer period.
        expect(AudioEncoderDouble.instances).toHaveLength(3)
        expect(lastAudioContext().scriptProcessors).toHaveLength(3)
        for (const encoder of [mix, mic, system]) {
          expect(encoder.encodes).toHaveLength(BUFFERS_PER_PIPELINE)
        }
        expect(audioData).toHaveLength(3 * BUFFERS_PER_PIPELINE)
        expect(audioData.every(d => d.closed)).toBe(true)
        // Measured 2026-09-25: one Float32Array per callback per pipeline — the
        // interleave of the two input channels into planar layout — so 36 for
        // 36 callbacks. The ScriptProcessor fires ~11 times a second at 4096
        // samples, so this is not a per-frame cost; a scratch buffer reused
        // across callbacks would take it to zero. Ceiling at 2x.
        const planarBuffers = new Set(audioData.map(d => d.source))
        expect(planarBuffers.size).toBeLessThanOrEqual(2 * 3 * BUFFERS_PER_PIPELINE)
        expect(planarBuffers.size).toBe(audioData.length)

        await recorder.stop()

        // Exact: one flush per encoder, one finalize per output. Four outputs:
        // screen, webcam, microphone, system audio.
        for (const encoder of [mix, mic, system]) {
          expect(encoder.flushCalls).toBe(1)
          expect(encoder.closeCalls).toBe(1)
        }
        expect(getMediabunnyState().outputs.map(o => o.finalizeCalls)).toEqual([1, 1, 1, 1])
        // Exact: one AudioContext for the whole take, closed. Three audio
        // pipelines must not mean three audio graphs.
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts.every(c => c.state === 'closed')).toBe(true)
        // Exact: two analysers, the mix's own. A companion adds a tap, never a
        // meter — the Sources panel draws two bars and a third would be a
        // store write per animation frame for a meter nothing renders.
        expect(lastAudioContext().analysers).toHaveLength(2)
        expect(raf.pending()).toBe(0)
      } finally {
        uninstallTrackProcessorDouble()
      }
    })
  })
```

- [ ] **Step 7: Run the behaviour tests and the ceilings**

Run: `pnpm --filter @escapesuite/craft test -- src/core/webcodecs-recorder.test.ts src/core/webcodecsRecorder.perf.test.ts`
Expected: PASS, both files.

Run: `pnpm --filter @escapesuite/craft test -- src/core/recorder.perf.test.ts src/core/compositor.perf.test.ts`
Expected: PASS, untouched.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/craft/src/core/webcodecs-recorder.ts apps/craft/src/core/webcodecs-recorder.test.ts \
  apps/craft/src/core/webcodecsRecorder.perf.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the mic and the system audio get their own tracks (ESCSUITE-14)

In separate-tracks mode each audio source the take is really recording now
gets its own Opus-only WebM: its own MediaStreamSource, its own
ScriptProcessorNode, its own AudioEncoder, its own Mediabunny output with one
audio track and no video track at all. The primary keeps the mixed audio
exactly as before, so a screen-only download still has sound and slice 4's
composite still has the mix to draw on — the companions are additional, not a
diversion.

The two conditions are the two initialize() already asked when it wired the
mix — a stream with an audio track AND its toggle — so the set of companions
and the mix cannot disagree, and neither can useRecordingSave's hasAudio.

Each pipeline counts its own samples into its own timestamp rather than
sharing one counter: three callbacks advancing one number would interleave
and stamp each other's audio. What they share is the origin — one start(),
one AudioContext, one gate — which is what puts the parts on one timeline.

Failure is isolated per pipeline, as the webcam's already was: an encoder
that errors, a configure that is refused, a flush or a finalize that throws
costs that one track and never the take. The level meters are untouched: two
analysers, on the mix's own sources.

Three assertions in the webcam-companion ceiling suite move to the truth:
that take really does have three audio encoders and four outputs now. Every
video assertion in it is byte-unchanged, as is every single-pipeline ceiling.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 4: The save path writes every part, and one sentence covers any loss

**Files:**
- Modify: `apps/craft/src/utils/notices.ts:50-59`
- Modify: `apps/craft/src/hooks/useRecordingSave.ts:1-30`, `:131-229`
- Modify: `apps/craft/src/hooks/useRecordingController.ts:27-33`, `:300-320`, `:369-394`
- Test: `apps/craft/src/hooks/useRecordingSave.test.ts`, `apps/craft/src/hooks/useRecordingController.test.ts`

**Interfaces:**
- Consumes: `CompanionPart[]` on `SaveRecording` and `onStop` (Task 1); `COMPANION_PARTS`, `companionPartFor` (Task 1).
- Produces: `SEPARATE_TRACK_NOT_SAVED` (replaces `WEBCAM_TRACK_NOT_SAVED`); nothing else a later task consumes.

- [ ] **Step 1: Write the failing save tests** — append to the `'useRecordingSave for a separate-tracks take'` describe in `apps/craft/src/hooks/useRecordingSave.test.ts`

```ts
  const MIC = new Blob(['mic-bytes'], { type: 'audio/webm' })
  const SYSTEM = new Blob(['system-bytes'], { type: 'audio/webm' })
  const micPart = { role: 'mic' as const, blob: MIC, startOffset: 0 }
  const systemPart = { role: 'system' as const, blob: SYSTEM, startOffset: 0 }

  it('stores four parts under one takeId, the audio parts as audio', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({
      webcamEnabled: true,
      separateTracks: true,
      microphoneEnabled: true,
      systemAudioEnabled: true,
    })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    const stored = await getRecordingsMetadata()
    expect(stored).toHaveLength(4)
    const primary = stored.find(m => m.role === 'screen')!
    const mic = stored.find(m => m.role === 'mic')!
    const system = stored.find(m => m.role === 'system')!

    for (const part of [mic, system]) {
      expect(part.takeId).toBe(primary.id)
      expect(part.startOffset).toBe(0)
      // The shape ESCAPEARTIST's own audio importer produces: a part that
      // arrived from a recording should be indistinguishable from one that
      // arrived from a file.
      expect(part.mediaType).toBe('audio')
      expect(part.frameRate).toBe(0)
      expect(part.width).toBe(0)
      expect(part.height).toBe(0)
      expect(part.mimeType).toBe('audio/webm')
      // hasAudio is per part now: the audio parts are the audio.
      expect(part.hasAudio).toBe(true)
      expect(part.hasWebcam).toBe(false)
      expect('overlayPlacement' in part).toBe(false)
      // Every part of a take is the same length by construction: one
      // recorder, one clock, one start, one stop.
      expect(part.duration).toBe(6)
    }
    expect(mic.name).toMatch(/ — microphone$/)
    expect(system.name).toMatch(/ — system audio$/)
  })

  it('decodes nothing for an audio part — no metadata probe, no thumbnail', async () => {
    recorderTypeRef.current = 'webcodecs'
    capturedThumbnailRef.current = new Blob(['preview-frame'], { type: 'image/jpeg' })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    // extractVideoMetadata reports `width: videoWidth || 1920`, so probing an
    // audio file would store it as 1920x1080; generateThumbnail would decode a
    // file with no picture and land on the placeholder. Neither is asked.
    const probed = thumbnailModule.extractVideoMetadata.mock.calls.map(call => call[0])
    expect(probed).not.toContain(MIC)
    expect(probed).not.toContain(SYSTEM)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1)
    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledWith(COMPANION)

    const stored = await getRecordingsMetadata()
    const mic = stored.find(m => m.role === 'mic')!
    // No thumbnail stored, so the library draws its own empty placeholder and
    // ARTIST treats the missing picture as cosmetic, which it already does.
    await expect(getThumbnail(mic.id)).resolves.toBeUndefined()
  })

  it('lists the parts under the primary in role order', async () => {
    recorderTypeRef.current = 'webcodecs'
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    // addRecording prepends, so the companions are added in reverse: the list
    // ends up [primary, webcam, mic, system], which is the order
    // `orderTakes` rebuilds after a reload.
    expect(added.map(entry => entry.role)).toEqual(['system', 'mic', 'webcam', 'screen'])
    expect(added.find(entry => entry.role === 'mic')!.hasWebcam).toBe(false)
    expect(added.find(entry => entry.role === 'mic')!.hasAudio).toBe(true)
  })

  it('loses one part without losing the others, and says so once', async () => {
    recorderTypeRef.current = 'webcodecs'
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    thumbnailModule.generateThumbnail.mockRejectedValue(new Error('no decoder'))
    // The webcam part's own thumbnail fallback would rescue it, so break the
    // part that has no fallback: its metadata probe.
    thumbnailModule.extractVideoMetadata.mockImplementation(async (blob: Blob, known?: number) => {
      if (blob === COMPANION) throw new Error('decode failed')
      return { duration: known ?? 0, width: 1920, height: 1080 }
    })
    const { result } = mountSave({ webcamEnabled: true, separateTracks: true })

    await result.current(RAW, 6, [companionPart, micPart, systemPart])

    const stored = await getRecordingsMetadata()
    // The camera is gone; the screen, the microphone and the system audio are
    // not. A companion may never cost the take another part.
    expect(stored.map(m => m.role).sort()).toEqual(['mic', 'screen', 'system'])
    expect(consoleWarn).toHaveBeenCalledWith(
      'Webcam track could not be saved:',
      expect.any(Error)
    )
    // One sentence however many parts were lost: there is one notice channel,
    // and "which one" is what the log is for.
    expect(notices).toEqual([SEPARATE_TRACK_NOT_SAVED])
  })
```

Update the import at line 19 to `import { SEPARATE_TRACK_NOT_SAVED } from '../utils/notices'`, and the existing `'keeps the primary when the companion cannot be saved, and says so'` test's last assertion to `expect(notices).toEqual([SEPARATE_TRACK_NOT_SAVED])`. Its `consoleWarn` assertion (`'Webcam track could not be saved:'`) is unchanged.

- [ ] **Step 2: Write the failing controller test** — append to the separate-tracks describe in `apps/craft/src/hooks/useRecordingController.test.ts`

```ts
  it('says a separate track was lost when the recorder delivers fewer than the take asked for', async () => {
    // Screen, webcam and a microphone that really was acquired: three
    // companions' worth of sources, so a list of one is two tracks short.
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    harness.streams.mic = micStreamWithTrack()
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    // The recorder cannot report this: `null` and a short list are what an
    // ordinary take delivers too. Only this closure still knows how many
    // companions the take asked for.
    expect(
      setNotice.mock.calls.filter(([notice]) => notice === SEPARATE_TRACK_NOT_SAVED)
    ).toHaveLength(1)
  })

  it('says nothing when every companion the take asked for arrived', async () => {
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    harness.streams.mic = micStreamWithTrack()
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
      { role: 'mic', blob: new Blob(['mic'], { type: 'audio/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(setNotice).not.toHaveBeenCalledWith(SEPARATE_TRACK_NOT_SAVED)
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('does not count a microphone the take never got', async () => {
    // The toggle is on and `acquireStreams` came back without one — a device
    // that would not open. The take asks for one companion, gets one, and
    // says nothing.
    harness = separateHarness({ countdownSeconds: 0, microphoneEnabled: true })
    const setNotice = vi.fn(harness.deps.setNotice)
    harness.deps.setNotice = setNotice
    const { result } = renderHook(() => useRecordingController(harness.deps))
    await act(async () => { await result.current.handleStartRecording() })
    const recorder = recorderFactory.last()
    recorder.companionParts = [
      { role: 'webcam', blob: new Blob(['webcam'], { type: 'video/webm' }), startOffset: 0 },
    ]

    await act(async () => { await result.current.handleStopRecording() })

    expect(setNotice).not.toHaveBeenCalledWith(SEPARATE_TRACK_NOT_SAVED)
  })
```

Add the stream helper beside the existing `screenStreamWithAudio` / `webcamStream` helpers in that file:

```ts
/** A microphone capture with a live audio track, as `requestMicrophone` returns. */
function micStreamWithTrack(): MediaStream {
  return createStreamDouble([createTrackDouble('audio', { id: 'mic-audio' })])
}
```

(reuse whatever stream/track double constructor the file already imports; if it builds streams inline, follow that shape instead.)

Update the import at line 31 to `SEPARATE_TRACK_NOT_SAVED` and the three existing references to it (lines ~918, ~920, ~942).

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft test -- src/hooks/useRecordingSave.test.ts src/hooks/useRecordingController.test.ts`
Expected: FAIL — `SEPARATE_TRACK_NOT_SAVED is not exported by '../utils/notices'`; once that is fixed, `expected [ 'screen' ] to have a length of 4`, `expected [ 'webcam', 'screen' ] to deeply equal [ 'system', 'mic', 'webcam', 'screen' ]`, and the controller saying nothing where the new test expects one sentence.

- [ ] **Step 4: Rename and generalise the notice** — `apps/craft/src/utils/notices.ts:50-59`

```ts
/**
 * Said when a separate-tracks take produced fewer parts than it asked for —
 * the camera, the microphone or the system audio did not make it.
 *
 * One sentence for any of them, and for any number of them, because there is
 * exactly one notice channel and "which track" is not something the user can
 * act on differently; the console carries the per-role detail. The spec says a
 * companion may never cost the take its primary: the screen recording is
 * still saved and listed exactly as a no-companion take would be, and this is
 * the one line that says something else was not. Raised from two places —
 * `useRecordingController` for a part lost inside the recorder, and
 * `useRecordingSave` for one lost in storage — because only the controller
 * knows how many parts the take asked for, and only the save hook knows which
 * write threw.
 */
export const SEPARATE_TRACK_NOT_SAVED =
  'A separate track could not be saved — the screen recording was kept.'
```

- [ ] **Step 5: Write every part** — `apps/craft/src/hooks/useRecordingSave.ts`

Imports (lines 16-18):

```ts
import { buildSourceVideo, buildRecordingEntry } from '../utils/recordingMetadata';
import { COMPANION_PARTS } from '../utils/companionParts';
import { NOT_SEEKABLE, SEPARATE_TRACK_NOT_SAVED } from '../utils/notices';
```

Replace the whole companion block (lines 161-219) with:

```ts
    // A companion may never cost the take another part: the primary's own
    // storeVideo/storeThumbnail already ran above, and each companion is
    // written inside its own try/catch, so a bad decode or a storage write
    // that throws costs exactly the part it happened to and nothing else. One
    // notice covers however many were lost — there is one channel, and which
    // one it was is what the console is for.
    let lostAPart = false;

    // Reverse role order, because `addRecording` prepends: adding system,
    // then mic, then webcam, then the primary leaves the list as
    // [primary, webcam, mic, system] — the order `orderTakes` rebuilds after
    // a reload.
    for (const companion of [...(companions ?? [])].reverse()) {
      const part = COMPANION_PARTS[companion.role];
      try {
        const companionId = uuidv4();
        let companionSourceVideo;
        let companionThumbnail: Blob | null = null;

        if (part.isAudio) {
          // No metadata probe and no thumbnail. `extractVideoMetadata`
          // reports `videoWidth || 1920`, so probing an audio file would
          // store it as 1920x1080, and `generateThumbnail` would decode a
          // file with no picture and land on the placeholder. The length is
          // the recorder's own: every part of a take is the same length by
          // construction — one recorder, one clock, one start, one stop.
          companionSourceVideo = buildSourceVideo({
            id: companionId,
            now,
            blob: companion.blob,
            duration: recordedDuration,
            width: 0,
            height: 0,
            hasAudio: true,
            hasWebcam: false,
            takeId: id,
            role: companion.role,
            startOffset: companion.startOffset,
          });
        } else {
          const companionMetadata = await extractVideoMetadata(companion.blob, recordedDuration);
          // The frame grabbed off the live preview is the *composited*
          // picture, so it is the primary's thumbnail and not this part's.
          // Decode one from the companion's own file, with the same
          // placeholder behind it as the primary's fallback chain.
          try {
            companionThumbnail = await generateThumbnail(companion.blob);
          } catch {
            companionThumbnail = await createPlaceholderThumbnail();
          }
          companionSourceVideo = buildSourceVideo({
            id: companionId,
            now,
            blob: companion.blob,
            duration:
              Number.isFinite(companionMetadata.duration) && companionMetadata.duration > 0
                ? companionMetadata.duration
                : recordedDuration,
            width: companionMetadata.width,
            height: companionMetadata.height,
            // The whole mix stays on the primary output, so the camera's own
            // file has no audio track at all.
            hasAudio: false,
            hasWebcam: true,
            takeId: id,
            role: companion.role,
            startOffset: companion.startOffset,
          });
        }

        await storeVideo(companionId, companion.blob, companionSourceVideo);
        if (companionThumbnail) await storeThumbnail(companionId, companionThumbnail);

        addRecording(buildRecordingEntry({
          sourceVideo: companionSourceVideo,
          now,
          size: companion.blob.size,
          ...(companionThumbnail ? { thumbnailUrl: createBlobUrl(companionThumbnail) } : {}),
          hasWebcam: !part.isAudio,
          hasAudio: part.isAudio,
        }));
      } catch (error) {
        console.warn(`${part.trackLabel} track could not be saved:`, error);
        lostAPart = true;
      }
    }

    if (lostAPart) setNotice(SEPARATE_TRACK_NOT_SAVED);
```

- [ ] **Step 6: Count what the take asked for** — `apps/craft/src/hooks/useRecordingController.ts`

Import (line 32): `SEPARATE_TRACK_NOT_SAVED,`.

After the `separateTracks` resolution (line 316), add:

```ts
      // How many extra files this take is asking for: the camera, and one per
      // audio source it really has. The same two questions the recorder asks
      // when it builds the pipelines — a stream with a track in it AND its
      // toggle — so the two cannot disagree. This is the only layer that
      // knows the number: the recorder delivers `null` or a short list for a
      // lost part and for a take that never asked, and they look identical.
      const expectedCompanions = separateTracks
        ? 1 +
          (config.microphoneEnabled && (mic?.getAudioTracks().length ?? 0) > 0 ? 1 : 0) +
          (config.systemAudioEnabled && systemAudioShared ? 1 : 0)
        : 0;
```

and replace the notice condition inside `onStop` (lines 380-382):

```ts
          // Four of the ways a part can be lost happen inside the recorder —
          // it was never set up, it encoded nothing, it gave up, its finalize
          // threw — and all four arrive here as a list that is simply shorter,
          // which is exactly what an ordinary take delivers. Only this closure
          // still knows how many the take was resolved to produce. The save
          // hook says the same sentence for a part lost in storage.
          if ((companions?.length ?? 0) < expectedCompanions) {
            setNotice(SEPARATE_TRACK_NOT_SAVED);
          }
```

- [ ] **Step 7: Run the hook suites and the whole craft suite**

Run: `pnpm --filter @escapesuite/craft test -- src/hooks`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft test`
Expected: PASS, all files.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/craft/src/utils/notices.ts apps/craft/src/hooks/useRecordingSave.ts \
  apps/craft/src/hooks/useRecordingSave.test.ts apps/craft/src/hooks/useRecordingController.ts \
  apps/craft/src/hooks/useRecordingController.test.ts
git commit -m "$(cat <<'EOF'
feat(craft): the save path writes every part of a take (ESCSUITE-14)

A separate-tracks take can now be four files, so the save loops: each
companion gets its own id, its own record and its own try/catch, and losing
one costs exactly that one. The companions are written in reverse role order
because addRecording prepends, which leaves the library reading
[primary, webcam, mic, system] — the order orderTakes rebuilds after a
reload.

An audio part is written as audio and decoded not at all: no metadata probe
(extractVideoMetadata reports videoWidth || 1920, so it would store an audio
file as 1920x1080) and no thumbnail (nothing to decode; the list already
draws its own placeholder and ARTIST already treats a missing picture as
cosmetic). Its length is the recorder's own, which is honest by construction:
one recorder, one clock, one start, one stop.

WEBCAM_TRACK_NOT_SAVED becomes SEPARATE_TRACK_NOT_SAVED — one sentence for
any lost part and for any number of them, because there is one notice channel
and which track it was is not something the user can act on differently. The
console keeps the per-role detail. The controller now counts the companions
the take asked for rather than testing for null, because a short list and no
list are the same thing to the recorder.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 5: The library says which track each row is, and the toggle says the audio is split too

**Files:**
- Modify: `apps/craft/src/components/RecordingsList/RecordingsList.tsx:135-142`, `:167`, `:190`
- Modify: `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx:4-12`
- Test: `apps/craft/src/components/RecordingsList/RecordingsList.test.tsx`, `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.test.tsx`

**Interfaces:**
- Consumes: `companionPartFor` (Task 1).
- Produces: nothing a later task consumes.

- [ ] **Step 1: Write the failing list tests** — append to the `'a take recorded as separate tracks'` describe in `apps/craft/src/components/RecordingsList/RecordingsList.test.tsx`

```ts
  const micRow = makeRecording({
    id: 'part-3',
    name: 'Standup Demo — microphone',
    takeId: 'take-1',
    role: 'mic',
    hasWebcam: false,
    hasAudio: true,
  })
  const systemRow = makeRecording({
    id: 'part-4',
    name: 'Standup Demo — system audio',
    takeId: 'take-1',
    role: 'system',
    hasWebcam: false,
    hasAudio: true,
  })

  it('labels each audio row as the track it is', () => {
    renderList([primary, companion, micRow, systemRow])

    expect(screen.getByText(/^Webcam track • /)).toBeInTheDocument()
    expect(screen.getByText(/^Microphone track • /)).toBeInTheDocument()
    expect(screen.getByText(/^System audio track • /)).toBeInTheDocument()
  })

  it('offers an audio row play, WebM and delete — and no conversions', () => {
    renderList([primary, companion, micRow, systemRow])

    expect(screen.getByRole('button', { name: 'Play Standup Demo — microphone' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Standup Demo — microphone' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Standup Demo — microphone' })).toBeEnabled()
    // No M4A on an audio row either: the row's own bytes are already an audio
    // file, downloadable as they stand, and the take's conversions live on the
    // primary. Offering a conversion of a part would be slice 4's composite
    // pretending to exist.
    expect(
      screen.queryByRole('button', { name: 'Download Standup Demo — microphone as audio (M4A)' })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Download Standup Demo — system audio as MP4' })
    ).toBeNull()
  })

  it('sends the take to the editor from an audio row too', async () => {
    const { calls } = renderList([primary, micRow])

    await userEvent.click(
      screen.getByRole('button', { name: 'Open Standup Demo — microphone in Editor' })
    )

    expect(calls.onSendToEditor.mock.calls).toEqual([['take-1']])
  })

  it('keeps the interim MP4 note on the take with a camera in it', () => {
    renderList([primary, companion, micRow, systemRow])

    // The note is about the webcam not being in the composite. The mix is
    // still on the primary, so the audio parts change nothing about what the
    // MP4 and M4A contain — and the note must not appear four times.
    expect(
      screen.getAllByText(
        'MP4 and M4A cover the screen track only — the webcam track is not included yet.'
      )
    ).toHaveLength(1)
  })
```

- [ ] **Step 2: Write the failing toggle test** — in `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.test.tsx`, update the assertion that pins `SEPARATE_TRACKS_HELP`

```ts
    // The mode splits the sound as well as the picture (ESCSUITE-14 slice 3),
    // and the help text is where that is said before the choice rather than
    // discovered in the library afterwards. One toggle, because the spec
    // treats separate tracks as one mode and the storage gate prices one.
    expect(
      screen.getByText(
        'Records the screen, the webcam and each audio source as separate files, so the webcam and the sound can be adjusted in the editor. Uses about twice the CPU and storage.'
      )
    ).toBeInTheDocument()
```

(Replace the existing literal wherever the suite asserts it; the label and `aria-label` assertions are unchanged.)

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @escapesuite/craft test -- src/components/RecordingsList src/components/WebcamOverlaySettings`
Expected: FAIL — `Unable to find an element with the text: /^Microphone track • /`, the MP4/M4A buttons found where they should be absent, and the old help sentence still rendered.

- [ ] **Step 4: Implement the rows** — `apps/craft/src/components/RecordingsList/RecordingsList.tsx`

Import at the top: `import { companionPartFor } from '../../utils/companionParts';`

Replace the `takesWithCompanion` comment and the two per-row lines:

```ts
  // Which takes still have a *camera* half in the library. The interim MP4
  // note is about the webcam alone — the mix is still on the primary, so the
  // audio parts take nothing out of the conversions — and a primary whose
  // webcam row was deleted is a plain take again (see `utils/takeOrder.ts`).
  const takesWithCompanion = new Set(
    recordings
      .filter((recording) => recording.role === 'webcam' && recording.takeId !== undefined)
      .map((recording) => recording.takeId)
  );
```

```ts
            // Every companion row — camera or sound — says which track it is
            // and carries no conversions: those are the take's downloads and
            // live on the primary row.
            const companionLabel = companionPartFor(recording.role);
```

```ts
                    {companionLabel && `${companionLabel.trackLabel} track • `}
```

and the conversion gate at line 214:

```ts
                  {!companionLabel && (
```

- [ ] **Step 5: Implement the help text** — `apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx:4-12`

```ts
/**
 * What the separate-tracks mode is for and what it costs, said before the
 * choice rather than after it.
 *
 * It splits the sound as well as the picture (slice 3): the camera, the
 * microphone and the system audio each become their own file, while the
 * screen recording keeps the mixed audio so a screen-only download still has
 * sound. One toggle for all of it, because the spec treats separate tracks as
 * one mode and the storage headroom gate prices one. The wording is pinned by
 * this component's test.
 */
export const SEPARATE_TRACKS_HELP =
  'Records the screen, the webcam and each audio source as separate files, so the webcam and the sound can be adjusted in the editor. Uses about twice the CPU and storage.';
```

- [ ] **Step 6: Run the component suites and the App contracts**

Run: `pnpm --filter @escapesuite/craft test -- src/components src/App.rerender.test.tsx src/App.mp4rerender.test.tsx`
Expected: PASS.

Run: `pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/craft/src/components/RecordingsList/RecordingsList.tsx \
  apps/craft/src/components/RecordingsList/RecordingsList.test.tsx \
  apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.tsx \
  apps/craft/src/components/WebcamOverlaySettings/WebcamOverlaySettings.test.tsx
git commit -m "$(cat <<'EOF'
feat(craft): the library names every track of a take (ESCSUITE-14)

"Microphone track • " and "System audio track • " beside the webcam's, from
the one table that has the nouns. Any companion row — camera or sound — keeps
Play, Download WebM, Open in Editor and Delete and carries no conversions:
those are the take's downloads and live on the primary row. No M4A on an
audio row either, because the row's own bytes are already an audio file and a
per-part conversion would be slice 4's composite pretending to exist.

The interim MP4 note still keys on the webcam alone, and still appears once:
the mix is on the primary, so the audio parts take nothing out of what the
MP4 and M4A contain.

The toggle's help text now says the audio is split too. One toggle, not two:
the spec treats separate tracks as one mode, the storage headroom gate prices
one, and a second control would let someone ask for a split camera and a
mixed sound, which the one-clock design has no reason to offer.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 6: The benchmark counts three parts and two audio encoders

**Files:**
- Modify: `apps/e2e/utils/craftPerf.ts` (the init-script counters, `readNewestRecordingBytes`'s tie-break, `measureTake`'s row count and the separate-tracks tripwires)
- Modify: `docs/performance/2026-09-17-craft-baseline.md`
- Test: the benchmark itself is the test; `apps/e2e/tests/perf/craft-recording.spec.ts` is **not** edited (its arms are unchanged).

**Interfaces:**
- Consumes: nothing from earlier tasks (it drives the app through the UI).
- Produces: nothing a later task consumes.

**Why the change is not optional:** `measureTake` waits for `rowsBefore + rowsPerTake` library rows after Stop (`craftPerf.ts:484`, `:533`). The separate-tracks arm records screen + webcam with the microphone on — `openCraft` deliberately leaves ESCAPECRAFT's defaults alone, and the microphone is one of them — so that take now lands as **three** rows. Waiting for two would return on a half-saved library and the heap reading after it would be taken mid-write.

- [ ] **Step 1: Count the audio encoders too**

In `craftPerf.ts`'s `installCraftPerfInstrumentation` init script, beside the `encodesByEncoder` bookkeeping:

```ts
    // Audio encoders that actually encoded something, attributed the same way
    // the video ones are. A separate-tracks take runs one for the mix on the
    // primary output and one per audio companion, all on the main thread.
    let audioEncoderIndices = new WeakMap<object, number>()
    counters.audioEncodesByEncoder = []
```

Add `audioEncodesByEncoder: number[]` to the `counters` shape and reset it in the chained `window.__perfReset` (`counters.audioEncodesByEncoder.length = 0; audioEncoderIndices = new WeakMap<object, number>()`), then wrap the encoder:

```ts
    const audioEncoder = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
    if (audioEncoder) {
      const nativeAudioEncode = audioEncoder.prototype.encode
      audioEncoder.prototype.encode = function countedAudioEncode(
        this: AudioEncoder,
        ...args: Parameters<AudioEncoder['encode']>
      ) {
        let index = audioEncoderIndices.get(this)
        if (index === undefined) {
          index = counters.audioEncodesByEncoder.length
          audioEncoderIndices.set(this, index)
          counters.audioEncodesByEncoder.push(0)
        }
        counters.audioEncodesByEncoder[index]++
        return nativeAudioEncode.apply(this, args)
      }
    }
```

- [ ] **Step 2: Make the primary tie-break deterministic** — `readNewestRecordingBytes`

Replace the `rank` helper (`craftPerf.ts:358-360`) and its comment:

```ts
            // A separate-tracks take writes up to four records carrying the
            // identical `recordedAt` — one `now` for the whole take — so the
            // timestamp cannot order them and store order is uuid order, i.e.
            // a coin toss between the parts. The tie is broken towards the
            // **primary**, which is the part with no role or the role
            // 'screen', so `outputBytes` is always the same part of the take
            // and two runs of the benchmark are comparable. Every other arm
            // stores one record per take and never reaches the tie-break.
            const rank = (record: { metadata?: { recordedAt?: number; role?: string } }) => {
              const role = record.metadata?.role
              return [
                record.metadata?.recordedAt ?? 0,
                role === undefined || role === 'screen' ? 1 : 0,
              ] as const
            }
```

- [ ] **Step 3: Wait for three rows, and pin the audio encoders** — `measureTake`

```ts
  // A separate-tracks take is one take in several files, so it lands as
  // several library rows (`useRecordingSave` writes every part in one pass).
  // Three here: the screen, the webcam and the microphone — `openCraft`
  // leaves ESCAPECRAFT's defaults alone and the microphone is one of them,
  // while system audio is off. Waiting for fewer would either time out or,
  // worse, pass on a transient half-saved library.
  const rowsPerTake = options.separateTracks ? 3 : 1
```

In the `options.separateTracks` tripwire block, after the existing four assertions (all unchanged), add:

```ts
    // The audio half of the same claim. A mode that recorded its sound into
    // the mix alone would still run two video encoders, still composite for
    // the preview and still look right in every number above — and would have
    // silently stopped producing the microphone file this arm is meant to
    // cost. Two: the mix on the primary output, and the microphone companion.
    expect(
      audioEncoders,
      `the separate-tracks take ran ${audioEncoders} audio encoder(s), not 2 — the microphone companion was not built, or the mix stopped being written to the primary`
    ).toBe(2)
```

reading it from the same `end`/`start` evaluate (add `audioEncodesByEncoder: [...window.__perfCraft.audioEncodesByEncoder]` to both) and computing it locally:

```ts
  // Encoders that encoded at least one buffer inside the window. Local to the
  // tripwire and deliberately not returned: it is an invariant the numbers
  // rest on rather than a number worth publishing, so `perf-report.mjs` and
  // the result schema are untouched.
  const audioEncoders = end.audioEncodesByEncoder.filter(
    (total, index) => total - (start.audioEncodesByEncoder[index] ?? 0) > 0
  ).length
```

- [ ] **Step 4: Run the benchmark and record the numbers**

Start a dev server (`pnpm --filter @escapesuite/craft dev`) in one terminal, then:

Run: `pnpm --filter @escapesuite/e2e exec playwright test --config=playwright.perf.config.ts craft-recording`
Expected: PASS, four arms, with `craft-separate-tracks-recording` reporting non-zero `framesEncoded`, two entries in `framesEncodedPerEncoder`, and no tripwire failure.

Then append a re-measurement section to `docs/performance/2026-09-17-craft-baseline.md`, immediately after the existing `## craft-separate-tracks-recording — first measurement, 2026-09-25` section, in the same table shape as that section (every cell the median of its own quantity over the three runs, `Encoder queue high-water` a maximum):

```markdown
## craft-separate-tracks-recording — re-measured for the audio companions, <DATE>

ESCSUITE-14 slice 3 gave the microphone its own `AudioEncoder` and its own
Mediabunny output, so this arm now runs **two video encoders and two audio
encoders** on the main thread (the mix on the primary, the microphone
companion beside it) and writes three files instead of two. The first
measurement above describes the two-file take and is kept for comparison, not
superseded.

Same machine, same launch args, same three-runs-median, taken in one
invocation of `playwright test --config=playwright.perf.config.ts
craft-recording` against a warm dev server. Record `uptime` at the start of
the run in the sentence below and fill every cell from `perf-report.json` —
do not leave one blank and do not copy a figure from the section above.

<TABLE — the same rows as the first measurement>
```

The `<DATE>`, the `uptime` line and every cell are filled from the run you just did; the section is not committed with a placeholder in it.

- [ ] **Step 5: Confirm the other arms did not move in shape**

Read the report: `cat apps/e2e/perf-report.json | jq '.results[] | {name, framesEncoded, videoDraws, compositedFps}'`
Expected: `craft-screen-recording` still has `videoDraws: 0` and non-zero `framesEncoded`; `craft-pip-recording` still has `framesEncoded: 0` and an even `videoDraws`. Neither arm's tripwires were edited and neither should have changed.

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/utils/craftPerf.ts docs/performance/2026-09-17-craft-baseline.md
git commit -m "$(cat <<'EOF'
test(e2e): the separate-tracks benchmark counts three parts (ESCSUITE-14)

That arm's take now lands as three library rows — screen, webcam and the
microphone companion, since openCraft leaves ESCAPECRAFT's defaults alone and
the microphone is one of them. Waiting for two would have returned on a
half-saved library and taken the heap reading mid-write.

Two tripwires with it. The primary tie-break in readNewestRecordingBytes was
"anything but webcam", which was deterministic while a take had two parts and
a coin toss now that it has three; it breaks towards the part with no role or
the role 'screen', so outputBytes is the same part every run. And a new one
counts the audio encoders that actually encoded: a mode that quietly recorded
its sound into the mix alone would still run two video encoders, still
composite for the preview, and still look right in every number the arm
publishes.

The count is read inside measureTake and not returned — it is an invariant
the numbers rest on rather than a number worth publishing — so the report
script and the result schema are untouched, as are both other arms.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 7: End-to-end — a four-part take in Chromium

**Files:**
- Modify: `apps/e2e/tests/escapecraft/separate-tracks.spec.ts` (whole file)

**Interfaces:**
- Consumes: the library rows and copy from Task 5; the stored shape from Task 4.
- Produces: nothing.

**Why this spec rather than a new one:** the storage-reading helper, the Chromium skip and the toggle-addressing comment are all here already, and the claim is the same claim one part further. A second spec would record a second real take for the same assertions.

- [ ] **Step 1: Extend the stored-part probe**

Replace `StoredPart` and the `probe` inside `readStoredParts`:

```ts
interface StoredPart {
  id: string
  takeId?: string
  role?: string
  hasAudio?: boolean
  hasWebcam?: boolean
  mediaType?: string
  mimeType: string
  width: number
  height: number
  overlayPlacement?: { position: string; size: number; shape: string }
  size: number
  /**
   * What the browser makes of the stored blob: a `<video>`'s duration for a
   * video part, `decodeAudioData`'s for an audio one. A real number, or
   * "Infinity". Decoding rather than probing, for the audio parts, because
   * "an audio file the browser will not decode" is exactly the failure a
   * badly muxed Opus-only WebM would be.
   */
  reportedDuration: string
}
```

```ts
            const probeVideo = (blob: Blob) =>
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

            const probeAudio = async (blob: Blob) => {
              const context = new AudioContext()
              try {
                const decoded = await context.decodeAudioData(await blob.arrayBuffer())
                return String(decoded.duration)
              } finally {
                await context.close()
              }
            }

            const probe = (blob: Blob) =>
              blob.type.startsWith('audio/') ? probeAudio(blob) : probeVideo(blob)
```

and add the four new fields to the mapped record:

```ts
                    mediaType: record.metadata.mediaType as string | undefined,
                    mimeType: record.metadata.mimeType as string,
                    width: record.metadata.width as number,
                    height: record.metadata.height as number,
```

- [ ] **Step 2: Record a take with both audio sources**

Rename the test and extend the setup. After the separate-tracks toggle click and before Start:

```ts
    // System audio is off by default, and `mockSyntheticMedia`'s
    // getDisplayMedia only adds an oscillator track when the capture asked for
    // one — which `requestScreenCapture(withSystemAudio)` does exactly when
    // this toggle is on. With it on, the take has all four sources: screen,
    // camera, microphone (on by ESCAPECRAFT's own default) and system audio.
    const systemAudio = page.getByRole('button', { name: 'System Audio', exact: true })
    await expect(systemAudio).toBeEnabled({ timeout: 30_000 })
    await systemAudio.click()
    await expect(systemAudio).toHaveAttribute('aria-pressed', 'true')
```

and change the row wait after Stop:

```ts
    // Four rows, so every part was saved.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(4, {
      timeout: 60_000,
    })
```

- [ ] **Step 3: Assert the four parts**

Replace the assertion block from `const parts = await readStoredParts(page)` down to the end of the test:

```ts
    const parts = await readStoredParts(page)
    expect(parts).toHaveLength(4)
    const primary = parts.find((part) => part.role === 'screen')!
    const webcam = parts.find((part) => part.role === 'webcam')!
    const mic = parts.find((part) => part.role === 'mic')!
    const system = parts.find((part) => part.role === 'system')!

    // One take in four files.
    expect(primary.takeId).toBe(primary.id)
    for (const part of [webcam, mic, system]) {
      expect(part.takeId).toBe(primary.id)
      expect(part.id).not.toBe(primary.id)
    }

    // Every part is real and the browser can read it: the video halves load in
    // a <video> with a finite duration (Mediabunny writes Duration and Cues,
    // so neither needs the MediaRecorder repair), and the audio halves decode
    // through Web Audio, which is what ARTIST's audioMixer and waveform pass
    // will do to them.
    for (const part of [primary, webcam, mic, system]) {
      expect(part.size).toBeGreaterThan(1000)
      expect(Number.isFinite(Number(part.reportedDuration))).toBe(true)
      expect(Number(part.reportedDuration)).toBeGreaterThan(0)
    }

    // The mix stays on the primary — a screen-only download still has sound —
    // and each audio source is its own file besides.
    expect(primary.hasAudio).toBe(true)
    expect(webcam.hasAudio).toBe(false)
    expect(primary.hasWebcam).toBe(true)
    for (const part of [mic, system]) {
      expect(part.hasAudio).toBe(true)
      expect(part.hasWebcam).toBe(false)
      // Stored as audio, with no dimensions — the shape ESCAPEARTIST's own
      // audio importer produces, so an imported part behaves like an
      // uploaded one.
      expect(part.mediaType).toBe('audio')
      expect(part.mimeType).toBe('audio/webm')
      expect(part.width).toBe(0)
      expect(part.height).toBe(0)
      expect(part.overlayPlacement).toBeUndefined()
    }

    // The overlay geometry the take was recorded with, for ARTIST and for the
    // composite MP4 (slice 4).
    expect(primary.overlayPlacement).toEqual({
      position: 'bottom-right',
      size: 0.2,
      shape: 'circle',
    })
    expect(webcam.overlayPlacement).toBeUndefined()

    // ...and the library says which row is which, with the right buttons.
    await expect(page.getByText(/^Webcam track • /)).toHaveCount(1)
    await expect(page.getByText(/^Microphone track • /)).toHaveCount(1)
    await expect(page.getByText(/^System audio track • /)).toHaveCount(1)
    await expect(
      page.getByText('MP4 and M4A cover the screen track only — the webcam track is not included yet.')
    ).toHaveCount(1)
    // Conversions on the primary row only — one MP4 and one M4A in the whole
    // library, however many parts the take has.
    await expect(page.getByRole('button', { name: /Download .+ as MP4/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })).toHaveCount(1)
    // One WebM download per row, so every part is reachable on its own.
    await expect(page.getByRole('button', { name: /^Download (?!.*as ).+/ })).toHaveCount(4)
```

Update the test title to `'stores the screen, the webcam and each audio source as parts of one take'` and the file's doc comment to name slice 3 and the four parts.

- [ ] **Step 4: Run it against a dev server**

Start `pnpm --filter @escapesuite/craft dev`, then:

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft/separate-tracks.spec.ts --project=chromium`
Expected: PASS, 1 test. If the audio decode fails, the Opus-only WebM the recorder wrote is the bug — do not relax the assertion.

- [ ] **Step 5: Confirm the neighbouring specs still pass**

Run: `pnpm --filter @escapesuite/e2e exec playwright test tests/escapecraft/m4a-download.spec.ts tests/escapecraft/pip-seekable.spec.ts --project=chromium`
Expected: PASS. The M4A spec records a take with `separateTracks` off, so nothing about it changed.

Run: `pnpm --filter @escapesuite/e2e typecheck && pnpm --filter @escapesuite/e2e lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/tests/escapecraft/separate-tracks.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): a separate-tracks take stores four parts (ESCSUITE-14)

The take is real: mockSyntheticMedia hands the app an animated canvas for the
screen, a second for the camera and oscillators for the microphone and the
system audio, so WebCodecsRecorder genuinely runs two VideoEncoders and three
AudioEncoders off one clock. The claim is the user-visible outcome on both
sides of storage: four blobs under one takeId, the video halves loading in a
<video> with a finite duration and the audio halves decoding through Web
Audio — which is exactly what ARTIST's mixer and waveform pass will do to
them, so a badly muxed Opus-only WebM fails here rather than in the editor.

The mix is asserted to be where it was, on the primary, and the conversions
to be on the primary row alone — one MP4 and one M4A in the whole library,
however many parts the take has.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

### Task 8: Docs, changeset, the spec's stale sentence, coverage

**Files:**
- Modify: `apps/craft/CLAUDE.md` (`:120-121`, `:134`, `:482-577` "Recorder lifecycle", `:577-632` "Frame timestamps and keyframes", `:633-670` "Audio level meters", `:914-966` "A take can be several files")
- Modify: `CLAUDE.md` (`:145-152`)
- Modify: `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md:35`
- Create: `.changeset/craft-audio-companions.md`
- Modify (only if a figure crosses a whole percent): `apps/craft/vite.config.ts:45-50`, `scripts/coverage-report.mjs:27`, root `CLAUDE.md` coverage table

- [ ] **Step 1: `apps/craft/CLAUDE.md` — the two module-table rows**

Replace the `hooks/useRecordingSave.ts` row's companion sentence with:

> A separate-tracks take's other blobs are written here too, one loop, each part in its own try/catch — the webcam with its own decoded thumbnail and `hasAudio: false`, the microphone and the system audio with `mediaType: 'audio'`, `frameRate: 0`, 0×0, the recorder's own duration and **no thumbnail and no decode at all** (`extractVideoMetadata` reports `videoWidth || 1920`, so probing an audio file would store it as 1920×1080). They are added in **reverse role order** because `addRecording` prepends. Losing one costs that one; one `SEPARATE_TRACK_NOT_SAVED` covers however many were lost, and the console carries which.

Replace the `hooks/useRecordingController.ts` row's last sentence with:

> It resolves which mode the take is before the countdown and counts how many companions the take asked for — the camera, plus one per audio source it really has — which makes it the only layer that can read a *short list* as a loss: `onStop` raises `SEPARATE_TRACK_NOT_SAVED` when fewer parts arrive than were asked for, and nothing for a composited take.

Line 134's notice list: `WEBCAM_TRACK_NOT_SAVED` → `SEPARATE_TRACK_NOT_SAVED`.

- [ ] **Step 2: `apps/craft/CLAUDE.md` — "Recorder lifecycle"**

Rewrite the paragraph beginning "**A separate-tracks take has a second capture track…**" to cover the list, and the one beginning "**A lost companion is said out loud…**" to cover the count. The new text:

```markdown
**A separate-tracks take has up to three companion pipelines, and none of them ends the take.**
`WebCodecsRecorder` holds `companions: CompanionPipeline[]` — one `kind: 'video'` pipeline for the
webcam and one `kind: 'audio'` pipeline per audio source the take really has — each with its own
encoder, its own Mediabunny `Output` and its own `failed` flag. The webcam track's `ended` stops
only its pipeline (one `'Webcam track ended: …'` warning and `readerActive = false`) while the
screen keeps recording. Every encoder has its own error handler, because `createVideoEncoder` takes
the handler as a parameter with no default and each audio pipeline builds its own: the primary's
still reports through `onError`, a companion's warns (`'<Track> track encoder failed: …'`), marks
that one pipeline `failed` and reports nothing — `onError` is what makes the controller dispose the
recorder and throw away a screen recording that is still being made. Flush and finalize are
isolated per pipeline (`flushCompanions()`, `finalizeCompanions()`, the flush deliberately outside
`stop()`'s try so a rejection cannot skip the primary's `output.finalize()`).

**Four cases leave a part out** of what `stop()` delivers: a pipeline that could not be *set up* at
all (each builder has its own try/catch — an `Output.start()` or a `configure()` the browser refuses
warns, releases what it holds and records the take without that track, because
`canRecordSeparateTracks()` proves the APIs exist and nothing can prove the camera's dimensions are
an encodable VP9 config or that a third Opus encoder will configure), one that encoded nothing,
one that gave up (`failed`), and one whose `finalize()` threw. An empty row in the library and a
second ARTIST source with nothing in it are worse than a missing part, and none of them may ever
cost the take its primary blob.

**Audio companions are a second tap, never a diversion.** The primary output keeps the mixed
`AudioEncoder` and the mixed Opus track exactly as before — a screen-only download still has
sound, and slice 4's composite still has the mix to draw on. Each companion adds its own
`MediaStreamAudioSourceNode` on the same track, its own `ScriptProcessorNode` (4096 samples, the
same node the mix uses — this class has one audio-capture mechanism, and a second one in the same
take would be two things to keep in step for no gain), its own `AudioEncoder` and its own
Opus-only `Output`. A companion exists exactly when its source is in the mix: the two conditions
are the two `initialize()` already asks (`config.microphoneEnabled && micStream` audio track,
`config.systemAudioEnabled && screenStream` audio track), which is what makes the set of
companions and `useRecordingSave`'s `hasAudio` agree by construction. The **level meters are
untouched** — two analysers, on the mix's own sources; a companion adds a tap, never a meter.

**A lost part is said out loud, from whichever layer knows.** A short list on this callback is also
what an ordinary take delivers, so the recorder cannot report the loss and `useRecordingSave` cannot
see it (it saves what it is handed). The **controller** can: it resolved the mode before the
countdown and counted how many companions the take asked for — the camera, plus one per audio
source it really has — so `onStop` raises `SEPARATE_TRACK_NOT_SAVED` when fewer arrive, and says
nothing for a composited take. `useRecordingSave` raises **the same notice** for the other half of
the same promise: a part lost in *storage* is caught, warned per role and reported once however
many were lost. One string either way; the console has the detail.

`onStop` is uniform on the WebCodecs path: `(blob, companions)` for every take, the list in role
order (webcam, mic, system) and `null` where there are none, so an ordinary take reports that it
had none rather than saying nothing. `Recorder` (MediaRecorder) still calls it with the blob alone.
One `RecorderStopCallback` (`store/types.ts`) types both.
```

- [ ] **Step 3: `apps/craft/CLAUDE.md` — the clock sections**

Append to "Frame timestamps and keyframes", after the "One clock, one bookkeeping record per encoder" paragraph:

```markdown
**The audio pipelines follow the same rule with a different unit.** The primary's mix counts its own
samples into `audioTimestamp`; each audio companion counts its own into its own `timestampUs`,
reset by the same `start()`. Per pipeline rather than shared, and that is the point: three
`onaudioprocess` callbacks advancing one counter would interleave and stamp each other's audio.
What they share is the **origin** — one `start()`, one `AudioContext`, one `isRecordingActive` /
`isPausedState` gate, one sample rate — which is what puts every part of a take on one timeline.
Paused time is excluded from all of them identically, because a buffer dropped while paused is
never counted. The residual risk is one 4096-sample buffer (~85 ms) if a callback lands exactly
across `start()`, which is the same risk the mix already carries against the two video pipelines.
```

- [ ] **Step 4: `apps/craft/CLAUDE.md` — "A take can be several files"**

Update the section for N parts. The edits:
- **Storage**: after the `hasAudio` sentence, add:
  > `hasAudio` is per part, and now genuinely differs across a take: the primary carries the mix (`true` whenever the take had any sound), the webcam part is `hasAudio: false` because the whole mix stays on the primary output, and each audio part is `hasAudio: true` and `hasWebcam: false`. An audio part is stored as **audio** — `mediaType: 'audio'`, `frameRate: 0`, `width`/`height` 0, `mimeType 'audio/webm'` — which is byte-for-byte what ESCAPEARTIST's own audio importer writes (`core/videoProcessor.ts`), so a part that arrived from a recording is indistinguishable from one that arrived from a file everywhere the editor branches on `mediaType`. It gets **no thumbnail**: there is nothing to decode, `getThumbnail` resolves `undefined`, the library draws its own empty placeholder and ARTIST already treats a missing picture as cosmetic. Its duration is the recorder's own, which is honest by construction — one recorder, one clock, one start, one stop.
  > The stored `name` is the take's name with its part named: `Recording <date> — webcam`, `— microphone`, `— system audio`. Those nouns, and the five sentences that can be said about a part going wrong, all come from `utils/companionParts.ts`.
- **Library**: replace `The companion row's meta line is prefixed \`Webcam track • \`` with:
  > Every companion row's meta line is prefixed with the track it is: `Webcam track • `, `Microphone track • `, `System audio track • `. Each is playable, WebM-downloadable and deletable on its own, and carries **no** MP4 and **no** M4A — not even M4A on an audio row, because that row's own bytes are already an audio file and a per-part conversion would be slice 4's composite pretending to exist. "Open in Editor" on any row hands over `takeId ?? id`.
- **`orderTakes`**: add that it ranks the roles (webcam, mic, system) ahead of the date, because every part is saved with one `now` and storage returns them in uuid order.
- **Interim**: leave `SEPARATE_TRACKS_MP4_NOTE` exactly as it is, and add one sentence: the note keys on the webcam alone and stays true — the mix is on the primary, so the audio parts take nothing out of what the MP4 and M4A contain.

- [ ] **Step 5: Root `CLAUDE.md` — Data Flow**

Amend the paragraph at `:145-152`:

```markdown
A **take** is not always one file. Since ESCSUITE-14 a recording made with "Record webcam as
a separate track" is up to **four** `SourceVideo`s sharing a `takeId` — the screen, the webcam,
the microphone and the system audio — each with a `role`
(`'screen' | 'webcam' | 'mic' | 'system'`) and a `startOffset`; the take is named by its
primary (the primary's `takeId` is its own id), and the primary carries both the
`overlayPlacement` the webcam was recorded at **and the mixed audio**, so a consumer that only
knows how to read one file still gets a complete, audible recording. The `mic` and `system`
parts are stored as `mediaType: 'audio'` with no dimensions and no thumbnail. Every field is
optional and `DB_VERSION` stays 1, so a single-file take — which is every recording made before
it and every composited PiP take after it — is read exactly as before. A consumer that resolves
one id should expect siblings: `getAllVideoMetadata()` filtered on `takeId`.
```

- [ ] **Step 6: Amend the spec's stale sentence and record the ARTIST follow-ups**

In `docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md:35`, replace `then places clips with explicit \`trackId\` and \`position = startOffset\`` with:

```markdown
then places clips with explicit `trackId` and `position = takeStart + startOffset`, where
`takeStart` is the end of the existing timeline — a handed-over take is **appended**, not laid
over whatever is already at position 0 (ESCSUITE-69; `apps/artist/src/store/clipSlice.ts`)
```

Then open two follow-up tickets for the ARTIST gaps recorded in this plan's "ARTIST follow-ups found while planning" section: an audio part reaching `addClipToTimeline` with 0×0 dimensions and falling through to `DEFAULT_TRANSFORM` by accident rather than by decision, and an imported audio part having no `waveformData` where an uploaded one does. Neither is touched here.

- [ ] **Step 7: The changeset** — create `.changeset/craft-audio-companions.md`

```markdown
---
'@escapesuite/craft': minor
---

"Record webcam as a separate track" now splits the sound as well as the picture. A take
recorded with it on produces a file per source: the screen, the webcam, the microphone and the
system audio — whichever of them the take actually had — all from one recorder off one clock, so
they line up by construction rather than by measurement. Each appears as its own row in the
library under its take, labelled with the track it is ("Microphone track", "System audio
track"), playable, downloadable and deletable on its own; deleting the take deletes all of them.

**The screen recording still carries the mixed audio**, exactly as before. Downloading the
screen part alone gives you a complete, audible recording, and nothing about a take recorded
without the mode changes at all. The audio files are extra — for anyone who wants to level the
microphone against the system audio, or cut one out, in the editor.

The toggle's help text says so before you choose it. It still costs about **twice the CPU and
twice the storage**, it is still **Chromium/Edge only**, and where a browser cannot serve it the
toggle stays on screen and disabled with the reason said out loud.

A lost track never costs the take: if one source's encoder, muxer or save fails, everything else
is still recorded, stored and listed, and the app says a separate track could not be saved. That
one sentence replaces the webcam-specific wording, because it is now true of four things.

Unchanged, and still named on the row it applies to: **MP4 and M4A of a separate-tracks take
cover the screen track only for now** — they carry the mixed audio, so they are complete
recordings, but the webcam track is not drawn into them yet. Download any part's own WebM from
its row until the composite lands.
```

- [ ] **Step 8: Coverage**

Run: `pnpm --filter @escapesuite/craft test:coverage`
Expected: PASS, with **lines at 100.00**. If any line is uncovered, the report names it — write the test rather than lowering the floor. The lines most likely to be missed, and the test that covers each:
- `companionPartFor`'s `'screen'` / `undefined` arm → `companionParts.test.ts` (Task 1, Step 1)
- `buildSourceVideo`'s audio arms → `recordingMetadata.test.ts` (Task 1, Step 2)
- `companionRank`'s unknown-role arm → it is reached by the existing orphan tests only if an orphan has a known role; if the report flags it, add a one-line case to `takeOrder.test.ts` with `role: 'subtitle'` asserting it sorts last
- `initializeAudioCompanion`'s catch → `'records the take without the microphone when its pipeline cannot be set up'` (Task 3)
- the `onaudioprocess` catch → covered by the existing `'logs an audio encoding failure…'` shape; if the report flags the companion's copy of it, add a case that sets `AudioEncoderDouble.instances[1].failAt = 'encodeThrow'` and asserts `consoleError` was called with `'Audio encoding error:'`
- `flushCompanions`' catch and `finalizeCompanions`' catch for an audio pipeline → `'still delivers the take when an audio companion will not flush'` (Task 3) and, for finalize, add `getMediabunnyState().outputs[2].finalize.mockRejectedValueOnce(new Error('muxer died'))` to the four-part delivery test and assert the mic part is absent with `'The microphone companion could not be finalized:'` warned
- `cleanup()`'s processor `disconnect` arm → `'disconnects every audio companion processor when the take is torn down'` (Task 3)
- the save path's `if (companionThumbnail)` false arm → the audio parts in `'decodes nothing for an audio part'` (Task 4)
- `RecordingsList`'s `companionLabel` truthy arm for a non-webcam role → `'labels each audio row as the track it is'` (Task 5)

If a figure rises past a whole percent, raise it in **both** `apps/craft/vite.config.ts:45-50` and `scripts/coverage-report.mjs:27`, and update the root `CLAUDE.md` coverage table. Never lower one.

- [ ] **Step 9: Full verification before the last commit**

Run: `pnpm --filter @escapesuite/craft test && pnpm --filter @escapesuite/craft typecheck && pnpm --filter @escapesuite/craft lint`
Expected: PASS, no errors.

Run: `pnpm --filter @escapesuite/shared test && pnpm --filter @escapesuite/artist test`
Expected: PASS, untouched — `packages/shared` was not modified and no ARTIST file was.

Run: `git diff --stat main -- apps/artist packages/shared`
Expected: **empty output.**

- [ ] **Step 10: Commit**

```bash
git add apps/craft/CLAUDE.md CLAUDE.md \
  docs/superpowers/specs/2026-09-24-escsuite-14-webcam-track-design.md \
  .changeset/craft-audio-companions.md
git commit -m "$(cat <<'EOF'
docs: a take's sound is several files too (ESCSUITE-14 slice 3)

The recorder lifecycle section now describes a list of companion pipelines
rather than one, the four ways a part is left out of what stop() delivers, and
the rule that keeps the audio companions a second tap rather than a diversion:
the primary keeps the mix, so a screen-only download is still a complete
recording. The clock section says how three audio pipelines share an origin
without sharing a counter. "A take can be several files" describes the audio
parts' stored shape — mediaType 'audio', no dimensions, no thumbnail, the
recorder's own duration — and the three row labels.

The spec's Consequences line said ARTIST places a take at
`position = startOffset`; slice 2 appends it (`takeStart + startOffset`, per
ESCSUITE-69), so the sentence is corrected rather than left to mislead the
next reader of the design.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
EOF
)"
```

---

## Self-review

**1. Spec coverage.** Every requirement in the brief and in the spec's §4 / Decisions / slice-3 row maps to a task:

| Requirement | Task |
|---|---|
| Mic and system each to their own Opus-only WebM, own `AudioEncoder`, own `MediaStreamSource` → own `ScriptProcessorNode` | 3 |
| `AudioWorklet` if the codebase already uses one — checked: it does not, anywhere; both recorders use `createScriptProcessor(4096, 2, 2)` and the doubles model that node | 3 (stated in Tech Stack and in the code comment) |
| Same `audioTimestamp` clock as the primary | 3 (D5: one origin, per-pipeline counter) |
| Primary keeps the mixed audio track exactly as today | 3 (`setupAudioCapture` not edited; asserted in the behaviour test, the ceiling suite and the e2e) |
| `CompanionPart.role` widens; `onStop(blob, companions)`; MediaRecorder path still one-argument | 1 (D2; `recorder.ts:160` untouched) |
| Only the audio sources that exist; zero audio companions is fine | 3 (two tests: no mic acquired, silent display capture) |
| Failure isolation identical to the webcam's — setup, encoder, flush, finalize, no samples | 3 (five tests) |
| Notice copy decided and pinned | 4 (D3, `SEPARATE_TRACK_NOT_SAVED`) |
| Storage: role, takeId, startOffset, `hasAudio: true`, `hasWebcam: false`, `mimeType 'audio/webm'`, name suffix, `mediaType`/`frameRate` found and set, no thumbnail | 1 (builders) + 4 (save path); D4 |
| `DB_VERSION` stays 1 | Global Constraint 10 (no shared-package change at all) |
| N companions written, companions first in reverse role order | 4 |
| `takeOrder` ranks the audio roles | 1 (D6) |
| Library rows, Play, Download WebM, Open in Editor, Delete, no MP4, no M4A on an audio row, interim note stays, cascade delete | 5 (cascade already works on `takeId` — `useRecordingLibrary.ts:55` is unchanged and its test still covers it) |
| Toggle copy decided and pinned | 5 (D1) |
| Ceilings: conservation exact, existing ceilings' three named lines | 3 |
| Benchmark tripwire for audio encoders | 6 (decided: yes) |
| e2e with the right roles, `decodeAudioData` in-page, the library rows | 7 |
| Docs, changeset, spec amendment, coverage | 8 |
| ARTIST gaps noted as follow-ups, not planned | "ARTIST follow-ups found while planning" + Task 8, Step 6 |

Two spec sentences deliberately left alone: `UPLOAD_RECORDING.parts` and the composite MP4/M4A (slice 4), and Decision 7's timeline placement (slice 2, already shipped).

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every log string, notice, label, name suffix and help sentence is written out verbatim at least twice — once in the implementation code and once in a test — and Global Constraint 11 lists them in one place. The two places values cannot be known in advance are named with the command that produces them and the instruction not to leave a cell blank: Task 6 Step 4 (the baseline table, `<DATE>` and `uptime` filled from the run) and Task 8 Step 8 (the coverage figures, with the eight likely-uncovered lines and the test for each listed rather than left to discovery).

**3. Type consistency.** Checked across tasks: `CompanionRole` (Task 1) is what `COMPANION_PARTS` is keyed by (Task 1), what `CompanionPipelineBase.role` is typed as (Task 2) and what `AudioCompanionPipeline` narrows to `'mic' | 'system'` (Task 3). `encodedCount` is the name in Task 2's interface, Task 2's `startCompanionCaptures`, Task 3's `onaudioprocess` and Task 3's `start()` reset — not `frameCount`, which was the slice-1 name and is renamed exactly once. `finalizeCompanions` (plural, returns `CompanionPart[]`) is the name in Task 2's interface block, Task 2's `stop()` and nowhere else; `finalizeCompanion` (singular, takes a pipeline) is private to it. `companionParts` is the double's field name in Task 1 Step 14 and in both Task 4 controller tests. `companionPartFor` is the function in Task 1's module, Task 1's `recordingMetadata.ts` and Task 5's `RecordingsList.tsx`; `COMPANION_PARTS` is the table used directly in Task 2's and Task 3's recorder and Task 4's save path. `hasWebcam` replaces `config` on `BuildRecordingEntryInput` in Task 1 and every call site is updated in the same task (two in `useRecordingSave.ts`, four in its test). `SEPARATE_TRACK_NOT_SAVED` is introduced and every one of its six references updated in Task 4.

One inconsistency found and fixed inline while reviewing: Task 2's `finalizeCompanions` reads `companion.kind === 'audio'` to choose the blob type, which is `never` at that commit because `CompanionPipeline` has one member — the step now says so explicitly and gives the equivalent `=== 'video' ? … : …` form to use if lint objects, so the pure-move commit compiles either way and Task 3 fills the arm in.
