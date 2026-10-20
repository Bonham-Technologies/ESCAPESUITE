<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Headless render service (services/headless-artist)
- `@escapesuite/headless-artist`: a CLI with two commands — one-shot `render` and a long-running
  `serve` (`http.createServer` with `GET /healthz`, `POST /render`, a bounded FIFO job queue, a
  1 MB body cap and a sink allow-list) — that renders ESCAPEARTIST projects in headless Chromium
  (via Playwright) outside the browser, for servers or GPU boxes with no UI involved. A job spec
  names its input as either a self-contained `.veditor` `bundle` (v1 or v2) or a `manifest` (a
  small JSON pointing at source media already on disk, for a large project) and writes to one of
  four output sinks — `volume`, `command`, `webhook`, `s3` — each producing a verification manifest
  (hash, dimensions, duration) alongside the render. `services/headless-artist/README.md` is the
  protocol reference, the way the Integration API section above links
  `apps/artist/src/utils/integration.ts`.
- The reference container (`services/headless-artist/Dockerfile`) runs `tini` as PID 1, so the Chromium helper
  processes a `serve` render orphans are reaped instead of accumulating as zombies; it runs as `pwuser`,
  **uid 1001** (not 1000 — that is `ubuntu` in the Playwright base image); and a `volume` job whose output
  directory the process cannot write is refused before Chromium launches (`ensureSinkReady` writes and removes a
  private temp file) — exit 2, or 400 under `serve` — instead of failing delivery after a full render.
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
- CI runs the Chromium tests in the `e2e` job (pinned to the same Playwright 1.64.0 as
  `apps/e2e`, sharing its browser cache) and packs + uploads the kit as the
  `headless-artist-kit` artifact in the `build` job; `standalone-release.yml` attaches the
  tarball to GitHub Releases alongside the standalone HTML builds.
