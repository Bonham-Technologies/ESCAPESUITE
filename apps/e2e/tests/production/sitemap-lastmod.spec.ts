import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-490: the hub's build dated each page's `<lastmod>` from git history,
 * but the hosting builds from a shallow clone, where that history is cut off.
 * The live `sitemap.xml` listed every page with no `<lastmod>` at all, so
 * crawlers got no freshness signal for the hub.
 *
 * The dates now come from a committed manifest
 * (`apps/plan/src/lib/sitemap-lastmod.json`, kept current by
 * `scripts/sitemap-lastmod.test.mjs`), so they are the same in any clone, at any
 * depth. This reads the `sitemap.xml` that `pnpm build:deploy` wrote, served by
 * `scripts/serve-dist.mjs` (port 5190).
 */
const BASE = 'http://localhost:5190'
const ORIGIN = 'https://escapesuite.io'
const HUB_PAGES = ['/', '/privacy', '/terms', '/limitations']

/** W3C Datetime as sitemaps.org accepts it: a date, or a date and time with a zone. */
const W3C_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/

test.describe('production: the sitemap dates every hub page (ESCSUITE-490)', () => {
  test('each hub page in sitemap.xml carries a plausible <lastmod>', async ({ request }) => {
    const response = await request.get(`${BASE}/sitemap.xml`)
    expect(response.status()).toBe(200)
    const xml = await response.text()

    const lastmods = new Map<string, string | undefined>()
    for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1].trim() ?? ''
      lastmods.set(loc.slice(ORIGIN.length), /<lastmod>([^<]+)<\/lastmod>/.exec(body)?.[1].trim())
    }

    for (const path of HUB_PAGES) {
      expect(lastmods.has(path), `${path} is listed`).toBe(true)
      const lastmod = lastmods.get(path)
      expect(lastmod, `${path} <lastmod>`).toMatch(W3C_DATE)
      const time = Date.parse(lastmod!)
      // Not before the suite existed, and never in the future.
      expect(time, `${path} <lastmod> ${lastmod}`).toBeGreaterThan(Date.parse('2024-01-01'))
      expect(time, `${path} <lastmod> ${lastmod}`).toBeLessThanOrEqual(Date.now())
    }
  })
})
