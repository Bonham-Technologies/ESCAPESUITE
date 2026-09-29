# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPE Suite is a **Turborepo monorepo** containing privacy-first, client-side media creation tools that run entirely in the browser. All video processing happens locally - no cloud uploads required.

| App | Package | Purpose | Dev Port |
|-----|---------|---------|----------|
| ESCAPEPLAN | `@escapesuite/plan` | Landing page & hub | 5173 |
| ESCAPECRAFT | `@escapesuite/craft` | Screen & webcam recorder | 5174 |
| ESCAPEARTIST | `@escapesuite/artist` | Video editor with timeline & effects | 5175 |
| E2E Tests | `@escapesuite/e2e` | End-to-end test suite | N/A |
| Headless ARTIST kit | `@escapesuite/headless-artist` | Server-side render CLI + kit | N/A |

## Monorepo Structure

```
escapesuite/
├── apps/
│   ├── plan/           # ESCAPEPLAN - landing page & hub
│   ├── craft/          # ESCAPECRAFT - recorder
│   ├── artist/         # ESCAPEARTIST - video editor
│   └── e2e/            # End-to-end tests (Playwright)
├── packages/
│   └── shared/         # Shared types and utilities
├── services/
│   └── headless-artist/ # Server-side ARTIST render CLI + kit
├── scripts/
│   └── build-all.mjs   # Combined build for Vercel
├── package.json        # Root workspace config
├── pnpm-workspace.yaml # pnpm workspace definition
├── turbo.json          # Turborepo configuration
└── vercel.json         # Vercel deployment config
```

## Build Commands

All commands run from the monorepo root using pnpm and Turbo:

```bash
# Install dependencies (all apps)
pnpm install

# Development servers
pnpm dev                 # All apps in parallel
pnpm dev:plan            # Just ESCAPEPLAN (localhost:5173)
pnpm dev:craft           # Just ESCAPECRAFT (localhost:5174)
pnpm dev:artist          # Just ESCAPEARTIST (localhost:5175)

# Production builds
pnpm build               # Build all apps (Turbo cached)
pnpm build:plan          # Build just ESCAPEPLAN
pnpm build:craft         # Build just ESCAPECRAFT
pnpm build:artist        # Build just ESCAPEARTIST
pnpm build:deploy        # Combined build for Vercel (outputs to /dist)

# Testing
pnpm test                # Unit tests for all apps
pnpm test:coverage       # With coverage reports
pnpm test:e2e            # Playwright E2E tests (Chromium only in CI)
pnpm test:e2e:browsers   # Cross-browser E2E (Chromium + Firefox + WebKit)
pnpm test:e2e:browsers:all # Cross-browser E2E including responsive variants
pnpm test:e2e:standalone # E2E against the offline single-file builds (run pnpm build:standalone first)
pnpm test:e2e:production # E2E against the combined single-origin dist (run pnpm build:deploy first)

# Linting & types
pnpm lint                # Lint all apps
pnpm -r run typecheck    # Type-check every package, test files included

# Cleanup
pnpm clean               # Remove all node_modules and dist
```

## Vercel Deployment

The monorepo deploys to Vercel with automatic preview deployments:

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.io | Production |
| `dev` | escapesuite.dev | Development/staging |
| PRs | `*.vercel.app` | Preview deployments |

**Output Structure:**
```
dist/
├── index.html        # ESCAPEPLAN
├── 404.html          # SPA fallback
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
```

## Architecture

### Shared Infrastructure
- **pnpm workspaces**: Efficient dependency management with shared packages
- **Turborepo**: Cached builds, parallel execution, smart rebuilds
- **IndexedDB Database**: CRAFT and ARTIST share `video-editor-db` for seamless data transfer
- **Single-file Builds**: `vite-plugin-singlefile` inlines all assets into one HTML file
- **Shared dialog behaviour**: `useDialogBehaviour` (`packages/shared/src/hooks`, imported
  as `@escapesuite/shared/hooks`) is the single modal keyboard implementation — initial
  focus, the Tab/Shift+Tab trap, Escape-to-close and focus restored to the opener — used by
  CRAFT's two modals and all five of ARTIST's (export, shortcut sheet, project-load, session
  restore, the resolution-change confirm). Escape's *meaning* is per dialog, not inherited: the
  hook calls whatever it is handed, and ARTIST's session-restore prompt hands it a no-op because
  declining discards the
  saved session. See each app's CLAUDE.md "Dialogs" note

### ESCAPEPLAN (apps/plan)
- React Router for client-side routing
- Landing page & legal pages only — no accounts, no backend
- In production: serves CRAFT at `/craft/` and ARTIST at `/artist/`

### ESCAPECRAFT (apps/craft)
- Zustand store in `src/store/recorderStore.ts`
- Core modules in `src/core/`: `recorder.ts`, `webcodecs-recorder.ts`, `recorder-factory.ts`, `webcodecsSupport.ts`, `compositor.ts`, `permissions.ts`, `thumbnailGenerator.ts`, `storage.ts`, `converter.ts`
- Recording modes: screen, webcam, PiP (screen + webcam overlay), with mic/system audio options
- Two recorders, chosen per take by `recorder-factory.ts`: WebCodecs where it is available, MediaRecorder for composited PiP, audio-only takes and browsers without it
- **"Record webcam as a separate track"** (ESCSUITE-14, opt-in, off by default) is the one PiP take that reaches WebCodecs: one `WebCodecsRecorder` runs two `VideoEncoder`s and two Mediabunny outputs off one clock, so the screen and the webcam are two frame-aligned files instead of one composited overlay, and the `Compositor` draws the preview only. It costs about twice the CPU and storage, needs `MediaStreamTrackProcessor` as well as WebCodecs (Chromium/Edge), and is disabled with a visible reason where either that or the storage headroom for two tracks is missing. MP4 re-composites such a take into one file with the camera back in the corner it was recorded in, and M4A was always the whole take's sound. See `apps/craft/CLAUDE.md`'s "Recording Modes" and "A take can be several files"
- Outputs WebM either way, but only the MediaRecorder path needs repairing: `useRecordingSave` runs `webm-duration-fix` over MediaRecorder output at save time, and writes WebCodecs output through untouched (Mediabunny already emits Duration and Cues)
- Three downloads per recording: **WebM** is the stored blob handed straight back, instant and always available; **MP4** (H.264 + AAC) is `converter.ts` re-encoding it in the page with WebCodecs + Mediabunny; **M4A** (`convertToM4A`, `audio/mp4`) is the take's audio alone, AAC in an MP4 container, for a mic-only take that should come out as an audio file. The two conversions share one slot — one at a time whichever it is — with a phase-and-percentage progress row, a Cancel button, and a disabled button carrying a visible reason wherever a conversion is refused. Nothing is uploaded by any of the three; a failed conversion raises the app's one notice and leaves the WebM download untouched
- The two conversions are gated differently, because they fail differently: no AAC encoder makes an MP4 *silent* (still offered, with a note) and an M4A *impossible* (disabled, with the same sentence as its reason), and a take with no audio in it disables M4A alone. See `apps/craft/CLAUDE.md`'s "Download Formats"
- The conversion state is held in `RecordingsListPanel`, below `App`, so a progress report re-renders the library and nothing else (`App.mp4rerender.test.tsx` counts it)

### ESCAPEARTIST (apps/artist)
- Zustand store in `src/store/projectStore.ts`
- Core modules in `src/core/`: `storage.ts`, `videoProcessor.ts`, `exporter.ts`, `projectManager.ts`, `videoDecodeManager.ts`, `frameSource.ts`
- Video decode worker in `src/workers/decodeWorker.ts` for background-capable MP4 exports
- Keyframe animation system in `src/utils/animation.ts`
- Audio waveform visualization in `src/utils/waveform.ts`
- WebCodecs API for encoding/decoding (Chrome/Edge only)
- Export formats: WebM (VP9+Opus) and MP4 (H.264+AAC)
- Background tab export: MP4 exports run at full speed even in background tabs via Web Worker

### Data Flow
```
ESCAPECRAFT recordings → IndexedDB → ESCAPEARTIST imports
                          ↓
                    Shared videos, thumbnails, projects
```

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

### Integration API (embedding CRAFT / ARTIST in a host page)
Both tools detect embedding with `isEmbedded()` (`packages/shared/src/config`) — true whenever
`window.parent !== window` — and talk to the host over `postMessage`. The full protocol lives in
the doc comment at the bottom of `apps/artist/src/utils/integration.ts`.

- **PostMessage**: bidirectional communication with the parent window. ARTIST posts `READY` on
  init, and `EXPORT_COMPLETE` with `{ blob: Blob, format: 'mp4' | 'webm', name: string }` after a
  successful export (`name` is the download filename; not sent on failure or cancellation).
- **CRAFT → host**: `{ type: 'SEND_TO_EDITOR', payload: { id } }` when embedded, instead of the
  `window.open()` it uses standalone. `id` addresses the recording in the shared IndexedDB.
  CRAFT's header "Open Editor" button is deliberately *not* routed through the host — it still
  opens the editor itself when embedded. Only "Send to Editor" and "Upload to host" become
  messages.
- **CRAFT → host (upload)**: `{ type: 'UPLOAD_RECORDING', payload: { id, name, blob, role?, takeId?, parts? } }` from a
  per-row "Upload to host" button that exists **only** when CRAFT is embedded — the host is the
  only thing that could receive it. The `Blob` goes by structured clone, so a host that cannot
  reach the shared IndexedDB (or would rather not) gets the file itself. `RecordingsListPanel`
  decides with `isEmbedded()`; `RecordingsList` is props-only and draws the button exactly when
  it is given `onUploadToHost`. See `apps/craft/src/utils/uploadToHost.ts`.
  Since ESCSUITE-14 a take can be several files, and the payload says so two ways. `role` and
  `takeId` (both optional, both absent on a take recorded as one file) name **which** part a row's bytes
  are. And the primary row's message carries `parts` — every file of the take, the primary
  included, in role order:
  `parts?: Array<{ id: string; role: 'screen' | 'webcam' | 'mic' | 'system'; name: string; blob: Blob; startOffset: number }>`.
  `startOffset` is seconds after the take's start at which that part's first frame was captured
  (0 for every part ESCAPECRAFT records today — one recorder, one clock). A part whose bytes are
  gone is left out rather than listed with nothing in it.

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
    `blob` and `parts[0]` costs nothing — they are literally the same `Blob` object, because
    `uploadToHost` hands the bytes it already holds to `loadTakeParts` rather than letting it
    read them again. The bytes are never read into the heap on either side.
  - *The per-row buttons stay.* A companion row's own "Upload to host" still posts that row
    alone, with `role` and `takeId` and no `parts`. It is redundant for a host that adopted
    `parts` and is the only way a host that has not can be handed one specific part.
- **URL params (ARTIST)**: `?video=url` to preload, `?project=base64` for state,
  `?loadVideo=<id>` for the CRAFT handoff — the id addresses a take's **primary** part, and
  ARTIST resolves its siblings by `takeId`, adds every part to the media library and places
  them on the timeline in one undo step: the primary on a video track, the webcam on a track
  above it at its `startOffset` with its transform, its **mask** and its **border** all
  seeded from the primary's `overlayPlacement` (ESCSUITE-65: a `'circle'` placement arrives as
  `clip.mask = { kind: 'circle' }` and ESCAPECRAFT's white border as `clip.stroke`, carried at
  the weight the *capture* had rather than the project's — visible in the preview, in an export,
  and as the shape of that clip's thumbnail on the timeline), and the audio parts on tracks of
  their own. Placement happens for
  **every** handoff, a single-file take included (ESCSUITE-14 decision 7); a handoff into a
  session that already holds clips appends at the end of the timeline —
  `?suppressRestore=1` to skip the
  "Resume Previous Session?" prompt (ARTIST then neither offers nor writes the saved session —
  the autosave is off too), and `?title=<name>` to name the project (trimmed, max 120 chars;
  applied only while the name is still the default `Untitled Project`).
- **`?hostOrigin=<origin>`** (both apps): the host's own origin, e.g. `https://host.example`.
  Recommended for production hosts — and effectively required of a host that offers CRAFT's
  "Upload to host", since the `'*'` fallback hands that message's **bytes**, not just an id, to
  whatever page is framing CRAFT. Outbound posts are addressed to it instead of `'*'`, and
  ARTIST ignores inbound messages from anywhere else. It protects the **host's** deployment,
  not against being framed — a hostile page that frames the app also controls the URL and would
  supply its own origin; refusing to be framed is `Content-Security-Policy: frame-ancestors` on
  the deployment. Parsed by `parseHostOrigin()` in `packages/shared/src/config`. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a self-hosted or standalone build must set its own.
- **Documented but not currently implemented**: inbound `EXPORT`, outbound `EXPORT_PROGRESS` and
  `PROJECT_SAVED`, and the `?project=` / `?autoplay=` URL params. See `apps/artist/CLAUDE.md`.
- **`VITE_EDITOR_URL`** (build-time, CRAFT): where standalone CRAFT opens the editor.
  Defaults to `/artist/`; normalised to a single trailing slash.
- Proved end to end in a real iframe by `apps/e2e/tests/integration/host-embedding.spec.ts`.

### Headless render service (services/headless-artist)
- `@escapesuite/headless-artist`: a one-shot CLI that renders ESCAPEARTIST projects in headless
  Chromium (via Playwright) outside the browser — for servers or GPU boxes, no UI involved.
- Drives the same `dist-headless/headless.html` bundle ESCAPEARTIST builds for the browser
  (`window.__renderProject` / `window.__renderProjectToFile` — see `apps/artist/CLAUDE.md`).
- Scripts: `build` assembles the kit (`dist/cli.js`, `dist/headless.html`, `dist/kit.json`);
  `pack:kit` assembles and `npm pack`s it into `dist/escapesuite-headless-artist-<version>.tgz`;
  `test:run` runs unit tests only (no browser); `test:e2e` runs the Chromium tests;
  `test:perf` runs just the render benchmark (`src/perf.bench.test.ts`) and writes
  `perf-report.json` beside the package.
- Convention: tests named `*.chromium.test.ts` launch real headless Chromium against the
  ARTIST headless bundle, which `test/globalSetup.ts` builds ONCE per vitest run (gated by
  `HEADLESS_BUILD=1`, which `test:e2e` and `test:perf` set — every other invocation is a
  no-op). They are excluded from `test:run`/CI's `test` job and run separately.
- The benchmark is `*.bench.test.ts`, NOT `*.chromium.test.ts`, precisely so `test:e2e`'s
  `chromium.test` substring filter does not sweep it into CI's gating `e2e` job;
  `test:run` and `test:coverage` exclude the suffix explicitly. Only `test:perf` names it.
- CI runs the Chromium tests in the `e2e` job (pinned to the same Playwright 1.63.0 as
  `apps/e2e`, sharing its browser cache) and packs + uploads the kit as the
  `headless-artist-kit` artifact in the `build` job; `standalone-release.yml` attaches the
  tarball to GitHub Releases alongside the standalone HTML builds.

## Environment Variables

No environment variables are required to build or run any app in this repo. Two optional variables are available:

- `VITE_BUILD_MODE` selects the build target for ESCAPECRAFT and ESCAPEARTIST.
- `VITE_EDITOR_URL` overrides where ESCAPECRAFT sends recordings for editing (default `/artist/`).

```env
# Optional — defaults to a normal web build if unset
VITE_BUILD_MODE=standalone   # produces the offline single-file build

# Optional — defaults to /artist/ if unset
VITE_EDITOR_URL=/artist/     # where CRAFT sends recordings for editing
```

## Testing

- **Unit tests**: Vitest with Testing Library, fake-indexeddb for storage mocking
- **E2E tests**: Playwright with Chromium; CI runs the whole suite on every PR and push
- **Journey test**: one end-to-end journey covering record → edit → export across ESCAPECRAFT and ESCAPEARTIST
- **Production-layout tests**: `apps/e2e/tests/production/` runs against the combined
  `dist/` from `pnpm build:deploy`, served on ONE port by `apps/e2e/scripts/serve-dist.mjs`
  (which mirrors `vercel.json`'s rewrites, and — since ESCSUITE-121 part 2 — reads and sends
  `vercel.json`'s `headers` block too, so the suite runs under the real hosted
  Content-Security-Policy and `X-Frame-Options` rather than none at all; `tests/production/csp-media.spec.ts`
  is the regression test, proving a `blob:` video source survives that CSP in both apps). That
  is the only setup where CRAFT (`/craft/`) and ARTIST (`/artist/`) share `video-editor-db`,
  so the cross-app IndexedDB tests live there: `pnpm build:deploy && pnpm test:e2e:production`
- **Standalone tests**: See [Standalone Test Battery](docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists

Test counts change frequently as coverage grows; run `pnpm test` for the current numbers rather than relying on a count documented here.

### Performance benchmarks

`pnpm perf` measures, it does not assert. `apps/e2e/scripts/perf.mjs` runs the Chromium-only
Playwright project in `apps/e2e/tests/perf/` (`playwright.perf.config.ts`: one worker, no
retries, fixed launch args) and then the headless kit's `src/perf.bench.test.ts`, then
**always** merges whatever results exist with `apps/e2e/scripts/perf-report.mjs` into
`perf-report.json` at the repo root plus a Markdown table (appended to
`$GITHUB_STEP_SUMMARY` in CI) — a failed benchmark still leaves the surviving numbers
readable, though `pnpm perf` itself then exits non-zero. `perf-results/` is emptied by the
perf project's `globalSetup` first, so a stale result can never be reported as current.
All three outputs are gitignored.

Ten benchmarks, each run three times and reported as the median: four
ESCAPEARTIST, five ESCAPECRAFT, and the headless kit render. The four
ESCAPEARTIST ones run against **one deterministic 12-clip, 13-second scene** (14 clips
over 4 tracks at 1280x720, clips scaled to fill the frame — scale 1 means native pixel
size here) built in-test from `apps/e2e/fixtures/headless/source.mp4` and loaded through
the documented integration API (`GET_STATE` for the imported source's id, then
`LOAD_PROJECT`); the five ESCAPECRAFT ones drive real takes through the recorder's own
UI against `mockSyntheticMedia`'s canvas-and-oscillator capture devices at 1280x720.
There is no app code for the benchmarks' sake in either app:

- **`preview-playback`** — 6 s of playback, first second discarded: rendered fps (counted
  by wrapping `requestAnimationFrame`), long tasks, JS heap delta after a CDP-forced GC,
  and CDP `TaskDuration` / `LayoutCount` / `RecalcStyleCount`.
- **`timeline-interaction`** — three pointer gestures over the same scene, 60 synthetic
  `mousemove`s each, with the press and the first move outside the measured window: a clip
  drag, a marquee selection and a playhead scrub. Per gesture: pointer moves, wall time,
  renderer `TaskDuration` and **JS ms per move**, **layouts and style recalcs per move**,
  long tasks and heap delta. Each gesture asserts it actually did something (the clip's
  track and offset, the clips' class lists, the playhead's offset are sampled before the
  press and after the release), so a vetoed drag cannot report a respectable cost for doing
  nothing.
- **`export-mp4` / `export-webm`** — one 720p export of the same scene through the export
  dialog: wall time, frames encoded and encoder queue high-water (both from a wrapper on
  `VideoEncoder.prototype.encode`), heap delta.
- **`craft-screen-recording`** — ESCAPECRAFT recording a 6 s screen-only take, first
  second discarded. That take goes through `WebCodecsRecorder`, which encodes on the main
  thread, so the same `VideoEncoder.prototype.encode` wrapper counts every recorded frame:
  frames encoded and per second, **renderer task per frame**, animation frames per second
  (the recorders' audio-level rAF loop), layouts, style recalcs, long tasks, heap delta and
  the stored WebM's size.
- **`craft-pip-recording`** — the same take with the webcam on, which `recorder-factory.ts`
  routes through the `Compositor` into MediaRecorder. Encoding is then off the main thread
  and `framesEncoded` is 0 by construction, so the rate reported is `compositedFps`, counted
  by wrapping `CanvasRenderingContext2D.prototype.drawImage` and halving the calls whose
  first argument is an `HTMLVideoElement` — a composited frame is exactly one screen draw
  plus one webcam draw.
- **`craft-separate-tracks-recording`** — the same take with the webcam on *and* the opt-in
  "Record webcam as a separate track" toggle clicked (ESCSUITE-14), which keeps
  `WebCodecsRecorder` but runs **two** `VideoEncoder`s on one clock into two Mediabunny
  outputs, with the `Compositor` drawing the preview only. `framesEncoded` is both
  pipelines' frames and `framesEncodedPerEncoder` splits them — attributed by encoder
  **instance identity** (a `WeakMap` keyed on the encoder, numbered in first-encode order),
  because both synthetic devices are 1280x720 and a frame's `codedWidth` cannot say which
  pipeline it came from; the screen pipeline is built and started first, so index 0 is the
  screen. Reported as `screenFramesEncoded` / `webcamFramesEncoded` beside the shared
  metrics, and it is the only arm that reports a real encode rate *and* a real
  `compositedFps`. Since slice 3 the take's sound has companions too — the microphone as its
  own Opus file beside the mix on the primary — so the arm also runs **two `AudioEncoder`s**
  and stores **three** library rows per take (screen, webcam, microphone; system audio is off by
  default and the synthetic display stream carries no audio track *as the benchmark drives it* —
  `mockSyntheticMedia` adds its oscillator to `getDisplayMedia` only when the capture asked for
  audio, which nothing here does — so there is no fourth. The ESCAPECRAFT e2e spec, which does
  click that toggle, sees four parts).
  Neither is published: the audio encoders are counted by instance identity as a tripwire and
  the row count only so the wait after Stop is for the take's last part. First numbers, and
  the re-measurement with the audio companions, in
  [docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md).
- **`craft-mp4-conversion`** — one 6 s take converted to MP4 in the page by `convertToMP4`,
  driven through the recording row's own button: wall time, frames encoded, renderer task
  per frame, encoder queue high-water, heap delta and the MP4's size. The conversion is
  bound to playback speed by `requestVideoFrameCallback`, so its wall time has a floor of
  roughly the take's length and **`taskMsPerFrame` is the number a converter change moves**.
- **`craft-composite-mp4-conversion`** — the same conversion over a **separate-tracks** take,
  which `convertToMP4` re-composites: a second `<video>` for the camera half drawn through
  `core/overlayGeometry.ts`'s `drawOverlay` into the same encode canvas, so **two**
  `drawImage(<video>)` per encoded frame. Same metrics as the plain arm plus `videoDraws`, and
  the gap between the two arms' `taskMsPerFrame` is what one overlay costs. Its tripwire is
  exact — `videoDraws === 2 x framesEncoded` — because anything else means either the overlay
  was never drawn (a plain conversion reported under this arm's name) or the screen was passed
  over twice.
- **`headless-kit-render`** — `services/headless-artist` rendering
  `fixtures/headless/project.json`, Chromium launch included.

The ESCAPECRAFT benchmarks assert nothing about speed either; their only `expect`s are the
twelve tripwires saying the benchmark measured the wrong thing — a take that stopped
mid-window; a "WebCodecs" take that encoded nothing, or that drew video into a canvas at all
(which would mean `WebCodecsRecorder` had taken its `startVideoElementCapture` fallback, a
different pipeline under the same name); a PiP take that composited nothing, or whose
`drawImage` count came out odd (which would mean a capture track was not ready for some
frames, so the two-draws-per-composited-frame divisor is wrong); a separate-tracks take that
did not run exactly two video encoders, or one of whose two encoded nothing, or that did not
run exactly two **audio** encoders (the mix on the primary plus the microphone companion — a
mode that quietly recorded its sound into the mix alone would look right in every published
number), plus the same two compositor checks now that it is drawing the preview; a
conversion that encoded no frames; and a composite conversion that did not draw exactly two
videos per encoded frame. The separate-tracks arm's wait for **three** library rows
after Stop is a thirteenth check in all but name: a take that stored a different number of parts
fails there rather than reporting a heap delta read mid-write.

`PERF_PROJECT_RESOLUTION=WxH` (e.g. `1920x1080`, `3840x2160`) overrides the preview scene's
project resolution for `preview-playback` only — the export benchmarks always render 720p
regardless — and on a machine whose sequential runs drift (observed up to several percent
across three consecutive `pnpm perf` invocations here), prefer **paired alternation** over a
plain before/after: swap base and patched code round-robin against one warm dev server and
run the benchmark spec directly, so drift affects both arms equally and cancels instead of
being charged to whichever ran second. See `docs/performance/2026-09-12-profile.md`'s "After
round 1" section for a worked example.

`PERF_PAINTER=raf` (ESCAPECRAFT's `craft-recording.spec.ts` only) swaps `mockSyntheticMedia`'s
synthetic source canvas from its default `setInterval(…, 33)` painter to a
`requestAnimationFrame` one; `apps/e2e/scripts/perf-paired.mjs [rounds=3]` runs the screen-take
benchmark alone, alternating the two painters round-robin, for a paired measurement of the
recorded frame rate specifically (ESCSUITE-86: it settled why the screen take reads
28.7–29.2 fps rather than 30 — see the note in
[docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md) —
and the benchmark keeps `setInterval` as its default painter regardless, so every other
`taskMsPerFrame` figure stays comparable).

CI runs them in a `perf` job that needs `build`, is `continue-on-error: true` and is
deliberately **not** in `ci-status`'s `needs` — runner CPU varies, so a number moving is
worth looking at and never worth blocking a merge on. It uploads `perf-report.json` (and
any `*.cpuprofile`) as the `perf-report` artifact.

`PERF_PROFILE=1 pnpm perf` additionally records a CPU profile of each browser benchmark —
on a **fourth, discarded run**, so the medians stay unprofiled — into
`apps/e2e/perf-results/*.cpuprofile`, alongside a `*.maps.json` holding the inline source
maps of every `/src/` module it sampled. `apps/e2e/scripts/profile-top.mjs` turns the pair
into top-by-self-time and top-app-code-by-total-time tables (also embedded in
`perf-report.json` when the profiles exist), resolving each frame through the maps so
locations are lines in the `.ts` files and not in Vite's transformed output. Its fold — a
sample is charged the interval that *follows* it, and recursion counts once per sample — is
covered by `apps/e2e/scripts/profile-top.test.mjs`, run by `pnpm test:scripts` (node:test,
no browser) in CI's `test` job.

ESCAPECRAFT's own baseline — the three benchmarks above over three consecutive `pnpm perf`
invocations, what each metric means, and the two findings the first measurement turned up
(the compositor holding ~23 fps against its own 30 fps target, **fixed** by ESCSUITE-54 and
now 30.0 with the paired before/after in the same file; and the first take of a session
costing a quarter of what every later take costs, still open) — is in
[docs/performance/2026-09-17-craft-baseline.md](docs/performance/2026-09-17-craft-baseline.md).

Baseline numbers, the machine they came from and the launch args they used live in
[docs/performance/2026-09-12-baseline.md](docs/performance/2026-09-12-baseline.md); the
hotspot analysis those profiles produced, and the ranked fix list it argues for, in
[docs/performance/2026-09-12-profile.md](docs/performance/2026-09-12-profile.md). Round 2's
timeline-interaction baseline (`apps/e2e/tests/perf/timeline-interaction.spec.ts`: a clip drag, a
marquee and a playhead scrub over the same scene, reporting layouts and JS per pointer move) is in
[docs/performance/2026-09-13-timeline-baseline.md](docs/performance/2026-09-13-timeline-baseline.md),
and round 2's before/after — what each fix moved, what is a dev-build artefact, the ranked
candidates with their status and the open follow-ups — in
[docs/performance/2026-09-13-timeline-profile.md](docs/performance/2026-09-13-timeline-profile.md).

**Per-frame ceilings** are the other half, and unlike the benchmarks they *do* assert.
Eight ordinary vitest files — `apps/artist/src/components/Preview/drawFrame.perf.test.ts`,
`apps/artist/src/core/exportMP4.perf.test.ts` and its twin
`apps/artist/src/core/exportWebM.perf.test.ts` (ESCSUITE-112: the same scene, the same splitter,
over the pipeline that draws media *elements* — `<video>`/`<img>` — straight onto the canvas
rather than decoded `VideoFrame`s, plus one measure with no equivalent on the MP4 side: seeks per
frame against the shared `<video>` element, steady-state and the one-time initialisation seek kept
separate so the count stays exact),
`apps/artist/src/components/Timeline/timelineGestures.perf.test.ts` (listeners, rects, snap-point
and render counts per pointer move), `apps/craft/src/core/compositor.perf.test.ts`,
`apps/craft/src/core/converter.perf.test.ts`,
`apps/craft/src/core/webcodecsRecorder.perf.test.ts` (level-monitor emissions, analyser and
planar buffers, frame/encode/flush and AudioContext lifecycles for one take — including a
separate-tracks take's audio companions: one `AudioData` created and closed per buffer per
pipeline, one encode each, one flush and one close each, and one `AudioContext` for all three)
and its mirror
`apps/craft/src/core/recorder.perf.test.ts` (the same emission rate for the MediaRecorder
path, so the two recorders' monitors cannot drift apart) — run the same scene through the same
doubles the behaviour tests use and count what one frame costs: 2D-context calls,
`drawImage`/`measureText`/`save`/`restore`, animation lookups, `getContext` calls, object
URLs, `VideoFrame`s created versus closed, `encode`/`flush` calls. They are `*.perf.test.ts`
rather than `bench` files on purpose: counts do not depend on the runner's CPU, so they can
be enforced in CI and in `test:coverage` like any other test. ARTIST's scene is the browser
benchmark's scene, built for unit tests in `apps/artist/src/test/fixtures/perfScene.ts`, so
a ceiling here and a millisecond figure there describe the same work.
**The rule: a ceiling is 2x the measured value rounded up, with the measurement and its date
in a comment beside it. Conservation laws (frames created == closed, one encode per frame,
balanced save/restore, one composite per animation frame) are asserted exactly. When a fix
lands, re-measure and lower the ceiling; never raise one without saying, in the PR, why the
new cost is correct.** A test that pins a *finding* rather than a target says so in its
comment, with the assertion to flip when the finding is fixed.

### Coverage policy

Each package (`apps/plan`, `apps/craft`, `apps/artist`, `packages/shared`,
`services/headless-artist`) enforces its own v8 coverage thresholds via
`test.coverage.thresholds` in its vitest/vite config (lines, statements, branches,
functions). `pnpm test:coverage` (`turbo test:coverage`) runs `vitest run --coverage`
in every package and fails the whole run if any package drops below its floor.

**Where it stands** — measured 2026-09-10, at the end of the coverage program
(`@escapesuite/craft` and `@escapesuite/artist` re-measured 2026-09-12; both again
2026-09-13, after the review follow-ups removed the dead overlay editors and closed the
cheap coverage gaps; `@escapesuite/artist` again at the end of performance round 2, whose
new tests moved statements and branches up a hundredth of a percent each and no floor,
and once more at the end of the keyframe-graph keyboard work — which moved all four
figures up and, again, no floor; and finally after the store decomposition into slices,
a pure move that left the branch denominator at 4,100 and every uncovered count unchanged —
the statements figure rose a hundredth as the ten covered slice creators enlarged the
denominator, and the branches entry was corrected from a stale 93.16 to the 93.17 the
numbers had already been). `@escapesuite/craft` was re-measured again 2026-09-15, after
the recorder-lifecycle fixes, which raised its branches floor 95 → 96, and once more the
same day after the record-button-truth fixes (the notice channel, the readiness gate, the
system-audio check and the storage-headroom flag), which moved statements, branches and
functions up a fraction and no floor. `@escapesuite/shared` was re-measured 2026-09-15
when the analytics gate added direct tests for `isSaaSMode()` / `isStandaloneMode()`,
raising its statements floor 97 → 98 and its functions floor 98 → 100. All three of
`@escapesuite/craft`, `@escapesuite/artist` and `@escapesuite/shared` were re-measured
2026-09-15 once more, when `useDialogBehaviour` moved out of CRAFT and into
`packages/shared` and ARTIST's export dialog dropped its own copy of the focus trap: that
raised shared's branches floor 88 → 90 (the hook brings 24 fully covered branches), moved
ARTIST up a fraction and no floor, and moved CRAFT down a fraction — it lost a file that
was covered outright — with no floor crossed either way. `@escapesuite/artist` was re-measured
2026-09-19 after the duration probe (headerless video, then audio: `extractVideoMetadata`'s
seek-to-end fallback lifted into one helper both paths call) added tests that moved statements,
branches and functions up a hundredth or two each, and no floor. `@escapesuite/craft` was
re-measured 2026-09-21 after the `webm-duration-fix` CJS-interop fix, whose new test covers
both arms of the resolver: statements, branches and functions each up a fraction, and no floor.
It was re-measured again 2026-09-22 when the audio-only (M4A) download added `convertToM4A`,
the M4A half of the download hook and the third library button: statements, branches and
functions each up a fraction, and no floor. `@escapesuite/artist` was re-measured 2026-09-23
after the resolution-change confirm adopted `useDialogBehaviour` and `VideoUploader`'s duplicate
project-load dialog was deleted: statements and branches up a few hundredths (the deleted
duplication took uncovered branches with it), lines down a hundredth, functions unchanged, and no
floor crossed either way. It was re-measured once more 2026-09-24, at the end of ESCSUITE-14
slice 1 (the webcam recorded as its own track): statements up a hundredth, branches and
functions down a few hundredths — the separate-tracks work enlarges every denominator, and the
second recording pipeline's defensive arms are the shape that costs branches — with **no floor
crossed**, so craft's floors stay 100 / 99 / 96 / 99. `@escapesuite/shared` was re-measured
the same day for the five optional `SourceVideo` fields and came back unchanged, the change
being types alone. Craft was re-measured once more 2026-09-25, when the final review's two
fixes landed (the controller reporting a companion lost inside the recorder, and
`initializeCompanion` warning instead of failing the take): lines still exactly 100.00,
branches up a hundredth to 96.81, statements and functions unchanged, and again no floor.
`@escapesuite/artist` was re-measured 2026-09-25 at the end of ESCSUITE-14 slice 2 (the
handoff resolving a take's parts and placing them on the timeline): all four figures up — lines
99.38, statements 98.71, functions 98.95 and branches 93.38 → 93.51, the new modules being
small, pure and fully covered — and **no floor crossed**, so artist's floors stay
99 / 98 / 93 / 98. `@escapesuite/craft` was re-measured 2026-09-25 at the end of ESCSUITE-14
slice 3 (the microphone and the system audio recorded as their own tracks beside the webcam):
lines still exactly 100.00, statements 99.33 → 99.39, functions unchanged at 99.52, and branches
96.82 → **97.36** — which crosses a whole percent, so craft's **branches floor goes 96 → 97** in
`apps/craft/vite.config.ts` and `scripts/coverage-report.mjs`, leaving its floors
100 / 99 / 97 / 99. The audio pipelines are the shape that pays for itself: one builder, one
callback and one failure arm each, all three reachable from the doubles. The craft row was also a
hundredth stale on two figures — it read 96.81 branches / 99.51 functions, while the commit this
slice started from measures 96.82 / 99.52 — and is corrected here along with the rest of the row.
`@escapesuite/craft` was re-measured 2026-09-25 at the end of ESCSUITE-14 slice 4 (the composite
MP4, `UPLOAD_RECORDING.parts`, the retired interim note): lines still exactly 100.00, and all
three of statements (99.39 → 99.45), branches (97.36 → **97.54**) and functions (99.52 → 99.53)
up a fraction — `core/overlayGeometry.ts` and `utils/takeParts.ts` are small, pure and fully
covered, and the retired note took an uncovered render branch with it — with **no floor crossed**,
so craft's floors stay 100 / 99 / 97 / 99. The two functions still uncovered are both in
`core/webcodecs-recorder.ts`, which this slice did not touch. It was re-measured again
2026-09-25 after the recorder resource-hygiene work (ESCSUITE-66): those last two functions were
the `.catch(() => {})` arrows in the old `cleanup()` reader teardown, which the release helpers
replaced, so **functions reached 100.00** (99.53 → 100.00) and its floor rises 99 → **100**;
statements and branches each moved up a hundredth (99.45 → 99.46, 97.54 → 97.55) and lines stayed
at exactly 100.00, no floor crossed. The recorder file's own branch *percentage* fell a
hundredth (94.55 → 94.48) while covering strictly more: the fix deleted three unreachable
guards, so the same fourteen pre-existing uncovered branches now sit on a denominator of 254
rather than 257. `@escapesuite/artist` was re-measured 2026-09-26 at the end of
ESCSUITE-65 slice 2 (the masked timeline thumbnail, the headless and e2e parity cases, and
this documentation sweep): 99.39 / 98.73 / **93.70** / 98.97, with `utils/maskClipPath.ts` a
dozen lines of pure translation carrying a test per arm and the thumbnail's four load-bearing
properties one each — and **no floor crossed**, so artist's floors stay 99 / 98 / 93 / 98. The
row was stale on all four figures: it still read the 99.38 / 98.71 / 93.51 / 98.95 of the end
of ESCSUITE-14 slice 2, while ESCSUITE-65 slice 1 finished at 99.39 / 98.73 / 93.68 / 98.97
(its own Task 7's measurement) without writing them down, and it is corrected here.
`@escapesuite/craft` was re-measured the same day and came back unchanged at
100.00 / 99.46 / 97.55 / 100.00 — slice 2 touched no craft **source** at all, which is why it
carries no changeset of its own: `git diff --name-only main -- apps/craft` lists that app's own
CLAUDE.md and nothing else, and this measurement confirms it.
It was re-measured once more 2026-09-26 for ESCSUITE-73 (the recorder disposed
while `initialize()` was still parked on one of its awaits): lines still exactly 100.00,
functions still exactly 100.00, statements 99.46 → 99.47 and branches 97.55 → **97.58** — the
one guard the fix adds is a single decision reached from both sides by the new tests, and the
two companion builders' re-raises are covered by the failure tests that were already there —
with **no floor crossed**, so craft's floors stay 100 / 99 / 97 / 100. It was re-measured once
more 2026-09-26 for ESCSUITE-74 (the converter releasing every encoder it builds from one place,
and an asynchronous codec failure reaching the caller in the codec's own words): lines still
exactly 100.00, functions still exactly 100.00, statements unchanged at 99.47 and branches
97.58 → **97.56**, with **nothing less covered than before** — the uncovered branch count is the
same 32 it was. The five `if (encoder && encoder.state !== 'closed')` guards the three
conversions each kept in their own `finally` were ten *covered* branches, and the one guarded
release that replaced them is two, so the denominator fell 1,325 → 1,315 and took the same ten
off the numerator: the same arithmetic the recorder's own percentage went through a day earlier,
for the same reason. **No floor crossed**, so craft's floors stay 100 / 99 / 97 / 100.
`@escapesuite/artist` was re-measured 2026-09-26 at the end of ESCSUITE-82 (a locked row
takes no drop): 99.40 / 98.75 / **93.77** / 98.98 — `trackRefusesDrop` and the two guards it
feeds are fully covered by the five new refusals and the ripple pin — and **no floor crossed**,
so artist's floors stay 99 / 98 / 93 / 98. The row had drifted a hundredth or two on every
figure across the ESCSUITE-73–80 follow-ups, which measured and did not write it down; it is
corrected here.
`@escapesuite/artist` was re-measured 2026-09-26 at the end of ESCSUITE-84 (a locked track is
locked for every component), final review round included: L / S / B / F —
99.40 / 98.75 / **93.93** / 98.99. `store/trackLock.ts`'s five pure questions are fully covered,
one test per question; the locked-track guard each project-, clip-, keyframe-, overlay- and
selection-slice action gained is reached from both sides by the new store tests (a refused
mutation and an allowed one), the two overlay adds' `null` return included; `findEmptyTrack`
skipping a locked track is pinned through `addClipToTimeline` and through a handed-over take;
and the four components that surface the lock — the inspector's per-section `<fieldset disabled>`
plus its notice, the media library's two disabled buttons, the preview refusing to open the
inline text editor, and `TrackHeader`'s disabled delete button — are covered by their own tests,
as is `useAppKeyboardShortcuts.ts`'s "Track is locked" toast on each of its five editing
branches. Branches moved the most (93.77 → 93.93) because the guards are almost all
early-return conditionals; functions moved a hundredth; lines held at 99.40, and statements
came back to the 98.75 they were at before the ticket — the review round's per-section
disabling and the two new refusals enlarge the denominator about as fast as their tests cover
it. **No floor crossed**, so artist's floors stay 99 / 98 / 93 / 98.
`@escapesuite/craft` was re-measured 2026-09-26 at the end of ESCSUITE-85 (the unwired
compatible-WebM re-encode deleted): lines still exactly 100.00, functions still exactly 100.00,
statements 99.47 → 99.49 and branches 97.56 → **97.59** — deleting covered code moves the
denominators, and the deleted path carried a few uncovered branches, so both figures went *up* —
with **no floor crossed**, so craft's floors stay 100 / 99 / 97 / 100. The row was two hundredths
stale on statements and branches (the ESCSUITE-78–81 follow-ups measured 99.51 / 97.64 and did
not write it down); it is corrected here to the figure measured on this branch.
`@escapesuite/artist` was re-measured 2026-09-26 at the end of ESCSUITE-87 (a refused store
write says so, and a gesture's undo entry follows the write that landed): all four figures up —
lines 99.40 → 99.41, statements 98.75 → 98.77, branches 93.93 → 93.96 and functions
98.99 → **99.01**, which crosses a whole percent, so artist's **functions floor goes 98 → 99**
in `apps/artist/vite.config.ts` and `scripts/coverage-report.mjs`, leaving its floors
99 / 98 / 93 / **99**. The new module is the reason: `hooks/useGestureHistory.ts` is four tiny
functions and one branch-per-line `commit`, and every one of them is reached by
`hooks/useGestureHistory.test.ts`'s twelve cases plus the three gestures that now share it. The
twelve store actions cost nothing either way — their guard moved out of the `set` updater and in
front of it, which is the same decision on a different line, and the refusal tests that already
covered both sides now also read the return value. Only `useSliderGesture`'s deleted flag getter
left, and its replacement is one delegation. Re-measured once more after the branch review's
four follow-ups (the keyframe graph's two nudges reading the boolean, `commit` surviving a write
that throws, and two wording fixes): **99.41 / 98.76 / 93.97 / 99.01** — branches up a hundredth
(every branch the review added is covered from both sides) and statements *down* a hundredth,
which is one statement exactly: `KeyframePanel`'s `handleKeyframeMoved` now guards with
`if (!selectedClipId) return false;` where it used to wrap its call in `if (selectedClipId)`, and
that `return false` is unreachable while the panel renders (its sibling in
`handleKeyframeValueChanged` has been uncovered for the same reason since it was written). Lines
and functions unmoved, and **no floor crossed** either way.

`@escapesuite/artist` was re-measured 2026-09-26 for ESCSUITE-88 (the keyframe panel and the
preview's transform handles honouring a locked track): **99.41 / 98.75 / 94.01 / 99.01** — lines
and functions unmoved, branches up four hundredths and statements *down* one, with **no floor
crossed**, so artist's floors stay 99 / 98 / 93 / 99. The whole of the movement is one line.
**Every `locked` guard the ticket adds is covered from both sides** — the two pointer refusals
and the double-click refusal in `KeyframeGraph.tsx`, both refusals in `KeyframeTrack.tsx`, the
mousedown and the two cursor arms in `useTransformHandles.ts` (the `not-allowed` for a row locked
*mid-gesture* has a test of its own) and `removeClipKeyframe`'s new pre-`set` guard — and
`hooks/useKeyframeGraphKeyboard.ts`, which the announcement lives in, is 100% on all four
metrics. What the branch adds to the uncovered column is **exactly one statement and the one
branch on the same line**: `KeyframePanel.tsx`'s `handleDeleteKeyframe` guarding with
`if (!selectedClipId) return false;`, which is unreachable while the panel renders — the graph is
only mounted when there *is* a selected clip — and is the third sibling of a guard whose other
two, in `handleKeyframeMoved` and `handleKeyframeValueChanged`, have been uncovered for the same
reason since ESCSUITE-87 wrote them. Every other uncovered statement in the six measured source
files this ticket touches predates it, and all of them are defensive null guards of the same kind:
`if (!svg)` / `if (!coords)` / `if (!prev)` in `KeyframeGraph.tsx`, `if (!track)` in
`KeyframeTrack.tsx`, the older `if (!selectedClipId)` / `if (!selectedClip)` guards and the audio
section's `onSelect` arrow in `KeyframePanel.tsx`, and the `if (!clip)`-shaped guards in
`useTransformHandles.ts` and `keyframeSlice.ts`.

`@escapesuite/artist` was re-measured 2026-09-26 for ESCSUITE-89 (every control in the clip
inspector carrying an accessible name): **99.41 / 98.76 / 94.02 / 99.01** against the
99.41 / 98.75 / 94.01 / 99.01 the commit this branch started from measures — lines and functions
unmoved, statements and branches each up a hundredth. The change is labels, so there is almost
nothing new to count: the branch denominator moves 4,480 → 4,484 and every one of those four is
covered. All four are one expression — `ShapeSection`'s no-fill toggle naming itself
`hasVisibleFill(shapeData.fillColor || '#000000ff') ? 'No fill' : 'Enable fill'`, which is two
branches for the `||` default and two for the ternary, all reachable from that section's own
tests. Nothing else in the change branches at all: the `useId()` line each section gained is a
statement, `aria-pressed={textData.fontWeight === 'bold'}` is a comparison, and the aspect-ratio
padlock's name is a constant (the review turned its state-changing `aria-label` into a fixed one
beside `aria-pressed`, which is also why this count is four rather than six). **The branches
floor goes 93 → 94** in `apps/artist/vite.config.ts` and `scripts/coverage-report.mjs`, leaving artist's
floors 99 / 98 / **94** / 99 — and almost none of that rise is this ticket's: branches crossed 94
in ESCSUITE-88, whose paragraph above reports 94.01, updates the table row to match and then says
"no floor crossed", which was a miscount of that one figure. The floor is raised here because a
floor is the achieved coverage rounded down, not because these labels earned a percent.

`@escapesuite/artist` was re-measured 2026-09-26 for ESCSUITE-90 (the preview's selection chrome
sized in screen pixels rather than project pixels): **99.41 / 98.76 / 94.03 / 99.01** against the
99.41 / 98.76 / 94.02 / 99.01 the commit this branch started from measures — branches up a
hundredth and the other three unmoved, with **no floor crossed**, so artist's floors stay
99 / 98 / 94 / 99. **Nothing new is uncovered**: the uncovered counts are identical on all four
metrics (41 lines, 98 statements, 268 branches, 17 functions), and every unit the branch adds is
covered — lines 6,949/6,990 → 6,954/6,995, statements 7,811/7,909 → 7,817/7,915, branches
4,216/4,484 → 4,224/4,492, functions 1,705/1,722 → 1,706/1,723. The eight new branches are the
`screenScale` default argument in each of the four scaled functions — `drawSelectionHandles`,
`drawMultiSelectHandles`, `hitTestHandles`, `hitHandlesOnClip`, one apiece — plus the four in
`PreviewPlayer`'s `handleScreenScale`, its `if (!box)` and its `scaleX > 0 ? … : 1` counting two
paths each. Every one of them is reached from both sides: the new
`screenScale = 4` cases in `selectionOverlay.test.ts` / `hitTest.test.ts` against the
default-scale cases that were already there, and in the component the 4K-in-a-640px-box case
against the box-equals-the-project one. `handleScreenScale`'s `scaleX > 0 ? … : 1` guard — a
preview whose panel has been dragged shut reports a 0x0 box, and dividing by it would put an
infinity into every handle rectangle — has a test of its own for exactly that reason; without it
that arm would have been the branch's single new uncovered decision. The six branches still
uncovered in `PreviewPlayer.tsx` all predate this ticket.

`@escapesuite/artist` was re-measured 2026-09-27 at the end of ESCSUITE-91 (the toolbar's Delete
greys out for a selection that touches a locked track): 99.41 / 98.76 / **94.01** / 99.01. The
change adds one ternary — two branches — to `Toolbar.tsx`, both reached by the new locked and
unlocked cases, so that file measures 37 / 37. The branch figure reads two hundredths *below* the
94.03 the ESCSUITE-90 row recorded, and that is not this change: measured in one sitting, the merge
base gives 4,225 / 4,494 and this branch 4,227 / 4,496 — both 94.01 — so the 94.03 was the
previous run's arithmetic on a slightly different denominator, and the row is corrected to what two
matched runs agree on. **No floor is crossed**; artist's floors stay 99 / 98 / 94 / 99.
`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-93 (a take cancelled while the capture
request is outstanding releases what it was handed, and one start at a time): lines still exactly
100.00, functions still exactly 100.00, statements 99.49 → **99.50** and branches unchanged at 97.59,
against a merge base measured in the same sitting at 100.00 / 99.49 / 97.59 / 100.00. The change adds
exactly four branches — `if (startingRef.current)` and the post-`acquireStreams()`
`if (cancelledRef.current)`, two each — and every one is reached from both sides by the three new
controller cases, so the uncovered branch count is the same 31 it was. **No floor crossed**; craft's
floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-95 (splitting a clip rebases its
keyframes and presets instead of copying the whole animation onto both halves):
99.41 / 98.76 / **94.03** / 99.01 against the 99.41 / 98.76 / 94.01 / 99.01 of the commit this
branch started from — branches up two hundredths, the other three unmoved. Measured in one sitting,
the merge base gives 4,227 / 4,496 branches and this branch 4,243 / 4,512: sixteen new branches,
sixteen covered, the same 269 uncovered as before. They are all in `utils/animation.ts`'s
`splitAnimation` — the two partition filters, the two "is there a keyframe at or past / before the
cut" conditions that decide whether a boundary keyframe is synthesised, the exact-at-split check and
the preset ownership — and every one is reached from both sides by that function's own unit cases
(the split-before-the-first-keyframe and the within-epsilon cases exist for exactly that reason).
`store/clipSlice.ts`'s `splitClip` gained no branch: it replaced a spread with `cloneClip` and one
call. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-94 (the export resolution presets
rescale the project onto the output raster instead of letterboxing or cropping it):
99.41 / **98.77** / **94.06** / 99.01 against the 99.41 / 98.76 / 94.03 / 99.01 the commit this branch
was rebased onto measures — statements up a hundredth, branches up three, lines and functions unmoved.
Measured in one sitting, the base gives 4,243 / 4,512 branches and this branch 4,266 / 4,535:
twenty-three new branches, twenty-three covered, the same 269 uncovered as before, and the same on
the other three metrics (statements 7,858 / 7,956 → 7,872 / 7,970, lines 6,989 / 7,030 →
7,002 / 7,043, functions 1,713 / 1,730 → 1,717 / 1,734 — every denominator grew by exactly what the
numerator did). The new module `core/outputTransform.ts` is 100% on all four: its two degenerate-size
guards, the two "exact fit or bar" ternaries in the offset, and `getResolution`'s aspect-source ternary
are each reached from both sides by the tests that drive a 0×0 project, a taller raster, a wider raster
and the exact-fit case, and each exporter's `projectResolution && w > 0 && h > 0` clause is evaluated by
every test that passes a resolution. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-106 (during the 3-2-1 countdown the
record button cancels the countdown instead of pretending to stop a take that has not started):
100.00 / 99.50 / **97.60** / 100.00 against the 100.00 / 99.50 / 97.59 / 100.00 the commit this branch
was rebased onto measures — branches up a hundredth, the other three unmoved. Measured in one sitting,
the base gives 1,260 / 1,291 branches and this branch 1,266 / 1,297: six new branches, six covered, the
same 31 uncovered as before, and the statement count unchanged at 2,396 / 2,408 — the change is the
`countdown` arm of `RecorderControls`' label, title and handler ternaries, each reached from both
sides by the new cases (the button mid-countdown, and every other state's button unchanged). `App.tsx`
is untouched, so the per-tick render pins hold by construction. **No floor crossed**; craft's floors
stay 100 / 99 / 97 / 100.

`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-105 (the MediaRecorder path's
`getDuration()` no longer counts the final pause when a take is stopped while paused):
100.00 / 99.50 / **97.61** / 100.00 against the 100.00 / 99.50 / 97.60 / 100.00 the commit this branch
was rebased onto measures — branches up a hundredth, the other three unmoved. Measured in one sitting,
the base gives 1,266 / 1,297 branches and this branch 1,268 / 1,299, statements 2,396 / 2,408 →
2,398 / 2,410: the change is one `if (state === 'paused')` latch in `Recorder.stop()`, two branches
and two statements, reached from both sides by the new fake-timer case (stopped while paused) and the
six stop-while-recording cases that were already there; the same 31 branches are uncovered as before.
`WebCodecsRecorder` gained a twin case and no code — it never had the bug. **No floor crossed**;
craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-98 (a cancelled export can no longer
clobber the export started after it): 99.41 / 98.77 / **94.08** / **99.02** against the
99.41 / 98.77 / 94.06 / 99.01 the commit this branch was rebased onto measures — branches up two
hundredths, functions up one, lines and statements unmoved. Measured in one sitting, the base gives
4,266 / 4,535 branches and this branch 4,280 / 4,549: fourteen new branches, fourteen covered, the same
269 uncovered as before (statements 7,872 / 7,970 → 7,883 / 7,981, lines 7,002 / 7,043 →
7,011 / 7,052, functions 1,717 / 1,734 → 1,718 / 1,735, every denominator growing by exactly what the
numerator did). The new branches are the `isCurrentRun()` guards in `ExportDialog.tsx` — around the
progress write, the complete write, the download and the `EXPORT_COMPLETE` post, the self-close timer,
and the identity check in the `finally` — each reached from both sides by the stale-run cases (late
progress, late success, late failure, the × during the complete window) against the ordinary single-run
export that still downloads and posts exactly once. The review's first pass found one of those guards,
the self-close timer's, uncovered and claimed unreachable; it is reachable through the header ×, and the
fake-timer case that drives it is why the count is fourteen of fourteen. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-103 (deleting the recording that is
converting aborts the conversion instead of stranding the one slot; thumbnail URLs revoked on remove and
reload; the cascade delete companions-first with one notice on failure): 100.00 / 99.50 / **97.63** /
100.00 against the 100.00 / 99.50 / 97.61 / 100.00 the commit this branch was rebased onto measures —
branches up two hundredths, the other three unmoved. Measured in one sitting, the base gives
1,268 / 1,299 branches and this branch 1,280 / 1,311, statements 2,398 / 2,410 → 2,425 / 2,437: twelve
new branches and twenty-seven new statements, every one covered, the same 31 branches and 12 statements
uncovered as before. The new decisions are the delete handler's "is this the converting row" check, the
post-read abort re-check and the throw-as-still-exists arm in `useMp4Download`, the `blob:` guards on both
revocations in `recorderStore`, and the per-part try/catch in `useRecordingLibrary`'s cascade — each
reached from both sides by the cases that start a conversion and delete its row, cancel while the
existence re-read is parked, make that re-read throw, reload the library twice, and make the second
companion's delete reject. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-100 (paste always lands at the playhead
and refuses a track that no longer exists): 99.41 / 98.77 / **94.12** / 99.02 against the
99.41 / 98.77 / 94.08 / 99.02 the commit this branch was rebased onto measures — branches up four
hundredths, the other three unmoved. Measured in one sitting, the base gives 4,280 / 4,549 branches
and this branch 4,291 / 4,559: ten more branches in the denominator but eleven more covered, because the
deleted `state.currentTime || minPosition + 0.5` default took its never-tested arm with it, so the
uncovered count fell 269 → 268 — the one time this week a paragraph has had *fewer* uncovered branches
to report. The eleven new ones are `pasteClips`' off-timeline `some()` guard, the `clipboard &&
clipboard.some(...)` ternaries in `removeTrack` and `removeSourceVideo`, and the keyboard paste's toast on
`false`, each reached from both sides by the new refusal, pruning and paste-at-zero cases against the
successful pastes that were already there (statements 7,883 / 7,981 → 7,897 / 7,995, lines
7,011 / 7,052 → 7,021 / 7,062, functions 1,718 / 1,735 → 1,724 / 1,741, every denominator growing by
exactly what the numerator did). **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-104 (the save reads the take's own
config for system audio, the webcam and its placement, and the sidebar locks from preparing through
saving while the meters show only for a live take): 100.00 / 99.50 / **97.64** / 100.00 against the
100.00 / 99.50 / 97.63 / 100.00 the commit this branch was rebased onto measures — branches up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 1,280 / 1,311 branches and
this branch 1,283 / 1,314, statements 2,425 / 2,437 → 2,430 / 2,442: three new branches and five new
statements, every one covered, the same 31 branches and 12 statements uncovered as before. The three
are `App.tsx`'s `sidebarLocked` disjunction (reached from the mid-take, preparing and saving cases
against idle) and the `showMeters` gate that keeps the audio meters on the live-take states only —
which the review caught this branch's first version sweeping into the same flag, so the bars lingered
through the save frozen at the last level; the case that pins them absent in `'saving'` is why the
count is three of three. `RecordingSaveDeps` lost its `config` field outright, so nothing new branches
in `useRecordingSave`. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-96 (restoring a session rebuilds each
thumbnail from storage instead of a dead `blob:` handle, and the now-asynchronous restore is guarded
against a decline, a second click and a rejected read): **99.42** / 98.77 / **94.13** / 99.02 against the
99.41 / 98.77 / 94.12 / 99.02 the commit this branch was rebased onto measures — lines and branches up a
hundredth each, statements and functions unmoved. Measured in one sitting, the base gives
4,291 / 4,559 branches and this branch 4,301 / 4,569: ten new branches, ten covered, the same 268
uncovered as before (statements 7,897 / 7,995 → 7,928 / 8,026, lines 7,021 / 7,062 → 7,049 / 7,090,
functions 1,724 / 1,741 → 1,728 / 1,745, every denominator growing by exactly what the numerator did).
The ten are `resolveThumbnailUrl`'s stored-or-not ternary in `core/storage.ts`, the snapshot's
"already undefined" guard in `app/sessionSnapshot.ts`, and in `app/useSessionRestore.ts` the re-entry
guard, the attempt check before the commit, and the failure arm's own attempt check — each reached from
both sides by the restore, decline-during-restore, double-click and rejected-read cases, against the
plain restore that was already there. Two review rounds put the last five there: the first found the
async restore racing "Start Fresh", the second found a rejected read stranding the prompt with the guard
set. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-27 for ESCSUITE-107 (a thumbnail write that fails no
longer fails the whole save): 100.00 / 99.50 / 97.64 / 100.00, byte-identical to the
100.00 / 99.50 / 97.64 / 100.00 the commit this branch was rebased onto measures. Measured in one
sitting, statements 2,430 / 2,442 → 2,433 / 2,445 and lines 2,287 → 2,290, all covered; branches
unchanged at 1,283 / 1,314 — the fix is a try/catch around the primary's `storeThumbnail`, which
Istanbul counts as statements rather than a decision, and the two new cases (a plain take and a
separate-tracks take whose thumbnail write rejects) reach the catch arm while the rest of the suite
keeps the success arm. The same 31 branches and 12 statements are uncovered as before. **No floor
crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-108 (the never-populated preview frame
cache and the uncalled export scheduler deleted): **99.49** / **98.83** / 94.11 / **99.35** against the
99.42 / 98.77 / 94.13 / 99.02 the commit this branch was rebased onto measures. This is the one
paragraph this week where every denominator *shrank*: lines 7,049 / 7,090 → 6,868 / 6,903, statements
7,928 / 8,026 → 7,734 / 7,825, functions 1,728 / 1,745 → 1,689 / 1,700 and branches 4,301 / 4,569 →
4,225 / 4,489 — the two deleted modules were fully covered, so removing them took covered units out of
the numerator as fast as the denominator, and the *uncovered* counts fell too (lines 41 → 35, statements
98 → 91, functions 17 → 11, branches 268 → 264) because the cache-hit path and the Clear-Cache button
carried defensive arms nothing reached. Branches read two hundredths lower than the base for that reason
alone — nothing new is uncovered — and the functions figure is the story: the first measurement of the
bare deletion came back at 1,672 / 1,689 = **98.99**, a hundredth under the 99 floor, because 45 fully
covered functions had gone and the same 17 stayed uncovered. Floors never go down, so the fix round
covered six of those 17 with behaviour tests (the export worker's four easing arrows and its transition
sort comparator, and `analytics.exportFailed`) and the figure is 99.35. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-102 (a project is validated before the
editor is reset or a host payload applied): 99.49 / **98.84** / **94.15** / 99.35 against the
99.49 / 98.83 / 94.11 / 99.35 the commit this branch was rebased onto measures — statements up a
hundredth, branches up four, lines and functions unmoved. Measured in one sitting, the base gives
4,225 / 4,489 branches and this branch 4,251 / 4,515: twenty-six new branches, twenty-six covered, the
same 264 uncovered as before (statements 7,734 / 7,825 → 7,766 / 7,857, lines 6,868 / 6,903 →
6,899 / 6,934, functions 1,689 / 1,700 → 1,691 / 1,702, every denominator growing by exactly what the
numerator did). The new branches are `parseProject`'s shape checks in `store/projectMigration.ts` — no
timeline, `tracks` present but not a list, no `clips` list, a clip without a string id, a duplicate id, a
`trackId` naming no track after migration — plus the parse-before-reset gate in `useProjectActions` and
the `LOAD_PROJECT` refusal in `useHostIntegration`, each reached from both sides. Two of the rejection
arms were untested when the branch was first measured on its rebased tree; the round that covered them
is why the count is twenty-six of twenty-six. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-101 (the selection is pruned when a clip
leaves the timeline, and a no-op edit refuses instead of pushing an undo entry): 99.49 / 98.84 /
**94.18** / 99.35 against the 99.49 / 98.84 / 94.15 / 99.35 the commit this branch was rebased onto
measures — branches up three hundredths, the other three unmoved. Measured in one sitting, the base
gives 4,251 / 4,515 branches and this branch 4,279 / 4,543: twenty-eight new branches, twenty-eight
covered, the same 264 uncovered as before (statements 7,766 / 7,857 → 7,808 / 7,899, lines
6,899 / 6,934 → 6,933 / 6,968, functions 1,691 / 1,702 → 1,698 / 1,709, every denominator growing by
exactly what the numerator did). The new branches are `store/selectionPrune.ts`'s empty-selection
early return and its "did anything drop" check, the ghost-before-lock ordering in
`deleteSelectedClips`, the three refusals in `removeClipKeyframe` (unknown clip, a clip with no
`animation` at all, no keyframe within `KEYFRAME_TIME_EPSILON`), the "would anything change" probes in
mute / unmute, `splitClip` carrying the first half into a multi-selection, and the keyboard Delete's
toast gated on the return — each reached from both sides by the paste → undo → Delete sequence, the
seven ghost-pruning cases, the refusal cases and the successful edits that were already there. **No
floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-97 (a saved project keeps its sources'
metadata, and an old file's duration probe can no longer return `Infinity`): 99.49 / 98.84 /
**94.19** / 99.35 against the 99.49 / 98.84 / 94.18 / 99.35 the commit this branch was rebased onto
measures — branches up a hundredth, the other three unmoved. Measured in one sitting, the base gives
4,279 / 4,543 branches and this branch 4,287 / 4,551: eight new branches, eight covered, the same 264
uncovered as before. The other three denominators *shrank* by a little — lines 6,933 / 6,968 →
6,932 / 6,967, statements 7,808 / 7,899 → 7,807 / 7,898, functions 1,698 / 1,709 → 1,694 / 1,705 —
because `extractMetadataFromBlob`'s two hand-rolled `<video>` / `<audio>` promise probes became calls
to the shared `loadMediaDuration`, and the four arrows those promises carried went with them; the
uncovered counts (35 / 91 / 11) did not move. The eight new branches are the `meta ? … : …` choice in
`loadProject`, `resolveStoredDuration`'s "usable or recover" arm applied to a saved duration,
`isUsableDimension` and the dimension fallback, and the identity-preserving spread — each reached
from both sides by the round-trip case, the old-format file, the `null` / `Infinity` durations, the
audio-only 0×0 source and the smuggled `thumbnailUrl`. **No floor crossed**; artist's floors stay
99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-27 for ESCSUITE-99 (the dead export-worker audio mixer
and its support probe deleted; a clip whose track is gone is skipped when mixing): **99.52** / **98.86**
/ **94.53** / **99.39** against the 99.49 / 98.84 / 94.19 / 99.35 the commit this branch was rebased
onto measures — every figure up, and for the second time this week because every denominator shrank:
lines 6,932 / 6,967 → 6,664 / 6,696, statements 7,807 / 7,898 → 7,513 / 7,599, functions
1,694 / 1,705 → 1,648 / 1,658 and branches 4,287 / 4,551 → 4,134 / 4,373. Unlike ESCSUITE-108's
deletion, this one took *uncovered* units out too — lines 35 → 32, statements 91 → 86, functions
11 → 10, branches 264 → 239 — because `workers/exportWorker.ts` and the worker arm of
`core/audioMixer.ts` carried defensive branches that only a real worker could reach, and a real
worker never opened (`OfflineAudioContext` is `[Exposed=Window]`; the probe tested for it inside a
DedicatedWorker and always answered false, verified in Chromium before the ruling). Five of the six
functions ESCSUITE-108's round covered to hold the functions floor lived in that worker and are gone
with it; the floor holds with room because the 45-then-50 functions removed across the two deletions
were the covered ones. The one new decision, the missing-track skip in the main-thread mixer, is
reached from both sides by the inverted pin and the mixes that were already there. **No floor
crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-112 (a per-frame ceiling file for the
WebM exporter, the twin of `exportMP4.perf.test.ts`): 99.52 / 98.86 / 94.53 / 99.39, byte-identical to
the commit this branch was rebased onto on every metric and every count — lines 6,664 / 6,696,
statements 7,513 / 7,599, functions 1,648 / 1,658, branches 4,134 / 4,373. The change is a test file
and a documentation clause and touches no source, and the WebM frame loop it exercises was already
covered by the behaviour tests, so nothing moved. What the file adds is not coverage but conservation:
one `setTransform`, balanced save/restore, one `getContext`, one `encode` and one `VideoFrame`
created-and-closed per frame, and a seek count that is exactly one init seek per element plus two
per frame. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-111 (the export presets print their own
dimensions, and the unreachable `'original'` resolution is gone): 99.52 / 98.86 / 94.53 / 99.39,
the same four figures as the commit this branch was rebased onto, with the same 32 / 86 / 10 / 239
uncovered. The branch denominator moved 4,373 → 4,371 and the numerator with it: `getResolution` lost
the `|| originalHeight` fall-through that let an unknown value produce a plausible size (it throws now,
and the throw has a test through `as never`), and the label helper is branch-free. One arm did go
uncovered on the way and is why the count is exact: the `'project'` fallback's odd-dimension rounding
had been exercised only through the deleted `'original'` tests, so a case was added that hands it an
odd source (1281×721 → 1282×722). The sub-pixel bar a preset's round-to-even width can still leave is
now pinned at the exporter level too (480p of 1280×720 → `setTransform` `[2/3, 0, 0, 2/3, 1/3, 0]` in
both exporters), replacing the two deleted `'original'` letterbox tests. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-109 (an attempt token replaces the start
gate, and the capture request has a deadline): 100.00 / **99.51** / **97.65** / 100.00 against the
100.00 / 99.50 / 97.64 / 100.00 the commit this branch was rebased onto measures — statements and
branches up a hundredth each, lines and functions still exactly 100. Measured in one sitting, the base
gives 1,283 / 1,314 branches and this branch 1,293 / 1,324, statements 2,433 / 2,445 → 2,459 / 2,471:
ten new branches and twenty-six new statements, every one covered, the same 31 branches and 12
statements uncovered as before. The new decisions are the token comparisons after each `await` in the
start path — the "someone else owns the refs" return that the review's first pass found missing (a
stale attempt's `initialize()` was tearing down the take that replaced it and leaving the UI parked in
`preparing`), and the reduced tear-down guard beside it — plus the deadline race and the late-arrival
release, each reached from both sides by the cancel-then-restart cases in both settle orders, the
superseded-setup case, the expiry, late-arrival and late-rejection cases, and the fresh start after a
failed one. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-110 (a trim rebases the clip's animation
from the gesture's origin, through an explicit `trimClip`): 99.52 / **98.87** / **94.56** / **99.40**
against the 99.52 / 98.86 / 94.53 / 99.39 the commit this branch was rebased onto measures — statements,
branches and functions each up a hundredth or three, lines unmoved. Measured in one sitting, the base
gives 4,134 / 4,373 branches and this branch 4,155 / 4,394: twenty-one new branches, twenty-one covered,
the same 239 uncovered as before (statements 7,513 / 7,599 → 7,550 / 7,636, lines 6,664 / 6,696 →
6,696 / 6,728, functions 1,648 / 1,658 → 1,657 / 1,667, every denominator growing by exactly what the
numerator did). The new branches are `cutEnd` / `cutStart` — the two halves of what used to be
`splitAnimation`'s body, now shared with `trimAnimation` — the preset clamp that skips a `'none'` side,
and in `store/clipSlice.ts` the `trimClip` action's edge choice and lock guard. The first version of
the store wiring carried three more: two defensive operands that no caller could reach (a duration
guard and a `??` fallback beside the explicit `edge`), which the review found and round 2 deleted
rather than tested — `clipSlice.ts` is back to the same two uncovered arms it had before the ticket.
**No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-113 (a source's `blob:` thumbnail
handle is freed by whoever drops it — the store on remove, reset and replace-in-place, the load path
for a refused file — and scrubbed out of the undo history so an undo cannot restore a dead URL):
99.52 / **98.88** / **94.58** / 99.40 against the 99.52 / 98.87 / 94.55 / 99.40 the commit this branch
was rebased onto measures — statements up a hundredth, branches up three, lines and functions unmoved.
Measured in one sitting, the base gives 4,153 / 4,392 branches and this branch 4,178 / 4,417:
twenty-five new branches, twenty-five covered, the same 239 uncovered as before (statements
7,554 / 7,640 → 7,593 / 7,679, lines 6,700 / 6,732 → 6,733 / 6,765, functions 1,658 / 1,668 →
1,667 / 1,677, every denominator growing by exactly what the numerator did; the uncovered counts —
32 lines, 86 statements, 239 branches, 10 functions — are identical on both trees). The new
branches are `revokeSourceThumbnails`'s `blob:` guard in `core/storage.ts`; in
`store/projectSlice.ts` the `previous` lookup and the three-operand "held, has a handle, and the
handle differs" condition on `addSourceVideo`'s replace-in-place arm, `removeSourceVideo`'s
unknown-id refusal (an id naming no source is a no-op, not an undo step) and its scrub-or-not
ternary; in `store/storeHistory.ts` `scrubDeadThumbnails`'s empty-list early return, its
per-snapshot "carries a dead URL" probe and the per-source replacement; and in
`app/useProjectActions.ts` the refused-load revoke, the catch's `mintedButNotYetOwned` guard and
the indexed loop that shrinks it after each source the store takes in — each reached from both
sides by the same-URL re-add, the changed-URL replace, the undo-after-replace, the unknown id, the
refused parse, the throw-before-add and the throw-partway-through-three-sources cases against the
plain adds and removes that were already there. Three review rounds put the last of those there: the
first moved ownership of a restore's stale handles from an up-front sweep (which killed the CRAFT
handoff's still-live tiles) into `addSourceVideo`'s replace arm; the second closed the unknown-id
gap; the third pinned the partial-throw slice. The base row reads 94.55 where ESCSUITE-110's
paragraph recorded 94.56 on its own rebased tree — two branches of Istanbul drift on a denominator
of 4,392, the same kind ESCSUITE-91's row noted — and the comparison here is between two runs in one
sitting. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-118 (the recorder's callbacks carry
the identity of the take they were built for): 100.00 / 99.51 / **97.67** / 100.00 against the
100.00 / 99.51 / 97.65 / 100.00 the commit this branch was rebased onto measures — branches up two
hundredths, the other three unmoved. Measured in one sitting, the base gives 1,293 / 1,324 branches
and this branch 1,301 / 1,332, statements 2,459 / 2,471 → 2,468 / 2,480, lines 2,313 → 2,318: eight
new branches and nine new statements, every one covered, the same 31 branches and 12 statements
uncovered as before. The eight are the `recorderRef.current !== me` guards on `onStart`, `onPause`,
`onResume`, `onStop` and `onError` in `useRecordingController.ts`, each reached from both sides by
the seven new cases (a late `onError` / `onStop` / `onStart` / `onPause` / `onResume` from a
disposed recorder against the live take's own callbacks, and a recorder's own `onStop` after its
own `onError` disposed it). The first measurement of the branch came back at 1,302 / 1,334 — one
*more* uncovered arm than the base — because `onStop`'s old `if (cancelledRef.current) return;` had
become unreachable behind the new guard: every path that raises `cancelledRef` disposes the
recorder on the same line, so the identity check always returned first. Round 2 deleted it rather
than tested it, the way ESCSUITE-110 treated its unreachable operands, and the denominator settled
two lower. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-115 (`removeClipFromTimeline` refuses an
id that names no clip, and `setProject` prunes the selection against the incoming timeline):
99.52 / 98.88 / **94.59** / 99.40 against the 99.52 / 98.88 / 94.58 / 99.40 the commit this branch was
rebased onto measures — branches up a hundredth, the other three unmoved. Measured in one sitting, the
base gives 4,178 / 4,417 branches and this branch 4,182 / 4,421: four new branches, four covered, the
same 239 uncovered as before (statements 7,593 / 7,679 → 7,600 / 7,686, lines 6,733 / 6,765 →
6,739 / 6,771, functions 1,667 / 1,677 → 1,668 / 1,678, every denominator growing by exactly what the
numerator did; the uncovered counts — 32 lines, 86 statements, 239 branches, 10 functions — are
identical on both trees). The four are `removeClipFromTimeline`'s unknown-id refusal in
`store/clipSlice.ts` (the guard `rippleDeleteClip` already had, now with the ESCSUITE-87 boolean it
was missing) and the keyboard Delete's `else if (removeClipFromTimeline(...))` in
`hooks/useAppKeyboardShortcuts.ts`, each reached from both sides by the unknown-id and known-id
cases and the stale-selection Delete against the one that lands. `setProject` gained no branch of its
own: it hands the incoming clip ids to ESCSUITE-101's `pruneSelection`, whose arms were already
covered, and the three new `setProject` cases (selection fully present, partly present, empty) reach
them again. The review's one MAJOR — the locked-track refusal's `false` asserted through the
write-only `refuses` helper rather than `reportsRefusal` — moved no figure: that arm was executed
either way, which is exactly why the contract needed the stronger assertion. **No floor crossed**;
artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-114 (the audio levels zero at the end
of every take — stop, cancel, a cancelled countdown, unmount — and the App suites wait for the save's
outcome instead of a fixed round count): 100.00 / 99.51 / 97.67 / 100.00, byte-identical to the
100.00 / 99.51 / 97.67 / 100.00 the commit this branch was rebased onto measures. Measured in one
sitting, lines 2,318 → 2,324, statements 2,468 / 2,480 → 2,474 / 2,486 and functions 449 → 450, every
new unit covered; branches unchanged at 1,301 / 1,332 — the change adds no decision at all.
`zeroAudioLevels()` is one unconditional store write shared by the stop path and the three cancel
paths, and the harness's `renderAppWithLibrary(expectedCount)` and the `waitFor` conversions are
test code. The same 31 branches and 12 statements are uncovered as before. The review's two MAJORs
were behavioural, not coverage: a cancel never called `stop()`, so the meters opened the next
countdown on the previous take's last reading (now pinned at `'countdown'`, where `showMeters` is
true, rather than at `'preparing'`, where it is not), and the harness's own `renderApp()` flush
waits on a real fake-indexeddb `loadRecordings` with one turn of headroom — left byte-identical
because the re-render pin files depend on it, with the library suite waiting on the loaded row
count instead. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-117 (a source restored by undo gets
its thumbnail back through a non-undoable `setSourceThumbnail` and the media library's lazy rebuild;
every mock object URL a distinct handle; the `?loadVideo=` handoff keeping no thumbnail owner of its
own): 99.52 / 98.88 / **94.61** / 99.40 against the 99.52 / 98.88 / 94.59 / 99.40 the commit this
branch was rebased onto measures — branches up two hundredths, the other three unmoved. Measured in
one sitting, the base gives 4,182 / 4,421 branches and this branch 4,201 / 4,440: nineteen new
branches, nineteen covered, the same 239 uncovered as before (statements 7,600 / 7,686 →
7,631 / 7,717, lines 6,739 / 6,771 → 6,765 / 6,797, functions 1,668 / 1,678 → 1,679 / 1,689, every
denominator growing by exactly what the numerator did; the uncovered counts — 32 lines, 86
statements, 239 branches, 10 functions — are identical on both trees, file by file). The nineteen
are `setSourceThumbnail`'s four refusals in `store/projectSlice.ts` (unknown id, same URL, a
different live `blob:` handle already on the source — which revokes the incoming one — and the
write itself), `revokeThumbnailUrl`'s `blob:` guard in `core/storage.ts` that
`revokeSourceThumbnails` is now written in terms of, and in `components/VideoUploader.tsx` the
rebuild effect's in-flight `??=`, its per-source "has no thumbnail" filter and the three arms of the
guard a landed read passes — the source has left the library, the editor has unmounted, a real load
got there first — each reached from both sides by the store's five `setSourceThumbnail` cases and
the library's eleven (stored → set, nothing stored, removed before the read landed, unmounted
before it landed, a real load winning the race, two renders → one read, a rejected read, every
thumbnail-less source repaired in one burst, an unrelated source joining mid-read). The review's
HIGH — a per-run `mounted` flag that a successful rebuild's own store write flipped, so one tile per
burst was repaired — moved no figure: both arms of that flag were executed either way, which is
why its two probe tests are behaviour pins and not coverage. The handoff's part removed a covered
owner (the cleanup revoke and the drop-time revoke) and its tests were rewritten rather than
deleted, so nothing there is less covered than before. **No floor crossed**; artist's floors stay
99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-116 (a capture request answered in
part — the share picker, then a camera or microphone prompt left open — is released at the deadline,
not when the stalled prompt settles): 100.00 / 99.51 / 97.67 / 100.00, byte-identical to the
100.00 / 99.51 / 97.67 / 100.00 the commit this branch was rebased onto measures. Measured in one
sitting, the base gives 1,301 / 1,332 branches and this branch 1,303 / 1,334: two new branches, two
covered, the same 31 uncovered as before (statements 2,474 / 2,486 → 2,484 / 2,496, lines
2,324 → 2,333, functions 450 → 451, every denominator growing by exactly what the numerator did; the
same 12 statements uncovered). The two are the `onPartial?.()` optional call in
`hooks/useMediaStreams.ts`'s `acquireStreams` — reached with the reporter present by the two new
stage-by-stage cases and absent by the no-argument cases that were already there — and the
`if (expired)` inside the controller's reporter, which releases a stage that lands only after the
deadline, reached from both sides by the after-the-deadline and before-the-deadline cases. The
deadline-time `releaseAcquired(partial)` and `expired = true` are statements, not decisions, and
the cancelled-while-parked case pins that the partial release sits ahead of the abandoned-attempt
gate rather than adding a branch to it. The review's one substantive finding — the post-deadline
window — is the `expired` arm. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-119 (three test files unstub only
what they stubbed, so `src/test/setup.ts`'s `URL` / `Blob` / `AudioContext` stubs survive to the last
test in each): 99.52 / 98.88 / 94.61 / 99.40, byte-identical to the 99.52 / 98.88 / 94.61 / 99.40 the
commit this branch was rebased onto measures — lines 6,765 / 6,797, statements 7,631 / 7,717,
branches 4,201 / 4,440 and functions 1,679 / 1,689 on both trees, the same 32 / 86 / 239 / 10
uncovered. The change is test code alone: `core/videoDecodeManager.test.ts`,
`utils/integration.test.ts` and `utils/throttle.test.ts` each capture the global they stub
(`Worker` / `VideoDecoder`, `fetch`, the rAF pair) and restore that one instead of calling
`vi.unstubAllGlobals()`, which had been dropping the setup file's stubs for every test after it, and
each file ends with a pin that the setup `URL` stubs are still mock functions — red in all three
before the fix. No source file is touched, so no numerator or denominator moves. **No floor
crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-120 (the uploader clears its "remove
from the list" timers on unmount): 99.52 / 98.88 / **94.64** / 99.40 against the
99.52 / 98.88 / 94.61 / 99.40 the commit this branch was rebased onto measures — branches up three
hundredths, the other three unmoved. Measured in one sitting, the base gives 4,201 / 4,440 branches
and this branch 4,204 / 4,442: two new branches, both covered, and one *fewer* uncovered than
before (239 → 238), because the new test uploads two files at once and so reaches, for the first
time, the "some other file's row is left alone" arm of the completion `map` in
`components/VideoUploader.tsx` that every earlier upload case — one file each — had passed over
(statements 7,631 / 7,717 → 7,640 / 7,726, lines 6,765 / 6,797 → 6,772 / 6,804, functions
1,679 / 1,689 → 1,680 / 1,690, the same 32 / 86 / 10 uncovered). The two new decisions are the
unmount cleanup's `removalTimersRef.current ?? []` — reached with timers armed by the new case and
with none by every render RTL's auto-cleanup unmounts without an upload — and the lazily created
Set's `??=`, reached on the first upload and again on the second. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

Each package's floors are these numbers rounded down to a whole percent, so the floor is
never above what the suite actually achieves:

| Package | Lines | Statements | Branches | Functions |
|---------|-------|------------|----------|-----------|
| `@escapesuite/plan` | 100.00 | 100.00 | 100.00 | 100.00 |
| `@escapesuite/craft` | 100.00 | 99.51 | 97.67 | 100.00 |
| `@escapesuite/artist` | 99.52 | 98.88 | 94.64 | 99.40 |
| `@escapesuite/shared` | 100.00 | 98.54 | 90.78 | 100.00 |
| `@escapesuite/headless-artist` | 99.45 | 99.36 | 98.16 | 98.51 |

- **Thresholds only go up.** A package's floors are its achieved coverage, rounded down
  to a whole percent — so any real regression turns the build red rather than being
  absorbed by slack. Raise them when coverage improves (update the `thresholds` block in
  that package's config, and the matching entry in `scripts/coverage-report.mjs`); never
  lower one to make a red build pass — fix the coverage gap, or, if a threshold is
  measurably wrong (e.g. it was set from a bad measurement), say so explicitly in the PR
  description instead of quietly loosening it. On the small denominators — shared,
  headless-artist and plan each measure a few hundred branches, not thousands — a
  whole-percent floor leaves essentially no headroom, so a single new untested branch
  turns CI red there. That is by design: the fix is to test the branch, not to lower the
  floor.
- **Every `src` file counts.** Each config sets `coverage.include: ['src/**/*.{ts,tsx}']`
  so a file the test suite never imports still appears in the report at 0%, instead of
  being silently omitted from the denominator. Beyond `src/test/**`, `.d.ts` and config
  files, craft and artist also exclude `**/types.ts` — those files are interfaces (erased
  at compile time) plus a handful of default data literals such as
  `DEFAULT_KEYFRAME_PANEL_STATE`, which have no branches of their own and are executed by
  every importer. Six files beyond that are excluded, each with a comment in its
  package's `coverage.exclude` naming the suite that does cover it: the bootstrap entry points
  `src/main.tsx` (plan/craft/artist) and artist's `src/headless/main.ts`, artist's
  `src/workers/decodeWorker.ts` (runs only inside a Web Worker; covered by the e2e MP4
  export tests), and `services/headless-artist`'s `src/renderDriver.ts` (needs real
  Chromium; covered by `src/renderDriver.chromium.test.ts`, which `test:coverage` does not
  run).
- **Reading the report**: after `pnpm test:coverage`, run `pnpm coverage:report`
  (`node scripts/coverage-report.mjs`) for a table of every package's actual coverage
  next to its configured floor (`actual% / threshold%`, with `!` marking a value
  below its floor). It reads each package's `coverage/coverage-summary.json` (the
  `json-summary` reporter) and never throws — vitest itself is what enforces
  thresholds and fails the build; the report is a human-readable summary, printed in
  CI as the "Coverage summary" step (`if: always()`) right after the coverage run so
  it still prints when a threshold fails.
- **Adding test doubles**: prefer `vi.fn()`/`vi.mock()` over hand-rolled fakes;
  fake-indexeddb is already wired up for storage tests (see `src/test/setup.ts` in
  each app). A file whose only realistic coverage comes from a Playwright/Chromium
  suite that isn't part of `test:coverage` (e.g. `services/headless-artist`'s
  `*.chromium.test.ts` files) can be excluded from a package's `coverage.exclude`
  list — comment the exclusion with which suite actually covers it, the way
  `services/headless-artist/vitest.config.ts` documents `src/renderDriver.ts`.

## Key Constraints

- WebCodecs API (ESCAPEARTIST exports) only works in Chrome/Edge
- MediaRecorder produces WebM without proper seek metadata (requires post-processing — guarded
  end to end by `apps/e2e`'s `pip-seekable` specs, one per build pipeline; composited PiP takes,
  audio-only takes and any browser without WebCodecs all reach that path, but a composited PiP
  take is the only one the specs can drive in headless Chromium. A separate-tracks PiP take is
  recorded by `WebCodecsRecorder` and needs no repair)
- AudioContext needs `resume()` call due to Chrome autoplay policy
- System audio capture only works with getDisplayMedia (Chrome/Edge)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Nine jobs, with `ci-status` as the single required check (`perf` is informational and deliberately not one of its dependencies):

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint + TypeScript (shared, plan, craft, artist, headless-artist, e2e) | PRs and pushes |
| `test` | Unit tests with coverage | PRs and pushes |
| `build` | Production builds, bundle size report, packs + uploads the headless-artist kit | PRs and pushes |
| `kit-docker` | Builds the reference headless-artist Docker image and smoke-tests it (a real `docker run` render + `--version`) | PRs and pushes (skipped for Dependabot) |
| `standalone` | Offline single-file builds + standalone E2E, then the combined `dist/` build + production-layout (single-origin) E2E | PRs and pushes (E2E halves skipped for Dependabot) |
| `e2e` | Full Playwright suite (journey included) + headless-artist Chromium tests | PRs and pushes (skipped for Dependabot) |
| `perf` | `pnpm perf` benchmarks; informational only, never gates | PRs and pushes (skipped for Dependabot) |
| `deploy` | Vercel deployment | After E2E passes (skipped for Dependabot) |
| `ci-status` | Summary/gate job | All PRs |

**CI Optimizations:**
- Concurrency control cancels in-progress runs when new commits are pushed
- Combined lint + type-check + audit saves ~30s of runner setup overhead
- `standalone` builds the offline bundles once, uploads the `standalone-builds`
  artifact (consumed cross-run by `standalone-release.yml`), then tests that
  same build. It then runs `pnpm build:deploy` and the production-layout suite —
  last, because that build overwrites `apps/*/dist` with the hosted bundles
- `build` also runs `pnpm --filter=@escapesuite/headless-artist run pack:kit` and
  uploads the tarball as the `headless-artist-kit` artifact (consumed cross-run
  by `standalone-release.yml`, same pattern as `standalone-builds`)
- Playwright browsers are cached across runs (~1min savings); `e2e` also runs on
  pushes to `main`, so the cache is written from the base branch and fresh PR
  branches can restore it. `services/headless-artist` pins the same Playwright
  version (1.63.0) as `apps/e2e`, so its Chromium tests share that cache
- Playwright browser download and apt system-deps are separate steps, each with
  `timeout-minutes: 8` and a plain-bash retry, so an apt stall fails fast
  instead of hanging the job

**Release** (`.github/workflows/release.yml`):
- A release is cut by adding a changeset and merging it to `main`. `changesets/action` (v2) then pushes a `changeset-release/main` branch with the version bump and opens the "Version Packages" PR itself (the org setting "Allow GitHub Actions to create and approve pull requests" is enabled for this repo). CI on that bot-authored PR is held as "action required" until someone approves it. Relaxing the repository's fork-PR approval policy (now `first_time_contributors_new_to_github`) did not change this, so the hold is enforced at the organisation level (Organization → Settings → Actions → General → "Fork pull request workflows from outside collaborators"; org admin only). Approve the run under Actions ("Approve and run") or with `gh api -X POST repos/Bonham-Technologies/ESCAPESUITE/actions/runs/<run-id>/approve`. Merging the PR tags each changed package and creates a per-package GitHub Release, with the craft/artist standalone HTML and the headless-artist kit tarball attached to their respective releases.
- Releases are named after the tag (`<pkg>@<version>`) and their body is that version's entry from the package's `CHANGELOG.md`, written by the action itself. The two failure modes differ: if a versioned package has a `CHANGELOG.md` but no entry for the new version, the action throws (`Could not find changelog entry for …`) and fails the job loudly; if the `CHANGELOG.md` is missing entirely, the action silently skips that package's release — a tag and nothing else — and it is the **attach job** that turns the run red: since ESCSUITE-83 it looks each released package's GitHub Release up by tag (`getReleaseByTag`, six attempts ten seconds apart, because the list endpoint did not always show a release published half a minute earlier and six per-package releases shipped with no asset on 2026-09-26) and calls `core.setFailed` naming every tag it could not find, rather than skipping the upload behind an `if (release)` and staying green.
- `changeset:publish` must stay `changeset git-tag`: the action discovers what to release solely from the `CHANGESETS_OUTPUT` NDJSON events that command writes, so swapping in a different publish script would leave the job green while creating no tags and no releases.
- `standalone-release.yml` additionally creates an umbrella `v<highest app version>` release — the
  higher of the `apps/craft` and `apps/artist` package versions — carrying the same standalone HTML
  and kit tarball assets. It is the higher of the two rather than ESCAPECRAFT's because an
  artist-only bump would otherwise reuse the existing tag, cut no release, and leave `latest`
  pointing at the previous ESCAPEARTIST build. The HTML assets are named for their own app
  (`ESCAPECRAFT-<craft version>.html`, `ESCAPEARTIST-<artist version>.html`, matching the names
  `release.yml` attaches to the per-package releases); the kit tarball carries the umbrella version.

**Standalone Release** (`.github/workflows/standalone-release.yml`):
- Runs after CI succeeds on `main` (and attaches preview builds as workflow artifacts for PRs)
- Builds ESCAPECRAFT and ESCAPEARTIST in standalone mode (`VITE_BUILD_MODE=standalone`)
- Also downloads the `headless-artist-kit` artifact from the same CI run and renames the
  tarball to `escapesuite-headless-artist-<VERSION>.tgz` (VERSION here is the umbrella release's
  own version — the higher of the craft and artist versions — not the kit package's
  independent `0.1.0`)
- On `main`, creates a GitHub Release and attaches the single-file HTML builds — each named
  for its own app's version — and the headless-artist kit tarball directly to it
- No cloud storage step and no license injection — the downloads are plain HTML files (and one
  npm tarball), ready to run

**Dependabot** (`.github/dependabot.yml`):
- Weekly updates for all apps
- Grouped PRs: React, testing, linting
- GitHub Actions version updates

## Vercel Analytics

**Hosted (`saas`) builds only.** All three apps use `@vercel/analytics` for pageview and
custom event tracking:
- `<Analytics />` is mounted by `bootstrapApp()` (`packages/shared/src/bootstrap`) for
  ESCAPECRAFT and ESCAPEARTIST; ESCAPEPLAN still mounts it directly in its own `main.tsx`
- Custom events via `trackEvent()` in `*/analytics.ts` files, which re-export the shared
  `packages/shared/src/analytics` wrapper
- **A standalone build ships no analytics runtime at all.** `BUILD_MODE === 'saas'` gates
  both `trackEvent()` and the `<Analytics />` mount, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert — `va.vercel-scripts.com` appears 0 times in the
  ESCAPECRAFT and ESCAPEARTIST standalone builds and once in the hosted one. Held at
  runtime by `apps/e2e/tests/standalone/craft.spec.ts` ("makes no requests off the local
  origin"), which records a real take and then asserts there is no `window.va`, no queue
  and no injected script

## Issue Tracking

Issues and work items are tracked in Jira:
- **Project**: [ESCSUITE](https://bonham.atlassian.net/jira/software/projects/ESCSUITE/summary)
- **Board**: https://bonham.atlassian.net/jira/software/projects/ESCSUITE/boards

## Per-App Documentation

Each app has its own CLAUDE.md with detailed architecture:
- `apps/artist/CLAUDE.md`: Overlay system, keyframe animation, transform controls
- `apps/craft/CLAUDE.md`: Recording modes, PiP compositing, keyboard shortcuts
- `apps/plan/CLAUDE.md`: Routes, page structure, theme support
