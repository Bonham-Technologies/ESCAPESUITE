---
"@escapesuite/headless-artist": minor
---

- New `services/headless-artist` kit: a one-shot CLI for rendering ESCAPEARTIST projects server-side in headless Chromium, with pluggable output sinks and a render manifest.
- Added an HTTP `serve` mode so the kit can render over a long-running process instead of a one-shot CLI invocation, with a `HEADLESS_SINKS` allow-list that leaves the `command` sink off by default.
- Added Docker and Kubernetes reference deployments, running as an unprivileged `pwuser` with mounted `/in`/`/out` volumes.
- CI now verifies rendered MP4/WebM output with ffprobe (codec, size, frame count, duration, golden-frame colour) and re-hashes delivered files against the manifest.
