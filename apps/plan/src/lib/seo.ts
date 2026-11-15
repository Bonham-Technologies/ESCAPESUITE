import { useEffect } from 'react'
import { ROUTE_META, SITE_URL, type HubPath } from './routeMeta'

export { SITE_URL }

interface SeoOptions {
  /** Full <title> for the route. */
  title: string
  /** Meta description. */
  description: string
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
 * The hosted site serves each hub route its own HTML with this head already in
 * it (ESCSUITE-458, written by `vite.config.ts` from `routeMeta.ts`); this keeps
 * the head right as the visitor moves between routes inside the app, where no
 * new HTML is loaded. Tags already present are mutated in place rather than
 * duplicated, so exactly one canonical link exists at any time.
 */
export function useSeo({ title, description, canonicalPath }: SeoOptions): void {
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

/** `useSeo` with a hub route's head from `routeMeta.ts`, the same head its served HTML has. */
export function useRouteSeo(path: HubPath): void {
  useSeo({ ...ROUTE_META[path], canonicalPath: path })
}
