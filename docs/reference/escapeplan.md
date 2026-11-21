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
- Structured data (ESCSUITE-465): `index.html`'s JSON-LD block ships on every route. Its
  `operatingSystem` comes from `SUPPORTED_BROWSERS` in `src/lib/routeMeta.ts`, which
  `applyRouteHead` writes into each route's HTML (the build fails if the block or the field is
  missing). `src/lib/routeMeta.test.tsx` reads the browser list from the README's "Browser
  support" sentence ("…requires the WebCodecs API, which … all provide") and fails when the two
  disagree, so change the README and the constant together.
- Sitemap (ESCSUITE-457): the build writes `dist/sitemap.xml` (the `escapeplan-sitemap` plugin in
  `vite.config.ts`) from `SITEMAP_PATHS` in `src/lib/sitemap.ts`: the hub routes from
  `routeMeta.ts` plus `TOOL_PATHS` (`/craft/`, `/artist/`, which `launch.ts` links to). There is
  no hand-written `public/sitemap.xml`. `src/lib/sitemap.test.ts` reads `App.tsx`'s route tree
  (leaving out the `*` catch-all and the `index.html` redirects) and fails when it and the list
  disagree. A hub page's `<lastmod>` is the committer date of the last commit to its files in
  `PAGE_SOURCES`; without git, outside a repository, or when the commit found is a shallow
  clone's cut-off end, the entry has no `<lastmod>`. The tools never get one: their sources are
  other packages', which the hub's Turbo-cached build would not notice change. Vercel builds
  from a shallow clone, so in production a page keeps its `<lastmod>` only while its last change
  is within the fetched history; older pages are listed without one. `robots.txt`
  (still in `public/`) names `https://escapesuite.io/sitemap.xml`.

## Design (ESCSUITE-493)

The hub is built on the Bonham Technologies design system (the parent brand at bonham.tech): warm
paper and ink, Archivo for text, IBM Plex Mono for technical content only (code), square corners,
hairlines, open columns under a rule instead of boxed cards, no shadows or gradients. Safety
orange (`--signal-fill`, text on it `--signal-on`) is the action colour: one primary button per
view (the hero's "Start recording"); every other button is outlined. Focus rings are blue
(`--focus-ring`).

ESCAPE Suite's own identity inside that system (owner, 2026-11-17):

- **Accent: teal** (`--accent`, `#0f6b70` Daylight, `#6cc7c9` Night): the square in the lockup,
  icons, link underlines, list markers and the frame's corners. It never fills a button.
- **Motif: the frame.** A recording frame with its picture-in-picture panel and the timeline's
  panels under it: the drawing in the hero (`.frame` in `Home.module.css`, coloured from tokens),
  and the favicon.
- **Lockup:** accent square, `ESCAPE SUITE`, "by Bonham Technologies". The parent's name sits
  beside the home link, not in it, so the link's visible text stays "ESCAPE Suite" (ESCSUITE-334).
  There is no logo mark.
- The parent's terrain imagery and forest green stay on bonham.tech and are not used here.

Tokens live in `apps/plan/src/index.css` and keep the names the shared components read
(`--bg-primary` ground, `--bg-secondary` surface, `--bg-tertiary` raised or sunken, `--text-*`,
`--border`, `--accent`), so `ThemeToggle` and `ErrorBoundary` follow the palette without a change
to `packages/shared`. Night is `:root` and Daylight is `:root[data-theme="light"]`, as the shared
theme module switches them. ESCAPECRAFT and ESCAPEARTIST keep their own look.

Fonts are self-hosted from `apps/plan/src/assets/fonts/` (latin subsets, SIL Open Font License;
the licences are served from `/licenses/` and named in `NOTICE`). `public/og.png` is
`apps/plan/tools/og.html` rendered in Chromium at 1200 × 630.
