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

`scripts/build-all.mjs` (`pnpm build:deploy`) refuses to publish: if `turbo build` left any of
ESCAPEPLAN, ESCAPECRAFT or ESCAPEARTIST with an empty or missing `dist`, it exits non-zero
naming the app instead of assembling and reporting success on a half-shaped `dist/`.

## Architecture

### Shared Infrastructure
- **pnpm workspaces**: Efficient dependency management with shared packages
- **Turborepo**: Cached builds, parallel execution, smart rebuilds
- **IndexedDB Database**: CRAFT and ARTIST share `video-editor-db` for seamless data transfer
- **Single-file Builds**: `vite-plugin-singlefile` inlines all assets into one HTML file,
  but not a Web Worker — ESCAPEARTIST's `decodeWorker` needs a second mechanism
  (`isSingleFileBuild`, `apps/artist/singleFileBuild.js`, read by `apps/artist/vite.config.ts`)
  that inlines it as a blob URL for the headless and standalone targets specifically (both run
  from `file://`, where Chromium blocks a separate worker script) and fails the build if any
  `.js` file survives inlining; the hosted build keeps the worker as an ordinary fetchable
  chunk. ESCSUITE-153: before this predicate existed, the standalone build checked only
  `VITE_HEADLESS` here and shipped an un-inlined `decodeWorker-*.js` the release never attached.
  The standalone HTML also carries the hosted deployment's `rel="canonical"` and `og:url`/
  `og:image` tags, pointing at `https://www.escapesuite.io` — nothing in the single-file bundle
  requests either URL, so this is harmless to the offline guarantee (ESCSUITE-177 n2), just an
  odd-looking artefact of reusing the same `index.html` template for both targets.
- **Shared dialog behaviour**: `useDialogBehaviour` (`packages/shared/src/hooks`, imported
  as `@escapesuite/shared/hooks`) is the single modal keyboard implementation — initial
  focus, the Tab/Shift+Tab trap, Escape-to-close and focus restored to the opener — used by
  CRAFT's two modals and all five of ARTIST's (export, shortcut sheet, project-load, session
  restore, the resolution-change confirm). Escape's *meaning* is per dialog, not inherited: the
  hook calls whatever it is handed, and ARTIST's session-restore prompt hands it a no-op because
  declining discards the
  saved session. See each app's CLAUDE.md "Dialogs" note
- **Shared error boundary**: `ErrorBoundary` (`packages/shared/src/components`), available as
  `@escapesuite/shared/components` for a host app — `bootstrapApp` reaches it directly — is the
  one React error boundary for both apps, mounted by `bootstrapApp()` around `<App />`. A
  render-time throw anywhere below it shows one minimal,
  accessible fallback panel instead of unmounting the whole app to a blank page, and calls an
  optional `onError(error, info)` — the one hook a host app has for releasing anything a crash
  would otherwise leave dangling. CRAFT's disposes a live recorder; ARTIST's is a documented
  no-op. See each app's CLAUDE.md

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
- Static per-clip picture properties in `src/core/`: `clipMask.ts` (a circle or rounded mask and its stroke) and `clipCrop.ts` (a crop — four insets as fractions of the source frame, set from the inspector or, since ESCSUITE-157, by dragging eight handles in the preview's crop mode). Never keyframed, media clips only, and read by the preview, both exporters, both transition paths and the headless bundle from the same two draw functions; a crop also resizes the clip's rectangle, so the selection box, hit test, marquee and drag seed read it too
- Audio waveform visualization in `src/utils/waveform.ts`
- WebCodecs API for encoding/decoding. No longer Chrome/Edge only: Firefox 155 and WebKit 26.6
  both expose `VideoEncoder`, and both encode H.264, VP9 and VP8 — but Firefox has **no AAC
  encoder**, so an MP4 exported there has no sound (ESCSUITE-175 made the dialog and the
  exporter say so, before and after, instead of handing back a silent file; a browser with no
  Opus encoder gets the same treatment for WebM). Measured 2026-10-02; see the Key Constraints
  bullet below

  exporter say so, before and after, instead of handing back a silent file). Measured
  2026-10-02; see the Key Constraints bullet below

- Export formats: WebM (VP9+Opus), MP4 (H.264+AAC) and GIF (`gifenc`, 256 colours per frame, no
  audio, no WebCodecs — 10/15/20 fps, 720p/480p/360p; see `apps/artist/CLAUDE.md`'s "GIF Export")
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
  init, and `EXPORT_COMPLETE` with
  `{ blob: Blob, format: 'mp4' | 'webm' | 'gif', name: string, audio?: boolean }`
  after a successful export (`name` is the download filename; not sent on failure or
  cancellation). `'gif'` is additive (ESCSUITE-34): a host that handles the two video formats sees
  a new value of a field it already reads, and needs no change unless it wants to treat a GIF
  differently. `audio` is additive too (ESCSUITE-175) and says whether the file carries an audio
  track: `false` for every GIF (no audio track in the container), for an MP4 exported in a browser
  with no AAC encoder (Firefox 155 today) and for a WebM exported in one with no Opus encoder;
  `true` otherwise. Read it as "this file has no audio track", **not** as "the project's sound was
  dropped" — a silent project exported in a no-AAC browser also reports `false`, because the
  exporter does not decode the sources and cannot tell the two apart (the editor's own completion
  notice pairs the field with its own "did this project have any sound" check before claiming a
  loss). A host that ignores the field is unaffected; a host that reads it should treat a missing
  field as `true`, which is how every message sent before the ticket behaved.
  Inbound `LOAD_VIDEO` (`{ url }`) fetches that URL the same way `?video=` does, so it is bound by
  the same `connect-src` — a URL the page's policy refuses gets an `ERROR` reply naming the origin
  and the policy (`code: 'LOAD_ERROR'`) instead of a generic failure. See "URL params (ARTIST)"
  below and ESCSUITE-130.
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
  applied only while the name is still the default `Untitled Project`). `?video=url` (and the
  inbound `LOAD_VIDEO` message, below) fetch the URL from the page itself, so both are bound by
  its own `connect-src` — on the hosted deployment (`connect-src 'self' ...` in `vercel.json`)
  that means a **same-origin URL only**; a cross-origin one is refused before it leaves the page,
  and `loadVideoFromUrl` says so by naming the origin and the likely Content-Security-Policy
  cause, rather than a bare `Failed to fetch` (ESCSUITE-130). A self-hosted or standalone build
  fetches under whatever `connect-src` it sets itself.
- **`?hostOrigin=<origin>`** (both apps): the host's own origin, e.g. `https://host.example`.
  Recommended for production hosts — and **required** of a host that offers CRAFT's "Upload to
  host" (ESCSUITE-176): that message carries the recording's **bytes**, not just an id, and
  `uploadToHost()` never broadcasts them to `'*'` — without a `hostOrigin` it can parse, it
  posts nothing at all and says so through CRAFT's one notice channel. `SEND_TO_EDITOR`'s
  id-only post is the one exception that keeps its `'*'` fallback: an opaque id is useless to a
  framer that cannot reach the shared IndexedDB, whereas a recording's bytes are not. Outbound
  posts are addressed to `hostOrigin` instead of `'*'` wherever one parses, and ARTIST ignores
  inbound messages from anywhere else. It protects the **host's** deployment, not against being
  framed — a hostile page that frames the app also controls the URL and would supply its own
  origin; refusing to be framed is `Content-Security-Policy: frame-ancestors` on the deployment.
  Parsed by `parseHostOrigin()` in `packages/shared/src/config`, which accepts any `http:`/
  `https:` value `new URL()` can parse and normalises it down to its origin — a trailing slash
  or a path included — rather than rejecting anything but a bare origin; only a value `new URL()`
  cannot parse at all, one with an opaque origin (a `data:` URL, say), or one on any other scheme
  (the http(s)-only check is explicit rather than relying on the opaque-origin check alone,
  because Chromium serialises a `file:` URL's origin as the non-opaque string `'file://'`) is
  ignored, with one console warning. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus
  `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a
  self-hosted or standalone build must set its own.
- **Documented but not currently implemented**: inbound `EXPORT`, outbound `EXPORT_PROGRESS` and
  `PROJECT_SAVED`, and the `?project=` / `?autoplay=` URL params. See `apps/artist/CLAUDE.md`.
- **`VITE_EDITOR_URL`** (build-time, CRAFT): where standalone CRAFT opens the editor.
  Defaults to `/artist/`; normalised to a single trailing slash.
- Proved end to end in a real iframe by `apps/e2e/tests/integration/host-embedding.spec.ts`.

### Headless render service (services/headless-artist)
- `@escapesuite/headless-artist`: a CLI with two commands — one-shot `render` and a long-running
  `serve` (`http.createServer` with `GET /healthz`, `POST /render`, a bounded FIFO job queue, a
  1 MB body cap and a sink allow-list) — that renders ESCAPEARTIST projects in headless Chromium
  (via Playwright) outside the browser, for servers or GPU boxes with no UI involved. A job spec
  names its input as either a self-contained `bundle` or a `manifest` (a small JSON pointing at
  source media already on disk, for a large project) and writes to one of four output sinks —
  `volume`, `command`, `webhook`, `s3` — each producing a verification manifest (hash, dimensions,
  duration) alongside the render. `services/headless-artist/README.md` is the protocol reference,
  the way the Integration API section above links `apps/artist/src/utils/integration.ts`.
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
  is the regression test, proving a `blob:` video source survives that CSP in both apps). Since
  ESCSUITE-196, `serve-dist.mjs`'s rewrite table is *derived* from `vercel.json`'s `rewrites`
  array (walked in order through the same `source`-pattern matcher the `headers` block already
  used), not a hand-coded copy of it — `tests/production/spa-fallback.spec.ts` and
  `serve-dist.test.mjs`'s drift-guard test are the regression coverage, proving a genuine miss
  reaches `dist/404.html` with a real 404 instead of the hub SPA or a plain-text fallback. That
  is the only setup where CRAFT (`/craft/`) and ARTIST (`/artist/`) share `video-editor-db`,
  so the cross-app IndexedDB tests live there: `pnpm build:deploy && pnpm test:e2e:production`
- **Standalone tests**: See [Standalone Test Battery](docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists

Test counts change frequently as coverage grows; run `pnpm test` for the current numbers rather than relying on a count documented here.

### Performance benchmarks

The benchmarks measure, they do not assert. `apps/e2e/scripts/perf.mjs` runs the Chromium-only
Playwright project in `apps/e2e/tests/perf/` (`playwright.perf.config.ts`: one worker, no
retries, fixed launch args) and then the headless kit's `src/perf.bench.test.ts`, then
**always** merges whatever results exist with `apps/e2e/scripts/perf-report.mjs` into
`perf-report.json` at the repo root plus a Markdown table (appended to
`$GITHUB_STEP_SUMMARY` in CI) — a failed benchmark still leaves the surviving numbers
readable, though `pnpm perf` itself then exits non-zero. `perf-results/` is emptied by the
perf project's `globalSetup` first, so a stale result can never be reported as current.
All three outputs are gitignored. `tests/perf/` also holds `visual.spec.ts`, which is not a
benchmark and does assert: a `toHaveScreenshot` pixel guard on the composited preview (self-skips
when no baseline exists for the platform — only macOS is committed) and a blur-band measurement
with no such skip, so it runs everywhere `pnpm perf` runs, CI included. It rides along in the
same `pnpm perf` invocation because it protects the same preview-rasterisation work the
benchmarks measure, not because it is one itself — a red `pnpm perf` from a moved pixel or a
blur band outside tolerance means this spec, not a benchmark or a tripwire below.

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

CI runs them in their own workflow, `.github/workflows/perf.yml` (ESCSUITE-26): on every
push to `main` or `dev`, on a pull request that carries the **`perf` label** (add the label,
then push or re-run — the workflow listens for `labeled` and `synchronize`), and by hand via
`workflow_dispatch`. It is `continue-on-error: true` and was never in `ci-status`'s `needs` —
runner CPU varies, so a number moving is worth looking at and never worth blocking a merge
on — which is why taking it off every PR costs nothing in regression protection and saves
about fifteen runner-minutes per push. It uploads `perf-report.json` (and any `*.cpuprofile`)
as the `perf-report` artifact.

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

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-123 and ESCSUITE-131 (an MP4 export
no longer leaks one decoded `VideoFrame` per frame of every transition, and a WebM export closes
the frame it was encoding when `encode()` throws): **99.54** / **98.89** / **94.66** / 99.40
against the 99.52 / 98.88 / 94.64 / 99.40 the commit this branch was rebased onto measures — lines,
statements and branches each up a hundredth or two, functions unmoved. Measured in one sitting, the
base gives 4,204 / 4,442 branches and this branch 4,205 / 4,442: no new branch at all, and one
*fewer* uncovered (238 → 237); lines 6,772 / 6,804 → 6,774 / 6,805 and statements
7,640 / 7,726 → 7,642 / 7,727 (one new unit each, covered, and one pre-existing uncovered unit
each newly reached: 32 → 31 lines, 86 → 85 statements); functions 1,680 / 1,690 on both. The
newly reached arm, statement and line are all in `core/exportMP4.ts`'s WebCodecs decode path,
which no test had ever entered — `VideoDecodeManager.isSupported()` is false in jsdom, so the two
export `*.perf.test.ts` files' "one `VideoFrame` created and closed per encoded frame" law counts
only the canvas-drawn encode frame and was vacuous for decode frames — until
`core/exportMP4.decodeFrameLeak.test.ts` mocked the decoder in and drove a whole-clip transition
through it. The fix itself adds no decision: `core/frameManager.ts`'s per-iteration frame set is a
`Set<VideoFrame>` where it was a `Map` keyed by source and timestamp (a transition fetches the
outgoing clip twice at one timestamp, and the second fetch evicted the first unclosed), and
`core/exportWebM.ts`'s `encode()` sits in a `try`/`finally` that closes the frame either way. The
reviewer reverted the manager to the `Map` and watched the three new cases go red with the
report's exact text. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-135 and ESCSUITE-136 (an MP4
conversion of a take whose duration reads `Infinity` refuses or bounds itself instead of encoding
without end, and a recording with an odd pixel width or height is encoded one row or column
smaller instead of being refused by the H.264 encoder): 100.00 / **99.52** / **97.70** / 100.00
against the 100.00 / 99.51 / 97.67 / 100.00 the commit this branch was rebased onto measures —
statements up a hundredth, branches up three, lines and functions unmoved at exactly 100.00.
Measured in one sitting, the base gives 1,303 / 1,334 branches and this branch 1,322 / 1,353:
nineteen new branches, nineteen covered, the same 31 uncovered as before (statements
2,484 / 2,496 → 2,494 / 2,506, lines 2,333 → 2,343, functions 451 on both; the same 12 statements
uncovered). The nineteen are all in `core/converter.ts`'s `convertToMP4`: the finite-or-fallback
duration choice and the `knownDuration` default, the refusal of a duration that is still not
finite and positive, the refusal of a picture with no even pixels in it, the two even-rounding
subtractions' guards, the composite path's `overlayGeometryFor` taking the even width, and — in
the `requestVideoFrameCallback` branch — the new `else if (frameIndex >= totalFrames)` that
settles the conversion on the count it derived rather than on `ended`. The first measurement of
the branch came back at 1,321 / 1,353, one arm short: that `else if`'s *false* side, a frame
callback arriving while the element is paused or ended with frames still owed, which does nothing
and leaves the `ended` handler to pad — reached by a case that pauses the double mid-take, fires
the pending callback, asserts nothing was encoded, flushed or re-requested, then ends the element
and watches it pad to the total. The Playwright pin
`apps/e2e/tests/escapecraft/mp4-odd-frame-size.spec.ts` (`VideoEncoder.isConfigSupported` false at
1280×831, true at 1280×830) is outside vitest's coverage and was run once in real Chromium: 1 / 1.
**No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-28 for ESCSUITE-125 and ESCSUITE-126 (choosing an
Animate In/Out preset clamps its duration to what the clip can hold, and the keyframe panel's
playhead follows the timeline again after a clip-preview scrub): 99.54 / **98.90** / **94.67** / 99.40
against the 99.54 / 98.89 / 94.66 / 99.40 the commit this branch was rebased onto measures —
statements and branches each up a hundredth, lines and functions unmoved. Measured in one sitting,
the base gives 4,205 / 4,442 branches and this branch 4,211 / 4,448: six new branches, six covered,
the same 237 uncovered as before (statements 7,642 / 7,727 → 7,645 / 7,730, lines
6,774 / 6,805 → 6,778 / 6,809, functions 1,680 / 1,690 on both; the same 31 / 85 / 10 uncovered).
The six are the `type === 'none' ? duration : Math.min(duration, maxPresetDuration(clip.duration))`
choice in each of the four preset handlers in `components/ClipEditor/useClipEditorActions.ts` — a
switched-off preset keeps its stored duration, the exemption `trimAnimation` already makes — and
the defensive `Math.min(duration, clipDuration)` inside `generateOutPresetKeyframes` in
`utils/animation.ts`. The first measurement of the branch had the in-side `'none'` arm unreached —
the out side had its case and the in side did not — and the review's one MAJOR was that arm; its
mirror case is what took the count from five of six to six of six. `KeyframePanel.tsx` lost a
branch rather than gaining one: the one-way `previewTime` latch and its `useState` are gone, and
`playheadTime` is derived from `currentTime` alone. This paragraph was rewritten once: the branch
was first measured against the tree before ESCSUITE-123 / 131 landed, and the figures above are
against the commit it actually lands on. **No floor crossed**; artist's floors stay
99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-28 for ESCSUITE-137 and ESCSUITE-138 (the compositor
releases the canvas capture track it minted when it stops, and the unwired `generateStreamThumbnail`
is deleted): 100.00 / **99.51** / 97.70 / 100.00 against the 100.00 / 99.52 / 97.70 / 100.00 the
commit this branch was rebased onto measures — statements down a hundredth, the other three
unmoved, and every denominator smaller: lines 2,343 → 2,321, statements 2,494 / 2,506 →
2,473 / 2,485, branches 1,322 / 1,353 → 1,318 / 1,349 and functions 451 → 446. The deleted function
and its helpers were fully covered, so removing them took covered units out of the numerator as
fast as the denominator — the same arithmetic ESCSUITE-99 and 108 went through — and the
uncovered counts did not move: the same 12 statements and 31 branches. The one line the branch
adds, `Compositor.stop()` stopping every track of the stream it handed out, is covered by the
red-first case that asserts the track's `stop()` after `stop()`; it adds no decision. Statements
read a hundredth lower with strictly nothing less covered, which is why the figure moves and the
floor does not. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-128 (a rotated left- or
right-aligned text overlay's selection box, hit test and marquee box follow the rotation):
99.54 / 98.90 / 94.67 / 99.40, byte-identical to the 99.54 / 98.90 / 94.67 / 99.40 the commit this
branch was rebased onto measures. Measured in one sitting, the base gives 4,211 / 4,448 branches
and this branch the same 4,211 / 4,448: the change adds no decision at all. Lines
6,778 / 6,809 → 6,783 / 6,814 and statements 7,645 / 7,730 → 7,650 / 7,735, five new units each,
all covered; functions 1,680 / 1,690 on both; the same 31 / 85 / 237 / 10 uncovered. The five are
`components/Preview/previewGeometry.ts`'s `getOverlayBounds` turning the alignment offset it
already computed — half the text width, one way for left and the other for right — into a
displacement along the rotated baseline (`offset × cos θ`, `offset × sin θ`) rather than along
the screen's x axis, which is the one function `selectionOverlay.ts`, `hitTest.ts` and
`dragGeometry.ts` all read from; the red case rotates a right-aligned text through 90° and expects
its centre displaced in y. This paragraph was rewritten once: the branch was first measured before
ESCSUITE-123 / 131 and 125 / 126 landed, and the figures above are against the commit it actually
lands on. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-124 (both exporters composite
overlays interleaved with media in track order, the way the preview does): 99.54 / 98.90 /
**94.77** / 99.40 against the 99.54 / 98.90 / 94.67 / 99.40 the commit this branch was rebased
onto measures — branches up a tenth, the other three unmoved. Measured in one sitting, the base
gives 4,211 / 4,448 branches and this branch 4,212 / 4,444: the denominator *shrank* by four and
the uncovered count by five (237 → 232), because the separate media-then-overlays loops in
`core/exportMP4.ts` and `core/exportWebM.ts` became one pass over `getClipsAtTime`'s already
track-sorted clips, and the second loop's defensive arms — the ones nothing had ever reached — went
with it; the one new decision, the `media?.frame` optional chain that replaced the old `if (frame)`,
is reached with a source in the manager by every drawing case and without one by "skips a source
that is not in storage". Lines 6,783 / 6,814 → 6,780 / 6,811, statements 7,650 / 7,735 →
7,647 / 7,732 and functions 1,680 / 1,690 → 1,679 / 1,689 all fell by exactly the deleted code,
with the same 31 / 85 / 10 uncovered. The two red cases — an overlay on a track below a video is
covered in the export, one above is drawn last — pin the order per exporter; the export perf files
are byte-unchanged, since every clip is still drawn exactly once. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-127 and ESCSUITE-129 (a hidden
track is silent in an export too, and loop-back seeks each clip to its source time rather than the
loop point): 99.54 / 98.90 / **94.78** / 99.40 against the 99.54 / 98.90 / 94.77 / 99.40 the commit
this branch was rebased onto measures — branches up a hundredth, the other three unmoved. Measured
in one sitting, the base gives 4,212 / 4,444 branches and this branch 4,213 / 4,445: one new
branch, covered, the same 232 uncovered as before; lines 6,780 / 6,811 → 6,778 / 6,809 and
statements 7,647 / 7,732 → 7,645 / 7,730 each two smaller — the two `currentTime = loopStart`
assignments the render loop's loop-back used to make — and functions 1,679 / 1,689 on both, with
the same 31 / 85 / 10 uncovered. The one new decision is the `!track.visible` operand
`core/audioMixer.ts` adds to the clause that already skipped a muted track and a track that is
gone, reached from both sides by the new hidden-track case against the mixes that were already
there. `components/Preview/usePreviewRenderLoop.ts` gained nothing: the loop-back pauses every
element and lets the very next frame's clips-changed branch — which already maps timeline time to
each clip's source time — do the seek, and that branch was covered before. **No floor crossed**;
artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-133 (a transition evaluates the
incoming clip's animation at the same clamped clip time its frame is fetched at):
99.54 / 98.90 / 94.78 / 99.40, byte-identical to the 99.54 / 98.90 / 94.78 / 99.40 the commit this
branch was rebased onto measures. Measured in one sitting, the base gives 4,213 / 4,445 branches
and this branch the same 4,213 / 4,445 — `getIncomingClipTime`'s `Math.max(0, …)` is a call, not a
decision — with lines 6,778 / 6,809 → 6,779 / 6,810, statements 7,645 / 7,730 → 7,646 / 7,731 and
functions 1,679 / 1,689 → 1,680 / 1,690, one new unit each, all covered, and the same
31 / 85 / 232 / 10 uncovered. The helper in `core/exportTypes.ts` replaces the unclamped
`currentTime - incomingClip.timelinePosition` at both of `core/canvasRenderer.ts`'s transition
call sites, which the preview and both exporters share; the red cases pin that the incoming clip's
`getAnimatedValues` is asked at clip time 0 during a transition rather than at a negative time,
and that the helper clamps. What the tests deliberately do not claim: that a fade-in preset becomes
visible during the transition — its first keyframe is at clip time 0 and interpolation floors
earlier times to it, so the clamped time and the negative one yield the same opacity; whether an
in-preset should be suppressed under an incoming transition is a product decision this ticket
left alone. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-140 (post-sweep hygiene: the dead
`ImportedTake.thumbnailUrls` and `IFrameSource.releaseFrame` deleted, `disposeFrameManager`'s close
guarded, `/_vercel/*` answered 404 by the local production server): 99.54 / 98.90 / **94.80** /
**99.46** against the 99.54 / 98.90 / 94.78 / 99.40 the commit this branch was rebased onto measures
— branches up two hundredths and functions up six, lines and statements unmoved, and every
denominator smaller: lines 6,779 / 6,810 → 6,778 / 6,809, statements 7,646 / 7,731 → 7,645 / 7,730,
branches 4,213 / 4,445 → 4,212 / 4,443 and functions 1,680 / 1,690 → 1,679 / 1,688. The deleted
units were covered, so the numerators fell with them, and two branches and one function that had
never been reached — `releaseFrame`'s two implementations' bodies among them — went out of the
uncovered column too (232 → 231 branches, 10 → 9 functions; the same 31 lines and 85 statements).
The one line the branch adds to a source file, the `try` / `catch` around `frame.close()` in
`cleanupCurrentFrames`, is covered from both sides by the red case whose second frame throws on
close and whose third is closed regardless; `serve-dist.mjs` is not in this package's measurement
and carries its own `node:test` case for the `/_vercel` refusal. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-09-29 for ESCSUITE-130 (a `?video=` or host `LOAD_VIDEO`
preload the hosted Content-Security-Policy refuses names the origin it tried and the policy that
stopped it, instead of a bare `Failed to fetch`): 99.54 / 98.90 / **94.81** / 99.46 against the
99.54 / 98.90 / 94.80 / 99.46 the commit this branch was rebased onto measures — branches up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 4,212 / 4,443 branches
and this branch 4,222 / 4,453: ten new branches, ten covered, the same 231 uncovered as before
(lines 6,778 / 6,809 → 6,791 / 6,822, statements 7,645 / 7,730 → 7,658 / 7,743, functions
1,679 / 1,688 → 1,680 / 1,689, every denominator growing by exactly what the numerator did; the
same 31 lines, 85 statements and 9 functions uncovered). The ten are `describeFetchFailure`'s
`instanceof Error` choice and its URL-parse `try` / `catch` in `utils/integration.ts` — an
unparsable URL falls back to the raw string as the named origin — and the two `instanceof Error`
choices at the `LOAD_VIDEO` and `?video=` catch sites in `hooks/useHostIntegration.ts`, each
reached from both sides by the cross-origin refusal, the `'http://a b/x'` case and the three
rejections with a plain string. The first measurement of the branch had the three non-`Error` arms
unreached; the review's ruling was to keep them rather than delete them, because each catch also
awaits `processVideoFile`, whose IndexedDB writes reject with a `DOMException` that does not extend
`Error` in browsers, and the fix round's three string-rejection cases are why the count is ten of
ten. The two branches still uncovered in `utils/integration.ts` are the streaming reader's, which
predate this ticket. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-30 for ESCSUITE-143 (a take with no picture — the
microphone alone — is stored as audio, the way the ESCSUITE-14 companions are, instead of as a
1920×1080 video with a fabricated thumbnail; and the library's MP4 button disables itself with the
converter's own reason for such a row): 100.00 / 99.51 / **97.73** / 100.00 against the
100.00 / 99.51 / 97.70 / 100.00 the commit this branch was rebased onto measures — branches up three
hundredths, the other three unmoved. Measured in one sitting, the base gives 1,318 / 1,349 branches
and this branch 1,335 / 1,366: seventeen new branches, seventeen covered, the same 31 uncovered as
before (statements 2,473 / 2,485 → 2,477 / 2,489, lines 2,321 → 2,325, functions 446 on both; the
same 12 statements uncovered, all in the four files that carried them before — `VideoPlayer.tsx`,
`converter.ts`, `webcodecs-recorder.ts` and `useRecordingController.ts`). Every file the ticket
touches measures 100 on branches and statements: `hooks/useRecordingSave.ts`'s `hasVideoSource`
choice — resolved once per attempt from the same streams the recorder factory sees and carried in
`onStop`'s closure, so the recorder, the repair key and the stored `mediaType` cannot disagree —
and the arm it gates, which skips the metadata probe and the thumbnail and stores
`mediaType: 'audio'` with no dimensions; `utils/recordingMetadata.ts`'s audio shape;
`store/recorderStore.ts` carrying the optional `mediaType` through `buildRecordingEntry`, so a
recording stored before this change reads as video; and `RecordingsList.tsx`'s
`mp4BlockedReason ?? (mediaType === 'audio' ? MP4_NO_VIDEO_REASON : null)`, reached with an
audio row by the review's red case and with a video row by every download case that was already
there. The thirteen red cases (a microphone-only take stored as audio, no probe, no thumbnail, MP4
disabled with the reason) and the six the fix round added are what put every arm on both sides.
**No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-30 for ESCSUITE-142 (the media library's Clear All
scopes to the project's own sources instead of wiping the `videos` and `thumbnails` stores of the
`video-editor-db` it shares with ESCAPECRAFT): **99.56** / **98.91** / **94.82** / 99.46 against the
99.54 / 98.90 / 94.81 / 99.46 the commit this branch was rebased onto measures — lines, statements
and branches each up a hundredth or two, functions unmoved. Measured in one sitting, the base gives
4,222 / 4,453 branches and this branch 4,230 / 4,461: eight new branches, eight covered, the same 231
uncovered as before. Lines 6,791 / 6,822 → 6,794 / 6,824 and statements 7,658 / 7,743 →
7,662 / 7,746 each carry one *fewer* uncovered unit (31 → 30 lines, 85 → 84 statements): the old
Clear All's `catch` logged to the console and nothing had ever reached it, and it went out with
`clearAllVideos` and `clearAllData` — the two deleted functions are also why functions read
1,680 / 1,689 → 1,679 / 1,688 with the same 9 uncovered. The eight new branches are all in
`components/VideoUploader.tsx`: the `clearableVideos.length === 0` disable and its three-way
`title`, the per-id live lock check (`lockedSourceVideoIds` read from `useEditorStore.getState()`
before each delete), the per-id `try` / `catch` that counts a failure instead of stopping the
batch, the `failed > 0` notice gate and the plural in its text — each reached from both sides by
the CRAFT-only-row regression, the empty and all-locked library, the track locked between two
deletes, the one-failure and two-failure partial batches, and the ordinary clears that were already
there. `store/projectSlice.ts` gained no branch (its change is a comment), and the one branch still
uncovered in `core/storage.ts` — `record.blob?.size || 0` in the size total — predates the ticket.
The cross-app guarantee itself is pinned outside vitest's measurement by
`apps/e2e/tests/production/clear-all-scoped.spec.ts`, run once here against `pnpm build:deploy`:
green on this branch, red on main with ESCAPECRAFT's take gone. **No floor crossed**; artist's
floors stay 99 / 98 / 94 / 99.

`@escapesuite/craft` was re-measured 2026-09-30 for ESCSUITE-144, 145 and 146 (the composite
MP4's webcam border and corner scaled to the frame the way the preview and ARTIST already scale
them; an orphaned companion's "Open in Editor" hands over its own id when the primary it names is
gone from the library; Play and Download say so through the app's notice when a recording's bytes
are gone): 100.00 / **99.52** / 97.73 / 100.00 against the 100.00 / 99.51 / 97.73 / 100.00 the
commit this branch was rebased onto measures — statements up a hundredth, the other three unmoved.
Measured in one sitting, the base gives 1,335 / 1,366 branches and this branch 1,337 / 1,368: two
new branches, both covered, the same 31 uncovered as before (statements 2,477 / 2,489 →
2,488 / 2,500, lines 2,325 → 2,336, functions 446 → 448, every denominator growing by exactly what
the numerator did; the same 12 statements uncovered, in the same four files). The net two are
`scaleToFrame`'s `frameWidth <= 0` guard in `core/overlayGeometry.ts` — reached from both sides by
the 1280 / 1920 / 3840 pins and the zero-width case — and `RecordingsList.tsx`'s
"is the take's primary present in the list" choice, reached with the primary present by the
existing handoff cases and absent by the orphaned-companion red case; `overlayPaddingFor` lost the
guard it used to carry when it became a call to `scaleToFrame`, and the two new functions are
`scaleToFrame` itself and the presence predicate. `useRecordingLibrary.ts`'s missing-bytes `else`
branches on a decision the `if (!blob)` already made, so it adds statements and no branch, and the
review's one MAJOR — two `??` fallbacks in `Compositor`'s constructor that no caller could reach —
was deleted rather than tested, which is why the count is two of two and not four of six. The
compositor and converter perf ceilings and the `App.*rerender*` pins are byte-unchanged. The
artist mirror pin for the scaled border (`utils/overlayPlacement.test.ts`) is test code in the
other package and moves no figure there. **No floor crossed**; craft's floors stay
100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-09-30 for ESCSUITE-139 (a transition owns its incoming
clip's entrance and its outgoing clip's exit: the renderer evaluates the incoming clip with its
Animate In preset suppressed and the outgoing clip with its Animate Out preset suppressed, so a
preset fade no longer stacks on the crossfade): 99.56 / 98.91 / 94.82 / 99.46, byte-identical on
every percentage to the 99.56 / 98.91 / 94.82 / 99.46 the commit this branch was rebased onto
measures. Measured in one sitting, the base gives 4,230 / 4,461 branches and this branch
4,237 / 4,468: seven new branches, seven covered, the same 231 uncovered as before (lines
6,794 / 6,824 → 6,799 / 6,829, statements 7,662 / 7,746 → 7,667 / 7,751, functions
1,679 / 1,688 → 1,680 / 1,689, every denominator growing by exactly what the numerator did; the
same 30 / 84 / 9 uncovered). The seven are `getAnimatedValues`' two `suppressPreset === 'in'` /
`=== 'out'` choices in `utils/animation.ts`, which swap one preset's generated keyframes for an
empty list; `animatedValuesFor`'s "hand the frozen suppression option through or not" in
`core/canvasRenderer.ts`, the new function, plus the `?? fallback?.(side) ?? {}` chain in the
shared modifier builder that replaced the two per-call-site `??` lines, and the
`side === 'outgoing' ? 'out' : 'in'` that stamps the side onto `TransitionModifiers` — each reached
from both sides by the red cases (the incoming clip asked at clip time 0 with its in-preset
suppressed, the outgoing with its out-preset suppressed, a `fade` in-preset invisible under the
crossfade, an untouched clip outside the window) and the `progress: 0.25` case that pins the two
sides' alphas apart at `[0.75, 0.25]`. The three export/preview perf ceiling files are
byte-unchanged: every clip is still evaluated and drawn exactly once per frame. What the tests
deliberately leave to ESCSUITE-147: the selection chrome and a keyframe-mode drag's seed still
evaluate without the suppression, which `apps/artist/CLAUDE.md` names beside the boundary step a
preset longer than its transition takes. **No floor crossed**; artist's floors stay
99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-152 (`parseProject` validates
`resolution`, and both exporters refuse an output size below two pixels before any encoder is
built): 99.56 / 98.91 / **94.85** / 99.46 against the 99.56 / 98.91 / 94.82 / 99.46 the commit this
branch was rebased onto measures — branches up three hundredths, the other three unmoved.
Measured in one sitting, the base gives 4,237 / 4,468 branches and this branch 4,263 / 4,494:
twenty-six new branches, twenty-six covered, the same 231 uncovered as before (lines
6,799 / 6,829 → 6,813 / 6,843, statements 7,667 / 7,751 → 7,681 / 7,765, functions
1,680 / 1,689 → 1,682 / 1,691, every denominator growing by exactly what the numerator did; the
same 30 / 84 / 9 uncovered). The twenty-six are `store/projectMigration.ts`'s
`isValidResolutionDimension` (a number, an integer, within the 2-to-8K bound — each operand of
the `&&` chain a branch of its own) and `isValidResolution`'s object and width / height checks,
the `candidate.resolution !== undefined && !isValidResolution(…)` gate that leaves an old file
with no `resolution` on the migration's existing default, and the identical
`!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2` guard at each
exporter's door in `core/exportMP4.ts` and `core/exportWebM.ts` — each reached from both sides
by the six rejections (0×0, a string, a negative, `NaN`, a missing width, 7681 wide), the
happy and odd-dimension parses, and the exporter cases that assert `VideoEncoder` was never
constructed against the exports that already run. The two new functions are the two validators.
`ExportError` moved to `core/exportTypes.ts` with a re-export from `exportMP4.ts`, which adds
no decision; `exportTypes.ts`'s three uncovered branches and the exporters' own predate the
ticket. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-153 and ESCSUITE-29's second
mechanism (the standalone build is one file again — the worker-inlining plugins and the
leftover-`.js` guard now follow one `singleFileBuild` predicate that is true for the headless and
the standalone build alike — and `VideoDecodeManager.initialize()` settles: the worker's `error`
or `messageerror` rejects it, a worker that never answers rejects it after ten seconds, the
export's Cancel rejects it, and when the worker cannot start the MP4 export falls back to the
in-page decoder with a progress line saying so instead of hanging): 99.58 / 98.94 / **94.99** /
99.47 against the 99.58 / 98.94 / 94.93 / 99.47 the commit this branch was rebased onto measures
— branches up six hundredths, the other three unmoved. Measured in one sitting, the base gives
4,315 / 4,545 branches and this branch 4,327 / 4,555: ten new branches, twelve more covered, so
the uncovered column falls 230 → 228 — the worker doubles enter two arms of the decode-worker
path that no earlier test had reached, because jsdom has no `Worker` and the path had only ever
been exercised in a real browser (lines 6,876 / 6,905 → 6,923 / 6,952, statements
7,755 / 7,838 → 7,803 / 7,886, functions 1,701 / 1,710 → 1,708 / 1,717, the same 29 / 83 / 9
uncovered). The ten are `core/videoDecodeManager.ts`'s settle path —
the timeout, the abort, the `error` and `messageerror` handlers, the ignored late events after a
settle, the `new Worker` throw that clears its own timer, and the empty-message fallback —
`core/frameSource.ts`'s worker-unavailable fallback and `core/exportMP4.ts`'s one-time
fallback message, each reached from both sides by the never-answers, errors, errors-with-no-
message, late-after-ready, cancelled and happy worker doubles and the exporter cases that assert
the fallback message once against the exports that already run. `singleFileBuild.js` sits beside
`vite.config.ts` as plain JavaScript (so Vite's config loader stays native) with its three cases
pinned by `singleFileBuild.test.ts`, and is outside this package's `src` measurement; the dist
shape is pinned outside vitest by the new node-side e2e guard and by one standalone build run
here (exactly `index.html`, the worker inlined as a blob). `exportMP4.perf.test.ts` and the render
pins are byte-unchanged. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/plan`, `@escapesuite/craft` and `@escapesuite/artist` were re-measured 2026-10-01 for
ESCSUITE-31 (the two "Download offline build" anchors fire an analytics event; `recordingDeleted`
and `videoImported` are wired at their one call site each; the never-called `overlayAdded` is
deleted). Plan: 100.00 / 100.00 / 100.00 / 100.00 on both trees — the anchor handler and its
event are three lines, every one executed by the new click cases (lines 73, statements 74,
branches 19, functions 23, each fully covered). Craft: 100.00 / 99.52 / 97.73 / 100.00, the same
four figures as the commit this branch was rebased onto; lines 2,336 → 2,337 and statements
2,488 / 2,500 → 2,489 / 2,501, the one new statement being the `recordingDeleted()` call at the
end of `useRecordingLibrary.ts`'s delete cascade, outside the companion loop, reached by the
single-part, multi-part and companion-rejects cases that now assert it fires exactly once;
branches 1,337 / 1,368 and functions 448 unmoved, the same 31 branches and 12 statements
uncovered as before. Artist: 99.56 / 98.91 / **94.86** / 99.46 against the
99.56 / 98.91 / 94.85 / 99.46 the commit this branch was rebased onto measures — branches up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 4,263 / 4,494
branches and this branch 4,267 / 4,498: four new branches, four covered, the same 231 uncovered
as before; lines 6,813 / 6,843 and statements 7,681 / 7,765 on both trees (the two lines
`videoImported()` adds in `components/VideoUploader.tsx` are balanced by the deleted
`overlayAdded` declaration in `utils/analytics.ts`), and functions 1,682 / 1,691 → 1,681 / 1,690,
the one fewer being that deleted declaration, with the same 30 / 84 / 9 uncovered. The four
branches are the hosted-build gate around the import event, reached from both sides by the
file-drop case against the handoff, load and restore cases that by ruling fire nothing. **No
floor crossed**; plan's floors stay 100 / 100 / 100 / 100, craft's 100 / 99 / 97 / 100 and
artist's 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-151 (a `.veditor` load restores the
bytes ARTIST needs and nothing ESCAPECRAFT owns: a re-stored source carries no `source`,
`takeId`, `role`, `startOffset` or `overlayPlacement`, a source already present keeps its stored
row and only lends those five identity fields, and both paths go through ESCSUITE-97's duration
and dimension recovery): 99.56 / **98.92** / 94.86 / 99.46 against the
99.56 / 98.91 / 94.86 / 99.46 the commit this branch was rebased onto measures — statements up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 4,267 / 4,498
branches and this branch 4,271 / 4,502: four new branches, four covered, the same 231 uncovered
as before (lines 6,813 / 6,843 → 6,830 / 6,860, statements 7,681 / 7,765 → 7,698 / 7,782,
functions 1,681 / 1,690 on both, every denominator growing by exactly what the numerator did;
the same 30 / 84 / 9 uncovered). The four are `core/projectManager.ts`'s
three-way metadata choice for a loaded source — the file's `meta` when it has one, else the
stored row's metadata when the row is present, else the blob probe — and the `existing` gate
that skips `storeVideo` / `storeThumbnail` for a present row, each reached from both sides by
the resurrected-row, present-row, meta-less-file and old-format cases, with the stored
`Infinity` duration and negative dimensions recovered on the present-row path by the two round-3
cases. Three review rounds put them there: the first found the present-row branch returning
stored metadata whole and losing a handed-over take's waveform on reopen, the second found the
meta-less file re-probing a present row, the third found the stored-metadata path skipping
ESCSUITE-97's recovery. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-149 (a storage clear is not undoable:
Clear Unused and Clear All go through one non-history `removeSourceVideosPermanently` that drops
the sources and their clips in a single write, prunes the selection and the clipboard, revokes
the `blob:` thumbnails and scrubs both history stacks, so undo can no longer restore a tile whose
bytes are gone): **99.57** / **98.93** / **94.92** / **99.47** against the
99.56 / 98.92 / 94.86 / 99.46 the commit this branch was rebased onto measures — every figure up,
branches by six hundredths. Measured in one sitting, the base gives 4,271 / 4,502 branches and
this branch 4,304 / 4,534: thirty-two new branches, thirty-three more covered, so the uncovered
column falls 231 → 230 — the one pre-existing arm newly reached is the plural in Clear Unused's
confirm sentence in `components/VideoUploader.tsx`, which the all-deletes-reject case drives with
two unused files where every earlier case had one (lines 6,830 / 6,860 → 6,864 / 6,893 with
30 → 29 uncovered, statements 7,698 / 7,782 → 7,742 / 7,825 with 84 → 83, functions
1,681 / 1,690 → 1,697 / 1,706 with the same 9). The thirty-two are `store/projectSlice.ts`'s
`removeSourceVideosPermanently` — the empty-ids refusal, the "nothing left in the live library
but still in a snapshot" arm that scrubs anyway and returns the identical state object when the
scrub changed nothing, the clip and clipboard prunes — and `store/storeHistory.ts`'s
`scrubRemovedSources`, which touches a snapshot only when it carries a removed source or a clip
of one and returns the same `history` reference otherwise; plus the two Clear handlers' "no
delete succeeded" guards. Each is reached from both sides by the undo-after-clear, redo-after-clear,
already-gone, true-no-op, clipboard-pruned, clipboard-kept-by-reference, mid-loop-lock, partial-
and all-fail cases against the plain clears that were already there; the review's neutering run
(the scrub made a no-op) turned exactly the four scrub-dependent cases red. Both `*.perf.test.ts`
files and the render pins are byte-unchanged. **No floor crossed**; artist's floors stay
99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-3 (a click on a keyframed clip in
the preview selects it at its animated position instead of falling through to the clip beneath):
99.57 / **98.94** / **94.93** / 99.47 against the 99.57 / 98.93 / 94.92 / 99.47 the commit this
branch was rebased onto measures — statements and branches each up a hundredth, lines and
functions unmoved. Measured in one sitting, the base gives 4,304 / 4,534 branches and this
branch 4,311 / 4,541: seven new branches, seven covered, the same 230 uncovered as before (lines
6,864 / 6,893 → 6,870 / 6,899, statements 7,742 / 7,825 → 7,748 / 7,831, functions
1,697 / 1,706 → 1,698 / 1,707, every denominator growing by exactly what the numerator did; the
same 29 / 83 / 9 uncovered). The
seven are `components/Preview/hitTest.ts`'s "keyframed and not in keyframe mode" choice that
replaced the `continue` — the handle pass that still skips a keyframed clip's handles outside
keyframe mode, against the clip pass that now picks it — and `useTransformHandles.ts`'s
`isKeyframeMode` (the panel open and the hit's clip selected) with the cursor refusal it feeds,
which now finds the hit's clip once per pointer move instead of twice; each reached from both
sides by the animated-position and rotation-from-a-keyframe cases (both red under a
`currentTime → undefined` mutant), the plain-above-keyframed and keyframed-above-plain cases, the
panel-open-nothing-selected case and the locked-row refusal that was already there. The four
`*.perf.test.ts` files and the render pins are byte-unchanged; the hit test runs on mousedown
and, through the cursor, on every pointer move, and the removed `continue` makes the common case
cheaper, not dearer. What is deliberately left: a clip animated to opacity 0 still takes the
click (ESCSUITE-155), and the hit box ignores a transition's modifiers (ESCSUITE-147). **No
floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-4 (the media library's upload pulse
is guarded under `prefers-reduced-motion`, a finished upload's row fades out instead of popping,
the upload status is a live region, and the panel's six ad-hoc type sizes become a scale with
nothing below 11px): **99.58** / 98.94 / 94.93 / 99.47 against the 99.57 / 98.94 / 94.93 / 99.47
the commit this branch was rebased onto measures — lines up a hundredth, the other three
unmoved. Measured in one sitting, the base gives 4,311 / 4,541 branches and this branch
4,315 / 4,545: four new branches, four covered, the same 230 uncovered as before (lines
6,870 / 6,899 → 6,876 / 6,905, statements 7,748 / 7,831 → 7,755 / 7,838, functions
1,698 / 1,707 → 1,701 / 1,710, every denominator growing by exactly what the numerator did; the
same 29 / 83 / 9 uncovered). The four are in `components/VideoUploader.tsx`: the fade-start map
that marks one row `removing` and leaves every other row alone, and the row's `removing` class
ternary — each reached from both sides by the two-files-at-once case (one row fading while its
sibling is untouched, both leaving on their own timers, with ESCSUITE-120's unmount-clears-timers
pin intact) against the single-upload cases that were already there; the three new functions
are the fade and removal timer callbacks. The reduced-motion and type-size halves are CSS and
are pinned outside vitest's measurement by two cases in
`apps/e2e/tests/accessibility/core.spec.ts`, run here in Chromium: a probe element wearing the
compiled pulse class computes `animation-name: none` under `reducedMotion: 'reduce'` and a
hashed `pulse` keyframe name without it, and no text in the panel computes below 11px with the
media-type badge inside its thumbnail. The render pins and every `*.perf.test.ts` file are
byte-unchanged. **No floor crossed**; artist's floors stay 99 / 98 / 94 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-22 and ESCSUITE-29's first
mechanism (the WebM export probes VP9 then VP8 at the output size through the one helper the
MP4 ladder uses, probes Opus on its own, configures what the probe answered, reads its encoder's
`error:` callback and rethrows it through the shared backpressure wait with the thirty-second
stuck-encoder timeout; the export dialog disables both downloads with one visible sentence when
the browser has no WebCodecs, disables only the format that cannot be encoded otherwise — the
Advanced "Download" button included, gated on the effective format — and no longer offers a
retry in a format that cannot work): **99.71** / **99.09** / **95.10** / **99.65** against the
99.58 / 98.94 / 94.99 / 99.47 the commit this branch was rebased onto measures — every figure up,
lines by thirteen hundredths, statements by fifteen, branches by eleven and functions by
eighteen. Measured in one sitting, the base gives 4,327 / 4,555 branches and this branch
4,407 / 4,634: seventy-nine new branches, eighty more covered, so the uncovered column falls
228 → 227; lines 6,923 / 6,952 → 7,006 / 7,026 with 29 → 20 uncovered, statements
7,803 / 7,886 → 7,888 / 7,960 with 83 → 72, and functions 1,708 / 1,717 → 1,722 / 1,728 with
9 → 6. The numerators outrun the denominators because the probe-and-fail paths the WebM
exporter and the dialog had carried since they were written — the `error:` callback, the
stuck-encoder timeout, the codec-unsupported refusal, the format radios' handlers — are driven
for the first time by the red cases that mirror the MP4 side's. The seventy-nine new branches
are `core/exportTypes.ts`'s `findSupportedVideoConfig` (now returning the candidate it asked
for beside the browser's normalised config), `webMVideoCodecConfigs`, `hasWebMEncodeGlobals`,
`isWebMExportSupported` and the shared `waitForEncoderBackpressure` that `exportMP4.ts`'s
inline loop became, `core/exportWebM.ts`'s probe, Opus and error arms, and `ExportDialog.tsx`'s
three-state gate, effective-format choice, probe-at-the-selected-resolution and retry gates —
each reached from both sides by the no-WebCodecs, one-format, both-format, saved-MP4-preference,
VP9-unsupported, both-unsupported, Opus-missing, error-during-wait, stale-probe and
preset-change cases, with the review's four mutations each turning a named case red; the
measurement round added the default-`sleep`, WebM-radio and both `getError` cases. Both export
perf ceiling files and the render pins are byte-unchanged. **Two floors rise**: statements
98 → **99** and branches 94 → **95**, in `apps/artist/vite.config.ts` and
`scripts/coverage-report.mjs`, because a floor is the achieved coverage rounded down and this
branch carries both past a whole percent; artist's floors are now 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 for ESCSUITE-13 (timeline waveforms keep their
detail when zoomed in: the visible window of a clip is resampled at the pixel width it is drawn
at, in 64 px offset buckets coalesced on `requestAnimationFrame`, with the output capped at the
source's own peak count, a sample-bounded LRU cache whose evicted buffers are reused, the full-clip
2,000-sample array kept only as the zoomed-out fallback, and a continuous switch between the
two): 99.71 / **99.11** / **95.21** / 99.65 against the 99.71 / 99.09 / 95.10 / 99.65 the
commit this branch was rebased onto measures — statements up two hundredths, branches up eleven,
lines and functions unmoved. Measured in one sitting, the base gives 4,407 / 4,634 branches and
this branch 4,457 / 4,681: forty-seven new branches, fifty more covered, so the uncovered column
falls 227 → 224 (lines 7,006 / 7,026 → 7,082 / 7,102 with the same 20 uncovered, statements
7,888 / 7,960 → 7,972 / 8,043 with 72 → 71, functions 1,722 / 1,728 → 1,729 / 1,735 with the
same 6). The new decisions are `components/Timeline/AudioWaveform.tsx`'s window bucketing, its
"fully off-screen" early return taken before bucketing, the cache key, hit and touch-on-hit, the
two eviction triggers (a 500,000-sample budget, stated in bytes in its comment, and an entry cap
that only guards the sparse-entry case), the free-buffer pool and its cap, and the
`devicePixelRatio` fallback; `useScrollSync.ts`'s rAF coalescing in a `useLayoutEffect` sized
on the same frame as the scroll; `Timeline.tsx`'s measured first-paint width with a finite
fallback where `Infinity` used to be; `TimelineTrack.tsx`'s stable per-clip range objects and the
prune that drops a removed clip's cache entry; and `utils/waveform.ts`'s buffer-reusing resample
— each reached from both sides by the zoom-10 detail case (an exact 10×, not a tie), the seam
case at the switch count, the 300 px drag that resamples five or six times and not twenty, the
LRU-versus-FIFO case, the burst past the pool cap, the left-edge and prune cases, and the
scroll-and-zoom cases that were already there. One guard the measurement found reachable only
through a sparse array — the single-sample path's null check — was deleted rather than tested,
the way ESCSUITE-110 and 118 treated theirs, and `utils/waveform.ts` is 100 on all four without
it. The new `TimelineTrack.waveform.perf.test.ts` pins one resample per bucket crossing, none
per animation frame, no allocation in the draw path and one `fillRect` per visible sample, each
with its dated measurement; `timelineGestures.perf.test.ts`, `drawFrame.perf.test.ts`, both
export ceilings and the render pins are byte-unchanged. The one branch still uncovered in
`AudioWaveform.tsx` is its pre-existing `if (!ctx)`. **No floor crossed**; artist's floors stay
99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-01 at the end of ESCSUITE-6 (clip crop v1: an
optional `clip.crop` of four inset fractions, `core/clipCrop.ts`, the renderer's nine-argument
`drawImage` over `croppedSourceRect`, the preview chrome measuring the cropped picture,
`parseProject` refusing a malformed crop, and the inspector's "Crop" section): **99.72** / **99.12** /
**95.26** / 99.65 against the 99.71 / 99.11 / 95.21 / 99.65 the commit this branch lands on
(`59d321d`) measures — lines and statements up a hundredth, branches up five, functions unmoved.
Measured in one sitting, the base gives 4,457 / 4,681 branches and this branch 4,507 / 4,731: fifty
new branches, fifty covered, the same 224 uncovered as before (lines 7,082 / 7,102 → 7,145 / 7,165,
statements 7,972 / 8,043 → 8,044 / 8,115, functions 1,729 / 1,735 → 1,746 / 1,752, every denominator
growing by exactly what the numerator did; the uncovered counts — 20 lines, 71 statements, 224
branches, 6 functions — are identical on both trees, file by file). The fifty are `core/clipCrop.ts`'s
twenty-three (`isValidCrop`'s shape and range arms, `normaliseCrop`'s all-zero and sub-pixel
refusals, `croppedSourceRect`'s one-pixel floors, `cropForAspect`'s wider-or-taller choice and its
degenerate-source guard), `store/projectMigration.ts`'s four (a present-but-malformed crop refused
with one `reason`, an absent one accepted), `components/ClipEditor/useClipEditorActions.ts`'s twelve
(`handleCropChange`'s normalise-or-remove write, the sourceless clip that still accepts the all-zero
write and refuses any inset, and Fit to Canvas reading the cropped drawn size), `CropSection.tsx`'s
four and `ClipEditor.tsx`'s seven (the section's media-only slot after "Mask & Stroke", the locked
track's disabled fieldset and header Reset) — each reached from both sides by that module's own
cases. `core/canvasRenderer.ts` and `components/Preview/previewGeometry.ts` gained one statement
each and no branch: the nine-argument draw and the cropped size are unconditional, which is the
design's point — four readers of one pure function cannot disagree. The whole-branch review's one
fix round (Fit to Canvas fitting the cropped picture, the all-zero write on a sourceless clip) is in
these numbers. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 at the end of ESCSUITE-34 (an animated GIF as a third
export format, through `gifenc` and no WebCodecs at all; the WebM exporter's per-frame machinery
lifted into `core/elementFrames.ts` so the two element-drawing exporters share it; the dialog's GIF
radio, frame rate, per-format presets, two size estimates and 30-second note; the headless kit
rendering `format: "gif"`): **99.78** / **99.18** / **95.37** / **99.66** against the
99.72 / 99.12 / 95.26 / 99.65 the commit this branch lands on (`d8868d2`) measures — every figure up,
and this time because the *uncovered* column shrank as well as the covered one growing: lines
7,145 / 7,165 → 7,265 / 7,281 (uncovered 20 → 16), statements 8,044 / 8,115 → 8,166 / 8,233
(71 → 67), branches 4,507 / 4,731 → 4,597 / 4,820 (224 → 223) and functions 1,746 / 1,752 →
1,768 / 1,774 (6 → 6). The branch count is the one to read carefully, because the move inside it
is larger than the net. `core/exportWebM.ts` went 127 / 141 → 69 / 72 — its fourteen uncovered
arms were nearly all in the frame loop, and the loop moved — and `core/elementFrames.ts` arrives at
60 / 69: nine of those fourteen, carried across in the lift (the `readyState` poll's never-ready
arm, the paused-video and image fallbacks, the two `?? ` defaults in the composer) and *two* of them
newly reached by `elementFrames.test.ts`'s sixteen module-level cases, which is where the net
224 → 223 comes from. Everything the ticket wrote is covered from both sides: `core/gifEncoder.ts`
4 / 4, `core/exportGIF.ts` 33 / 34 — its one uncovered arm is the `error instanceof Error ?
error.message : String(error)` fallback in the catch, the exact parity of `exportWebM.ts`'s own
uncovered `String(error)` arm, which the Task 3 review ruled stays rather than be tested for a
throw no caller makes — `core/exportTypes.ts`'s ten new arms (`gifFrameRate`'s and
`gifFrameDelayMs`'s option checks, `resolutionForFormat` in both directions, `estimateGifBytes`),
`components/Export/ExportDialog.tsx`'s thirty-five (the GIF dispatch branch, the format gates on
the Quality, audio and background-tab affordances, the two estimates, the 30-second note, the
no-WebCodecs alert's second sentence) at 169 / 170 with the same one pre-existing arm uncovered,
and `headless/renderProject.ts`'s six (the three-way dispatch, the GIF duration) with the same
three pre-existing uncovered. The branch deletes one fully covered function (`isGIFExportSupported`,
which had no production caller), so the functions denominator grows by one fewer than the new
module's fifteen, four and four. The three pre-existing export and preview ceiling files and every
rerender pin are byte-identical to the base; `core/exportGIF.perf.test.ts` is the new ceiling file,
and its laws are exact — one `getImageData`, one `addFrame`, one `setTransform` and zero
`VideoFrame`s per frame. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/headless-artist` was re-measured 2026-10-02 for the same ticket: **99.46** / **99.37** /
**98.19** / 98.52 against the 99.45 / 99.36 / 98.16 / 98.52 the same base measures — lines, statements
and branches each up a hundredth or three, functions unmoved. Measured in one sitting, the base gives
481 / 490 branches and this branch 489 / 498: eight new branches, eight covered, the same 9 uncovered
as before (lines 735 / 739 → 742 / 746, statements 785 / 790 → 792 / 797, functions 134 / 136 on
both; the same 4 / 5 / 9 / 2 uncovered). All eight are in `src/jobSpec.ts`'s `parseOptions`: `gif`
joining `FORMATS`, `360p` joining `RESOLUTIONS`, and the `fps` rule — present only with
`format: "gif"`, an integer in {10, 15, 20}, refused on the two video formats — each reached from
both sides by the accept and reject cases the validator suite gained. The widened `RenderMeta['format']`
forced `gif` keys into the two sink maps, which `tsc` found; neither is a branch. The GIF Chromium
parity case (`run.chromium.test.ts`, `GIF89a` in, manifest `format: 'gif'` out) is outside this
measurement and was run twice here: 28 / 28 both times. **No floor crossed**; the kit's floors stay
99 / 99 / 98 / 98.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-155 (a clip whose evaluated opacity is 0
no longer takes the click in the preview, and a selected keyframed clip draws its selection box at
its animated position): 99.78 / 99.18 / 95.37 / 99.66, byte-identical on every percentage to the
99.78 / 99.18 / 95.37 / 99.66 the commit this branch lands on (`c89cf40`) measures. Measured in one
sitting, the base gives 4,597 / 4,820 branches and this branch 4,603 / 4,826: six new branches, six
covered, the same 223 uncovered as before (lines 7,265 / 7,281 → 7,268 / 7,284, statements
8,166 / 8,233 → 8,170 / 8,237, functions 1,768 / 1,774 → 1,769 / 1,775, every denominator growing by
exactly what the numerator did; the same 16 / 67 / 6 uncovered). The six are the net of three files:
`components/Preview/hitTest.ts` gains the two arms of the z-order loop's `getClipOpacity(...) <= 0`
skip, `previewGeometry.ts` gains `getClipOpacity`'s eight — the no-animation choice and the
`|| DEFAULT_TRANSFORM` / `|| DEFAULT_EFFECTS` fallbacks on both paths, each reached from both
sides by that function's own four cases (the animated-path fallbacks were the two arms the first
rebased measurement found unreached, and the case that covers them is the branch's last commit) —
and `selectionOverlay.ts` loses four, the `hasCustomKeyframes && !keyframePanelOpen` early return
that drew no chrome for a keyframed clip, deleted along with its import. `getClipOpacity`'s
outside-the-clip fallback was deleted rather than tested: its one caller is fed clips
`getClipsAtTime` has already filtered. `drawFrame.perf.test.ts` and every rerender pin are
byte-identical. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-148 (the `?loadVideo=` handoff of a
single-file audio-only take — an audio primary with no companions — pinned end to end, and the one
real defect those pins found fixed: the media library's lazy thumbnail rebuild no longer asks
storage for a thumbnail an audio source never had): 99.78 / 99.18 / 95.37 / 99.66, byte-identical on
every percentage to the 99.78 / 99.18 / 95.37 / 99.66 the commit this branch lands on (`c89cf40`)
measures. Measured in one sitting, the base gives 4,597 / 4,820 branches and this branch
4,598 / 4,821: one new branch, covered, the same 223 uncovered as before, and lines, statements and
functions unmoved at 7,265 / 7,281, 8,166 / 8,233 and 1,768 / 1,774 (the same 16 / 67 / 6 uncovered).
The one is the `source.mediaType === 'audio'` operand `components/VideoUploader.tsx`'s ESCSUITE-117
rebuild effect gained in its skip guard, reached with an audio source by the red case and without
one by the thumbnail-less video case that was already there. The other two pins — the importer's
single-file audio primary and the store's single-audio-part placement (lowest empty track, default
transform, no mask or stroke, resolution untouched, one undo entry) — were green on arrival, which the
ticket anticipated, and add no unit to any denominator. Every perf and rerender pin is byte-identical.
**No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/headless-artist` was re-measured 2026-10-02 for ESCSUITE-150 (`loadBundle` forwards a
bundle source's validated `meta`, so an ESCAPECRAFT audio-only take typed `video/webm;codecs=…` stays
`mediaType: 'audio'` in the kit the way it does in the editor, and a WebM source's temp file keeps a
`.webm` extension whatever parameters its MIME type carries): 99.46 / 99.37 / **98.20** / 98.52 against
the 99.46 / 99.37 / 98.19 / 98.52 the commit this branch lands on (`c89cf40`) measures — branches up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 489 / 498 branches and
this branch 493 / 502: four new branches, four covered, the same 9 uncovered as before (lines
742 / 746 → 745 / 749, statements 792 / 797 → 795 / 800, functions 134 / 136 on both; the same 4 / 5 / 2
uncovered). All four are in `src/loaders.ts`: the `meta` spread's present-or-absent choice and the
parameter-stripping extension lookup's two fallbacks, each reached from both sides by the audio-meta
bundle, the meta-less bundle and the `audio/webm` / `video/webm;codecs=vp9,opus` extension cases.
`apps/artist/src/headless/seedSources.ts` needed no change — a caller-supplied `meta.mediaType`
already won over the implied one — so the artist package's figures do not move. **No floor
crossed**; the kit's floors stay 99 / 99 / 98 / 98.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-154 (the media library's per-item Remove
goes through the non-undoable `removeSourceVideosPermanently` after the bytes are deleted, says how
many clips go with it, reports a storage failure through the notice channel, and the now-callerless
`removeSourceVideo` action is deleted): **99.79** / **99.19** / 95.37 / 99.66 against the
99.78 / 99.18 / 95.37 / 99.66 the commit this branch lands on (`c89cf40`) measures — lines and
statements up a hundredth, branches and functions unmoved, and every denominator smaller: lines
7,265 / 7,281 → 7,257 / 7,272, statements 8,166 / 8,233 → 8,154 / 8,220, branches 4,597 / 4,820 →
4,594 / 4,817 and functions 1,768 / 1,774 → 1,762 / 1,768. The deletion is why: `store/projectSlice.ts`
loses `removeSourceVideo`'s ten fully covered branches, eighteen statements and seven functions, the
same arithmetic ESCSUITE-99 and 108 went through, while `components/VideoUploader.tsx` gains seven
branches (the post-`deleteVideo` ordering, the clip-count plural in the confirm copy, the optional
`showNotification` call on a rejected delete and `VideoLibrary`'s default props) — every one reached
from both sides by the red cases (undo does not restore a byteless tile, a clip-bearing tile's clip
and selection go with it, the one-clip and N-clip copy, a rejected delete that leaves the tile and
reports) and the plain removals that were already there — and one uncovered statement fewer, the
old `catch` arm now reached by the rejection case. The uncovered counts read 16 → 15 lines,
67 → 66 statements, 223 → 223 branches and 6 → 6 functions. Every perf and rerender pin is
byte-identical. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-156 (a WebM or GIF export whose setup
throws between the media load and the frame loop releases what it loaded; a corrupt image is
warned about and skipped instead of aborting the load; the readiness poll cancels itself when its
300 ms fallback fires, and the fallback is cleared when readiness arrives first): 99.78 / **99.19** /
**95.41** / 99.66 against the 99.78 / 99.18 / 95.37 / 99.66 the commit this branch lands on
(`c89cf40`) measures — statements up a hundredth, branches up four, lines and functions unmoved, and
for the second time this week with *fewer* uncovered units: lines 7,265 / 7,281 → 7,276 / 7,292
(16 → 16 uncovered), statements 8,166 / 8,233 → 8,177 / 8,243 (67 → 66), branches 4,597 / 4,820 →
4,595 / 4,816 (223 → 221) and functions 1,768 / 1,774 → 1,769 / 1,775 (6 → 6). The branch denominator
*shrank* by four because `core/exportWebM.ts`'s two guarded encoder-close blocks became one loop over
the encoders it had opened (69 / 72 → 66 / 68: four fewer arms and one fewer uncovered, the loop being
reached with zero, one and two entries by the configure-throws, audio-abort and muxer-failure cases),
and `core/elementFrames.ts` went 60 / 69 → 61 / 69 with no new arm at all: the image branch's
warn-and-skip reuses the video branch's existing fallback shape, the readiness wait's cancellation is
two unconditional handles, and the one arm newly reached is the poll's never-ready side, which the
fake-timer case drives for the first time. `elementFrames.ts` also reaches 118 / 118 statements
(from 108 / 109): the never-ready statement was the one it carried uncovered. The four export and
preview ceiling files and every rerender pin are byte-identical — nothing per frame moved. **No
floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-147 (the selection chrome, the click
target, the marquee and a keyframe-mode drag's seed evaluate a clip under the same Animate In/Out
preset suppression the renderer uses for its side of a transition, so the box follows the picture;
and, after ESCSUITE-155 landed beneath it, the opacity gate does too): 99.79 / 99.21 / **95.42** /
99.66 against the 99.79 / 99.21 / 95.41 / 99.66 the commit this branch lands on (`1b5bb17`)
measures — branches up a hundredth, the other three unmoved. Measured in one sitting, the base gives
4,599 / 4,820 branches and this branch 4,607 / 4,828: eight new branches, eight covered, the same
221 uncovered as before (lines 7,271 / 7,286 → 7,277 / 7,292, statements 8,169 / 8,234 →
8,178 / 8,243, functions 1,764 / 1,770 → 1,766 / 1,772, every denominator growing by exactly what the
numerator did; the same 15 / 65 / 6 uncovered). All eight are `core/exportTypes.ts`'s
`presetSuppressionFor(clip, transition)` — no transition, an overlay (never suppressed, because the
renderer never suppresses one), the outgoing side, the incoming side, and a transition naming neither
clip — each reached from both sides by that function's own cases and by the ten red cases across
`previewGeometry`, `dragGeometry`, `hitTest`, `selectionOverlay` and the two `PreviewPlayer` suites
(480 where the picture is at 960). `components/Preview/previewGeometry.ts`, `hitTest.ts`,
`dragGeometry.ts` and `useTransformHandles.ts` gained no branch: the suppression is one trailing
optional argument threaded through, and the active transition is memoised once per
clips/tracks/time in the gesture hook and derived inside each chrome callback from the drawn time
in `PreviewPlayer` (so the callbacks' identities stay off the playhead). `PRESET_SUPPRESSION` moved
from `core/canvasRenderer.ts` to `utils/animation.ts` — one frozen pair shared by renderer and
readers, one statement each way. The transition's own geometric offset is deliberately not applied
to the box (a drag seeded from it would write keyframes displaced by the transition delta), and is
documented as a limit beside the circle-mask one. `drawFrame.perf.test.ts` and every rerender pin
are byte-identical. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 at the end of ESCSUITE-157 (crop v2: a crop mode on
the preview — the whole source dimmed, the kept region bright, eight DOM handles on its edges and
corners with a pointer drag that writes one `updateClip(id, { crop, transform })` per move from the
gesture's start transform, crop alone on a keyframed placement, Shift keeping the aspect preset,
arrow-key nudges announced through the live region, Escape to leave; the `cropClipId` latch and a
time-aware `cropTarget`; the inspector's "Crop on canvas" toggle): **99.80** / **99.23** / **95.53** /
**99.67** against the 99.79 / 99.21 / 95.42 / 99.66 the commit this branch lands on (`cc56e38`)
measures — every figure up, with the uncovered column unmoved: lines 7,277 / 7,292 → 7,498 / 7,513,
statements 8,178 / 8,243 → 8,435 / 8,500, branches 4,607 / 4,828 → 4,729 / 4,950 and functions
1,766 / 1,772 → 1,821 / 1,827, every denominator growing by exactly what the numerator did (the same
15 / 65 / 221 / 6 uncovered, file by file). The 122 new branches are the three new modules at
100 — `core/cropDrag.ts` 42 / 42 (`sourceDelta`'s rotation, `cropForHandleMove`'s eight handles with
the opposite edge pinned and the aspect-locked dependent inset, `clampMoved`'s one-pixel floor and
its negative-ceiling arm on a source narrower than ten pixels, `cropCompensatesCentre`,
`cropWriteFor`'s keyframed-placement side), `components/Preview/cropOverlay.ts` 25 / 25 (the
even-odd ring, the readiness veil, the before-start and after-end halves of the time window) and
`useCropHandleGesture.ts` 20 / 20 (the owned and unowned arrows, Shift, the held-key repeat, the
degenerate content box, the clip the store no longer holds) — plus `CropHandles.tsx` 6 / 6,
`core/clipCrop.ts`'s ten for `cropUpdateFor` (the decision the inspector and the handles now
share), `CropSection.tsx`'s two for the toggle disabled on a locked track or a vanished source,
`useAppKeyboardShortcuts.ts`'s two for Escape leaving crop mode, and `PreviewPlayer.tsx`'s nineteen
for the chrome, the mount and the readiness predicate it shares with `drawFrame.ts` (whose own
denominator fell by two as that predicate moved out of its inline form). `useClipEditorActions.ts`
lost two: the `!selectedClip` guard on the toggle's handler, unreachable behind `ClipEditor`'s own
early return and deleted rather than tested. The first measurement of the rebased branch came back
one function short — the `onLeave` arrow `PreviewPlayer` hands the mounted handles, pinned by the
component suite through a spy and by nothing through the preview — and the case that drives Escape
on a mounted handle to the store is the branch's last commit. No new `*.perf.test.ts`: the crop
chrome is drawn where the selection chrome is drawn and returns during playback, so its
conservation laws (zero context calls when crop mode is off; one `drawImage`, one `clip`, one
`translate`, one `rotate`, `save` balanced with `restore` when on) live in `cropOverlay.test.ts` and
are asserted exactly. The seven pins and `perfScene.ts` are byte-identical. **No floor crossed**;
artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/headless-artist` was re-measured 2026-10-02 for ESCSUITE-158 (a manifest source can carry
`meta` — media type and dimensions — so an audio-only file renders as audio the way a bundle source
already does; one shared `assertSourceMeta` validates both inputs; the MIME type is lower-cased
before the extension lookup): **99.47** / **99.38** / **98.27** / **98.56** against the
99.46 / 99.37 / 98.20 / 98.52 the commit this branch lands on (`cc56e38`) measures — every figure up
a hundredth or several, with the uncovered counts unmoved. Measured in one sitting, the base gives
493 / 502 branches and this branch 513 / 522: twenty new branches, twenty covered, the same 9
uncovered as before (lines 745 / 749 → 760 / 764, statements 795 / 800 → 810 / 815, functions
134 / 136 → 137 / 139; the same 4 / 5 / 2 uncovered). All twenty are `src/loaders.ts`'s: the
manifest entry's `meta` present-or-absent choice, `assertSourceMeta`'s six arms (the `mediaType`
enum, `width` and `height` finite and non-negative, `duration` finite and positive, each from both
sides), the top-level-wins precedence over `meta` for the three numeric fields, and the lower-cased
MIME lookup — reached by the manifest suite's new cases and, after the review's fix round, by the
bundle suite's own rejections and acceptances (the stricter bundle-side validation this branch
introduced had no bundle-side test until then). **No floor crossed**; the kit's floors stay
99 / 99 / 98 / 98.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-159 (a WebM export that fails mid-way
cancels its muxer — only while mediabunny's own `state` is `'started'`, and only after its encoders
are closed, so no queued chunk reaches a cancelled output; a throw after the success-path release
no longer releases the export's media twice, in either element exporter; the seek wait clears its
timeout on `seeked` and drops its listener on timeout): 99.80 / 99.23 / 95.53 / 99.67,
byte-identical on every percentage to the 99.80 / 99.23 / 95.53 / 99.67 the commit this branch lands
on (`7dc92b7`) measures. Measured in one sitting, the base gives 4,729 / 4,950 branches and this
branch 4,733 / 4,954: four new branches, four covered, the same 221 uncovered as before (lines
7,498 / 7,513 → 7,516 / 7,531, statements 8,435 / 8,500 → 8,453 / 8,518, functions 1,821 / 1,827 →
1,824 / 1,830, every denominator growing by exactly what the numerator did; the same 15 / 65 / 6
uncovered). The four are `core/elementFrames.ts`'s run-once `createElementSourceRelease` (released
already or not — both exporters call it from the success path and the catch) and
`core/exportWebM.ts`'s `muxerOutput?.state === 'started'` guard (a mid-loop throw cancels once; a
throw after `finalize()` resolved, or a rejected `finalize()` that mediabunny has already moved to
`'canceled'`, cancels nothing), each reached from both sides by the red cases — the queued-chunk
`lateAdds` case that the review's MAJOR 1 turned up, the rejecting `cancel()` whose warning is
asserted, the throwing `complete` callback in both exporters, and the no-bytes refusal. The seek
wait's cancellation adds statements and functions and no decision, like the readiness wait's did in
ESCSUITE-156. The four export and preview ceiling files and every rerender pin are byte-identical.
**No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-160 (the preview's DOM layers — the crop
handles and the inline text editor — gate on the canvas element held in state rather than a ref read
during render, so a canvas remount under an open crop mode no longer drops them for a pass):
99.80 / 99.23 / 95.53 / 99.67, byte-identical on every percentage to the 99.80 / 99.23 / 95.53 /
99.67 the branch was cut from and measured against (`7dc92b7`; ESCSUITE-159 lands between them and
moves the exporters only). Measured in one sitting, the base gives 4,729 / 4,950 branches and this
branch the same 4,729 / 4,950: the change adds no decision at all — lines 7,498 / 7,513 →
7,502 / 7,517 and statements 8,435 / 8,500 → 8,439 / 8,504 (the `useState`, the callback ref that
sets both the state and `canvasRef.current`, and the two JSX gates reading the state) and functions
1,821 / 1,827 → 1,822 / 1,828 (the callback ref), every one covered, and the same 15 / 65 / 221 / 6
uncovered. The two red cases — the crop handles absent for the render after a canvas remount, and
the inline editor lingering over a detached canvas during unmount — reach the gates' null side on the
first render and their element side on every later one. `MarqueeSelection` carries no canvas gate
and is untouched. Every perf and rerender pin is byte-identical: the state changes on mount and
unmount only. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-166 (`setClipKeyframe`'s time-0 seed fires
once per property — gated on the property having no keyframes before the write — instead of on every
write, so a keyframe at 0 the user deleted or dragged away no longer comes back on the next edit):
99.80 / 99.23 / 95.53 / 99.67, byte-identical on every percentage to the 99.80 / 99.23 / 95.53 / 99.67
the commit this branch lands on (`177577e`) measures. Measured in one sitting, the base gives
4,733 / 4,954 branches and this branch the same 4,733 / 4,954: the gate swapped one condition for
another and adds no decision; lines 7,520 / 7,535 → 7,519 / 7,534, statements 8,457 / 8,522 →
8,455 / 8,520 and functions 1,825 / 1,831 → 1,824 / 1,830 each one or two smaller — the deleted
`hasKeyframeAtZero` scan and its arrow — with the same 15 / 65 / 221 / 6 uncovered. The two red cases
(a deleted time-0 keyframe stays deleted across a later edit; a keyframe moved off 0 stays moved) and
the review's extra case (a property emptied by deletion is a first-time property again and seeds) reach
both operands of the new gate from both sides, beside the first-write seed that was already pinned.
Every perf and rerender pin is byte-identical. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-161 and ESCSUITE-162 (a trim stops at the clip
next to it on the same row, and a paste at the playhead moves to the first free span instead of stacking on a
clip already there): 99.80 / **99.24** / **95.54** / 99.67 against the 99.80 / 99.23 / 95.53 / 99.67 the commit
this branch lands on (`46c2b76`) measures — statements and branches each up a hundredth, lines and functions
unmoved. Measured in one sitting, the base gives 4,733 / 4,954 branches and this branch 4,766 / 4,988:
thirty-four new branches, thirty-three covered, and the uncovered column 221 → 222 — the one is not this
ticket's. Every file the branch touches measures 100 on all four: `store/timelineSnapping.ts` 32 → 60 branches
(`clampTrimToNeighbours`'s per-edge neighbour choice, `firstFreeGroupStart`'s sorted-span sweep, and the
`OVERLAP_EPSILON` in `wouldOverlap` — a clamped butt-up writes `p + ((s + (L - p)) - s)`, which is not `L` in
8% of random triples and lands a float bit inside the neighbour, worst observed 3.55e-15 s, so the strict
predicate refused every group drag of two butted clips until the epsilon), `components/Timeline/useTrimDrag.ts`
20 → 26 (the clamp applied to the pointer time, the ripple exception narrowed to the end edge — a ripple start
trim moves nothing on release — and the `changesClip` gate that writes once while the pointer is held past the
neighbour), and `store/selectionSlice.ts`'s `pasteClips` relocation, which adds statements and no decision.
The extra uncovered branch is in `components/Preview/drawFrame.ts`, a file and a test suite this branch does
not touch: the `|| 0` fallback in the z-order sort comparator's `a.track?.index || 0` read 61 / 68 on the base
run and 60 / 68 here, one hit against none, the same Istanbul drift ESCSUITE-91 and ESCSUITE-113 recorded, and
it is not counted against the ticket. Lines 7,519 / 7,534 → 7,548 / 7,563, statements 8,455 / 8,520 →
8,491 / 8,556 and functions 1,824 / 1,830 → 1,830 / 1,836 each grew by exactly what their numerators did (the
same 15 / 65 / 6 uncovered). The seven perf/rerender pins and `perfScene.ts` are byte-identical. **No floor
crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-169 and ESCSUITE-170 (releasing Shift or losing
focus during a crop-handle drag no longer ends the gesture's undo scope, the inspector's slider gesture gets
the same two guards, and the Escape cascade reads the crop latch through the resolved target so an inert latch
no longer swallows Escape): 99.80 / 99.23 / **95.55** / 99.67 against the 99.80 / 99.23 / 95.53 / 99.67 the
commit this branch was rebased onto (`46c2b76`) measures — branches up two hundredths, the other three
unmoved. Measured in one sitting, the base gives 4,733 / 4,954 branches and this branch 4,749 / 4,970:
sixteen new branches, sixteen covered, the same 221 uncovered as before (lines 7,519 / 7,534 →
7,540 / 7,555, statements 8,455 / 8,520 → 8,482 / 8,547, functions 1,824 / 1,830 → 1,830 / 1,836, every
denominator growing by exactly what the numerator did; the same 15 / 65 / 6 uncovered). The sixteen are
`components/Preview/useCropHandleGesture.ts`'s six (the mouse-drag-open guard on `onKeyUp` and on the now
separate `onBlur`, and the arrow-key-only test on `onKeyUp` — reached in isolation by the keyboard-only case
the review asked for), `components/ClipEditor/useSliderGesture.ts`'s eight (`RANGE_KEYS` membership on
`onKeyDown` and `onKeyUp`, the pointer-drag-open guard on each, and `onBlur` resetting the pointer flag before
it ends the gesture — the review's one MAJOR, a blurred drag otherwise leaving every later keyboard nudge
unscoped) and `app/useAppKeyboardShortcuts.ts`'s two (`cropClipId === selectedClipId`), each reached from both
sides by the Shift-mid-drag, blur-mid-drag, keyboard-only, pointer-then-blur-then-nudge and the three
latch-state (null, live, inert) cases against the ordinary gestures that were already there. The seven

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-171 (every crop write — the inspector's sliders
and aspect presets as well as the preview's handles — goes through `cropWriteFor` with its compensating
centre, so the inspector's Reset no longer leaves a handle-dragged picture displaced; and crop mode refuses a
clip on a hidden track, chrome and handles both): 99.80 / 99.23 / **95.54** / 99.67 against the
99.80 / 99.23 / 95.53 / 99.67 the commit this branch was rebased onto (`46c2b76`) measures — branches up a
hundredth, the other three unmoved. Measured in one sitting, the base gives 4,733 / 4,954 branches and this
branch 4,739 / 4,960: six new branches, six covered, the same 221 uncovered as before (lines 7,519 / 7,534 →
7,523 / 7,538, statements 8,455 / 8,520 → 8,461 / 8,526, functions 1,824 / 1,830 → 1,825 / 1,831, every
denominator growing by exactly what the numerator did; the same 15 / 65 / 6 uncovered). The six are
`components/Preview/cropOverlay.ts`'s four — `cropTarget`'s `!track` and `!track.visible` operands, the
byte-for-byte shape `store/clipQueries.ts` uses, reached with the track hidden, shown again and absent — and
`components/ClipEditor/useClipEditorActions.ts`'s two, `handleCropChange`'s keyframed-or-not choice through
`cropCompensatesCentre`, reached by the keyframed placement (crop alone) against the static one (crop plus
the compensating transform, pinned from the clamped crop against a mutant that compensated from the raw
one). Three `handleCropChange` expectations changed because the write legitimately carries a `transform`
now; `ClipEditor.rerender.test.tsx` is byte-identical with no new inspector subscription, and the seven
perf/rerender pins and `perfScene.ts` are byte-identical. **No floor crossed**; artist's floors stay
99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-164 and ESCSUITE-165 (opening a `.veditor`
file clears the undo history once its sources have landed, the parity a session restore and New Project
already had, instead of leaving 2 + N entries whose first undo stranded the loaded project with a half-empty
library; and the in/out drag orders its own crossing, so dragging the in handle past the out point spans the
region from the stationary point to the pointer instead of collapsing it to one move's width):
99.80 / **99.25** / **95.57** / 99.67 against the 99.80 / 99.24 / 95.54 / 99.67 the commit this branch was
rebased onto (`599d505`, the ESCSUITE-161 / 162 squash) measures — statements up a hundredth, branches up
three, lines and functions unmoved. Measured in one sitting, the base gives 4,766 / 4,988 branches and this
branch 4,775 / 4,996: eight new branches, nine more covered, so the uncovered column falls 222 → 221 — the
one pre-existing arm newly reached is `store/historySlice.ts`'s `clearHistory` (2 / 4 → 3 / 4), which the
file-load path now calls and no test had driven through the real store before (lines 7,548 / 7,563 →
7,566 / 7,581 with the same 15 uncovered, statements 8,491 / 8,556 → 8,510 / 8,574 with 65 → 64, functions
1,830 / 1,836 on both). The eight new branches are all `components/Timeline/useInOutDrag.ts`'s (10 → 18):
which point the gesture holds, the crossing test on each side, the explicit two-point write at the crossing
and the flip of the dragged point for the rest of the gesture — each reached from both sides by the
in-past-out and out-past-in cases, the non-crossing drag that leaves the other point untouched, the
cross-and-cross-back case, and the review's case that changes the stationary point from the store between
two moves and then crosses (the hook reads the live value at the crossing, not a value captured at
mousedown). The review's first version had made the hook's `inPoint` / `outPoint` deps optional so a perf
test's cast would compile; the cast compiles with them required, so the `?? null` arms were deleted rather
than tested and `timelineGestures.perf.test.ts` is byte-identical. `app/useProjectActions.ts` gained one
statement — the `clearHistory()` call after the last source — and no decision; the three failure paths each
pin that it is never reached. The seven perf/rerender pins and `perfScene.ts` are byte-identical. **No floor
crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-163 and ESCSUITE-167 (a diagonal keyframe
drag in the graph is one undo entry — the move committed first, the value only if the move landed, under the
same entry through `useGestureHistory`, and the deferral that split them deleted; `moveClipKeyframe` refuses
an unknown clip, a property with no keyframes or an origin holding none; the diamond-row drag no longer snaps
onto an occupied time and refuses a drop within `KEYFRAME_TIME_EPSILON` of one through the shared
`occupiedTimeMessage` and the panel's one live region; a row's double-click adds at the curve's value; and the
drag binds its listener pair and computes its occupied list once per gesture): 99.80 / 99.24 / **95.58** /
99.67 against the 99.80 / 99.24 / 95.54 / 99.67 the commit this branch was rebased onto (`599d505`, the
ESCSUITE-161 / 162 squash) measures — branches up four hundredths, the other three unmoved. Measured in one
sitting, the base gives 4,766 / 4,988 branches and this branch 4,766 / 4,986: the denominator *shrank* by two
and the uncovered column by two (222 → 220), with the covered count unchanged, because the new decisions
and the deleted ones balance — `components/KeyframePanel/KeyframePanel.tsx` went 52 / 64 → 46 / 56 (eight
per-row live regions became one shared `role="status"` fed by an `onAnnounce` prop, taking two uncovered
render arms with them), `hooks/useKeyframeDrag.ts` 16 / 16 → 14 / 14 (the two `isDragging` guards the
review found unreachable behind `useWindowListener`'s own gate were deleted rather than tested; the
occupancy refusal and the once-per-gesture `occupiedTimesRef` are the new arms, and the `drag.property`
guard's idle side — a second mouseup landing before React re-renders — is reached by the case the
measurement round added), `KeyframeGraph.tsx` 107 / 116 → 111 / 120 and `store/keyframeSlice.ts`
63 / 74 → 67 / 78 (the move-then-value commit and the three pre-`set` refusals, each from both sides, with the
same nine and eleven pre-existing arms uncovered as before). Lines 7,548 / 7,563 → 7,568 / 7,583,
statements 8,491 / 8,556 → 8,516 / 8,581 and functions 1,830 / 1,836 → 1,837 / 1,843 each grew by exactly
what their numerators did (the same 15 / 65 / 6 uncovered). `keyframeGestures.perf.test.ts` is the new
ceiling file — exactly two listener adds and two removes per gesture, one occupied-list build per gesture
regardless of the number of moves — and the six pre-existing perf files, the three rerender pins and
`perfScene.ts` are byte-identical. The graph's own point drag can still land on a neighbour and is
ESCSUITE-179. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/craft` was re-measured 2026-10-02 for ESCSUITE-174 (Escape while a take is being saved no longer
runs the cancel handler, and the save's completion carries the identity of the take it saved, so a late
`setState('idle')` can never land on a later take): 100.00 / 99.52 / **97.74** / 100.00 against the
100.00 / 99.52 / 97.73 / 100.00 the commit this branch was rebased onto (`94e673d`) measures — branches up a
hundredth, the other three unmoved at exactly 100, 99.52 and 100. Measured in one sitting, the base gives
1,337 / 1,368 branches and this branch 1,342 / 1,373: five new branches, five covered, the same 31 uncovered as
before (statements 2,489 / 2,501 → 2,490 / 2,502, lines 2,337 and functions 448 on both; the same 12
statements uncovered, in the same four files). The five are `hooks/useKeyboardShortcuts.ts`'s Escape gate,
now the allow-list `state === 'preparing' || state === 'recording' || state === 'paused'` (26 → 29, each of
the three operands reached from both sides by the six per-state cases — countdown, preparing, recording,
paused, saving, idle), and `hooks/useRecordingController.ts`'s `recorderRef.current !== me` guard on the save's
one `setState('idle')` (122 / 126 → 124 / 128), where the success and failure arms of `saveRecording` now
converge, reached with the ref still holding `me` by the ordinary late save and with it moved on by the
clobber cases on both the success and the failure path; the file's four pre-existing uncovered arms are
untouched. The `App.*rerender*` pins and every `*.perf.test.ts` are byte-identical. **No floor crossed**;
craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-175 (MP4 gets the real probe WebM has had since
ESCSUITE-22 — H.264 at the selected output size and AAC — and WebM's probe learns to ask about Opus; the dialog
refuses a format whose video codec is missing, offers one whose audio codec is missing with an up-front
per-format note, and says after the export that the sound was lost only for a project that had sound to lose;
both element-and-WebCodecs exporters probe before mixing audio, loading media or starting the muxer, report a
dropped codec through their progress stream instead of a `console.warn`, and return an `ExportResult` whose
`audio` flag the dialog, the headless kit and the host's `EXPORT_COMPLETE` message read):
99.80 / 99.24 / **95.61** / 99.67 against 99.80 / 99.24 / 95.57 / 99.67 on the commit this branch was rebased
onto (`8d4c20e`, the ESCSUITE-171 squash) — branches up four hundredths, the other three unmoved. The base is
the composite ESCSUITE-172's paragraph describes, extended by the ESCSUITE-171 tree (three trees measured in
this sitting on disjoint files): 4,788 / 5,010 branches, and this branch 4,839 / 5,061 — fifty-one new
branches, fifty-one covered, the same 222 uncovered (lines 7,573 / 7,588 → 7,624 / 7,639, statements
8,524 / 8,589 → 8,584 / 8,649, functions 1,837 / 1,843 → 1,854 / 1,860, every denominator growing by exactly
what the numerator did; the same 15 / 65 / 6 uncovered). The fifty-one are `components/Export/ExportDialog.tsx`'s
forty-two (169 / 170 → 211 / 212: the three-state MP4 gate and its WebM twin, `projectHasAudio` — a clip whose
track is present, visible and unmuted and whose source is not an image, the audio mixer's own skip clause
without the decode — gating the completion sentence, the per-format up-front notes with the way-out clause
dropped when the other format is silent too, the stale-probe guard on the preset change; the file's one
pre-existing uncovered arm untouched), `core/exportTypes.ts`'s seven (120 / 124 → 127 / 131: the
`{ video, audio }` probes for both formats through one `isAudioCodecSupported` and the `VIDEO_FORMAT_AUDIO`
table, `noAudioNote` and `exportedWithoutSoundReason`; the same four pre-existing arms uncovered) and
`core/exportMP4.ts`'s two (124 / 141 → 126 / 143: the up-front H.264 refusal before any work and the AAC
report, with the same seventeen pre-existing arms uncovered — the file's lines fell 255 → 248 because the
late probe and both `console.warn`s went). `core/exportWebM.ts` gained no branch: the two Opus failure arms
collapsed into one `audioDropped` flag the probe sets, read once at the return. The two export ceiling files
are byte-identical — nothing per frame moved — as are the other five pins and `perfScene.ts`. One Playwright
pin changed (`apps/e2e/tests/errors/export.spec.ts`'s codec-not-supported case) and was run in Chromium:
11 / 11. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-178 and ESCSUITE-179 (the preview's selection
chrome, hit test, cursor and marquee follow a hidden track — no chrome, no hit, no marquee pick for a clip
whose track is hidden, the selection itself surviving the hide — and the keyframe graph's own point drag
refuses a drop within `KEYFRAME_TIME_EPSILON` of another keyframe of the same property the way the diamond
row has since ESCSUITE-167, through the same `occupiedTimeMessage` and the graph's one live region; the
inline `!track || !track.visible` shape that nine sites in seven files had each written out is one
`store/trackVisibility.ts` helper, a pure move): 99.80 / 99.25 / **95.64** / 99.67 against the
99.80 / 99.25 / 95.63 / 99.67 that `main` at `cc950559` measures in the same sitting — a direct measurement
of `main` again, now that every earlier sweep-4 branch has landed and the composite bases the ESCSUITE-172,
175 and 173 paragraphs describe are no longer needed. Branches up a hundredth, the other three unmoved:
the base gives 4,797 / 5,016 branches and this branch 4,807 / 5,026 — ten new branches, ten covered, the
same 219 uncovered (lines 7,611 / 7,626 → 7,621 / 7,636, statements 8,568 / 8,632 → 8,583 / 8,647,
functions 1,844 / 1,850 → 1,847 / 1,853, every denominator growing by exactly what the numerator did; the
same 15 / 64 / 6 uncovered). The movement is spread across the readers and the helper: `KeyframeGraph.tsx`
111 / 120 → 117 / 126 (the occupancy refusal before any `useGestureHistory` commit, the `timeChanged`
short-circuit's refusal side, each reached by the onto-a-neighbour, near-but-not-within, left-overshoot-onto-
the-start-keyframe and value-only-drag cases; the same nine pre-existing arms uncovered),
`components/Preview/selectionOverlay.ts` 36 / 38 → 40 / 42, `hitTest.ts` 85 / 87 → 87 / 89 and
`dragGeometry.ts` 67 / 82 → 69 / 84 (the hidden-track test in each draw, hit and marquee path, reached with
the track hidden, shown again and absent, with the same two, two and fifteen pre-existing arms uncovered),
`store/trackVisibility.ts` 4 / 4 on arrival, and three files whose denominators *fell* because their inline
shape became a call — `store/clipQueries.ts` 14 → 12, `components/Preview/cropOverlay.ts` 29 → 27 and
`core/exportTypes.ts` 124 → 120 (120 / 124 → 116 / 120, the
same four pre-existing arms uncovered). The seven perf/rerender pins, `keyframeGestures.perf.test.ts` and
`perfScene.ts` are byte-identical: the chrome's extra work is one track lookup per drawn clip and the
refusal is one comparison at release. The refuse-and-snap-back shape both keyframe drags share is
ESCSUITE-183. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/craft` and `@escapesuite/shared` were re-measured 2026-10-02 for ESCSUITE-176 (sweep 4's
seven verified ESCAPECRAFT minors: every cancel path clears the captured preview frame — a cancel that lands
mid-grab discards it and a new take never inherits the previous one's; `?hostOrigin=` is normalised to its
`http:`/`https:` origin and an unparseable value makes "Upload to host" refuse with a notice instead of posting
the bytes to `'*'`; the Record button reads the separate-tracks headroom flag when that mode would run; a
byteless conversion raises `RECORDING_UNAVAILABLE` and re-reads the storage headroom; the playback dialog's
volume slider has a name and stays in the DOM; the progress-bar drag's listeners are removed on unmount; the
webcam-overlay buttons carry `aria-pressed` inside labelled groups). Craft: 100.00 / 99.52 / **97.75** / 100.00
against the 100.00 / 99.52 / 97.74 / 100.00 that `main` at `cc950559` (the ESCSUITE-174 squash) measures in
the same sitting — branches up a hundredth, the other three unmoved at exactly 100, 99.52 and 100: the base
gives 1,342 / 1,373 branches and this branch 1,350 / 1,381, eight new branches, eight covered, the same 31
uncovered (lines 2,337 → 2,359, statements 2,490 / 2,502 → 2,517 / 2,529, functions 448 → 450; the same 12
statements uncovered, in the same four files). The eight are `utils/recordReadiness.ts`'s six (17 → 23: the
`separateTracks && screenEnabled && webcamEnabled` gate and the headroom read behind it, each operand reached
from both sides by the on / off / webcam-off / screen-off / room / no-room cases), `hooks/useRecordingController.ts`'s
two (124 / 128 → 126 / 130: the post-await `cancelledRef` check that discards a frame grabbed for a take already
thrown away, reached by the deferred-grab case against the ordinary stop; the file's four pre-existing uncovered
arms untouched) and `components/RecordingsList/RecordingsListPanel.tsx`'s two (14 → 16: the `'refused'` arm of
the upload result raising `UPLOAD_NO_HOST_ORIGIN`, against `'posted'` and `'missing'`); `components/VideoPlayer/VideoPlayer.tsx`
went 93 / 101 → 91 / 99 because the volume slider is always mounted now and its conditional render went, with
the same eight pre-existing arms uncovered. Shared: 100.00 / 98.54 / **90.97** / 100.00 against
100.00 / 98.54 / 90.78 / 100.00 — branches up nineteen hundredths, the other three unmoved: 128 / 141 →
131 / 144, three new branches, three covered, the same 13 uncovered (lines 256 → 258, statements 270 / 274 →
271 / 275 with the same 4 uncovered, functions 69 on both). The three are `parseHostOrigin`'s `url.origin !==
'null'` guard and the `http:` / `https:` protocol pair in `config/index.ts` (17 / 19 → 20 / 22), each reached from
both sides by the trailing-slash, path, `data:` URL, `ws://` and garbage cases — on a package whose floors leave
no headroom, which is why every arm has a case of its own. The `App.*rerender*` pins and every `*.perf.test.ts`
are byte-identical. Outside vitest's measurement: `apps/e2e/tests/integration/host-embedding.spec.ts`, with its
new no-`hostOrigin` refusal case, run in Chromium: 6 / 6. **No floor crossed**; craft's floors stay
100 / 99 / 97 / 100 and shared's 100 / 98 / 90 / 100.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-172 (`updateClip` and twelve map-and-set siblings
refuse an id that names no clip — in front of the `set`, with the ESCSUITE-87 `false` and no undo entry — so
the crop gesture's unmount-mid-drag flush against a deleted clip spends nothing; `updateClipBlendMode` and
`clearClipKeyframes` gain the boolean return to carry it; the two overlay-data writers refuse a real clip of
the wrong type): 99.80 / 99.24 / **95.59** / 99.67 against 99.80 / 99.24 / 95.56 / 99.67 on the commit this
branch was rebased onto (`51b2acd`, the ESCSUITE-169 / 170 squash) — branches up three hundredths, the other
three unmoved. The base figure is a composite: `51b2acd` is the ESCSUITE-161 / 162 tree plus the
ESCSUITE-169 / 170 tree, both measured in this sitting (4,766 / 4,988 and +16 / +16 branches, on disjoint
files — this branch's own per-file delta against the first lists exactly the second's three files and this
ticket's three slices, nothing else), so the base reads 4,782 / 5,004 branches and this branch
4,814 / 5,036: thirty-two new branches, thirty-two covered, the same 222 uncovered (lines 7,569 / 7,584 →
7,588 / 7,603, statements 8,518 / 8,583 → 8,565 / 8,630, functions 1,836 / 1,842 → 1,850 / 1,856, every
denominator growing by exactly what the numerator did; the same 15 / 65 / 6 uncovered). The thirty-two are
`store/clipSlice.ts`'s eighteen (141 / 143 → 159 / 161 — the existence guard on `updateClip`, `trimClip`,
`moveClipToTrack`, `setClipTimelinePosition`, `updateClipTransform`, `updateClipEffects`,
`updateClipTransition`, `updateClipAnimation` and `updateClipBlendMode`, each reached by its own refusal case
against the success cases that were already there; the file's two pre-existing uncovered arms untouched),
`store/keyframeSlice.ts`'s six (63 / 74 → 69 / 80 — `setClipKeyframe`, `moveClipKeyframe` and
`clearClipKeyframes`, the last refusing both an unknown clip and a clip with no animation, as
`removeClipKeyframe` does; the same eleven pre-existing arms uncovered) and `store/overlaySlice.ts`'s eight
(50 → 58 — the id-and-type guard on `updateTextOverlayData` and `updateShapeOverlayData`, reached by the
unknown-id and wrong-type refusals). `components/Preview/useCropHandleGesture.ts` gained no branch: the
store's refusal propagates through `useGestureHistory.commit`'s return, pinned by the CropHandles
unmount-mid-drag case. The seven perf/rerender pins and `perfScene.ts` are byte-identical. **No floor

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-168 (the delete-track confirm no longer says the
removal cannot be undone; a marquee released outside the track container no longer swallows the next click —
the flag clears on the next click anywhere and at the start of the next gesture; a keyframe-mode preview drag
refuses a write when the playhead has left the clip at either end instead of writing a keyframe at a negative
or past-the-end time; and a zoom mid clip-drag no longer makes the clip jump, the grab offset being kept as a
time and re-derived at the current zoom per move): 99.80 / 99.24 / **95.58** / 99.67 against
99.80 / 99.24 / 95.56 / 99.67 on the commit this branch was rebased onto (`e880b87`, the ESCSUITE-169 / 170
version-packages commit) — branches up two hundredths, the other three unmoved. The base is the composite
ESCSUITE-172's paragraph describes (the ESCSUITE-161 / 162 tree plus the ESCSUITE-169 / 170 tree, measured in
this sitting on disjoint files): 4,782 / 5,004 branches, and this branch 4,787 / 5,008 — four new branches,
five more covered, so the uncovered column falls 222 → 221 (lines 7,569 / 7,584 → 7,584 / 7,599, statements
8,518 / 8,583 → 8,533 / 8,598, functions 1,836 / 1,842 → 1,839 / 1,845, every denominator growing by exactly
what the numerator did; the same 15 / 65 / 6 uncovered). The four new branches are
`components/Timeline/useTimelineMarquee.ts`'s two (27 → 29: the armed-or-not unmount cleanup of the one-shot
click listener, reached with a listener armed and with none) and `components/Preview/useTransformHandles.ts`'s
two — the `keyframeTime >= 0 && keyframeTime <= clip.duration` operands folded into the guard that already
narrows `clip`, reached from both sides by the playhead-before-the-clip and playhead-past-the-end cases
against the in-range writes that were already there — and the one pre-existing arm newly reached is in the
same file (159 / 176 → 162 / 178), driven by the past-the-end case the review asked for.
`components/Timeline/useClipDrag.ts` gained statements and no decision (the time-based grab offset is one
division at mousedown and one `timeToPixels` per move); `useTrackHeaderActions.ts` changed a string.
`timelineGestures.perf.test.ts` and the other six pins and `perfScene.ts` are byte-identical. **No floor
crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-02 for ESCSUITE-173 (the headless entry validates a job's project
through `parseProject` and fails the job with the reason — while keeping a project with no `resolution` of its
own at the source's native size rather than adopting the editor's 1920x1080 default; `parseProject` validates a
clip's `transform` and `sourceDelta` floors its divisor at a documented `MIN_SCALE` for any non-finite or
non-positive scale; an aspect-locked crop drag past the limit slides to `MAX_CROP_INSET` along the locked ratio
instead of breaking the lock; the tab-visible note is one constant shown for WebM and GIF alike, gated on the
effective format): 99.80 / 99.24 / **95.61** / 99.67 against 99.80 / 99.24 / 95.57 / 99.67 on the commit this
branch was rebased onto (`ddb8cab`, the ESCSUITE-171 version-packages commit) — branches up four hundredths,
the other three unmoved. The base is the composite ESCSUITE-175's paragraph describes (the ESCSUITE-161 / 162,
169 / 170 and 171 trees, measured in this sitting): 4,788 / 5,010 branches, and this branch 4,838 / 5,060 —
fifty new branches, fifty covered, the same 222 uncovered (lines 7,573 / 7,588 → 7,611 / 7,626, statements
8,524 / 8,589 → 8,563 / 8,628, functions 1,837 / 1,843 → 1,839 / 1,845, every denominator growing by exactly
what the numerator did; the same 15 / 65 / 6 uncovered). The fifty are `store/projectMigration.ts`'s
twenty-two (75 → 97: `isValidTransform`'s fourteen operands, each reached from both sides by a row per
operand, and the `transform` gate), `core/cropDrag.ts`'s twenty (42 → 62: the finite-and-positive scale
floor, `withAspect`'s cap widening the region to the largest of the pointer's and each limited edge's value
for both corners and both axes, reached by the `nw`, `se`, `w`, `n` and `s` cases), `headless/renderProject.ts`'s
four (31 / 34 → 35 / 38: the parse refusal and the raw-input `resolution` choice; the same three pre-existing
arms uncovered) and `components/Export/ExportDialog.tsx`'s four (169 / 170 → 173 / 174: the WebM note's
`webmSupported` and effective-format operands, reached by the saved-MP4-preference, both-unsupported and
GIF-selected cases; the same one pre-existing arm uncovered). The branch also touches
`components/Preview/useCropHandleGesture.ts`, a file the ESCSUITE-169 tree had changed, which is why that
tree's own measurement is the reference for it: the hook gained no branch, but its `write` guard against a
crop `cropUpdateFor` refuses — reached on `main` once, by a Shift drag whose derived inset the normaliser
refused — lost that reacher when the aspect clamp made such a crop impossible, and the measurement round
pinned it from the one route left, a source with no dimensions (ESCSUITE-97's stored 0×0 shape). The seven
perf/rerender pins and `perfScene.ts` are byte-identical; the kit's own source is untouched (its README gains
the new failure mode under a patch changeset) and its figures do not move. **No floor crossed**; artist's
floors stay 99 / 99 / 95 / 99.

`@escapesuite/craft` was re-measured 2026-10-02 for ESCSUITE-177 (sweep 4's cross-browser follow-ups: the
e2e a11y helper keeps the first failing node's selector; the light palette's `--text-muted` darkened from
`#718096` to `#606d80` so it clears AA on `--bg-secondary` — the one real finding behind the Firefox
light-theme axe failure, which was an unavailable source row's label, not the Recording label the test's
comment suspected — with the player's error overlay given its own on-dark colours because that surface is
black in both themes; the WebCodecs docs claim corrected; `waitForAppReady` replacing 185 `networkidle` waits
across 29 spec files; the media mocks layered onto `navigator.mediaDevices` by binding its prototype chain;
WebKit skips with stated reasons): 100.00 / 99.52 / 97.73 / 100.00, byte-identical to the
100.00 / 99.52 / 97.73 / 100.00 the commit this branch was cut from (`599d505`; craft's source is unchanged on
`main` since, ESCSUITE-174 not yet landed when measured) measures — lines 2,337, statements 2,489 / 2,501,
branches 1,337 / 1,368 and functions 448 on both trees, the same 12 statements and 31 branches uncovered. The
craft change is two CSS files and one new unit test (`themeTokens.test.ts`, pinning both palettes'
`--text-muted` contrast on `--bg-secondary` and the overlay's colours on black), none of which is in the
measured numerators, so nothing moves. The `App.*rerender*` pins and every `*.perf.test.ts` are byte-identical.
Outside vitest's measurement: the full Chromium Playwright project on this branch, run twice in one sitting,
287 passed / 9 skipped / 0 failed, against 284 / 9 / 3 before the round-2 fixes (two of the three were
`waitForAppReady` waiting for the landmark to be visible at a landscape phone viewport, the third a
machine-contention flake that passes alone); `errors/permissions.spec.ts` was red (3) on the first mock rewrite
and is 9 passed / 2 skipped on the bound-prototype one. **No floor crossed**; craft's floors stay
100 / 99 / 97 / 100.

`@escapesuite/headless-artist` was re-measured 2026-10-03 for ESCSUITE-186 (the s3 sink no longer leaves
the `Readable` it hands each `PutObject` command unguarded: `src/s3.ts` attaches an `error` listener the
moment `createReadStream` mints the body and destroys the body in a `finally` once `send()` settles, so a
file that vanishes before the SDK reads it — the `ENOENT` on `render-output.webm` that turned `main`'s CI red
on a tree that had just passed twice, surfacing as an uncaught exception on a later tick because an
unconsumed stream had no `error` listener — reaches the sink's own failure report instead of the process;
and the s3-sink unit tests drain the body the way a real upload reads it, pinning `readableEnded`):
99.47 / 99.38 / 98.27 / **98.57** against the 99.47 / 99.38 / 98.27 / 98.56 that `main` at `cb37d7b`
measures in the same sitting — functions up a hundredth, the other three unmoved. Lines 760 / 764 →
764 / 768, statements 810 / 815 → 814 / 819 and functions 137 / 139 → 138 / 140, every new unit covered;
branches 513 / 522 on both trees, because the guard adds no decision — the listener is one unconditional
`on('error', …)`, the swallow arrow is the one new function, and `destroy()` on an ended stream is a
documented no-op — and the same 4 / 5 / 9 / 2 uncovered. The one `src` file that moved is `s3.ts`, now
55 / 55 lines and 58 / 58 statements; the two red cases that drive both arms (a client that rejects
without reading the body, whose error must surface through the sink and not as an uncaught exception, and
a client that resolves without reading it, whose body must end `destroyed`) capture the stream through a
`vi.mock('node:fs')` and were red before the guard. The race itself could not be reproduced on a quiet
machine (twenty runs clean before and after), so the fix rests on the sink's stream usage read against
Node's documented asynchronous open; `fetchS3ToLocal`, the Chromium parity cases and the bench are
untouched. **No floor crossed**; the kit's floors stay 99 / 99 / 98 / 98.

`@escapesuite/craft` was re-measured 2026-10-03 for ESCSUITE-180, 184 and 185 (the thumbnail probe's
`<video>` load has a five-second deadline, so a take whose bytes never fire `loadeddata` saves with the
placeholder tile instead of parking the app in `saving` forever; a microphone that cannot be opened — refused,
in use or unplugged — no longer costs a take that still has a screen or a webcam, the take proceeding without
it and one cause-neutral notice saying so; and Space on a focused button, link or select inside the playback
dialog is left to that control instead of toggling playback underneath it): 100.00 / 99.52 / **97.77** / 100.00
against the 100.00 / 99.52 / 97.75 / 100.00 that `main` at `cb37d7b` measures in the same sitting — branches
up two hundredths, the other three unmoved at exactly 100, 99.52 and 100. The base gives 1,350 / 1,381
branches and this branch 1,363 / 1,394: thirteen new branches, thirteen covered, the same 31 uncovered as
before (lines 2,359 → 2,378, statements 2,517 / 2,529 → 2,537 / 2,549, functions 450 → 452, every
denominator growing by exactly what the numerator did; the same 12 statements uncovered, in the same four
files). The thirteen are `components/VideoPlayer/VideoPlayer.tsx`'s seven (91 / 99 → 98 / 106: the
`e.key === ' ' && spaceBelongsToTarget(e.target)` early return and `spaceBelongsToTarget`'s three operands —
an `HTMLElement`, `isContentEditable`, the `SPACE_ACTIVATES` match — each reached from both sides by the
button, `role="button"`, contenteditable, dialog-body, `<video>` and non-element targets and by `k` on a
button; the file's eight pre-existing uncovered arms untouched), `hooks/useMediaStreams.ts`'s four (24 → 28:
the `!screen && !webcam` rethrow inside the microphone request's own `try` / `catch`, reached by the
mic-only take that still fails, the screen take and the webcam-only take that keep going) and
`hooks/useRecordingController.ts`'s two (126 / 130 → 128 / 132: the `micUnavailable` notice, raised after
`NO_SYSTEM_AUDIO` and after the abandoned-attempt return, reached with and without a refused microphone;
the file's four pre-existing uncovered arms untouched). `core/thumbnailGenerator.ts` gained seven lines and
one function and no branch: the deadline is a `setTimeout` whose callback runs the same `cleanup()` the
error path does, `cleanup()` clears it and cancels the frame request unconditionally — `frameHandle` starts
at 0, which `cancelAnimationFrame` ignores — so the module adds no conditional at all, and both of its
cases pin behaviour (one revoke, one `clearTimeout`) rather than arms. The review's one MEDIUM was the
notice's wording, not a branch: `MIC_REFUSED` claimed a refusal for every failure the catch swallows, and
became the cause-neutral `MIC_UNAVAILABLE` with no new decision; the review also had the unreachable
`input, textarea` operands dropped from `SPACE_ACTIVATES` rather than kept, since the typing guard above
already returns for both. The `App.*rerender*` pins and every `*.perf.test.ts` are byte-identical. **No floor
crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-10-03 for ESCSUITE-181, 182 and 183 (the write-only
`DragState.offsetX` deleted; the Advanced download button labelled from the format that will actually be
exported; and both keyframe drags — the diamond row's and the graph's — clamping the dragged point at the edge
of a neighbour's epsilon window during the move, on the side the pointer came from, instead of following the
pointer and snapping back on release): 99.80 / 99.27 / **95.79** / 99.68 against the 99.80 / 99.27 / 95.77 /
99.68 that `main` at `cb37d7b` measures in the same sitting — branches up two hundredths, the other three
unmoved. The base gives 4,945 / 5,163 branches and this branch 4,963 / 5,181: eighteen new branches, eighteen
covered, the same 218 uncovered as before (lines 7,744 / 7,759 → 7,761 / 7,776, statements 8,744 / 8,808 →
8,766 / 8,830, functions 1,883 / 1,889 → 1,884 / 1,890, every denominator growing by exactly what the numerator
did; the same 15 / 64 / 6 uncovered). The table row below had read 99.80 / 99.24 / 95.59 / 99.67 — the ESCSUITE-172
figures — while the paragraphs after it measured 95.61, 95.64 and 95.77 without updating the row; the base
figures here are a direct measurement of `main`, and the row is corrected to this branch's. The movement is
one new module and two files that shrank. `utils/keyframeClamp.ts` arrives at 24 / 24 branches, 26 / 26
statements and 3 / 3 functions: `occupiedWindows` (the per-time window `t ± KEYFRAME_TIME_EPSILON` widened by a
private `CLAMP_MARGIN` of 1e-9 — `|3 − 3.001|` measures 0.0009999999999998899, under the epsilon — merged where
two windows overlap or touch, the empty-list arm) and `clampToLegalTime` (inside no window → the time itself;
else the edge on the side `previousTime` came from, the nearer edge when the previous position was itself
inside, the other edge when the approached one is outside `[min, max]`, and `null` when neither is legal),
every arm reached from both sides by that module's twenty-one cases — including the neighbour at `max`
approached from `max` itself, the exact tie from each side, and three keyframes 0.0015 s apart merging into one
window. `components/KeyframePanel/KeyframeGraph.tsx` went 117 / 126 → 113 / 122 and
`hooks/useKeyframeDrag.ts` kept its 14 / 14 while losing five statements and two functions, because each
drag's inline clamp loop became one call and each `handleMouseUp` lost its occupancy refusal: with every
landing legal or the move ignored, the two mouse-path refusals had no caller left and were deleted under the
house rule rather than kept; the `null → return` each `handleMouseMove` gained is reached by a 0.0015 s clip
whose keyframes at 0 and 0.001 leave no legal time. `KeyframePanel.tsx` went 46 / 56 → 44 / 54 for the same
reason — `handleKeyframeDragAnnounce` and its non-empty `announceWithMark` arm, which only the deleted
refusal fed, are gone and `setKeyframeDragMessage` is passed straight through — and `ExportDialog.tsx`,
`useClipDrag.ts` and `Timeline/types.ts` gained no unit: the label reads `effectiveAdvancedFormat` where it read
`advancedOptions.format`, and `offsetX` was a property in an object literal. The keyboard path's refusal in
`useKeyframeGraphKeyboard.ts`'s `nudgeTime` is untouched and every keyboard test unchanged. The review's one
MAJOR was the first clamp's bounds step pulling a point straight back into the window of a neighbour sitting at
`clipDuration` — which `generateOutPresetKeyframes` puts there for every Animate Out — and is the bound-aware
side choice above; its two MEDIUMs on the tie and on two keyframes closer than two epsilons are the
`previousTime` rule and the merge. `keyframeGestures.perf.test.ts` gains one case — one `occupiedWindows` build
per gesture for the graph, none per move, red at 11 when rebuilt per move — with its existing cases
byte-identical, and the other six `*.perf.test.ts` files, the three rerender pins and `perfScene.ts` are
byte-identical. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/shared` and `@escapesuite/plan` were re-measured 2026-10-03 for ESCSUITE-194, 197, 199 and 200
(the combined-build script's entry guard survives a checkout path with a space and its layout check reads each
emitted HTML for the scripts, stylesheets and worker chunk it references; `perf.yml` pins its Node version, the
unreachable `ci-status` branch, a dead workflow comment, four unused shared root exports and the redundant
`turbo.json` `build.env` are gone, the shared package's `build` task declares no outputs so `pnpm build` stops
warning, and `standalone-release.yml`'s PR comment is awaited; `parseHostOrigin` warns once for a present-but-empty
`?hostOrigin=` the way it does for every other unusable value; the GitHub Pages `CNAME` and the unreferenced
`og-image.png` are deleted from the hub). **Shared**: 100.00 / 98.52 / **91.54** / 100.00 against the
100.00 / 98.54 / 90.97 / 100.00 that `main` at `eeffcaaf` measures in the same sitting — branches up more than
half a percent, statements down two hundredths, lines and functions still exactly 100. The base gives 131 / 144
branches and this branch 130 / 142: the denominator fell by two and the uncovered column by one (13 → 12), because
`packages/shared/src/index.ts`'s four exports — `ESCAPE_SUITE_VERSION`, `SHARED_DB_NAME`, `isBrowser` and
`isProduction`, with no importer anywhere in the monorepo — went out with the one uncovered arm `isProduction`
carried, and `config/index.ts` kept its 20 / 22: the `params.has('hostOrigin')` gate replaced the old `if (!value)`
short-circuit one decision for one, reached from both sides by the absent, `?hostOrigin=` and bare `?hostOrigin`
cases. The review's one finding was coverage, not behaviour: the first version read the value as
`params.get('hostOrigin') ?? ''`, whose `null` side no caller can reach once `has()` is true, and the measurement
showed it as the file's one new uncovered arm (20 / 22 → 21 / 24); it became a non-null assertion, and the file is
back to its two pre-existing uncovered arms. Statements 271 / 275 → 268 / 272 and lines 258 → 255 are the deleted
exports, the same 4 statements uncovered as before. **Branches cross a whole percent, so shared's branches floor
goes 90 → 91** in `packages/shared/vitest.config.ts` and `scripts/coverage-report.mjs`; its floors are now
100 / 98 / 91 / 100. The table row below had read 90.78 since ESCSUITE-176's paragraph recorded 90.97 without
updating it, and is corrected. **Plan**: 100.00 / 100.00 / 100.00 / 100.00 on both trees — lines 73, statements
74, branches 19, functions 23, every one covered — because the change there is two deleted public files and a
corrected comment, none of which the measurement counts; the production-layout pin that neither path is served as
itself any more (`apps/e2e/tests/production/plan-artefacts.spec.ts`) is outside vitest's measurement and was run
once against `pnpm build:deploy`: 11 / 11 with the rest of that project. **No floor crossed downward**; plan's
floors stay 100 / 100 / 100 / 100.

`@escapesuite/headless-artist` was re-measured 2026-10-03 for ESCSUITE-188, 189 and 193 (a timeout above
2^31−1 ms is refused by name in both parsers instead of silently becoming 1 ms; the command sink has a delivery
budget that settles from its own SIGKILL timer, so a hung delivery — a grandchild holding the stderr pipe
included — no longer holds a worker slot or the drain; the server sets `requestTimeout` and `headersTimeout`,
and `close()` answers a body that never finished arriving with 408 and destroys it instead of waiting):
**99.51** / **99.42** / **98.36** / **98.62** against the 99.47 / 99.38 / 98.27 / 98.57 that `main` at `eeffcaaf`
measures in the same sitting — every figure up, with the uncovered column unmoved: lines 764 / 768 → 813 / 817,
statements 814 / 819 → 865 / 870, branches 513 / 522 → 541 / 550 and functions 138 / 140 → 143 / 145, every
denominator growing by exactly what the numerator did (the same 4 / 5 / 9 / 2 uncovered, in the same places —
`cli.ts`'s two `isDirectRun` lines and `serve.ts`'s limiter sync-throw catch and post-listen socket-error handler,
which `vitest.config.ts`'s ledger names). The twenty-eight new branches are `src/timeouts.ts`'s shared
`MAX_TIMEOUT_MS` applied in `cli.ts` (two: the bound, reached by 2147483647 accepted and 2147483648 refused) and
`sinks.ts` (twenty: the webhook's and the command sink's `typeof === 'number' && > MAX` guards, the command
sink's `timeoutMs` default and validation, and the `timedOut` branch now reached from the escalation timer as
well as from `'close'`), and `serve.ts`'s six net (84 / 91 from 78 / 85): `handleRender`'s `raw === BODY_GONE`
test and its `writableEnded ? statusCode : 499` ternary — reached by the shutdown teardown (408 already written),
by a client that destroys its socket mid-body (499) and by every ordinary request — and `readBody`'s
`!req.complete` on `'close'`. The branch was first measured one round earlier at 99.26 / 99.19 / **98.00** /
98.61 with the uncovered counts *risen* to 6 / 7 / 11 / 2 — branches landing exactly on the 98 floor — because the
first version carried an unreachable `else` around the teardown's 408 (deleted: the loop now calls the `send`
helper, which carries the covered guard) and because rewriting the one drain test that used to finish sending
its body after `close()` began had silently retired the only reacher of `createLimiter`'s `if (closed)` guard
(now exported and covered directly by a shutdown-then-run case); a compound `'error'` condition in `readBody`
whose false side nothing could produce was simplified away rather than tested. A second round reversed one of the
first round's own corrections: it had claimed Node's `requestTimeout` and `headersTimeout` do not bound a request body
after dispatch, where the re-review measured that they bound the whole request but are enforced on a sweep whose
period is `connectionsCheckingInterval` (30 s by default), so the server now passes `5_000` for it as a named constant
(a statement pinned through the `createServer` spy, no branch) and the five passages say so; the SIGKILL-escalation
test proves the child died through a pid file rather than trusting the timer, and the grandchild case reaps its
`sleep` the same way. The hunter's five probes that
asserted the defects would now be red; `renderDriver.ts` is untouched and the Chromium parity cases did not run.
**No floor crossed**; the kit's floors stay 99 / 99 / 98 / 98.

`@escapesuite/plan` was re-measured 2026-10-03 for ESCSUITE-195 (the landing page's offline-build buttons point at
stable per-app asset URLs under GitHub's latest release rather than at `/releases/latest` itself, and the release
workflows keep that pointer on the umbrella release: per-package releases are marked not-latest after they are
published, the umbrella is created with `--latest` and re-marked on the path where its tag already exists, and the
`*-latest.html` files the standalone workflow already built are uploaded beside the versioned names):
100.00 / 100.00 / 100.00 / 100.00 on both trees — against `main` at `5ba05466`, lines 73 → 78, statements 74 → 79,
branches 19 → 21 and functions 23 → 26, every new unit covered. The two new branches are `lib/analytics.ts`'s
`tool ? { tool } : undefined` payload choice, reached with no tool by the hero's secondary link and with `'craft'`
and `'artist'` by the two primaries; `lib/launch.ts` gains the two URL constants and the optional pass-through,
and `pages/Home.tsx` three handlers, all statements. The workflow guard (`scripts/release-latest-guard.test.mjs`,
four `node:test` cases red against the unmodified workflows) and the e2e pin are outside this package's
measurement. **No floor crossed**; plan's floors stay 100 / 100 / 100 / 100.

`@escapesuite/shared` was re-measured 2026-10-03 for ESCSUITE-208 (`useDialogBehaviour`'s focus trap decides "rendered"
by `getClientRects().length > 0` rather than `offsetParent !== null`, so a `position: fixed` control inside a dialog takes
initial focus and sits in the Tab cycle; the focusable selector gains `[contenteditable]:not([contenteditable="false"])`,
`audio[controls]`, `video[controls]`, `iframe` and `summary`, so a click into such an element followed by Tab can no longer
leave an `aria-modal` dialog; and Escape acts only in the topmost of the open dialogs through a module-level stack, chosen
over `stopImmediatePropagation()` because capture listeners on one node fire in registration order and the bottom dialog
would have acted first): 100.00 / **98.56** / **91.66** / 100.00 against the 100.00 / 98.52 / 91.54 / 100.00 that `main` at
`5ba05466` measures in the same sitting — statements up four hundredths, branches up twelve, lines and functions still
exactly 100. The base gives 130 / 142 branches and this branch 132 / 144: two new branches, two covered, the same 12
uncovered as before (lines 255 → 260, statements 268 / 272 → 274 / 278, functions 69 on both; the same 4 statements
uncovered). The two are `openDialogs[openDialogs.length - 1] !== id` — the topmost-only gate on Escape, reached by the
two-dialog case (the inner closes, the outer does not) and by every single-dialog Escape case — and the gate's own false
side; the visibility filter is a comparison, not an Istanbul branch, and its exclusion side is pinned by behaviour (one
button whose `getClientRects()` is empty is skipped by initial focus and by the forward wrap), as is the stack's
`indexOf`-addressed removal (the outer dialog closing first leaves the inner closable — red under a `pop()` mutant). The
review's one ruling on the selector deleted a sixth arm, `area[href]`: redundant with the bare `[href]` arm and unreachable
anyway, since `area` is `display: none` in every UA stylesheet and the new filter drops it. The jsdom doubles that had
stubbed `offsetParent` so the trap found anything — the hook's own, craft's `browser.ts`, artist's `layout.ts` and an
undocumented private copy in `ExportDialog.test.tsx` — stub `getClientRects` instead, with craft (1,314) and artist
(4,383) unchanged; a new `apps/e2e/tests/accessibility/dialog-trap.spec.ts` pins the fixed-control and contenteditable
cases against CRAFT's help dialog on Chromium, Firefox and WebKit, outside this measurement. **No floor crossed**;
shared's floors stay 100 / 98 / 91 / 100.

`@escapesuite/headless-artist` was re-measured 2026-10-04 for ESCSUITE-190, 192, 205, 206 and 209 (the
`volume` sink stages its video and its manifest at private temp names inside the target directory and
publishes each with one same-directory rename, sidecar first, the cross-filesystem `fs.copyFile` fallback
replaced by a stream copy into that private temp so two concurrent deliveries can never blend into one
file; a sink's config is validated while the job spec is parsed and the s3 SDK's presence probed before
Chromium launches, with the probe placed after `serve`'s allow-list so a disallowed s3 job is a 403 and
never probed; a `timeline`-less project is refused by name and a render failure's message is stripped of
terminal escapes — the CSI class widened to `[0-?]` after the review found `ESC[1;31m` surviving as text;
the webhook sink drains every response body without buffering it and refuses to follow a redirect; the
render deadline covers the browser launch, a straggling launch that resolves after the deadline being
closed; and the s3 sink budgets each of its two puts with an `AbortSignal`): **99.55** / **99.47** /
**98.47** / **98.72** against the 99.51 / 99.42 / 98.36 / 98.62 that `main` at `11de3827` (the
ESCSUITE-188 / 189 / 193 version-packages commit; no kit source has changed on `main` since) measures in
the same sitting — every figure up, with the uncovered column unmoved. Lines 813 / 817 → 887 / 891,
statements 865 / 870 → 941 / 946, branches 541 / 550 → 581 / 590 and functions 143 / 145 → 155 / 157,
every denominator growing by exactly what the numerator did; the same 4 / 5 / 9 / 2 uncovered, in the same
places (`cli.ts`'s `isDirectRun` bootstrap, `serve.ts`'s limiter sync-throw catch and post-listen
socket-error handler, named in `vitest.config.ts`'s ledger, whose line numbers moved and were re-derived).
The forty new branches are `src/sinks.ts`'s net four (eight in — `drainBody`'s null-body guard, the
3xx range and the redirect message's Location-or-not — less the two `typeof` ternaries its s3 entry lost to
`validateS3Config`; `moveIntoDir`'s EXDEV test only changed sign), `src/s3.ts`'s twenty-six (`validateS3Config`'s empty
bucket, non-string `region` / `endpoint` and `timeoutMs` bound, each operand from both sides, and
`sendWithTimeout`'s `signal.aborted` choice), `src/jobSpec.ts`'s six (`validateSinkConfig`'s per-sink
dispatch and `ensureSinkReady`'s s3-or-not) and `src/loaders.ts`'s four (`assertTimelineShape` from both
sides on each input). The first measurement of the branch, before the review's fix round, came back at
99.09 / 98.41 / 98.29 / **94.40** — functions nine under its 98 floor — because seven
`.catch(() => undefined)` arrows on the sink's cleanup paths, the manifest-write failure arm and
`probeS3Sdk`'s body were never invoked: the arrows became one `removeQuietly` helper the existing
failed-cleanup case drives, the manifest-write arm got its red-first case (the staged video gone, nothing
published), and `probeS3Sdk` is driven directly from both sides. The same round deleted the sidecar
rollback rather than test it — a manifest with no video is harmless to a consumer watching for the video,
and the rollback could delete a manifest a concurrent delivery had just published — and `renderDriver.ts`,
coverage-excluded, gained the straggling-launch case through a mocked `playwright` instead. The Chromium
parity suite ran 30 / 30 four times before the round and once after. **No floor crossed**; the kit's
floors stay 99 / 99 / 98 / 98.

`@escapesuite/craft` was re-measured 2026-10-04 for ESCSUITE-210 (the "capture refused" notice is
reachable again: `permissions.ts`'s three wrappers rethrow a plain `Error` carrying the browser's
`DOMException` as `cause`, so `startFailureNotice` had been comparing the wrapper's `name` — always
`'Error'` — against `'NotAllowedError'` and answering the generic `START_FAILED` for every refusal;
it now reads the name through one `failureName(error)` helper, `(error.cause ?? error).name`):
100.00 / 99.52 / 97.77 / 100.00, byte-identical on every percentage to the 100.00 / 99.52 / 97.77 /
100.00 that `main` at `63c695ed` (the ESCSUITE-201 squash) measures in the same sitting. Lines
2,378 → 2,380, statements 2,537 / 2,549 → 2,539 / 2,551, branches 1,363 / 1,394 → 1,365 / 1,396 and
functions 452 → 453, every denominator growing by exactly what the numerator did; the same 12
statements and 31 branches uncovered, in the same four files. The two new branches are the `??` in
`hooks/useRecordingController.ts`'s `failureName` — the `cause` side reached by the two new cases (a
wrapped `NotAllowedError` → `CAPTURE_REFUSED`, red before the fix; a wrapped `NotFoundError` →
`START_FAILED`) and the bare-error side by the two refusal cases that were already there; the
review's one LOW, that no case rejected with a non-object at all, is the third new case, which
exercises the helper's optional chains on `undefined` (v8 counts those as statements, not
decisions, so it moves no figure). Mechanism (a)
from the ticket — one reader rather than three wrappers preserving `name` — so `permissions.ts` is
untouched; a `NotFoundError` sentence of its own is left as the product call the ticket named, and
`apps/craft/CLAUDE.md` says so. Outside vitest's measurement, the three Playwright pins in
`apps/e2e/tests/errors/permissions.spec.ts` moved from the generic sentence to the refused one and ran
in Chromium: 10 passed / 2 skipped, twice. The `App.*rerender*` pins and every `*.perf.test.ts` are
byte-identical. **No floor crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` and `@escapesuite/headless-artist` were re-measured 2026-10-04 for ESCSUITE-191 (a
headless job's `options.timeRange` is clamped to the timeline — `[0, duration]` — before the exporter is
asked, so a one-second project asked for `{start: 0, end: 600}` encodes one second and its verification
manifest's `durationSec` says one, where it used to say 600; an empty or inverted intersection fails the job
naming the field and the timeline's extent; and the kit refuses a non-finite bound or a negative `start` at
parse time, 400 or exit 2, before Chromium launches), each in one sitting against `main` at `5450f757` (the
kit PR #2 version-packages commit). **Artist**: 99.80 / 99.27 / 95.79 / 99.68, byte-identical on every
percentage to the base — lines 7,761 / 7,776 → 7,768 / 7,783, statements 8,766 / 8,830 → 8,773 / 8,837,
branches 4,963 / 5,181 → 4,967 / 5,185 and functions 1,884 / 1,890 on both, every denominator growing by
exactly what the numerator did (the same 15 / 64 / 218 / 6 uncovered). The four new branches are
`headless/renderProject.ts`'s `if (options.timeRange)` and the empty-intersection refusal, each reached
from both sides by the three new cases (the end past the timeline, the negative start, the range that
misses the timeline entirely) against the in-range and no-range renders that were already there, plus the
review's one untested case — a clipless timeline, whose every range misses `0s-0s` — which adds a
pin and no unit; the file's three pre-existing uncovered arms are untouched. **Kit**: 99.55 / 99.47 / **98.48** / 98.72 against
99.55 / 99.47 / 98.47 / 98.72 — branches up a hundredth, the other three unmoved: lines 887 / 891 →
889 / 893, statements 941 / 946 → 943 / 948, branches 581 / 590 → 585 / 594 and functions 155 / 157 on
both, the same 4 / 5 / 9 / 2 uncovered. The four are `src/jobSpec.ts`'s two `Number.isFinite` operands on
the `timeRange` bounds and the `start < 0` refusal, reached by the non-finite and negative cases against
the valid range the suite already kept. `src/manifest.ts` is untouched — it copies `durationSec` through,
and the value it copies is now the clamped one. Artist's seven perf/rerender pins are byte-identical.
**No floor crossed**; artist's floors stay 99 / 99 / 95 / 99 and the kit's 99 / 99 / 98 / 98.

`@escapesuite/shared`, `@escapesuite/craft` and `@escapesuite/artist` were re-measured 2026-10-04 for
ESCSUITE-212 (one React error boundary for both apps: `packages/shared/src/components/ErrorBoundary.tsx`
renders a panel — a `role="alert"` region holding a heading and one sentence, a Reload button beside it,
the panel itself taking focus — in place of a tree that threw during render, calls an optional `onError`
once, and logs only in a dev build (a throw from an event handler, a timer, a promise or the fallback
itself is outside what any React boundary catches, and the docs now say so); `bootstrapApp()` mounts it
around the app root; ESCAPECRAFT hands it `disposeLiveRecordingSession`, which runs the controller's own
unmount teardown — the recorder disposed, every captured stream stopped — so a take cannot keep capturing
into a dead UI, and ESCAPEARTIST hands it a documented no-op, holding no live capture a crash could leave
running), each in one sitting against `main` at `591b19a2` (the ESCSUITE-208 version-packages commit).
**Shared**: 100.00 / **98.62** / **91.89** / 100.00 against 100.00 / 98.56 / 91.66 / 100.00 — statements and
branches up, lines and functions still exactly 100: lines 260 → 272, statements 274 / 278 → 286 / 290,
branches 132 / 144 → 136 / 148 and functions 69 → 73, every denominator growing by exactly what the
numerator did, the same 4 statements and 12 branches uncovered. The four new branches are all
`ErrorBoundary.tsx`'s two decisions — the `hasError` choice in `render` and the dev-only log gate in
`componentDidCatch` — each reached from both sides by the component's own cases (a child that throws
against one that does not; `import.meta.env.DEV` stubbed true and false, which v8 confirms at ten hits
against one); the optional `onError` call and the focus call are not decisions v8 counts, and are pinned
by the prop-present, prop-absent and `document.activeElement` cases; the "second throw does not
double-render" case pins that a caught error stays caught;
`bootstrap/index.tsx`'s `onError` pass-through is a prop forward and adds no decision. **Craft**: 100.00 /
**99.53** / 97.77 / 100.00 against 100.00 / 99.52 / 97.77 / 100.00 — statements up a hundredth, the other
three unmoved: lines 2,378 → 2,385, statements 2,537 / 2,549 → 2,543 / 2,555, functions 452 → 455 and
branches unchanged at 1,363 / 1,394, the same 12 statements and 31 branches uncovered. The change in
`hooks/useRecordingController.ts` is the unmount cleanup's body lifted into a `disposeSession` callback
that is both the effect's cleanup and the module-level slot `disposeLiveRecordingSession()` calls through
an optional call — three new functions, no new decision Istanbul counts — reached by the cases that call
it with a live session (the recorder disposed once, and once only across the explicit call and React's own
cleanup) and with none — and by the review's required pin, which mounts the real hook inside the real
boundary, makes a sibling throw, and asserts from inside `onError` that the recorder was disposed
synchronously: the whole CRAFT half rests on `componentDidCatch` running before the deleted subtree's
passive cleanup nulls the slot, and the pin was shown red with that order deliberately inverted. `src/main.tsx` is coverage-excluded in every package, so its new test files move
no figure. **Artist**: 99.80 / 99.27 / 95.79 / 99.68, byte-identical on every count to the base — lines
7,761 / 7,776, statements 8,766 / 8,830, branches 4,963 / 5,181, functions 1,884 / 1,890 — because the
only artist source the ticket touches is the excluded `main.tsx`. The `App.*rerender*` pins and every
`*.perf.test.ts` are byte-identical: the boundary wraps the root and its `render` returns its children,
so the happy path gains no work per render. **No floor crossed**; shared's floors stay 100 / 98 / 91 /
100, craft's 100 / 99 / 97 / 100 and artist's 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-04 for ESCSUITE-217 (the session autosave reports a rejected
write once — the media library's own quota sentence when the browser's error says `QuotaExceededError`,
read through `error.cause ?? error` the way ESCSUITE-210 reads a refusal in ESCAPECRAFT, and "Your session
could not be saved — storage may be full." for anything else — through the editor's one notice, latched so a
run of failing ticks says it once and a later run says it again after a write in between succeeded;
`console.error` keeps the detail on every failure): 99.80 / 99.27 / **95.80** / 99.68 against the
99.80 / 99.27 / 95.79 / 99.68 that `main` at `207e6ece` (the ESCSUITE-202 squash) measures in the same
sitting — branches up a hundredth, the other three unmoved. Lines 7,768 / 7,783 → 7,779 / 7,794, statements
8,773 / 8,837 → 8,784 / 8,848, branches 4,967 / 5,185 → 4,973 / 5,191 and functions
1,884 / 1,890 → 1,888 / 1,894, every denominator growing by
exactly what the numerator did; the same 15 / 64 / 218 / 6 uncovered. The six new branches are all
`app/useSessionAutosave.ts`'s — `failureName`'s `cause`-or-error choice, `autosaveFailureNotice`'s
quota-or-generic ternary and the latch's "not yet reported" gate — each reached from both sides by the
hook's ten new cases (three failing ticks → one notice; fail, succeed, fail → two; a bare
`DOMException`, a wrapped cause, a plain `Error` and `undefined` through the helper; a resolving write
that raises nothing). `showNotification` joins the effect's dependencies as a stable `useCallback`, so the
autosave's debounce is unchanged and the `App.*rerender*` pins and every `*.perf.test.ts` are
byte-identical. Outside vitest's measurement, `apps/e2e/tests/errors/export.spec.ts`'s `Storage Quota Exceeded` describe
gains a second real case beside ESCSUITE-202's import-under-quota one, under the same
`mockStorageQuotaExceeded`: a timeline edit, the debounce, and the exact sentence — 12 / 12 on Chromium
after the rebase that merged the two rewrites of that describe.
**No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/plan` was re-measured 2026-10-04 for ESCSUITE-214 (a "Skip to main content" link is the first
focusable element in `Layout` on every route — off-screen until focused, above the sticky header when it
slides in — and activating it moves focus to `<main id="main" tabIndex={-1}>` through an explicit
`focus()` rather than the browser's fragment jump, so it behaves the same in every browser and in jsdom and
leaves no `#main` history entry; ESCAPECRAFT and ESCAPEARTIST were checked and left alone, their first
focusable control being one a keyboard user wants and neither carrying a navigation block to skip):
100.00 / 100.00 / 100.00 / 100.00, the same four figures as `main` at `207e6ece` (the ESCSUITE-202
squash) in the same sitting — lines 78 → 82, statements 79 → 83, functions 26 → 27 and branches 21 on both,
every new unit covered. The change adds no decision at all: the click handler is two unconditional
statements, with the ref read cast rather than guarded, because `<main>` is rendered unconditionally by
the same component and a null guard would be a branch no test could take against plan's 100 % floors.
The three new `Layout.test.tsx` cases (the link is the first Tab stop; activating it moves
`document.activeElement` to `main`; it renders on a second route) were red before the change. Outside
vitest's measurement, `apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` gains the PLAN case the
ESCSUITE-202 rewrite left as a comment — the link off-screen, the first Tab landing on it, on-screen once
focused, Enter moving focus into `main` — red on `main`, 21 / 21 on Chromium with the change, and
`core.spec.ts`'s 32 axe cases unaffected. **No floor crossed**; plan's floors stay 100 / 100 / 100 / 100.

`@escapesuite/artist` was re-measured 2026-10-04 for ESCSUITE-215 (the export dialog's progress is no longer
visual-only: the bar is a `role="progressbar"` with an integer `aria-valuenow`, a label and its bounds, and
one `role="status"` live region — rendered empty with the progress view and populated by the throttle in
`progressAnnouncement.ts`: the first report of a run, then each new ten-point band or five seconds, whichever
comes first, with the completion sentence always spoken — carries "Encoding frame N/M (30%)" at a rate a
screen reader can finish saying, while the visible per-frame line is `aria-hidden`; both the bookkeeping and
the words are refs written before the `setProgress` each report already makes, so no render is added per
encoded frame): 99.80 / 99.27 / 95.80 / 99.68, byte-identical on every percentage to the 99.80 / 99.27 / 95.80 / 99.68
that `main` at `5ebfccbe` (the ESCSUITE-217 version-packages commit) measures in the same sitting. Lines 7,779 / 7,794 → 7,795 / 7,810, statements
8,784 / 8,848 → 8,802 / 8,866, branches 4,973 / 5,191 → 4,981 / 5,199 and functions 1,888 / 1,894 →
1,890 / 1,896, every denominator
growing by exactly what the numerator did; the same 15 / 64 / 218 / 6 uncovered. The eight new branches are
`progressAnnouncement.ts`'s four (`previous === null`, the band comparison and the interval floor, each from
both sides by that module's cases — 10 and 10.1 cross a band, 9.9 and 4 do not, 50 → 20 does not, the floor
at exactly 5,000 ms and at 4,999) and `ExportDialog.tsx`'s four (the `'complete'` exemption against an
encoding report, and the throttle's verdict in both directions — the first report and the 10.2 % report
spoken, the 5 % report not), with the file's one pre-existing uncovered arm untouched. Mutations the
implementer ran: dropping the `'complete'` operand reds the completion case alone; `if (true)` reds the
band case alone; deleting the per-run reset reds "starts each run's announcements over". The
`ExportDialog.rerender` pins and every `*.perf.test.ts` are byte-identical. Outside vitest's measurement,
`apps/e2e/tests/accessibility/screen-reader.spec.ts` gains a real MP4 export asserting the progressbar's
numeric value during the run and the region naming "Export complete" after (10 / 10 on Chromium), and four
`getByText` locators across three specs gain `.first()` because the words now exist twice, once for eyes
and once for ears. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/artist` was re-measured 2026-10-04 for ESCSUITE-216 (the File menu is the menu its markup
promised: each item a `menuitem` with one roving tab stop, the rule a `separator`; opening focuses the first
item; ArrowDown and ArrowUp move and wrap, Home and End jump, all four stepping over a disabled item;
Enter and Space are left to the native button; Escape closes, stops the `window`-level cascade and gives
focus back to the trigger; Tab closes and lets focus move on; `aria-controls` names the menu only while it
is open; the arithmetic is one pure `nextMenuIndex(current, key, count)`): 99.80 / **99.28** / **95.82** / 99.68
against the 99.80 / 99.27 / 95.80 / 99.68 that `main` at `a12155ef` (the ESCSUITE-215 version-packages
commit) measures in the same sitting — statements up a hundredth and branches two, lines and functions
unmoved. Lines 7,795 / 7,810 → 7,826 / 7,841, statements 8,802 / 8,866 → 8,833 / 8,897,
branches 4,981 / 5,199 → 5,004 / 5,222 and functions 1,890 / 1,896 → 1,893 / 1,899, every denominator growing by exactly what
the numerator did; the same 15 / 64 / 218 / 6 uncovered. The twenty-three new branches are
`app/menuNavigation.ts`'s five (one switch arm per key and the `null` default, each from both wrap
directions by `menuNavigation.test.ts`'s fourteen cases) and `app/FileMenu.tsx`'s eighteen (2 → 20: the
`aria-controls` open-or-shut ternary, the `flatMap` over enabled items, the `isOpen` focus effect, the
Escape, Tab and `null`-key returns in the handler, the item ref callback's `if (el)`, the separator and the
roving `tabIndex` ternary per item) — each reached from both sides by the FileMenu suite, which grew from
twelve cases to thirty-two: a disabled Save and a disabled Export stepped over, a one-item wrap, an
ignored key leaving focus and the tab stop alone, the closed and open renders of the trigger. The only
arm written without a test is the trigger ref's `null!`, read solely from a keydown inside the menu that
trigger opened. `role="menuitem"` replaces the implicit button role, so twelve `getByRole('button')`
queries that reached a menu item became `menuitem` (eleven in the App suites, one e2e). The three
rerender pins and all seven `*.perf.test.ts` files are byte-identical. Outside vitest's measurement,
`apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` gains the two cases the ESCSUITE-202 rewrite left
as a comment plus an axe audit of the open menu — red on the base with `aria-required-children` — and the
five affected specs ran 100 / 100 on Chromium. **No floor crossed**; artist's floors stay 99 / 99 / 95 / 99.

`@escapesuite/craft` was re-measured 2026-10-09 for ESCSUITE-222 and ESCSUITE-223 (the recorder's
R / P / S / Space shortcuts and the playback dialog's keys ignore a browser chord — ⌘ / Ctrl / Alt —
and the recorder's also ignore a held key's auto-repeat, so ⌘S no longer stops a take, ⌘R no longer
starts one on the way to a reload, ⌘0 reaches the browser's zoom reset instead of the player, and a
held Space no longer pauses and resumes the take once per repeat; Shift is left alone on both, and
`repeat` is kept for the player because holding ← / → to scrub is its documented behaviour):
100.00 / 99.53 / **97.79** / 100.00 against the 100.00 / 99.53 / 97.77 / 100.00 that `main` at
`e48ba1fe` measures in the same sitting — branches up two hundredths, the other three unmoved at
exactly 100, 99.53 and 100. The base gives 1,365 / 1,396 branches and this branch 1,376 / 1,407:
eleven new branches, eleven covered, the same 31 uncovered as before (lines 2,387 → 2,391,
statements 2,545 / 2,557 → 2,549 / 2,561, functions 456 on both; the same 12 statements uncovered,
in the same four files). The eleven are `hooks/useKeyboardShortcuts.ts`'s six (29 → 35: the early
return and its four `||` operands, `metaKey`, `ctrlKey`, `altKey` and `repeat`, each reached from
both sides by the per-modifier cases, the auto-repeat case and the plain-press pin that still
starts the take) and `components/VideoPlayer/VideoPlayer.tsx`'s five (98 / 106 → 103 / 111: the
same return with three operands, no `repeat`, reached by the ⌘0, Ctrl+←, Alt+← cases against the
plain ← / → and `k` cases that were already there; the file's eight pre-existing uncovered arms
untouched). The `App.*rerender*` pins and every `*.perf.test.ts` are byte-identical. **No floor
crossed**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/craft` and `@escapesuite/shared` were re-measured 2026-10-09 for ESCSUITE-221 (the
offline single-file ESCAPECRAFT opened from disk disables both editor buttons — the header's "Open
Editor" and every row's "Open in Editor" — with one visible reason, "Download this recording's WebM
and import it into the offline ESCAPEARTIST file.", carried as each button's `title` and
`aria-describedby` target, instead of opening `file:///artist/`, a browser error page; the embedded
case is untouched, because a host framing the file build still receives `SEND_TO_EDITOR`; and
`isFileOrigin()` joins the shared config as the one reader of `window.location.protocol === 'file:'`).
**Craft**: 100.00 / 99.53 / **97.80** / 100.00 against the 100.00 / 99.53 / 97.77 / 100.00 that `main`
at `e48ba1fe` measures in the same sitting — branches up three hundredths, the other three unmoved at
exactly 100, 99.53 and 100. The base gives 1,365 / 1,396 branches and this branch 1,382 / 1,413:
seventeen new branches, seventeen covered, the same 31 uncovered as before (lines 2,387 → 2,391,
statements 2,545 / 2,557 → 2,549 / 2,561, functions 456 on both; the same 12 statements uncovered, in
the same four files). The seventeen are `components/AppHeader/AppHeader.tsx`'s six (10 → 16: the
reason's render gate and the `title` and `aria-describedby` ternaries, each reached under `file:` and
under `http:` by the header's own cases), `components/RecordingsList/RecordingsList.tsx`'s seven
(51 → 58: the `title`'s `||`, the `aria-describedby` ternary and the three-operand render gate on the
note — a reason, at least one row — reached with and without a reason and with an empty library) and
`components/RecordingsList/RecordingsListPanel.tsx`'s four (16 → 20: `isFileOrigin() && !embedded`
and the ternary it feeds, reached from both sides by the from-disk, from-disk-but-embedded and hosted
cases); `utils/sendToEditor.ts` gains the sentence, one statement and no decision. **Shared**:
100.00 / **98.63** / **92.00** / 100.00 against 100.00 / 98.62 / 91.89 / 100.00 — statements up a
hundredth and branches up eleven, lines and functions still exactly 100: lines 272 → 274, statements
286 / 290 → 288 / 292, branches 136 / 148 → 138 / 150 and functions 73 → 74, every new unit covered
and the same 4 statements and 12 branches uncovered. The two new branches are `isFileOrigin`'s two
`&&` operands in `config/index.ts` (20 / 22 → 22 / 24, the same two pre-existing arms uncovered),
reached from both sides by the `file:`, `https:` and no-`window` cases. **Branches land on exactly
92.00, so shared's branches floor goes 91 → 92** in `packages/shared/vitest.config.ts` and
`scripts/coverage-report.mjs` — a floor is the achieved coverage rounded down, and 138 / 150 is a
whole percent with nothing to spare, which on this package's small denominator is the design: the
next untested branch in shared turns CI red rather than being absorbed. Its floors are now
100 / 98 / 92 / 100. The review's round 1 (five items) and the L verifier's wording refinement are in
these numbers; the e2e seed now waits for the app's own `videos` store before writing, so it cannot
race `indexedDB.open` into an empty v1 database. Outside vitest's measurement: the new `file://` case
in `apps/e2e/tests/standalone/craft.spec.ts` — two cases, the header button on every standalone
browser and the seeded row's button with WebKit skipped for the Blob-in-IndexedDB gap the file's two
earlier cases already skip for (whether shipping Safari shares it is ESCSUITE-258) — run against
`pnpm build:standalone` on Chromium, Firefox and WebKit: 39 passed, 3 skipped, of 42; the first run
had the row seed in the same case as the header and was red on WebKit alone, which is why there are
two. The `App.*rerender*` pins and every `*.perf.test.ts` are
byte-identical. **No floor crossed downward**; craft's floors stay 100 / 99 / 97 / 100.

`@escapesuite/artist` was re-measured 2026-10-09 for ESCSUITE-241 (a project whose sources would not fit
in one `.veditor` file is refused before any byte is read — one budget, `MAX_PROJECT_FILE_BASE64_BYTES`
of 256 MiB of base64 across every used source and thumbnail, computed from `blob.size` handles — with a
`ProjectTooLargeError` whose sentence names the sources' own total, the format's limit in the same units
and the largest source, instead of `readAsDataURL` answering an empty string past V8's string ceiling and
the save writing an 897-byte file that can never be reopened; an empty or short read is a failure too;
both callers show the sentence, `projectSaved` never fires on a refusal, and a save-and-load whose save
fails for any reason keeps its dialog and never loads over the unsaved work): 99.80 / 99.28 / **95.84** /
99.68 against the 99.80 / 99.28 / 95.82 / 99.68 that `main` at `3ea73c41` (the Dependabot-overrides
merge) measures in the same sitting — branches up two hundredths, the other three unmoved. The base
gives 5,004 / 5,222 branches and this branch 5,028 / 5,246: twenty-four new branches, twenty-four
covered, the same 218 uncovered as before (lines 7,826 / 7,841 → 7,855 / 7,870, statements
8,833 / 8,897 → 8,865 / 8,929, functions 1,893 / 1,899 → 1,897 / 1,903, every denominator growing by
exactly what the numerator did; the same 15 / 64 / 6 uncovered). The twenty-four are
`core/projectManager.ts`'s twenty (34 → 54: the pre-pass's missing-record `continue`, the
thumbnail-or-not term in the total, the largest-source comparison, the `total > limit` refusal,
`blobToBase64`'s result-is-a-string, has-a-comma and long-enough checks, `ProjectTooLargeError`'s
default `sourceTotal` argument — reached without it by the hook suite's hand-built refusal and with it
by the pre-pass — and the MiB formatting) and `app/useProjectActions.ts`'s four (16 → 20: the
`instanceof ProjectTooLargeError` choice in `handleSaveProject` and in `handleProjectLoadSaveAndLoad`),
each reached from both sides by the over-budget, two-sources-together, thumbnail-counted, exact-boundary
and one-byte-over cases, the empty, short and `null` reads, the named and generic sentences, and the
refused save-and-load that leaves the dialog open. The review's round 1 (a failed save-and-load never
loads, sizes in source MiB, the `null`-read and boundary cases) and its re-review's one note (the total
rounded up from the sources' real bytes rather than reconstructed from base64) are in these numbers.
The rerender pins and every `*.perf.test.ts` are byte-identical. **No floor crossed**; artist's floors
stay 99 / 99 / 95 / 99.

Each package's floors are these numbers rounded down to a whole percent, so the floor is
never above what the suite actually achieves:

| Package | Lines | Statements | Branches | Functions |
|---------|-------|------------|----------|-----------|
| `@escapesuite/plan` | 100.00 | 100.00 | 100.00 | 100.00 |
| `@escapesuite/craft` | 100.00 | 99.53 | 97.80 | 100.00 |
| `@escapesuite/artist` | 99.80 | 99.28 | 95.84 | 99.68 |
| `@escapesuite/shared` | 100.00 | 98.63 | 92.00 | 100.00 |
| `@escapesuite/headless-artist` | 99.55 | 99.47 | 98.48 | 98.72 |

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

- WebCodecs (ESCAPEARTIST exports) is no longer Chrome/Edge only, and which *codecs* a browser
  that has it can actually encode varies — measured 2026-10-02 on the Playwright 1.63 browsers,
  on a secure origin (`about:blank` is not one and reports no WebCodecs at all): Chromium 153 and
  WebKit 26.6 have `VideoEncoder` with H.264, VP9, VP8 **and** AAC; **Firefox 155 has all three
  video codecs and no AAC encoder**. So both `isMP4ExportSupported(width, height)` and
  `isWebMExportSupported(width, height)` are real asynchronous probes of what this browser can
  configure at the output size, and both answer two questions, `{ video, audio }`, because the two
  failures differ in kind: no picture codec means no export in that format at all, while no audio
  codec (AAC for MP4, Opus for WebM) means a file with no sound in it.
  A browser can therefore offer one format and not the other, or offer MP4 knowing it will be
  silent, and the export dialog says which before the click and what happened after it, rather
  than offering a button that fails the instant it is clicked (ESCSUITE-22/29 gave WebM its video
  probe; ESCSUITE-175 gave MP4 the same and gave both the audio half — it also moved the H.264
  ladder and the AAC probe ahead of mixing the audio and loading the media, so a refusal costs
  nothing). See `apps/artist/CLAUDE.md`'s

  configure at the output size — MP4's answers two questions, `{ video, audio }`, because the two
  failures differ in kind: no H.264 means no MP4 at all, no AAC means an MP4 with no sound in it.

  A browser can therefore offer one format and not the other, or offer MP4 knowing it will be
  silent, and the export dialog says which before the click and what happened after it, rather
  than offering a button that fails the instant it is clicked (ESCSUITE-22/29 gave WebM its video
  probe; ESCSUITE-175 gave MP4 the same and gave both the audio half — it also moved the H.264
  ladder and the AAC probe ahead of mixing the audio and loading the media, so a refusal costs
  nothing). See `apps/artist/CLAUDE.md`'s
  "Export Dialog Browser Support"
- MediaRecorder produces WebM without proper seek metadata (requires post-processing — guarded
  end to end by `apps/e2e`'s `pip-seekable` specs, one per build pipeline; composited PiP takes,
  audio-only takes and any browser without WebCodecs all reach that path, but a composited PiP
  take is the only one the specs can drive in headless Chromium. A separate-tracks PiP take is
  recorded by `WebCodecsRecorder` and needs no repair)
- AudioContext needs `resume()` call due to Chrome autoplay policy
- System audio capture only works with getDisplayMedia (Chrome/Edge)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Eight jobs, with `ci-status` as the single required check. The benchmarks live in a separate workflow, `perf.yml`, which is informational and was never one of its dependencies:

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint + TypeScript (shared, plan, craft, artist, headless-artist, e2e) | PRs and pushes |
| `test` | Unit tests with coverage | PRs and pushes |
| `build` | Production builds, bundle size report, packs + uploads the headless-artist kit | PRs and pushes |
| `kit-docker` | Builds the reference headless-artist Docker image and smoke-tests it (a real `docker run` render + `--version`) | PRs and pushes (skipped for Dependabot) |
| `standalone` | Offline single-file builds + standalone E2E, then the combined `dist/` build + production-layout (single-origin) E2E | PRs and pushes (E2E halves skipped for Dependabot) |
| `e2e` | Full Playwright suite (journey included) + headless-artist Chromium tests | PRs and pushes (skipped for Dependabot) |
| `deploy` | Vercel deployment | After E2E passes (skipped for Dependabot) |
| `ci-status` | Summary/gate job | All PRs |

The `pnpm perf` benchmarks run from `.github/workflows/perf.yml` instead: pushes to `main`/`dev`, PRs labelled `perf`, and `workflow_dispatch`; informational only, never gates, skipped for Dependabot.

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
- **GitHub's `/releases/latest` is reserved for the umbrella release** (ESCSUITE-195). Before this
  ticket, both this workflow's `gh release create` and `changesets/action`'s per-package ones let
  GitHub pick "latest" by creation time, so a kit-, shared- or plan-only publish (which cuts no
  umbrella release — see below) could leave `/releases/latest` pointing at a release with no
  offline build attached at all, for as long as it took the next craft/artist bump to land. Fixed
  two ways: a `mark-per-package-releases-not-latest` job in `release.yml` runs right after
  `changesets/action` and sets `make_latest: false` on every release that publish just created
  (craft, artist, shared, plan, headless-artist — whichever changesets bumped), via
  `updateRelease` rather than an option on the action itself, since `create-github-releases` has
  none; and this workflow's `gh release create` always passes `--latest`, with the skip path (the
  umbrella tag already exists because neither app bumped) now running
  `gh release edit "v${VERSION}" --latest` before exiting, so a kit-only release re-asserts the
  umbrella as latest rather than leaving it be. `make_latest: false` only moves the pointer off a
  release that is *becoming* not-latest, so it does nothing when the release it is marking is
  already GitHub's "latest" (observed 2026-10-04: `/releases/latest` named a shared-only release
  for ~25 minutes after the not-latest job succeeded) — `mark-per-package-releases-not-latest`
  therefore marks the current umbrella `vX.Y.Z` release latest itself, right after the
  per-package marking, so the pointer is never on a per-package release for longer than that job
  takes (ESCSUITE-218); `standalone-release.yml`'s own `--latest` above repeats it as the second
  line of defence.

**Standalone Release** (`.github/workflows/standalone-release.yml`):
- Runs after CI succeeds on `main` (and attaches preview builds as workflow artifacts for PRs)
- Builds ESCAPECRAFT and ESCAPEARTIST in standalone mode (`VITE_BUILD_MODE=standalone`)
- Also downloads the `headless-artist-kit` artifact from the same CI run and renames the
  tarball to `escapesuite-headless-artist-<VERSION>.tgz` (VERSION here is the umbrella release's
  own version — the higher of the craft and artist versions — not the kit package's own
  independent version)
- On `main`, creates a GitHub Release and attaches the single-file HTML builds — each named
  for its own app's version — and the headless-artist kit tarball directly to it
- No cloud storage step and no license injection — the downloads are plain HTML files (and one
  npm tarball), ready to run
- Alongside each versioned HTML build, also attaches `ESCAPECRAFT-latest.html` /
  `ESCAPEARTIST-latest.html` — the same build, under a name that never changes — so
  `.../releases/latest/download/ESCAPECRAFT-latest.html` is a stable URL across every release.
  ESCAPEPLAN's `apps/plan/src/lib/launch.ts` (`CRAFT_OFFLINE_BUILD_URL` /
  `ARTIST_OFFLINE_BUILD_URL`) points its per-app "Download ESCAPECRAFT" / "Download ESCAPEARTIST"
  CTAs at exactly those two URLs — which the `--latest` / `make_latest: false` split above keeps
  pinned to this release's own build — rather than GitHub's bare `/releases/latest` listing page,
  which is kept as the hero's secondary "All downloads" link instead (ESCSUITE-195).

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
