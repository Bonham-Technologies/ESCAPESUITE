import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-455: `vercel.json`'s last rewrite sent every path outside craft,
 * artist and assets to the hub's `index.html`, so a made-up URL such as
 * `/no-such-page-xyz` answered 200 with the home page. Search engines report
 * that as a "soft 404" and can index it as a duplicate of the home page.
 *
 * The hub's own routes are now rewritten one by one, so a path that is none of
 * them falls through to `dist/404.html` with status 404, and the page it loads
 * says the page was not found and links home, CRAFT and ARTIST.
 * `scripts/serve-dist.mjs` resolves requests from `vercel.json` itself, so this
 * runs against the real rewrite table.
 */
const BASE = 'http://localhost:5190'

test.describe('production: unknown paths are real 404s (ESCSUITE-455)', () => {
  test('a made-up path answers 404', async ({ request }) => {
    const response = await request.get(`${BASE}/no-such-page-xyz`)
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toMatch(/^text\/html/)
  })

  test('the 404 page says so and links home, CRAFT and ARTIST', async ({ page }) => {
    const response = await page.goto(`${BASE}/no-such-page-xyz`)
    expect(response?.status()).toBe(404)

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveURL(`${BASE}/no-such-page-xyz`)
    await expect(page).toHaveTitle(/page not found/i)

    const main = page.getByRole('main')
    await expect(main.getByRole('link', { name: /home page/i })).toHaveAttribute('href', '/')
    await expect(main.getByRole('link', { name: /ESCAPECRAFT/ })).toHaveAttribute('href', '/craft/')
    await expect(main.getByRole('link', { name: /ESCAPEARTIST/ })).toHaveAttribute('href', '/artist/')

    await main.getByRole('link', { name: /home page/i }).click()
    await expect(page).toHaveURL(`${BASE}/`)
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  for (const path of ['/', '/privacy', '/terms', '/limitations']) {
    test(`hub route ${path} answers 200 with the hub`, async ({ request }) => {
      const response = await request.get(`${BASE}${path}`)
      expect(response.status()).toBe(200)
      const hub = await request.get(`${BASE}/`)
      expect(await response.text()).toBe(await hub.text())
    })
  }

  for (const path of ['/craft/', '/craft/index.html', '/artist/', '/artist/index.html']) {
    test(`app document ${path} answers 200`, async ({ request }) => {
      const response = await request.get(`${BASE}${path}`, { maxRedirects: 0 })
      expect(response.status()).toBe(200)
    })
  }

  for (const [path, app] of [
    ['/craft/some/deep/link', 'craft'],
    ['/artist/some/deep/link', 'artist'],
  ] as const) {
    test(`deep link ${path} still reaches /${app}/`, async ({ request }) => {
      const response = await request.get(`${BASE}${path}?x=1`)
      expect(response.status()).toBe(200)
      expect(response.url()).toBe(`${BASE}/${app}/?x=1`)
    })
  }
})
