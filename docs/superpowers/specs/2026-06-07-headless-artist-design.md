# Headless ARTIST — Server-Side Render Service — Design

Status: **Draft for review** · Date: 2026-06-07 · Owner: Bonham Technologies

## 1. Problem & goals

A Site-License customer wants to host ESCAPEARTIST on their own secure/air-gapped
network and let their users **kick off a server-side render** instead of rendering
in the browser. The flow they want is fully decoupled: a user hands off their
project + source media, the resources land in object storage (S3-compatible), a
server process spins up, renders the video, and a customer-defined step pushes the
finished file to an output location the user retrieves later. The user holds no
live connection — they can leave for the day and collect the result when it's done.

The customer attempted this themselves against the **minified** client bundle and
hit a wall (the editor's render path is browser-API-based and can't simply run in
Node). Because we own the source, we can wrap the **real** render engine cleanly
and ship it as a deployable service.

**Goals**
- Render ARTIST projects **server-side**, producing output **pixel-identical** to the
  in-browser editor (same engine, not a reimplementation).
- Run inside the customer's secure network as a **container**, air-gap friendly.
- Be **stateless** and plug into **their** broker/orchestrator — we manage no
  ingestion or queueing infrastructure.
- Deliver output through a **pluggable sink** (default a mounted volume; also S3,
  webhook, or a customer command).
- Support both project hand-off formats and all of ARTIST's media formats.

**Non-goals**
- We do **not** provide or operate a job queue, scheduler, broker, or job database.
- We do **not** reimplement the render/encode pipeline in Node/ffmpeg.
- The "Render on server" button inside the hosted ARTIST UI is an **optional
  companion** (Section 13), not part of this core spec.

## 2. Background: ARTIST's render architecture (relevant facts)

The export pipeline is already effectively a **pure function** and was built with
off-thread/background rendering in mind:

- Public entry points (`apps/artist/src/core/exporter.ts` → `exportMP4.ts` /
  `exportWebM.ts`):
  `exportToMP4(clips, sourceVideos, options, onProgress?, tracks?, watermark?, signal?, projectResolution?) → Promise<Blob>`
  (and `exportToWebM(...)`). No React, no component refs, no global store reads —
  all inputs are plain data arguments.
- Compositing (`core/canvasRenderer.ts`) is pure Canvas 2D over `(ctx, data)`; it
  never reads the DOM/React tree.
- Audio (`core/audioMixer.ts`, `workers/exportWorker.ts`) uses `OfflineAudioContext`
  (non-realtime; works in workers/headless).
- Source decode: MP4 → `WebCodecs VideoDecoder` + `mp4box` in `workers/decodeWorker.ts`
  (the clean path); WebM → `HTMLVideoElement` seeking fallback (`core/frameSource.ts`).
- Encode/mux: `WebCodecs VideoEncoder`/`AudioEncoder` + `mediabunny` (pure JS muxer).
- **The single browser-storage coupling in the export path:** sources are read via
  `getVideoBlob(sourceId)` from IndexedDB (`video-editor-db`,
  `packages/shared/src/storage`).
- Project model (`store/types.ts`): `Project { id, name, resolution, timeline{ tracks,
  clips, textOverlays, shapeOverlays, duration } }`; each `Clip.sourceVideoId`
  references a source by id. The `.veditor` file (`core/projectManager.ts`) is
  `{ version, project, videos: [{ id, name, mimeType, data /*base64*/, thumbnail? }] }`.
- Integration (`utils/integration.ts`): `LOAD_PROJECT` / `?project=base64` /
  `?video=url` exist; the inbound `EXPORT` postMessage handler is **declared but not
  implemented**, and `EXPORT_COMPLETE` (returning bytes) is documented but never sent.
- The standalone build (`build:standalone`, `vite-plugin-singlefile`) already
  produces a single self-contained HTML file with workers inlined.

**Implication:** every browser API the export path needs (WebCodecs, Canvas 2D,
OffscreenCanvas, OfflineAudioContext, IndexedDB, Web Workers, `HTMLVideoElement`)
exists in **headless Chromium**. So the engine runs as-is inside headless Chromium;
the only adaptation is feeding sources in (instead of IndexedDB being populated by
the editor) and getting bytes out (instead of a browser download).

## 3. Requirements

**Functional**
- F1. Accept a render job describing: input (project + sources), render options
  (format, quality, resolution), and output sink config.
- F2. Render using the real ARTIST engine in headless Chromium → encoded video bytes.
- F3. Accept input as **either** a `.veditor` bundle **or** a manifest + raw source
  objects in S3.
- F4. Support sources: MP4 (H.264) and WebM (VP9), images (PNG/JPEG), and audio;
  output MP4 (H.264/AAC) and WebM (VP9/Opus) — all first-class.
- F5. Deliver output via a pluggable sink: `volume` (default) | `s3` | `webhook` |
  `command`.
- F6. Run as a **one-shot** container (render one job, exit) and, optionally, as a
  long-running HTTP service.
- F7. Be **idempotent** by job id (safe for broker retries).

**Non-functional**
- N1. Air-gap friendly: no outbound network except the configured object store/sink.
- N2. Stateless: no queue/job-store owned by us; the customer's broker owns
  scheduling, durability, and retries.
- N3. Deterministic output: pinned Chromium; software encoding by default.
- N4. Secure: non-root, least privilege, sink `command` opt-in and sandboxed.
- N5. Observable: structured per-job logs, progress, clear exit codes / status.
- N6. Self-hostable: single `docker load`-able image, env-configured, shipped as
  part of the air-gap Site License and versioned to the ARTIST engine.

## 4. Architecture overview

```
hosted ARTIST UI / their tooling ──upload project+sources──▶ Input object store (S3)
        │                                                          │
        └──(their broker schedules a job: spec → S3 refs)──┐       │
                                                           ▼       │
                              ┌──────────────────────────────────────────────┐
                              │  headless-artist container (STATELESS)         │
                              │  one-shot CLI  (or optional HTTP service)      │
                              │                                                │
                              │  Input Loader ─▶ {project, sources(bytes)}     │
                              │        │                                       │
                              │        ▼                                       │
                              │  Render Runner ─▶ headless Chromium (Playwright)│
                              │        loads the headless ARTIST bundle        │
                              │        renderProject(project, sources, opts)   │
                              │        (real exportToMP4 / exportToWebM)       │
                              │        ▼                                       │
                              │  Output Sink ─▶ Output S3 / volume / webhook / │
                              │                  customer command              │
                              └──────────────────────────────────────────────┘
                                                           │
                                          Output object store (S3) ──▶ user retrieves later
```

Three independently testable units:
1. **Headless render bundle** (browser-side) — the engine, verbatim, with sources injected.
2. **Render runner** (Node) — drives headless Chromium; CLI one-shot + optional HTTP.
3. **Adapters** — Input Loaders (bundle / manifest) and Output Sinks.

The customer's broker is the producer and owns the job lifecycle; our container is a
pure function: **job in → render → deliver → exit**.

## 5. Component A — Headless render bundle

A new build target in `apps/artist` (e.g. `headless.html` + `src/headless/main.ts`),
built single-file via the existing `vite-plugin-singlefile` setup (workers inlined),
with **no editor UI** mounted. It exposes one async entry the runner can call (via
Playwright `exposeBinding`/`page.evaluate`):

```ts
renderProject(input: {
  project: Project,
  sources: Array<{ id: string, mimeType: string, bytes: ArrayBuffer }>,
  options: ExportOptions,          // format, quality, resolution, etc.
  watermark?: WatermarkConfig,
}, onProgress?: (p: number) => void): Promise<{ bytes: ArrayBuffer, meta: RenderMeta }>
```

It imports the export engine **verbatim** (`exportToMP4`/`exportToWebM`,
`canvasRenderer`, `audioMixer`, `decodeWorker`).

**Source injection (the one adaptation).** The export path reads sources via
`getVideoBlob(sourceId)` (IndexedDB). To avoid touching the engine, the bundle
**seeds `video-editor-db` with the injected source blobs** (via the existing shared
storage API) before calling `exportTo*`, so `getVideoBlob` resolves unchanged. This
keeps the engine 100% untouched. (Fallback if seeding large media proves slow: add a
small pluggable source-resolver in the storage layer and pass the registry in — a
contained change behind the same interface.)

**Output.** `exportTo*` already returns a `Blob`; the bundle returns its bytes +
metadata (duration, width/height, codec, byteLength) to the runner.

Boundary check: given `{project, sources, options}`, produces bytes — no knowledge of
S3, jobs, or the file system. Testable directly in headless Chromium.

## 6. Component B — Render runner (Node)

Runs inside the container; orchestrates one render. Two modes, same core:

- **One-shot CLI (primary):** `headless-artist render --job <file|-> ` — reads a job
  spec, renders, delivers to the sink, exits `0` (success) / non-zero (failure). Ideal
  for broker-spawned container-per-job (k8s Job, ECS task, Nomad batch, or a custom
  consumer). No pool, no persistence — a pure function.
- **HTTP service (optional):** long-running `POST /render` (+ `GET /healthz`) for
  brokers that prefer calling an endpoint; adds a small bounded Chromium pool for
  concurrency. Same render core and adapters.

Responsibilities: parse/validate the job spec → invoke the Input Loader → launch (or
reuse) a headless Chromium page with bundle A (Playwright, pinned browser) → call
`renderProject` and stream progress → receive bytes → invoke the Output Sink → emit
structured status + exit code. Per-job timeout, Chromium crash/OOM detection, and temp
cleanup live here.

## 7. Component C — Adapters

**Input Loaders** (produce `{ project, sources }` in memory):
- `bundle`: a `.veditor` object → decode base64 sources.
- `manifest`: a small JSON (project + list of source object keys) → fetch each raw
  source object from S3.
Both normalize to the same in-memory shape bundle A consumes.

**Output Sinks** (`deliver(jobId, bytes, meta) → void`):
- `volume` (default): write `<jobId>.<ext>` + `<jobId>.json` sidecar to a mounted dir.
- `s3`: put object(s) to a configured output bucket/prefix.
- `webhook`: POST the result (or a signed URL) + metadata to a configured endpoint.
- `command` (opt-in): exec a customer command with the output path/metadata as args
  (no shell interpolation of untrusted input; least privilege; documented as arbitrary
  execution).

Adapters are config-selected; new ones can be added without touching A or B.

## 8. Job spec

Passed via CLI flag/stdin or HTTP body. Illustrative shape:

```jsonc
{
  "jobId": "string",                     // idempotency key
  "input": {                             // exactly one of:
    "bundle": { "s3": "s3://in/proj.veditor" },
    "manifest": {
      "project": { "s3": "s3://in/project.json" },
      "sources": [ { "id": "uuid", "mimeType": "video/mp4", "s3": "s3://in/uuid.mp4" } ]
    }
  },
  "options": { "format": "mp4", "quality": "high", "resolution": { "width": 1920, "height": 1080 } },
  "watermark": null,
  "output": { "sink": "s3", "config": { "bucket": "out", "prefix": "renders/" } }
}
```

The spec references object-store locations rather than embedding bytes, so large media
never transits the broker. S3 endpoint/credentials come from container env, not the job.

## 9. Data flow / job lifecycle

1. User triggers a server render; their tooling uploads the project + sources to the
   input store (as a `.veditor` bundle or manifest + raw objects).
2. Their broker schedules a job, handing our container the job spec (CLI arg/stdin or
   HTTP).
3. Input Loader fetches project + source bytes from S3.
4. Runner loads bundle A in headless Chromium, calls `renderProject` → bytes + meta.
5. Output Sink delivers bytes (+ sidecar metadata) to the configured destination
   (e.g., output S3).
6. Container exits `0` (or the HTTP call returns success). The result waits in the
   output store for the user to retrieve. On failure: non-zero exit / error response;
   the broker retries (idempotent by `jobId`).

## 10. Formats

- Sources: MP4 (H.264) via the WebCodecs path; WebM (VP9) via the `HTMLVideoElement`
  seek path; PNG/JPEG images; audio tracks.
- Output: MP4 (H.264/AAC) and WebM (VP9/Opus).
- The WebM source path is the flakier one headless (seek timing); it gets explicit
  hardening + a golden test so it is genuinely first-class, not merely present.

## 11. Determinism & fidelity

Output is produced by the same engine the editor uses → fidelity by construction. The
image **pins the exact Chromium version** (codec/encoder behavior fixed); software
encoding by default (no GPU dependency in their environment), optional GPU accel if the
host provides it. A **golden-render regression test** (fixed project → perceptual /
byte hash compare) runs in CI to catch drift across engine or Chromium bumps.

## 12. Error handling, security, packaging

**Resilience:** per-job timeout (configurable) → non-zero exit so the broker retries;
Chromium crash/OOM → fail the job cleanly (one-shot exits; HTTP mode recycles the
page); corrupt/missing media → fail fast with a clear error in status; idempotent by
`jobId`; temp files/pages disposed every job.

**Security (air-gap):** runs **non-root**, read-only FS except temp + output; **no
outbound network** except the configured object store / sink endpoint (sources are
injected locally, so Chromium needs no internet — launch with networking restricted);
S3 creds via env/secrets, scoped input-read / output-write; the `command` sink is
opt-in, least-privilege, argument-array exec (no shell), resource-limited.

**Packaging:** one `docker load`-able image = Node runner + pinned headless Chromium
(Playwright's) + bundle A baked in. Config via env (mode, concurrency, timeouts, input
loader, output sink + config, S3 endpoint/creds, log level). Shipped as part of the
air-gap **Site License** deliverable, **versioned to the ARTIST engine** so server
output matches the editor version the customer runs. Includes a compose/k8s-Job sample
+ deployment/config/security docs.

## 13. Scope & decomposition

**This spec (core):** bundle A, runner B (CLI + optional HTTP), adapters C, job-spec
schema, container image, tests, docs.

**Optional companion (separate spec/PR, possibly the customer's own integration):** a
"Render on server" action in the hosted ARTIST UI that packages the current project +
sources, uploads them, and submits a job. Since the customer hosts ARTIST and runs
their own broker, this may be their integration calling our entry point; we provide the
contract + a reference example. Kept out of core to stay focused (YAGNI).

## 14. Testing strategy

- **Unit:** Input Loaders + Output Sinks (mock S3 / filesystem); job-spec
  validation; runner control flow + exit codes.
- **Integration:** bundle A rendering a fixed fixture project in **real headless
  Chromium** (Playwright — reuses the e2e harness) → assert a valid MP4/WebM with
  expected duration/resolution and a perceptual-hash match vs a golden render.
- **End-to-end:** full one-shot job against a local **MinIO** (S3) → input fetched,
  render produced, output object present and correct; failure + retry path.
- **Determinism:** golden-render regression in CI; explicit WebM-source case.

## 15. Repo / code changes

- `apps/artist`: new headless entry (`headless.html` + `src/headless/*`) and a
  `build:headless` script; the source-injection seam (seed IndexedDB, or a guarded
  source-resolver) — the editor path stays unchanged.
- New service location: `services/headless-artist/` (Node runner + adapters +
  `Dockerfile` + samples). Reuses `packages/shared` where sensible.
- Docs: deployment guide, config reference, security notes, broker-integration example.

## 16. Risks & open questions

- **WebM source decode headless:** `HTMLVideoElement` seek timing can be flaky for long
  clips; mitigated by hardening + golden tests. If it proves unreliable, fall back to a
  transcode-on-ingest step (out of scope unless needed).
- **Large-media source injection into the page:** seeding IndexedDB with very large
  blobs may be slow; the source-resolver fallback (Section 5) addresses it if measured
  to matter.
- **Memory/CPU per render:** high-res/long timelines are heavy; the broker controls
  concurrency by how many containers it runs (one-shot) — document host sizing guidance.
- **Object-store flavor:** assumed S3-compatible (e.g., MinIO) on their network;
  confirm their exact endpoint/auth model during planning.
- **Licensing/entitlement:** this is a Site-License capability; confirm whether the
  deployed service needs any license gate or is purely an entitlement of the
  air-gap deliverable.

## 17. Out of scope / future

- Distributed render farm / autoscaling (their broker's concern).
- Real-time/preview rendering on the server.
- GPU-accelerated encode tuning (optional, host-dependent).
- The hosted-ARTIST "Render on server" UI (companion spec).
