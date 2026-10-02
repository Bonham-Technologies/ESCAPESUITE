# @escapesuite/headless-artist

## 0.4.1

### Patch Changes

- 4c23b9b: A bundle's audio-only source renders as audio, not as a silent video
  
  Rendering a `.veditor` bundle that holds an ESCAPECRAFT audio-only take (mic alone, screen and webcam both off) now treats that source as audio, the way ESCAPEARTIST itself does, instead of decoding it as a video with nothing to show. Temp files for a WebM source also keep a `.webm` extension, including `audio/webm` and a `video/webm` MIME type carrying a `;codecs=` parameter, where they used to fall back to `.bin` or the wrong extension.

## 0.4.0

### Minor Changes

- c89cf40: Render a job as an animated GIF
  
  `options.format` now takes `"gif"` alongside `"mp4"` and `"webm"`, with a new `options.fps`
  (`10`, `15` by default, or `20`) and a new `options.resolution` of `"360p"`. The output is written,
  delivered and hashed exactly like a video — `<jobId>.gif` through the volume sink, `image/gif`
  through S3 and the webhook, and a manifest whose `format` says `gif`.
  
  `options.fps` applies to GIF only and a job that sets it on an MP4 or WebM render is rejected
  before Chromium launches, rather than quietly encoding at 30. Note that a GIF stores each frame's
  delay in hundredths of a second, so 10 and 20 fps are exact while 15 fps plays at about 14.3.
  
  Two validation messages widened and are now API surface, not just log text: a bad
  `options.format` reads `options.format must be one of "mp4", "webm", or "gif"`, and a bad
  `options.resolution` reads `options.resolution must be one of "project", "1080p", "720p", "480p",
  or "360p"`. A caller or broker that matches either message's old, two- or four-value text will
  stop matching.

## 0.3.0

### Minor Changes

- f8e9846: The export dialog's Resolution presets now show their actual output size, and the unreachable 'original' resolution is gone
  
  Every option in the export dialog's Resolution dropdown — "Project", "1080p", "720p" and "480p" — now prints its real output dimensions right in the label, e.g. "1080p — 1920×1080". Since a preset's width already followed the project's own aspect ratio, a bare "1080p" on a portrait project was misleading: it actually exported 608×1080, narrower than a full 1080p frame, with nothing in the dropdown to say so. Separately, the 'original' resolution option — never offered anywhere in the app, reachable only by hand-writing a headless render job spec — has been removed. It was the one setting that ignored the project's shape entirely and sized the export to the bottom clip's own source dimensions instead, which is exactly the surprising, inconsistent behaviour the rest of this change is about avoiding. A headless job spec that asks for `resolution: "original"` now fails with a clear validation error instead of silently doing something different from every other resolution — a breaking change for any kit consumer who was passing that value, hence the minor bump on `@escapesuite/headless-artist`.

## 0.2.1

### Patch Changes

- d5fa993: Release tooling migrated to changesets/action v2 and @changesets/cli v3. No functional change to the kit.

## 0.2.0

### Minor Changes

- b9f8928: - New `services/headless-artist` kit: a one-shot CLI for rendering ESCAPEARTIST projects server-side in headless Chromium, with pluggable output sinks and a render manifest.
  - Added an HTTP `serve` mode so the kit can render over a long-running process instead of a one-shot CLI invocation, with a `HEADLESS_SINKS` allow-list that leaves the `command` sink off by default.
  - Added Docker and Kubernetes reference deployments, running as an unprivileged `pwuser` with mounted `/in`/`/out` volumes.
  - CI now verifies rendered MP4/WebM output with ffprobe (codec, size, frame count, duration, golden-frame colour) and re-hashes delivered files against the manifest.
