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
 * The JSON-LD block in `index.html` is the same on every route, except that
 * `applyRouteHead` writes its `operatingSystem` from `SUPPORTED_BROWSERS`
 * below (ESCSUITE-465), so every served page names the same browsers.
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

/**
 * The browsers that both record and export video, as the README's "Browser
 * support" section lists them; the hub's JSON-LD names them as its
 * `operatingSystem`. `routeMeta.test.tsx` reads the README sentence and fails
 * when this list and it disagree, so change both together.
 */
export const SUPPORTED_BROWSERS = ['Chrome', 'Edge', 'Firefox 155+', 'Safari 26.6+'] as const

/** The JSON-LD `operatingSystem` on every hub page (ESCSUITE-465). */
export const STRUCTURED_DATA_OPERATING_SYSTEM = `Web (${SUPPORTED_BROWSERS.join(', ')})`

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

/** A string's content as a JSON string literal, safe inside a `<script>` element. */
function escapeJsonString(text: string): string {
  return JSON.stringify(text).slice(1, -1).replace(/</g, '\\u003c')
}

/**
 * The not-found page's head (ESCSUITE-489): what `pages/NotFound` sets as it
 * runs, and what the build writes into `404.html`, the page the hosting serves
 * with status 404 for any path that is not a route. It has no canonical or
 * og:url (a dead URL has no address of its own to name) and tells search
 * engines not to index it.
 */
export const NOT_FOUND_META: RouteMeta = {
  title: 'Page not found — ESCAPE Suite',
  description: 'This page does not exist. Go to the ESCAPE Suite home page, or open the recorder or the editor.',
}

/** Where the build writes the not-found page, relative to `dist/`. */
export const NOT_FOUND_HTML_FILE = '404.html'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CANONICAL = /(<link\s+rel="canonical"\s+href=")[^"]*(")/
const metaTag = (attr: 'name' | 'property', key: string) =>
  new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`)

/**
 * Sets the title, description and the og:/twitter: tags that repeat them. The
 * title and description must already be there (the build fails, naming the tag
 * and `caller`, rather than serving a page without one); a social tag that is
 * not there is left out.
 */
function setTitleAndDescription(html: string, { title, description }: RouteMeta, caller: string): string {
  const replace = (source: string, pattern: RegExp, value: string, required: string | null) => {
    if (!pattern.test(source)) {
      if (required) throw new Error(`${caller}: index.html has no ${required}`)
      return source
    }
    return source.replace(pattern, (_match, open: string, close: string) => `${open}${escapeHtml(value)}${close}`)
  }

  let out = replace(html, /(<title>)[\s\S]*?(<\/title>)/, title, '<title>')
  out = replace(out, metaTag('name', 'description'), description, 'meta description')
  out = replace(out, metaTag('property', 'og:title'), title, null)
  out = replace(out, metaTag('property', 'og:description'), description, null)
  out = replace(out, metaTag('name', 'twitter:title'), title, null)
  out = replace(out, metaTag('name', 'twitter:description'), description, null)
  return out
}

/**
 * Returns `html` with its head set to `path`'s title, description, canonical,
 * the Open Graph and Twitter tags that repeat them, and the JSON-LD
 * `operatingSystem`. The title, description, canonical and `operatingSystem`
 * must already be there (the build fails, naming the tag, if one
 * is missing, rather than serving a page without it); a social tag that is not
 * there is left out.
 */
export function applyRouteHead(html: string, path: HubPath): string {
  const url = escapeHtml(`${SITE_URL}${path}`)
  if (!CANONICAL.test(html)) throw new Error('applyRouteHead: index.html has no canonical link')
  let out = setTitleAndDescription(html, ROUTE_META[path], 'applyRouteHead')
  out = out.replace(CANONICAL, (_match, open: string, close: string) => `${open}${url}${close}`)
  out = out.replace(metaTag('property', 'og:url'), (_match, open: string, close: string) => `${open}${url}${close}`)
  const jsonLdOperatingSystem = /(<script type="application\/ld\+json">[^<]*?"operatingSystem"\s*:\s*")(?:[^"\\]|\\.)*(")/
  if (!jsonLdOperatingSystem.test(out)) throw new Error('applyRouteHead: index.html has no JSON-LD operatingSystem')
  out = out.replace(
    jsonLdOperatingSystem,
    (_match, open: string, close: string) => `${open}${escapeJsonString(STRUCTURED_DATA_OPERATING_SYSTEM)}${close}`
  )
  return out
}

/**
 * Returns `html` with the not-found head (`NOT_FOUND_META`): its title,
 * description and social tags, a `<meta name="robots" content="noindex">` after
 * the description, and no canonical link or og:url (each tag removed with its
 * line).
 */
export function applyNotFoundHead(html: string): string {
  let out = setTitleAndDescription(html, NOT_FOUND_META, 'applyNotFoundHead')
  const wholeTag = (open: RegExp) => new RegExp(`\\n?[ \\t]*${open.source}[^>]*>`)
  out = out.replace(wholeTag(/<link\s+rel="canonical"/), '')
  out = out.replace(wholeTag(/<meta\s+property="og:url"/), '')
  const robots = metaTag('name', 'robots')
  if (robots.test(out)) {
    return out.replace(robots, (_match, open: string, close: string) => `${open}noindex${close}`)
  }
  return out.replace(/([ \t]*)(<meta\s+name="description"[^>]*>)/, '$1$2\n$1<meta name="robots" content="noindex" />')
}
