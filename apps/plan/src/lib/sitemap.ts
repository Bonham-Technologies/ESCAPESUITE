/**
 * The hosted site's `sitemap.xml`, written by the hub's build (ESCSUITE-457).
 *
 * It used to be a hand-written `public/sitemap.xml`, which nothing tied to the
 * router, so a new page could be left out. The build now writes it from
 * `SITEMAP_PATHS`: the hub's routes from `routeMeta.ts` (which `routes.test.ts`
 * pins to `routes.ts`, the list `App.tsx` registers) plus the two tools.
 * `sitemap.test.ts` reads the router itself and fails when the two disagree.
 *
 * Pure strings with no DOM, React or Node, because `vite.config.ts` imports it
 * in Node and the tests run it in jsdom; the build passes in the `git` runner.
 */
import { ROUTE_PATHS, SITE_URL, type HubPath } from './routeMeta'

/** Where the hosted site serves each tool. `launch.ts` links to them here. */
export const TOOL_PATHS = { craft: '/craft/', artist: '/artist/' } as const

/** Every path the sitemap lists: the hub's pages, then the tools. */
export const SITEMAP_PATHS: readonly string[] = [...ROUTE_PATHS, ...Object.values(TOOL_PATHS)]

/**
 * The source files (relative to `apps/plan`) whose last commit dates each hub
 * page's `lastmod`. The tools have none: their sources are another package's,
 * so the hub's cached build would not notice them change and could publish an
 * old date.
 */
export const PAGE_SOURCES: Record<HubPath, readonly string[]> = {
  '/': ['src/pages/Home.tsx'],
  '/privacy': ['src/pages/Legal/Privacy.tsx'],
  '/terms': ['src/pages/Legal/Terms.tsx'],
  '/limitations': ['src/pages/Limitations/Limitations.tsx', 'src/pages/Limitations/limitations.ts'],
}

/** Runs `git` with `args` and returns its stdout, or `null` when it failed. */
export type Git = (args: readonly string[]) => string | null

/**
 * The committer date of the last commit that changed any of `sources`, or
 * `undefined` when it isn't known for sure: no sources, no git, not a
 * repository, or never committed. A parentless commit counts only in a full
 * clone, where it is the repository's first commit; in a shallow clone (as a
 * hosting build may use) it is where the fetched history was cut off, and git
 * reports it as adding every file, so its date says nothing about the page.
 */
export function lastCommitDate(git: Git, sources: readonly string[]): string | undefined {
  if (sources.length === 0) return undefined
  const line = git(['log', '-1', '--format=%cI%x00%P', '--', ...sources])?.trim()
  if (!line) return undefined
  const [date, parents] = line.split('\u0000')
  if (!parents && git(['rev-parse', '--is-shallow-repository'])?.trim() !== 'false') return undefined
  return date
}

export interface SitemapEntry {
  loc: string
  lastmod?: string
}

/** One entry per `SITEMAP_PATHS` path, on the canonical host. */
export function sitemapEntries(git: Git): SitemapEntry[] {
  return SITEMAP_PATHS.map((path) => {
    const sources = (PAGE_SOURCES as Record<string, readonly string[]>)[path] ?? []
    const lastmod = lastCommitDate(git, sources)
    return lastmod ? { loc: `${SITE_URL}${path}`, lastmod } : { loc: `${SITE_URL}${path}` }
  })
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A sitemaps.org `urlset`, with `<lastmod>` only on the entries that have one. */
export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.flatMap(({ loc, lastmod }) => [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
    '  </url>',
  ])
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
