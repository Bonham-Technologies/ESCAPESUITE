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

### ESCAPEPLAN (apps/plan)
- React Router for client-side routing
- Landing page & legal pages only — no accounts, no backend
- In production: serves CRAFT at `/craft/` and ARTIST at `/artist/`

### ESCAPECRAFT (apps/craft)
- Zustand store in `src/store/recorderStore.ts`
- Core modules in `src/core/`: `recorder.ts`, `compositor.ts`, `permissions.ts`, `thumbnailGenerator.ts`, `storage.ts`, `converter.ts`
- Recording modes: screen, webcam, PiP (screen + webcam overlay), with mic/system audio options
- Outputs WebM (requires `webm-duration-fix` for proper seek metadata)
- Export to MP4 (H.264+AAC) or WebM (VP9+Opus) via WebCodecs + Mediabunny
- Export features: cancellation support, background tab support, ~real-time encoding speed

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
  opens the editor itself when embedded. Only "Send to Editor" becomes a message.
- **URL params (ARTIST)**: `?video=url` to preload, `?project=base64` for state,
  `?loadVideo=<id>` for the CRAFT handoff, `?suppressRestore=1` to skip the
  "Resume Previous Session?" prompt (ARTIST then neither offers nor writes the saved session —
  the autosave is off too), and `?title=<name>` to name the project (trimmed, max 120 chars;
  applied only while the name is still the default `Untitled Project`).
- **`?hostOrigin=<origin>`** (both apps): the host's own origin, e.g. `https://host.example`.
  Recommended for production hosts. Outbound posts are addressed to it instead of `'*'`, and
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

Four benchmarks, each run three times and reported as the median, all against **one
deterministic 12-clip, 13-second scene** (14 clips over 4 tracks at 1280x720, clips
scaled to fill the frame — scale 1 means native pixel size here) built in-test from
`apps/e2e/fixtures/headless/source.mp4` and loaded through the documented integration
API (`GET_STATE` for the imported source's id, then `LOAD_PROJECT`) — there is no app
code for the benchmarks' sake:

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
- **`headless-kit-render`** — `services/headless-artist` rendering
  `fixtures/headless/project.json`, Chromium launch included.

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
Five ordinary vitest files — `apps/artist/src/components/Preview/drawFrame.perf.test.ts`,
`apps/artist/src/core/exportMP4.perf.test.ts`,
`apps/artist/src/components/Timeline/timelineGestures.perf.test.ts` (listeners, rects, snap-point
and render counts per pointer move), `apps/craft/src/core/compositor.perf.test.ts`
and `apps/craft/src/core/converter.perf.test.ts` — run the same scene through the same
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
numbers had already been).
Each package's floors are these numbers rounded down to a whole percent, so the floor is
never above what the suite actually achieves:

| Package | Lines | Statements | Branches | Functions |
|---------|-------|------------|----------|-----------|
| `@escapesuite/plan` | 100.00 | 100.00 | 100.00 | 100.00 |
| `@escapesuite/craft` | 100.00 | 99.20 | 95.78 | 99.67 |
| `@escapesuite/artist` | 99.34 | 98.62 | 93.17 | 98.87 |
| `@escapesuite/shared` | 100.00 | 97.78 | 88.69 | 98.38 |
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
- MediaRecorder produces WebM without proper seek metadata (requires post-processing)
- AudioContext needs `resume()` call due to Chrome autoplay policy
- System audio capture only works with getDisplayMedia (Chrome/Edge)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

Nine jobs, with `ci-status` as the single required check (`perf` is informational and deliberately not one of its dependencies):

| Job | Purpose | Runs On |
|-----|---------|---------|
| `lint-and-typecheck` | Security audit + ESLint + TypeScript (plan, craft, artist, headless-artist, e2e) | PRs and pushes |
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
- Releases are named after the tag (`<pkg>@<version>`) and their body is that version's entry from the package's `CHANGELOG.md`, written by the action itself. The two failure modes differ: if a versioned package has a `CHANGELOG.md` but no entry for the new version, the action throws (`Could not find changelog entry for …`) and fails the job loudly; if the `CHANGELOG.md` is missing entirely, the action silently skips that package's release, and the attach job — which looks releases up by `tag_name` — then silently skips its assets too. A package with no changelog therefore ships a tag and nothing else, with a green run.
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

All apps use `@vercel/analytics` for pageview and custom event tracking:
- `<Analytics />` component in each app's `main.tsx`
- Custom events via `track()` in `*/analytics.ts` files

## Issue Tracking

Issues and work items are tracked in Jira:
- **Project**: [ESCSUITE](https://bonham.atlassian.net/jira/software/projects/ESCSUITE/summary)
- **Board**: https://bonham.atlassian.net/jira/software/projects/ESCSUITE/boards

## Per-App Documentation

Each app has its own CLAUDE.md with detailed architecture:
- `apps/artist/CLAUDE.md`: Overlay system, keyframe animation, transform controls
- `apps/craft/CLAUDE.md`: Recording modes, PiP compositing, keyboard shortcuts
- `apps/plan/CLAUDE.md`: Routes, page structure, theme support
