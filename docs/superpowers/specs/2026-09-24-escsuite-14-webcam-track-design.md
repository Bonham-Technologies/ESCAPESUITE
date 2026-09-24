# ESCSUITE-14 design proposal — webcam as a separate track (2026-09-24)

> Status: PROPOSAL awaiting operator decisions (the eight questions below). No implementation has started.

## Recommendation (three sentences)

Record the webcam as a **companion recording** (Approach A), produced by a single `WebCodecsRecorder` instance that drives **two `VideoEncoder`s and two Mediabunny `Output`s off the one recording clock** (`nextFrameTiming`, `webcodecs-recorder.ts:453`), so the two blobs are frame-aligned by construction rather than by two independently-started MediaRecorders. Do the same for audio (mic blob + system blob) with the same clock, because every ARTIST read path — `frameSource.ts`'s `<video>` fallback for WebM, `videoProcessor.ts:427` and `audioMixer.ts:54`'s whole-blob `decodeAudioData` — is single-track by construction, so a multi-track WebM would be silently mixed-down or truncated to track 0 everywhere in the editor and in CRAFT's own MP4/M4A converter (`converter.ts:693`, `:550`). Keep the composited PiP take as the default for users who never open ARTIST, treat separate tracks as an explicit Chromium-only mode with the composited take as the documented fallback, and defer the single multi-track container (Approach B) until ARTIST has a Mediabunny-demux frame source worth building on its own merits.

## PR-day estimates

| Approach | CRAFT | ARTIST | Total (PR-days at this repo's review standard) |
|---|---|---|---|
| **A** — companion recordings, video + audio, ARTIST places two/three clips | 6–9 | 3–4 | **9–13** (video-only first slice: 6–8) |
| **B** — one multi-track WebM + Mediabunny demux in ARTIST | 2–3 | 10–15 | **12–18**, high variance |
| **C** — A now, multi-track container later | 9–13 now | — | **9–13 now**, B's ARTIST cost deferred, +1 for the forward-compatible metadata shape |

## Open questions only the operator can answer

1. Should the **composited PiP remain the default**, with separate tracks an opt-in ("Record webcam as separate track" in `WebcamOverlaySettings`), or should separate tracks become the default in Chromium with composited as the fallback? The answer decides whether the compositor stays in the recording path at all.
2. Should the **webcam-only companion be its own library row** — playable, downloadable, deletable on its own — or hidden behind the primary row as a child? `loadRecordings` filters on `source === 'recording'` (`recorderStore.ts:124`), so it appears as a second row unless deliberately excluded.
3. **Are the MP4/M4A downloads expected to carry the webcam?** They cannot without a composite pass at conversion time (`convertToMP4` reads one `<video>`, `converter.ts:693`). Acceptable answers: per-part MP4s, a "download composited MP4" that re-composites, or MP4 = screen only with a visible note.
4. Should `UPLOAD_RECORDING` gain a **multi-part payload** (`parts: [{ id, role, blob }]`) or post once per part? This is a breaking-ish change for existing embedders; `SEND_TO_EDITOR` needs no change if ARTIST resolves siblings from the shared DB.
5. Is it acceptable that a separate-track take **roughly doubles bitrate, CPU and storage** (two main-thread `VideoEncoder`s, webcam at native resolution rather than the 256×144 it currently occupies inside the 1280-capped canvas, `compositor.ts:42`, `:226`)? Storage headroom (`hasSpaceForRecording`) and the record-blocked reason may need to reflect it.
6. If PiP moves off MediaRecorder, the **`webm-duration-fix` CJS-interop guard loses its only Chromium-drivable subject** (`pip-seekable.spec.ts`; PiP is the sole mode reaching MediaRecorder in Chromium today). Is moving that guard to an audio-only take acceptable, or must a composited MediaRecorder PiP path stay reachable in CI?
7. Does ARTIST's `?loadVideo=` handoff now get to **place clips on the timeline**? Today it only adds to the media library (`useHostIntegration.ts:138`); "two tracks aligned in time" is new behaviour that changes what the handoff means for single-take imports too.
8. Should the webcam companion carry the **PiP placement as clip transform defaults** (position/size/shape from `RecordingConfig`), so the imported take looks like the composited one before the user touches anything?

---

# ESCSUITE-14 design assessment

## 1. Where the merges happen today

**Webcam → screen (video).** The only compositing site is `Compositor.drawFrame` (`apps/craft/src/core/compositor.ts:198`): it fills black, draws the screen `<video>` full-frame (`:207`), then `drawWebcamOverlay` (`:219`) clips a circle or rounded rect and draws the camera into it (`:288`, `:317`). The canvas is capped at 1280 px wide (`:42-52`) and the overlay is `width * webcamSize` — 256×144 at the default 0.2 (`:226-227`), which is what "the webcam can never be moved or resized afterwards" costs in pixels as well as in editability. `start()` produces the recorded stream with `canvas.captureStream(frameRate)` (`:127`).

The controller builds it for a screen+webcam take (`useRecordingController.ts:301-317`), then hands the recorder **the compositor's video track plus the display stream's audio track** as `recordingScreen` (`:395-405`). `isPiP` (`:325`) forces MediaRecorder via `recorder-factory.ts:26-30` — the documented reason being that the compositor's hidden, off-screen `<video>` elements (`compositor.ts:84`, `:104`) break WebCodecs frame capture.

**Mic + system (audio), WebCodecs path.** `WebCodecsRecorder.initialize` creates one `AudioContext` and one `createMediaStreamDestination()` (`webcodecs-recorder.ts:199-203`); the system track (`:206-217`) and the mic (`:220-226`) each get a `MediaStreamSource` connected to that single destination, plus an analyser for the meters. `destination.stream` becomes `mixedAudioStream` (`:229`), fed through one `ScriptProcessorNode` (`:344`) into **one** `AudioEncoder` (`:307-323`) and **one** `addAudioTrack` (`:266-267`). The mix is irreversible before encoding.

**Mic + system, MediaRecorder path.** Identical shape: `recorder.ts:62-94` builds the same graph, and `:97-99` pushes exactly one mixed audio track into `combinedStream` (`:105`) alongside one video track, which is what `MediaRecorder` receives (`:138`).

## 2. Is one multi-track WebM viable end to end?

**Writing it: yes.** `WebMOutputFormat extends MkvOutputFormat` (`mediabunny.d.ts:5380`), whose `getSupportedTrackCounts()` returns `max: 127` for video, audio and subtitle (`dist/modules/src/output-format.js:277-286`). `Output.addVideoTrack`/`addAudioTrack` (`d.ts:3621-3623`) may be called repeatedly, so CRAFT's existing muxer setup (`webcodecs-recorder.ts:253-268`) extends to two video tracks and two audio tracks with a second `EncodedVideoPacketSource`/`EncodedAudioPacketSource` and a second encoder each. Cheap in CRAFT: ~2–3 PR-days.

**Reading it: expensive, and it breaks things that work today.** Chromium's `<video>` exposes no track selection (`videoTracks`/`audioTracks` are not shipped) and plays track 0; `decodeAudioData` decodes a single audio stream rather than summing them. Every ARTIST read path is built on exactly those two primitives:

- `FrameSourceFactory.createSource` uses WebCodecs **only for `mimeType.includes('mp4')`** and otherwise falls back to `HTMLVideoFrameSource` (`frameSource.ts:331-352`) — so every CRAFT WebM already decodes through `<video>`. Nothing anywhere in `frameSource.ts`, `videoDecodeManager.ts` or the decode worker names a track index.
- `audioMixer.extractAndMixAudio` does `offlineCtx.decodeAudioData(arrayBuffer.slice(0))` on the whole blob, once per clip (`audioMixer.ts:54`).
- `videoProcessor.extractAudioMetadata` does the same for the waveform (`videoProcessor.ts:427`); `resolveStoredDuration`/`loadMediaDuration` probe with a media element.
- CRAFT's own `convertToMP4` drives a single `<video>` with `requestVideoFrameCallback` (`converter.ts:693`, `:148-244`) and `extractAudio` uses `decodeAudioData` (`:550`).

So track 2 would be invisible and track 4 inaudible in the preview, the export, the thumbnail, the waveform, the duration probe **and** in the MP4/M4A downloads — a silent data loss rather than a visible failure. Making it visible means a new `MediabunnyFrameSource` (`Input.getVideoTracks()`, `d.ts:2378`, feeding `VideoSampleSink`/`CanvasSink`, `d.ts:5022`/`:752`) that satisfies `IFrameSource` (`frameSource.ts:41-70`) — plausible, since `getFrame(): Promise<DrawableFrame>` already returns `VideoFrame` — plus per-track audio via `AudioBufferSink` (`d.ts:162`), plus a `SourceVideo`/`Clip` model that can say *which track* a clip references (`store/types.ts:309-336` has `sourceVideoId` and nothing else), plus fallbacks for every non-Mediabunny consumer. That is the 10–15 day figure, and it is a rewrite of ARTIST's decode entry point, not an addition to it.

## 3. The companion-recording alternative

**In CRAFT, do not use two recorder instances — use one recorder with two encoders.** Two MediaRecorders started back to back have no shared, readable capture-start time; the WebCodecs recorder already has one (`startTime`, `webcodecs-recorder.ts:398`) and one helper that stamps every frame from it (`nextFrameTiming`, `:453-465`, with the strictly-increasing guard and the per-second keyframe rule). Adding a second `MediaStreamTrackProcessor` + `VideoEncoder` + `Output` that calls the *same* `nextFrameTiming` gives both blobs timestamps on one clock, so alignment is a shared-clock property rather than a measurement. Pause/resume (`pausedDuration`, `:626`) and the `ended` handling (`:232-251`) extend naturally; `stop()` (`:635`) flushes and finalizes both and delivers two blobs.

**Stored metadata.** `SourceVideo` (`packages/shared/src/types/index.ts`) needs three optional fields — `takeId` (shared), `role: 'screen' | 'webcam' | 'mic' | 'system'`, `startOffset` (seconds, 0 for the primary). All optional, so `DB_VERSION` stays 1 and `storeVideo` (`storage/index.ts:76`) is unchanged; a companion is a second `storeVideo` + `storeThumbnail` from `useRecordingSave` (`useRecordingSave.ts:129-130`), which currently writes exactly one of each. `buildSourceVideo`/`buildRecordingEntry` (`recordingMetadata.ts:25`, `:61`) grow a role and stay pure. `loadRecordings` (`recorderStore.ts:123-149`) must decide what a companion row is — note `hasWebcam: false // TODO` at `:141` is already a known lie that this work would have to fix.

**Handoff.** `SEND_TO_EDITOR { id }` (`sendToEditor.ts:16`) and `?loadVideo=<id>` need **no protocol change**: ARTIST already reads the shared DB, so `useHostIntegration.ts:118-155` can fetch the primary, read its `takeId`, and `getAllVideoMetadata()` the siblings. `UPLOAD_RECORDING { id, name, blob }` (`uploadToHost.ts:33`) does need a decision (question 4) because it carries bytes, not ids.

**ARTIST import.** Two new behaviours: (a) resolve and add siblings, (b) place clips. Today the handoff only calls `addSourceVideo` (`useHostIntegration.ts:138`); placing needs `addClipToTimeline` (`clipSlice.ts:19`, which auto-creates a track at top and defaults `timelinePosition` to `state.currentTime`) called once per part with an explicit `trackId` and `position = startOffset`. The webcam clip's `transform` can carry the PiP position/size so the import looks like the composited take (question 8).

## 4. Audio: the same two options, same answer

Multi-audio-track WebM is *writable* (127 audio tracks) and *not separable* by anything ARTIST or CRAFT uses: `decodeAudioData` on the whole blob at `audioMixer.ts:54` and `videoProcessor.ts:427`, and `extractAudio` at `converter.ts:550`. So audio needs the same companion route (two more blobs, `role: 'mic' | 'system'`, same clock via `audioTimestamp`, `webcodecs-recorder.ts:373`) or the same demux route. Two mono/stereo Opus-only WebMs are small; ARTIST already imports audio-only sources through `extractAudioMetadata`, and `hasAudio` bookkeeping (`useRecordingSave.ts:116`, ESCSUITE-62's `systemAudioShared` rule) becomes per-part, which is strictly more truthful than today.

## 5. What each option does to existing guarantees

- **PiP can move to WebCodecs under A.** If neither encoder reads the compositor, `recorder-factory.ts`'s PiP exclusion (`:27`) no longer applies to the separate-track mode; the compositor becomes preview-only (its canvas is already attached directly to the preview, `useMediaStreams.ts:74-87`, with no `captureStream` needed for that). PiP then inherits the wall-clock timestamps and per-second keyframes of ESCSUITE-59 and stops needing `fixWebMMetadata` (`useRecordingSave.ts:50-66`).
- **Cost: the `pip-seekable` guard.** Per `apps/craft/CLAUDE.md`'s WebM Handling, those two e2e specs are the *only* thing that can catch the `webm-duration-fix` CJS-interop regression, precisely because PiP is the one mode reaching MediaRecorder in Chromium. Moving them to an audio-only take (also MediaRecorder, `recorder-factory.ts:27-28`) is the obvious mitigation and must ship in the same PR (question 6).
- **Benchmarks.** `craft-pip-recording` asserts `framesEncoded === 0` "by construction" and an *even* `drawImage` count (two draws per composited frame). Under A both tripwires change meaning: encoding returns to the main thread (two encoders), and the preview composite may or may not remain. `compositor.perf.test.ts`'s per-frame ceilings and the 30 fps deadline gate survive only if the compositor stays for the preview; if the preview becomes two stacked DOM elements, those ceilings are deleted rather than raised — which is a ceiling change that must be argued in the PR per the root policy.
- **Downloads.** WebM download is per-row and unaffected. MP4/M4A on a companion take convert one part each (question 3). Under B, MP4/M4A would silently lose the extra tracks, which is the worst outcome of the three.
- **Standalone build.** Neither option adds a dependency (mediabunny is already in both apps) or a server call, so the offline single-file build and `apps/e2e/tests/standalone/craft.spec.ts`'s no-off-origin-requests assertion are unaffected. Storage pressure roughly doubles, which the standalone build feels first.

## 6. Firefox and Safari

Neither has WebCodecs, so `canUseWebCodecsRecorder` (`recorder-factory.ts:26-30`) already routes every take there to MediaRecorder, whose Chromium and Gecko implementations record one video and one audio track per instance. Two MediaRecorder instances would produce two files with no shared clock and no reliable start offset — exactly the alignment property A depends on. **The feature is Chromium/Edge-only**, with the composited take as today's documented fallback: `SourceToggles`-style "say why, do not hide" wording on the mode control, and `hasAudio`/role metadata written so a fallback take is indistinguishable from a pre-feature take.

## Approaches

**A — companion recordings (recommended).** User gets a screen clip and a webcam clip on two ARTIST tracks, movable/resizable/deletable, webcam at native resolution. Changes: `webcodecs-recorder.ts` (second encoder/output/track-processor, shared clock, two-blob `onStop`), `recorder-factory.ts` (PiP no longer forces MediaRecorder in the new mode), `useRecordingController.ts` (compositor becomes preview-only; two-part save), `useRecordingSave.ts` + `recordingMetadata.ts` (two records), `recorderStore.ts` (`loadRecordings` grouping, the `hasWebcam` TODO), `packages/shared/src/types` (three optional fields), `useHostIntegration.ts` + ARTIST import (siblings + clip placement), `uploadToHost.ts` (multi-part). Migration: none required — new fields are optional, old recordings keep behaving as single takes. Tests: extend `webcodecs-recorder.test.ts`'s scripted-clock suites to assert both encoders receive the same timestamp for the same tick; `webcodecsRecorder.perf.test.ts` conservation (frames created == closed, one encode per frame **per encoder**, two flushes); `recordingMetadata`/`useRecordingSave` unit tests for the two records; an e2e PiP take in Chromium asserting two stored blobs with matching `takeId` and both seekable; an ARTIST e2e asserting two clips at position 0 on two tracks. Risks: main-thread CPU for two encoders; storage; the benchmark/ceiling churn above; the `pip-seekable` guard relocation.

**B — one multi-track WebM + demux.** User gets one file. CRAFT change is small; ARTIST needs a Mediabunny `Input`-based frame source, per-track audio extraction, a track-addressable clip model, and fallbacks for `<video>`-based consumers — and until all of that lands, the file is *worse* than today's (silent track loss in preview, export, MP4, waveform). Migration: no existing recording is multi-track, so nothing to migrate, but any take written before ARTIST's demux lands is a trap. Risks: highest; touches ARTIST's decode core and the export path both preview and headless render share.

**C — A now, container later.** Ship A with `takeId`/`role` chosen so a later single-container writer can express the same grouping, and revisit B when ARTIST wants a Mediabunny frame source for its own reasons (WebM background-capable decode is already a known gap: `frameSource.ts:331` restricts WebCodecs to MP4). Same cost as A now; the forward-compatible metadata is the only extra.

### Critical Files for Implementation
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/core/webcodecs-recorder.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/hooks/useRecordingController.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/hooks/useRecordingSave.ts
- /Users/littlemac/Projects/ESCAPESUITE/packages/shared/src/types/index.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/artist/src/app/useHostIntegration.ts