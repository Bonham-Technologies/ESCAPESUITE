# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPECRAFT is a client-side video recorder built with React 19, TypeScript, and Vite. It records screen, webcam, and audio directly in the browser with no server required. Part of the ESCAPE Suite alongside ESCAPEARTIST (video editor).

**Monorepo Location**: `apps/craft` in the ESCAPESUITE monorepo.

## Build Commands

Run from monorepo root using pnpm:

```bash
pnpm dev:craft           # Start development server (localhost:5174)
pnpm build:craft         # Production build
pnpm test --filter=@escapesuite/craft    # Run tests
pnpm lint                # Lint all apps including craft
```

Or from this directory:

```bash
pnpm dev                 # Start development server
pnpm build               # TypeScript check + Vite build
pnpm build:standalone    # Offline single-file build
pnpm test:run            # Run tests
pnpm lint                # Run ESLint
```

## Architecture

### App (`src/App.tsx`)
`App.tsx` is wiring only — one store selector per field it reads, the two refs the take and
the save share, the `showHelpModal` flag, the `isRecordingActive` derivation and
`toggleSource`, one call per hook below, and the JSX that composes the components. It registers
no effect of its own and binds no listener.

**`App` selects each field; it must never call `useRecorderStore()` with no selector.** A
whole-store subscription re-renders `App`, every component below it and every hook it calls on
*every* store write — including the ~12 audio levels a second a running take pushes for a value
that moves two meter bars. The three fields nothing outside the Sources panel reads
(`detailedCapabilities`, `audioLevels`, `systemAudioShared`) are not in `App` at all:
`SourceTogglesPanel` subscribes to them and renders the props-only `SourceToggles`, because a
field `App` merely passes through still re-renders `App`. `WebcamOverlaySettingsPanel` has its
own, separate subscription to `hasSeparateTracksSpace`, which it turns into the disabled toggle's
reason and renders the props-only `WebcamOverlaySettings` (ESCSUITE-14). `App` **also** selects
`hasSeparateTracksSpace` since ESCSUITE-176, because `recordBlockedReason()` needs it for the
Record button's own gate (see "Separate tracks" below) — the two subscriptions answer two
different questions (can the toggle be switched on; can *this* configured take be started) and
happen to read the same field, which both `refreshStorageSpace()` calls write in one `set()`, so
the two components still re-render together rather than drifting. `App.rerender.test.tsx` is the net,
and nothing else is: it counts each component's renders across 12 level pushes and asserts the
five non-subscribers at exactly 0 (measured 2026-09-16, before → after: `App` 12 → 0,
`AppHeader` 12 → 0, `RecordingsList` 12 → 0, `RecorderControls` 12 → 0, `RecordingPreview`
12 → 0, `SourceToggles` 12 → 12), plus exactly one `App` render per recorder-state change.
Restoring the destructure, or threading `audioLevels` back through `App`, passes every other
App test and fails only that file.

**The same rule for the two fields that tick on their own.** `currentDuration` (the
controller's once-a-second `setCurrentDuration`, for the whole length of a take) and
`countdownValue` (3-2-1, before one) are not in `App` either. Each is drawn by a leaf that
subscribes to it where it is shown — `RecordingDurationReadout` inside the transport bar's
timer span, `CountdownOverlay` inside the preview stage — so a tick re-renders five characters
or one digit instead of the whole screen. `App.rerender.test.tsx` counts this too, exactly
(measured 2026-09-23 over five duration ticks and three countdown ticks, before → after: `App`
8 → 0, and with it `AppHeader`, `RecordingsList`, `RecorderControls`, `RecordingPreview` and
`SourceToggles` 8 → 0 each, while the readout renders 5 and the overlay 3), and it asserts the
two numbers are still *drawn* — a leaf that subscribed to nothing would pass a render count of
zero.

The hooks are called in a fixed order — theme, capability bootstrap, media streams, recording
save, recording controller, keyboard shortcuts, recording library — because that order is the
order the effects ran in when they were all inline, and for the ones that bind something it is
behaviour rather than tidiness: `useMediaStreams` registers the preview attach and then the
`stopAllStreams` mirror, and `useRecordingController`'s unmount teardown — registered after
both, and itself order-dependent (cancelled flag → duration interval → countdown interval →
`recorder.dispose()` → `stopAllStreams()` → store reset) — reaches the live `stopAllStreams`
through that mirror rather than through a stale closure. `useKeyboardShortcuts` binds the one
window listener `App` itself owns. `useRecordingLibrary` binds nothing, so its position is free
— it is called just *before* the shortcuts, because `modalOpen` needs its `playbackUrl`.

`recorderTypeRef` and `capturedThumbnailRef` are created in `App` and handed to two hooks by
reference: `useRecordingController` writes them while a take runs, `useRecordingSave` reads
them when the recorder's `onStop` fires. Every ref in the screen is created in exactly one
place — a second `useRef()` in either hook would leave the save reading a recorder type and a
thumbnail nobody wrote. The same rule puts `compositorRef`, `micStreamRef`, `previewRef` and
`canvasPreviewRef` in `useMediaStreams`, and the recorder, cancelled-flag, attempt-token and
interval refs in `useRecordingController`, each passed on to whoever else reads it.

Every module below has its own test file; `App.tsx` itself is covered through
`App.recording.test.tsx`, `App.saving.test.tsx`, `App.library.test.tsx` and
`App.settings.test.tsx`, which drive the rendered app, plus `App.rerender.test.tsx` for the
selector contract above.

| Module | Owns |
|--------|------|
| `App.tsx` | The composition: the per-field store selectors, `recorderTypeRef` / `capturedThumbnailRef`, `showHelpModal`, `isRecordingActive`, `sidebarLocked` (`isRecordingActive \|\| state === 'preparing' \|\| state === 'saving'` — wider than `isRecordingActive`, which also arms the transport bar's stop/cancel button, ESCSUITE-106, so neither `'preparing'` nor `'saving'` may make that button claim it can stop or cancel a take that has no recorder yet or has already finished; ESCSUITE-104). `'preparing'` is in `sidebarLocked` because `CapturedTake` is captured after `acquireStreams()` resolves, still mid-`'preparing'` — a toggle flipped before that snapshot would look live for a take it will never describe. `SourceTogglesPanel` also gets `showMeters={isRecordingActive}`, narrower than `sidebarLocked`: the audio meters draw live levels the store never resets between takes, so gating them on the wider lock would leave them on screen, frozen, for the whole time a finished take is saving. `toggleSource`, `modalOpen` (`showHelpModal \|\| playbackUrl !== null`), the hook calls in their fixed order, and the header/sidebar/content/dialog JSX |
| `utils/recordingFormat.ts` | `formatDuration` (`MM:SS`, floor-truncated) and `safeFileName` — pure string formatting shared by the duration labels, the library rows and the download handler |
| `utils/previewThumbnail.ts` | Capturing a thumbnail frame from the live preview (compositor canvas or `<video>`) and drawing the placeholder used when every other capture path fails. Canvas creation and `toBlob` are its only side effects |
| `utils/notices.ts` | The app's whole vocabulary of notices — sixteen strings and one one-argument string (`mp4ConversionFailed`), one per thing that can go wrong or be worth saying afterwards. See "Errors and notices" below; there is deliberately no second channel and no notification framework |
| `utils/downloadBlob.ts` | The anchor both downloads share: object URL, `<a download>`, click, remove, deferred revoke. No naming logic of its own — the caller hands it a finished filename |
| `utils/recordReadiness.ts` | `recordBlockedReason` — whether the Record button may start a take, and the sentence shown when it may not. Pure, over `capabilitiesReady` + the config + the capabilities + `hasStorageSpace` + `hasSeparateTracksSpace` (ESCSUITE-176: asked only when the config would actually run the mode — both sources on and the toggle on — reusing `SEPARATE_TRACKS_NO_SPACE_REASON` from `separateTracksReadiness.ts` rather than a reason of its own). Owns `NO_STORAGE_SPACE`, which is a *button reason* rather than a notice |
| `utils/separateTracksReadiness.ts` | `separateTracksBlockedReason` — whether "Record webcam as a separate track" may be switched on, and the sentence the toggle says when it may not. Pure, over two booleans: what the browser can do (`canRecordSeparateTracks()`) and whether there is room for two tracks (`hasSeparateTracksSpace`). The browser's answer wins when both are false, because nobody can act on "not enough storage" in Safari. Owns both reasons, beside their gate for the same reason `NO_STORAGE_SPACE` is |
| `utils/takeOrder.ts` | `orderTakes` — newest take first, each take's companion rows directly under the primary they belong to **in role order** (`companionRank`: webcam, then mic, then system, a role this build does not know last), orphaned companions last. Pure over the list; `loadRecordings` is its only caller |
| `utils/takeParts.ts` | Reading a take's parts back out of storage, for the two things that need them: `loadWebcamCompanion(primary)` — the camera half plus the primary's `overlayPlacement`, for the composite MP4, with **three** answers because "there is no camera part" (a plain take, one saved before ESCSUITE-14, or one whose camera row was deleted, which demotes it) and "there is one I cannot read" are different facts; and `loadTakeParts(takeId, { primaryBlob? })` — every part with its bytes, primary first then camera then sound, **empty** for a take that is one file, for `UPLOAD_RECORDING.parts`. The optional `primaryBlob` is bytes the caller already holds, so the take's largest file is not read twice. A plain take costs no storage read at all. The role order comes from `companionParts.companionRank`, not from a second list |
| `utils/companionParts.ts` | `COMPANION_PARTS` and `companionPartFor` — the one place the three companion roles differ in words. Each role's descriptor carries `label` (mid-sentence: "the **system audio** companion could not be finalized"), `trackLabel` (sentence-initial: "**System audio** track could not be saved") and `isAudio`, which is what the save path and `buildSourceVideo` branch on. `companionPartFor` answers `null` for `undefined` and for `'screen'` — a row that *is* the take. A fourth role would be one entry here rather than a grep. It also owns `COMPANION_ROLE_ORDER` and `companionRank` — the one role order, read by `takeOrder` (the library's rows) and `takeParts` (the upload's parts) |
| `utils/recordingMetadata.ts` | The two records a finished take writes — the shared `SourceVideo` stored beside the blob and the recorder's own `Recording` list entry — built from values the caller already computed. Both carry `hasAudio`, the one answer its caller computed, so the stored copy and the in-memory one cannot disagree — neither builder derives it, but the expression that does now lives in this file as `resolveHasAudio(captured, systemAudioEnabled, systemAudioShared)`, which `useRecordingSave` calls once per take and the agreement tests call instead of copying the rule. Since ESCSUITE-14 `hasWebcam` is the second such required answer, and the take fields (`takeId`, `role`, `startOffset`, `overlayPlacement`) are **spread in only when present**, so a single-file take's record has no companion keys at all. The `role` is also what names each part and what makes an audio part audio: `companionPartFor` turns it into `<take name> — webcam` / `— microphone` / `— system audio`, and an audio role is what writes `mediaType: 'audio'` with `frameRate: 0` instead of `'video'` at 30. No store, and no blob-URL creation |
| `components/icons.tsx` | The inline SVG icon set, every path drawn in `currentColor`. The source icons take a `className` because their size is per call site; the action icons are `aria-hidden` and sized entirely by their button |
| `components/AppHeader/AppHeader.tsx` | The app bar: the suite link (hidden in the standalone build), the wordmark, the `aria-live` status region — carrying both the recorder state and the app's one `notice` — and the two header buttons. It resolves `isStandaloneMode()` and `editorUrl()` itself, because both are deployment facts rather than App state |
| `components/SourceToggles/SourceToggles.tsx` | The Sources panel: one row per capture source — written out four times rather than mapped, since each has its own icon, capability slice and config flag — plus the audio meters shown while an audio source is recording. Also exports the `RecordingSource` union |
| `components/SourceToggles/SourceTogglesPanel.tsx` | The Sources panel's subscription: the five store fields `SourceToggles` draws, selected here rather than in `App` so the ~12-a-second `audioLevels` push redraws this panel and nothing else. Takes `disabled`, `showMeters` and `onToggleSource` as props — `disabled` is `App`'s `sidebarLocked`, true from the moment a take starts preparing until the write to storage is done (ESCSUITE-104), not just while it is actively recording; `showMeters` is the narrower `isRecordingActive`, kept apart because the meters draw live levels the store never resets between takes and must not sit on screen, frozen, through the whole time a finished take is saving. `SourceToggles` itself stays driven by props alone, which is what its own test asserts |
| `components/WebcamOverlaySettings/WebcamOverlaySettings.tsx` | The PiP overlay's position, size and shape, plus the "Record webcam as a separate track" toggle and the one paragraph under it that carries either `SEPARATE_TRACKS_HELP` or the reason the toggle is disabled — never both, so it is one `<p>` and one `aria-describedby` target. Every control reports a config patch; `separateTracksReason` arrives as a prop, so this stays props-only. It draws unconditionally; whether the panel exists at all is the caller's decision. `disabled` (from `WebcamOverlaySettingsPanel`, ultimately `App`'s `sidebarLocked`) covers a take that is preparing or being saved as well as one still recording (ESCSUITE-104) — the stored placement is `captured` once `acquireStreams()` resolves and must not look movable before that snapshot or while the write it feeds is still happening. The four position buttons and the two shape buttons each carry `aria-pressed` (ESCSUITE-176), the same shape the separate-tracks toggle already had — before this, which one was current was a CSS class only, so a screen-reader user had no way to tell where the webcam sat or what shape it was. Each set is also its own `role="group"` with `aria-label` ("Webcam position" / "Webcam shape"), so a screen reader says what the four or two buttons are choosing between rather than just "top left, not pressed" with nothing to anchor it to |
| `components/WebcamOverlaySettings/WebcamOverlaySettingsPanel.tsx` | The overlay panel's one subscription: `hasSeparateTracksSpace`, turned into `separateTracksReason` with `canRecordSeparateTracks()`. Selected here rather than in `App` for the same reason `SourceTogglesPanel` owns `audioLevels` — a field `App` merely passes through still re-renders `App` and every hook it calls |
| `components/RecordingsList/RecordingsList.tsx` | The library panel: each saved take's thumbnail, name, formatted duration and size, and its six action buttons (four on any companion row — webcam, microphone or system audio — none of which carries MP4 or M4A; see "A take can be several files"), each labelled with the recording's own name — plus the conversion's progress row (named after the format actually running) and the one visible note the MP4 and M4A buttons are described by (`mp4Note`, which is not the same thing as `mp4BlockedReason` — see "Download Formats"). The one gate it decides for itself is `recording.hasAudio`, which disables M4A: a fact about the row rather than about the app. It also resolves each row's `companionPartFor(recording.role)`, which is what hides MP4 and M4A on a companion row and hands `onSendToEditor` the take's primary id when that row is actually present in the list, else the row's own id (ESCSUITE-145). Props only; it touches no storage and holds no state |
| `components/RecordingsList/RecordingsListPanel.tsx` | The library's own subscription and state: `useMp4Download` lives here rather than in `App`, so a progress report redraws the list and nothing else. It is also where the *format* is chosen — `onDownloadMp4` and `onDownloadM4a` are the same `startMp4Download` with a different last argument. Selects only `setNotice`, which is a stable action. The other four handlers still come down from `App`, because `useRecordingLibrary` owns the playback dialog the shortcuts need |
| `components/RecordingPreview/RecordingPreview.tsx` | The preview stage: the compositor's canvas, a mirrored stream, or the idle placeholder — checked in that order so PiP wins during a composite take — with the countdown laid over the top. It only places the App's two DOM refs |
| `components/RecordingPreview/CountdownOverlay.tsx` | The 3-2-1 overlay and its own subscription to `countdownValue`, so a countdown tick re-renders one digit rather than the preview stage and everything above it. `state` stays a prop — `App` derives it for the transport bar too, and it changes once per transition rather than on a tick |
| `components/RecorderControls/RecorderControls.tsx` | The transport bar and the shortcut legend: which controls exist in each state, the record button's three-way `onClick` ladder (start when idle, stop while active, nothing at all in `preparing` and `saving`), and the `blockedReason` that sits in front of that ladder. The timer `<span>` and its classes are its own; the number inside it is not |
| `components/RecorderControls/RecordingDurationReadout.tsx` | The elapsed number alone — no props, no markup of its own — subscribing to `currentDuration` so the once-a-second tick re-renders five characters instead of the bar, the screen and the seven hooks `App` calls |
| `components/PlaybackDialog/PlaybackDialog.tsx` | The modal that plays one saved recording back — the frame around `VideoPlayer`, the backdrop-dismiss behaviour, and the saved `duration` the player is told rather than asked for. Calls the shared `useDialogBehaviour` for the keyboard half |
| `components/HelpDialog/HelpDialog.tsx` | The Recording Tips modal: static copy in four sections, the same backdrop-dismiss behaviour, named through `aria-labelledby`, and the `tabIndex={0}` that makes its scrolling body keyboard-reachable. Calls the shared `useDialogBehaviour` too |
| `hooks/useThemeLifecycle.ts` | One effect: `initTheme` on mount, `cleanupTheme` on unmount. Called first because it was the first effect in the file |
| `hooks/useCapabilityBootstrap.ts` | The way in: capability detection, the MP4 codec probe (`probeMP4Support()` → `store.mp4Support`) and the initial `loadRecordings()`, all in one effect as they were inline — splitting them would change the order the store is written on mount. Raises `capabilitiesReady` (on success *and* on failure) and reports either failure as a notice |
| `hooks/useMediaStreams.ts` | Everything capture is held in and released through: the preview stream, the PiP compositor, the microphone stream the store does not hold, the two preview DOM handles, `acquireStreams`, `stopAllStreams` and the ref that mirrors it. Registers the preview attach and then the mirror |
| `hooks/useRecordingSave.ts` | Turning a finished take into a stored recording: the WebM container repair, metadata extraction, the thumbnail fallback chain, both storage writes, and the new entry at the top of the list. Only `storeVideo` — the blob and its metadata — is load-bearing: a thumbnail is cosmetic, so `storeThumbnail` failing (a quota error, most likely, since the thumbnail is written after the multi-MB blob) or `generateThumbnail` itself throwing is caught, warned once (`'Recording thumbnail could not be saved:'`), and the take is still added to the list with no `thumbnailUrl` and the companions still written (ESCSUITE-107) — before this fix the whole save rejected over a take that was in fact already stored: invisible until reload, already readable by ARTIST, and its companions never reached. A separate-tracks take's other blobs are written here too, one loop, each part in its own try/catch — the webcam with its own decoded thumbnail and `hasAudio: false`, the microphone and the system audio with `mediaType: 'audio'`, `frameRate: 0` (both derived from the role by `buildSourceVideo` — and since ESCSUITE-143 from `captured.hasVideoSource` for a *primary* with no picture, which skips the probe and the thumbnail chain entirely; see "the same boolean" under "Choosing a recorder"), 0x0, the recorder's own duration and **no thumbnail and no decode at all** (`extractVideoMetadata` reports `videoWidth || 1920`, so probing an audio file would store it as 1920x1080). They are added in **reverse role order**, because `addRecording` prepends. Losing one costs that one and nothing else; one `SEPARATE_TRACK_NOT_SAVED` covers however many were lost, and the console carries which (`<Track> track could not be saved:`). That is the **storage** half of the loss only: a part lost inside the recorder arrives as a list that is simply *shorter*, which this hook cannot tell from a take that asked for fewer, so the controller raises the same notice for it (see "Recorder lifecycle"). Reads the recorder type and the captured thumbnail through refs, because `onStop` fires from callbacks captured a render earlier. Owns the one `hasAudio` expression the *primary's* two records are given — `captured.micAcquired || (systemAudioEnabled && systemAudioShared)`, the flag read through `getState()` so the hook adds no render. Each audio part carries `true` and the camera's part `false`, so the take's parts do not all answer alike. Neither half is the config alone, and the expression itself is `resolveHasAudio` in `utils/recordingMetadata.ts` so that nothing derives the rule twice: `micAcquired` arrives as the save's fourth argument (`CapturedTake`), resolved once by the controller from the stream it really acquired, so a microphone toggle with no device behind it is no longer stored as audio (ESCSUITE-70). That same argument carries `separateTracks` — the mode the take was *resolved* on, not the setting as it stands now (ESCSUITE-68) — and it, not the companion list, is what makes the take a companion take: every way the recorder can lose *all* of a take's parts delivers the same empty list an ordinary take delivers, and such a take's primary must still be named by its own `takeId`, with its role and the overlay geometry the camera was framed at. A companion list is still enough on its own, so a caller that hands parts over without saying so is not quietly demoted. The argument is optional and defaults to `NOTHING_CAPTURED` — a caller that says nothing claims no microphone, because a default of `true` would be that bug again, and claims one file. The two halves are resolved at different moments, which the comment above the expression states outright: the microphone half travels in `onStop`'s closure and always describes *this* take, while `systemAudioShared` is read from the store at save time and is only reset by the *next* take's start. Since ESCSUITE-104, `CapturedTake` also carries `systemAudioEnabled`, `webcamEnabled` and `overlayPlacement` — the System Audio toggle, the webcam toggle and the overlay geometry, all resolved by the controller at start and read nowhere else: `RecordingSaveDeps` has no `config` field any more, so `hasWebcam` and the overlay written on a companion take's primary come from `captured` rather than from whatever the Sources or Webcam Overlay panel shows by the time this hook's several awaits (the container repair, the metadata probe, the thumbnail decode, the two IndexedDB writes) resolve |
| `hooks/useRecordingController.ts` | The take itself: countdown, start, pause, resume, stop, cancel, the two interval tickers, and the ordered unmount teardown. Creates the recorder, cancelled-flag, attempt-token and interval refs, and holds the recorder's six callbacks — captured once, at `createRecorder` time, so a late `onStop` releases the capture *that* take was using. It resolves which mode the take is before the countdown, resolves `micAcquired` (the toggle AND a track on the stream `acquireStreams` returned) with it, and counts how many companions the take asked for (`expectedCompanions` — the camera, plus one per audio source it really has), which makes it the only layer that can read a *short list* as a loss. `micAcquired` is also handed to `saveRecording` as its fourth argument, in the `onStop` closure rather than through a ref, so the count of the take's audio parts and the `hasAudio` stored for it are one answer (ESCSUITE-70): `onStop` raises `SEPARATE_TRACK_NOT_SAVED` when fewer parts arrive than were asked for, and nothing for a composited take. The resolved `separateTracks` travels in the same closure and the same argument (ESCSUITE-68), so the save path never has to re-read a setting the user can still move while the take is disabled — and, since ESCSUITE-104, three more fields travel the same way for the same reason: `systemAudioEnabled`, `webcamEnabled` and `overlayPlacement` (`{ position, size, shape }`, copied from `config.webcamPosition/Size/Shape` at the same moment the compositor is built), each a local const resolved once here and handed to `saveRecording` in the `onStop` closure rather than left for the save path to read off live `config`. The panels are disabled from the moment the take starts preparing until the write to storage is done (`App`'s `sidebarLocked`), but the fields are still captured here rather than trusted to that: a save reads only what it is handed. The save's own *completion* carries the recorder it saved too (ESCSUITE-174): `saveRecording(...).catch(...).then(...)` guards its single `setState('idle')` on `recorderRef.current !== me`, so a save that settles after the app has moved to another take cannot write idle over it |
| `hooks/useKeyboardShortcuts.ts` | The window-level R / P / S / Escape shortcuts, each gated on `state` — and R additionally on `canRecord`, so the keyboard cannot do what the button refuses — with the whole set gated on `modalOpen`. Escape's own gate is an allow-list like the rest of the switch — `state === 'preparing' || state === 'recording' || state === 'paused'` (ESCSUITE-174), so a state added later is inert there by default; it was written to leave `'saving'` out, because a take being written to storage has nothing left to cancel — see "Keyboard Shortcuts". Its dependency array is copied verbatim rather than trimmed, so the listener re-binds whenever any handler changes identity — including on every `config` change |
| `hooks/useMp4Download.ts` | One conversion at a time — MP4 or M4A, one shared slot: the `AbortController` (aborted on cancel *and* on unmount), the `{ id, format, message, progress }` the row draws, the post-`await` `signal.aborted` re-check that stops a late cancel still downloading, the button reasons for each format (still checking, cannot, busy — plus, for M4A only, a browser with no AAC encoder), the separate visible `note` (the silent-MP4 warning, or the blocking reason when there is one worth saying), and the failure that becomes a notice. Gated on `store.mp4Support`, handed in by `RecordingsListPanel`. Called by `RecordingsListPanel`, never by `App`. On an MP4 it first resolves the take's camera half out of storage (`utils/takeParts.ts`) and hands it to the converter with the take's stored `overlayPlacement`, so "Download as MP4" on a separate-tracks take gives you the take; `getVideo(id)` fetches the blob and that metadata in one read, and a record listed with no bytes behind it (`!record?.blob`) is still the silent no-op it always was. An M4A asks for none of it — the primary's audio track is already the mix. A camera part that was listed and could not be used raises `MP4_SAVED_WITHOUT_WEBCAM`, which outranks the silent-MP4 warning in the one channel |
| `hooks/useRecordingLibrary.ts` | The recordings already in storage: play, download, send to editor, delete — which cascades, taking a take's companions with its primary, and re-reads the storage headroom afterwards — and the playback dialog's URL, name and duration. The cascade deletes companions first and the primary last, each in its own try/catch (ESCSUITE-103): a `deleteVideo` that throws costs one file rather than the rest of the cascade — and doing the primary first could leave a primary-less companion behind, a webcam file with no take, taking room the user thought they had freed. Any failure raises `DELETE_FAILED` through the one notice channel once, however many files it touched, rather than an unhandled rejection at the call site. The five handlers stay plain functions recreated on every render, as they were inline — memoising them would change how often the sidebar and the dialog re-render. Binds no effect |

### Errors and notices

**One store field, one live region, cleared by the next take.** `notice: string | null`
in `recorderStore` is the whole notification surface: `AppHeader` renders it inside the
header's existing `aria-live="polite" aria-atomic="true"` region, and
`handleStartRecording` clears it when the next take begins. Every string lives in
`src/utils/notices.ts` — `SAVE_FAILED`, `NOT_SEEKABLE`, `CAPTURE_REFUSED`,
`CAPTURE_UNANSWERED`, `START_FAILED`, `LIBRARY_UNREADABLE`, `DETECTION_FAILED`,
`NO_SYSTEM_AUDIO`, `MIC_UNAVAILABLE`, `MP4_SAVED_WITHOUT_AUDIO`, `UPLOAD_UNAVAILABLE`,
`UPLOAD_NO_HOST_ORIGIN`,
`SEPARATE_TRACK_NOT_SAVED`, `MP4_SAVED_WITHOUT_WEBCAM`, `DELETE_FAILED`,
`RECORDING_UNAVAILABLE` and
`mp4ConversionFailed()` —
so the vocabulary is readable in one place. `mp4ConversionFailed` is the one that takes an
argument, because the browser's own words for why an encode failed are the useful half; it
is still one string through the same `setNotice`, and it says "Conversion failed: …" rather
than naming a format, because both conversions — MP4 and M4A — raise it through one code path. **Do not add a second channel**: no toasts, no per-component error
state, no notification framework. A new thing to say is a new string in that file and one
call to `setNotice`.

The notice span deliberately carries **no `role` of its own**. The region's `aria-live` is
what announces it; a second `role="status"` would break the "at most one `role='status'`"
promise `AppHeader` makes, and would have an `aria-atomic` region read two independent
things as one phrase. A notice and a running take are on screen together in the ordinary
case — "System audio was not shared" during a recording is exactly that.

The price of sharing one region is that a notice raised *while* the state is changing can
be announced twice: `NOT_SEEKABLE` is set during `'saving'`, so the region reads
"Saving… + notice", and reads the notice alone again when the state clears to `'idle'`.
That is accepted — a second live region to avoid it would cost more than the repetition
does. (`SAVE_FAILED` is unaffected: the notice and the state land in one batch.)

Two related rules follow from it:

- **Failures travel up, not into a `console.error`.** `useRecordingSave` rejects rather
  than swallowing, so the controller can tell an unsaved take from a saved one — but only
  when the take itself failed to store: `storeVideo` rejecting is what the controller's
  `SAVE_FAILED` answers. A thumbnail write failing (or `generateThumbnail` throwing) is
  cosmetic and is caught inside the hook rather than rejecting the save, the same posture
  a lost companion already had (ESCSUITE-107) — the alternative was a take that *was*
  stored being reported as "not in your library", invisible until reload, and, for a
  separate-tracks take, its companions never written at all;
  `loadRecordings()` is caught in the bootstrap; a start that throws raises
  `CAPTURE_REFUSED` (the browser said no — a cancelled picker, a denied permission, an
  expired user activation) or `START_FAILED`. `startFailureNotice`
  (`hooks/useRecordingController.ts`) tells the two apart by name, but the name is not
  always on the error itself: `core/permissions.ts`'s `requestScreenCapture`/
  `requestWebcam`/`requestMicrophone` each catch the browser's `DOMException` and rethrow
  `new Error('…', { cause })`, so the wrapper's own `.name` is just `'Error'` and the
  browser's real name — `NotAllowedError` for a refusal — is carried as `cause`.
  `startFailureNotice` reads it through one helper, `failureName(error)`, which answers
  `(error.cause ?? error).name` — the cause when the error was wrapped, the error's own
  name otherwise (a bare `DOMException`, as the capture-deadline release path can still
  produce, is unaffected). Reading `.name` straight off the error instead (as it did
  before ESCSUITE-210) made `CAPTURE_REFUSED` dead code: every wrapped refusal fell
  through to the generic sentence. A `NotFoundError` (no screen/camera/microphone to
  capture) is left under `START_FAILED` too — a dedicated sentence for it is a product
  call nobody has made — and a start whose capture request is never
  answered at all raises `CAPTURE_UNANSWERED` when its deadline expires (ESCSUITE-109) —
  a silence has to be reported too, because the alternative is a UI parked in
  `'preparing'` for good; `fixWebMMetadata()` failing still keeps the
  raw blob, but it now warns *and* raises `NOT_SEEKABLE` — an unrepaired MediaRecorder
  WebM plays and refuses to scrub, and saving it with no trace is how ESCSUITE-2 comes
  back.
- **`systemAudioShared`** is the one other honesty flag: enabling "System Audio" only
  *asks* for it (the browser's share dialog carries the tick box), so the controller
  checks `hasSystemAudio(screen)` after acquisition, raises `NO_SYSTEM_AUDIO` when a
  display capture came back without an audio track, and `SourceToggles` greys the System
  meter for the take. The notice is withheld when there was no display capture at all
  (system audio on, screen off) — there was no dialog to miss a tick box in — so the
  greyed meter carries its own, weaker wording (`NO_SYSTEM_AUDIO_HINT`, "No system audio
  arrived for this take") rather than the notice's. `handleStartRecording` resetting it to
  `true` is its whole lifecycle — which is also what makes it readable at save time: it
  still describes the take just finished until the *next* one starts. `useRecordingSave`
  reads it there (ESCSUITE-62) so a take whose tick box was cleared is stored as having no
  audio, rather than as a silent recording with an M4A button.
- **`MIC_UNAVAILABLE`** is the third: the microphone the take asked for could not be opened and the
  take went ahead anyway (ESCSUITE-184 — see "A microphone that cannot be opened does not cost
  the take" under "Recorder lifecycle"). One sentence for every way the request failed, because there is one
  channel and the fact the user can act on is the same — the recording now being made has no
  microphone in it; the console carries which error it was. It is raised **after**
  `NO_SYSTEM_AUDIO` in `handleStartRecording`, so it wins the single channel when both are true:
  the system-audio line is a nudge about a tick box the user can tick next time and the greyed
  System meter carries its own weaker wording for the rest of the take, while this names a source
  that is simply gone.

**`RECORDING_UNAVAILABLE`** covers three more paths through the same channel, on any row —
companion or primary. `useRecordingLibrary`'s `handlePlayRecording` and `handleDownload` each
raise it, and re-run `refreshStorageSpace()`, when `getVideoBlob` answers `undefined` for a row
the library still shows: the row is drawn from metadata the store still holds, but its bytes are
gone — typically a recording deleted from ARTIST's media library in another tab, which removes
the shared IndexedDB row without telling this one (ESCSUITE-146). Before this, both handlers did
nothing at all: no dialog, no file, no explanation, while the row kept showing its name, duration,
size and thumbnail. Nothing is disabled either way — the ruling is that a row whose blob is
missing is still deletable — only Play and Download now say so instead of the silent no-op.
`useMp4Download`'s `startMp4Download` raises the same notice for the same fact (ESCSUITE-176): a
row whose `getVideo()` read comes back with no `blob` returns from the conversion instead of
handing the converter nothing, which used to flash "Starting conversion… 0%" and silently return
to idle with no file and nothing said — one MP4/M4A guard covers both formats, same as everything
else in that hook.

### The record button only offers what it can deliver

`RecorderControls` takes a `blockedReason: string | null`. Non-null and the record button
loses its handler, goes `disabled`, puts the reason in its `title`, and prints it under the
bar as the button's `aria-describedby` target — the same "say why" shape the Sources rows
already use. `App` computes it once with `recordBlockedReason()`
(`src/utils/recordReadiness.ts`) and hands the same answer to `useKeyboardShortcuts` as
`canRecord`, so **R and the button always agree**.

It blocks for three reasons:

1. **Capability detection has not landed.** The store's `capabilities` start all-false
   while `detectCapabilities()` resolves, so an early click used to reach
   `acquireStreams()`, take no branch, hand the recorder nothing and die in a
   `console.error`. `capabilitiesReady` is false until detection answers — and is raised
   on a detection *failure* too, so the button never sits on "Checking…" forever. (With
   the capabilities left all-false it stays disabled, but for reason 2, with a sentence
   that says what is actually wrong.)
2. **Nothing enabled is actually capturable** — every toggle off, or every enabled toggle
   pointing at a capability this browser lacks. The three sources counted are exactly the
   three `acquireStreams()` asks for, each gated on "the toggle AND the capability".
   **System audio is deliberately not one of them**: it is not requested separately, it
   rides on the screen capture, so a "system audio only" take captures nothing at all.
3. **There is nowhere to put the take** — `hasStorageSpace` in the store.

**Nothing may be awaited between the click and `getDisplayMedia`.** That is why reason 3
is a store flag rather than a check inside `handleStartRecording`: the capture request
needs the click's user activation, an `await` in front of it can spend that activation
(WebKit forwards a gesture across promises only briefly), and the `NotAllowedError` that
follows would be a failure the user never caused. `refreshStorageSpace()` — a store action
that never rejects — measures it **off** the click path: on mount
(`useCapabilityBootstrap`), after every save (`.finally` on the save chain, since a take
that failed took no room either), and after every delete (`useRecordingLibrary`, because
deleting is the remedy the blocked button recommends). The comment in
`handleStartRecording` marking the no-await stretch is load-bearing; keep it.

`hasSpaceForRecording()` itself (`core/storage.ts`) **errs toward letting you record**, in
both directions it can be wrong:

- a quota of `0` is *unknown*, not *full* — reading it as full refused every take in any
  browser without `navigator.storage`, jsdom included, which is why the helper was dead
  code for so long;
- the bar is the **lower** of `estimate + 50MB buffer` and a quarter of the reported quota,
  so a private or ephemeral profile with an 80MB quota is not told to "delete a recording"
  in a window that has nothing stored.

A missed warning ends with IndexedDB reporting its own quota error at save time, which the
save path already surfaces; a false "no space" refuses the take outright with advice the
user cannot act on. Only the first of those is recoverable.

**During the 3-2-1 countdown the button cancels, not stops** (ESCSUITE-106). `recorder.stop()`
is a no-op before `start()` — both recorders check `isRecordingActive` first — so a button that
kept reading "Stop recording" and calling `onStop` for `countdown` did nothing when clicked:
the ticker kept running and the take began anyway. `RecorderControls`' record button now checks
`state` before `isRecordingActive`: `idle` starts, `countdown` calls the same `onCancel` App
already passes it (`cancelCountdown`, via the ternary in `App.tsx`'s JSX), and only `recording` /
`paused` call `onStop`. The button's accessible name and title become "Cancel countdown" for
that one state, so it, Escape and the bar's own neighbouring Cancel button all agree on what
happens to a countdown. No new prop was needed — `onCancel` already carried the right function
for `countdown`, `RecorderControls` just wasn't using it for the big button.

### Dialogs

Both modals — Recording Tips and playback — get their keyboard behaviour from one hook,
`useDialogBehaviour`, which lives in **`packages/shared/src/hooks`** and is imported as
`@escapesuite/shared/hooks`. ESCAPEARTIST's export dialog uses the same hook; it is the one
implementation for all three dialogs in the suite, and the place to change any of this.

It takes the `onClose` the dialog already has and returns the ref to put on the dialog
element; on mount it remembers what was focused, moves focus to the first focusable control
inside (or, if there is none, to the dialog itself, which is why both carry `tabIndex={-1}`),
and on unmount it puts focus back where it found it. Both CRAFT dialogs render only while
they are open, so they pass `onClose` and nothing else — the hook's second argument,
`isOpen`, defaults to `true` and exists for ARTIST's export dialog, which stays mounted and
returns `null` when closed. While it is open it holds one `keydown` listener on `document`
**in the capture phase**:

- **Escape** closes the dialog and is stopped there.
- **Tab / Shift+Tab** wrap at the ends of the dialog, and pull focus back in if it has strayed
  outside.
- **everything else passes straight through**, which is how the playback dialog's `VideoPlayer`
  keeps Space, M and the arrows — it binds its own `window` listener, and `window`'s bubble
  phase is below `document`'s capture phase.

The hook began as ESCAPEARTIST's `ExportDialog` focus trap, lifted rather than re-invented —
same focusable-element selector, same capture listener, same restore — then lived in CRAFT for
as long as CRAFT was the only app with two dialogs. It moved into `packages/shared` when
ARTIST adopted it, which is also what fixed the one way the two copies had diverged: CRAFT's
Shift+Tab arm treats focus parked on the dialog **container** as "at the start" and wraps to
the last control, where ARTIST's copy let it walk backwards out of an `aria-modal` dialog.
Its own tests moved with it (`packages/shared/src/hooks/useDialogBehaviour.test.tsx`).

Stopping Escape is not enough on its own, because R, P and S never reach the dialog at all.
`useKeyboardShortcuts` therefore takes **`modalOpen`** and ignores every key while it is true —
`App` computes it as `showHelpModal || playbackUrl !== null`. Before that gate, pressing R inside
the Help dialog put a screen-capture prompt up from behind it.

**No dialog in either app can reach a two-open state today**: each backdrop is
`position: fixed; inset: 0` at `z-index: 1000`, so a click aimed at the Help button while
playback is open lands on the playback backdrop and closes it instead, and the focus trap keeps
that button out of Tab's reach. But the hook no longer *assumes* one dialog at a time either
(ESCSUITE-208): two mounted at once each bind their own capture listener on `document`, and
`stopPropagation()` does nothing for a second listener on the same node — so one Escape used to
close both and fire two focus restores. A module-level stack of open dialogs now means only the
topmost instance's `onClose` actually runs; every instance still claims the key first (so the
app's own shortcuts behind it still see nothing), it is only *acting* on it that is now
exclusive to the top of the stack. `stopImmediatePropagation()` would have picked the *wrong*
one: capture listeners on one node fire in the order they were added, so the earliest-opened
(bottommost) dialog's listener runs first, and unconditionally stopping there would close the
dialog underneath instead of the one on top.

The focus trap itself also used to miss two things a real browser exposes that jsdom's test
doubles were hiding (ESCSUITE-208, hunt-i I-U2/I-U3): `getFocusable()` filtered on
`el.offsetParent !== null`, which a real browser also sets `null` for any `position: fixed`
control — dropping it from the trap entirely rather than treating it as merely hidden — so it
now reads `el.getClientRects().length > 0` instead, which means "is this actually rendered"
without caring what positioning scheme put it there. And the focusable-element selector only
named the control types the seven dialogs across both apps happen to use; it now also matches
`[contenteditable]`, `audio[controls]`, `video[controls]`, `iframe` and `summary`, so a rich-text
field or a native media player inside a future dialog can no longer walk Tab straight out of an
`aria-modal` dialog. Neither gap is reachable through either app's dialogs as shipped today —
none contains such a control — so both are hardening, pinned in
`packages/shared/src/hooks/useDialogBehaviour.test.tsx` and in
`apps/e2e/tests/accessibility/dialog-trap.spec.ts` (against this app's own Recording Tips
dialog, since CRAFT's modals are the simplest ones to inject a probe element into).

**What axe covers.** `apps/e2e/tests/accessibility/core.spec.ts` audits CRAFT in four states,
not one: idle, Help open, the playback dialog open over a real saved take, and a take in
progress. The last two need `mockSyntheticMedia` (the inert `mockGetUserMedia` stub has no
tracks, so a take never reaches `recording`). Adding the last two found a WCAG AA contrast
failure as well: `--error` as *text* on `--bg-secondary` is 4.22:1, which is what the live
"Recording" label, the running timer and the notice line were drawn in. They use
**`--error-text`** now; non-text uses of `--error` — the pulsing dot, the record button — keep
the brand red, since the rule does not apply to them.

`--error-text` has a value in **both** palettes — `#f87171` (5.7:1 on `#16213e`) for the dark
`:root` and `#b91c1c` (6.0:1 on `#f5f7fa`) for `:root[data-theme="light"]` — because a token
defined on `:root` alone is inherited by the light theme, where a red tuned for navy lands at
2.6:1. Two things stop that recurring: the take-in-progress axe run is executed **in both
themes** (`?theme=dark` / `?theme=light`, the shared theme module's own URL override), and
`src/themeTokens.test.ts` reads `index.css` and fails if any colour token in `:root` has no
counterpart in the light block. Add a colour to one palette and you are made to add it to the
other.

A second contrast failure (ESCSUITE-177) surfaced the same way, in Firefox only: the light
theme's `--text-muted` — an unavailable source row's label and the "no system audio" meter
label — was 3.74:1 on `--bg-secondary`, under AA. Chromium's run of the same test never
happened to mark the row that colour applies to as unavailable, so only a cross-browser sweep
caught it; the fix (`#606d80`, 4.90:1) and a numeric pin in `src/themeTokens.test.ts` are the
same shape as `--error-text`'s. The lesson generalises: a palette token can fail AA in one
theme only, and a single-theme or single-browser axe run can miss it either way.

`apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` proves the round trip in a real
browser: open Help from the keyboard, Tab six times without leaving it, Escape, focus back on
the Help button.

### State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`, `DetailedCapabilities`, `CapabilityInfo`, `Mp4Support`
- Recordings stored in shared IndexedDB with ESCAPEARTIST

### Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring (see
  "Audio level meters" for the 80 ms gate both recorders apply)
- `webcodecs-recorder.ts`: VideoEncoder/AudioEncoder + Mediabunny recorder for every take that
  is neither composited PiP nor audio-only
  (see "Frame timestamps and keyframes" for the recording clock every frame is stamped with) —
  and, for a separate-tracks take, a list of companion pipelines beside the primary
  (`CompanionPipeline`): a `VideoEncoder` and its own Mediabunny output for the webcam, with its
  own `FrameTiming`, and an `AudioEncoder` and its own Opus-only output for each audio source the
  take really has — all of them on that same clock, and none of them taking the mixed audio off
  the primary
- `webcodecsSupport.ts`: `isWebCodecsRecordingSupported()` and `canRecordSeparateTracks()` — the
  two synchronous capability questions, in a module that imports nothing, so a *component* can
  ask one without pulling `mediabunny` into its graph (`WebcamOverlaySettingsPanel` does).
  `webcodecs-recorder.ts` re-exports the first, which is where it used to live
- `recorder-factory.ts`: `createRecorder()` / `canUseWebCodecsRecorder()` /
  `getRecorderType()` — picks between the two recorders for a take. WebCodecs unless the
  take is **composited** PiP (the compositor's hidden video elements break its frame capture)
  or has no video track at all (an audio-only take, which `WebCodecsRecorder` cannot serve);
  MediaRecorder otherwise. `separateTracks` is the third input and the one case where a PiP
  take *does* reach WebCodecs — nothing captures frames through the compositor there, so the
  reason for the exclusion does not apply. `getRecorderType()` returns that same decision as
  `'webcodecs' | 'mediarecorder'`, which is what the controller puts in `recorderTypeRef`
  and what the save path branches on to decide whether the blob needs repairing
- `permissions.ts`: Environment capability detection with detailed unavailability reasons
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen, throttled to
  the take's target frame rate by the deadline gate described under "The PiP frame gate".
  `start()` returns the recorded `captureStream`; `startPreviewOnly()` is the same draw loop
  with no capture, for a separate-tracks take where the canvas is only what the user watches.
  The overlay it draws is `core/overlayGeometry.ts`'s `drawOverlay()`, not its own method.
  `stop()` (and so `dispose()`) also stops that `captureStream()`'s own tracks (ESCSUITE-137):
  no caller ever did — `useRecordingController` folds the output stream's video track into
  `recordingScreen` and `useMediaStreams.stopAllStreams()` only stopped the raw screen/webcam/
  mic streams before disposing the compositor — so a composited PiP take's canvas capture
  track, and the (up to 1280-wide) canvas it kept reachable, used to outlive the take entirely
- `overlayGeometry.ts`: `drawOverlay()` — where the webcam sits in a frame and how it is
  drawn there (the 16:9 derivation, the four corners, the circular centre-crop, both clip
  paths, the border) — plus `overlayGeometryFor()` / `overlayPaddingFor()` and **five** constants:
  `COMPOSITOR_MAX_WIDTH`, `DEFAULT_OVERLAY_PADDING`, and the camera's own
  `OVERLAY_BORDER_COLOR` / `OVERLAY_BORDER_WIDTH` / `OVERLAY_CORNER_RADIUS` — the last three
  named (ESCSUITE-65) because ESCAPEARTIST now reproduces that border on a handed-over webcam
  clip and names the same numbers on its side (`OVERLAY_STROKE_COLOR`,
  `OVERLAY_STROKE_WIDTH_FRACTION`, `OVERLAY_CORNER_RADIUS_FRACTION` in
  `apps/artist/src/utils/overlayPlacement.ts`), so a change to the border here cannot silently
  stop matching what the editor draws. Naming them changed no pixel: the compositor's preview, a
  composited PiP recording and a re-composited MP4 all paint what they painted before. Pure: no
  element lookup, no canvas creation, no state, no `this`. It exists because **two** things draw
  this overlay — `Compositor` live, and `convertToMP4` offline from a second *file* — and a
  rounding difference between two copies would only ever be visible in a downloaded MP4.
  `CompositorConfig` is an
  alias of its `OverlayGeometry`, so the live loop passes `this.config` straight through and
  allocates nothing per frame. Nothing mocks it, which is what keeps `compositor.test.ts`
  exercising the real geometry
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction. Its size, type
  and quality constants are **imported from `utils/previewThumbnail.ts`**, not declared here:
  five suites (`App.settings`, `App.saving`, `App.recording`, `App.library`,
  `hooks/useRecordingSave`) `vi.mock('./core/thumbnailGenerator')` wholesale, so a constant
  declared in this module would vanish under the mock. `utils/previewThumbnail.ts` is never
  mocked, which is what makes it the single definition — keep it that way.
  **Both `cleanup()` helpers null `onloadeddata` and `onerror` before they release the
  element, and must keep doing so.** Emptying a media element's `src` is a *load failure*,
  not a release: the resource selection algorithm jumps to "failed with attribute" and fires
  an `error` at the element. A handler still attached there re-enters the very cleanup that
  emptied `src`, which empties it again — and the detached element then spins
  error → cleanup → error for the life of the page. That was ESCSUITE-55: measured at
  ~44,500 iterations a second, started by the first saved take of a session, and it left the
  tab ~87% busy doing nothing for the rest of the session. The release itself is
  `removeAttribute('src')` + `load()` rather than `src = ''` for the same reason — with no
  `src` attribute and no `srcObject` the algorithm ends at `NETWORK_EMPTY` with **no `error`
  and no `MediaError`**. (It is not silent: `load()` queues `abort` and `emptied` on the way
  there. Nothing listens for either, and neither can re-enter a cleanup; the property that
  matters is that no `error` is manufactured.)

  **Removed (ESCSUITE-138):** `generateStreamThumbnail(stream: MediaStream)`, a live-preview
  thumbnail path that was present, tested and called by nothing — the save path's thumbnail is
  `utils/previewThumbnail.ts`'s `drawThumbnail`, reached through
  `useRecordingController.captureThumbnail`. It also differed from its two siblings in ways
  that would have mattered had it ever been wired: it settled only from a `srcObject`'s
  `onloadeddata`/`onerror`, so a stream that never produced a frame left the promise pending
  forever (no timeout, unlike `extractVideoMetadata`'s 5 s one), and its 100 ms `setTimeout`
  called `ctx.drawImage` unguarded, where a throw would have stranded the promise rather than
  rejected it. Deleted with its suite and the `appDoubles.ts` double's entry rather than fixed,
  on the operator's decision, the same as ESCSUITE-85's `remuxToWebM`.
- `converter.ts`: `fixWebMMetadata()` — the WebM container repair a **MediaRecorder** take
  goes through at save time (a WebCodecs take needs none; see "WebM Handling") — plus
  `convertToMP4()`, `convertToM4A()` (the audio alone, AAC in an MP4 container; the two share
  the private `encodeAudioChunks()` AAC pass) — `convertToMP4()`'s fourth optional argument is
  the take's camera half, which makes it the composite (see "Download Formats") — the `probeMP4Support()` codec probe both
  buttons are gated on (H.264 fatal for MP4, AAC only silencing there and fatal for M4A), and the
  `isMP4ConversionSupported()` presence check the conversion guards itself with, and
  `resolveFixWebmDuration()`, the hand-written CJS interop the repair's import needs (see
  "WebM Handling"). The library
  row's MP4 download reaches them through `hooks/useMp4Download.ts`. The compatible-WebM
  re-encode (`remuxToWebM`) that once lived here was deleted in ESCSUITE-85: nothing called
  it, and the stored WebM is already seekable.

### VideoPlayer Component (`src/components/VideoPlayer/`)
Reusable video player with full playback controls:
- **Play/Pause**: the transport button, Space or K, or a click on the video itself
- **Seeking**: click or drag the progress bar; Left/Right skip ±5s; 0 or Home jumps to the
  start and End to the end. There is no Shift modifier
- **Volume**: a slider with a mute toggle (M); Up/Down move it in 0.1 steps. The slider carries
  `aria-label="Volume"` and stays mounted always — only its visibility (hover or
  `:focus-within` on `.volumeContainer`, in `VideoPlayer.module.css`) is conditional
  (ESCSUITE-176). Before this it mounted only on `onMouseEnter`, so it had no accessible name
  axe could ever see and a keyboard user tabbing through the controls could never reach it —
  opacity + `pointer-events`, not `display`/`visibility`, keep it in the accessibility tree and
  the tab order while invisible
- **Restart**: its own transport button — seek to 0 and play
- **At the end of the video** it resets to the beginning and stops. It does not loop
- **Duration**: `video.duration` is used when it is finite and above 0, and `knownDuration`
  is the fallback for when it is not — a MediaRecorder WebM often reports `Infinity` or 0.
  The playback dialog passes the saved recording's duration as that fallback
- **Keyboard**: Space/K, Left/Right, Up/Down, M, 0/Home, End, Escape. It binds these on
  `window`; the shared `useDialogBehaviour` binds Escape and Tab on `document` in the capture
  phase, so while the playback dialog is open the dialog's Escape runs first and the player's
  does not
- **Browser chords pass through** (ESCSUITE-223): a keydown with Cmd, Ctrl or Alt held returns
  before the switch, so Cmd/Ctrl+0 (reset zoom) and Cmd/Alt+Left (history back) are no longer
  swallowed. Shift is left alone.
- **Space belongs to the focused control, not the player** (ESCSUITE-185). Space is how the
  platform presses whatever has focus, and the listener used to `preventDefault()` it for
  everything that was not an `<input>` or a `<textarea>` — so Space on the playback dialog's
  close button, which is *where focus starts* (`useDialogBehaviour`), toggled playback instead of
  closing the dialog. `preventDefault()` is the mechanism: it is what suppresses the click the
  browser synthesises on keyup. So a Space keydown is left alone when its target is something
  Space operates — `button`, `[role="button"]`, `a[href]`, `select`, or anything
  `isContentEditable` (one selector string plus the editable check, so it carries one branch
  rather than five) — and stays the player's own play/pause everywhere else: the dialog body, the
  video, the progress bar, and a keydown whose target is not an element at all. `input` and
  `textarea` are not in the selector: the older typing guard in front of it already returns for
  those on *every* key, so they can never reach this check. **Only Space is gated this way**: K,
  the arrows and M have no competing meaning on a button, so they stay the player's wherever
  focus sits
- **The progress-bar drag's two `document` listeners are removed on unmount, not only on their
  own mouseup** (ESCSUITE-176): a parent-driven close, a `?loadVideo` navigation or HMR can all
  skip the mouseup that used to be the only thing that removed them, leaving both listeners live
  for the rest of the tab — calling `seekTo` against a detached `<video>` and setting state on an
  unmounted component. `handleProgressMouseDown` now also stashes its own removal in a ref an
  unmount effect calls

### Capability Detection (`src/core/permissions.ts`)
Enhanced capability detection with detailed unavailability reasons:
- **CapabilityUnavailableReason**: `'api_not_supported'`, `'permission_denied'`, `'permission_dismissed'`, `'no_device'`, `'not_secure_context'`, `'browser_not_supported'`, `'policy_blocked'`
- **DetailedCapabilities**: Returns both boolean availability and reason/message for each capability
- **UI Integration**: Unavailable options are greyed out with explanatory tooltips
- Checks Permissions API where available for pre-emptive status detection

### Recording Modes
- **Screen Only**: Display capture without audio
- **Screen + Mic**: Display with microphone audio
- **Screen + System**: Display with system audio (where supported)
- **Screen + Both**: Display with mic and system audio
- **Webcam Only**: Camera with microphone
- **Picture-in-Picture**: Screen with webcam overlay (adjustable position, size, shape)
- **Picture-in-Picture, separate tracks** (opt-in): the same sources recorded as up to **four**
  files — the screen (still carrying the mixed audio), the webcam, the microphone and the system
  audio — instead of one composited overlay

**The two PiP modes are two pipelines, and only one of them is the default.** Composited
PiP is unchanged: the `Compositor` draws the overlay, `canvas.captureStream(30)` feeds
MediaRecorder, and `fixWebMMetadata()` repairs the container at save time — which is what
the `pip-seekable` specs guard. **Separate tracks** (ESCSUITE-14, off by default, toggled in
the Webcam Overlay panel) routes the take through `WebCodecsRecorder` instead: one recorder
holding **two `VideoEncoder`s and two Mediabunny outputs**, both stamped by the one
`nextFrameTiming()` clock, so the two blobs are frame-aligned by construction rather than by
measurement — which is exactly what two MediaRecorders started back to back could not give.
Since slice 3 it holds **one `AudioEncoder` and one Opus-only output per audio source the take
really has** as well, counting their samples from the same `start()`, so the sound is split on
the same terms the picture is. The primary output keeps the mixed audio either way, so a
screen-only download is a complete, audible recording.
The compositor still runs in that mode but **only for the preview**
(`Compositor.startPreviewOnly()`, no `captureStream`); the preview *stream* the store holds is
then the raw screen, because the canvas itself is what `RecordingPreview` puts on screen.

**Which mode a take is, is decided once and handed to everything.**
`useRecordingController` computes `config.separateTracks && isPiP &&
canUseWebCodecsRecorder(true, true, true)` before the countdown, and that one answer drives the
compositor's mode, `createRecorder`, `getRecorderType()` (which is what the save path keys the
container repair off) and the config the recorder is initialized with. So a take cannot change
pipeline half-way, and a browser that cannot serve the mode cannot be left with a recorder
building a pipeline it cannot read.

The mode is **Chromium/Edge only** and says so: `canRecordSeparateTracks()`
(`core/webcodecsSupport.ts`) wants WebCodecs *and* `MediaStreamTrackProcessor`, and
`utils/separateTracksReadiness.ts` turns a "no" into the sentence on the disabled toggle —
the browser's answer first, then the storage headroom, which is measured for roughly double
the bitrate (`hasSeparateTracksSpace`, computed beside the record button's own
`hasStorageSpace` by one `refreshStorageSpace()`). **The same headroom check also reaches the
Record button** (ESCSUITE-176): the toggle's gate can refuse switching the mode *on*, but not a
take already configured for it, so before this the button stayed live and a take with no room for
two tracks started anyway, failing at the save (`SAVE_FAILED`) or losing a companion
(`SEPARATE_TRACK_NOT_SAVED`). `recordBlockedReason()` asks the same `hasSeparateTracksSpace`
question whenever the config would actually run the mode (both sources on, the toggle on), and
reuses `SEPARATE_TRACKS_NO_SPACE_REASON` rather than a reason of its own — the two gates say the
exact same sentence for the exact same fact. The webcam pipeline is deliberately
track-processor only: the primary keeps its `<video>`+canvas fallback because a take must
record *something*, and where the processor is missing the recorder warns and records the
screen alone — as it does for **every** way the webcam half can refuse to be built, including a
muxer or an encoder that will not start (see "Recorder lifecycle"). The toggle exists only while screen **and** webcam are both on, because a
webcam-only take already *is* the webcam — the recorder ignores the flag for one.

Which sources are captured is `src/hooks/useMediaStreams.ts`; what is done with them — countdown,
start, pause, resume, stop, cancel and teardown — is `src/hooks/useRecordingController.ts`.

### The PiP frame gate

Only Picture-in-Picture composites — including a separate-tracks take, which still draws the
overlay for the preview (`startPreviewOnly()`) while the recorder reads the raw tracks, so the
gate there bounds what the preview costs rather than what a `captureStream` throws away.
`Compositor.render` requests an animation frame every
frame — 60 a second on an ordinary display — and draws on a fraction of them, because
`canvas.captureStream(frameRate)` samples the canvas at the take's frame rate (30 by
default) and drawing faster is work thrown away.

**The gate is a deadline with a tolerance, not "has a frame interval elapsed since the last
draw".** That distinction is the whole of ESCSUITE-54, and it is worth keeping:

- `1000 / 30` is not merely close to two 60 Hz ticks, it is **bit-for-bit the same IEEE 754
  double** as `2 * (1000 / 60)` (`node -e "console.log((1000/30) === 2*(1000/60))"` → `true`).
  An elapsed-time gate therefore clears after two animation frames with *zero* margin, and
  fails the instant dispatch jitter puts either frame a nanosecond under ideal.
- Snapping the reference to the drawing frame's own `performance.now()` charges that miss
  forward instead of letting it cancel, so the loop settles into a mix of 33 ms and 50 ms
  gaps. Measured before the fix: **22.4–22.8 composited fps** against a 30 fps target, 2.63
  animation frames per composited frame.

So `render` holds `nextFrameDue`, draws when `now >= nextFrameDue - FRAME_TOLERANCE_MS`, and
advances `nextFrameDue` **by one frame interval from the schedule**, not from `now`. Two
decisions carry the design:

- `FRAME_TOLERANCE_MS = 4` — how early a tick may run a frame due on the next tick. It has
  to exceed real dispatch jitter and stay well under one 60 Hz tick (16.7 ms). **One test
  bounds it from both sides**: the `jittered` row of "never draws on two consecutive %s
  60Hz ticks", which runs the invariant over `JITTER_CYCLE_MS`. Below ~0.5 ms the tolerance
  stops absorbing the cycle's short pair and a second frame lands inside one
  `captureStream` window; at or above ~16.5 ms a tick a whole frame early qualifies. Both
  ends are red, so deleting the constant does not ship silently. The `evenly spaced` row of
  the same test bounds **nothing** — see the note below — and the jitter *count* test bounds
  nothing either: 60 jittered ticks draw exactly 30 frames at every tolerance from 0 to 20,
  because it is the schedule-based advance and not the tolerance that fixes the count.
- The **stall clamp**: if `now - nextFrameDue > frameInterval` the schedule is resynced to
  `now + frameInterval` instead of being advanced one interval at a time. Without it, a
  hidden tab or a long GC pause would come back owing fifteen frames and draw them back to
  back into a canvas nobody was sampling. Pinned by "resyncs after a stall instead of
  bursting to catch up" (which also goes red at a tolerance of 17 ms).

**What the gate guarantees, and what it only usually does.** The unconditional property —
the one to rely on — is that **the deadline advances a full interval per draw, so the mean
draw rate can never exceed the target**, whatever the tick spacing. "No two consecutive
ticks both draw" is weaker: it is exact for **evenly spaced** ticks (with `1000 / 30`
bit-for-bit `2 * (1000 / 60)`, "the last tick did not draw" and "this tick draws" are exact
complements, which is why that row of the test holds at any tolerance below one 60 Hz tick,
0 included — at 16.667 ms and above the base case breaks, `start()`'s draw and the first
loop tick both qualifying), but
under non-uniform jitter two adjacent ticks can both draw — measured at ±2 ms random
jitter: at most 2 in a row, sustained rate 30.11 fps. That is a cadence wobble, not a rate
breach, and it is why the mean-rate property is the one the design rests on.

`start()` sets `nextFrameDue = 0`, which is always in the past, so the first frame is drawn
immediately — `compositor.perf.test.ts` counts a second of 60 Hz ticks as exactly
`TARGET_FPS + 1` draws for that reason.

### Recorder lifecycle

The recorder is created **and `initialize()`d before the countdown starts**, so from that moment
it already owns an AudioContext, a ScriptProcessorNode, an rAF audio-level monitor that loops
forever and — on the WebCodecs fallback capture path — a `<video>` appended to the document.
**Every exit from a take therefore has to `dispose()` it**: cancelling the countdown, cancelling
the recording, a recorder error, a start that failed (`initialize()` can throw *after* the audio
graph exists — an all-sources-off take reaches MediaRecorder, which builds the AudioContext before
discovering it has no tracks), and the unmount teardown. `useRecordingController` funnels all five
through one `disposeRecorder()` helper — and the two interval tickers through
`clearCountdownTicker()` / `clearDurationTicker()` — so a new exit path cannot quietly skip them.
Skipping disposal leaks one AudioContext per attempt, and Chrome refuses to create more after
about six. The duration ticker is cleared in `onStop` as well, because a recorder can finish a
take on its own (the capture ended) with nobody having gone through `handleStopRecording`.

A sixth exit belongs to neither list: a render-time throw anywhere in the app's React tree
(ESCSUITE-212). Before this there was no boundary at all, so a throw unmounted the whole app to
a blank page while a live recorder kept capturing into a UI nobody could see or stop. `main.tsx`
now wires `@escapesuite/shared`'s `ErrorBoundary` (mounted by `bootstrapApp()` around `<App />`)
to `useRecordingController`'s own `disposeLiveRecordingSession` as its `onError` — the same
`disposeRecorder()` / `stopAllStreamsRef.current()` the unmount teardown already calls, now
reachable from outside React through one module-level slot the mounted controller keeps current,
because `onError` is bound once at bootstrap, before any component (and so any ref) exists. Both
calls are idempotent, so this running once from `onError` and again from React's own unmount
cleanup costs nothing twice over. This is not a general safety net for a live take, only for a
**render-time** throw: an exception out of an event handler (`handleStopRecording`, say), a
`setTimeout`/`requestAnimationFrame` callback or a rejected promise reaches no React error
boundary at all and leaves the recorder running exactly as before this ticket.

The capture can also die on its own — the user hits the browser's "Stop sharing" — and the take
is not always mid-recording when it does. Both recorders handle the video track's `ended` event
in all three states:

- **recording** → stop and deliver the blob (unchanged)
- **paused** → also stop and deliver. A paused take over a dead capture can never be resumed, so
  leaving the UI in Paused only guarantees a truncated file when Stop is finally pressed.
  `MediaRecorder.stop()` from `'paused'` still fires `onstop`; WebCodecs keeps `isRecordingActive`
  true across `pause()`, so its `stop()` finalizes normally
- **before `start()`** (i.e. during the countdown) → nothing was captured, so there is no blob to
  deliver. Both recorders call `onError` with `'Capture ended before recording started'`, which is
  the only channel they have back to the controller; `onError` there clears the countdown ticker,
  disposes the recorder and returns to idle. ESCAPECRAFT has no in-app notification surface, so the
  user sees the console warning and the app back at idle rather than a toast
- **after `stop()`** → ignored. Both classes keep a `hasStarted` flag precisely because "not
  recording right now" is *also* true while a stopped take is being finalized: `MediaRecorder.stop()`
  flips `state` to `'inactive'` synchronously and `WebCodecsRecorder.stop()` drops
  `isRecordingActive` before awaiting the encoder flushes and `output.finalize()`, while the `ended`
  listener lives until `cleanup()`. Pressing Stop and then clicking the browser's "Stop sharing" bar
  lands in that window, and reporting it as an error would have the controller dispose the muxer
  mid-finalize and lose the recording

That same synchronous `state` flip used to cost `recorder.ts` a correct duration when Stop was
pressed **while paused** (ESCSUITE-105): `getDuration()` only subtracted the open pause while
`state === 'paused'`, but `stop()` had already flipped it to `'inactive'` by the time `onstop`
(and the controller's `cleanup()` read) ran, so the whole open pause counted as recorded time — a
10s take paused for 60s and then stopped read as 70s. `stop()` now latches
`pausedDuration += Date.now() - pauseStartTime` itself before calling `mediaRecorder.stop()`, the
same bookkeeping `resume()` already does, so the paused arm and the stopped arm of `getDuration()`
agree by construction. `WebCodecsRecorder` never had this bug: its `stop()` leaves
`isPausedState` untouched, so its own `getDuration()` keeps subtracting the open pause straight
through finalization.

**A separate-tracks take has up to three companion pipelines, and none of them ends the take.**
`WebCodecsRecorder` holds `companions: CompanionPipeline[]` — one `kind: 'video'` pipeline for the
webcam and one `kind: 'audio'` pipeline per audio source the take really has — each with its own
encoder, its own Mediabunny `Output` and its own `failed` flag. **Every companion watches its own
track's `ended`** (`watchCompanionTrack()`, one handler per role): it warns
`'<Track> track ended: <label>'` and calls `endCompanion()`, which stops that pipeline's capture —
`readerActive = false` for the camera, `processor.disconnect()` and `processor = null` for an audio
source — while the screen keeps recording, and `stop()` then finalizes a **shorter** part, or none
at all if nothing was ever encoded. The encoder is deliberately left open there, because `stop()`
still has to flush the tail of the part into the file. An unplugged microphone is why the audio
half exists: a dead `MediaStreamAudioSourceNode` goes on feeding silence to a
`ScriptProcessorNode` that goes on firing, so without it the part came out as long as the take and
inaudible for most of it. The `onaudioprocess` gate reads `companion.processor` for exactly this
reason — a disconnected node is one its pipeline has finished with, and a gate that depends on the
audio thread noticing the disconnect is not a gate.

`failCompanion()` is `endCompanion()` **plus the `failed` flag** (and, for an audio pipeline, a
nulled encoder): the difference between the two is whether what was already encoded is still worth
delivering. Every encoder has its own error handler, because `createVideoEncoder` takes
the handler as a parameter with no default and each audio pipeline builds its own: the primary's
still reports through `onError`, a companion's warns (`'<Track> track encoder failed: …'`), calls
`failCompanion()` and reports nothing, because
`onError` is what makes the controller dispose the recorder and throw away a screen recording that
is still being made. Flush and finalize are isolated per pipeline (`flushCompanions()`,
`finalizeCompanions()`, each loop iteration in its own try/catch rather than one around the loop,
so one pipeline's refusal does not cost the others theirs — and the flush's own catch matters
because it runs *before* the primary's `output.finalize()`, so a rejection that escaped it would
skip that finalize and report `onError` over a screen recording that was already complete).

**Four cases leave a part out** of what `stop()` delivers: a pipeline that could not be *set up*
at all (each builder has its own try/catch — an `Output.start()` or a `configure()` the browser
refuses warns, releases what it holds and records the take without that track, because
`canRecordSeparateTracks()` proves the APIs exist and nothing can prove the camera's dimensions
are an encodable VP9 config or that a third Opus encoder will configure), one that encoded
nothing, one that gave up (`failed`), and one whose `finalize()` threw. A pipeline that failed to
set up is never pushed onto the list at all, so `stop()` and `cleanup()` both skip it. An empty
row in the library and a second ARTIST source with nothing in it are worse than a missing part,
and none of the four may ever cost the take its primary blob.

**Everything a take acquires is released on the way out, whichever way it ends** (ESCSUITE-66).
A finished take releases most of it itself — `stop()` flushes and closes every encoder and
finalizes every output worth storing — but a take that is **cancelled** or that **fails** reaches
none of that, and a separate-tracks take is holding five codecs, four Mediabunny outputs, five
`MediaStreamAudioSourceNode`s and two frame readers when it happens. Neither the fields nor
`companions` can answer "what is still open?", because a pipeline that gave up has its `encoder`
nulled and `cleanup()` clears the list, so the recorder keeps three construction-order registries
— `codecs`, `outputs`, `sourceNodes` — and `cleanup()` works through all three:

- **`closeCodecs()`** closes every codec whose `state` is not already `'closed'`. The guard is not
  optional: `close()` on a closed codec throws `InvalidStateError`. Codecs are registered at
  *construction* (`registerCodec()`), before their `configure()` is awaited, which is what makes a
  `dispose()` landing inside that await safe — `this.videoEncoder` is cleared by `cleanup()` and
  then assigned again by the resolving `createVideoEncoder`, but the encoder itself was already on
  the list and is already closed
- **`cancelOutput()`** on every output still sitting at `output.state === 'started'`. Mediabunny
  holds an unfinalized output's encoders and its target open until it is told the file is over;
  `'finalized'` and `'canceled'` are done with, and one that never started holds nothing. The same
  call runs eagerly on the two paths that abandon an output mid-take: a companion whose setup
  failed (its `Output.start()` already succeeded, and nothing downstream can reach it — it was
  never pushed onto `companions`) and, in `finalizeCompanions()`, a companion that is `failed` or
  encoded nothing. A cancel that throws is warned and swallowed — the primary blob may be finished
  and about to be delivered, and must never be lost to a muxer that will not let go
- **`disconnect()`** on every source node. A `MediaStreamAudioSourceNode` is otherwise released
  only when the `AudioContext` closes, which is late for the mix's two taps and never for a
  companion's — its pipeline is gone long before the take is
- **`releaseFrameReader()` / `releaseCompanionReader()`** cancel each reader **and null the field**.
  Dropping it is the point: `stop()` releases the readers and then `cleanup()` runs from its
  `finally`, so a reader still on the field was being cancelled twice, and the `if (reader)` guards
  that could never be false were unreachable branches

`webcodecsRecorder.perf.test.ts` pins every one of these as an **exact** conservation law rather
than a ceiling — codecs closed == codecs constructed, outputs finalized-or-cancelled == outputs
started (and never both), source nodes disconnected == connected, one cancel per reader — over a
finished separate-tracks take and over a cancelled one ("one cancelled take"). The `AudioData`
handed to each audio `encode()` is closed in a `finally` for the same reason: `close()` as the
next statement leaked the decoded buffer every time `encode()` threw, which for a codec closed
under the callback is ~11.7 times a second for the rest of the take.

**A take can be thrown away while it is still being set up, and then nothing more may be
built** (ESCSUITE-73). `initialize()` awaits half a dozen times — the fallback capture
`<video>` starting, the AudioContext resuming, `Output.start()`, each codec's `configure()`,
each companion — and `dispose()` lands inside one of those awaits for real: the screen's
unmount teardown calls `disposeRecorder()` synchronously while `handleStartRecording` is still
parked on the `initialize()` it started, and the recorder's own `onError` does the same when
the capture ends mid-setup (the video track's `ended` listener is installed before
`Output.start()`). `cleanup()` has then already swept the three registries above *and cleared
them*, so whatever the resolving step goes on to build is built into a recorder nothing will
ever tear down again — a second AudioContext with its own analysers and graph, up to four
Mediabunny outputs holding their encoders and their targets open, up to five codecs, and a
track `ended` listener `trackEndedHandlers` can no longer remove. Setup then walked into one
of the fields `cleanup()` *nulled* — `videoTrack`, `audioContext` — and threw a `TypeError`
out of `initialize()`, which `handleStartRecording` reported as `START_FAILED`: a notice, in
the module-singleton store, about a take the user never saw. The level monitor's share was
one stray sample rather than a runaway loop, and worth stating precisely because it is easy to
assume otherwise: `cleanup()` nulls both meters, so a `startAudioLevelMonitoring()` reached
after it takes its **no-meter branch** and pushes a single
`{ microphone: 0, system: 0 }` — one whole-app re-render on behalf of a take that no longer
exists — rather than scheduling anything.

So `cleanup()` raises a **`disposed` flag first**, and every await in the setup path is
followed by `abortIfDisposed()`. Three decisions carry it:

- **It throws.** `TakeDisposedDuringSetup` is caught by `initialize()` and by nothing else,
  which keeps the guard to one decision rather than an `if` at each of nine call sites — and
  the two companion builders' existing `catch` blocks already release exactly what their half
  was holding (the output, and the camera's reader), so the error is thrown *into* those
  catches and re-raised by them rather than guarded around them. A disposal is warned about
  nowhere: a take that no longer exists is not a take recorded without its camera
- **`initialize()` resolves.** A rejection would reach `handleStartRecording`'s catch and
  raise `START_FAILED` — a notice, in the module-singleton store, read out on the next mount,
  about a recording the user never saw. Every other failure still rejects exactly as before
- **Only one step has anything to release**: an `Output` whose `start()` resolves *after* the
  sweep sits at `'started'` and is no longer on `this.outputs`, so `abortIfDisposed()` takes
  it as an argument and cancels it. A codec still configuring was registered at construction
  and is already closed (ESCSUITE-66); the `<video>`, the AudioContext and the primary's
  reader are all fields `cleanup()` reached

`startAudioLevelMonitoring()` moved out of the setup body to `initialize()` itself, past the
guard. That move is **structural**, not a repair of anything the loop did: monitoring is now
unreachable after a dispose, so neither the rAF loop nor that one stray sample can belong to a
take that is gone.

The controller closes the same window from its own side, with **two** guards after
`initialize()`, because being superseded and being torn down are different facts and want
different answers (ESCSUITE-109):

1. **Superseded — touch nothing.** `if (attemptRef.current !== null && attemptRef.current !==
   myAttempt) return;`. A cancel frees Record while this await is parked, so by the time it
   resumes the next take may have acquired its capture and built *its* recorder — and
   `recorderRef`, the store's streams and `stopAllStreams` all belong to that take by then.
   Whatever this attempt owned was released by the cancel that superseded it, so it has nothing
   left to do and no right to do anything.
2. **Torn down — tear down.** `if (!recorderRef.current) { disposeRecorder(); stopAllStreams();
   return; }`. Any `disposeRecorder()` nulls that ref: the unmount teardown, both cancels, and
   the recorder's own `onError`, which cancels nothing and so raises no flag — the case
   `cancelledRef` alone cannot see. Without it, a capture stopped during setup left `'countdown'`
   in the store and an interval ticking against a null recorder: a 3-2-1 over nothing, with a
   next mount coming up inside it. `cancelledRef` is deliberately *not* asked here — every path
   that raises it disposes the recorder on the same line, so the ref answers for it, and asking
   both would be a decision that can never go the other way.

Getting that split wrong is not a cosmetic bug and has its own test ("when a newer take is
already being set up"): one guard that tore down on both facts disposed the newer take's recorder
and put its sharing bar out mid-take, and then the newer take's own resume found a null recorder
ref and returned **without setting a state** — leaving the UI in `'preparing'`, where the record
button is disabled and Cancel does not render, with a reload as the only way out.

The start notice is withheld on both of them — the `catch` returns as soon as the token is not its
own — so a browser that *does* reject out of a half-torn-down setup (an AudioContext closed under
a pending `resume()`) still says nothing to a user who has left. Guard 2 **tears the take down**
rather than returning bare (ESCSUITE-93): both calls are no-ops on every path that reaches it
today — the unmount teardown, the recorder's own `onError`, and `handleCancelRecording` from
Escape in `'preparing'` while `initialize()` is parked — because each has already done them. A
bare return is nevertheless a promise that every *future* way of arriving there will have cleaned
up first, and the window below is the one that broke it.

**There is an earlier window still, and a cancel cannot clean up after it** (ESCSUITE-93).
`handleStartRecording` parks on `await acquireStreams()` — the screen-share picker is on screen,
or the camera permission prompt is — and that is *before* `setStreams()`, so the Escape that
lands underneath it (in `'preparing'`, which `useKeyboardShortcuts` routes to
`handleCancelRecording`) raises the flag, disposes a recorder that does not exist yet, returns
the app to idle and calls a `stopAllStreams()` that reads the store and **finds nothing there**.
The resumed start then did all of it anyway — the live streams into the store, the compositor
started, `createRecorder()`, `await initialize()` — and only then reached the guard above, which
returned without disposing: the sharing bar and the camera light stayed on for the rest of the
session behind a UI that said idle, a compositor rAF loop drew forever in PiP, and an orphaned
recorder pushed audio levels ~12x/s into the store. Repeat it and Chrome refuses further
AudioContexts, so later takes fail to start. So the attempt is asked again **immediately after
`acquireStreams()` answers** — the token and `cancelledRef` together, one `abandoned` question
(ESCSUITE-109) — and that exit releases what the request handed back itself —
`stopStream()` on each of the three captures — and builds nothing on top of it: no `setStreams`
(the store would mirror a capture already being thrown away, on a component that may be
unmounted), no preview, no compositor, no recorder. It is deliberately the earliest exit, and the
only one whose law is that nothing was ever *made*: `useRecordingController.test.ts`'s "while the
capture request is still outstanding" asserts zero recorders built, a null `compositorRef`, an
untouched store and every acquired track stopped **exactly once** — in the cancel case and in the
unmount case alike — and then that the *next* Record click still starts a take, because a gate
left closed on the cancelled path would brick the button for the session and say nothing.

**One start at a time, and the token that says which start.** `state` is the *rendered* truth and
is written a render before it is read, so nothing but that lag stood between two fast clicks on
Record — or two presses of R — and two overlapping starts, with the second `recorderRef.current =`
orphaning the first recorder's AudioContext, level monitor and muxer where no `dispose()` could
ever reach them. `attemptRef` is the synchronous truth: an **attempt token** — an empty object,
because identity is all it carries — set at entry and dropped in the `finally` of the same attempt
(per attempt, not a latch), with a second call while one is in flight a no-op.

It replaced a boolean (ESCSUITE-109) because a boolean could only be dropped when the attempt
*settled*: a take cancelled while the picker was still on screen left Record inert until that
picker was answered — bounded and sub-second when a device opens normally, and for a picker nobody
ever answers, dead for the rest of the session with nothing said about it. So
`handleCancelRecording`, `cancelCountdown` and the unmount teardown all **drop the token**, which
does both halves at once: Record is free at cancel time, and the attempt that resumes afterwards
finds a token that is no longer its own. **Every post-`await` guard in the start path asks it** —
the one after `acquireStreams()` and the pair after `initialize()` (see "two guards" below) — so
an abandoned attempt
releases what it was handed and builds nothing, rather than walking on into a take that is now
live; and the `catch` asks it first of all, because tearing down there would tear down *that*
take. A stale attempt has nothing of its own to release beyond what the request handed it: only a
cancel or the unmount teardown can drop the token mid-flight, and both dispose the recorder and
release the capture on their way past. `useRecordingController.test.ts`'s "and the next take is
started before it arrives" drives the ordering both ways round — the abandoned request answering
before the new take's own, and after it — and asserts the abandoned tracks stopped exactly once
with the live take's recorder, streams and countdown untouched.

`cancelCountdown` raises `cancelledRef` as well, so the two cancel paths have one shape
(ESCSUITE-109). It is the only cancel that used to be visible to the post-`initialize()` guard
solely through the recorder ref it nulled, and to a start still parked on its capture request not
at all.

**Five of the recorder's six callbacks carry the same identity.** The attempt token above answers
for the *start path*; the callbacks `createRecorder` is given — `onStart`, `onPause`, `onResume`,
`onStop`, `onError` — answer for what happens after a take is live, and used to have no identity
of their own: each acted on whatever `recorderRef`, the tickers and the streams held **when it
fired**, not on the recorder it was built for. A recorder disposed by a cancel can still flush a
last chunk or report a dead encoder afterwards (ESCSUITE-66/73 make it rare, not impossible), and
by then `recorderRef.current` may be a newer take's recorder — B, live and recording — so A's late
`onError` disposed B and stopped B's streams, and A's late `onStop` (past `cancelledRef`, which a
start resets) would have saved A's blob as B's take. Fixed the same way as the start path
(ESCSUITE-118): `const me: AnyRecorder = createRecorder({ ... }, ...); recorderRef.current = me;`
— the callbacks only ever run once initialization has resumed after `createRecorder` returns, so
`me` is settled before any of them can read it — captures the exact instance in the closure, and
`onStart`, `onPause`, `onResume` and `onStop` each open with `if (recorderRef.current !== me)
return;` before doing anything else. `onError` guards the same way but **logs first**: its
`console.error('Recording error:', error)` runs before the identity check, deliberately, so the
console still hears about a late failure from a recorder nobody is listening to any more — a test
pins the console call happening even when the rest of the callback is skipped. `onStop` had a
second guard here too, `if (cancelledRef.current) return;`, for a stop landing after the take was
cancelled or the screen went away — but it turned out to be unreachable, and was deleted
(ESCSUITE-118 fix round 2): every path that raises `cancelledRef` (`cancelCountdown`,
`handleCancelRecording`, the unmount teardown) calls `disposeRecorder()` on the same line, which
nulls `recorderRef.current`, so the identity guard two lines above always returns first. The
identity guard is what actually drops a cancelled take's late stop now, and its comment says so.

The identity guard also catches a narrower case than supersession: a recorder whose *own* `onError`
disposed it. `disposeRecorder()` nulls `recorderRef.current`, and nothing raises `cancelledRef` on
that path — so on the MediaRecorder path, where the browser can still call `onstop` with whatever
chunks it had recorded after an `onerror` (`core/recorder.ts`'s `mediaRecorder.onerror` /
`onstop`), the take's own late `onStop` used to save that partial blob as if the take had ended
normally. `recorderRef.current !== me` is true once the ref is `null`, exactly as it is once the
ref points at a different recorder, so that late `onStop` is dropped too — correctly: the take was
already reported as failed and returned to `'idle'`, and saving a blob afterwards would resurrect
a take the user was just told had failed.

`onAudioLevels` is the one callback left unguarded, because it needs no guard: both recorders
cancel their rAF level-monitor loop synchronously inside `dispose()`'s `cleanup()`, so a disposed
recorder is never still mid-loop when this fires.

**The save's completion carries the same identity** (ESCSUITE-174). `onStop` kicks the save off
and returns; the `setState('idle')` that follows it used to land in whatever the store held
whenever the save settled, and a save is a container repair, a metadata probe, a thumbnail decode
and two IndexedDB writes — seconds on a multi-MB take over a slow disk. Anything that took the app
out of `'saving'` inside that window left Record live, and the finished save's own `'idle'` then
landed on the take started *after* it: recording, with the store saying idle, so the transport bar
offered "Start recording" with no Stop and no Cancel, and a Record click reassigned
`recorderRef.current` over a recorder nothing could ever dispose. Escape was the only way in that
the UI offered (see "Keyboard Shortcuts" — it no longer is; the transport bar's own Cancel renders
only while a take is live, under `isRecordingActive`, never in `'saving'`), but the clobber is a
property of the completion rather than of the key: the guard is the half that holds if any future
control, or the unmount teardown, takes the app out of `'saving'`. So the chain is
`saveRecording(...).catch(...).then(...)`: the two arms converge on **one** state write, guarded by
`if (recorderRef.current !== me) return;` — the same `me` the five callbacks carry. Once the ref has
moved on, this take is not the app's any more and whatever moved it has already set the state it
wanted. Two things stay deliberately **unguarded** either side of that write: `SAVE_FAILED` and its
`console.error`, because the user's recording really is not in the library whatever they have moved
on to, and the `refreshStorageSpace()` in the `finally`, because the write happened either way.

**The invariant that guard rests on**: an ordinary save passes it because neither
`handleStopRecording` nor `onStop` disposes the recorder — the ref still points at `me` when the
save settles, seconds later — and every path that *does* move it off `me` has already written a
state (both cancels, the unmount teardown, the recorder's own `onError`, the start path's catch).
**A stop that disposed the recorder would have to write `'idle'` itself**, or this guard would
strand every ordinary save in `'saving'`. That matters because `'saving'` has **no user-reachable
exit at all** — the Record button is disabled there, the Cancel button is not rendered, and
Escape is inert — so the save promise settling is the only way out, and **the one thing on that
path that could never settle now has a deadline** (ESCSUITE-180).

`core/thumbnailGenerator.ts`'s `generateThumbnail` had an `onerror` and no clock, so a `<video>`
that neither loads nor errors — a container Chromium's demuxer will not commit to, a decoder that
never reports — parked the save, and with it the app, for the life of the tab. Both probes on the
save path now race **`THUMBNAIL_TIMEOUT_MS`** (5 s, exported from that module): the number
`extractVideoMetadata` has waited since it was written, named so `generateThumbnail` shares it
rather than carrying a second one. Same shape as `CAPTURE_TIMEOUT_MS` (ESCSUITE-109/116) and for
the same reason — nothing here can be aborted, so a clock is the only way out — but far shorter,
because nothing is waiting on a *person*: a decode either starts within a second or two or it is
not going to. On expiry the probe rejects through the same cleanup its `onerror` arm uses (object
URL revoked, element back to NETWORK_EMPTY, and the frame request `onloadeddata` queued cancelled,
so an abandoned probe cannot be followed by a `captureFrame()` that draws a frame for it — a
`toBlob` callback already in flight when the deadline fires instead finds the promise settled and
its own cleanup a harmless no-op), and the caller lands on the **placeholder** — the arm
ESCSUITE-107 already built for a thumbnail that cannot be had. So a save never waits for a frame
that is not coming: it finishes with the placeholder tile and returns to `'idle'`.

**Deliberately not a deadline on the whole save.** The two IndexedDB writes that follow have no
safe abandon point — giving up partway through `storeVideo` would leave a take half in the library,
which is exactly the failure ESCSUITE-107 was about — so the deadline stops at the last thing on
that path that can be dropped harmlessly.

**A microphone that cannot be opened does not cost the take** (ESCSUITE-184). `acquireStreams`
(`hooks/useMediaStreams.ts`) asks for the three sources in order — screen, webcam, microphone —
and used to release everything it held and rethrow on *any* failure, so a user who had already
picked the window they wanted to share lost it the moment `requestMicrophone()` rejected, with
`CAPTURE_REFUSED`/`START_FAILED` and nothing recorded. The microphone's request now sits in its
own try/catch, and the catch cannot tell *why* it failed — the prompt was refused, the device is
already in use by another app, it was unplugged between the capability check and the request —
so it treats every rejection the same way: the screen and webcam captures are kept, the take
proceeds without sound, and the result carries `micUnavailable: true` so the controller can raise
`MIC_UNAVAILABLE` through the one notice channel.

The reasoning for why this is the *only* optional source: a take with no sound is a take — the
ESCSUITE-14 companion shape with the mic part simply absent, which every consumer already reads,
because a machine with no microphone has produced exactly that since ESCSUITE-70. A refused
**screen** capture still fails the take (there is nothing to record), and so does a refused
**webcam** in a PiP take, because the overlay is what the user explicitly asked for. The one
exception to the exception: a **microphone-only** take whose microphone could not be opened has
nothing left either, so `!screen && !webcam` rethrows and that take fails exactly as it did
before.

Three details follow from the shape:

- **`AcquisitionResult` is a wider type than `AcquiredStreams`**, which is what `onPartial`
  still reports. The deadline release (ESCSUITE-116) reads the latest `onPartial` report and has
  no use for `micUnavailable`, so the reporter's shape is unchanged — and the microphone stage is
  still reported whether or not it produced a stream, because a screen capture that landed before
  an unavailable microphone must be in the report the expiry releases.
- **The controller cannot work this out for itself.** `mic: null` with the toggle on is *also*
  what a machine with no microphone looks like, and `useRecordingController` has no
  `capabilities` to tell the two apart — hence the flag rather than an inference.
- **Nothing else needed changing.** `micAcquired` is already "the toggle AND a track on the
  stream that came back" (ESCSUITE-70), so an unavailable microphone is `false` there by
  construction: `expectedCompanions` counts no mic part, both recorders' audio wiring is guarded
  on `micStream &&`, and the `CapturedTake` the save path is handed describes a recording with no
  microphone — so the library's M4A gate, the MP4 conversion and the ARTIST handoff all see the
  take as it was actually recorded.

**A capture request the browser never answers gets a deadline.** `getDisplayMedia` and
`getUserMedia` take no `AbortController`, so a picker or a permission prompt left on screen — or a
camera or microphone driver wedged such that `getUserMedia` never settles — used to park
`handleStartRecording` for the life of the tab: `'preparing'` with no way out but a reload, and
Record inert behind it (ESCSUITE-109). So the request is raced against
`CAPTURE_TIMEOUT_MS` (60 s, a constant in `useRecordingController.ts`, generous because the share
picker is a dialog a user may legitimately leave sitting). On expiry the app raises
`CAPTURE_UNANSWERED` through the one notice channel, returns to `'idle'` and frees Record. The
request is still out there, so `acquireStreams` is not a black box for the deadline branch:
`acquireStreams` takes an optional `onPartial` reporter, called after each stage lands
(screen, then webcam, then microphone) with the streams acquired so far — nulls for stages not
yet reached — and `handleStartRecording` keeps the latest report in a local, closed over by
nothing but this one attempt. Answered-and-parked used to mean live: the picker settled, the
camera prompt never did, and the browser's "sharing your screen" bar stayed up until *that*
prompt eventually settled too (ESCSUITE-116). Now the deadline branch releases the latest
partial report immediately — the share bar goes down at the deadline, not whenever the stalled
prompt gets around to it — whether or not the take had already been cancelled (the release sits
before the `abandoned` guard that decides whether to say anything, so a thrown-away take still
gets its screen share stopped, silently). A second, narrower window stays open past the deadline
itself: a stage that lands *after* the clock has given up but before the whole request finally
settles — the camera prompt answered a minute late, the microphone driver unwedging itself an
hour later — used to sit in `onPartial`'s latest report with nothing reading it again until the
request settled, which could be never. An `expired` flag closes it: once the deadline branch has
fired, the same `onPartial` callback releases whatever it is handed on the spot, rather than only
updating the local the deadline branch already read. Only *then* — whether through the deadline's
own release, the `expired` callback, or both — does whatever the request eventually hands over
also get released on arrival, same as before: `releaseAcquired`, the same three `stopStream()`
calls the cancelled path makes, moved onto a promise nobody is awaiting any more. The releases can
name the same stream more than once — a stage already reported through `onPartial`, before or
after the deadline, is handed back again inside the final `acquired` once the request does settle
— and that is safe on purpose: `stopStream` stops tracks, and stopping an already-stopped track is
a no-op. A request that *rejects* after the clock ran out still says nothing, because the user was
already told. The token is the abort:
nothing is plumbed into the browser APIs, which would not take it. The clock is armed *after* the
request is issued and with nothing awaited in between, so it costs the click's user activation
nothing, and it is cleared however the race ends, including by the request throwing — a 60-second
timer left armed behind every take is a leak, which
`useRecordingController.test.ts`'s "never starts the clock for a request that answers at once"
pins by counting the timers a started take leaves running.

`webcodecsRecorder.perf.test.ts` pins the whole of it as exact conservation over one such take
("one take disposed while it was still setting up"): three codecs closed, two outputs
cancelled, three source nodes and one processor disconnected, two readers cancelled, one
AudioContext closed, **zero level samples pushed**, and zero `requestAnimationFrame` calls
beside it as the guard that the monitor call stays where it is.

**Audio companions are a second tap, never a diversion.** The primary output keeps the mixed
`AudioEncoder` and the mixed Opus track exactly as before — a screen-only download still has
sound, and the composite MP4 has the mix to draw on without decoding a single part. Each companion adds its own
`MediaStreamAudioSourceNode` on the same track, its own `ScriptProcessorNode` (4096 samples, the
same node the mix uses — this class has one audio-capture mechanism, and a second one in the same
take would be two things to keep in step for no gain), its own `AudioEncoder` and its own
Opus-only `Output`. A companion exists exactly when its source is in the mix: the conditions
are the ones `initialize()` already asks when it wires the mix — a toggle AND the stream it names
(`config.microphoneEnabled` with `micStream`, `config.systemAudioEnabled` with an audio track on
`screenStream`) — with the companion additionally requiring an audio *track* on `micStream`, which
costs nothing because a stream with no audio track contributes nothing to the mix either. That is
the same pair `useRecordingController`'s `expectedCompanions` asks, so the number built and the
number the take is counted as asking for cannot disagree. `useRecordingSave`'s `hasAudio` cannot disagree about the
**microphone** either, since ESCSUITE-70: that half is the same pair, resolved once by the
controller as `micAcquired` and carried to the save path in `onStop`'s closure, so a take whose
microphone toggle is on and whose `acquireStreams` came back with `mic: null` builds no mic
companion, is counted as asking for none, and is stored as having no audio. Its **system** half is
weaker by construction: `systemAudioShared` is read from the store at save time and reset only by
the next take's start, so it describes this take until another begins (stated on the expression
itself). The
**level meters are untouched** — the mix's own two analysers, on the mix's own source nodes; a
companion adds a tap, never a meter.

**A lost part is said out loud, from whichever layer knows.** A short list on this callback is also
what an ordinary take delivers, so the recorder cannot report the loss and `useRecordingSave`
cannot see it (it saves what it is handed). The **controller** can: it resolved the mode before
the countdown and counted how many companions the take asked for — the camera, plus one per audio
source it really has — so `onStop` raises `SEPARATE_TRACK_NOT_SAVED` when fewer arrive, and says
nothing for a composited take, whose `expectedCompanions` is 0. `useRecordingSave` raises **the
same notice** for the other half of the same promise: a part lost in *storage* — metadata,
thumbnail or a write that throws — is caught, warned per role and reported once however many were
lost, and the primary is stored and listed exactly as a single-file take would be. One string
either way; the console has the detail.

Losing every part is the case that shows why the resolved mode has to be *carried* rather than
inferred (ESCSUITE-68). The controller hands `separateTracks` to `saveRecording` on the same
`captured` object as `micAcquired`, in the same closure, so a take whose companions all went
missing inside the recorder is still stored as the take it was: its primary named by its own
`takeId`, with `role: 'screen'`, `startOffset: 0` and the `overlayPlacement` the camera was framed
at — the only record of that geometry there is. Read off the companion list alone, the same take
was stored as though it had been composited.

`onStop` is uniform on the WebCodecs path: `(blob, companions)` for every take, the list in role
order (webcam, mic, system, because that is the order the pipelines are built in) and `null` where
there are none, so an ordinary take reports that it had none rather than saying nothing.
`Recorder` (MediaRecorder) still calls it with the blob alone. One `RecorderStopCallback`
(`store/types.ts`) types both, which is what makes the controller's single callback assignable
to either recorder.

**Composited Picture-in-Picture is the gap**: the stream handed to the recorder there is the
compositor's canvas track, not the screen track, so none of the above fires when the user stops
sharing during a composited PiP take. Fixing that means watching the source tracks in
`compositor.ts`. A *separate-tracks* PiP take is not affected — its recorder holds the raw
screen track, so every row of the list above applies to it as it does to a screen-only take.

**Audio-only takes use the MediaRecorder path.** `SourceToggles` lets both video sources be switched
off; `WebCodecsRecorder` is built around a video track and throws
`'No video track available for recording'` without one. `createRecorder` / `canUseWebCodecsRecorder`
/ `getRecorderType` take `hasVideoSource` alongside `isPiP` for exactly this, and the controller
computes it as `(config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam)` — the same
"a stream AND its toggle" test both recorders apply when they pick a video track, since a capability
the browser lacks yields a `null` stream with the toggle still on. (`separateTracks` is the third
argument all three take, and the recorder asks the same "a stream AND its toggle" question of the
screen before it builds a companion at all: a take configured for the screen but started without
one is recording the *webcam* as its primary, and a companion there would be one camera in two
files.) `getRecorderType` gets it too:
its answer is what `useRecordingSave` keys the `fixWebMMetadata` repair off, so an audio-only take
would otherwise be saved as unseekable WebM.

**The same boolean is what keeps an audio-only take's own stored metadata honest (ESCSUITE-143).**
The controller carries it as `CapturedTake.hasVideoSource`, and `useRecordingSave` reads it for the
primary the same way `part?.isAudio` reads a companion's role: no picture means no
`extractVideoMetadata` probe (which reports `videoWidth || 1920`, so an audio file would otherwise
come back a lying `1920x1080`), no thumbnail (a mic/system companion's own contract — the library
draws its empty placeholder), and `buildSourceVideo`'s new `capturedPicture` argument turns both
`mediaType` and `frameRate` to the audio companions' own answer: `'audio'`, `width: 0`, `height: 0`,
`frameRate: 0`, duration the recorder's own clock. Before this, a take with Screen and Webcam both
off and only the microphone on — which `recordReadiness.ts` allows — was the one shape
`companionPartFor` could never see, because a plain take's primary carries no `role` at all: it was
stored exactly like a screen recording, and ESCAPEARTIST placed it on a video track with a picture
that never came.

### Frame timestamps and keyframes

`WebCodecsRecorder` stamps every encoded `VideoFrame` with the **recording clock at capture** —
`performance.now()` since `start()`, paused time excluded, rounded to microseconds. One private
`nextFrameTiming()` helper decides it for all three capture paths (`MediaStreamTrackProcessor`,
`requestVideoFrameCallback`, the `setTimeout` loop), so they cannot drift apart.

- It used to be `frameCount * 33333 us`. `getDisplayMedia` does not promise 30 fps: a window or a
  screen capture routinely delivers 5-15 frames a second, and counting frames made N of them span
  N x 33.3 ms however long they really took. A 60 s take at 15 fps came out as a 30 s video track
  against 60 s of audio — playback at 2x, with the audio lagging
- **Strictly increasing**: a computed timestamp that does not advance on the previous frame's
  becomes previous + 1 us — two frames inside one tick of a coarse or frozen clock would
  otherwise be stamped the same. This is an **encoder-level** guard, not a container-level one:
  `VideoEncoder` is fed a monotonically increasing presentation timeline and a zero-delta frame
  is a meaningless presentation. Mediabunny itself throws only when a timestamp is below the
  largest of the *previous GOP*, and its WebM muxer rounds each timestamp to a whole millisecond
  (`Math.round(1e3 * chunk.timestamp)`), so 1 us apart and identical land on the same block
  timecode either way
- **A keyframe once per elapsed second** — `keyFrame = timestamp >= nextKeyFrameUs`, then
  `nextKeyFrameUs = timestamp + 1_000_000`, the first frame always a keyframe. The count-based
  rule it replaced (`frameCount % frameRate`) only meant one a second while the source really ran
  at 30 fps; at 10 fps it was one keyframe every three seconds, and seeking paid for it. A
  resume is **not** forced to be a keyframe: a pause consumes no recording clock, so the frame
  after it is keyed only if a second of *recording* has passed since the last keyframe
- **`getDuration()` reads the same clock**: `startTime`, `pauseStartTime` and `pausedDuration` are
  `performance.now()` milliseconds, so the duration the user is shown and the length written into
  the container are read from one monotonic source. They are not guaranteed identical — the
  controller reads `getDuration()` inside `onStop`, after `stop()` has awaited the encoder flushes
  and `output.finalize()`, so it runs a little past the last frame's timestamp. It does not
  matter, because `useRecordingSave` saves `metadata.duration` extracted from the finished blob
  and falls back to `getDuration()` only when that is missing or zero
- The two fallback paths still put a nominal `duration: frameDurationUs` on the `VideoFrame`. The
  muxer derives presentation gaps from the timestamps — a WebM SimpleBlock carries no duration —
  though the segment `Duration` is the last block's timecode *plus* its duration, so the nominal
  33333 us does reach the file, as one frame's worth at the tail
- **`recorder.ts` (MediaRecorder) is untouched.** It stamps no frames of its own — MediaRecorder
  times them — so its `getDuration()` still measures with `Date.now()`; there is nothing for it to
  keep in step with

**One clock, one bookkeeping record per encoder.** `nextFrameTiming(timing, now)` reads the
recorder's shared `startTime` and `pausedDuration` — which is what makes two pipelines' frames
one timeline — while the strictly-increasing guard and the once-a-second keyframe rule live in a
per-pipeline `FrameTiming` (`newFrameTiming()`: one for the screen, one for the companion, both
reset by `start()`). Sharing those two numbers would have interleaved pipelines pushing each
other's timestamps forward and handing the second stream only the keyframes the first did not
claim. `webcodecs-recorder.test.ts` pins the property directly — "stamps both encoders from the
one clock — same tick, same timestamp": two frames captured at one clock reading carry the same
timestamp, each stream's first frame is a keyframe, and a pause is excluded from both.

**The audio pipelines follow the same rule with a different unit.** The primary's mix counts its
own samples into `audioTimestamp`; each audio companion counts its own into its own
`timestampUs`, reset by the same `start()`. Per pipeline rather than shared, and that is the
point: three `onaudioprocess` callbacks advancing one counter would interleave and stamp each
other's audio. What they share is the **origin** — one `start()`, one `AudioContext`, one
`isRecordingActive` / `isPausedState` gate, one sample rate — which is what puts every part of a
take on one timeline. Paused time is excluded from all of them identically, because a buffer
dropped while paused is never counted. The residual risk is one 4096-sample buffer (~85 ms) if a
callback lands exactly across `start()`, which is the same risk the mix already carries against
the two video pipelines.

`webcodecs-recorder.test.ts` pins all of it against a scripted `performance.now()`: a 30 fps
source, a 15 fps source (the bug above), the strictly-increasing guard under a frozen clock,
keyframes at 0 / 400 / 800 / 1200 ms, paused time excluded from the stamps, and — on the
`MediaStreamTrackProcessor` path, the one every Chrome/Edge screen take actually runs on — the
frame that survives the 0.8x throttle stamped at the 40 ms the clock says.

### Audio level meters

Both recorders read their analysers on `requestAnimationFrame` and push an `AudioLevels` to the
store through `onAudioLevels`; `SourceToggles` draws the meters. **Both gate that to one sample
every 80 ms** (`AUDIO_LEVEL_INTERVAL_MS` in `webcodecs-recorder.ts`, `updateInterval` in
`recorder.ts`) — ~12.5 Hz, which is plenty for a meter and a twelfth of the cost. Ungated,
and back when `App` subscribed to the whole store, that was 60 whole-tree renders a second for
the length of a take.

Two more rules the WebCodecs recorder follows and `Recorder` does not yet:

- Each analyser is paired with the `Uint8Array` it reads into (`LevelMeter`), allocated once
  from `frequencyBinCount` — which never changes — and refilled in place, instead of a fresh
  typed array per source per sample.
- A take with **no** microphone and no system audio starts no monitor at all — there is no
  analyser to read, so the loop would only write a hard-coded `{ microphone: 0, system: 0 }`
  into the store for a meter that cannot move. It does send that value **once**, before
  returning. This one-shot predates ESCSUITE-114's fix below and is now belt-and-braces rather
  than load-bearing — the store already reads zero at the start of every take regardless — but
  it costs one store write per take, not per frame, so it stays rather than adding a branch to
  skip it.

Neither recorder's monitor ever emits a zero on its own once it has something real to measure —
it just keeps sending whatever it last read, for as long as the take runs. And `dispose()`,
which both cancel paths and the unmount teardown call instead of `stop()`, cancels the monitor's
`requestAnimationFrame` loop without emitting at all — so a cancel produced no zero of any kind
before ESCSUITE-114. `useRecordingController` now shares one `zeroAudioLevels()` helper, called
from every path that ends a take: the stop path (`onStop`, past the `cancelledRef.current` guard
— a stop that lands for a take already thrown away has nothing left to zero, since the cancel
that raised the flag already did), `handleCancelRecording`, `cancelCountdown`, and the unmount
teardown (which already reset `state` / `currentDuration` / `countdownValue` for the same
module-singleton-store reason and had omitted `audioLevels`). Whichever way a take ends, the
next one's meter — closed by `showMeters` for every state but `'countdown'` / `'recording'` /
`'paused'`, ESCSUITE-104 — never opens on a level the take before it left behind; `'countdown'`
is the state that matters here, since the recorder (and its monitor) is already initialize()d by
the time a countdown starts, before the meter has a reading of its own to show.

**`capturedThumbnailRef` follows the same rule (ESCSUITE-176).** `handleStopRecording` writes it
before `recorder.stop()` even resolves, and `useRecordingSave` is the only place that reads and
clears it — once a save actually runs. A take thrown away on any other path never reaches a save,
so without a matching clear there, the ref still held the thrown-away take's frame the next time
one was needed: a cancel followed by a take that ends on its own (the recorder's own `onStop` —
"Stop sharing" is exactly this, not a Stop click) read `capturedThumbnailRef.current` in
`useRecordingSave` and preferred it over decoding one from the new take's own blob, so the second
take was saved with the first take's picture. The same three paths that call `zeroAudioLevels()`
now also clear this ref: `handleCancelRecording`, `cancelCountdown`, and the unmount teardown.
`useRecordingController.test.ts`'s "audio levels" cases pin it: non-zero while a take is live,
zero after a stop asked for and one the recorder fired on its own, zero after each of the two
cancel paths, and zero already sitting there the moment the next take reaches `'countdown'`.

**A level push now costs the Sources panel and nothing else.** `App` selects each field it
reads and does not read `audioLevels` at all; `SourceTogglesPanel` owns the subscription and
hands the value to the props-only `SourceToggles` (see the App section above). Measured
2026-09-16 over 12 pushes, before → after: `App` 12 → 0 renders, `AppHeader` 12 → 0,
`RecordingsList` 12 → 0, `RecorderControls` 12 → 0, `RecordingPreview` 12 → 0, `SourceToggles`
12 → 12. `App.rerender.test.tsx` asserts those five as exact zeros — conservation, not a
ceiling: a component that does not subscribe re-renders never — and asserts that the meters
still draw the level `App` never handed them, so a panel that subscribed to nothing could not
pass by rendering zero times.

`webcodecsRecorder.perf.test.ts` and `recorder.perf.test.ts` assert all of this as counts —
at most 13 emissions per 60 animation frames in *both* files, so the two monitors cannot drift
apart again. `Recorder`'s per-sample analyser buffer is pinned there as a finding, with the
assertion to flip when it is hoisted.

### Integration with ESCAPEARTIST
- Both apps share `video-editor-db` IndexedDB database
- Recordings stored with `source: 'recording'` and `recordedAt` timestamp
- "Send to Editor" opens ESCAPEARTIST with `?loadVideo=<id>` parameter — the id of a take's
  **primary** part, whichever row was clicked, *unless* that row's own primary is no longer in
  CRAFT's library (its own id then, ESCSUITE-145): an orphaned companion — its primary deleted
  from ARTIST's media library elsewhere — hands over its own id rather than one that resolves to
  nothing, and ARTIST imports it alone rather than answering "Recording not found". Given a
  primary, ARTIST resolves the siblings and places every part of the take on the timeline in one
  undo step; see `apps/artist/CLAUDE.md`'s "A handed-over take is several files" for the detail
- Same-origin deployment (Vercel) enables seamless data sharing

### Embedding
When CRAFT runs in an iframe (`isEmbedded()` from `@escapesuite/shared/config`),
"Send to Editor" does not open `/artist/` itself — it posts `SEND_TO_EDITOR
{ id }` to the parent window instead, and the host is expected to navigate to
its own editor URL with `?loadVideo=<id>`. Because CRAFT and the host-chosen
editor are same-origin, the shared IndexedDB `video-editor-db` makes the
recorded blob available there without re-uploading it. Outside an iframe,
`VITE_EDITOR_URL` controls where CRAFT opens the editor (defaults to
`/artist/`). See `src/utils/sendToEditor.ts`. Both editor links — "Send to
Editor" and the header's "Open Editor" button — honour `VITE_EDITOR_URL` via
the shared `editorUrl()` helper.

**"Upload to host"** is the second host-routed action and the last one: an
extra icon button on every library row, between the MP4 download and "Open in
Editor", which posts `UPLOAD_RECORDING { id, name, blob, role?, takeId?, parts? }` to the
parent — the stored blob itself, by structured clone, with no `arrayBuffer()`
copy and no network of any kind. The three optional fields arrived with
ESCSUITE-14: `role` and `takeId` on a row that has them, `parts` on a take's
primary row, so a host that knows nothing of takes receives exactly what it
received before (see "A take can be several files"). It exists **only** when CRAFT is embedded, because a host
is the only thing that could receive it. `RecordingsListPanel` asks
`isEmbedded()` and passes `onUploadToHost` only then; `RecordingsList` stays
props-only and draws the button exactly when it has the prop, so the component
never asks where it is running. A recording whose bytes are no longer in
storage raises `UPLOAD_UNAVAILABLE` through the app's one notice channel — the
host, not CRAFT, is what would otherwise show the result, so silence would look
like success. See `src/utils/uploadToHost.ts`. No analytics event: what a host
does with its own recordings is the host's business.

**This message never broadcasts (ESCSUITE-176).** `uploadToHost()` returns
`'posted' | 'missing' | 'refused'`, and without a `?hostOrigin=` that
`parseHostOrigin()` can parse it returns `'refused'` and posts nothing at
all — `RecordingsListPanel` reports that with `UPLOAD_NO_HOST_ORIGIN`, the
same shape as `UPLOAD_UNAVAILABLE` for a missing blob but a different fact.
Unlike `sendToEditor`'s id-only post, there is no `'*'` fallback here: this
message carries the recording's **bytes**, and `'*'` would hand them to
whoever happens to be framing the page, possibly after the real host has
navigated elsewhere. The check runs after the missing-blob check (a byteless
row reports as missing whatever `hostOrigin` says) and before the take's other
parts are read, so a refused upload cannot cost CRAFT the companion reads.

The header's **"Open Editor" button is deliberately not routed through the
host**: embedded or not, it opens the editor itself. Only "Send to Editor" and
"Upload to host", which hand over one specific recording, become messages.

**`?hostOrigin=<origin>`**: when the host names its own origin on CRAFT's URL,
both host-routed posts — `SEND_TO_EDITOR` and `UPLOAD_RECORDING` — are
addressed to that origin instead of `'*'`. **It is required, not merely
recommended, for a host that offers "Upload to host"**: `SEND_TO_EDITOR`'s
`'*'` fallback hands an arbitrary framer an opaque id it cannot resolve (the
database is same-origin to CRAFT) and keeps that fallback, but
`UPLOAD_RECORDING` does not — see above. A deployment that ships this action
wants both — its own origin here, and `frame-ancestors` below. The value need
not be a bare origin (ESCSUITE-176): `parseHostOrigin()` accepts anything
`http:`/`https:` `new URL()` can parse and normalises it down to `.origin`, so
a trailing slash or a path — as naturally arrives from `location.href` or a
routed URL as a typed-by-hand origin would — is accepted rather than silently
degrading the post. Only a value `new URL()` cannot parse at all, one with an
opaque origin (such as a `data:` URL), or one on any other scheme (checked
explicitly rather than via the opaque-origin test alone, because Chromium
serialises a `file:` URL's origin as the non-opaque string `'file://'`) is
ignored, with one console warning; for `SEND_TO_EDITOR` that still means the
`'*'` fallback, and for `UPLOAD_RECORDING` it means the refusal above. The parser is
`parseHostOrigin()` in `@escapesuite/shared/config`, shared with ESCAPEARTIST.
It protects the **host's** deployment, not against being framed — a hostile
page that frames CRAFT also controls this URL. Refusing to be framed is
`Content-Security-Policy: frame-ancestors` on the deployment serving CRAFT. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a self-hosted or standalone build must set its own.

**Behaviour change for existing embedders**: CRAFT in *any* iframe now posts
`SEND_TO_EDITOR` rather than opening a tab. A host that previously relied on
the `window.open()` popup — including one that embedded CRAFT incidentally,
without meaning to integrate — will see no new tab and must listen for the
message and navigate to its own editor itself.

### Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` produces an offline single-file build for air-gapped use
- **The standalone `dist/` must be exactly `index.html`** — `apps/e2e/tests/standalone/
  dist-single-file.spec.ts` (ESCSUITE-153) asserts this for both CRAFT and ARTIST, and CRAFT
  has no `public/` directory for that reason: Vite's `publicDir` copies anything there into
  `dist/` verbatim, un-inlined, and `standalone-release.yml` attaches only the HTML to the
  release. A pre-existing `public/vite.svg` (unreferenced Turborepo-migration scaffold — this
  app's favicon is an inline `data:` URI in `index.html`) was deleted for exactly this reason;
  a future legitimate static asset (an icon, a `robots.txt`) needs a different route into the
  bundle, not `public/`

### Download Formats

**Three options per row, and they differ in kind rather than only in format.**

- **Download WebM** hands back the stored blob as `<name>.webm` with no conversion step.
  What is in storage is already seekable, either because the recorder wrote it that way or
  because it was repaired at save time (see "WebM Handling"), so the download is instant
  and is never gated on anything.
- **MP4** re-encodes that blob to H.264 + AAC in the page — `convertToMP4()` in
  `core/converter.ts`: WebCodecs decode and encode, Mediabunny mux,
  `requestVideoFrameCallback` frame capture (~real-time rather than the minutes a
  seek-based loop takes) and `MessageChannel` yielding so the conversion is not throttled
  in a background tab. Nothing leaves the machine; the offline build converts with the
  same code, which `apps/e2e/tests/standalone/craft.spec.ts` asserts alongside its
  no-off-origin-requests check. **On a take recorded as separate tracks it is a
  re-composite** — see "The composite MP4" below.
- **M4A** is the take's *audio alone*, AAC in an MP4 container (`audio/mp4`, `.m4a`) —
  `convertToM4A()`, the tail of `convertToMP4` and nothing else: extract with
  `decodeAudioData`, encode AAC through the shared `encodeAudioChunks()`, mux one audio
  track. No `<video>`, no playback, no canvas, no `VideoFrame`, which is what makes it
  cheap (`converter.perf.test.ts` pins zero of each) and what lets it be offered on a take
  with no picture at all. It exists because a mic-only take is already an audio recording
  and what is stored for it is an audio-only WebM: it plays, and it is not an "audio file"
  to most tools — and `convertToMP4` is no help there: since ESCSUITE-136 it refuses a take
  with no picture outright, with `MP4_NO_VIDEO_REASON` ("This recording has no picture and
  cannot be converted to MP4 — try M4A instead."), rather than configuring a 0x0 video
  encoder and failing with whatever the browser says.

`hooks/useMp4Download.ts` owns both conversions, and the rules are:

- **One at a time, across both formats.** They are equally CPU-bound and there is one
  processor, so a second start is refused while either runs and every other row's MP4 *and*
  M4A buttons go `disabled` with `MP4_BUSY_REASON`. The row that is running shows the
  format actually running — "Converting to M4A…", "Cancel M4A conversion of …" — because
  the progress row is shared and the labels are what tell them apart.
- **The slot is never held by a row that is gone.** Deleting the recording that is
  converting used to strand the slot: the row unmounting took the progress readout and the
  only Cancel button with it, while `useMp4Download`'s `converting` and `abortRef` stayed
  set, leaving every other row's MP4 and M4A buttons `disabled` with `MP4_BUSY_REASON` for
  however long the orphaned conversion still needed (ESCSUITE-103). `RecordingsListPanel`'s
  delete handler now calls `cancelMp4Download()` first, whenever the row being deleted is
  the one converting, before handing the id to the delete it was given — the honest reading
  of "the user asked for the take to go" rather than a disabled Delete button. A conversion
  that finishes anyway, racing the delete through the same gap the cancellation test below
  documents, does not download: `startMp4Download` re-reads the record with `getVideo(id)`
  right before naming a file after it, and a recording gone from storage is worth exactly
  as little as one that was aborted.
- **Say why, do not hide.** Where the codec probe says this browser cannot encode MP4, the
  button stays on screen, `disabled`, with the probe's own sentence in its `title` and in
  the one visible note the MP4 buttons' `aria-describedby` points at. That is the
  record button's shape (see "The record button only offers what it can deliver"), and the
  reasons live beside their gate rather than in `utils/notices.ts` for the same reason
  `NO_STORAGE_SPACE` lives in `recordReadiness.ts`: nothing has gone wrong yet.
- **The gate is a real codec probe, and it is asynchronous.** `probeMP4Support()`
  (`core/converter.ts`) checks the four WebCodecs globals and then asks
  `VideoEncoder.isConfigSupported()` and `AudioEncoder.isConfigSupported()` about the
  **same** configurations `convertToMP4` will configure — H.264 `avc1.640028` at a
  representative 1280x720 (5 Mbps, 30 fps) and AAC-LC `mp4a.40.2` (48 kHz, stereo,
  128 kbps). Both are declared once, in `mp4VideoEncoderConfig()` and
  `MP4_AUDIO_ENCODER_CONFIG`, and the conversion configures from them, so the probe cannot
  drift into asking a different question than the button is gating on; the unit test "asks
  about the same H.264 and AAC configuration the conversion configures" pins that. It never
  rejects — a probe that could not answer is a `{ supported: false }` with a reason — and it
  memoises for the life of the page, so the UI asks once.
- **Two encoders, two questions, two answers, two sentences.** `supported` (with `reason`)
  is the **H.264** verdict; `audio` (with `audioReason`) is the **AAC** verdict, and it is
  answered on its own whatever H.264 said. The two `isConfigSupported()` calls were always
  both made — until ESCSUITE-61 the folding threw the AAC answer away as soon as H.264
  failed, which disabled the M4A button in a browser that could have written the file and
  titled it with a sentence about video. So a browser with AAC and no H.264 now gets
  `{ supported: false, audio: true, reason: MP4_NO_H264_REASON }`: MP4 disabled, M4A
  offered. `reason` is absent whenever `supported` is true, `audioReason` whenever `audio`
  is true, and where the probe could not run at all — no WebCodecs, or
  `isConfigSupported()` threw — *both* carry the same sentence, because neither question
  got an answer. `useMp4Download`'s two gates read one field each and never the other's:
  that is the whole point of there being two.
- **No AAC encoder is not a refusal, because the conversion does not treat it as one.**
  `convertToMP4` asks about AAC itself, and where the answer is no it drops the audio and
  muxes the video anyway — a working, silent MP4 (`converter.test.ts`, "drops audio and
  warns when AAC is unsupported"). The probe therefore answers
  `{ supported: true, audio: false, audioReason: MP4_NO_AUDIO_REASON }` there — no `reason`,
  because nothing is wrong with the MP4: the button stays
  **enabled**, and the missing sound is said as a *note* rather than as a blocked reason —
  "MP4 will have no audio in this browser (no AAC encoder)" — before the minutes are spent,
  and again afterwards through the one notice channel as `MP4_SAVED_WITHOUT_AUDIO` ("Saved
  as MP4 — without audio: this browser has no AAC encoder"). Told twice, because the first
  telling is a choice and the second is about a file they now have. Only
  `MP4_NO_WEBCODECS_REASON`, `MP4_NO_H264_REASON` and `MP4_PROBE_FAILED_REASON` disable.
- **A blocked reason and a note are two different props.** `useMp4Download` returns both,
  and `RecordingsList` takes both (`mp4BlockedReason`, `mp4Note`): the reason disables the
  button and fills its `title`, the note is the paragraph under the library that the
  buttons' `aria-describedby` points at. They differ in two places — "still checking" blocks
  without being said out loud (a paragraph that appeared and vanished on every load would
  move the page for nothing; the button still carries it in `title`), and the silent-MP4
  warning is said out loud without blocking anything.
- **"Checking..." rather than a flash.** Because the answer is asynchronous it is asked at
  capability bootstrap (`useCapabilityBootstrap`, alongside capability detection and the
  storage estimate — never on the click path) and lands in `store.mp4Support`
  (`{ state: 'checking' | 'ready', supported, audio, reason?, audioReason? }`, the probe's
  own shape with `state` in front of it). While it is `checking` the
  button is `disabled` with `MP4_CHECKING_REASON`; it then goes enabled, or disabled with
  the probe's reason. It is never enabled first and taken away: offering a conversion and
  withdrawing it a tick later is worse than waiting a tick to offer it.
  `RecordingsListPanel` selects `mp4Support` and hands it to the hook, so `App` never
  subscribes to it and the render contract below is unchanged.
  `isMP4ConversionSupported()` remains as the cheap synchronous presence check, and
  `convertToMP4` keeps guarding itself with it — that guard is a defence, not the UI's gate.
- **The probe is necessary, not sufficient — it only asks about 720p.** It asks about one
  representative 1280x720 frame, while `convertToMP4` configures the recording's real width
  and height, and `avc1.640028` is High profile **Level 4.0** — good to 1080p30 and not to
  4K. So a browser that encodes 720p but not a 3840x2160 screen capture still gets an
  enabled button and a failure part-way, landing in the notice channel as
  `mp4ConversionFailed(...)` exactly as before this gate existed. That is strictly better
  than the old presence check and is not a complete answer; the real fix is a
  profile-fallback chain like ARTIST's (`apps/artist/src/core/exportMP4.ts` tries five profiles
  — High, Main, Baseline, then High and Main again at Level 5.1 for 1440p/4K — across two
  hardware-acceleration passes), which CRAFT does not have yet.
  A second, far more common instance of the same gap (ESCSUITE-136): H.264 also refuses an
  **odd-sized** frame outright (`NotSupportedError: H264 only supports even sized frames.`),
  and the probe cannot catch that for a specific recording either — 1280x720 is even.
  `compositor.ts`'s own scaling arithmetic (`Math.round(height * scale)`) produces an odd
  height on a display wider than 1280 whose scaled height does not land on a whole even
  number, which is the *default* resolution on both current MacBook Pro sizes (e.g. 14":
  1512x982 → 1280x**831**; 16": 1728x1117 → 1280x**827**), so a composited PiP take on either
  of those was failing 100% of the time before the fix. `convertToMP4` now derives
  `encodeWidth = width - (width % 2)` and `encodeHeight = height - (height % 2)` once, and
  uses that pair for the canvas, for `mp4VideoEncoderConfig()` and — on the composite path —
  for `overlayGeometryFor()`'s frame width, so the camera lands in the frame actually being
  written. Dropping at most one row and one column is invisible in the output.
- **A stored duration that is not a usable number falls back to the recorder's own, or
  refuses** (ESCSUITE-135). Every MediaRecorder take reports `video.duration` as `Infinity`
  at `loadedmetadata` until its container is repaired (see "WebM Handling" below) — and
  `Math.ceil(Infinity * 30)` is `Infinity`, which used to make `captureFramesViaPlayback`'s
  `ended` handler loop forever, synchronously, encoding the same last frame past any bound:
  the tab stopped responding, Cancel became unreachable because the one conversion slot was
  held by a hung event handler, and the encoder queue grew until the tab was OOM-killed.
  `useMp4Download` now passes `record.metadata.duration` — already in hand from the
  `getVideo()` read it does before converting — into `convertToMP4` as `knownDuration`;
  `convertToMP4` uses `video.duration` whenever that is itself finite and positive (a stored
  duration can be *shorter* than the real playback length) and falls back to `knownDuration`
  otherwise, refusing with `MP4_NO_DURATION_REASON` before building a single encoder if
  neither is usable. The `requestVideoFrameCallback` capture path also now finishes as soon
  as it has captured its derived frame count, rather than waiting on the video's own `ended`
  event — which the rAF fallback already did, and which matters here because a `knownDuration`
  shorter than the container's real length would otherwise leave the capture waiting on an
  event that might arrive much later, or not at all while anything is watching.
- **Every encoder a conversion builds is released in one place, and a codec that dies says
  so** (ESCSUITE-74). `conversionEncoders()` in `core/converter.ts` is both halves of that,
  because they are one problem seen twice. A `VideoEncoder`/`AudioEncoder` is a hardware
  encode session and `close()` is the only way to give one back, so each conversion
  registers every encoder it constructs and its **one `finally`** closes the ones still
  open — guarded on `state !== 'closed'`, because a codec that reported an asynchronous
  failure closed itself and the real API throws `InvalidStateError` on a second `close()`.
  The `close()` calls used to sit on the success path after the flush, which a cancellation
  or a failure part-way never reaches. And an asynchronous failure arrives through the
  encoder's `error:` callback, which is on **no await path at all**: that callback used to
  only `console.error`, so the conversion kept handing frames to a dead encoder — whose
  `encode()` throws from inside a `requestVideoFrameCallback`, where nothing catches it, so
  the capture promise never settled, the conversion hung holding every other encoder open
  and the row never returned to idle. The callback now records the codec's error and aborts
  the work in flight; the conversion rejects with **the codec's own error** (so the notice
  reads `Conversion failed: <what the encoder said>`), and `throwIfFailed()` before
  `output.finalize()` covers the gap between the audio pass's every-hundredth-chunk abort
  check and the mux — a file written out of a dead encoder's packets is a truncated file
  handed over as a finished one. A **cancellation outranks a codec failure**: the user asked
  for no file, so a cancel that races an encoder death still rejects with
  `ConversionAbortedError` and still raises no notice. The accounting is pinned exactly (built
  == released, none closed twice) for the success, cancellation and encoder-failure outcomes
  of all three conversions — plain MP4, composite MP4 and M4A — in `converter.perf.test.ts`, and the WebCodecs double's `close()` is strict
  about a second close the way the real API is — which is the tripwire ESCSUITE-66 had to
  leave lenient, because the converter did not yet meet the law.
- **A throw while reading frames fails the conversion instead of hanging it** (ESCSUITE-78):
  every capture callback in `captureFramesViaPlayback` — the `requestVideoFrameCallback`, the
  `requestAnimationFrame` fallback and both `ended` handlers — runs inside `guarded()`, which
  hands a synchronous throw (a `drawImage`/`drawOverlay` from a dead element, a `VideoFrame`
  built on a zero-sized canvas) to the same `fail()` the abort path takes, so the conversion
  rejects with that error and releases every encoder rather than sitting on "Converting…" for
  the life of the tab, which is what the browser swallowing the throw used to leave behind.
  A `play()` the browser **refuses** goes out by that same `fail()` door since ESCSUITE-81 —
  it used to reject the capture directly, which settled the conversion but left the frame
  callback registered on the line above it, the abort listener attached, the element unpaused
  and, on a composite, the camera element still playing with nothing said about the picture it
  never contributed.
- **Cancelling is not failing.** Cancel aborts through an `AbortSignal`; the converter
  rejects with `ConversionAbortedError`, the row returns to idle, no file is written and
  **no notice is raised**. Any other rejection becomes `mp4ConversionFailed(message)` in
  the header's live region — the app's one notice channel, unchanged — and the WebM
  download is unaffected either way. A conversion that *succeeds* clears the channel
  (`setNotice(null)`), because an earlier "MP4 conversion failed" is no longer true; that
  clears whatever the region held, which is the price of having exactly one.
- **Abort does not always reject, so the hook checks the signal again.** `convertToMP4`
  checks the signal while it encodes, but there is none between the last frame and the
  muxer's `finalize()` — and on a take with no audio, none after frame capture at all — so
  a late cancel can come back as a finished MP4. `useMp4Download` therefore re-reads
  `controller.signal.aborted` after the `await` and returns before analytics and the
  download, rather than trusting the rejection. The unit double that always rejects on
  abort is exactly what would hide this, so one test makes it *resolve* after aborting.
- **Unmounting aborts.** The hook's one effect is a cleanup: `abortRef.current?.abort()`.
  Without it an unmount mid-conversion leaves the whole CPU-bound encode running behind a
  screen that no longer exists and then hands the user a file from it. In the shipped app
  `App` renders the panel unconditionally, so this fires at page teardown — it is a
  lifecycle guarantee, not a hot path.
- **Where the state lives is the performance contract.** `convertToMP4` reports progress
  continuously and the only pixels it moves are one row's bar, so the state is held in
  `components/RecordingsList/RecordingsListPanel.tsx`, one level below `App` — exactly as
  `SourceTogglesPanel` holds the `audioLevels` subscription. `App` never sees it;
  `App.mp4rerender.test.tsx` counts a progress tick as 0 `App` renders and 1 library
  render, and `App.rerender.test.tsx` is left alone to count the level push.

`RecordingsList` itself stays driven by props alone (`mp4Converting`, `mp4BlockedReason`,
`m4aBlockedReason`, `onDownloadMp4`, `onDownloadM4a`, `onCancelMp4`), which is what its own
test asserts.

**What is different about M4A**, and only that:

- **AAC is a hard requirement, where for MP4 it is only a preference.** `convertToMP4` drops
  the audio and muxes a silent video when the browser has no AAC encoder; there is no silent
  M4A worth writing, so `convertToM4A` refuses. The button follows: `m4aBlockedReason` is
  non-null whenever `mp4Support.audio` is false, carrying the probe's *own* sentence about
  AAC (`audioReason`, i.e. `MP4_NO_AUDIO_REASON`) so the reason on the button and the
  message from a failed conversion are one wording. It never reads `reason`: that is the
  answer about H.264, and this conversion encodes no video (ESCSUITE-61). The same browser
  therefore gets an enabled MP4 button with a note and a disabled M4A button — the two
  gates are separate props for exactly this reason — and a browser with the opposite gap
  gets a disabled MP4 button and an M4A that works.
- **A take with no audio disables it, and that gate lives in the component.** Everything
  else about the conversion is a fact about the browser and is decided in the hook; whether
  *this recording* has sound is a fact about the row, so `RecordingsList` reads
  `recording.hasAudio` and falls back to `NO_AUDIO_TRACK_REASON` ("This recording has no
  audio") when nothing app-wide is blocking. `convertToM4A` refuses the same case again with
  `M4A_NO_AUDIO_MESSAGE` — the button is the courtesy, the converter is the defence.
  (`Recording.hasAudio` is truthful across a reload since ESCSUITE-60: `buildSourceVideo`
  writes `hasAudio` into the stored `SourceVideo` from the same expression the list entry
  gets — both are handed the one answer `useRecordingSave` computes — and
  `loadRecordings()` reads it back as `m.hasAudio ?? true`. The `?? true` is for recordings
  saved *before* that field existed — they keep the answer they used to get, because
  demoting a take that did have audio would cost it its M4A button for good. That
  expression is `captured.micAcquired || (systemAudioEnabled && systemAudioShared)`: neither
  half is the toggle, because a toggle only *asks*. ESCSUITE-62 fixed the system half — the
  config alone said yes to a take whose share picker cleared the system-audio tick box, which
  is a take with no sound in it at all — and ESCSUITE-70 the microphone half, which said yes
  to a take on a machine with no microphone (`acquireStreams` back with `mic: null`), leaving
  the M4A button enabled on a promise rather than a track. It is still the streams' answer
  rather than the blob's — reading the saved file would mean a decode on the save path, and
  `convertToM4A`'s own refusal is still the defence behind the button.)
- **No new notices and no new analytics event.** Success clears the channel and failure
  raises `mp4ConversionFailed(message)`, whose wording is now the format-neutral
  "Conversion failed: …" because one code path serves both. The download is counted as
  `Recording Downloaded`, like the other two.

**Follow-up, inherited from `core/converter.ts` rather than introduced here:**

- All three downloads share one analytics event (`Recording Downloaded`), so the
  minutes-long conversion cannot be told from the instant download.

**The composite MP4** (ESCSUITE-14 decision 3). A take recorded as separate tracks is two
video files, and MP4 is the format that puts them back together: one file whose picture is
the screen with the camera drawn into the corner it was recorded in — position, size **and
shape**, the circle or rounded rectangle clipped exactly as the live compositor clips it.
The screen-only MP4 is deliberately not offered as a second option; a user who wants one
part alone downloads its WebM from that part's own row.

- **The geometry is one function, shared with the live compositor.** `drawOverlay()` in
  `core/overlayGeometry.ts` was `Compositor.drawWebcamOverlay`, moved out body-for-body (four
  renames, and one `this.webcamVideo` narrowing guard dropped as unreachable), and the
  compositor now calls it. So the numbers `compositor.test.ts` pins for the preview are the
  numbers a downloaded MP4 gets, and a change to one is a change to both — which was the whole
  point of moving it: two copies of the arc, the centre-crop and the two clip paths would be two
  places for a rounding difference to live, and the difference would only ever have been visible
  in a file somebody downloaded. `overlayGeometry.test.ts` pins the same values a second time so
  the shared function is red on its own. Nothing mocks it.
- **The inset is scaled to the frame, and it reproduces the inset that was on screen.**
  `webcamSize` is a fraction of the width and reproduces itself at any resolution; the 20 px
  padding does not. The live compositor caps its canvas at `COMPOSITOR_MAX_WIDTH` (1280)
  **only when the source is wider**, so what it draws is a flat 20 px of the *preview* canvas —
  20 px of the raw screen below the cap, and 20 px of a 1280-wide canvas above it. A
  separate-tracks take records the **raw** screen, so `overlayPaddingFor(frameWidth)` is
  `20 × frameWidth ÷ min(frameWidth, 1280)`: flat 20 at and below the cap, 30 at 1920, and at
  every width the same inset the user watched. A frame with no width answers
  `DEFAULT_OVERLAY_PADDING` rather than handing NaN coordinates to a canvas. (ARTIST's slice-2
  `utils/overlayPlacement.ts` reads the cap as unconditional — `20/1280 × frame.width`, so 10 px
  at 640 — and therefore agrees with this at and above 1280 and **disagrees below it**. ARTIST is
  out of this slice's scope; the divergence is ESCSUITE-69 item 4.)
- **The border and the corner are scaled to the frame too (ESCSUITE-144), the same way the
  inset is.** `overlayGeometryFor()` used to hand `drawOverlay` the flat module constants
  (`OVERLAY_BORDER_WIDTH` 3, `OVERLAY_CORNER_RADIUS` 8) unscaled, so a composite drawn from a
  raw capture wider than the 1280 cap showed a border and a corner at two thirds the fraction
  of the frame the live preview — and ARTIST's own `strokeForPlacement` /
  `maskForPlacement`, which already assumed craft scaled them — both agree on. `OverlayGeometry`
  now carries `borderWidth` and `cornerRadius` alongside `padding`, both filled by the shared
  `scaleToFrame(n, frameWidth)` helper `overlayPaddingFor` is written in terms of, and
  `drawOverlay` reads them instead of the constants. `Compositor` fills its own config with the
  two constants unscaled — its canvas is always at or below the cap, where `scaleToFrame` is the
  identity, so the live preview is byte-identical. `apps/artist/src/utils/overlayPlacement.test.ts`
  pins the two sides' numbers together at 1280, 1920 and 3840 wide — all at or above the cap.
  Below it, the border now agrees everywhere (craft is the identity there, and
  `strokeForPlacement` reads `max(frame.width, 1280)`), but the corner still does not:
  ARTIST's `maskForPlacement` is the unconditional `frame.width × 8/1280`, so a 640-wide
  separate-tracks take is 8 px in craft's preview and MP4 and 4 px once ARTIST places it — the
  same below-the-cap family as the inset's divergence just above, and the same ESCSUITE-69
  item 4 this slice did not touch.
- **Its audio is the primary's own track, and that is already the mix.**
  `WebCodecsRecorder` writes the microphone and system companions as a *second tap* on tracks
  the mix is already reading rather than diverting them, so the primary's audio track is the
  whole mix. The composite reads no audio from any part — one `AudioContext`, one
  `decodeAudioData`, of the primary, which `converter.perf.test.ts` pins — and **M4A on a
  separate-tracks take is unchanged, in bytes**: it was already the whole take the day slice 1
  shipped, and `convertToM4A` is untouched by this slice. The hook asks for no companion at all
  for an M4A, which its own test pins.
- **The camera's container is read before the first frame, and in parallel with the screen's.**
  The second `<video>`, its object URL and its `loadedmetadata`/`error` handlers are created in
  one synchronous step, so that header read is in flight while the conversion reads the screen's
  own metadata and extracts its audio. It is awaited once, just after the frame count is known,
  behind a `Loading the webcam track…` progress report at 3%. The promise resolves with
  `Error | null` rather than rejecting: a container that will not decode is a decision this
  function makes (draw the screen alone), not an error that escapes.
- **Sync is a shared start, not a seek per frame.** Both `<video>` elements play at 1× from
  the same moment and each captured frame draws whatever the camera element is currently
  showing. The two pictures stay within the two elements' start-up latency of each other —
  both `play()`s are issued from one synchronous block and nothing re-seeks either element
  afterwards, so that difference is constant for the run rather than accumulating, and the code
  bounds it no more tightly than that. A seek per frame is the minutes-instead-of-real-time
  cost `captureFramesViaPlayback` exists to avoid. `startOffset` shifts the camera's time base
  by deferring its `play()` until the screen has played that far — it is 0 for every take
  this recorder writes (one `start()`, one clock) and is honoured because it is stored per
  part. The per-frame guard is `overlay && overlayPlaying && readyState >= 2`, and the middle
  term is load-bearing: `preload='auto'` gets the camera element ready long before anything
  plays it, so readiness alone composited its frozen **first frame** over every screen frame
  before the offset — the exact thing the offset exists to prevent. The `play()` that a cancel
  interrupts rejects, and that rejection is swallowed, because cancelling is not a failure.
- **A camera part that cannot be used costs the overlay and not the file.** Three things reach
  that: its bytes are gone or the read itself failed (`loadWebcamCompanion` answers
  `'unavailable'`, and a read that *throws* is caught in the hook as that same answer — a
  companion never costs the primary, the ruling `uploadToHost` already takes); its container
  will not decode at all (`convertToMP4` warns and calls `onCompanionSkipped`); or its header
  parses and not one frame of it ever decodes, which no load can see — so the composite loop
  **counts the frames the overlay drew** and reports zero at `cleanup()`. That count is the only
  honest question there: `loadedmetadata` fires for a container whose pictures never arrive, and
  the element's later `error` resolves an already-settled promise. The two reports cannot
  double up — a load that failed builds no overlay to count. Either way the
  conversion **succeeds** with a screen-only MP4 — refusing after minutes of encoding would
  leave the user with nothing — and the notice channel says
  `MP4_SAVED_WITHOUT_WEBCAM` ("Saved as MP4 — without the webcam: its own track could not be
  read"). It outranks `MP4_SAVED_WITHOUT_AUDIO` when both are true, because the silent-MP4
  warning is also said *beforehand*, under the library, where a camera loss cannot yet be
  known.
- **Signature.** `convertToMP4(webmBlob, onProgress, signal?, composite?)` — a fourth
  *optional* argument (`CompositeOptions`: the `CompositeCompanion` and an optional
  `onCompanionSkipped`) rather than a second exported entry point, so every existing call is
  still three arguments, the plain path's tests and its per-frame ceilings are byte-unchanged,
  and there is one encode loop instead of two. The plain path already drew through a canvas, so
  the composite adds no canvas stage — one canvas, not one per layer. Its own per-frame ceilings
  (the appended `describe` in `converter.perf.test.ts`) are exact where they are laws — frames
  created == closed == encoded, one `flush`, two `drawImage` per frame and not three, one
  balanced `save`/`restore`, one `clip`, no `fillRect` (the screen frame covers the canvas), one
  `AudioContext` opened and closed — and 2× the measured 11 canvas calls where it is a cost,
  with the measurement and its date in the comment beside it. (The live compositor measures 12
  for the same overlay: it clears to black first, and the composite has no reason to, because the
  screen frame covers the canvas.)
- **Benchmarked separately.** `craft-composite-mp4-conversion` (`apps/e2e/tests/perf/craft-recording.spec.ts`)
  converts a separate-tracks take through the same code the plain arm measures; the gap
  between the two arms' `taskMsPerFrame` is what one overlay costs. Its tripwire is
  `videoDraws === 2 × framesEncoded`. First numbers in
  `docs/performance/2026-09-17-craft-baseline.md`.

**Removed (ESCSUITE-85):** the compatible-WebM path (`remuxToWebM`, `isWebMRemuxSupported`, a
VP9 + Opus re-encode into a fresh container) was present, tested and called by nothing from the
MP4 restore (#389) onward; its job — a seekable copy of MediaRecorder output — is done at save
time by the `webm-duration-fix` repair, and 'plays everywhere' is the MP4 download. Deleted
2026-09-26 on the operator's decision rather than wired as a fourth download.

### A take can be several files

**Storage.** `SourceVideo` (`packages/shared/src/types`) carries five optional fields for this
(ESCSUITE-14): `takeId`, `role: 'screen' | 'webcam' | 'mic' | 'system'`, `startOffset` (seconds),
`hasWebcam`, and — on the primary only — `overlayPlacement: { position, size, shape }` copied from
the `RecordingConfig` at save time, which is the geometry ARTIST seeds the webcam clip's
transform from (slice 2) and the composite MP4 draws through (slice 4, see
"The composite MP4" under "Download Formats"). All optional, so
**`DB_VERSION` stays 1** and a take stored before this keeps behaving as a single file. **The take
is named by its primary**: the primary's `takeId` is its own id, so grouping is one equality and
the cascade delete is `takeId === deletedId` minus the row already being deleted. A plain take is
stored with *no* companion keys at all — absent, not `undefined`, because `buildSourceVideo`
spreads each one in only when it is given it — so a reader cannot mistake one for the other. `hasAudio` is per part, and since slice 3 it genuinely differs across one take: the primary
carries the mix (`true` whenever the take had any sound), the webcam part is `hasAudio: false`
because the whole mix stays on the primary output, and each audio part is `hasAudio: true` with
`hasWebcam: false`. An audio part is stored as **audio** — `mediaType: 'audio'`, `frameRate: 0`,
`width`/`height` 0, `mimeType 'audio/webm'` — which is the same shape ESCAPEARTIST's own audio
importer writes (`core/videoProcessor.ts`), so a part that arrived from a recording is
indistinguishable from one that arrived from a file everywhere the editor branches on
`mediaType`. It gets **no thumbnail**: there is nothing to decode, so `getThumbnail` resolves
`undefined`, the library draws its own empty placeholder, and ARTIST already treats a missing
picture as cosmetic. Its duration is the recorder's own, which is honest by construction — one
recorder, one clock, one start, one stop. Since ESCSUITE-143 the *primary* of a take recorded with
no picture at all — Screen and Webcam both off — is stored the same way, with no role and no
companions: `mediaType: 'audio'`, `frameRate: 0`, 0x0, no thumbnail, the recorder's own duration
(see "the same boolean" under "Choosing a recorder"). The one field that does *not* match a
companion's is `mimeType`: this take still goes through MediaRecorder, whose container mime is
`getSupportedMimeType()` — `video/webm;codecs=vp9,opus` (`core/permissions.ts`) — whatever tracks
are actually in the stream, where a mic/system companion is written by Mediabunny as `audio/webm`.
Harmless — nothing in either app branches on `mimeType` to decide audio-vs-video, ARTIST reads
`mediaType` — but worth naming so "stored the way a companion already is" is not read as true of
every field.

Each part's stored `name` is the take's name with its part named: `Recording <date> — webcam`,
`— microphone`, `— system audio`. That is what its own WebM download is called and what ARTIST
shows as the source's name. Those nouns, and every sentence that can be said about a part going
wrong, come from `utils/companionParts.ts`.

`hasWebcam` is the field that retired the `hasWebcam: false // TODO` in `loadRecordings`: nothing
stored said whether a take had a camera in it. It is written from the config by `buildSourceVideo`
exactly as `hasAudio` has been since ESCSUITE-60, and read back as `m.hasWebcam ?? false` for
records saved before it. Nothing is gated on it, so the fallback costs a legacy row nothing.

**Library.** `loadRecordings` mints one thumbnail object URL per recording, and revokes the
outgoing set once the read has actually resolved and the new set exists to replace it
(so a failed reload does not revoke URLs the library is still showing); `removeRecording`
revokes the one URL a deleted recording carried, the same way (ESCSUITE-103) — neither used
to, and a URL outlived the recording it named for the life of the tab. `loadRecordings`
orders through `orderTakes` (`utils/takeOrder.ts`): newest take
first, a take's companions directly under its primary (placed by the primary's date, never by
their own — every part of a take is saved with one `now` and the companions are written first, so
by date alone a webcam row would float above the screen row it describes) and **ranked by role**
rather than by date — webcam, then mic, then system, with an unrecognised role last — because
three companions sharing one millisecond would otherwise come out in whatever order storage
returned them, which is uuid order. Date is the second key and the id the third, so the answer
never depends on what the engine's sort happened to do. An orphan companion is still shown,
because a row nobody can see is a file nobody can delete. Within the session that recorded it the
same order comes out of the save path instead: the companions are `addRecording`ed **first and in
reverse role order**, and `addRecording` prepends, so the list ends up
`[primary, webcam, mic, system]` either way.

Every companion row's meta line is prefixed with the track it is: `Webcam track • `,
`Microphone track • `, `System audio track • `. Each is playable, WebM-downloadable and deletable
on its own, and carries **no** MP4 and **no** M4A — not even M4A on an audio row, because that
row's own bytes are already an audio file and a per-part conversion would be the take's own
composite pretending to exist. "Open in Editor" on any row hands over `takeId ?? id`, i.e. the
take — unless a row's `takeId` names no row actually in the list (ESCSUITE-145): the primary can
be gone, deleted from ARTIST's media library in another tab, while an orphaned companion is still
shown here (a row a user cannot see is a file they cannot delete). `RecordingsList` checks the
whole list rather than trusting a row's own `takeId`, and an orphan falls back to its own id — the
same degradation `takeImport` already gives a non-primary id: imported and placed alone. Play and
Download on any row whose bytes are no longer in storage do something rather than nothing — see
`RECORDING_UNAVAILABLE` under "Errors and notices" (ESCSUITE-146), which is not specific to a
companion row. Deleting the
primary deletes its companions (`useRecordingLibrary.handleDeleteRecording`);
deleting the companion alone **demotes the primary by construction** — its own `takeId` stays,
and with nothing grouped under it the row renders as a plain take, so no stored metadata is
rewritten on a delete.

**MP4 and M4A cover the whole take.** MP4 re-composites it (see "The composite MP4" under
"Download Formats") and M4A always did, because the mix is on the primary. The interim note
that said otherwise — `SEPARATE_TRACKS_MP4_NOTE`, "MP4 and M4A cover the screen track only
— the webcam track is not included yet." — is **retired**, along with the per-row
`aria-describedby` target it needed and the per-render set of takes-with-a-camera that was its
only reader, because both halves of that sentence became false. The conversion buttons are
described by the app-wide `mp4Note` alone again (`MP4_NOTE_ID`, one id rather than a
space-separated list). The one case where a file really is missing the camera is a fact about a
file the user already has and goes through the notice channel as `MP4_SAVED_WITHOUT_WEBCAM`, not
as a standing claim on a row. Its four tests were **converted rather than deleted**: three assert
there is no such note on exactly the rows that used to carry one, and the one that pinned two
`aria-describedby` ids now pins the single id. Nothing about the buttons' placement changed: MP4
and M4A are still the take's downloads and still live on the primary row only, and every part is
still reachable on its own through Download WebM on its row.

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
have. A part whose bytes are gone is left out rather than listed empty. The primary's bytes are
read **once** — `uploadToHost` already holds them to decide there is anything to post at all, and
hands them down as `loadTakeParts(id, { primaryBlob: blob })`, so `payload.blob` and `parts[0].blob`
are one `Blob` object in two places rather than two deserialisations of the take's largest file.
A `loadTakeParts` that throws downgrades the message to the one slice 1 sent, with a
`console.warn` and no notice: a companion never costs the primary the upload the user asked for.
The companion rows keep their Upload button: redundant for a host that adopted `parts`, and the
only way one that has not can be handed a single part. The adoption note for embedders is in the
root `CLAUDE.md` Integration API and in `apps/artist/src/utils/integration.ts`; the ESCAPEPOD
upstream-requests page has its own row.

### WebM Handling
- MediaRecorder produces WebM without proper seek metadata
- `webm-duration-fix` library adds Duration, SeekHead, and Cues elements
- Thumbnails captured from live preview (more reliable than from blob)
- Metadata extraction has fallbacks for problematic WebM files
- **The repair runs on MediaRecorder output only**, once, at save time.
  `useRecordingSave` branches on `recorderTypeRef`: a `'webcodecs'` take is written through
  untouched, because `WebCodecsRecorder` muxes with Mediabunny, which already emits Duration
  and Cues. Everything else — composited PiP takes, audio-only takes, and any browser without
  WebCodecs
  — goes through `fixWebMMetadata()` first. Either way what reaches storage is seekable, but
  only one of the two paths repairs anything; a take that will not scrub is a question about
  *which recorder produced it* before it is a question about the repair
- The playback dialog fixes nothing either. It passes the saved duration to `VideoPlayer` as
  `knownDuration`, which the player falls back to when `video.duration` is `Infinity` or 0
- A repair that fails still saves the raw blob, and raises the `NOT_SEEKABLE` notice. That
  path exists only for MediaRecorder takes, for the same reason
- **The import of `webm-duration-fix` is resolved by hand**, and has to be. The library is
  CommonJS: `lib/index.js` ends `exports.default = fixWebmDuration` and sets `__esModule`, so
  what a default import binds to is a toolchain decision — esbuild's `__toESM(mod, 0)` (Vite 7
  and earlier) honours `__esModule` and binds the **function**, while Vite 8, which moved both
  dep optimization and the build to Rolldown, follows Node and binds the whole **`module.exports`
  object** (its `legacy.inconsistentCjsInterop` flag is the opt-out, documented against
  "pre-Vite 8" behaviour — i.e. this arrived with the **7 → 8 major**, commit `7c40710`,
  2026-03-14, first released here as craft 2.1.0; 8.3.0 is merely what it was found and fixed
  under, so every craft release 2.1.0–2.5.1 shipped it). It turned every MediaRecorder save into
  `TypeError: fixWebmDuration is not a function`, caught by `useRecordingSave`, `NOT_SEEKABLE`
  raised and the take stored unrepaired — in the dev server *and* in the shipped build; takes
  already saved that way are not repaired retroactively. `converter.ts`'s exported
  `resolveFixWebmDuration()` unwraps **one** level of `default`, which is every shape a *default*
  import produces; it is not a general interop shim (Vite's namespace helper double-wraps, so an
  `import * as` here would need a loop). No unit test can see the problem: they all
  `vi.mock('webm-duration-fix')`, and vitest's own pipeline resolves the default the old way.
  The guard is therefore a browser test — `apps/e2e/tests/escapecraft/pip-seekable.spec.ts`
  against the dev server and `apps/e2e/tests/production/pip-seekable.spec.ts` against the
  combined `dist/` — which records a real **composited PiP** take (the only mode that reaches
  MediaRecorder in Chromium, and still what a PiP take is unless the separate-tracks toggle is
  on) and requires the stored blob to report a finite `duration` in a `<video>`.
  `src/core/converterInterop.test.ts` is the one suite that imports the real module, and pins
  both arms of the resolver

### Analytics
- Vercel Analytics via `@vercel/analytics`, **in the hosted build only**. The standalone
  build ships no analytics runtime at all: `BUILD_MODE === 'saas'` gates both `trackEvent()`
  and the `<Analytics />` mount in `packages/shared`, and since `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  instead of shipping it inert. `apps/e2e/tests/standalone/craft.spec.ts` holds it: it
  records a real take — so `Recording Started` and `Recording Completed` genuinely reach
  `trackEvent()` — and then asserts no `window.va`, no queue and no injected script
- `<Analytics />` is mounted by `bootstrapApp()`, not by `src/main.tsx` directly
- Custom events in `src/utils/analytics.ts`:
  - `Recording Started`
  - `Recording Completed` (with duration)
  - `Recording Sent to Editor`
  - `Recording Downloaded`
  - `Recording Deleted` — `useRecordingLibrary`'s `handleDeleteRecording`, once per row the user
    deleted (the primary, or a companion deleted on its own), regardless of how many companions
    the cascade took with it; not reported when the deletion itself fails (ESCSUITE-31)

### Testing

Vitest + Testing Library in jsdom, with a v8 coverage floor enforced by `pnpm test:coverage`
(see the root `CLAUDE.md`'s coverage policy for the numbers and the rule that they only go up).

**Tests never mock the module under test.** Doubles stand in for boundaries the browser owns —
screen and camera capture, canvas, WebCodecs, Web Audio, muxing, IndexedDB — never for
CRAFT's own orchestration. A double records what it was asked to do and the test asserts on
the outcome, not on the double.

- **`src/test/doubles/`** — one file per browser API jsdom does not implement, each with a
  header saying what it stands in for and why: `mediastream.ts` (`MediaStream` /
  `MediaStreamTrack`, backed by a real `EventTarget` so an `ended` listener genuinely fires,
  plus `MediaStreamTrackProcessor`), `recorder.ts` (the recorder `core/recorder-factory`
  builds, keeping the same surface over MediaRecorder or WebCodecs), `canvas.ts` (a recording
  `CanvasRenderingContext2D` plus `toBlob`), `video.ts` (the `<video>` elements the code
  creates, which jsdom never loads), `audio.ts` (`AudioContext` and the nodes the recorder and
  converter build on it), `webcodecs.ts` (`VideoEncoder`, `AudioEncoder`, `VideoDecoder`,
  `VideoFrame`, `AudioData`), `mediabunny.ts` (the muxer, recorded rather than run) and
  `browser.ts` (the prototype-level gaps `installBrowserStubs()` fills — media playback,
  navigation from an anchor click, `window.open`).
- **`src/test/appDoubles.ts`** — the collaborator modules the `App.*.test.tsx` files hand to
  `vi.mock`: the recorder factory, permission overrides, thumbnail generation, conversion,
  "send to editor" and analytics. It imports no application code at runtime, so a `vi.mock`
  factory can pull it in while the module it stands in for is still being mocked.
  `resetAppDoubles()` clears every recorded call between tests.
- **`src/test/appHarness.tsx`** — the shared App setup: **`resetRecorderStore(config?)`** puts
  the Zustand store back to a freshly loaded app with every capability present (a missing
  capability is something a test says explicitly), **`renderApp()`** mounts `App` and settles
  its mount-time async work inside `act()`, `flush()` lets promise chains — IndexedDB included
  — settle on a real macrotask even under fake timers, `screenStreamDouble()` /
  `webcamStreamDouble()` / `micStreamDouble()` build the capture streams a take needs, and the
  `installRafDouble()` family drives the PiP compositor's animation frames by hand. It also
  re-exports `installBrowserStubs()` from `doubles/browser.ts`, because every App suite reaches
  for it through this module.
  `flush(rounds = 3)` runs a **fixed** number of real `setTimeout(0)` turns — right for settling
  a render pin (`App.rerender.test.tsx`, `App.mp4rerender.test.tsx` count exactly how many turns
  a given change costs, which is the one place a fixed count is the thing under test, and both
  files stay byte-for-byte on `flush()`'s fixed shape) and wrong for anything whose depth isn't
  fixed. The save chain is the sharpest example: `fixWebMMetadata` → `extractVideoMetadata` →
  `generateThumbnail` → `storeVideo` → `storeThumbnail` runs through two real fake-indexeddb
  transactions, and under load three rounds is not a promise the chain drains in —
  ESCSUITE-114 saw it fail 18 assertions at once in `App.saving.test.tsx`, green in isolation
  and in the runs either side of it. `renderApp()`'s own `flush()` carries the same risk on
  every mount, not just a save: `App` mounting kicks off `useCapabilityBootstrap`'s
  `loadRecordings()`, which is `getRecordingsMetadata()` plus one `getThumbnail()` per stored
  recording — real fake-indexeddb transactions again, one more of them for every recording a
  test has seeded. A call waiting on an *outcome* — a saved row, a deleted one, a download, a
  notice, the library itself — uses `@testing-library/react`'s `waitFor(() => expect(...))`
  instead, polling the real DOM until the assertion holds or its own timeout passes.
  `App.saving.test.tsx`, the delete/MP4 cases in `App.library.test.tsx`, and
  **`renderAppWithLibrary(expectedCount)`** — `renderApp()` plus a `waitFor` on the store
  holding that many `recordings`, used by every test in `App.library.test.tsx` that seeds
  IndexedDB before rendering, since `renderApp()` itself is left exactly as it is — are the
  ones that do; a `flush()` call elsewhere in the suite that isn't behind one of those settles a
  mocked capture promise or a keyboard-shortcut dispatch, neither of which has an unbounded
  chain behind it.

  **Why `waitFor` is safe here even though `setInterval` is faked:** every suite that fakes
  timers does it narrowly — `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })`,
  for the countdown and duration tickers only — and leaves `setTimeout` **real**. `waitFor`'s
  50 ms poll interval is dead weight under that (jsdom's `MutationObserver`, which runs on real
  microtasks regardless of any faked timer, is what actually re-checks the assertion after every
  DOM mutation), but its 1000 ms give-up timer is a real `setTimeout` and does fire — a
  deliberately wrong expectation was confirmed to fail in ~3 test-seconds with the assertion's
  own line, not hang. This is load-bearing: widen that `toFake` list to include `setTimeout` in
  a suite that also uses `waitFor`, and every converted call hangs to `testTimeout` instead of
  failing with a useful message.
- **`*.perf.test.ts` files are ceilings, not benchmarks.** `core/compositor.perf.test.ts`,
  `core/converter.perf.test.ts`, `core/webcodecsRecorder.perf.test.ts` and
  `core/recorder.perf.test.ts` count what a frame, a take or a second of monitoring costs —
  canvas calls, emissions, typed arrays, `VideoFrame`s created versus closed, `encode`/`flush`
  calls — through the same doubles the behaviour tests use. Counts, not milliseconds, so they
  are enforced in CI like any other test. The rule (2x the measured value rounded up, the
  measurement and its date in a comment, conservation laws exact, ceilings only ever lowered)
  is in the root `CLAUDE.md`.
- **The milliseconds come from `pnpm perf`, not from here.** `apps/e2e/tests/perf/
  craft-recording.spec.ts` records real takes in Chromium and reports what they cost in
  time: `craft-screen-recording` (a screen take through `WebCodecsRecorder`),
  `craft-pip-recording` (a composited PiP take through the `Compositor` into MediaRecorder,
  whose rate is `compositedFps` because its encoding is off the main thread),
  `craft-separate-tracks-recording` (the same take with the separate-tracks toggle on: two
  `VideoEncoder`s on one clock, split by encoder identity into `screenFramesEncoded` /
  `webcamFramesEncoded`, with the compositor drawing the preview only — plus, since slice 3, a
  tripwire that exactly **two** `AudioEncoder`s ran, the mix on the primary and the microphone
  companion, and a wait for the take's **three** library rows; system audio is off by default and
  the benchmark never clicks a source toggle, so there is no fourth part there) and
  `craft-mp4-conversion` (`convertToMP4` driven through the row's own MP4 button). They
  measure and never assert; the ceilings above are the half that is enforced. Numbers, and
  the two findings the first measurement produced — the compositor's frame gate, **fixed**
  by ESCSUITE-54 with the paired before/after in that file, and the first-take step, still
  open — are in `docs/performance/2026-09-17-craft-baseline.md`.
- **The separate-tracks mode's end-to-end proof is
  `apps/e2e/tests/escapecraft/separate-tracks.spec.ts`** — a real Chromium take against the
  synthetic capture devices — it clicks **System Audio** on, which is what makes the take four
  parts rather than the benchmark's three — asserting what reached `video-editor-db` (four blobs
  under one `takeId`: the screen, the webcam, and the two audio parts whose bytes are handed to a
  real `decodeAudioData` in the page, the primary carrying `overlayPlacement`) and the four rows
  the library draws for them, each labelled with the track it is. **Address ESCAPECRAFT's
  toggles by exact accessible name in e2e code**: the separate-tracks toggle's accessible
  name — "Record webcam as a separate track" — contains "Webcam", so Playwright's default
  case-insensitive *substring* `name` match silently re-resolved to it the moment the Webcam
  Overlay panel appeared. That is what `apps/e2e/utils/seekable.ts`'s `recordPipTake` (the
  `pip-seekable` guard's own helper, whose second step is the click that reveals the toggle) had
  to stop doing: it now asks for `getByRole('button', { name: label, exact: true })` and scopes
  to no class at all. Its wrapper also used to reuse the four source rows' `sourceToggle`
  CSS-module class, which made `[class*="sourceToggle"]` + `hasText: 'Webcam'` — the shape the
  sibling specs scope with — match it too; since ESCSUITE-68 it carries its own
  `separateTracksToggle` class (same four declarations, copied not composed: it is a *mode*, not
  a capture source), pinned by `WebcamOverlaySettings.test.tsx`. The exact-name rule stands
  regardless — the substring match is the half of the trap a class cannot fix.
- **Semicolon dialect is mixed, deliberately.** The suites the test decomposition added
  (`src/hooks/*.test.ts`, `src/utils/recordingFormat.test.ts`, and their siblings) omit
  line-ending semicolons; the older files (`src/App.library.test.tsx` and friends) carry them.
  There is no `semi` lint rule and normalising the tree is not worth burying an unrelated diff
  in — **match the file you are editing**. Changing this is its own ticket, and it would have
  to be decided for `apps/artist` and `packages/shared` at the same time.

## Key Constraints

- MediaRecorder API required (all modern browsers)
- System audio capture only works with getDisplayMedia (Chrome/Edge)
- AudioContext needs resume() call due to Chrome autoplay policy
- WebM from MediaRecorder needs post-processing for proper scrubbing
- WebCodecs API only works in Chrome/Edge. Where it is missing, `recorder-factory.ts` falls
  back to MediaRecorder, so recording still works — it is the WebCodecs recorder and the
  conversion paths in `converter.ts` (the library's MP4 and M4A downloads) that are Chrome/Edge
  only
- Recording the webcam as a separate track needs `MediaStreamTrackProcessor` on top of
  WebCodecs (`canRecordSeparateTracks()`). It is the one feature with no fallback: the toggle
  stays on screen and `disabled`, carrying the reason, and the take is recorded as a composited
  overlay instead

## Keyboard Shortcuts

Bound by `src/hooks/useKeyboardShortcuts.ts` — the only window listener `App` itself binds; `VideoPlayer` binds its own while the playback dialog is open — and listed
for the user by `src/components/RecorderControls/RecorderControls.tsx`. None of them fire while
a dialog is open; see "Dialogs".

Every one of them is gated on the state the app is in, so a key that has nothing to do is
inert rather than wrong — there is no "else" branch anywhere in the switch. Two gates are
worth naming: **R also checks `canRecord`**, the same `recordBlockedReason()` answer that
disables the Record button, so the keyboard can never start a take the button refuses; and
**Escape does nothing at all in `idle` or in `'saving'`** — in `idle` there is no take to cancel,
and in `'saving'` the take has already stopped with only the write to storage left, so there is
nothing a cancel could call off. Like every other gate in the switch it is written as an **allow-list**
(`'preparing' || 'recording' || 'paused'`) rather than an exclusion, so a state added later is inert
rather than cancellable by default. Escape there used to run `handleCancelRecording()` anyway
(ESCSUITE-174): the store went back to `'idle'`, the duration was reset, the streams were stopped
and the sidebar unlocked **mid-write** — the window `sidebarLocked` exists to keep (ESCSUITE-104) —
while the save, which deliberately does not read `cancelledRef`, carried on behind an idle-looking
app. Record was live again too, and that is how a finished save's own `setState('idle')` came to
land on the take started after it: see "The save's completion carries the same identity" under
"Recorder lifecycle" for the other half of that fix, which holds whatever cancels the first take.
Refusing to claim an action it cannot perform is the same posture the Record button takes in
`'preparing'`/`'saving'` (ESCSUITE-106). `'preparing'` stays cancellable: the capture request is
still outstanding there, and the attempt token is what makes the cancel stick (ESCSUITE-93/109).
The trade-off, named rather than hidden: `'saving'` has no user-reachable exit at all, so the save
promise settling is the only way out — which is why the one thing on that path that could never
settle, the thumbnail probe, now has a deadline of its own (`THUMBNAIL_TIMEOUT_MS`,
ESCSUITE-180). See the end of "The save's completion carries the same identity" under "Recorder
lifecycle".

| Key | Action | Fires in |
|-----|--------|----------|
| R | Start recording | `idle`, and only when `canRecord` |
| P | Pause / Resume | `recording` / `paused` |
| S | Stop recording | `recording`, `paused` |
| Esc | Cancel the countdown, else cancel the take | `countdown`; `preparing`, `recording`, `paused` — never `idle` or `saving` |

A keydown with Cmd, Ctrl or Alt held, or with `e.repeat` set, returns before the switch
(ESCSUITE-222): Cmd/Ctrl+S used to stop a live take, +P pause it and +R start one as the page
reloaded, and a held key repeated its action. Shift is left alone.

Typing is never interrupted either: a keydown whose target is an `<input>` or `<textarea>`
returns before the switch.

The record button agrees with this table, not just with R: during `countdown` the big button is
itself wired to cancel (see "The record button only offers what it can deliver" — ESCSUITE-106),
so a click there and an Esc press do the same thing, and S stays inert through the countdown as
this table already says.
