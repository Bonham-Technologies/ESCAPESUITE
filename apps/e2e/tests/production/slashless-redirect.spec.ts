import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-234: `vercel.json` used to REWRITE `/artist` to `/artist/index.html`,
 * so the document URL stayed `/artist` and the inlined bundle's
 * `new URL('decodeWorker-<hash>.js', import.meta.url)` resolved against the site
 * root, where the hub's catch-all answers `200 text/html` and the decode worker
 * never starts. `/craft` and `/artist` (and any deep path under them) now
 * REDIRECT to the slashed document, query string intact.
 */
const BASE = 'http://localhost:5190'

test.describe('production: slashless and deep app URLs redirect (ESCSUITE-234)', () => {
  for (const app of ['craft', 'artist']) {
    test(`/${app} answers 308 to /${app}/, keeping the query string`, async ({ request }) => {
      const plain = await request.get(`${BASE}/${app}`, { maxRedirects: 0 })
      expect(plain.status()).toBe(308)
      expect(plain.headers()['location']).toBe(`/${app}/`)

      const withQuery = await request.get(`${BASE}/${app}?loadVideo=abc`, { maxRedirects: 0 })
      expect(withQuery.status()).toBe(308)
      expect(withQuery.headers()['location']).toBe(`/${app}/?loadVideo=abc`)
    })

    test(`/${app}/foo/ answers 308 to the one document /${app}/`, async ({ request }) => {
      const deep = await request.get(`${BASE}/${app}/foo/`, { maxRedirects: 0 })
      expect(deep.status()).toBe(308)
      expect(deep.headers()['location']).toBe(`/${app}/`)
    })

    test(`/${app}/ itself is served, not redirected`, async ({ request }) => {
      const doc = await request.get(`${BASE}/${app}/`, { maxRedirects: 0 })
      expect(doc.status()).toBe(200)
    })
  }

  test('loading /artist ends on /artist/ and the worker chunk it references is JavaScript', async ({
    page,
    request,
  }) => {
    await page.goto(`${BASE}/artist`)
    await expect(page).toHaveURL(`${BASE}/artist/`)

    const html = await (await request.get(`${BASE}/artist/`)).text()
    const chunk = /decodeWorker-[A-Za-z0-9_-]+\.js/.exec(html)?.[0]
    expect(chunk, 'the served HTML references the decode worker chunk').toBeTruthy()

    // Resolved the way the page resolves it: against the document URL.
    const chunkUrl = new URL(chunk as string, page.url()).href
    const response = await request.get(chunkUrl)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^(text|application)\/javascript/)

    // The inverse pin: the same name at the site root is the hub HTML, which is
    // what the slashless document URL used to resolve to.
    const atRoot = await request.get(`${BASE}/${chunk}`)
    expect(atRoot.headers()['content-type']).toMatch(/^text\/html/)
  })
})
