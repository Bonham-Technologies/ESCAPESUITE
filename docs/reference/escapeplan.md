<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# ESCAPEPLAN (apps/plan)
- React Router for client-side routing
- Landing page & legal pages only — no accounts, no backend
- In production: serves CRAFT at `/craft/` and ARTIST at `/artist/`
- `/limitations` (ESCSUITE-402): "Known limitations, and how to check nothing leaves". The list is
  data in `src/pages/Limitations/limitations.ts`, each entry with its source doc, file, ticket or
  ruling (a unit test fails on an entry with none); the page reuses `Legal.module.css` and links
  to `apps/e2e/tests/production/network-silence.spec.ts`. Linked from the footer and the README.
  Served in the combined deploy by its own `vercel.json` rewrite, like `/privacy`. Change an
  entry when its source changes; the analytics wording is the owner's to approve.
- Not-found page (ESCSUITE-455): any path that isn't a hub route renders `pages/NotFound` inside
  the Layout ("Page not found", with links home, to CRAFT and to ARTIST) instead of redirecting to
  `/`. The hosted site serves those paths `dist/404.html` with status 404. The route list is
  `src/routes.ts`; `vercel.json`'s hub rewrites must match it (`src/routes.test.ts`).
- Per-route head (ESCSUITE-458): each route's title, description and canonical path are in
  `src/lib/routeMeta.ts`. Pages call `useRouteSeo(path)` (`src/lib/seo.ts`), and the build writes
  the same head into each route's own HTML (`dist/privacy/index.html`, ...), so the served HTML
  and the running page agree. See `docs/reference/vercel-deployment.md`.
- Sitemap (ESCSUITE-457): the build writes `dist/sitemap.xml` (the `escapeplan-sitemap` plugin in
  `vite.config.ts`) from `SITEMAP_PATHS` in `src/lib/sitemap.ts`: the hub routes from
  `routeMeta.ts` plus `TOOL_PATHS` (`/craft/`, `/artist/`, which `launch.ts` links to). There is
  no hand-written `public/sitemap.xml`. `src/lib/sitemap.test.ts` reads `App.tsx`'s route tree
  (leaving out the `*` catch-all and the `index.html` redirects) and fails when it and the list
  disagree. A hub page's `<lastmod>` is the committer date of the last commit to its files in
  `PAGE_SOURCES`; without git, outside a repository, or when the commit found is a shallow
  clone's cut-off end, the entry has no `<lastmod>`. The tools never get one: their sources are
  other packages', which the hub's Turbo-cached build would not notice change. `robots.txt`
  (still in `public/`) names `https://www.escapesuite.io/sitemap.xml`.
