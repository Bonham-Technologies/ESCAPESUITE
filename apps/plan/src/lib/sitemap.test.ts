import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { Navigate, createRoutesFromChildren, type RouteObject } from 'react-router-dom'
import App from '../App'
import { ROUTE_PATHS, SITE_URL } from './routeMeta'
import { toolUrl } from './launch'
import { PAGE_LASTMOD, SITEMAP_PATHS, TOOL_PATHS, buildSitemapXml, sitemapEntries } from './sitemap'

/**
 * ESCSUITE-457: `public/sitemap.xml` was hand-written, so a page added to the
 * router could be left out of it. The build now writes it from `SITEMAP_PATHS`,
 * and this file pins that list to the routes the hub's router actually serves.
 */

/**
 * Every page path the hub's router serves, read from the `<Routes>` tree
 * `App` renders. Layout routes (those with children) are not pages; the
 * catch-all `*` (the not-found page) and the `<Navigate>` aliases
 * (`/index.html`, `/privacy/index.html`, ...) are not either.
 */
function routerPaths(routes: RouteObject[], base = ''): string[] {
  return routes.flatMap((route) => {
    const path = route.index ? base || '/' : joinPath(base, route.path ?? '')
    if (route.children) return routerPaths(route.children, path)
    if (route.path === '*') return []
    if (isValidElement(route.element) && route.element.type === Navigate) return []
    return [path]
  })
}

function joinPath(base: string, path: string): string {
  if (path.startsWith('/')) return path
  return `${base.replace(/\/$/, '')}/${path}`
}

function hubRouterPaths(): string[] {
  const routes = App() as ReactElement<{ children: ReactNode }>
  return routerPaths(createRoutesFromChildren(routes.props.children))
}

const sorted = (paths: readonly string[]) => [...paths].sort()

describe('SITEMAP_PATHS and the router (ESCSUITE-457)', () => {
  it('reads real pages from the router, not the catch-all or the index.html aliases', () => {
    expect(sorted(hubRouterPaths())).toEqual(['/', '/limitations', '/privacy', '/terms'])
  })

  it('lists every page the router serves, and no page it does not, besides the two tools', () => {
    const toolPaths: readonly string[] = Object.values(TOOL_PATHS)
    const hubInSitemap = SITEMAP_PATHS.filter((path) => !toolPaths.includes(path))
    expect(sorted(hubInSitemap)).toEqual(sorted(hubRouterPaths()))
  })

  it('lists ESCAPECRAFT and ESCAPEARTIST at the paths the hub launches them from', () => {
    expect(SITEMAP_PATHS).toContain(TOOL_PATHS.craft)
    expect(SITEMAP_PATHS).toContain(TOOL_PATHS.artist)
    vi.stubEnv('DEV', false)
    try {
      expect(toolUrl('craft')).toBe(TOOL_PATHS.craft)
      expect(toolUrl('artist')).toBe(TOOL_PATHS.artist)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('has no duplicates', () => {
    expect(new Set(SITEMAP_PATHS).size).toBe(SITEMAP_PATHS.length)
  })
})

/**
 * ESCSUITE-490: the dates came from git at build time, and the hosting's
 * shallow clone left every page without one. They now come from the committed
 * `sitemap-lastmod.json`; `scripts/sitemap-lastmod.test.mjs` checks its hashes
 * against the files, and these check its shape against the routes.
 */
describe('PAGE_LASTMOD (ESCSUITE-490)', () => {
  const sourceFiles = Object.keys(import.meta.glob('/src/**/*.{ts,tsx}'))

  it('has an entry for every hub route and for nothing else', () => {
    expect(sorted(Object.keys(PAGE_LASTMOD))).toEqual(sorted(ROUTE_PATHS))
  })

  it.each(Object.entries(PAGE_LASTMOD))('%s names source files that exist', (_path, { sources }) => {
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(sourceFiles, source).toContain(`/${source}`)
    }
  })

  it.each(Object.entries(PAGE_LASTMOD))('%s has a real calendar day, not in the future', (path, { lastmod }) => {
    expect(lastmod, path).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // A day such as 2026-02-30 would parse into March: it must come back as written.
    expect(new Date(`${lastmod}T00:00:00Z`).toISOString().slice(0, 10), path).toBe(lastmod)
    expect(lastmod >= '2024-01-01', path).toBe(true)
    expect(lastmod <= new Date().toISOString().slice(0, 10), path).toBe(true)
  })

  it.each(Object.entries(PAGE_LASTMOD))('%s records a SHA-256 of its sources', (path, { sha256 }) => {
    expect(sha256, path).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('sitemapEntries and buildSitemapXml (ESCSUITE-457, ESCSUITE-490)', () => {
  it('gives every listed path a canonical URL, and every hub page its date from PAGE_LASTMOD', () => {
    const entries = sitemapEntries()
    expect(entries.map(({ loc }) => loc)).toEqual(SITEMAP_PATHS.map((path) => `${SITE_URL}${path}`))
    expect(entries.filter((entry) => entry.lastmod)).toEqual(
      ROUTE_PATHS.map((path) => ({ loc: `${SITE_URL}${path}`, lastmod: PAGE_LASTMOD[path].lastmod }))
    )
  })

  it('never dates the tools, whose sources the hub build cannot see change', () => {
    const tools = sitemapEntries().filter(({ loc }) => loc.endsWith('/craft/') || loc.endsWith('/artist/'))
    expect(tools).toEqual([{ loc: `${SITE_URL}/craft/` }, { loc: `${SITE_URL}/artist/` }])
  })

  it('writes a sitemaps.org urlset, with lastmod only on dated entries', () => {
    const xml = buildSitemapXml([
      { loc: 'https://escapesuite.tech/' },
      { loc: 'https://escapesuite.tech/a?b=1&c=<2>', lastmod: '2026-10-01T12:00:00+02:00' },
    ])
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://escapesuite.tech/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>https://escapesuite.tech/a?b=1&amp;c=&lt;2&gt;</loc>',
        '    <lastmod>2026-10-01T12:00:00+02:00</lastmod>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n')
    )
  })

  it('lists the hub pages, each with a <lastmod>, and both tools on the canonical host', () => {
    const xml = buildSitemapXml(sitemapEntries())
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual([
      'https://escapesuite.tech/',
      'https://escapesuite.tech/privacy',
      'https://escapesuite.tech/terms',
      'https://escapesuite.tech/limitations',
      'https://escapesuite.tech/craft/',
      'https://escapesuite.tech/artist/',
    ])
    expect(xml.match(/<lastmod>/g)).toHaveLength(ROUTE_PATHS.length)
  })
})
