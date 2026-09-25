# ESCSUITE-14 design proposal — webcam as a separate track (2026-09-24)

> Status: DESIGN APPROVED 2026-09-24 — the operator answered all eight questions (recorded under "Decisions"). Next step is the implementation plan; no code has been written.

## Recommendation (three sentences)

Record the webcam as a **companion recording** (Approach A), produced by a single `WebCodecsRecorder` instance that drives **two `VideoEncoder`s and two Mediabunny `Output`s off the one recording clock** (`nextFrameTiming`, `webcodecs-recorder.ts:453`), so the two blobs are frame-aligned by construction rather than by two independently-started MediaRecorders. Do the same for audio (mic blob + system blob) with the same clock, because every ARTIST read path — `frameSource.ts`'s `<video>` fallback for WebM, `videoProcessor.ts:427` and `audioMixer.ts:54`'s whole-blob `decodeAudioData` — is single-track by construction, so a multi-track WebM would be silently mixed-down or truncated to track 0 everywhere in the editor and in CRAFT's own MP4/M4A converter (`converter.ts:693`, `:550`). Keep the composited PiP take as the default for users who never open ARTIST, treat separate tracks as an explicit Chromium-only mode with the composited take as the documented fallback, and defer the single multi-track container (Approach B) until ARTIST has a Mediabunny-demux frame source worth building on its own merits.

## PR-day estimates (original assessment; superseded by the revised table under "Estimate, revised for the decisions" — the composite MP4/M4A and timeline placement the decisions added are what moved A from 9–13 to 12–15)

| Approach | CRAFT | ARTIST | Total (PR-days at this repo's review standard) |
|---|---|---|---|
| **A** — companion recordings, video + audio, ARTIST places two/three clips | 6–9 | 3–4 | **9–13** (video-only first slice: 6–8) |
| **B** — one multi-track WebM + Mediabunny demux in ARTIST | 2–3 | 10–15 | **12–18**, high variance |
| **C** — A now, multi-track container later | 9–13 now | — | **9–13 now**, B's ARTIST cost deferred, +1 for the forward-compatible metadata shape |

## Decisions (operator, 2026-09-24)

The eight questions the assessment raised, and the answers that bind the plan:

1. **Composited PiP stays the default.** Separate tracks is an explicit opt-in, "Record webcam as a separate track", shown in `WebcamOverlaySettings` only while the webcam is on. The compositor stays in the recording path for the default mode exactly as today (MediaRecorder, `fixWebMMetadata`, the `pip-seekable` guard); only the opt-in mode records through WebCodecs.
2. **The webcam companion is its own library row** (my call, accepted). It is labelled as the webcam half of its take, is playable and WebM-downloadable on its own, and deleting the screen row deletes the companion with it; deleting the companion alone demotes the screen row to a plain take. "Send to Editor" on either row sends the take (the primary's id). MP4 and M4A buttons live on the primary row only, and include the webcam (3).
3. **MP4 and M4A downloads include the webcam when one was recorded.** MP4 on a companion take is a *re-composite*: the converter plays the screen and webcam parts together and draws each frame through the same overlay geometry the live compositor uses (position, size and shape from the take's stored `RecordingConfig`), then encodes. M4A, and the MP4's audio, mix the mic and system parts. The screen-only MP4 is not offered — a user who wants a part alone downloads its WebM from its row.
4. **`UPLOAD_RECORDING` grows an optional `parts` array; the existing fields are unchanged** (my call: one message, backward compatible). `payload.blob` stays the primary (screen) part, so a host that knows nothing of companions keeps receiving exactly what it receives today; a host that opts in reads `payload.parts: [{ id, role, name, blob, startOffset }]`, which lists every part including the primary. The protocol comment in `integration.ts`, the root `CLAUDE.md` Integration API section, `apps/craft/CLAUDE.md` and the changeset all carry an **adoption note** for embedders, and the ESCAPEPOD upstream-requests page gets a row.
5. **Both kinds of client must work.** The toggle is off by default; it is disabled with a visible reason when `VideoEncoder` is unavailable (Firefox, Safari) and when the storage-headroom check, computed for roughly double the bitrate, fails; its label states that the mode uses about twice the CPU and storage. The recorder never switches mode mid-take — under encoder backpressure it drops frames (counted, reported through the existing benchmark's `framesEncoded`) rather than falling back, so a take is always one mode from start to finish.
6. **The `pip-seekable` guard is unchanged.** Decision 1 keeps composited PiP on MediaRecorder, which keeps the guard's only Chromium-drivable subject. The question is moot.
7. **The `?loadVideo=` handoff places clips on the timeline**, for every take, not only companion takes: the primary at position 0 on a video track, the webcam on a track above it at its `startOffset`, the mic and system parts on audio tracks. This is a behaviour change for single-take imports too and is named in ARTIST's changeset and the integration docs.
8. **The webcam clip carries the PiP position and size as transform defaults**, so the import looks like what the user saw while recording and stays editable in ARTIST. The **shape** (circle / rounded rectangle) is deferred to **ESCSUITE-65**: a shape/mask option on *every* ARTIST clip, applied identically in preview, export and headless render; once it exists, the handoff maps `webcamShape` onto it the way position and size are mapped here.

## Consequences the decisions fix in the design

- **Two recording paths coexist.** `recorder-factory.ts` gains a third input: `separateTracks`. Composited PiP (default) → MediaRecorder as today. Separate tracks → `WebCodecsRecorder` with two video encoders; the compositor still runs, but preview-only (its canvas is already what the preview shows). Audio-only and non-WebCodecs browsers → MediaRecorder as today. The existing `craft-pip-recording` benchmark and `compositor.perf.test.ts` ceilings describe the default path and are untouched; a **new** `craft-separate-tracks-recording` benchmark counts two encoders' frames.
- **Storage model.** `SourceVideo` gains optional `takeId`, `role: 'screen' | 'webcam' | 'mic' | 'system'`, `startOffset` (seconds) and, on the primary only, `overlayPlacement: { position, size, shape }` copied from `RecordingConfig` at save time (the composite MP4 and the ARTIST transform defaults both read it). `DB_VERSION` stays 1. `hasAudio` is per part. `loadRecordings` groups by `takeId`, orders the companion directly under its primary, and fixes the `hasWebcam: false // TODO`.
- **Converter.** `convertToMP4` grows a companion path that drives two `<video>` elements started together and draws through a pure `drawOverlay(ctx, screen, webcam, placement)` extracted from `Compositor.drawWebcamOverlay` so the live and the offline composite cannot drift apart (pinned by a shared unit test). `encodeAudioChunks` takes a mixed buffer built from the audio parts. `convertToM4A` mixes the same parts. Per-frame ceilings for the composite path are measured and set at 2× per policy.
- **ARTIST import.** `useHostIntegration` resolves siblings by `takeId` from the shared DB, adds every part with `addSourceVideo`, then places clips with explicit `trackId` and `position = takeStart + startOffset`, where `takeStart` is the end of the existing timeline — a handed-over take is **appended**, not laid over whatever is already at position 0 (amended 2026-09-25 to match what slice 2 shipped; ESCSUITE-69, `apps/artist/src/store/clipSlice.ts`) — the webcam clip's `transform` seeded from `overlayPlacement` (position → x/y, size → scale). The shape is ignored until ESCSUITE-65.
- **Firefox and Safari** never see the toggle enabled; the fallback take is byte-for-byte a pre-feature take.

## Estimate, revised for the decisions

| Slice | Content | PR-days |
|---|---|---|
| 1 | CRAFT: `separateTracks` mode in the WebCodecs recorder (two encoders, one clock), the toggle with its gates, two-part save, `takeId`/`role`/`startOffset`/`overlayPlacement` metadata, grouped library rows, cascade delete, benchmark | 5–6 |
| 2 | ARTIST: sibling resolution, clip placement for every handoff, webcam transform defaults; integration docs | 2–3 |
| 3 | CRAFT: mic and system as audio companions on the same clock; per-part `hasAudio` | 2 |
| 4 | CRAFT: composite MP4 + mixed M4A (shared `drawOverlay`), `UPLOAD_RECORDING.parts`, adoption notes, ESCAPEPOD row | 3–4 |

**Total 12–15 PR-days**, each slice its own PR and release; slice 1 alone is shippable (the webcam companion appears in the library and in ARTIST as a second source; placement and composite downloads follow).

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

**Handoff.** `SEND_TO_EDITOR { id }` (`sendToEditor.ts:16`) and `?loadVideo=<id>` need **no protocol change**: ARTIST already reads the shared DB, so `useHostIntegration.ts:118-155` can fetch the primary, read its `takeId`, and `getAllVideoMetadata()` the siblings. `UPLOAD_RECORDING { id, name, blob }` (`uploadToHost.ts:33`) carries bytes, not ids, so it gains the optional `parts` array (decision 4).

**ARTIST import.** Two new behaviours: (a) resolve and add siblings, (b) place clips. Today the handoff only calls `addSourceVideo` (`useHostIntegration.ts:138`); placing needs `addClipToTimeline` (`clipSlice.ts:19`, which auto-creates a track at top and defaults `timelinePosition` to `state.currentTime`) called once per part with an explicit `trackId` and `position = startOffset`. The webcam clip's `transform` carries the PiP position and size so the import looks like the composited take (decision 8; shape deferred to ESCSUITE-65).

## 4. Audio: the same two options, same answer

Multi-audio-track WebM is *writable* (127 audio tracks) and *not separable* by anything ARTIST or CRAFT uses: `decodeAudioData` on the whole blob at `audioMixer.ts:54` and `videoProcessor.ts:427`, and `extractAudio` at `converter.ts:550`. So audio needs the same companion route (two more blobs, `role: 'mic' | 'system'`, same clock via `audioTimestamp`, `webcodecs-recorder.ts:373`) or the same demux route. Two mono/stereo Opus-only WebMs are small; ARTIST already imports audio-only sources through `extractAudioMetadata`, and `hasAudio` bookkeeping (`useRecordingSave.ts:116`, ESCSUITE-62's `systemAudioShared` rule) becomes per-part, which is strictly more truthful than today.

## 5. What each option does to existing guarantees

- **Composited PiP stays on MediaRecorder** (decision 1), so `recorder-factory.ts`'s PiP exclusion (`:27`), `fixWebMMetadata` (`useRecordingSave.ts:50-66`) and the `pip-seekable` guard all keep their current subject and meaning. Only the opt-in separate-tracks mode goes through `WebCodecsRecorder`, where it inherits ESCSUITE-59's wall-clock timestamps and per-second keyframes and needs no duration fix.
- **Benchmarks.** `craft-pip-recording`'s tripwires (`framesEncoded === 0`, an *even* `drawImage` count) describe the default path and stay true. The separate-tracks mode gets its own benchmark, whose tripwires are the opposite: two encoders' frames counted, and the compositor drawing for the preview only.
- **Downloads.** WebM download is per row and unaffected. MP4/M4A on a companion take re-composite and mix the parts (decision 3), which is new converter work with its own per-frame ceilings. Under B, MP4/M4A would silently lose the extra tracks, which is the worst outcome of the three.
- **Standalone build.** Neither option adds a dependency (mediabunny is already in both apps) or a server call, so the offline single-file build and `apps/e2e/tests/standalone/craft.spec.ts`'s no-off-origin-requests assertion are unaffected. Storage pressure roughly doubles in the opt-in mode, which the storage-headroom gate accounts for.

## 6. Firefox and Safari

Neither has WebCodecs, so `canUseWebCodecsRecorder` (`recorder-factory.ts:26-30`) already routes every take there to MediaRecorder, whose Chromium and Gecko implementations record one video and one audio track per instance. Two MediaRecorder instances would produce two files with no shared clock and no reliable start offset — exactly the alignment property A depends on. **The feature is Chromium/Edge-only**, with the composited take as today's documented fallback: `SourceToggles`-style "say why, do not hide" wording on the mode control, and `hasAudio`/role metadata written so a fallback take is indistinguishable from a pre-feature take.

## Approaches

**A — companion recordings (recommended).** User gets a screen clip and a webcam clip on two ARTIST tracks, movable/resizable/deletable, webcam at native resolution. Changes: `webcodecs-recorder.ts` (second encoder/output/track-processor, shared clock, two-blob `onStop`), `recorder-factory.ts` (a `separateTracks` input selects the WebCodecs recorder for PiP; the default composited path is untouched), `useRecordingController.ts` (in the new mode the compositor is preview-only; two-part save), `useRecordingSave.ts` + `recordingMetadata.ts` (two records), `recorderStore.ts` (`loadRecordings` grouping, the `hasWebcam` TODO), `packages/shared/src/types` (three optional fields), `useHostIntegration.ts` + ARTIST import (siblings + clip placement), `uploadToHost.ts` (optional `parts`). Migration: none required — new fields are optional, old recordings keep behaving as single takes. Tests: extend `webcodecs-recorder.test.ts`'s scripted-clock suites to assert both encoders receive the same timestamp for the same tick; `webcodecsRecorder.perf.test.ts` conservation (frames created == closed, one encode per frame **per encoder**, two flushes); `recordingMetadata`/`useRecordingSave` unit tests for the two records; an e2e PiP take in Chromium asserting two stored blobs with matching `takeId` and both seekable; an ARTIST e2e asserting two clips at position 0 on two tracks. Risks: main-thread CPU for two encoders; storage; the offline re-composite's two-video sync in the converter (mitigated by starting both elements together and reading the webcam frame at the screen frame's `mediaTime`).

**B — one multi-track WebM + demux.** User gets one file. CRAFT change is small; ARTIST needs a Mediabunny `Input`-based frame source, per-track audio extraction, a track-addressable clip model, and fallbacks for `<video>`-based consumers — and until all of that lands, the file is *worse* than today's (silent track loss in preview, export, MP4, waveform). Migration: no existing recording is multi-track, so nothing to migrate, but any take written before ARTIST's demux lands is a trap. Risks: highest; touches ARTIST's decode core and the export path both preview and headless render share.

**C — A now, container later.** Ship A with `takeId`/`role` chosen so a later single-container writer can express the same grouping, and revisit B when ARTIST wants a Mediabunny frame source for its own reasons (WebM background-capable decode is already a known gap: `frameSource.ts:331` restricts WebCodecs to MP4). Same cost as A now; the forward-compatible metadata is the only extra.

### Critical Files for Implementation
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/core/webcodecs-recorder.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/hooks/useRecordingController.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/craft/src/hooks/useRecordingSave.ts
- /Users/littlemac/Projects/ESCAPESUITE/packages/shared/src/types/index.ts
- /Users/littlemac/Projects/ESCAPESUITE/apps/artist/src/app/useHostIntegration.ts