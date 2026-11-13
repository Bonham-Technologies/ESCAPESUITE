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
├── 404.html          # Not-found page (status 404)
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
```

`scripts/build-all.mjs` (`pnpm build:deploy`) refuses to publish: if `turbo build` left any of
ESCAPEPLAN, ESCAPECRAFT or ESCAPEARTIST with an empty or missing `dist`, it exits non-zero
naming the app instead of assembling and reporting success on a half-shaped `dist/`.

## Rewrites and the 404 page

`vercel.json` rewrites the hub's own routes (`/`, `/privacy`, `/terms`, `/limitations`) to
`/index.html`, and everything under `/craft/` and `/artist/` to that app's `index.html`. A path
that is neither a file nor one of those routes gets `dist/404.html` with status 404 (ESCSUITE-455;
before it, a catch-all sent every unknown path to the hub with status 200, a "soft 404"). `404.html`
is a copy of the hub's page, and the hub's router shows its not-found page, with links home and to
both tools, for any path it doesn't know.

Each hub page with a trailing slash (`/privacy/`) redirects permanently (308) to its canonical
path, since the old catch-all served those too. `/index.html` is the hub's own file (200), so the
hub's router sends it to `/` instead of showing the not-found page there.

The hub's route list is `PAGES` in `apps/plan/src/routes.ts`; `apps/plan/src/routes.test.ts` fails
when `vercel.json`'s hub rewrites (or its trailing-slash redirects) and that list disagree, so **add a hub page's rewrite and redirect with the
page**. `apps/e2e/scripts/serve-dist.mjs` resolves requests from `vercel.json` itself, and
`apps/e2e/tests/production/not-found.spec.ts` checks the statuses against the combined build.

## Security headers

`vercel.json` sends these on every path (`/(.*)`). `scripts/security-headers.test.mjs` pins them,
and `apps/e2e/scripts/serve-dist.mjs` serves the same block to `pnpm test:e2e:production`.

| Header | Value | Why |
|--------|-------|-----|
| `Content-Security-Policy` | see `vercel.json` | Only the suite's own origin may load code, media or workers; `frame-ancestors 'self'` refuses framing by other origins. `base-uri 'self'` and `form-action 'self'` (ESCSUITE-416) stop an injected `<base href>` from re-pointing relative loads and a form from posting off-site; neither falls back to `default-src`, so both are set explicitly. `script-src` keeps `'unsafe-inline'` because the CRAFT and ARTIST deploy builds are single files with their code inlined. |
| `X-Frame-Options` | `SAMEORIGIN` | The same framing rule for browsers that ignore `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | Browsers use the declared MIME type and never sniff a file into a script or stylesheet. |
| `Referrer-Policy` | `same-origin` | Requests within the suite keep their full referrer; a request or link to any other origin, such as GitHub, sends none (the in-app outbound links already carry `rel="noreferrer"`). Stricter than the browser default `strict-origin-when-cross-origin`. |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()` | CRAFT's capture devices are allowed for the suite's own origin only, never for a frame from another origin. Features the suite never uses are turned off. |

**Embedding.** The integration API's hosts frame CRAFT and ARTIST from the same origin (cross-origin
framing of the hosted site is already refused by `frame-ancestors 'self'`). A same-origin iframe
counts as `self`, so its camera, microphone and screen capture keep working with no `allow`
attribute needed (`apps/e2e/tests/integration/host-embedding.spec.ts` sets none). A self-hosted
build served without these headers is unaffected.
