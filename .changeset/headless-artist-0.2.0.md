---
"@escapesuite/headless-artist": minor
---

- New `services/headless-artist` kit: a one-shot CLI for rendering ESCAPEARTIST projects server-side in headless Chromium, with pluggable output sinks and a render manifest.
- Added an HTTP `serve` mode so the kit can render over a long-running process instead of a one-shot CLI invocation.
- Added Docker and Kubernetes reference deployments, running as an unprivileged `pwuser` with mounted `/in`/`/out` volumes.
- Added output verification so a render's actual result is checked against the manifest before it's reported as successful.
