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
`App.tsx` is wiring only — the single `useRecorderStore()` destructure, the two refs the take
and the save share, the `showHelpModal` flag, the `isRecordingActive` derivation and
`toggleSource`, one call per hook below, and the JSX that composes the components. It registers
no effect of its own and binds no listener.

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
`canvasPreviewRef` in `useMediaStreams`, and the recorder, cancelled-flag and interval refs in
`useRecordingController`, each passed on to whoever else reads it.

Every module below has its own test file; `App.tsx` itself is covered through
`App.recording.test.tsx`, `App.saving.test.tsx`, `App.library.test.tsx` and
`App.settings.test.tsx`, which drive the rendered app.

| Module | Owns |
|--------|------|
| `App.tsx` | The composition: the store destructure, `recorderTypeRef` / `capturedThumbnailRef`, `showHelpModal`, `isRecordingActive`, `toggleSource`, `modalOpen` (`showHelpModal \|\| playbackUrl !== null`), the hook calls in their fixed order, and the header/sidebar/content/dialog JSX |
| `utils/recordingFormat.ts` | `formatDuration` (`MM:SS`, floor-truncated) and `safeFileName` — pure string formatting shared by the duration labels, the library rows and the download handler |
| `utils/previewThumbnail.ts` | Capturing a thumbnail frame from the live preview (compositor canvas or `<video>`) and drawing the placeholder used when every other capture path fails. Canvas creation and `toBlob` are its only side effects |
| `utils/notices.ts` | The app's whole vocabulary of notices — six strings, one per thing that can go wrong. See "Errors and notices" below; there is deliberately no second channel and no notification framework |
| `utils/recordReadiness.ts` | `recordBlockedReason` — whether the Record button may start a take, and the sentence shown when it may not. Pure, over `capabilitiesReady` + the config + the capabilities + `hasStorageSpace`. Owns `NO_STORAGE_SPACE`, which is a *button reason* rather than a notice |
| `utils/recordingMetadata.ts` | The two records a finished take writes — the shared `SourceVideo` stored beside the blob and the recorder's own `Recording` list entry — built from values the caller already computed. No store, and no blob-URL creation |
| `components/icons.tsx` | The inline SVG icon set, every path drawn in `currentColor`. The source icons take a `className` because their size is per call site; the action icons are `aria-hidden` and sized entirely by their button |
| `components/AppHeader/AppHeader.tsx` | The app bar: the suite link (hidden in the standalone build), the wordmark, the `aria-live` status region — carrying both the recorder state and the app's one `notice` — and the two header buttons. It resolves `isStandaloneMode()` and `editorUrl()` itself, because both are deployment facts rather than App state |
| `components/SourceToggles/SourceToggles.tsx` | The Sources panel: one row per capture source — written out four times rather than mapped, since each has its own icon, capability slice and config flag — plus the audio meters shown while an audio source is recording. Also exports the `RecordingSource` union |
| `components/WebcamOverlaySettings/WebcamOverlaySettings.tsx` | The PiP overlay's position, size and shape, every control reporting a config patch. It draws unconditionally; whether the panel exists at all is the caller's decision |
| `components/RecordingsList/RecordingsList.tsx` | The library panel: each saved take's thumbnail, name, formatted duration and size, and its four action buttons, each labelled with the recording's own name. It touches no storage — it hands ids and names back up |
| `components/RecordingPreview/RecordingPreview.tsx` | The preview stage: the compositor's canvas, a mirrored stream, or the idle placeholder — checked in that order so PiP wins during a composite take — with the countdown laid over the top. It only places the App's two DOM refs |
| `components/RecorderControls/RecorderControls.tsx` | The transport bar and the shortcut legend: which controls exist in each state, the record button's three-way `onClick` ladder (start when idle, stop while active, nothing at all in `preparing` and `saving`), and the `blockedReason` that sits in front of that ladder |
| `components/PlaybackDialog/PlaybackDialog.tsx` | The modal that plays one saved recording back — the frame around `VideoPlayer`, the backdrop-dismiss behaviour, and the saved `duration` the player is told rather than asked for. Calls the shared `useDialogBehaviour` for the keyboard half |
| `components/HelpDialog/HelpDialog.tsx` | The Recording Tips modal: static copy in four sections, the same backdrop-dismiss behaviour, named through `aria-labelledby`, and the `tabIndex={0}` that makes its scrolling body keyboard-reachable. Calls the shared `useDialogBehaviour` too |
| `hooks/useThemeLifecycle.ts` | One effect: `initTheme` on mount, `cleanupTheme` on unmount. Called first because it was the first effect in the file |
| `hooks/useCapabilityBootstrap.ts` | The way in: capability detection and the initial `loadRecordings()`, both in one effect as they were inline — splitting them would change the order the store is written on mount. Raises `capabilitiesReady` (on success *and* on failure) and reports either failure as a notice |
| `hooks/useMediaStreams.ts` | Everything capture is held in and released through: the preview stream, the PiP compositor, the microphone stream the store does not hold, the two preview DOM handles, `acquireStreams`, `stopAllStreams` and the ref that mirrors it. Registers the preview attach and then the mirror |
| `hooks/useRecordingSave.ts` | Turning a finished take into a stored recording: the WebM container repair, metadata extraction, the thumbnail fallback chain, both storage writes, and the new entry at the top of the list. Reads the recorder type and the captured thumbnail through refs, because `onStop` fires from callbacks captured a render earlier |
| `hooks/useRecordingController.ts` | The take itself: countdown, start, pause, resume, stop, cancel, the two interval tickers, and the ordered unmount teardown. Creates the recorder, cancelled-flag and interval refs, and holds the recorder's six callbacks — captured once, at `createRecorder` time, so a late `onStop` releases the capture *that* take was using |
| `hooks/useKeyboardShortcuts.ts` | The window-level R / P / S / Escape shortcuts, each gated on `state` — and R additionally on `canRecord`, so the keyboard cannot do what the button refuses — with the whole set gated on `modalOpen`. Its dependency array is copied verbatim rather than trimmed, so the listener re-binds whenever any handler changes identity — including on every `config` change |
| `hooks/useRecordingLibrary.ts` | The recordings already in storage: play, download, send to editor, delete (re-reading the storage headroom after it), and the playback dialog's URL, name and duration. The five handlers stay plain functions recreated on every render, as they were inline — memoising them would change how often the sidebar and the dialog re-render. Binds no effect |

### Errors and notices

**One store field, one live region, cleared by the next take.** `notice: string | null`
in `recorderStore` is the whole notification surface: `AppHeader` renders it inside the
header's existing `aria-live="polite" aria-atomic="true"` region, and
`handleStartRecording` clears it when the next take begins. Every string lives in
`src/utils/notices.ts` — `SAVE_FAILED`, `NOT_SEEKABLE`, `CAPTURE_REFUSED`, `START_FAILED`,
`LIBRARY_UNREADABLE`, `DETECTION_FAILED`, `NO_SYSTEM_AUDIO` — so the vocabulary is
readable in one place. **Do not add a second channel**: no toasts, no per-component error
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
  than swallowing, so the controller can tell an unsaved take from a saved one;
  `loadRecordings()` is caught in the bootstrap; a start that throws raises
  `CAPTURE_REFUSED` (the browser said no — a cancelled picker, a denied permission, an
  expired user activation) or `START_FAILED`; `fixWebMMetadata()` failing still keeps the
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
  arrived for this take") rather than the notice's. The flag is display-only and the meter
  is drawn only while a take runs, so `handleStartRecording` resetting it to `true` is its
  whole lifecycle.

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

**The hook assumes one dialog at a time**, and today that holds: each backdrop is
`position: fixed; inset: 0` at `z-index: 1000`, so a click aimed at the Help button while
playback is open lands on the playback backdrop and closes it instead, and the focus trap keeps
that button out of Tab's reach. Two mounted at once would bind two capture listeners, and one
Escape would close both and fire two focus restores. A third dialog, or a dialog opened from
inside another, has to keep that property or the hook needs a stack.

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

`apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` proves the round trip in a real
browser: open Help from the keyboard, Tab six times without leaving it, Escape, focus back on
the Help button.

### State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`, `DetailedCapabilities`, `CapabilityInfo`
- Recordings stored in shared IndexedDB with ESCAPEARTIST

### Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring (see
  "Audio level meters" for the 80 ms gate both recorders apply)
- `webcodecs-recorder.ts`: VideoEncoder/AudioEncoder + Mediabunny recorder for non-PiP takes
- `recorder-factory.ts`: `createRecorder()` / `canUseWebCodecsRecorder()` /
  `getRecorderType()` — picks between the two recorders for a take. WebCodecs unless the
  take is PiP (the compositor's hidden video elements break its frame capture) or has no
  video track at all (an audio-only take, which `WebCodecsRecorder` cannot serve);
  MediaRecorder otherwise. `getRecorderType()` returns that same decision as
  `'webcodecs' | 'mediarecorder'`, which is what the controller puts in `recorderTypeRef`
  and what the save path branches on to decide whether the blob needs repairing
- `permissions.ts`: Environment capability detection with detailed unavailability reasons
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction. Its size, type
  and quality constants are **imported from `utils/previewThumbnail.ts`**, not declared here:
  five suites (`App.settings`, `App.saving`, `App.recording`, `App.library`,
  `hooks/useRecordingSave`) `vi.mock('./core/thumbnailGenerator')` wholesale, so a constant
  declared in this module would vanish under the mock. `utils/previewThumbnail.ts` is never
  mocked, which is what makes it the single definition — keep it that way
- `converter.ts`: `fixWebMMetadata()` — the WebM container repair a **MediaRecorder** take
  goes through at save time (a WebCodecs take needs none; see "WebM Handling"), and **the
  only export of this module the app reaches**. The rest of the file
  (`convertToMP4`, `remuxToWebM`, their support checks, and the progress/abort machinery)
  is WebCodecs + Mediabunny conversion that nothing calls; see "Download Formats"

### VideoPlayer Component (`src/components/VideoPlayer/`)
Reusable video player with full playback controls:
- **Play/Pause**: the transport button, Space or K, or a click on the video itself
- **Seeking**: click or drag the progress bar; Left/Right skip ±5s; 0 or Home jumps to the
  start and End to the end. There is no Shift modifier
- **Volume**: a slider with a mute toggle (M); Up/Down move it in 0.1 steps
- **Restart**: its own transport button — seek to 0 and play
- **At the end of the video** it resets to the beginning and stops. It does not loop
- **Duration**: `video.duration` is used when it is finite and above 0, and `knownDuration`
  is the fallback for when it is not — a MediaRecorder WebM often reports `Infinity` or 0.
  The playback dialog passes the saved recording's duration as that fallback
- **Keyboard**: Space/K, Left/Right, Up/Down, M, 0/Home, End, Escape. It binds these on
  `window`; the shared `useDialogBehaviour` binds Escape and Tab on `document` in the capture
  phase, so while the playback dialog is open the dialog's Escape runs first and the player's
  does not

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

Which sources are captured is `src/hooks/useMediaStreams.ts`; what is done with them — countdown,
start, pause, resume, stop, cancel and teardown — is `src/hooks/useRecordingController.ts`.

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

**Picture-in-Picture is the gap**: the stream handed to the recorder there is the compositor's
canvas track, not the screen track, so none of the above fires when the user stops sharing during a
PiP take. Fixing that means watching the source tracks in `compositor.ts`.

**Audio-only takes use the MediaRecorder path.** `SourceToggles` lets both video sources be switched
off; `WebCodecsRecorder` is built around a video track and throws
`'No video track available for recording'` without one. `createRecorder` / `canUseWebCodecsRecorder`
/ `getRecorderType` take `hasVideoSource` alongside `isPiP` for exactly this, and the controller
computes it as `(config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam)` — the same
"a stream AND its toggle" test both recorders apply when they pick a video track, since a capability
the browser lacks yields a `null` stream with the toggle still on. `getRecorderType` gets it too:
its answer is what `useRecordingSave` keys the `fixWebMMetadata` repair off, so an audio-only take
would otherwise be saved as unseekable WebM.

### Audio level meters

Both recorders read their analysers on `requestAnimationFrame` and push an `AudioLevels` to the
store through `onAudioLevels`; `SourceToggles` draws the meters. **Both gate that to one sample
every 80 ms** (`AUDIO_LEVEL_INTERVAL_MS` in `webcodecs-recorder.ts`, `updateInterval` in
`recorder.ts`) — ~12.5 Hz, which is plenty for a meter and a twelfth of the cost. The gate
matters more than it looks: `App` subscribes to the Zustand store with no selector, so **one
level push re-renders App and its whole tree** (measured 2026-09-15: exactly one commit per
`setAudioLevels`). Ungated that was 60 whole-tree renders a second for the length of a take.

Two more rules the WebCodecs recorder follows and `Recorder` does not yet:

- Each analyser is paired with the `Uint8Array` it reads into (`LevelMeter`), allocated once
  from `frequencyBinCount` — which never changes — and refilled in place, instead of a fresh
  typed array per source per sample.
- A take with **no** microphone and no system audio starts no monitor at all — there is no
  analyser to read, so the loop would only write a hard-coded `{ microphone: 0, system: 0 }`
  into the store for a meter that cannot move. It does send that value **once**, before
  returning: nothing resets `audioLevels` between takes, and `SourceToggles` draws a meter
  whenever the *toggle* is on rather than whenever an analyser exists, so a take that asked
  for system audio and was not given it would otherwise show the previous take's bar frozen
  at its last value. One store write per take, not per frame.

**Follow-up, deliberately not done here:** the remaining cost is the whole-tree render, and
selecting `audioLevels` inside `SourceToggles` would not remove it — `App` calls
`useRecorderStore()` with no selector, so it re-renders on *every* store write whatever its
children subscribe to (measured 2026-09-15: one App commit per `setAudioLevels`, with
`audioLevels` reaching only `SourceToggles`). Cutting it to the meters means moving `App` to
per-field selectors, which is its own ticket.

`webcodecsRecorder.perf.test.ts` and `recorder.perf.test.ts` assert all of this as counts —
at most 13 emissions per 60 animation frames in *both* files, so the two monitors cannot drift
apart again. `Recorder`'s per-sample analyser buffer is pinned there as a finding, with the
assertion to flip when it is hoisted.

### Integration with ESCAPEARTIST
- Both apps share `video-editor-db` IndexedDB database
- Recordings stored with `source: 'recording'` and `recordedAt` timestamp
- "Send to Editor" opens ESCAPEARTIST with `?loadVideo=<id>` parameter
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

The header's **"Open Editor" button is deliberately not routed through the
host**: embedded or not, it opens the editor itself. Only "Send to Editor",
which hands over one specific recording, becomes a message.

**`?hostOrigin=<origin>`**: when the host names its own origin on CRAFT's URL,
the `SEND_TO_EDITOR` post is addressed to that origin instead of `'*'`. The
value must be a bare origin (`https://host.example`); anything else is ignored
with one console warning and the post falls back to `'*'`. The parser is
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

### Download Formats

**One option: "Download WebM".** The library row's download button hands back the stored
blob as `<name>.webm`, with no conversion step — what is in storage is already seekable,
either because the recorder wrote it that way or because it was repaired at save time (see
"WebM Handling"), so the download is instant.

`core/converter.ts` still holds the MP4 (H.264 + AAC) and compatible-WebM (VP9 + Opus
re-encode) conversion paths, and everything that was built around them: support checks,
progress reporting, `AbortSignal` cancellation, `requestVideoFrameCallback` frame capture
(~real-time rather than the minutes a seek-based loop takes) and `MessageChannel` yielding
so a conversion is not throttled in a background tab. **None of it has been reachable from
the UI since #209** — that PR deleted the download-conversion handlers outright;
only `fixWebMMetadata()` is called. The code is kept, tested and unwired pending a product
decision on whether ESCAPECRAFT should offer format conversion at all — the editor
(ESCAPEARTIST) exports MP4 already. Note that `components/HelpDialog` still describes an
MP4 download to the user; that copy is part of the same open decision.

### WebM Handling
- MediaRecorder produces WebM without proper seek metadata
- `webm-duration-fix` library adds Duration, SeekHead, and Cues elements
- Thumbnails captured from live preview (more reliable than from blob)
- Metadata extraction has fallbacks for problematic WebM files
- **The repair runs on MediaRecorder output only**, once, at save time.
  `useRecordingSave` branches on `recorderTypeRef`: a `'webcodecs'` take is written through
  untouched, because `WebCodecsRecorder` muxes with Mediabunny, which already emits Duration
  and Cues. Everything else — PiP takes, audio-only takes, and any browser without WebCodecs
  — goes through `fixWebMMetadata()` first. Either way what reaches storage is seekable, but
  only one of the two paths repairs anything; a take that will not scrub is a question about
  *which recorder produced it* before it is a question about the repair
- The playback dialog fixes nothing either. It passes the saved duration to `VideoPlayer` as
  `knownDuration`, which the player falls back to when `video.duration` is `Infinity` or 0
- A repair that fails still saves the raw blob, and raises the `NOT_SEEKABLE` notice. That
  path exists only for MediaRecorder takes, for the same reason

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
  - `Recording Deleted`

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
- **`*.perf.test.ts` files are ceilings, not benchmarks.** `core/compositor.perf.test.ts`,
  `core/converter.perf.test.ts`, `core/webcodecsRecorder.perf.test.ts` and
  `core/recorder.perf.test.ts` count what a frame, a take or a second of monitoring costs —
  canvas calls, emissions, typed arrays, `VideoFrame`s created versus closed, `encode`/`flush`
  calls — through the same doubles the behaviour tests use. Counts, not milliseconds, so they
  are enforced in CI like any other test. The rule (2x the measured value rounded up, the
  measurement and its date in a comment, conservation laws exact, ceilings only ever lowered)
  is in the root `CLAUDE.md`.
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
  (currently unwired) conversion paths in `converter.ts` that are Chrome/Edge only

## Keyboard Shortcuts

Bound by `src/hooks/useKeyboardShortcuts.ts` — the only window listener `App` itself binds; `VideoPlayer` binds its own while the playback dialog is open — and listed
for the user by `src/components/RecorderControls/RecorderControls.tsx`. None of them fire while
a dialog is open; see "Dialogs".

Every one of them is gated on the state the app is in, so a key that has nothing to do is
inert rather than wrong — there is no "else" branch anywhere in the switch. Two gates are
worth naming: **R also checks `canRecord`**, the same `recordBlockedReason()` answer that
disables the Record button, so the keyboard can never start a take the button refuses; and
**Escape does nothing at all in `idle`** — there is no take to cancel, and it must not
reach past the recorder.

| Key | Action | Fires in |
|-----|--------|----------|
| R | Start recording | `idle`, and only when `canRecord` |
| P | Pause / Resume | `recording` / `paused` |
| S | Stop recording | `recording`, `paused` |
| Esc | Cancel the countdown, else cancel the take | `countdown`; any state but `idle` |

Typing is never interrupted either: a keydown whose target is an `<input>` or `<textarea>`
returns before the switch.
