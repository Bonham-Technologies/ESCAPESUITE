/**
 * The hosted site's `sitemap.xml`, written by the hub's build (ESCSUITE-457).
 *
 * It used to be a hand-written `public/sitemap.xml`, which nothing tied to the
 * router, so a new page could be left out. The build now writes it from
 * `SITEMAP_PATHS`: the hub's routes from `routeMeta.ts` (which `routes.test.ts`
 * pins to `routes.ts`, the list `App.tsx` registers) plus the two tools.
 * `sitemap.test.ts` reads the router itself and fails when the two disagree.
 *
 * Each hub page's `<lastmod>` comes from the committed `sitemap-lastmod.json`
 * (ESCSUITE-490), so the date is the same in any clone and without git.
 *
 * Pure data and strings with no DOM, React or Node, because `vite.config.ts`
 * imports it in Node and the tests run it in jsdom.
 */
import { ROUTE_PATHS, SITE_URL, type HubPath } from './routeMeta'
import pageLastmod from './sitemap-lastmod.json'

/** Where the hosted site serves each tool. `launch.ts` links to them here. */
export const TOOL_PATHS = { craft: '/craft/', artist: '/artist/' } as const

/** Every path the sitemap lists: the hub's pages, then the tools. */
export const SITEMAP_PATHS: readonly string[] = [...ROUTE_PATHS, ...Object.values(TOOL_PATHS)]

export interface PageLastmod {
  /** The day the page last changed, `YYYY-MM-DD`. */
  lastmod: string
  /** The files (relative to `apps/plan`) that make up the page. */
  sources: readonly string[]
  /** SHA-256 of `sources`, which `scripts/sitemap-lastmod.test.mjs` checks. */
  sha256: string
}

/**
 * Each hub page's `lastmod`, from the committed `sitemap-lastmod.json`
 * (ESCSUITE-490). Typed as a record of every hub route, so a route without an
 * entry does not compile. The dates used to come from git at build time, but
 * the hosting builds from a shallow clone, where the history is cut off and
 * every page lost its date. `scripts/sitemap-lastmod.test.mjs` fails when a
 * page's files change and its entry does not; `pnpm sitemap:stamp` moves the
 * date to today. The tools have no entry: their sources are other packages',
 * which the hub's Turbo-cached build would not notice change.
 */
export const PAGE_LASTMOD: Record<HubPath, PageLastmod> = pageLastmod

export interface SitemapEntry {
  loc: string
  lastmod?: string
}

/** One entry per `SITEMAP_PATHS` path, on the canonical host, the hub's pages dated. */
export function sitemapEntries(): SitemapEntry[] {
  return SITEMAP_PATHS.map((path) => {
    const lastmod = (PAGE_LASTMOD as Partial<Record<string, PageLastmod>>)[path]?.lastmod
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
