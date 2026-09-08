# ESCAPEARTIST headless render kit

A one-shot command-line renderer for ESCAPEARTIST projects. You hand it a job spec, it renders
the project in a headless Chromium it launches itself, delivers the finished video to the sink
you named, prints one line of JSON, and exits. Nothing is carried between runs — scheduling,
retries and concurrency stay in whatever broker you already have. (If a process per job is the
awkward part, `headless-artist serve` puts the same renderer behind a two-route HTTP API — see
[HTTP service mode](#http-service-mode).) The kit is the same code the browser editor exports with: `dist/headless.html`
is the ARTIST render engine built as a single inlined page, driven from Node through
Playwright. A file that renders in the editor renders identically here.

Nothing leaves the machine. The driver aborts every `http:` and `https:` request the page makes
(the bundle is fully inline and needs none), so a render touches only the files you pointed it
at and the ones it writes. Install it on a box with more cores or a GPU than a laptop has, on a
network segment with no egress at all, and it behaves the same. Free and MIT-licensed, like the
rest of ESCAPE Suite — see <https://github.com/Bonham-Technologies/ESCAPESUITE>.

## Quick start

On a bare host with Node 22.22+ and network access to fetch Chromium once:

```bash
npm install ./escapesuite-headless-artist-0.1.0.tgz
npx playwright install --with-deps chromium
cp -r node_modules/@escapesuite/headless-artist/examples .
node_modules/.bin/headless-artist render --job examples/job-manifest-volume.json
ls out/            # example-manifest-volume.mp4  example-manifest-volume.manifest.json
```

The fourth command prints one JSON line to stdout describing what it produced; progress and
diagnostics go to stderr. That is the whole interface.

## Install

The kit ships as an npm tarball. It has exactly one runtime dependency — `playwright`, pinned
to an exact version rather than a range, so the browser revision you download always matches
the one the kit was built and tested against — plus an optional one (`@aws-sdk/client-s3`) that
only the S3 sink needs.

```bash
npm install ./escapesuite-headless-artist-<version>.tgz     # adds node_modules/.bin/headless-artist
npm install ./escapesuite-headless-artist-<version>.tgz --omit=optional   # skip the AWS SDK
```

**Node 22.22.0 or newer** is required.

### Chromium

The kit does not bundle a browser. Give it one of these two:

1. **Playwright-managed** (recommended). `npx playwright install chromium` downloads the exact
   build this kit is pinned against into `~/.cache/ms-playwright`, and
   `npx playwright install-deps chromium` installs the OS libraries it links against (Debian
   and Ubuntu; needs root). `npx playwright install --with-deps chromium` does both.
2. **A system Chromium.** Point `HEADLESS_CHROMIUM_PATH` at the binary and Playwright will
   launch that instead. Anything recent enough for WebCodecs works; an older build will fail at
   encode time rather than at launch.

The pinned version is **Playwright 1.62.1**. `headless-artist --version` prints it, along with
the kit and engine versions and the commit the kit was built from:

```console
$ headless-artist --version
{"kitVersion":"0.1.0","engineVersion":"2.0.0","commit":"5496954","playwrightVersion":"1.62.1","builtAt":"2026-09-07T22:26:33.296Z"}
```

### Air-gapped hosts

No network is used **at render time** — the driver aborts every http(s) request the page makes.
The only thing that ever wants a network is the one-time Chromium download, and there are two
ways around it:

- **Pre-seed the browser cache.** Run `npx playwright install chromium` on a machine with
  egress and copy `~/.cache/ms-playwright` (`~/Library/Caches/ms-playwright` on macOS) to the
  air-gapped host. Same Playwright version, same OS/arch. Set `PLAYWRIGHT_BROWSERS_PATH` if you
  want it somewhere else.
- **Use a system Chromium** from your distribution's packages and set
  `HEADLESS_CHROMIUM_PATH`. Nothing is downloaded at all.

The container image in [`Dockerfile`](Dockerfile) needs neither: its base image already carries
the matching browser. Building that image still needs a registry (for the base image and the
one `npm install`), so build it where you have egress and ship the image, not the Dockerfile.

**Installing the kit still needs a registry.** The tarball vendors no dependencies: `npm install`
on it resolves `playwright@1.62.1` (plus `@aws-sdk/client-s3`, unless you pass `--omit=optional`)
the usual way. On a host with no egress, point npm at an internal mirror or copy in a
`node_modules` populated on a machine that had one — same Node major, same OS/arch.

## Job spec

One JSON object, one render. Pass it as a file (`--job path.json`) or on stdin (`render -`).

```json
{
  "jobId": "acme-2026-09-07-0001",
  "input": { "manifest": { "path": "/in/manifest.json" } },
  "options": {
    "format": "mp4",
    "quality": "high",
    "resolution": "1080p",
    "timeRange": { "start": 3.5, "end": 42 }
  },
  "output": {
    "sink": "volume",
    "config": { "dir": "/out" }
  }
}
```

| Field | Required | Value |
| --- | --- | --- |
| `jobId` | yes | Matches `/^[A-Za-z0-9._-]{1,128}$/`, and may not be `.` or `..`. It names the output files and a scratch directory, so it must be a safe single path segment. |
| `input` | yes | Exactly one of `bundle` or `manifest`. Both take a single `path`. |
| `input.bundle.path` | — | A `.veditor` file exported from the editor. |
| `input.manifest.path` | — | A manifest JSON file (see [Inputs](#inputs)). |
| `options.format` | yes | `mp4` (H.264 + AAC) or `webm` (VP9 + Opus). |
| `options.quality` | no | `low`, `medium` or `high`. Default `high`. Video/audio bitrate: low 2 Mbps / 128 kbps, medium 5 Mbps / 192 kbps, high 10 Mbps / 256 kbps. |
| `options.resolution` | no | `project` (default) uses the project's own resolution; `original` uses the bottom-most media clip's native size; `1080p`, `720p` and `480p` scale to that height, keeping the source aspect ratio. Odd dimensions are rounded up to even. |
| `options.timeRange` | no | `{ "start": <seconds>, "end": <seconds> }`, both numbers, `start` strictly less than `end`. Omit to render the whole timeline. |
| `output.sink` | yes | `volume`, `command`, `webhook` or `s3`. |
| `output.config` | yes | An object; its shape depends on the sink (see [Sinks](#sinks)). |

Anything the spec gets wrong — an unknown format, a missing field, a `jobId` with a slash in it
— is caught before Chromium launches and exits **2**.

A field this table does not list is ignored rather than rejected, but the CLI says so on
stderr — `warning: unknown field "options.resoluton"` — so a typo in an optional field does not
quietly render something other than what you asked for. Keys under `output.config` belong to
the sink and are not checked here.

## Inputs

### Manifest (recommended)

A manifest is a small JSON file that names the project and points at source media already on
disk. Nothing is copied and nothing is base64-encoded, so a 40 GB job costs the same as a
40 MB one. `examples/manifest.json` is a complete, runnable one.

```json
{
  "project": { "$ref": "./project.json" },
  "sources": [
    { "id": "src-0", "file": "media/interview.mp4", "width": 3840, "height": 2160, "duration": 612.4 },
    { "id": "src-1", "file": "media/logo.png" },
    { "id": "src-2", "file": "media/vo.wav", "mimeType": "audio/wav", "name": "voiceover.wav" }
  ]
}
```

- **`project`** — either the project object inline, or `{ "$ref": "./relative/path.json" }`.
  A `$ref` is resolved relative to the manifest's own directory. If the referenced file is
  itself wrapped as `{ "project": { … } }` — which is exactly what the editor's project export
  looks like — the wrapper is unwrapped for you, so you can point `$ref` straight at a file
  saved from ARTIST without editing it. (The unwrap applies only to a `$ref`'d file; an inline
  `project` is used as given.)
- **`sources[].id`** — matches `clip.sourceVideoId` in the project. Any string; the files stay
  where they are, so it is never used as a file name.
- **`sources[].file`** — path to the media, resolved relative to the manifest's directory
  (absolute paths work too). The file must exist; a missing one fails the job immediately.
- **`sources[].mimeType`** — optional. Inferred from the extension when omitted:
  `mp4`, `webm`, `mov`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `mp3`, `wav`, `ogg`, `m4a`, `aac`.
  Any other extension needs an explicit `mimeType`.
- **`sources[].name`** — optional display name; defaults to the file's basename.
- **`sources[].width`, `height`, `duration`** — optional. Probed from the bytes when omitted;
  supplying them saves a probe.

Two rules are enforced up front, before Chromium starts, because both produce baffling failures
later otherwise:

- **Source file basenames must be unique** across the manifest. The page matches its file list
  by name, so `a/clip.mp4` and `b/clip.mp4` in one job is rejected.
- **Every media clip's `sourceVideoId` must exist in `sources`.** A mismatch fails with
  `clip "<id>" references unknown source "<id>"` — it means the project and the manifest have
  drifted apart, not that a file is missing.

### `.veditor` bundle

The editor's own export format: one JSON document holding the project and every source video
base64-encoded inline.

```json
{ "version": 1, "project": { … }, "videos": [ { "id": "src-0", "name": "clip.mp4", "mimeType": "video/mp4", "data": "<base64>" } ] }
```

Only `"version": 1` is accepted, and each `videos[].id` must be a safe file-name token
(`/^[A-Za-z0-9._-]{1,128}$/`, not `.` or `..`) because it becomes one. The loader decodes each
video to a temp file in chunks and deletes them when the job ends, but **the JSON document
itself is parsed whole into memory** — a 4 GB bundle needs more than 4 GB of heap. It is fine
for small projects and for round-tripping something straight out of the editor; for anything
large, use a manifest.

`examples/job-veditor-volume.json` shows the job shape but points at
`examples/project.veditor`, which the kit does **not** ship — a `.veditor` carries its own media
and would bloat the tarball. Produce one from ESCAPEARTIST itself — **File → Save Project**
(Ctrl+S) downloads `<project name>.veditor` — and point `input.bundle.path` at that.

## Sinks

Every sink produces two artifacts: the video and a JSON [verification
manifest](#output-and-verification).

### `volume` — write to a directory

```json
{ "sink": "volume", "config": { "dir": "/out" } }
```

Writes `<dir>/<jobId>.<mp4|webm>` and `<dir>/<jobId>.manifest.json`. The directory is created
if missing. The video is moved into place with a rename (falling back to a copy across
filesystems), and both files **overwrite** anything already at those names — which is what
makes re-running a job id idempotent rather than duplicative. `outputLocation` and
`manifestLocation` in the outcome are absolute paths.

### `command` — hand off to your own program

```json
{
  "sink": "command",
  "config": {
    "command": "/usr/local/bin/deliver.sh",
    "args": ["--tenant", "acme"],
    "env": { "DELIVERY_TARGET": "archive" }
  }
}
```

Runs `command` **without a shell** (no globbing, no word splitting, no injection surface) with
the output path and the manifest path appended as the last two arguments:

```
/usr/local/bin/deliver.sh --tenant acme /work/headless-artist-<jobId>-a1b2c3/render.mp4 /work/headless-artist-<jobId>-a1b2c3/<jobId>.manifest.json
```

The same two paths are also exported as `HEADLESS_OUTPUT_PATH` and `HEADLESS_MANIFEST_PATH`,
alongside `config.env` merged over the runner's own environment. A non-zero exit fails the job;
the last ~20 lines of the command's stderr come back in the outcome's `error`. Its **stdout is
discarded** — log as much as you like, there is no output buffer to overflow.

**The command sink deliberately reports no `manifestLocation`.** Both files live in the
runner's scratch directory, which is deleted as soon as your command returns — they are
transport, not storage. If you want the manifest, copy it somewhere durable while you have it.

### `webhook` — POST to an endpoint

```json
{
  "sink": "webhook",
  "config": {
    "url": "https://intake.internal.example/renders",
    "headers": { "Authorization": "Bearer …" },
    "timeoutMs": 600000
  }
}
```

A single `multipart/form-data` POST with two fields: `manifest` (the verification manifest as a
JSON string) and `file` (the video, filename `<jobId>.<ext>`, content type `video/mp4` or
`video/webm`). Any non-2xx response fails the job. `outputLocation` is the URL.

`timeoutMs` (a positive integer, default **10 minutes**) bounds the whole POST — connect,
upload, and the server's response. `HEADLESS_TIMEOUT_MS` does not cover delivery, so without
this an endpoint that accepts the body and never answers would hold the worker forever; the job
then fails with `webhook sink timed out after <n> ms`. Raise it if you push large files over a
slow link.

`headers` are sent as given with one exception: a `Content-Type` you set is **ignored**. The
boundary is generated per request and lives in that header — overriding it would leave the
server unable to parse the body.

This sink and `s3` are the only two that touch the network, and they do so *after* the render —
the render itself is still fully offline.

### `s3` — upload to S3 or an S3-compatible store

```json
{
  "sink": "s3",
  "config": {
    "prefix": "s3://my-renders/outgoing",
    "region": "us-east-1",
    "endpoint": "https://s3.us-east-1.amazonaws.com"
  }
}
```

Requires the optional dependency `@aws-sdk/client-s3`; without it the job fails with
`s3 sink requires the optional dependency @aws-sdk/client-s3`.

`prefix` accepts `s3://bucket/key-prefix` or a bare `bucket/key-prefix` (a trailing slash is
harmless), and a bucket with no prefix at all. Objects are written as
`<key-prefix>/<jobId>.<ext>` and `<key-prefix>/<jobId>.manifest.json`; the video is streamed
from disk rather than buffered, and tagged `video/mp4` / `video/webm` (the manifest
`application/json`) so a signed URL plays instead of downloading. `endpoint` and `region` are
both optional — set `endpoint` for MinIO, Ceph, R2 and friends.

**Credentials come from the environment**, via the AWS SDK's standard chain:
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (/ `AWS_SESSION_TOKEN`), `AWS_PROFILE`,
`AWS_REGION`, an instance/pod role, and so on. The job spec never carries secrets.

**Fetching inputs from S3.** The CLI itself only ever reads local paths, so if your job inputs
live in a bucket, download them before you spawn it. The kit exports a helper for exactly that,
for brokers written in Node:

```js
import { fetchS3ToLocal } from '@escapesuite/headless-artist/dist/cli.js'

// s3://bucket/key → <destDir>/<basename of key>, streamed to disk, returns the local path.
const manifestPath = await fetchS3ToLocal('s3://my-inputs/job-1/manifest.json', '/work/job-1', {
  region: 'us-east-1',
  endpoint: 'https://s3.us-east-1.amazonaws.com',
})
```

Same optional `@aws-sdk/client-s3` dependency and the same credential chain as the sink. It is
a library helper, not a job-spec feature — nothing in the job spec resolves `s3://` input
paths.

## Environment reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEADLESS_BUNDLE_PATH` | `headless.html` next to the CLI | The render bundle to load. Only override it if you moved the file. |
| `HEADLESS_WORK_DIR` | the system temp dir | Root for scratch space. Each job gets a freshly created `<work dir>/headless-artist-<jobId>-<random>` directory, removed when it finishes either way. Point this at fast local disk. |
| `HEADLESS_GPU` | unset | `true` launches Chromium with GPU acceleration instead of `--disable-gpu`. See [GPU](#gpu). |
| `HEADLESS_CHROMIUM_PATH` | Playwright's browser | Path to a Chromium binary to launch instead. |
| `HEADLESS_NO_SANDBOX` | unset | `true` adds `--no-sandbox`. Needed when running as root — e.g. in a container with no `USER`. Prefer running as a non-root user and leaving this off. |
| `HEADLESS_TIMEOUT_MS` | `1800000` (30 min) | Whole-**render** budget, launch included — it does not cover delivery (the `webhook` sink has its own `timeoutMs`). Must be a positive integer; anything else exits 2. |
| `HEADLESS_LOG` | `text` | `json` emits one JSON object per stderr line (`{ts, level, msg}`, level `error` or `info`). |
| `HEADLESS_PORT` | `8787` | `serve` only: port to bind. `0` picks a free one and prints it. |
| `HEADLESS_HOST` | `127.0.0.1` | `serve` only: interface to bind. There is no auth — see [HTTP service mode](#http-service-mode) before changing it. |
| `HEADLESS_CONCURRENCY` | `1` | `serve` only: renders allowed to run at once. Everything past it queues. |
| `HEADLESS_MAX_QUEUE` | `64` | `serve` only: jobs allowed to wait for a slot before `/render` answers 429. Must be a positive integer. |

`PLAYWRIGHT_BROWSERS_PATH` and the AWS credential variables are read by their own libraries and
behave as documented there.

## GPU

By default Chromium launches with `--disable-gpu`: encoding runs in software, which is
predictable and works on any host. Setting `HEADLESS_GPU=true` launches with
`--use-gl=angle --ignore-gpu-blocklist --enable-features=Vulkan` instead and lets Chromium pick
a hardware encoder when it finds a usable one.

- **In a container** you also need the device: `docker run --gpus all …` with the NVIDIA
  container toolkit installed, or the equivalent device plugin on Kubernetes (see the commented
  variant in `examples/k8s-job.yaml`). The env var alone does nothing without a GPU attached,
  and an attached GPU does nothing without the env var.
- **`"gpu": true` in the verification manifest means "this render was launched with GPU
  acceleration enabled"** — the driver records how it launched Chromium. It is not a promise
  that a hardware encoder was actually selected for every frame; Chromium falls back to
  software silently when the codec, resolution or driver isn't supported. Check the stderr line
  `[headless] chromium <version> gpu=true` for the launch, and your GPU's own utilisation
  counters for the truth.
- **Hardware and software encoders produce different bytes.** Same picture, different rate
  control, different sizes, different `sha256`. Do not compare hashes across a hardware/software
  boundary — that comparison is only meaningful between two renders on the same encoder. See
  [Output and verification](#output-and-verification).

Whether a GPU is worth it depends on the job: it helps most at high resolutions and long
durations, and barely at all on short 480p clips where launch and decode dominate.

## Output and verification

Every successful render is accompanied by `<jobId>.manifest.json`:

```json
{
  "jobId": "acme-2026-09-07-0001",
  "format": "mp4",
  "byteLength": 41235904,
  "durationSec": 38.5,
  "width": 1920,
  "height": 1080,
  "gpu": false,
  "sha256": "9f2c1d7a4be0355ec8f1a6d3b71e0c95d4a2f8e60b3c7d19a5e4f0c26b8d3a71",
  "chromiumVersion": "151.0.7922.34",
  "engineVersion": "2.0.0",
  "kitVersion": "0.1.0",
  "createdAt": "2026-09-07T22:26:33.296Z"
}
```

| Field | Meaning |
| --- | --- |
| `jobId` | The job that produced it. |
| `format` | `mp4` or `webm`, as requested. |
| `byteLength` | Size of the delivered file, re-read from disk after encoding. |
| `durationSec` | Encoded duration — the `timeRange` length when one was given, else the whole timeline. |
| `width`, `height` | Encoded frame size after `options.resolution` is applied (not necessarily the project's own resolution). |
| `gpu` | Whether Chromium was launched with GPU acceleration. |
| `sha256` | SHA-256 of the delivered file, streamed while hashing. |
| `chromiumVersion` | The browser that rendered it. |
| `engineVersion` | ARTIST version the bundle was built from. |
| `kitVersion` | This kit's version. |
| `createdAt` | ISO 8601, when the manifest was built. |

To verify a file you received matches the manifest that came with it:

```bash
sha256sum out/acme-2026-09-07-0001.mp4
# compare against .sha256 in out/acme-2026-09-07-0001.manifest.json
```

or, scripted:

```bash
jq -r '.sha256 + "  " + .jobId + "." + .format' out/acme-2026-09-07-0001.manifest.json \
  | (cd out && sha256sum -c -)
```

`sha256` verifies **transport**: that the bytes you hold are the bytes that were produced. It is
not a reproducibility claim — re-rendering the same project will not generally produce the same
bytes, and a hardware encoder certainly won't match a software one. For cross-encoder checks
compare `width`, `height`, `durationSec` and the picture itself.

To verify the *content* rather than the transport, probe the file you received and compare it
against the manifest — `ffprobe -v error -show_streams -show_format out/acme-2026-09-07-0001.mp4`
reports the codec (`h264` for MP4, `vp9` for WebM), the frame size, and the duration, which
should match `width`, `height` and `durationSec`. This kit's own suite runs exactly those checks
on every CI run: it renders a known fixture to MP4 and to WebM, asserts the codec, the frame
size, the frame count and the duration against golden expectations, decodes a middle frame and
asserts its mean colour still matches the source, and re-hashes the delivered file to confirm the
manifest's `sha256` and `byteLength` describe the bytes that were actually written. Those tests
need `ffmpeg` and `ffprobe` on `PATH` and skip themselves (loudly) when the binaries are absent.

## Exit codes and the stdout/stderr contract

| Exit | Meaning | stdout |
| --- | --- | --- |
| `0` | Rendered and delivered. | One JSON `RenderOutcome` line with `"ok": true`. |
| `1` | The job ran and failed (bad input file, encoder error, sink refused it, timeout). | One JSON `RenderOutcome` line with `"ok": false` and an `error` string. |
| `2` | Usage or job-spec error — the job never started. Retrying identically will fail identically. | Empty. |

`serve` uses the same three, one step removed: `0` when it shut down cleanly on a signal, `2`
for a bad flag or environment variable (checked before anything binds), and `1` when it could
not listen at all — `EADDRINUSE`, `EACCES` on a privileged port — which, unlike a `2`, may well
succeed on a retry or another host. A render that fails inside `serve` is not an exit code at
all: it is an `ok: false` in that request's response, and the server carries on. A second signal
during the drain exits `130`; see [Shutdown](#shutdown).

**stdout carries exactly one line and nothing else, ever.** Logs, progress and warnings all go
to stderr, so `outcome=$(headless-artist render --job job.json)` is always safe.

```json
{"jobId":"acme-…","ok":true,"meta":{"format":"mp4","byteLength":41235904,"durationSec":38.5,"width":1920,"height":1080,"gpu":false},"outputLocation":"/out/acme-….mp4","manifestLocation":"/out/acme-….manifest.json","durationMs":128411}
```

`manifestLocation` is present for the sinks that store one durably (`volume`, `s3`) and absent
for `command` and `webhook`. `--version` also prints a single JSON line to stdout; `--help`
prints usage to stderr and exits 0.

On stderr you get the launch line, one line per whole percent of progress, any page-level
console errors, and, on failure, the error:

```
[headless] chromium 151.0.7922.34 gpu=false
[headless] progress 0%
[headless] progress 1%
…
[headless] render complete: 41235904 bytes in 128203 ms
```

## Running in a container

[`Dockerfile`](Dockerfile) is a working reference build on the official Playwright image, which
already carries the matching Chromium, its OS dependencies, and the fonts text overlays need.

The build context must contain `dist/`. From an unpacked kit tarball it already does, and `.` is
the kit directory. In a repo checkout `dist/` is git-ignored, so assemble it first with
`pnpm --filter @escapesuite/headless-artist run build` and use `services/headless-artist` as the
context.

```bash
docker build -t headless-artist .        # from an unpacked kit
docker run --rm \
  -v "$PWD/in:/in:ro" \
  -v "$PWD/out:/out" \
  headless-artist render --job /in/job.json
docker run --rm headless-artist --version
```

The image's entrypoint is `node dist/cli.js`, so the arguments you pass are the CLI's own —
`render --job …` or `--version`, same as running the CLI outside a container. With no arguments
at all it falls back to the default command, which reads the job spec from stdin:

```bash
cat job.json | docker run --rm -i -v "$PWD/in:/in:ro" -v "$PWD/out:/out" headless-artist
```

This image is built from `services/headless-artist` and smoke-tested (`render` and `--version`)
in CI on every non-Dependabot pull request (the `kit-docker` job).

Two things worth knowing:

- It runs as `pwuser`, not root, which keeps Chromium's own sandbox usable — so
  `HEADLESS_NO_SANDBOX` is *not* set. If you change the image to run as root you must set
  `HEADLESS_NO_SANDBOX=true`, or Chromium refuses to start. Make sure the mounted output
  directory is writable by uid 1000.
- Scratch space defaults to the container's `/tmp`. For long renders, mount real storage and
  set `HEADLESS_WORK_DIR` to it.

`examples/k8s-job.yaml` is the same thing as a one-shot Kubernetes `Job` — `restartPolicy:
Never`, `backoffLimit: 0`, input and output volumes, an `emptyDir` for scratch, and a commented
GPU variant using `nvidia.com/gpu`.

## Broker integration

The CLI is designed to be spawned per job by something you already run. `examples/broker-example.sh`
is a working loop; the contract it relies on is small:

- **One process per job.** No warm-up to amortise, no shared state to corrupt, so you can run
  as many in parallel as the box has cores and memory for.
- **Idempotent by `jobId`.** The `volume` and `s3` sinks write `<jobId>.<ext>` and
  `<jobId>.manifest.json`, overwriting. Re-running a job that died halfway leaves one correct
  output rather than a duplicate. On the `volume` sink the video is *renamed* into place, so on
  one filesystem it appears atomically; across filesystems it falls back to a copy, which does
  not.
- **Retry on exit 1, never on exit 2.** Exit 1 is a failure that may be transient (a busy disk,
  a webhook that was down, a timeout). Exit 2 means the spec is wrong and always will be; route
  those to a dead-letter queue instead of a retry loop.
- **Read `outputLocation` from the outcome**, don't reconstruct it — it differs per sink.
- **Cap the render** with `HEADLESS_TIMEOUT_MS` so one wedged page can't hold a worker slot
  indefinitely; the job then fails with `render timed out after <n> ms` and exit 1.

If spawning a process per job is the part that doesn't fit, [HTTP service mode](#http-service-mode)
keeps every one of those properties except the first, and swaps exit codes for status codes.

Scratch is cleaned up on every path, success or failure, so a crashed broker doesn't leave the
work directory filling up. The exception is a hard kill of the CLI process itself (`SIGKILL`,
or an unhandled `SIGTERM`), which leaves one `<work dir>/headless-artist-<jobId>-<random>`
directory behind — worth a periodic sweep if you kill jobs routinely. The random suffix means a
job only ever deletes the directory it created itself, so nothing else in a shared work dir (the
system temp dir, by default) is ever at risk.

## HTTP service mode

`headless-artist serve` is the same renderer behind a small HTTP API instead of a process per
job. It exists for the case where spawning a process per job is the awkward part — a broker in
a language with no good subprocess story, a sidecar next to an app that just wants to POST some
JSON, a laptop trying things out with `curl`.

Everything else is identical: the same job spec, the same sinks, the same `RenderOutcome`, the
same `runJob` underneath. Every job still launches and tears down its own Chromium — there is no
browser pool, so a wedged render cannot poison the next one, at the cost of the same second or
two of launch overhead the one-shot CLI pays. **Prefer the one-shot CLI when you have the
choice** — one process per job means a crashed render cannot take another job with it, and your
existing scheduler already knows how to retry a process.

```bash
headless-artist serve                          # 127.0.0.1:8787, one render at a time
headless-artist serve --port 9000 --host 0.0.0.0 --max-queue 16
```

It prints one line to stderr when it is listening and then runs until `SIGTERM` or `SIGINT`.
stdout stays empty — the outcome of a job goes back in its HTTP response, not to a stream.

```
listening on http://127.0.0.1:8787 (concurrency 1)
GET /healthz 200 1ms
POST /render 200 128411ms
```

### `GET /healthz`

```bash
curl -s http://127.0.0.1:8787/healthz
```

```json
{"ok":true,"versions":{"kitVersion":"0.1.0","engineVersion":"2.0.0","commit":"0cb140b","playwrightVersion":"1.62.1"},"inFlight":1,"queued":3,"maxQueue":64}
```

`inFlight` is the number of renders running, `queued` the number waiting for a slot, `maxQueue`
the point at which waiting jobs start being refused. Together they are the depth of the one
queue this server has — useful as a readiness signal and as the
input to whatever decides to start another instance. It answers while renders are running (the
render happens off the event loop, in Chromium), so it is a real liveness probe.

### `POST /render`

One job spec per request, `content-type: application/json`, at most 1 MiB. The response is the
same `RenderOutcome` the CLI prints, and the connection stays open for the whole render.

```bash
curl -sS -X POST http://127.0.0.1:8787/render \
  -H 'content-type: application/json' \
  --data @job.json
```

```json
{"jobId":"acme-…","ok":true,"meta":{"format":"mp4","byteLength":41235904,"durationSec":38.5,"width":1920,"height":1080,"gpu":false},"outputLocation":"/out/acme-….mp4","manifestLocation":"/out/acme-….manifest.json","durationMs":128411}
```

Paths in the spec are resolved **by the server**, on the server's filesystem — `input.manifest.path`
and a `volume` sink's `dir` have to exist where the process runs, not where the client does. The
API moves job specs, never media.

| Status | When | Body |
| --- | --- | --- |
| `200` | The job ran. **Including when it failed** — `ok: false` with an `error` is still a 200. | `RenderOutcome` |
| `400` | The body is not JSON, or the job spec is invalid. The job never started. | `{"error": "options.format must be one of \"mp4\" or \"webm\""}` |
| `404` | No such route. Only `/healthz` and `/render` exist. | `{"error": "not found: /renderr"}` |
| `405` | Right path, wrong method — `GET /render`, `POST /healthz`. Carries an `Allow` header. | `{"error": "…"}` |
| `413` | The body is over 1 MiB. A job spec names paths, never payloads; it has no business being that big. | `{"error": "…"}` |
| `415` | `content-type` was not `application/json`. | `{"error": "…"}` |
| `429` | The queue is full. Carries `Retry-After: 5`. Nothing was queued — resend it, or send it somewhere less busy. | `{"error": "render queue is full (64 queued)"}` |
| `503` | The server is shutting down and the job was still queued. Retry it elsewhere. | `{"error": "server shutting down"}` |
| `500` | A bug in the server. Worth reporting. | `{"error": "…"}` |

**A failed render is a 200 on purpose.** The HTTP request succeeded — it was received, parsed,
queued, run, and answered; the *job* is what failed, and the outcome says so. A 5xx would tell
every well-behaved client to retry the HTTP call, which is exactly wrong for a job that will
fail identically the second time. Branch on `ok`, not on the status code — the same rule as the
CLI's exit 1.

Unknown job-spec fields (`qualitiy`, `options.resoluton`) come back as a `warnings` array — the
same warnings the CLI writes to stderr. They never refuse a job on their own, so they ride along
with the 200; a spec that was *also* invalid gets them beside the 400's `error`, since a typo is
usually the reason the spec is wrong in the first place.

Every response is `application/json`, including the errors and the 404 for an unknown path.

### Concurrency

`HEADLESS_CONCURRENCY` (default `1`) is how many renders run at once. Requests past it queue in
arrival order and wait, holding their connection open until their job runs. Encoding is CPU-bound
and a single render will happily use every core, so raise this only when you have measured that
it helps; running two instances on two boxes beats over-subscribing one. `HEADLESS_TIMEOUT_MS`
still caps each individual render.

`HEADLESS_MAX_QUEUE` / `--max-queue` (default `64`) bounds that queue. Once it is full,
`POST /render` answers straight away rather than accepting work it has no prospect of getting to:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 5

{"error":"render queue is full (64 queued)"}
```

Nothing is enqueued for a 429, so the job is entirely safe to resend — after `Retry-After`
seconds, or immediately to a less busy instance. A job that can *start* is never refused,
however full the queue was a moment before.

The queue cannot be turned off: `maxQueue` must be at least `1`. The two numbers bound different
things and you want both — `HEADLESS_CONCURRENCY` bounds the work in flight, `HEADLESS_MAX_QUEUE`
bounds the work waiting. For "run one job and refuse everything else", set
`HEADLESS_CONCURRENCY=1 HEADLESS_MAX_QUEUE=1`, which leaves room for exactly one job to be
waiting as the current one finishes — the difference between a busy server and an idle one
between jobs.

The bound exists because every waiting job is a client connection parked for an unknown length
of time: unbounded, a burst becomes thousands of open sockets and renders that complete long
after anyone still cares. Watch `queued` against `maxQueue` on `/healthz` — a queue that sits
near its bound is the signal to add an instance, not to raise the number.

### There is no authentication

None. No API key, no TLS, no rate limit, no allow-list. Anyone who can reach the port can make
the process read any file it can read and write anywhere it can write.

That is a deliberate omission, not an oversight: authentication that is worth having belongs to
whatever you already use for it. So:

- The default bind address is `127.0.0.1`, and it takes an explicit `--host 0.0.0.0` (or
  `HEADLESS_HOST`) to change that. Leave it on loopback unless you meant it.
- To expose it, put your own reverse proxy in front — the one that already terminates TLS and
  checks credentials for everything else you run. Raise its read timeout while you are there:
  a `POST /render` holds the connection open for the whole render (128 s in the sample log
  above, and `HEADLESS_TIMEOUT_MS` permits 30 minutes), so nginx's 60-second default
  `proxy_read_timeout` — and your client's own timeout — must be at least `HEADLESS_TIMEOUT_MS`
  or the render will finish into a connection that was cut long ago.
- On Kubernetes, a `ClusterIP` Service and a NetworkPolicy that admits only your broker.
- Never put it on the public internet directly.

### In a container

```bash
docker run --rm -p 8787:8787 -v /out:/out headless-artist serve --host 0.0.0.0
```

`--host 0.0.0.0` is required here and only here: bound to loopback the server would only be
reachable from inside the container, so the published port would answer nothing. The container
boundary is not a security boundary — `-p 8787:8787` publishes on every interface of the host,
so bind it to one you trust (`-p 127.0.0.1:8787:8787`) or keep it on a private Docker network.

The image's entrypoint is `node dist/cli.js`, so `serve` and its flags are passed exactly as
they are outside a container. Everything the [container section](#running-in-a-container) says
about `pwuser`, volume permissions and `HEADLESS_WORK_DIR` applies unchanged.

### Shutdown

`SIGTERM` and `SIGINT` shut down gracefully:

1. The listener stops accepting new connections.
2. Jobs still queued are answered `503 {"error":"server shutting down"}` immediately — they
   never started, so they are safe to retry elsewhere.
3. Renders already running are allowed to finish and their clients get the real outcome.
4. The process exits 0.

Step 3 is bounded by `HEADLESS_TIMEOUT_MS`, not by the signal, so a 30-minute render means up to
a 30-minute drain. Size `terminationGracePeriodSeconds` (or your orchestrator's equivalent)
accordingly, or a `SIGKILL` will land in the middle of an encode and leave the scratch directory
behind.

A **second** `SIGTERM` or `SIGINT` during the drain exits immediately with `130`, matching what
Node does with an unhandled `SIGINT` — so pressing Ctrl-C twice does what you expect. It
abandons the renders that were running and leaves their scratch directories behind, which is
the trade you are making by asking twice.

`serve` launches Chromium with Playwright's own signal handling switched off
(`handleSIGINT`/`handleSIGTERM`/`handleSIGHUP`), so nothing but the drain reacts to a signal —
otherwise Playwright would tear the browser down on the first one and kill the very render the
drain promised to finish. The one-shot `render` command keeps Playwright's defaults, where
Ctrl-C closing the browser is exactly what you want. Either way no Chromium is left behind: the
browser is also killed from a `process.on('exit')` hook, which runs on the force-quit path too.

## Sizing and throughput

Measured on a laptop with software encoding, as a floor rather than a target:

| Job | Throughput |
| --- | --- |
| 1080p, software | ~0.3× realtime — roughly 3 minutes of wall clock per minute of video |
| 4K, software | 2 seconds of output in ~6 seconds |

Rules of thumb:

- **Encoding is CPU-bound** and scales with cores. A server with 8–16 cores does far better
  than the numbers above; a GPU does better still at high resolutions.
- **Memory scales with resolution**, not with duration — frames are streamed, not accumulated.
  4 GB is comfortable for 1080p; budget 8 GB or more for 4K. A `.veditor` input is the
  exception: it also needs headroom for the whole JSON document.
- **Disk**: the scratch directory holds one complete output for the duration of the job, plus
  decoded temp files for a `.veditor` input.
- **Fixed overhead** per job is a Chromium launch — a second or two. It is not worth batching
  around, but it does mean very short clips are dominated by it.

## Troubleshooting

**`No H.264 encoder available` / MP4 export fails, WebM works.** The Chromium you're launching
was built without H.264 (some Linux distribution packages strip it). Use Playwright's own
Chromium rather than a system one, or export `webm`. If you're on a GPU host, try toggling
`HEADLESS_GPU` — a broken hardware encoder path can fail where software succeeds, and vice
versa.

**`Failed to launch` / sandbox errors, usually in a container.** Chromium's sandbox can't
initialise as root. Either run as a non-root user (what the reference `Dockerfile` does) or set
`HEADLESS_NO_SANDBOX=true`. Under Docker's default seccomp profile a non-root user is enough.

**Text overlays render in the wrong font, or as boxes.** Overlays use system fonts; a minimal
container or a stripped host has none. Install `fonts-liberation` and `fonts-noto-core`
(Debian/Ubuntu) — the Playwright base image already has both.

**`render timed out after <n> ms`.** The whole render, launch included, outran
`HEADLESS_TIMEOUT_MS` (30 minutes by default). Long or high-resolution jobs legitimately need
more; raise it. If a job that used to finish suddenly doesn't, check stderr for the last
`[headless] progress` line — progress that stopped early points at a bad source file, one that
never started points at the launch.

**`clip "<id>" references unknown source "<id>"`.** The project and the manifest disagree: the
timeline references a source the manifest doesn't list. This is caught before Chromium starts,
so it costs nothing but it will never resolve itself — regenerate the manifest from the same
project you're rendering.

**`could not infer a MIME type for "<file>"`.** The extension isn't in the inference table. Add
`"mimeType"` to that source's entry.

**`manifest has duplicate source file name "<name>"`.** Two sources in one job resolve to the
same basename. Rename one, or copy them to distinct names — the page matches its file list by
name and cannot tell them apart.

**`headless bundle not found at <path>`.** `dist/headless.html` isn't where the CLI expects it.
It ships next to `dist/cli.js`; set `HEADLESS_BUNDLE_PATH` if you relocated it.

**`s3 sink requires the optional dependency @aws-sdk/client-s3`.** Installed with
`--omit=optional` (or with the reference `Dockerfile`, which does). Reinstall including
optional dependencies.
