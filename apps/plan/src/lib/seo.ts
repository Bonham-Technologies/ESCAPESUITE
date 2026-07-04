import { useEffect } from 'react'

const SITE_URL = 'https://www.escapesuite.io'

export const DEFAULT_TITLE = "ESCAPE Suite — How-to videos for networks the cloud can't reach."
export const DEFAULT_DESCRIPTION =
  'Air-gapped Site License for screencasts on isolated and regulated networks. Host one signed, offline copy and your whole team records and edits walkthroughs in the browser — nothing leaves the network. Hosted in-browser recorder and editor also available.'

interface SeoOptions {
  title: string
  description?: string
  /** Path (starting with "/") used to build the canonical URL. */
  canonicalPath: string
  /** Set true for pages that should not be indexed (auth, dashboard, 404). */
  noindex?: boolean
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
 * Updates the head tags that ship in index.html so every route declares its
 * own canonical URL, title, and description. The static index.html is served
 * for all SPA routes, so without this every route claims to be the homepage —
 * which Search Console reports as "Duplicate without user-selected canonical".
 * Tags are mutated in place (never duplicated) so exactly one canonical and
 * one robots directive exist at any time.
 */
export function useSeo({ title, description = DEFAULT_DESCRIPTION, canonicalPath, noindex = false }: SeoOptions): void {
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

    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (noindex) {
      if (robots) {
        robots.setAttribute('content', 'noindex, nofollow')
      } else {
        upsertMeta('name', 'robots', 'noindex, nofollow')
      }
    } else if (robots) {
      robots.remove()
    }
  }, [title, description, canonicalPath, noindex])
}
