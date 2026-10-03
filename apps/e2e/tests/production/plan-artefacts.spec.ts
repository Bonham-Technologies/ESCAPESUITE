import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-200: `apps/plan/public/` carried two stray artefacts that
 * `pnpm build:deploy` copied straight into the hosted `dist/` and
 * `vercel.json`'s filesystem-first routing served at 200 on the live origin —
 * `CNAME` (`escapesuite.io`), a leftover from a GitHub Pages era that
 * contradicted `apps/plan/src/lib/seo.ts`'s canonical-host comment, and
 * `og-image.png` (143 KB), referenced by nothing (every page uses `og.png`).
 * Both are deleted from `apps/plan/public/`.
 *
 * Deleting the files does NOT make either path 404: `vercel.json`'s SPA
 * catch-all rewrite (`/((?!craft|artist|assets|favicon).*)` → `/index.html`)
 * matches both, the same as it matches any typo'd URL, so a request that no
 * longer has a filesystem match falls through to the hub's `index.html` at
 * 200 — verified against both `serve-dist.mjs` here and the live
 * `escapesuite.io` (a nonsense path there also comes back 200, same body
 * shape). So the pin that actually holds is: the two paths stop being served
 * as *themselves* — `CNAME`'s `text/plain` content and `og-image.png`'s
 * `image/png` bytes are both gone, replaced by the SPA's `text/html` — while
 * `og.png`, the real referenced social image, keeps serving as itself.
 *
 * Runs against `pnpm build:deploy` + `scripts/serve-dist.mjs` (port 5190),
 * the only setup that reproduces the hosted single-origin layout.
 */
const BASE_URL = 'http://localhost:5190'

test.describe('ESCAPEPLAN public/ ships no stray artefacts (ESCSUITE-200)', () => {
  test('CNAME (a GitHub Pages artefact) no longer serves as itself', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/CNAME`)
    // Falls through to the SPA catch-all (200, text/html) rather than
    // serving the literal file (which would have been text/plain).
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    const body = await response.text()
    expect(body).not.toContain('escapesuite.io\n')
    expect(body.toLowerCase()).toContain('<!doctype html')
  })

  test('og-image.png (unreferenced) no longer serves as itself', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/og-image.png`)
    // Falls through to the SPA catch-all (200, text/html) rather than
    // serving the literal image (which would have been image/png).
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
  })

  test('og.png (the real, referenced social image) still serves', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/og.png`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  })
})
