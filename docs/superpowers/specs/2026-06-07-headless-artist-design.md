# Headless ARTIST — Server-Side Render Service — Design

Status: **Draft v2 (for review)** · Date: 2026-06-07 · Owner: Bonham Technologies

> v2 changes (post-review): input is now the customer's plug too — we provide a
> transport-agnostic **local interface** ("the female end"); S3 and other transports
> are optional reference adapters, not a dependency. Added an embedded, offline,
> fail-closed **license gate** (genuine-software enforcement). Reinforced output
> **verifiability** (golden tests both formats + a verification manifest).

## 1. Problem & goals

A Site-License customer wants to host ESCAPEARTIST on their own secure/air-gapped
network and let their users **kick off a server-side render** instead of rendering
in the browser. The flow is fully decoupled: a user hands off their project + source
media, a server process renders the video, and the finished file is delivered to a
location the user retrieves later. The user holds no live connection.

The customer attempted this against the **minified** client bundle and hit a wall (the
editor's render path is browser-API-based and can't simply run in Node). Because we own
the source, we wrap the **real** render engine and ship it as a deployable service.

**Goals**
- Render ARTIST projects **server-side** using the **same engine** as the in-browser
  editor (not a reimplementation): frame-for-frame identical compositing; output is
  standard H.264/VP9 — byte-exact in software verification mode, perceptually identical
  with GPU acceleration (see §10).
- **Engine parity / no fork:** headless imports the *identical* `apps/artist` engine
  source, so features and improvements added to base ARTIST flow into headless
  automatically — headless is a thin adapter, never a divergent copy.
- Ship as a **runtime-agnostic code kit** (Node runner + the built ARTIST bundle + docs),
  air-gap friendly, with an **optional reference Dockerfile**. Headless Chromium is a
  documented **host prerequisite** either way. **GPU acceleration** is used when the host
  provides it (this customer has GPUs).
- Be **stateless** and **transport-agnostic**: we provide a clean local interface (the
  "female end") that the customer plugs their orchestration and transport into.
- Deliver output through a **pluggable sink** (default a local/mounted volume).
- Enforce a **genuine-software license check** at runtime (offline, fail-closed).
- Support both project hand-off packagings and all of ARTIST's media formats, with
  **verifiable** output.

**Non-goals**
- We do **not** provide or operate a job queue, scheduler, broker, or job database.
- We do **not** own resource **transport/handoff** — fetching inputs or pushing outputs
  across the network is the customer's plug. (We ship optional reference adapters, e.g.
  S3, but the core boundary is local files.)
- We do **not** reimplement the render/encode pipeline in Node/ffmpeg.
- The "Render on server" button inside the hosted ARTIST UI is an **optional companion**
  (Section 14), not part of this core spec.

## 2. Background: ARTIST's render architecture (relevant facts)

The export pipeline is already effectively a **pure function** and was built with
off-thread/background rendering in mind:

- Public entry points (`apps/artist/src/core/exporter.ts` → `exportMP4.ts` /
  `exportWebM.ts`):
  `exportToMP4(clips, sourceVideos, options, onProgress?, tracks?, watermark?, signal?, projectResolution?) → Promise<Blob>`
  (and `exportToWebM(...)`). No React, no component refs, no global store reads.
- Compositing (`core/canvasRenderer.ts`) is pure Canvas 2D over `(ctx, data)`; never
  reads the DOM/React tree.
- Audio (`core/audioMixer.ts`, `workers/exportWorker.ts`) uses `OfflineAudioContext`.
- Source decode: MP4 → `WebCodecs VideoDecoder` + `mp4box` (`workers/decodeWorker.ts`);
  WebM → `HTMLVideoElement` seeking fallback (`core/frameSource.ts`).
- Encode/mux: `WebCodecs VideoEncoder`/`AudioEncoder` + `mediabunny` (pure-JS muxer).
- **The single browser-storage coupling in the export path:** sources are read via
  `getVideoBlob(sourceId)` from IndexedDB (`packages/shared/src/storage`,
  `video-editor-db`).
- Project model (`store/types.ts`): `Project { id, name, resolution, timeline{ tracks,
  clips, textOverlays, shapeOverlays, duration } }`; each `Clip.sourceVideoId` references
  a source. The `.veditor` file (`core/projectManager.ts`) is `{ version, project,
  videos: [{ id, name, mimeType, data /*base64*/, thumbnail? }] }`.
- Standalone build (`build:standalone`, `vite-plugin-singlefile`) already produces a
  single self-contained HTML file with workers inlined.
- **Existing licensing** (`packages/shared/src/auth/license.ts`): offline **Ed25519**
  signature verification of a signed license against an embedded public key, **fail-closed
  in production** (audit H4). Licenses are signed by `LICENSE_PRIVATE_KEY` (server secret);
  the public key (`LICENSE_PUBLIC_KEY`) is baked into builds; the air-gapped standalone
  apps already validate licenses entirely offline. We reuse this exact scheme.

**Implication:** every browser API the export path needs exists in **headless Chromium**,
so the engine runs as-is there. The only adaptations are feeding sources in (instead of
the editor populating IndexedDB) and getting bytes out (instead of a browser download).

## 3. Requirements

**Functional**
- F1. Accept a render job describing: input location(s) (local), render options
  (format, quality, resolution), and output sink config.
- F2. Render using the real ARTIST engine in headless Chromium → encoded video bytes.
- F3. Read input from the **local filesystem** (mounted by the customer): either a
  `.veditor` bundle file **or** a manifest + raw source files in a directory. Fetching
  those from S3/other transports is the customer's plug; we ship an **optional** S3
  reference adapter that fetches-to-local.
- F4. Support sources: MP4 (H.264) and WebM (VP9), images (PNG/JPEG), and audio; output
  MP4 (H.264/AAC) and WebM (VP9/Opus) — all first-class.
- F5. Deliver output via a pluggable sink: `volume`/local (default) | `s3` | `webhook` |
  `command` — again, network transports are optional reference adapters.
- F6. Run as a **one-shot** container (render one job, exit) and, optionally, as a
  long-running HTTP service.
- F7. Be **idempotent** by job id (safe for broker retries).
- F8. **Verify a genuine license at runtime** before rendering — offline, fail-closed.
- F9. Emit a **verification manifest** alongside output (hashes, duration, dimensions,
  codec, engine + Chromium versions) so the result is independently verifiable.

**Non-functional**
- N1. Air-gap friendly: no outbound network required; optional adapters are the only
  network users and are customer-configured.
- N2. Stateless & transport-agnostic: no queue/job-store and no transport owned by us;
  the customer's broker owns scheduling/durability/retries and resource handoff.
- N3. Reproducible output: pinned Chromium; **GPU-accelerated encode/decode when the host
  provides it** (this customer has GPUs), with a software fallback and a software
  "verification mode" for byte-deterministic golden tests.
- N4. Secure: non-root, least privilege; sink `command` opt-in and sandboxed; license
  fail-closed.
- N5. Observable: structured per-job logs, progress, clear exit codes / status.
- N6. Self-hostable: primary deliverable is a **code kit** (npm tarball: runner/CLI + built
  bundle + docs) that drops into the customer's own runtime; an **optional reference
  Dockerfile** is provided for turnkey use and as the canonical environment spec. Headless
  Chromium (pinned version) is a documented host prerequisite. Env-configured, shipped with
  the air-gap Site License, versioned to the ARTIST engine.

## 4. Architecture overview

```
customer broker + transport (THEIRS) ── fetch/mount resources ──▶ local input dir (mounted)
        │                                                              │
        └──(spawn job: spec → local paths)──┐                         │
                                            ▼                         │
                  ┌────────────────────────────────────────────────────────┐
                  │  headless-artist kit: Node + headless Chromium            │
                  │  (STATELESS, license-gated; container optional)           │
                  │  one-shot CLI  (or optional HTTP service)                 │
                  │                                                          │
                  │  License gate ──(fail-closed Ed25519)── proceed/abort    │
                  │  Input Loader ─▶ {project, sources(bytes)}  (local files) │
                  │        ▼                                                  │
                  │  Render Runner ─▶ headless Chromium (Playwright)          │
                  │        loads the headless ARTIST bundle                   │
                  │        renderProject(project, sources, opts)             │
                  │        (real exportToMP4 / exportToWebM)                  │
                  │        ▼                                                  │
                  │  Output Sink ─▶ local output dir (default) + manifest     │
                  └────────────────────────────────────────────────────────┘
                                            │
              customer broker + transport (THEIRS) ── push output ──▶ wherever the user retrieves
```

We provide everything inside the box. The customer provides the broker, the resource
handoff, and the transport on both ends (with our optional S3/webhook/command adapters
as conveniences). The container is a pure function: **local in → render → local out → exit.**

Three independently testable units: **(A)** headless render bundle, **(B)** render
runner, **(C)** adapters (input loaders / output sinks) + the **license gate**.

## 5. Component A — Headless render bundle

A new build target in `apps/artist` (e.g. `headless.html` + `src/headless/main.ts`),
built single-file via the existing `vite-plugin-singlefile` setup (workers inlined), with
**no editor UI**. It exposes one entry the runner calls (Playwright `exposeBinding` /
`page.evaluate`):

```ts
renderProject(input: {
  project: Project,
  sources: Array<{ id: string, mimeType: string, bytes: ArrayBuffer }>,
  options: ExportOptions,
  watermark?: WatermarkConfig,
}, onProgress?: (p: number) => void): Promise<{ bytes: ArrayBuffer, meta: RenderMeta }>
```

It imports the export engine **verbatim** (`exportToMP4`/`exportToWebM`, `canvasRenderer`,
`audioMixer`, `decodeWorker`).

**Engine parity (no fork).** The bundle is a thin entry over the *same* engine modules the
editor uses — imported directly from `apps/artist/src`, never copied. The only
headless-specific code is this entry (source injection + bytes out). As base ARTIST gains
overlays/transitions/effects/codecs, headless inherits them automatically on the next
build; the golden-render tests (§13) flag any accidental divergence. The source seam below,
if ever needed, is shared by both editor and headless — not a headless-only fork.

**Source injection (the one adaptation).** The export path reads sources via
`getVideoBlob(sourceId)` (IndexedDB). To avoid touching the engine, the bundle **seeds
`video-editor-db` with the injected source blobs** (via the existing shared storage API)
before calling `exportTo*`, so `getVideoBlob` resolves unchanged — engine untouched.
(Fallback if seeding large media is slow: a small pluggable source-resolver behind the
same interface.)

Boundary: given `{project, sources, options}`, returns bytes + metadata — no knowledge of
S3, jobs, licensing, or the filesystem. Testable directly in headless Chromium.

## 6. Component B — Render runner (Node)

Runs inside the container; orchestrates one render. Two modes, same core:

- **One-shot CLI (primary):** `headless-artist render --job <file|->` — reads a job spec
  (local paths), renders, delivers to the sink, exits `0`/non-zero. Ideal for
  broker-spawned container-per-job (k8s Job, ECS task, Nomad batch, custom consumer). No
  pool, no persistence — a pure function.
- **HTTP service (optional):** long-running `POST /render` (+ `GET /healthz`) for brokers
  that prefer an endpoint; adds a small bounded Chromium pool. Same render core/adapters.

Flow: **run the license gate (abort if invalid)** → parse/validate job → Input Loader →
launch/reuse a headless Chromium page with bundle A (Playwright, pinned browser) →
`renderProject` + progress → bytes → Output Sink (+ verification manifest) → structured
status + exit code. Per-job timeout, Chromium crash/OOM handling, temp cleanup here.

## 7. Component C — Adapters + license gate

**License gate** — runs before any render. Reuses `packages/shared` Ed25519 verification:
the container embeds the public key; the operator supplies the signed license
(`LICENSE_KEY` via env/file, from their team/org/enterprise bundle). The gate verifies the
signature **offline**, checks product/tier covers server render and is **not expired**, and
**fails closed** (refuses to render, non-zero exit) on any missing/invalid/unverifiable
license. See Section 11.

**Input Loaders** (produce `{ project, sources }` from **local** files):
- `bundle`: a local `.veditor` file → decode base64 sources.
- `manifest`: a local manifest JSON (project + source filenames) + raw source files in a
  dir → read each.
Both normalize to the same in-memory shape bundle A consumes.

**Input Source adapters** (optional, fetch-to-local before the loader runs):
- `s3` (reference adapter for today's customer), and the pattern for others. Off by
  default — the canonical interface is local files the customer mounts.

**Output Sinks** (`deliver(jobId, bytes, meta, manifest)`):
- `volume`/local (default): write `<jobId>.<ext>` + `<jobId>.manifest.json` to a mounted dir.
- `s3` | `webhook` | `command` (opt-in, sandboxed: argument-array exec, no shell, least
  privilege) — optional reference adapters.

Adapters and the gate are config-selected; new transports are added without touching A/B.

## 8. Job spec

Passed via CLI flag/stdin or HTTP body; references **local paths** by default:

```jsonc
{
  "jobId": "string",                       // idempotency key
  "input": {                               // exactly one of:
    "bundle": { "path": "/in/proj.veditor" },
    "manifest": { "path": "/in/manifest.json" }   // manifest lists project + source files in /in
  },
  "options": { "format": "mp4", "quality": "high", "resolution": { "width": 1920, "height": 1080 } },
  "watermark": null,
  "output": { "sink": "volume", "config": { "dir": "/out" } }
}
```

If a customer opts into a reference adapter, `input` may instead name an `s3` source and
`output.sink` an `s3`/`webhook`/`command` target — but the default, and the contract we
guarantee, is local in / local out. Credentials for optional adapters come from container
env, never the job.

## 9. Data flow / job lifecycle

1. User triggers a server render; the customer's tooling packages the project + sources
   and (via their broker/transport) places them where the container can read them locally
   (mounted dir), or uses an optional input adapter.
2. The broker spawns/calls our container with the job spec (local paths).
3. **License gate** verifies a genuine license — abort (non-zero) if invalid.
4. Input Loader reads project + source bytes from local files.
5. Runner loads bundle A in headless Chromium → `renderProject` → bytes + meta.
6. Output Sink writes the result + **verification manifest** to the local output dir (or
   an optional adapter target).
7. Container exits `0` (or HTTP returns success). The customer's transport moves the
   output to where the user retrieves it. Failure → non-zero / error; broker retries
   (idempotent by `jobId`).

## 10. Formats & verifiability

- Sources: MP4 (H.264, WebCodecs path); WebM (VP9, `HTMLVideoElement` seek path); PNG/JPEG
  images; audio. Output: MP4 (H.264/AAC) and WebM (VP9/Opus).
- The WebM source path (flakier headless) gets explicit hardening + a golden test so it is
  genuinely first-class.
- **Verifiability:** every render emits a manifest (SHA-256 of output, duration, width/
  height, codec/container, frame count, engine + Chromium versions, GPU-vs-software encode,
  job id). Golden-render regression tests cover **both** MP4 and WebM so output is provably
  correct and stable across engine/Chromium bumps.
- **GPU vs determinism:** when host GPUs are present, hardware encode/decode is used for
  speed. Hardware and software encoders emit slightly different *bytes* (as they already do
  across users' machines today), so production verification is **perceptual** (hash of
  decoded frames within tolerance), while a pinned **software "verification mode"** gives
  byte-exact golden regression in CI. The compositing — the frames themselves — is identical
  either way; it's the same engine.

## 11. Licensing / genuine-software enforcement

Goal: even if the image is exfiltrated, it should not render without a genuine license.

- **Mechanism (identical to the main ARTIST deployment — reuse, not new):** the same
  offline **Ed25519** scheme the shipped ARTIST builds already use — same `packages/shared`
  licensing code, same embedded `LICENSE_PUBLIC_KEY`, same signed `LICENSE_KEY` (issued with
  their team/org/enterprise purchase). Embedding it the same way keeps headless in lockstep
  with base ARTIST's licensing. The license gate verifies the signature against the
  embedded public key, checks product/tier entitlement for server render and expiry, and
  **fails closed** — no valid, unexpired, signature-verified license ⇒ no render, non-zero
  exit, clear message. Fully offline (air-gap safe).
- **Checks at:** startup, and (cheaply) per job, so a long-running HTTP instance can't
  outlive license expiry.
- **Honest limits:** client/JS code can't be made fully tamper-proof. This raises the bar
  substantially (a thief can't run it without a key they can't forge) and matches the
  product's existing posture; we do not claim unbreakable DRM. Optional hardening to weigh
  during planning: bind license to org id, add a build/integrity hash to the manifest.

## 12. Error handling, security, packaging

**Resilience:** per-job timeout → non-zero exit so the broker retries; Chromium crash/OOM
→ fail the job cleanly (one-shot exits; HTTP recycles the page); corrupt/missing media →
fail fast with a clear error; idempotent by `jobId`; temp files/pages disposed each job.

**Security (air-gap):** runs **non-root**, read-only FS except temp + the output dir; **no
outbound network required** (inputs are local; Chromium launched with networking
restricted); optional adapters are the only network users and are customer-configured with
scoped creds via env/secrets; the `command` sink is opt-in, argument-array exec (no shell),
resource-limited; license fail-closed.

**Packaging (kit-first, container optional).** Primary deliverable = a **code kit** (npm
tarball / `npm pack` for offline install): the Node runner/CLI + license gate + adapters +
the built ARTIST bundle + embedded license public key + docs. It drops into the customer's
own runtime. **Headless Chromium is a host prerequisite** — the kit either points at a
**system/provided Chromium** (`executablePath`, recommended for air-gap) or uses a
**Playwright-managed pinned Chromium** (documented version; air-gap needs a browser mirror
or pre-seeded cache). The docs list the required **OS deps** (libnss, fonts, …) and the
pinned Chromium version. We also ship an **optional reference `Dockerfile`** (turnkey +
canonical environment spec) and compose / k8s-Job samples (CPU and GPU). **GPU:** when the
host exposes a GPU (e.g. NVIDIA runtime / `--gpus all`, or a host GPU on bare metal),
hardware encode/decode is used; software fallback otherwise. Config via env (mode,
concurrency, timeouts, Chromium path, input loader, optional input adapter, output sink +
config, license key, GPU on/off, log level). Shipped with the air-gap **Site License**,
**versioned to the ARTIST engine**.

## 13. Testing strategy

- **Unit:** Input Loaders + Output Sinks (local fs / mock adapter); license gate
  (valid / expired / tampered / missing → correct fail-closed); job-spec validation; runner
  control flow + exit codes.
- **Integration:** bundle A rendering a fixed fixture in **real headless Chromium**
  (Playwright — reuses the e2e harness) → valid MP4 **and** WebM with expected
  duration/resolution + perceptual-hash vs golden; manifest contents correct.
- **End-to-end:** full one-shot job from local input dir → output file + manifest present
  and correct; failure + retry path; license-denied path.
- **Determinism/verifiability:** golden-render regression in CI for both formats; explicit
  WebM-source case; manifest hash stability.

## 14. Scope & decomposition

**This spec (core):** license gate, bundle A, runner B (CLI + optional HTTP), adapters C
(local loaders + optional reference adapters), job-spec schema, verification manifest,
container image, tests, docs.

**Optional companion (separate spec/PR, possibly the customer's own integration):** a
"Render on server" action in the hosted ARTIST UI that packages + hands off the current
project. Kept out of core (YAGNI).

## 15. Repo / code changes

- `apps/artist`: new headless entry (`headless.html` + `src/headless/*`) and a
  `build:headless` script; the source-injection seam (seed IndexedDB, or a guarded
  source-resolver) — the editor path unchanged.
- New service location: `services/headless-artist/` (Node runner/CLI + license gate +
  adapters; publishable as an npm tarball kit) + an **optional reference `Dockerfile`** and
  CPU/GPU samples. Add the `services/*` glob to `pnpm-workspace.yaml`. Reuses
  `packages/shared` (licensing, types) where sensible. The runner accepts a configurable
  Chromium `executablePath` so customers can point at their own browser.
- Docs: deployment guide, config reference, security/licensing notes, broker-integration
  example.

## 16. Risks & open questions

- **WebM source decode headless:** `HTMLVideoElement` seek timing can be flaky for long
  clips; mitigated by hardening + golden tests; transcode-on-ingest fallback if it proves
  unreliable (out of scope unless needed).
- **Large-media source injection into the page:** seeding IndexedDB with very large blobs
  may be slow; the source-resolver fallback (Section 5) addresses it if measured to matter.
- **Chromium provisioning (kit, air-gap):** since we ship a kit (not a baked image by
  default), the host must supply a compatible **pinned headless Chromium** + its OS deps.
  Air-gap means no Playwright auto-download — mitigate by supporting a system Chromium
  (`executablePath`), documenting the exact version + `install-deps` list, and providing the
  reference Dockerfile as the canonical environment. Version drift is caught by the manifest
  (records Chromium version) + golden tests.
- **Memory/CPU/GPU per render:** high-res/long timelines are heavy; host GPUs accelerate
  encode/decode substantially. The broker controls concurrency by how many containers it
  runs (one-shot) — document host + GPU sizing guidance.
- **GPU encode availability/determinism:** Chromium's WebCodecs HW path depends on the
  host GPU + drivers in-container (NVIDIA runtime). Confirm the GPU/driver stack during
  planning; HW output isn't byte-identical to SW (handled by perceptual verification + the
  SW verification mode, §10).
- **License key provisioning:** confirm how the per-deployment `LICENSE_KEY` is issued and
  delivered with the team/org/enterprise bundle (same path as main ARTIST), and whether to
  bind it to org id.
- **Optional adapters:** S3 is the only reference adapter needed for today's customer;
  others are additive and out of scope until a customer needs them.

## 17. Out of scope / future

- Distributed render farm / autoscaling (the customer's broker's concern).
- Resource transport/handoff in and out (the customer's plug).
- Real-time/preview rendering on the server.
- The hosted-ARTIST "Render on server" UI (companion spec).
