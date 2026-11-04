# Vercel Web Analytics script

`script.js` is Vercel's own Web Analytics script, byte for byte, as
`https://va.vercel-scripts.com/v1/script.js` served it on 2026-11-04 (internal version
`0.1.3`, sha256 `050e35bf7e6e96590f2a9de114c14ff792806ed28457b3248762944350c0ba4c`). On a
deployment Vercel serves the same script at `/_vercel/insights/script.js`, the URL
`@vercel/analytics` injects; `scripts/serve-dist.mjs` has no such platform route and 404s it.

`tests/production/analytics-strip-query.spec.ts` (ESCSUITE-406) fulfils that URL with this file
so the real send path runs against the combined `dist/`. To refresh it:

```bash
curl -sS -o apps/e2e/fixtures/vercel-insights/script.js https://va.vercel-scripts.com/v1/script.js
```
