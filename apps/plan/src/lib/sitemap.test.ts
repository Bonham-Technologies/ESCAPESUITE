import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { Navigate, createRoutesFromChildren, type RouteObject } from 'react-router-dom'
import App from '../App'
import { SITE_URL } from './routeMeta'
import { toolUrl } from './launch'
import {
  PAGE_SOURCES,
  SITEMAP_PATHS,
  TOOL_PATHS,
  buildSitemapXml,
  lastCommitDate,
  sitemapEntries,
  type Git,
} from './sitemap'

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

describe('PAGE_SOURCES (ESCSUITE-457)', () => {
  const sourceFiles = Object.keys(import.meta.glob('/src/**/*.{ts,tsx}'))

  it.each(Object.entries(PAGE_SOURCES))('%s names source files that exist', (_path, sources) => {
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(sourceFiles, source).toContain(`/${source}`)
    }
  })
})

/** A fake `git` answering from a table of `args.join(' ')` to stdout. */
function fakeGit(answers: Record<string, string | null>): Git & { calls: string[][] } {
  const calls: string[][] = []
  const git = (args: readonly string[]) => {
    calls.push([...args])
    return answers[args.join(' ')] ?? null
  }
  return Object.assign(git, { calls })
}

const LOG_HOME = 'log -1 --format=%cI%x00%P -- src/pages/Home.tsx'

describe('lastCommitDate (ESCSUITE-457)', () => {
  it("is the last commit's date when that commit has a parent", () => {
    const git = fakeGit({ [LOG_HOME]: '2026-11-10T09:30:00+00:00\u0000abc123\n' })
    expect(lastCommitDate(git, ['src/pages/Home.tsx'])).toBe('2026-11-10T09:30:00+00:00')
  })

  it('is omitted without git, outside a repository, or for a file never committed', () => {
    expect(lastCommitDate(fakeGit({}), ['src/pages/Home.tsx'])).toBeUndefined()
    expect(lastCommitDate(fakeGit({ [LOG_HOME]: '\n' }), ['src/pages/Home.tsx'])).toBeUndefined()
  })

  it('is omitted for a route with no sources, without running git', () => {
    const git = fakeGit({})
    expect(lastCommitDate(git, [])).toBeUndefined()
    expect(git.calls).toEqual([])
  })

  // A shallow clone's oldest fetched commit has its parents cut off, so git
  // reports it as adding every file: its date is not when the page changed.
  it('is omitted when the commit found is the cut-off end of a shallow clone', () => {
    const git = fakeGit({
      [LOG_HOME]: '2026-11-01T00:00:00+00:00\u0000\n',
      'rev-parse --is-shallow-repository': 'true\n',
    })
    expect(lastCommitDate(git, ['src/pages/Home.tsx'])).toBeUndefined()
  })

  it('is omitted for a parentless commit when git cannot say whether the clone is shallow', () => {
    const git = fakeGit({ [LOG_HOME]: '2026-11-01T00:00:00+00:00\u0000\n' })
    expect(lastCommitDate(git, ['src/pages/Home.tsx'])).toBeUndefined()
  })

  it("is the repository's first commit's date in a full clone", () => {
    const git = fakeGit({
      [LOG_HOME]: '2024-01-01T00:00:00+00:00\u0000\n',
      'rev-parse --is-shallow-repository': 'false\n',
    })
    expect(lastCommitDate(git, ['src/pages/Home.tsx'])).toBe('2024-01-01T00:00:00+00:00')
  })

  it('asks git about all of a route\'s sources at once', () => {
    const git = fakeGit({})
    lastCommitDate(git, ['a.ts', 'b.ts'])
    expect(git.calls[0]).toEqual(['log', '-1', '--format=%cI%x00%P', '--', 'a.ts', 'b.ts'])
  })
})

describe('sitemapEntries and buildSitemapXml (ESCSUITE-457)', () => {
  it('gives every listed path a canonical URL, and a lastmod only where git dates its sources', () => {
    const git: Git = (args) =>
      args.includes('src/pages/Legal/Privacy.tsx') ? '2026-10-01T12:00:00+02:00\u0000abc\n' : null
    const entries = sitemapEntries(git)
    expect(entries.map(({ loc }) => loc)).toEqual(SITEMAP_PATHS.map((path) => `${SITE_URL}${path}`))
    expect(entries.filter((entry) => entry.lastmod)).toEqual([
      { loc: `${SITE_URL}/privacy`, lastmod: '2026-10-01T12:00:00+02:00' },
    ])
  })

  it('never dates the tools, whose sources the hub build cannot see change', () => {
    const git: Git = () => '2026-10-01T12:00:00+02:00\u0000abc\n'
    const tools = sitemapEntries(git).filter(({ loc }) => loc.endsWith('/craft/') || loc.endsWith('/artist/'))
    expect(tools).toEqual([{ loc: `${SITE_URL}/craft/` }, { loc: `${SITE_URL}/artist/` }])
  })

  it('writes a sitemaps.org urlset, with lastmod only on dated entries', () => {
    const xml = buildSitemapXml([
      { loc: 'https://www.escapesuite.io/' },
      { loc: 'https://www.escapesuite.io/a?b=1&c=<2>', lastmod: '2026-10-01T12:00:00+02:00' },
    ])
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://www.escapesuite.io/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>https://www.escapesuite.io/a?b=1&amp;c=&lt;2&gt;</loc>',
        '    <lastmod>2026-10-01T12:00:00+02:00</lastmod>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n')
    )
  })

  it('lists the hub pages and both tools on the canonical host', () => {
    const xml = buildSitemapXml(sitemapEntries(() => null))
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual([
      'https://www.escapesuite.io/',
      'https://www.escapesuite.io/privacy',
      'https://www.escapesuite.io/terms',
      'https://www.escapesuite.io/limitations',
      'https://www.escapesuite.io/craft/',
      'https://www.escapesuite.io/artist/',
    ])
    expect(xml).not.toContain('<lastmod>')
  })
})
