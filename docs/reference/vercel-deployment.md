<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Vercel Deployment

The monorepo deploys to Vercel with automatic preview deployments:

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.io | Production |
| `dev` | escapesuite.dev | Development/staging |
| PRs | `*.vercel.app` | Preview deployments |

**Output Structure:**
```
dist/
├── index.html        # ESCAPEPLAN
├── 404.html          # SPA fallback
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
```

`scripts/build-all.mjs` (`pnpm build:deploy`) refuses to publish: if `turbo build` left any of
ESCAPEPLAN, ESCAPECRAFT or ESCAPEARTIST with an empty or missing `dist`, it exits non-zero
naming the app instead of assembling and reporting success on a half-shaped `dist/`.

## Security headers

`vercel.json` sends these on every path (`/(.*)`). `scripts/security-headers.test.mjs` pins them,
and `apps/e2e/scripts/serve-dist.mjs` serves the same block to `pnpm test:e2e:production`.

| Header | Value | Why |
|--------|-------|-----|
| `Content-Security-Policy` | see `vercel.json` | Only the suite's own origin may load code, media or workers; `frame-ancestors 'self'` refuses framing by other origins. `script-src` keeps `'unsafe-inline'` because the CRAFT and ARTIST deploy builds are single files with their code inlined. |
| `X-Frame-Options` | `SAMEORIGIN` | The same framing rule for browsers that ignore `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | Browsers use the declared MIME type and never sniff a file into a script or stylesheet. |
| `Referrer-Policy` | `same-origin` | Requests within the suite keep their full referrer; a request or link to any other origin, such as GitHub, sends none (the in-app outbound links already carry `rel="noreferrer"`). Stricter than the browser default `strict-origin-when-cross-origin`. |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()` | CRAFT's capture devices are allowed for the suite's own origin only, never for a frame from another origin. Features the suite never uses are turned off. |

**Embedding.** The integration API's hosts frame CRAFT and ARTIST from the same origin (cross-origin
framing of the hosted site is already refused by `frame-ancestors 'self'`). A same-origin iframe
counts as `self`, so its camera, microphone and screen capture keep working with no `allow`
attribute needed (`apps/e2e/tests/integration/host-embedding.spec.ts` sets none). A self-hosted
build served without these headers is unaffected.
