# @escapesuite/headless-artist

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
