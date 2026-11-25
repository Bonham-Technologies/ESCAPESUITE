import { test, expect, type APIRequestContext } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-458: the hosting served `/privacy`, `/terms` and `/limitations` the
 * hub's one `index.html`, so before any JavaScript ran each of them carried the
 * home page's title, description and `rel="canonical"` (pointing at `/`).
 * `apps/plan/src/lib/seo.ts` corrected them only after the page loaded, and a
 * search engine reading the served HTML saw three duplicates of the home page.
 *
 * The hub's build now writes one HTML file per route with that route's head,
 * from the same metadata `seo.ts` reads. This reads the HTML exactly as served
 * (no JavaScript) for every route in `sitemap.xml` and checks its title,
 * description and canonical, and the length limits search engines show in full
 * (title 60 characters or fewer, description 50 to 160).
 *
 * Runs against `pnpm build:deploy` + `scripts/serve-dist.mjs` (port 5190), which
 * resolves requests from `vercel.json` itself.
 */
const BASE = 'http://localhost:5190'
const ORIGIN = 'https://escapesuite.tech'

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Every value the served `<head>` gives for one tag, entities decoded. */
function served(html: string) {
  const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const all = (pattern: RegExp) => [...head.matchAll(pattern)].map((m) => decodeEntities(m[1]))
  const meta = (attr: 'name' | 'property', key: string) =>
    all(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'g'))
  return {
    titles: all(/<title>([\s\S]*?)<\/title>/g),
    descriptions: meta('name', 'description'),
    canonicals: all(/<link\s+rel="canonical"\s+href="([^"]*)"/g),
    meta,
  }
}

async function sitemapUrls(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(`${BASE}/sitemap.xml`)
  expect(response.status()).toBe(200)
  return [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
}

interface ServedHead {
  url: string
  title: string
  description: string
}

test.describe('production: every sitemap route serves its own head (ESCSUITE-458)', () => {
  test('the sitemap lists the hub pages and both tools', async ({ request }) => {
    const paths = (await sitemapUrls(request)).map((url) => url.slice(ORIGIN.length))
    for (const path of ['/', '/craft/', '/artist/', '/privacy', '/terms', '/limitations']) {
      expect(paths).toContain(path)
    }
  })

  test('each route has one title, description and self-referencing canonical before JavaScript', async ({
    request,
  }) => {
    const heads: ServedHead[] = []

    for (const url of await sitemapUrls(request)) {
      expect(url.startsWith(`${ORIGIN}/`), url).toBe(true)
      const path = url.slice(ORIGIN.length)
      const response = await request.get(`${BASE}${path}`, { maxRedirects: 0 })
      expect(response.status(), path).toBe(200)

      const head = served(await response.text())
      expect(head.titles, `${path} <title>`).toHaveLength(1)
      expect(head.descriptions, `${path} meta description`).toHaveLength(1)
      expect(head.canonicals, `${path} canonical`).toEqual([url])
      const [title] = head.titles
      const [description] = head.descriptions

      expect(title.length, `${path} title "${title}"`).toBeLessThanOrEqual(60)
      expect(description.length, `${path} description "${description}"`).toBeGreaterThanOrEqual(50)
      expect(description.length, `${path} description "${description}"`).toBeLessThanOrEqual(160)

      // Social tags name the page they are on.
      for (const ogUrl of head.meta('property', 'og:url')) expect(ogUrl, `${path} og:url`).toBe(url)

      // The hub's social tags follow the route; CRAFT's and ARTIST's keep
      // their own wording in their own index.html.
      if (!path.startsWith('/craft/') && !path.startsWith('/artist/')) {
        expect(head.meta('property', 'og:title'), `${path} og:title`).toEqual([title])
        expect(head.meta('property', 'og:description'), `${path} og:description`).toEqual([description])
        expect(head.meta('name', 'twitter:title'), `${path} twitter:title`).toEqual([title])
        expect(head.meta('name', 'twitter:description'), `${path} twitter:description`).toEqual([
          description,
        ])
      }

      heads.push({ url, title, description })
    }

    // No two routes share a title or a description.
    expect(new Set(heads.map((h) => h.title)).size, JSON.stringify(heads, null, 2)).toBe(heads.length)
    expect(new Set(heads.map((h) => h.description)).size, JSON.stringify(heads, null, 2)).toBe(
      heads.length
    )
  })

  // seo.ts sets the head again once the page runs (for in-app navigation); it
  // must land on exactly what was served, so the canonical never changes.
  for (const path of ['/', '/privacy', '/terms', '/limitations']) {
    test(`${path}: the head the page sets matches the head it was served`, async ({ page, request }) => {
      const head = served(await (await request.get(`${BASE}${path}`)).text())

      await page.route('**/va.vercel-scripts.com/**', (route) => route.abort())
      await page.goto(`${BASE}${path}`)
      await waitForAppReady(page, 'plan')

      await expect(page).toHaveTitle(head.titles[0])
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', head.canonicals[0])
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        head.descriptions[0]
      )
    })
  }
})
