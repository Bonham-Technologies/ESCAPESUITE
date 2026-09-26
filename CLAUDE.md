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
- `converter.ts`'s other conversion path — compatible WebM (VP9 + Opus re-encode), `remuxToWebM` / `isWebMRemuxSupported` — is still present, tested and **unwired**; see `apps/craft/CLAUDE.md`'s "Download Formats"

### ESCAPEARTIST (apps/artist)
- Zustand store in `src/store/projectStore.ts`
- Core modules in `src/core/`: `storage.ts`, `videoProcessor.ts`, `exporter.ts`, `projectManager.ts`, `exportScheduler.ts`, `frameCache.ts`, `videoDecodeManager.ts`, `frameSource.ts`
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
  (which mirrors `vercel.json`'s rewrites). That is the only setup where CRAFT (`/craft/`)
  and ARTIST (`/artist/`) share `video-editor-db`, so the cross-app IndexedDB tests live
  there: `pnpm build:deploy && pnpm test:e2e:production`
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
Seven ordinary vitest files — `apps/artist/src/components/Preview/drawFrame.perf.test.ts`,
`apps/artist/src/core/exportMP4.perf.test.ts`,
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
Each package's floors are these numbers rounded down to a whole percent, so the floor is
never above what the suite actually achieves:

| Package | Lines | Statements | Branches | Functions |
|---------|-------|------------|----------|-----------|
| `@escapesuite/plan` | 100.00 | 100.00 | 100.00 | 100.00 |
| `@escapesuite/craft` | 100.00 | 99.47 | 97.56 | 100.00 |
| `@escapesuite/artist` | 99.40 | 98.75 | 93.77 | 98.98 |
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
