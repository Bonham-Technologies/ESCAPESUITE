<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Testing

- **Unit tests**: Vitest with Testing Library, fake-indexeddb for storage mocking
- **E2E tests**: Playwright with Chromium; CI runs the whole suite on every PR and push
- **Journey test**: one end-to-end journey covering record → edit → export across ESCAPECRAFT and ESCAPEARTIST
- **Production-layout tests**: `apps/e2e/tests/production/` runs against the combined
  `dist/` from `pnpm build:deploy`, served on ONE port by `apps/e2e/scripts/serve-dist.mjs`
  (which mirrors `vercel.json`'s rewrites, and — since ESCSUITE-121 part 2 — reads and sends
  `vercel.json`'s `headers` block too, so the suite runs under the real hosted
  Content-Security-Policy and `X-Frame-Options` rather than none at all; `tests/production/csp-media.spec.ts`
  is the regression test, proving a `blob:` video source survives that CSP in both apps).
  ESCSUITE-240: `vercel.json` gives the hub's content-hashed `/assets/*` chunks
  `Cache-Control: public, max-age=31536000, immutable` (the server keeps a Cache-Control the
  `headers` block sets instead of forcing `no-store`; the craft/artist single files and the
  artist worker chunk live outside `/assets/` and keep Vercel's default), the catch-all excludes
  `favicon\.ico` so that path is a real 404 rather than the hub page (the hub's icon is a `data:`
  URI; no `.ico` ships), and the sitemap lists `/craft/` and `/artist/`. Since
  ESCSUITE-196, `serve-dist.mjs`'s rewrite table is *derived* from `vercel.json`'s `rewrites`
  array (walked in order through the same `source`-pattern matcher the `headers` block already
  used), not a hand-coded copy of it — `tests/production/spa-fallback.spec.ts` and
  `serve-dist.test.mjs`'s drift-guard test are the regression coverage, proving a genuine miss
  reaches `dist/404.html` with a real 404 instead of the hub SPA or a plain-text fallback. That
  is the only setup where CRAFT (`/craft/`) and ARTIST (`/artist/`) share `video-editor-db`,
  so the cross-app IndexedDB tests live there: `pnpm build:deploy && pnpm test:e2e:production`.
  ESCSUITE-234: `vercel.json`'s `redirects` precede its `rewrites` (and the filesystem), and
  `serve-dist.mjs` derives them the same way (308 for the bare paths, query string kept). `/craft` and `/artist` redirect
  to the slashed document instead of being rewritten to it, because the single-file bundle resolves
  its worker chunk against the document URL; a deep extensionless path (`/artist/foo/`) redirects to
  the one document too (temporary, 307, so no browser caches it and a future real sub-route stays reachable), since neither app has client-side routes. Paths ending in a file extension
  are excluded so `/artist/decodeWorker-<hash>.js` is still served as itself
  (`tests/production/slashless-redirect.spec.ts`).
- **Standalone tests**: See [Standalone Test Battery](docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists

Test counts change frequently as coverage grows; run `pnpm test` for the current numbers rather than relying on a count documented here.

## Media-health assertions (ESCSUITE-348)

A visible waveform `<canvas>` with nothing on it, or a preview canvas that stopped repainting,
passes every "is it visible" check. Tests of user-visible media behaviour (waveforms, preview
playback, audio editing, save/load) assert that the media is *alive* instead.

**A/V fixture.** `apps/e2e/fixtures/av/tone-gap.webm` (VP9/Opus) and its H.264/AAC twin
`tone-gap.mp4`: 5 s of 640×360 `testsrc2` at 30 fps (every frame differs) over a 440 Hz tone at
0–2 s, digital silence at 2–3 s and the tone again at 3–5 s. `fixtures/av/make-fixture.sh`
regenerates both. Import them through `AV_FIXTURE_WEBM` / `AV_FIXTURE_MP4`; `AV_FIXTURE_TIMING`
and `AV_FIXTURE_SILENCE` describe the layout; `AV_FIXTURE_SILENCE` is for an untrimmed clip, so a
trimmed clip's window has to be recomputed from its source range. The Chromium Playwright pins
decodes both; the older headless shell (build 1194) preinstalled in some cloud containers has no
H.264/AAC decoder, so there only the WebM can be verified (`tests/media-health/av-fixture.spec.ts`
runs both).

**Helpers** (`apps/e2e/utils/mediaHealth.ts`):

| Helper | Fails unless |
|---|---|
| `expectWaveformDrawn(canvas, { silence? })` | the waveform canvas has pixels drawn and, given a silent window as fractions of the clip's width, draws under a third as much there as in the tone |
| `expectPreviewAlive(page, { forMs })` | while playing, a media element's `currentTime` and presented-frame count (`requestVideoFrameCallback`) advance, the preview canvas repaints, and an unmuted element decodes audio. The caller starts playback |
| `expectPreviewFrameChangesOnSeek(page, seek)` | the seek puts a different picture on the preview canvas within the timeout |

`expectPreviewAlive` needs `installMediaHealthProbe(pageOrContext)` before the page loads: the
preview's `<video>`s are never attached to the document, so the probe records every media element
`createElement` makes. ARTIST plays preview sound by unmuting the element itself, with no Web Audio
graph, so "the audio is running" is checked on the element: playing, unmuted, volume above zero,
decoded audio bytes growing. Chromium decodes a muted element's audio too, so this proves sound is
playing, not that it is the right clip's. `previewCanvas(page)` and
`waveformCanvas(page, clip?)` locate the canvases.

Each helper is pinned by `tests/media-health/self-test.spec.ts` to fail on the case it guards (a
blank canvas, a paused video, a stalled frame callback, a frozen canvas, muted playback, a seek
that paints nothing) beside a healthy control. Change a helper, keep those passing. "Project Save
and Reload" in `tests/integration/workflows.spec.ts` uses the fixture and the helpers on the
reopened project.
