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
