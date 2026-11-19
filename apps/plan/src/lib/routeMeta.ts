/**
 * The hub's per-route head: title, description and canonical path for every
 * route in `src/routes.ts` (ESCSUITE-458).
 *
 * The one source both sides read: `seo.ts` sets these in the page as it runs
 * (for in-app navigation), and `vite.config.ts` writes them into the HTML the
 * build serves for each route (`dist/privacy/index.html` and so on), so a
 * search engine reading the served HTML sees the same head the page sets. Pure
 * strings with no DOM or React, because `vite.config.ts` imports it in Node.
 *
 * Titles are 60 characters or fewer and descriptions 50 to 160, the lengths
 * search results show in full; `routeMeta.test.ts` and the production e2e
 * suite (`tests/production/route-heads.spec.ts`) check them.
 */

/**
 * Canonical origin. The apex domain 307-redirects to www in production, so www
 * is the indexable host — sitemap.xml, robots.txt, and every canonical here
 * must agree on it or Search Console reports duplicate/alternate-canonical
 * pages.
 */
export const SITE_URL = 'https://escapesuite.io'

export interface RouteMeta {
  title: string
  description: string
}

export const ROUTE_META = {
  '/': {
    title: 'ESCAPE Suite — Free browser screen recorder & video editor',
    description:
      'Record your screen and edit video entirely in your browser. Free and open source, nothing is uploaded, and an offline build runs on air-gapped networks.',
  },
  '/privacy': {
    title: 'Privacy Policy — ESCAPE Suite',
    description:
      'ESCAPE Suite privacy policy. Recordings and editing projects are processed entirely on your device and are never uploaded to our servers.',
  },
  '/terms': {
    title: 'Terms of Service — ESCAPE Suite',
    description:
      'ESCAPE Suite terms of service. The software is open source under the Apache License 2.0 and free to use; you own everything you record and edit with it.',
  },
  '/limitations': {
    title: 'Known limitations — ESCAPE Suite',
    description:
      'What ESCAPE Suite cannot do yet, browser by browser, what the hosted site sends, and how to check for yourself that your recordings never leave your device.',
  },
} as const satisfies Record<string, RouteMeta>

export type HubPath = keyof typeof ROUTE_META

export const ROUTE_PATHS = Object.keys(ROUTE_META) as HubPath[]

/**
 * The hub route a request URL is for (query and hash ignored), or `/` for any
 * URL that is not one: the dev server's fallback serves `index.html` for every
 * path, and the build transforms `index.html` itself with no URL at all.
 */
export function hubPathFor(url: string | undefined): HubPath {
  const path = (url ?? '/').split(/[?#]/)[0]
  return (ROUTE_PATHS as string[]).includes(path) ? (path as HubPath) : '/'
}

/** Where the build writes a route's HTML, relative to `dist/`. */
export function routeHtmlFile(path: HubPath): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Returns `html` with its head set to `path`'s title, description, canonical,
 * and the Open Graph and Twitter tags that repeat them. The title, description
 * and canonical must already be there (the build fails, naming the tag, if one
 * is missing, rather than serving a page without it); a social tag that is not
 * there is left out.
 */
export function applyRouteHead(html: string, path: HubPath): string {
  const { title, description } = ROUTE_META[path]
  const url = `${SITE_URL}${path}`

  const replace = (source: string, pattern: RegExp, value: string, required: string | null) => {
    if (!pattern.test(source)) {
      if (required) throw new Error(`applyRouteHead: index.html has no ${required}`)
      return source
    }
    return source.replace(pattern, (_match, open: string, close: string) => `${open}${escapeHtml(value)}${close}`)
  }
  const meta = (attr: 'name' | 'property', key: string) =>
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`)

  let out = replace(html, /(<title>)[\s\S]*?(<\/title>)/, title, '<title>')
  out = replace(out, meta('name', 'description'), description, 'meta description')
  out = replace(out, /(<link\s+rel="canonical"\s+href=")[^"]*(")/, url, 'canonical link')
  out = replace(out, meta('property', 'og:title'), title, null)
  out = replace(out, meta('property', 'og:description'), description, null)
  out = replace(out, meta('property', 'og:url'), url, null)
  out = replace(out, meta('name', 'twitter:title'), title, null)
  out = replace(out, meta('name', 'twitter:description'), description, null)
  return out
}
