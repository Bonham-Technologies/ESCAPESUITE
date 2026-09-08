# Headless ARTIST — Follow-ups after Plan 2 (Docker CI, hardening, verification, HTTP mode, release)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** Plan 2 (`2026-09-07-headless-artist-service-v2.md`) merged as PR #307. Its whole-branch review and the operator's notes left five things open: the reference Docker image has never been built; a batch of small hardening items in the kit; the spec's §12 output-verification test is missing; the spec's optional HTTP service mode (F6) is unbuilt; and the kit is not on any GitHub Release because the release job keys on the suite version, which has not moved. This plan closes all five. Spec: `docs/superpowers/specs/2026-06-07-headless-artist-design.md`.

**Tech baseline:** Node 24 in CI, vitest 5, Playwright pinned 1.62.1, kit at `services/headless-artist` (`test:run` unit / `test:e2e` = `HEADLESS_BUILD=1 vitest run chromium.test` with a gated `test/globalSetup.ts` that runs the assembler once). GitHub-hosted `ubuntu-latest` runners have Docker and `ffmpeg`/`ffprobe` preinstalled. Changesets: `linked: [plan, craft, artist]`, private packages are versioned and tagged; `release.yml` runs `changesets/action` on push to `main` (opens a "Version Packages" PR, and on merge tags + creates per-package GitHub Releases and attaches standalone builds); `standalone-release.yml` separately creates `v<craft version>` after CI on main and now attaches the kit.

## Global constraints
- The kit's `package.json` must never gain a `workspace:` dependency (breaks `npm install` of the tarball).
- Playwright stays exactly 1.62.1 everywhere; the Dockerfile `FROM` tag is asserted by the assembler.
- Style in the service: 2-space, no semicolons, single quotes; lint 0 errors / 0 warnings; typecheck clean; tests verify real behaviour; Chromium tests are `*.chromium.test.ts`.
- CLI contract unchanged: one JSON outcome line on stdout, logs on stderr, exit 0/1/2.
- No network at render time (driver aborts http(s)); the `serve` mode adds an inbound HTTP listener only.

---

## Task 1: Build and smoke the reference Docker image in CI

**Files:** `.github/workflows/ci.yml` (new job `kit-docker`), `services/headless-artist/README.md` (one sentence), `services/headless-artist/Dockerfile` (only if the build reveals a defect).

- [ ] Add job `kit-docker` to `ci.yml`: `runs-on: ubuntu-latest`, `timeout-minutes: 20`, `needs: build`, `if: github.actor != 'dependabot[bot]'`. Steps: checkout, pnpm + Node (copy the existing setup steps), `pnpm install --frozen-lockfile`, `pnpm --filter=@escapesuite/headless-artist run build` (assembles `dist/`), `docker build -t headless-artist:ci services/headless-artist`, then a smoke: prepare `$RUNNER_TEMP/in` with `services/headless-artist/examples/manifest.json` + `clip.mp4` + a job file whose paths are `/in/...` and whose sink is `volume` → `/out`; `mkdir -p $RUNNER_TEMP/out && chmod 777 $RUNNER_TEMP/out`; `docker run --rm -v $RUNNER_TEMP/in:/in:ro -v $RUNNER_TEMP/out:/out headless-artist:ci --job /in/job.json > outcome.json`; assert exit 0, `jq -e '.ok == true' outcome.json`, the `.mp4` and `.manifest.json` exist in `out/`, and `sha256sum` of the mp4 equals the manifest's `sha256`. Also `docker run --rm headless-artist:ci --version` prints JSON (note: ENTRYPOINT already includes `render`, so `--version` must be passed as `--entrypoint node headless-artist:ci dist/cli.js --version`; if that is awkward, change ENTRYPOINT to `["node","dist/cli.js"]` and `CMD ["render","-"]` and update README + k8s example + broker script accordingly — Task 4 needs that shape anyway for `serve`, so make the change here).
- [ ] Make `ci-status` depend on `kit-docker` the same way it depends on `e2e` (skipped-for-Dependabot handling included). Keep the `deploy` job independent of it.
- [ ] README "Running in a container": one sentence that the image is built and smoke-tested in CI on every PR.
- [ ] Verify: both workflow files parse; `docker build` is exercised only in CI (no daemon locally) — so push the branch and confirm the `kit-docker` job is green before marking the task done (the controller will do this; the implementer commits and reports). Commit: `ci: build and smoke the headless-artist Docker image`.

## Task 2: Kit hardening batch (deferred minors from the Plan 2 reviews)

**Files:** `services/headless-artist/src/{loaders,jobSpec,cli,sinks,s3}.ts` + tests; `apps/artist/src/headless/renderProject.ts` + test.

- [ ] `loaders.ts`: validate each `.veditor` `videos[i]` is an object with string `id`, `name`, `mimeType`, `data` before use (one-sentence errors naming the index/field); reject duplicate source ids in both loaders; `fs.stat().isFile()` instead of `fs.access` for manifest files (a directory → clear error).
- [ ] `jobSpec.ts`: unknown top-level keys and unknown `options` keys produce a warning list returned alongside the spec (`parseJobSpec` returns `{ spec, warnings }` OR keeps returning `JobSpec` and a separate `collectUnknownKeys(json)` — choose the one that changes fewer call sites) and the CLI prints them to stderr as `warning: unknown field "…"`.
- [ ] `cli.ts`: `--job` must not consume a following flag (a value starting with `-` other than exactly `-` is an error → exit 2); a second bare path → exit 2; `render --help` → usage on stderr, exit 0; `render -` when stdin is a TTY → exit 2 with "no job on stdin"; `isDirectRun` falls back to a lexical compare when `realpathSync` throws.
- [ ] `sinks.ts`: EXDEV copy path removes a partial destination on failure before rethrowing; `config.env` values validated as strings.
- [ ] `s3.ts`: `s3Sink(config, client?)` accepts an injected minimal client; rewrite the "outputLocation format" tests to call `deliver` with a stub client and assert keys, ContentType, ContentLength, and the returned locations.
- [ ] `renderProject.ts`: remove the download anchor from the DOM right after `click()` (the object URL stays alive); update the unit test.
- [ ] Verify: `test:run`, `test:e2e`, typecheck, lint in the service; artist `vitest run src/headless`, tsc, eslint; `apps/e2e` headless spec. Commit: `fix(headless-artist): hardening batch from the Plan 2 reviews`.

## Task 3: Output verification test (spec §12)

**Files:** `services/headless-artist/src/verify.chromium.test.ts`, `services/headless-artist/test/ffprobe.ts` (helper), README "Output and verification" (one paragraph).

- [ ] Helper `probe(file)` → `{ streams: [{codec_type, codec_name, width, height, nb_read_frames}], duration }` via `ffprobe -v error -count_frames -show_entries stream=codec_type,codec_name,width,height,nb_read_frames:format=duration -of json`; `frameMeanRGB(file, frameIndex)` via `ffmpeg -i file -vf "select=eq(n\,N),scale=1:1" -frames:v 1 -f rawvideo -pix_fmt rgb24 -` → `[r,g,b]`. Both `execFile` (no shell). `hasFfmpeg()` checks both binaries; tests `describe.skipIf(!hasFfmpeg())` with a visible skip reason.
- [ ] Test: render the manifest fixture (solid red 64x48, 1 s) to MP4 and WebM through `runJob` into a temp volume dir; assert container/codec (`h264`/`vp9`), `64x48`, frame count 30 (±1), duration ≈ 1.0 (±0.1); the middle frame's mean RGB is red (r > 200, g < 40, b < 40) in both formats — this is the perceptual check the spec asks for, against a known golden; assert the manifest's `sha256` equals a fresh sha256 of the file and `byteLength` equals its size.
- [ ] Test: a 2-clip project (fixture clip on track 0 at 0–1 s and again on track 1 at 0.5–1.5 s with opacity 0.5) renders 45 frames (±1) at the project size — proves the timeline duration and compositing path, not just a passthrough.
- [ ] README: how a customer verifies a delivery (`sha256sum`, `ffprobe`), and that CI runs these checks against golden expectations.
- [ ] Verify: `test:e2e` green locally (ffmpeg present) and in CI. Commit: `test(headless-artist): ffprobe + golden-frame verification of rendered output`.

## Task 4: HTTP service mode (spec §6, F6 — optional, reuses `runJob`)

**Files:** `services/headless-artist/src/serve.ts` (+ `serve.test.ts` unit with `runJob` mocked, `serve.chromium.test.ts` one real render), `src/cli.ts` (`serve` command), README section, Dockerfile/k8s/broker updates only if Task 1 did not already move `render` out of ENTRYPOINT.

- [ ] `serve.ts`: `startServer({ port, host = '127.0.0.1', concurrency = 1, deps: RunDeps, log })` → `{ close(): Promise<void>, port }` using `node:http` only. Routes: `GET /healthz` → 200 `{ ok: true, versions, inFlight, queued }`; `POST /render` (JSON body ≤ 1 MiB, else 413) → `parseJobSpec` (400 with `{ error }` on invalid) → queue behind a concurrency limiter → `runJob` → 200 with the `RenderOutcome` (`ok:false` still 200; the outcome carries the failure — document why: the request succeeded, the job did not); anything else 404. Graceful shutdown: `close()` stops accepting, waits for in-flight jobs (bounded by the render timeout), then resolves; `SIGTERM`/`SIGINT` in the CLI call it. Request logging to stderr (method, path, status, ms).
- [ ] `cli.ts`: `headless-artist serve [--port N] [--host H]`; env `HEADLESS_PORT` (default 8787), `HEADLESS_HOST` (default 127.0.0.1 — bind to `0.0.0.0` only when set explicitly; README warns there is no auth), `HEADLESS_CONCURRENCY` (default 1). Prints one line to stderr when listening; never writes to stdout.
- [ ] Unit tests (runJob mocked): healthz shape; 400 on invalid spec with the validation message; 413 on oversize body; 404; concurrency limiter serialises when `concurrency: 1` and allows 2 in flight when 2; `close()` waits for an in-flight job. Chromium test: start on port 0, POST the fixture manifest job with a volume sink into a temp dir, assert 200 + `ok:true` + the file exists.
- [ ] README: "HTTP service mode" section (when to use it vs one-shot, endpoints, request/response, concurrency, no auth → bind to localhost or put it behind the customer's proxy, container usage: `docker run … serve --host 0.0.0.0 -p 8787:8787`).
- [ ] Verify: service `test:run`, `test:e2e`, typecheck, lint. Commit: `feat(headless-artist): HTTP service mode (serve) reusing runJob`.

## Task 5: Cut a release that carries the kit

**Files:** `.changeset/*.md`, `.github/workflows/release.yml`.

- [ ] Add changesets: `@escapesuite/plan`, `@escapesuite/craft`, `@escapesuite/artist` **minor** (linked → 2.1.0) with a summary of what landed since 2.0.0 (Node 24 baseline, dependency sweep, 4K/1440p MP4 export fix, headless render bundle v2, the a11y fixes); `@escapesuite/headless-artist` **minor** (0.1.0 → 0.2.0) summarising the kit; `@escapesuite/shared` **patch**.
- [ ] `release.yml`: in the "Attach Standalone Builds" job, also handle `@escapesuite/headless-artist` being published: build the kit (`pnpm --filter=@escapesuite/headless-artist run pack:kit`) and upload the tarball as an asset of the headless-artist package release (mirror the existing craft/artist attach logic; asset name `escapesuite-headless-artist-<version>.tgz`).
- [ ] Verify workflow YAML parses; `pnpm changeset status` lists the five packages. Commit: `chore: changesets for 2.1.0 and attach the kit to its package release`.
- [ ] Controller: after the branch merges, `release.yml` opens the "Version Packages" PR; wait for its CI, merge it, then confirm the per-package releases and the `v2.1.0` release both carry the kit tarball.

## Done criteria
- `kit-docker` job green on the PR: the image builds, renders the example inside the container as `pwuser` with mounted `/in`/`/out`, and the manifest verifies.
- Hardening items merged with tests; service suite still green.
- Verification test green locally and in CI; a wrong-colour render would fail it.
- `headless-artist serve` renders over HTTP with the documented contract.
- A GitHub Release exists with `escapesuite-headless-artist-*.tgz` attached.
