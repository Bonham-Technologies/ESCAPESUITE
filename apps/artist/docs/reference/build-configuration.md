<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` produces an offline single-file build for air-gapped use
- **`isSingleFileBuild(env)`** (`singleFileBuild.js`, beside `vite.config.ts`; unit tested from
  `src/build/singleFileBuild.test.ts`, since `vitest`'s `test.include` only looks under `src/`)
  names, once, which
  builds must ship as exactly one HTML file with `decodeWorker` inlined as a blob URL rather
  than a separate chunk: true for `VITE_HEADLESS=true` or `VITE_BUILD_MODE=standalone`, false for
  the hosted (`saas`) default. Both single-file targets run from `file://` — the headless render
  bundle (opened by Playwright and the headless-artist CLI) and the standalone offline build
  (downloaded from a GitHub Release and opened directly) — where Chromium blocks a page from
  loading a worker script as a separate `file://` resource; the hosted build is served over
  http(s), where a separate worker chunk is an ordinary same-origin fetch. `vite.config.ts` gates
  `headlessClassicWorkersPlugin`, `headlessInlineWorkersPlugin` (now parameterised on the output
  directory and entry HTML filename rather than assuming the headless build's own
  `dist-headless/headless.html`) and the `worker: { format: 'iife' }` override on this one
  predicate. ESCSUITE-153: before this, only `VITE_HEADLESS` was checked, so the standalone build
  shipped `dist/index.html` plus a second, un-inlined `decodeWorker-*.js` that
  `standalone-release.yml` never attaches to the release — a downloaded build's MP4 export had no
  worker file to start at all. The hosted worker chunk resolves against the document URL, so the
  document must be `/artist/`: ESCSUITE-234 made `vercel.json` redirect `/artist` (308) instead of
  rewriting it, where the slashless URL fetched `/decodeWorker-<hash>.js` from the hub. `singleFileBuild.js` is plain JS, not TypeScript, with a
  hand-written `singleFileBuild.d.ts` beside it: `vite.config.ts` is type-checked under
  `tsconfig.node.json`, which lacks `allowImportingTsExtensions`, so a `.ts`-suffixed import from
  it fails `tsc -b` (TS5097) — and an extensionless import instead trips Vite's
  `configLoader: 'native'` warning on every invocation. A plain `.js` file carries its own real
  extension (no warning) without ever being a `.ts` import (no TS5097). Guarded end to end by
  `apps/e2e/tests/standalone/dist-single-file.spec.ts`, a node-side assertion (no browser fixture)
  that each of `apps/artist/dist` and `apps/craft/dist` contains exactly one file after
  `build:standalone` — `playwright.standalone.config.ts` serves the whole directory with `npx
  serve`, which is why the browser-driven standalone specs never caught a second file sitting
  next to `index.html`.
