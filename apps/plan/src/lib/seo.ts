import { useEffect } from 'react'
import { NOT_FOUND_META, ROUTE_META, SITE_URL, type HubPath } from './routeMeta'

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

    setTitleAndDescription(title, description)
    upsertMeta('property', 'og:url', canonicalUrl)

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', canonicalUrl)
  }, [title, description, canonicalPath])
}

function setTitleAndDescription(title: string, description: string): void {
  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
}

/**
 * The not-found page's head, the same one the hosted `404.html` is served with
 * (ESCSUITE-489): `NOT_FOUND_META`'s title and description, no canonical link
 * or og:url, and `<meta name="robots" content="noindex">`. The robots tag goes
 * when the page does, so the route the visitor moves on to is indexable again;
 * that route's own `useSeo` puts its canonical and og:url back.
 */
export function useNotFoundSeo(): void {
  useEffect(() => {
    setTitleAndDescription(NOT_FOUND_META.title, NOT_FOUND_META.description)
    document.head.querySelector('link[rel="canonical"]')?.remove()
    document.head.querySelector('meta[property="og:url"]')?.remove()
    upsertMeta('name', 'robots', 'noindex')
    return () => {
      document.head.querySelector('meta[name="robots"]')?.remove()
    }
  }, [])
}

/** `useSeo` with a hub route's head from `routeMeta.ts`, the same head its served HTML has. */
export function useRouteSeo(path: HubPath): void {
  useSeo({ ...ROUTE_META[path], canonicalPath: path })
}
