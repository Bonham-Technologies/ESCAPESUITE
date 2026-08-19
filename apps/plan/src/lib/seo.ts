import { useEffect } from 'react'

/**
 * Canonical origin. The apex domain 307-redirects to www in production, so www
 * is the indexable host — sitemap.xml, robots.txt, and every canonical here
 * must agree on it or Search Console reports duplicate/alternate-canonical
 * pages.
 */
export const SITE_URL = 'https://www.escapesuite.io'

export const DEFAULT_TITLE =
  'ESCAPE Suite — Free, open-source screen recording & video editing in your browser'
export const DEFAULT_DESCRIPTION =
  'Record your screen and edit video entirely in the browser — free, MIT-licensed, and private by design. Nothing is uploaded. Run it hosted, self-host it, or download a single-file offline build for air-gapped networks.'

interface SeoOptions {
  /** Full <title> for the route. */
  title: string
  /** Meta description; falls back to the site default. */
  description?: string
  /** Path starting with "/" used to build the canonical URL. */
  canonicalPath: string
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/**
 * Applies per-route title, description, canonical, and social tags.
 *
 * This is a single-page app served from one static index.html, so without this
 * every route would inherit the homepage's title and canonical — /privacy and
 * /terms would both claim to be "/" and get folded together by search engines.
 * Tags already present in index.html are mutated in place rather than
 * duplicated, so exactly one canonical link exists at any time.
 */
export function useSeo({
  title,
  description = DEFAULT_DESCRIPTION,
  canonicalPath,
}: SeoOptions): void {
  useEffect(() => {
    const canonicalUrl = `${SITE_URL}${canonicalPath}`

    document.title = title
    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:title', title)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', canonicalUrl)
    upsertMeta('name', 'twitter:title', title)
    upsertMeta('name', 'twitter:description', description)

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', canonicalUrl)
  }, [title, description, canonicalPath])
}
