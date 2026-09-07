# Headless ARTIST — Render Service & Kit (Plan 2, v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes** `2026-06-07-headless-artist-service.md` (kept for history). Revised 2026-09-07 after Plan 1 merged (PR #250) and a stress pass found that the Plan‑1 contract moves media across the Chromium boundary as base64 strings, which caps outputs at roughly 400 MB (V8 string length) and makes multi‑GB sources impractical. This plan replaces that transfer with two streaming primitives that were spiked in real headless Chromium on 2026‑09‑07: **sources in** via Playwright `setInputFiles` on a hidden `<input type=file>` (50 MB seeded into IndexedDB in 72 ms, no JS-heap copy), **output out** via the browser **download** event + `download.saveAs()` (50 MB in 258 ms, sha256 identical). Also updated: Node 24 / vitest 5 / Playwright 1.62.1 baseline, CI wiring, and kit distribution on GitHub Releases.

**Goal:** Build `services/headless-artist` — a stateless Node one-shot CLI that loads a project + sources from local files, drives the Plan‑1 headless bundle in real headless Chromium, and delivers the rendered video + a verification manifest through a pluggable output sink — shipped as a code kit (npm tarball, attached to GitHub Releases) with an optional reference Dockerfile. Free and ungated.

**Architecture:** `job spec → (input loader → local files) → (Chromium render via the bundle's window.__renderProjectToFile, output streamed to disk by the browser download) → (output sink, file-path based) → exit`. No queue/state; the customer's broker spawns it per job. Local in / local out is the guaranteed contract; S3/webhook/command are optional reference adapters.

**Tech stack:** TypeScript, **Node ≥ 22.22 (CI on 24)**, `playwright` **^1.62.1** (same version as `apps/e2e` so one browser cache serves both), `tsx`, `esbuild` ^0.27, **vitest ^5**, optional `@aws-sdk/client-s3`. Reuses `@escapesuite/shared` and the Plan‑1 `apps/artist/dist-headless/headless.html`.

**Spec:** `docs/superpowers/specs/2026-06-07-headless-artist-design.md`. **Plan 1 (merged):** `docs/superpowers/plans/2026-06-07-headless-artist-render-bundle.md`.

---

## Facts the implementer must know (verified 2026-09-07)

- The bundle entry today: `window.__renderProject(input: RenderInput, onProgress?) → Promise<RenderResult>` where `RenderInput = { project, sourceVideos, sourceBlobs: Record<id, ArrayBuffer>, options }` and `RenderResult = { meta: RenderMeta, base64 }`. Files: `apps/artist/src/headless/{types,seedSources,renderProject,main}.ts`, `apps/artist/headless.html`. `renderProject` validates that every media clip has a source in `sourceVideos` **and** bytes in `sourceBlobs`, defaults `options.resolution` to `'project'`, and returns output-accurate `meta` (honours `resolution` and `timeRange`).
- The engine reads only `source.width/height` (base dimensions, via `getBaseDimensions` in `exportTypes.ts`) and `source.mediaType` (`'image'` / `'audio'` branches) from `sourceVideos`. Audio presence is detected from the bytes, not from `hasAudio`.
- A `.veditor` file is `{ version: 1, project, videos: [{ id, name, mimeType, data /*base64*/, thumbnail? }] }` — **no width/height/duration**. The editor recovers them on load with `extractMetadataFromBlob(blob, {id,name,mimeType})` in `apps/artist/src/core/projectManager.ts` (currently **not exported**; it probes via `<img>`/`<audio>`/`<video>` elements — browser only). The bundle must do the same probing; Node cannot.
- `apps/e2e` pins `@playwright/test` ^1.62.1 (lockfile 1.62.1). CI's `e2e` job caches `~/.cache/ms-playwright` and installs chromium + system deps; the `test` job does **not** have browsers. CI's `lint-and-typecheck` job runs `pnpm lint` (turbo) plus explicit `tsc --noEmit` per app.
- Root `pnpm test` = `turbo test:run`; `pnpm test:coverage` = `turbo test:coverage` (what CI runs); `pnpm build` = `turbo build` (`outputs: ["dist/**"]`, `dependsOn: ["^build"]`).
- `standalone-release.yml` runs after CI on `main`, downloads the `standalone-builds` artifact produced by CI's `standalone` job, and attaches the two HTML files to a GitHub Release `v<craft version>`.
- Root `.gitignore` already ignores `dist/`, `coverage/`, `*.log`.
- ESLint is flat config per package (see `packages/shared/eslint.config.js`); the new package needs a Node-globals config without the React plugins.
- MP4 export above 1080p works (Level 5.1 fallback added in #250). Software encode on the dev Mac: ~0.3× realtime at 1080p.

## File structure

- `apps/artist/headless.html` — **modify.** Add the hidden sources `<input type="file" multiple>`.
- `apps/artist/src/headless/types.ts` — **modify.** `sourceBlobs` accepts `Blob | ArrayBuffer`; add `RenderFileInput`.
- `apps/artist/src/headless/seedSources.ts` — **modify.** Accept Blob, probe missing metadata.
- `apps/artist/src/headless/renderProject.ts` — **modify.** Validation covers the file variant; export `renderProjectToFile`.
- `apps/artist/src/headless/main.ts` — **modify.** Expose `window.__renderProjectToFile`.
- `apps/artist/src/core/projectManager.ts` — **modify (tiny).** Export `extractMetadataFromBlob`.
- `apps/e2e/tests/headless/render-bundle.spec.ts` — **modify.** Add the streaming case.
- `pnpm-workspace.yaml` — **modify.** Add `services/*`.
- `services/headless-artist/` — **create:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `README.md`, `Dockerfile`, `scripts/assemble-kit.mjs`, `examples/*.json`, `src/{types,jobSpec,loaders,renderDriver,manifest,sinks,s3,run,cli}.ts` + tests, `test/fixtures/`.
- `.github/workflows/ci.yml` — **modify.** Typecheck the service; run its Chromium tests in `e2e`; upload the kit.
- `.github/workflows/standalone-release.yml` — **modify.** Attach the kit tarball to the release.
- `CLAUDE.md`, `README.md`, `apps/artist/CLAUDE.md` — **modify.** Document the service.

Naming: Chromium-requiring tests are `*.chromium.test.ts` and run via `test:e2e`; everything else runs via `test:run` / `test:coverage` (no browser).

---

## Task 1: Bundle contract v2 — streaming sources in, download out (`apps/artist`)

**Files:** `headless.html`, `src/headless/types.ts`, `src/headless/seedSources.ts`, `src/headless/renderProject.ts`, `src/headless/main.ts`, `src/core/projectManager.ts`, tests in `src/headless/*.test.ts`, `apps/e2e/tests/headless/render-bundle.spec.ts`.

- [ ] **Step 1: Export the metadata probe.** In `projectManager.ts` change `async function extractMetadataFromBlob` to `export async function extractMetadataFromBlob`. No other change.

- [ ] **Step 2: Types.**
```ts
// types.ts additions / changes
export interface RenderInput {
  project: Project
  sourceVideos: SourceVideo[]
  /** Raw bytes per source id. A Blob (e.g. a File) is stored as-is — no copy. */
  sourceBlobs: Record<string, ArrayBuffer | Blob>
  options: Omit<ExportOptions, 'resolution'> & { resolution?: ExportOptions['resolution'] }
}
/** File-based variant used by the runner: sources come from the hidden <input type=file>. */
export interface RenderFileInput {
  project: Project
  /** Optional per-source metadata; missing width/height/duration/mediaType are probed from the bytes. */
  sourceVideos: Array<Pick<SourceVideo, 'id' | 'name' | 'mimeType'> & Partial<SourceVideo>>
  /** Maps source id → file name as it appears in the input element's FileList. */
  sourceFiles: Record<string, string>
  options: RenderInput['options']
  /** Download file name (without extension); the runner passes the job id. */
  outputName: string
}
```
  `RenderMeta` unchanged. Keep `RenderResult`/`__renderProject` working (existing tests and the base64 path stay for small jobs and the e2e spec).

- [ ] **Step 3: `seedSources`.** Accept `ArrayBuffer | Blob`. Build the Blob only for ArrayBuffers. For every source whose `width`/`height`/`duration`/`mediaType` is missing, call `extractMetadataFromBlob(blob, { id, name, mimeType })` and merge (provided fields win). Return the completed `SourceVideo[]` (the caller must pass the completed list to the engine — `getBaseDimensions` needs width/height). Unit tests with fake-indexeddb: Blob stored without copy; probe called only when fields are missing (mock `../core/projectManager`).

- [ ] **Step 4: `renderProject`.** Use the completed `sourceVideos` from `seedSources` for the engine call and the meta. Add `renderProjectToFile(input: RenderFileInput, onProgress?)`:
  1. Resolve `sourceFiles` against `document.getElementById('__sources')` FileList by `File.name`; throw naming the id/file when absent. Build `sourceBlobs` from the `File`s (no read).
  2. Validate like `renderProject` (unknown source → throw).
  3. Render via the shared code path, then trigger the download: `URL.createObjectURL(blob)`, `<a download="${outputName}.${ext}">`, `click()`; resolve with `meta` **after** the click. Revoke the URL on a `setTimeout` (Chromium has begun the download by then).
  Unit tests: file-name resolution, error on a missing file, download anchor created with the right name (jsdom: stub `URL.createObjectURL`, assert the anchor).

- [ ] **Step 5: `main.ts` + `headless.html`.** Expose `window.__renderProjectToFile`. Add `<input type="file" id="__sources" multiple hidden>` to `headless.html` before the script tag. Extend the `Window` augmentation.

- [ ] **Step 6: e2e proof (`apps/e2e/tests/headless/render-bundle.spec.ts`).** New test: `page.setInputFiles('#__sources', [fixture source path])`, `Promise.all([page.waitForEvent('download'), page.evaluate(() => window.__renderProjectToFile({... sourceFiles: {'src-0': 'source.mp4'}, outputName: 'job-1' }))])`, `download.saveAs(tmp)`, assert `meta.format === 'mp4'`, suggested filename `job-1.mp4`, file starts with `ftyp` within the first 12 bytes, and `meta.width === 64`. Also assert a source entry **without** width/height (delete them from the fixture's `sourceVideos` in the test) still renders at the project size.

- [ ] **Step 7: Verify + commit.** `pnpm --filter @escapesuite/artist exec tsc --noEmit`, `pnpm --filter @escapesuite/artist exec vitest run`, `pnpm --filter @escapesuite/artist run build:headless`, `cd apps/e2e && npx playwright test tests/headless --project=chromium`. Commit: `feat(headless): stream sources in via file input and results out via download`.

---

## Task 2: Scaffold `services/headless-artist`

- [ ] **Step 1:** `pnpm-workspace.yaml` → add `- "services/*"`.
- [ ] **Step 2:** `services/headless-artist/package.json`:
```json
{
  "name": "@escapesuite/headless-artist",
  "private": true,
  "version": "0.1.0",
  "description": "Render ESCAPEARTIST projects server-side in headless Chromium — one-shot CLI + kit",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=22.22.0" },
  "bin": { "headless-artist": "./dist/cli.js" },
  "files": ["dist", "README.md", "Dockerfile", "examples"],
  "scripts": {
    "build": "node scripts/assemble-kit.mjs",
    "pack:kit": "node scripts/assemble-kit.mjs && npm pack --pack-destination dist",
    "render": "tsx src/cli.ts render",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run --exclude '**/*.chromium.test.ts'",
    "test:coverage": "vitest run --coverage --exclude '**/*.chromium.test.ts'",
    "test:e2e": "vitest run src/**/*.chromium.test.ts"
  },
  "dependencies": { "playwright": "^1.62.1" },
  "devDependencies": {
    "@escapesuite/shared": "workspace:*",
    "@eslint/js": "<match repo>", "eslint": "<match repo>", "globals": "<match repo>", "typescript-eslint": "<match repo>",
    "@types/node": "^26.2.0", "@vitest/coverage-v8": "^5.0.0", "esbuild": "^0.27.2", "tsx": "^4.19.0", "typescript": "~5.9.3", "vitest": "^5.0.0"
  },
  "optionalDependencies": { "@aws-sdk/client-s3": "^3.700.0" }
}
```
  Match `<match repo>` versions to `packages/shared/package.json`. `playwright` is a runtime dependency of the kit (the customer installs it with `npm install`); the browser itself is a host prerequisite.
- [ ] **Step 3:** `tsconfig.json` (`target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `types: ["node"]`, `noEmit`, `include: ["src", "scripts"]`), `eslint.config.js` (js + tseslint recommended, `globals.node`, ignore `dist`/`coverage`), `.gitignore` (`dist`, `*.tgz`, `coverage`, `test-output`).
- [ ] **Step 4:** `src/types.ts` — import the bundle contract types from `../../../apps/artist/src/headless/types` (type-only; the kit is bundled by esbuild so the relative path is fine at build time) and define:
```ts
export interface JobSpec {
  jobId: string
  input: { bundle: { path: string } } | { manifest: { path: string } }
  options: RenderFileInput['options']
  output: { sink: 'volume' | 's3' | 'webhook' | 'command'; config: Record<string, unknown> }
}
export interface RenderOutcome {
  jobId: string; ok: boolean; meta?: RenderMeta; outputLocation?: string; manifestLocation?: string
  error?: string; durationMs: number
}
```
- [ ] **Step 5:** `pnpm install`; `pnpm --filter @escapesuite/headless-artist run typecheck` and `lint` pass on the empty package. Commit: `chore(headless-artist): scaffold service package`.

---

## Task 3: Job-spec validation + input loaders (local files → `LoadedJob`)

**Files:** `src/jobSpec.ts` (+test), `src/loaders.ts` (+test), `test/fixtures/`.

- [ ] **Step 1: `jobSpec.ts`.** `parseJobSpec(json: unknown): JobSpec` — hand-written validation (no new deps): `jobId` non-empty string matching `/^[A-Za-z0-9._-]{1,128}$/` (it becomes a file name), exactly one of `input.bundle`/`input.manifest` with a string `path`, `options.format` ∈ `mp4|webm`, `options.quality` ∈ `low|medium|high` (default `high`), optional `resolution` ∈ `project|original|1080p|720p|480p`, optional `timeRange {start<end}`, `output.sink` ∈ the four kinds, `output.config` object. Errors are one clear sentence naming the field. Tests for each rule.

- [ ] **Step 2: Fixtures.** `test/fixtures/manifest/{manifest.json,project.json,src-0.mp4}` (copy `apps/e2e/fixtures/headless/source.mp4` and the `project` object from `apps/e2e/fixtures/headless/project.json`) and `test/fixtures/project.veditor` built from them (`{version:1, project, videos:[{id:'src-0', name:'src-0.mp4', mimeType:'video/mp4', data}]}`). Manifest schema:
```jsonc
{
  "project": { "$ref": "./project.json" },      // or the inline project object
  "sources": [
    { "id": "src-0", "file": "src-0.mp4", "mimeType": "video/mp4",   // mimeType optional: inferred from extension
      "name": "clip.mp4", "width": 64, "height": 48, "duration": 1 } // all optional: the bundle probes what is missing
  ]
}
```

- [ ] **Step 3: `loaders.ts`.**
```ts
export interface LoadedJob {
  project: Project
  sourceVideos: RenderFileInput['sourceVideos']
  /** id → absolute local path handed to Playwright setInputFiles */
  sourceFiles: Record<string, string>
  /** Removes any temp files the loader created (bundle loader only). Safe to call twice. */
  cleanup(): Promise<void>
}
export async function loadBundle(path: string, tmpRoot?: string): Promise<LoadedJob>
export async function loadManifest(path: string): Promise<LoadedJob>
```
  `loadBundle` parses the `.veditor` JSON and writes each `videos[i].data` to `<tmp>/<id>.<ext>` **decoded from base64 in chunks** (the JSON itself must be parsed whole; that is acceptable — `.veditor` is the editor's own format and the manifest path is the recommended large-media route; say so in the README). `loadManifest` resolves `$ref` and `file` relative to the manifest directory, infers `mimeType` from extension when absent (`mp4, webm, mov, png, jpg, jpeg, gif, webp, mp3, wav, ogg, m4a, aac`), and fails clearly on a missing file. Both validate that every media clip's `sourceVideoId` exists in the sources (fail fast before launching Chromium). File names passed to Chromium must be unique per job — name temp files `<id>.<ext>` and, for manifests, detect duplicate basenames and throw (the bundle matches `File.name`).
  Tests cover both loaders, the inference, the duplicate-basename error, missing-file error, and `cleanup()`.

- [ ] **Step 4:** Commit: `feat(headless-artist): job-spec validation and bundle/manifest loaders`.

---

## Task 4: Chromium render driver (streaming)

**Files:** `src/renderDriver.ts`, `src/renderDriver.chromium.test.ts`.

- [ ] **Step 1: Implementation.**
```ts
export interface RenderDriverOptions {
  gpu?: boolean; chromiumPath?: string; noSandbox?: boolean; timeoutMs?: number
  onProgress?: (percent: number) => void
  log?: (line: string) => void          // defaults to stderr
}
export interface DriverResult { outputPath: string; meta: RenderMeta; chromiumVersion: string }
export async function renderInChromium(bundleHtmlPath: string, job: LoadedJob, options: RenderInput['options'], outputPath: string, opts: RenderDriverOptions = {}): Promise<DriverResult>
```
  Behaviour: launch `chromium` (`headless: true`; `executablePath` when given; args: `--autoplay-policy=no-user-gesture-required`, `--disable-gpu` unless `gpu`, in which case `--use-gl=angle --ignore-gpu-blocklist --enable-features=Vulkan`; `--no-sandbox` only when `noSandbox`). New context with `acceptDownloads: true`. `page.route(/^https?:/, r => r.abort())` — the bundle is fully inline, so **no network is ever needed**; this enforces the air-gap property. `page.on('crash')` and `page.on('pageerror')` reject the render. `exposeFunction('__hlProgress', p => onProgress?.(p))`. `goto(pathToFileURL(bundle))`, wait for `__headlessReady`. `page.setInputFiles('#__sources', Object.values(job.sourceFiles))`. Then `Promise.all([page.waitForEvent('download', { timeout }), page.evaluate(({...}) => window.__renderProjectToFile({ project, sourceVideos, sourceFiles: byFileName, options, outputName: 'render' }, p => window.__hlProgress(p)), payload)])`, `await download.saveAs(outputPath)`, read `browser.version()`. Everything in `try/finally { browser.close() }`. A single overall timeout (`timeoutMs`, default 30 min) races the whole thing and produces an error that says "render timed out after N ms".
  `sourceFiles` passed to the page are `{ id → basename }` because the page sees only `File.name`.

- [ ] **Step 2: Chromium test** (`renderDriver.chromium.test.ts`): `beforeAll` builds the bundle (`pnpm --filter @escapesuite/artist run build:headless`). Cases: manifest fixture → MP4 with `ftyp`, `meta.width 64`, progress called at least once, `chromiumVersion` non-empty; WebM variant; a project whose clip references a source not in the FileList → rejects with the bundle's error text; timeout of 1 ms → rejects with the timeout message and the browser is closed (no leaked process — assert the promise settles quickly).

- [ ] **Step 3:** Commit: `feat(headless-artist): Playwright driver streaming sources in and the render out`.

---

## Task 5: Verification manifest + output sinks (file-path based)

**Files:** `src/manifest.ts`, `src/sinks.ts`, `src/s3.ts`, tests.

- [ ] **Step 1: `manifest.ts`.** `buildManifest(jobId, outputPath, meta, versions: { chromiumVersion, engineVersion, kitVersion }, now?)` → `VerificationManifest` (`jobId, format, byteLength (from stat), durationSec, width, height, gpu, sha256 (streamed with createReadStream), chromiumVersion, engineVersion, kitVersion, createdAt`). Test: sha256 of a known file, byteLength from disk.

- [ ] **Step 2: `sinks.ts`.** `interface OutputSink { deliver(jobId, outputPath, manifest): Promise<{ outputLocation: string; manifestLocation?: string }> }`; `getSink(kind, config)` async (dynamic import for `s3`).
  - `volume { dir }`: `mkdir -p`, write `<dir>/<jobId>.<ext>` by **rename** when on the same device else copy, plus `<jobId>.manifest.json`. Overwrites existing files (idempotent by jobId).
  - `command { command, args?, env? }`: `execFile` (argument array, no shell) with the output path and manifest path **appended** as the last two arguments and also exported as `HEADLESS_OUTPUT_PATH` / `HEADLESS_MANIFEST_PATH`; non-zero exit → throw with stderr tail.
  - `webhook { url, headers? }`: multipart POST with `manifest` (JSON string) and `file` (use `fs.openAsBlob(outputPath)` so the body streams); non-2xx → throw.
  - `s3 { prefix, endpoint?, region? }` in `s3.ts` (dynamic import of `@aws-sdk/client-s3`, Body = `createReadStream`); `fetchS3ToLocal(uri, destDir, cfg)` as the optional input adapter. Tests skip unless `S3_TEST_ENDPOINT` is set.
  Tests for volume (rename + overwrite), command (marker file written by `process.execPath -e …`, sees the env vars, failing command throws), webhook (local `http.createServer` asserts the multipart body contains the manifest and the file bytes).

- [ ] **Step 3:** Commit: `feat(headless-artist): verification manifest and volume/command/webhook/s3 sinks`.

---

## Task 6: `runJob` core + CLI

**Files:** `src/run.ts`, `src/cli.ts`, `src/run.test.ts`, `src/run.chromium.test.ts`, `src/cli.chromium.test.ts`.

- [ ] **Step 1: `run.ts`.** `runJob(spec: JobSpec, deps: { bundlePath, gpu?, chromiumPath?, noSandbox?, timeoutMs?, workDir?, versions: { engineVersion, kitVersion }, log? }): Promise<RenderOutcome>` — never throws: load → render into `<workDir>/<jobId>/render.<ext>` → manifest → sink → `{ ok: true, meta, outputLocation, manifestLocation, durationMs }`; any error → `{ ok: false, error, durationMs }` with the error logged to stderr; `finally` removes the job work dir and calls `job.cleanup()`. Unit test the failure paths with the driver mocked (`vi.mock('./renderDriver')`): missing input file, invalid spec, sink failure, driver failure — all return `ok:false` with the message and clean up the work dir. Chromium test: the happy path end-to-end into a temp volume sink.

- [ ] **Step 2: `cli.ts`.** `headless-artist render --job <file|->` (also accepts `--job=<path>` and the bare path). Env: `HEADLESS_BUNDLE_PATH` (default `dist/headless.html` next to the CLI), `HEADLESS_GPU=true`, `HEADLESS_CHROMIUM_PATH`, `HEADLESS_NO_SANDBOX=true`, `HEADLESS_TIMEOUT_MS`, `HEADLESS_WORK_DIR` (default `os.tmpdir()`), `HEADLESS_LOG=json|text`. Versions come from `dist/kit.json` (written by the assembler; fallback `unknown`). Prints exactly one JSON `RenderOutcome` line to **stdout**; all logs/progress go to **stderr**. Exit codes: `0` ok, `1` job failed, `2` usage/spec error. `headless-artist --version` prints kit.json. Chromium test spawns the **built** CLI (`dist/cli.js`) with `execFile` on the fixture job and on an unrenderable job; asserts stdout JSON, exit codes, output + manifest presence, and that stderr contains progress lines.

- [ ] **Step 3:** Commit: `feat(headless-artist): runJob core and one-shot CLI`.

---

## Task 7: Packaging — kit assembler, Dockerfile, README, examples

- [ ] **Step 1: `scripts/assemble-kit.mjs`.** Runs `pnpm --filter @escapesuite/artist run build:headless`, bundles `src/cli.ts` with esbuild (`--bundle --platform=node --format=esm --packages=external --outfile=dist/cli.js`, add a `#!/usr/bin/env node` banner and chmod +x), copies `headless.html` into `dist/`, writes `dist/kit.json` `{ kitVersion, engineVersion (apps/artist version), commit (git rev-parse --short HEAD, or "unknown"), playwrightVersion (from node_modules/playwright/package.json), builtAt }`. Idempotent.
- [ ] **Step 2: `Dockerfile`** (optional reference): `FROM mcr.microsoft.com/playwright:v<playwright version>-noble` (must equal the pinned Playwright version — the assembler should assert this and fail the build if `Dockerfile` drifts), `COPY dist/ package.json`, `npm install --omit=dev --ignore-scripts`, env defaults (`HEADLESS_BUNDLE_PATH=/app/dist/headless.html`, `HEADLESS_NO_SANDBOX=true` only if running as root — prefer `USER pwuser` and no sandbox flag), `ENTRYPOINT ["node","dist/cli.js","render"]`.
- [ ] **Step 3: `examples/`** — `job-manifest-volume.json`, `job-veditor-volume.json`, `job-command.json`, `job-webhook.json`, `job-s3.json`, `manifest.json` (sample), `k8s-job.yaml` (one-shot Job, CPU and a commented GPU variant with `nvidia.com/gpu`), `broker-example.sh` (loop: for each job file, run the CLI, check exit code, move outputs).
- [ ] **Step 4: `README.md`** for the kit (this is what the customer reads): what it is; install (`npm install ./escapesuite-headless-artist-<v>.tgz`, Chromium prerequisites: Playwright-managed `npx playwright install chromium` **or** a system Chromium via `HEADLESS_CHROMIUM_PATH`, OS deps `npx playwright install-deps chromium`, exact pinned version, **air-gap notes**: pre-seed `~/.cache/ms-playwright` or use system Chromium; no network is used at render time — the driver aborts every http(s) request); job spec schema with every field; manifest format (recommended for large media) and `.veditor`; sinks and their configs; env reference; GPU (`HEADLESS_GPU=true`, container `--gpus all`, what "gpu: true" in the manifest means, why bytes differ between HW/SW); verification (`sha256sum -c`-style check against the manifest); exit codes and stdout/stderr contract; sizing guidance (measured: ~0.3× realtime 1080p software on a laptop; memory scales with resolution); troubleshooting (no H.264 encoder, sandbox errors, fonts for text overlays: install `fonts-liberation`/`fonts-noto`).
- [ ] **Step 5:** `pnpm --filter @escapesuite/headless-artist run pack:kit` → `dist/escapesuite-headless-artist-<v>.tgz`; `tar tzf` shows only `package/dist/*`, `README.md`, `Dockerfile`, `examples/*`. Commit: `build(headless-artist): kit assembler, reference Dockerfile, examples, README`.

---

## Task 8: CI, release, and repo docs

- [ ] **Step 1: `ci.yml`.** `lint-and-typecheck`: add `TypeScript check (headless-artist)` → `pnpm --filter=@escapesuite/headless-artist run typecheck`. `e2e` job: after the Playwright install steps add `Run headless-artist Chromium tests` → `pnpm --filter=@escapesuite/headless-artist run test:e2e` (the same 1.62.1 browser cache serves it). `build` job: after `pnpm build` add `Pack headless-artist kit` → `pnpm --filter=@escapesuite/headless-artist run pack:kit` and upload `services/headless-artist/dist/*.tgz` as artifact `headless-artist-kit` (retention 30 days). Check the `Report bundle sizes` step still works with the new package present.
- [ ] **Step 2: `standalone-release.yml`.** In `prepare`, also download `headless-artist-kit` (`continue-on-error: false`), copy it to `dist/kit/escapesuite-headless-artist-${VERSION}.tgz`, expose its size; in `release`, attach it to `gh release create`; mention it in the PR comment table and the release notes ("Headless render kit: render projects on a server — see the README inside").
- [ ] **Step 3: Docs.** Root `CLAUDE.md`: add the service to the app table and a short "Headless render service" section (build, test scripts, the `*.chromium.test.ts` convention, kit). Root `README.md`: a "Render on a server (headless kit)" section with a 5-line quick start and a link to the kit README. `apps/artist/CLAUDE.md`: update the headless section for `__renderProjectToFile` and the file input.
- [ ] **Step 4:** Commit: `ci: typecheck, Chromium tests, and release kit for headless-artist`.

---

## Task 9: Whole-branch verification (done by the orchestrator, not a subagent)

- `pnpm lint`, per-package `tsc --noEmit` (plan, craft, artist, headless-artist), `pnpm test:coverage`, `pnpm build`, `pnpm --filter @escapesuite/headless-artist run test:e2e`, `cd apps/e2e && npx playwright test tests/headless --project=chromium`.
- Kit smoke test as the customer would run it: `pack:kit`, `npm install` the tarball into a temp dir, run `node_modules/.bin/headless-artist render --job job.json` against (a) the fixture manifest, (b) the 2026‑09‑07 stress composition (5 tracks, 1080p, two audio sources) as a manifest job with `HEADLESS_CHROMIUM_PATH` pointing at the Playwright Chromium binary, (c) the same via a `.veditor` produced from it. Verify outputs with ffprobe and `sha256` against the manifests.
- Open the PR with the verification table; CI green; merge.

## Done criteria

- `pack:kit` yields a tarball with `dist/cli.js`, `dist/headless.html`, `dist/kit.json`, README, Dockerfile, examples; the tarball is attached to every `main` release.
- `headless-artist render --job <spec>` renders a manifest or `.veditor` job to the configured sink with a verification manifest and exits 0; bad input exits 2, a failed render exits 1, each with one clear error. No base64 in the pipeline; sources and outputs stream through Chromium (`setInputFiles` / download).
- Chromium is a documented host prerequisite (`HEADLESS_CHROMIUM_PATH` or Playwright-managed), GPU via `HEADLESS_GPU`, no network at render time.
- Unit tests run in the CI `test` job without a browser; Chromium tests run in the CI `e2e` job; typecheck + lint clean.

**Deferred:** HTTP service mode (reuses `runJob`), the hosted "Render on server" UI, perceptual golden-frame comparison (the manifest's sha256 + ffprobe checks cover verification for now).
