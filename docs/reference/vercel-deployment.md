<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Vercel Deployment

The monorepo deploys to Vercel with automatic preview deployments:

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.tech | Production |
| `dev` | escapesuite.dev | Development/staging |
| PRs | `*.vercel.app` | Preview deployments |

**Output Structure:**
```
dist/
├── index.html        # ESCAPEPLAN (home page head)
├── privacy/index.html # ESCAPEPLAN with /privacy's head (also terms/, limitations/)
├── 404.html          # Not-found page (status 404)
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
# plus sw.js, manifest.webmanifest and icon.svg at /, /craft/ and /artist/
# (offline support, see "Offline after the first visit" below)
```

`scripts/build-all.mjs` (`pnpm build:deploy`) refuses to publish: if `turbo build` left any of
ESCAPEPLAN, ESCAPECRAFT or ESCAPEARTIST with an empty or missing `dist`, it exits non-zero
naming the app instead of assembling and reporting success on a half-shaped `dist/`.

## Rewrites and the 404 page

`vercel.json` rewrites the hub's own routes (`/`, `/privacy`, `/terms`, `/limitations`) to the
hub's page, each to its own copy (`/index.html`, `/privacy/index.html`, ...), and everything under
`/craft/` and `/artist/` to that app's `index.html`. A path
that is neither a file nor one of those routes gets `dist/404.html` with status 404 (ESCSUITE-455;
before it, a catch-all sent every unknown path to the hub with status 200, a "soft 404"). `404.html`
is the hub's page, written by the hub's build with the not-found head (ESCSUITE-489: title "Page
not found — ESCAPE Suite", its own description, `<meta name="robots" content="noindex">`, and no
canonical or `og:url`), and the hub's router shows its not-found page, with links home and to both
tools, for any path it doesn't know. Before ESCSUITE-489 it was a byte-for-byte copy of
`index.html`, so dead URLs unfurled as the home page; `scripts/build-all.mjs` now refuses to publish
a `404.html` with the home page's title, description, canonical or `og:url`, or without the noindex.

**Per-route head (ESCSUITE-458).** Each hub route's HTML carries that route's own title,
description, `rel="canonical"` and `og:`/`twitter:` title, description and url before any
JavaScript runs; before, every route was served the home page's head and only `seo.ts` corrected
it after load, so search engines saw `/privacy`, `/terms` and `/limitations` as duplicates of
`/`. The heads are in `apps/plan/src/lib/routeMeta.ts`, read both by `seo.ts` (in-app navigation)
and by the `escapeplan-route-heads` plugin in `apps/plan/vite.config.ts`, which writes the copies
at build time (and serves the right head from the dev server). Titles stay at 60 characters or
fewer and descriptions at 50 to 160; CRAFT's and ARTIST's are in their own `index.html`.
`scripts/build-all.mjs` refuses to publish when any rewrite destination is missing from `dist/`,
and `apps/e2e/tests/production/route-heads.spec.ts` reads every `sitemap.xml` route's served HTML.
`sitemap.xml` itself is written by the hub's build from its route list (ESCSUITE-457; see
`docs/reference/escapeplan.md`) and reaches `dist/` with the rest of `apps/plan/dist`.

Each hub page with a trailing slash (`/privacy/`) redirects permanently (308) to its canonical
path, since the old catch-all served those too. `/index.html` is the hub's own file (200), so the
hub's router sends it to `/` instead of showing the not-found page there; likewise each page's own
copy (`/privacy/index.html` goes to `/privacy`).

The hub's route list is `PAGES` in `apps/plan/src/routes.ts`; `apps/plan/src/routes.test.ts` fails
when `vercel.json`'s hub rewrites (or its trailing-slash redirects), `routeMeta.ts` and that list
disagree, so **add a hub page's rewrite, redirect and head with the page**. `apps/e2e/scripts/serve-dist.mjs` resolves requests from `vercel.json` itself, and
`apps/e2e/tests/production/not-found.spec.ts` checks the statuses against the combined build.

## Security headers

`vercel.json` sends these on every path (`/(.*)`). `scripts/security-headers.test.mjs` pins them,
and `apps/e2e/scripts/serve-dist.mjs` serves the same block to `pnpm test:e2e:production`.

| Header | Value | Why |
|--------|-------|-----|
| `Content-Security-Policy` | see `vercel.json` | Only the suite's own origin may load code, media or workers; `frame-ancestors 'self'` refuses framing by other origins. `base-uri 'self'` and `form-action 'self'` (ESCSUITE-416) stop an injected `<base href>` from re-pointing relative loads and a form from posting off-site; neither falls back to `default-src`, so both are set explicitly. `script-src` keeps `'unsafe-inline'` because the CRAFT and ARTIST deploy builds are single files with their code inlined. No Vercel host is allowed (ESCSUITE-459): `vercel.live` and `api.vercel.com` served only Vercel's preview toolbar, so the toolbar cannot load on preview deployments either (turn it off in the Vercel project settings to avoid CSP errors in the console) (Vercel Analytics is same-origin, `/_vercel/insights/`). `frame-src 'none'`: no page frames anything. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Browsers use HTTPS only, for two years, on the host that serves the site and every name under it (ESCSUITE-459; before it, only Vercel's platform default without `includeSubDomains`). No `preload`: that is hard to undo. Vercel adds no `vercel.json` header to a redirect, so the bare apex domain, which only redirects to `www.`, still sends the platform default; sibling subdomains of the apex are covered only once the apex itself sends `includeSubDomains`, a domain setting outside this file. |
| `X-Frame-Options` | `SAMEORIGIN` | The same framing rule for browsers that ignore `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | Browsers use the declared MIME type and never sniff a file into a script or stylesheet. |
| `Referrer-Policy` | `same-origin` | Requests within the suite keep their full referrer; a request or link to any other origin, such as GitHub, sends none (the in-app outbound links already carry `rel="noreferrer"`). Stricter than the browser default `strict-origin-when-cross-origin`. |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()` | CRAFT's capture devices are allowed for the suite's own origin only, never for a frame from another origin. Features the suite never uses are turned off. |

**Embedding.** The integration API's hosts frame CRAFT and ARTIST from the same origin (cross-origin
framing of the hosted site is already refused by `frame-ancestors 'self'`). A same-origin iframe
counts as `self`, so its camera, microphone and screen capture keep working with no `allow`
attribute needed (`apps/e2e/tests/integration/host-embedding.spec.ts` sets none). A self-hosted
build served without these headers is unaffected.

## Offline after the first visit (ESCSUITE-469)

After one full visit, each hosted app loads with no connection: the hub at `/`, ESCAPECRAFT at
`/craft/` and ESCAPEARTIST at `/artist/`, each on its own, in a browser with service workers.
`scripts/offline.mjs`, run by `scripts/build-all.mjs` on the assembled `dist/` (and nowhere
else: not the dev servers, the standalone single files or the headless kit), writes per app:

- **`sw.js`**, a small hand-written service worker (no dependency) whose scope is the app's own
  directory, so no `Service-Worker-Allowed` header is needed. On install it precaches that app's
  own build output (the hub: its pages and `/assets/*`; CRAFT: `index.html`; ARTIST: `index.html`
  and its `decodeWorker-*.js`, plus each app's manifest and icon). The list comes from the files
  on disk, and the cache is named `escapesuite-offline-<app>-<build id>`, the build id being a hash
  of those files' paths and bytes. A precached file is answered from the cache; a page load goes
  to the network and falls back to the cached page only when the network fails (the hub maps each
  route to its own page from `vercel.json`'s rewrites; anything else gets `index.html`). It
  answers nothing else: no other origin, nothing under `/_vercel/` (analytics are never cached or
  replayed), no file request with a query string, no media, so imported or recorded files never
  enter its cache. A page load keeps its query string (an integration URL such as
  `/artist/?video=…` included): online it goes to the network as is, offline it gets the app's
  cached page with the URL unchanged, so the app still reads its parameters; a `?video=` URL then
  fails to load with no connection, as any network fetch does. The hub's worker also passes everything under `/craft/` and `/artist/` straight
  through.
- **`manifest.webmanifest`** and **`icon.svg`** (the app's favicon), so Chromium offers install.
- A `<link rel="manifest">` and an inline registration script, right after the `<title>` of each
  of the app's HTML files (the hub's route copies and `404.html` included). The script registers
  the worker after the page's `load` event, only in a secure context, and **never inside a frame**:
  a host page that embeds CRAFT or ARTIST (`integration-api.md`) registers nothing and shows no
  note. A frame of a page whose worker a top-level visit already registered is still answered by
  it, which changes nothing online (page loads go to the network first).

**Updates.** `vercel.json` serves each `sw.js` with `Cache-Control: no-cache`. A deploy that
changes any precached file changes the build id, so the next load's update check installs the
new worker, which precaches the new files, takes over at once (`skipWaiting`) and deletes the
older caches of its own app. The page that triggered it was itself loaded from the network, so
it already is the new version; when the new worker takes over a page an older one controlled,
the page asks the worker for its build id (a `postMessage` with a reply port) and, only if it is
the page's own build id (baked into the registration script), shows a small note, "Updated to the
latest version of <app>.", with a Dismiss button, for 15 seconds. So a tab left open on the older
build, which the new worker also takes over, shows no note, and neither does any page the kill
switch takes over. A first install shows nothing. The build id is hashed with each page's offline
block left out (the block carries the id) and with `offline.mjs`'s own worker and registration
source in, so a change to either still makes a new cache. A tab left open from before a deploy loses its
old lazily loaded files exactly as it did without a worker.

**CSP.** `worker-src 'self' blob:` already allowed the workers; `manifest-src 'self'` is now
explicit. `scripts/security-headers.test.mjs` pins both and the `no-cache` entries.

**Kill switch.** If a worker misbehaves, deploy with the environment variable
`ESCAPESUITE_SERVICE_WORKER=off` (Vercel project settings, then redeploy; locally
`ESCAPESUITE_SERVICE_WORKER=off pnpm build:deploy`, or `node scripts/offline.mjs dist --kill-switch`
on a built `dist/`). Each `sw.js` is then a worker with no fetch handler that deletes its app's
caches and unregisters itself, and the pages no longer register one. A visitor's browser picks it
up on their next page load (the update check); pages already open keep running and are not
reloaded, so a recording in progress is never interrupted, and the load after that goes straight
to the network. Remove the variable and redeploy to turn offline support back on.

**Never delete `sw.js`.** A later change or rollback must keep shipping `/sw.js`, `/craft/sw.js`
and `/artist/sw.js` (the kill switch is how to turn offline support off). Without them the update
check fails (`/craft/*` and `/artist/*` rewrite a missing file to HTML, and `/sw.js` would 404), so
workers already installed stay registered with their old build until a kill-switch build reaches the
visitor.

**Tests.** `scripts/offline.test.mjs` (precache list, build id, cache naming, what the worker
answers and leaves alone, the kill switch, the page block). `apps/e2e/tests/production/offline.spec.ts`
loads each app, goes offline and reloads; records in CRAFT and imports and exports a WebM in
ARTIST while offline; checks analytics responses never come from the worker and the cache holds
only the app's own files; checks Chromium's installability report; serves a copy of `dist/` with
a second build id and shows the next load serves (and caches) the new files and says "Updated"
while a second tab left on the old build does not;
and runs the kill switch. `apps/e2e/tests/standalone/dist-single-file.spec.ts` fails if a
standalone HTML file ever mentions `serviceWorker` or links a manifest.
