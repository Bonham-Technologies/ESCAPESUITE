import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-196: `vercel.json`'s SPA catch-all used to be a PREFIX test
 * (`/((?!craft|artist|assets|favicon).*)`), so a path that merely *started
 * with* one of those words — without actually being under that directory —
 * matched no rewrite and 404'd on the real deployment (`/artist-guide`,
 * `/crafting-tips`, `/craftsmanship`, ...). The segment-anchored fix
 * (`/((?!(?:craft|artist|assets|favicon)(?:/|$)).*)`) routes every one of
 * those look-alikes to the hub SPA instead — verified directly: with the
 * fix applied, `resolveFile('/craftsmanship', ...)` resolves to the hub's
 * `index.html`, not a miss. `scripts/serve-dist.mjs` now derives its
 * rewrite table from `vercel.json` itself (see `serve-dist.test.mjs`'s
 * drift-guard test), so a genuine miss — a path actually excluded from the
 * catch-all (its first segment literally `assets` or `favicon`) that isn't
 * on disk either — reaches `dist/404.html` (a byte-for-byte copy of the
 * hub's `index.html`, so the SPA shell can still render its own not-found
 * UI) with a real 404 status, rather than silently falling through to the
 * hub with a 200 the way the old hand-coded table did, or to serve-dist's
 * old plain-text 404 body, which this suite could never exercise before.
 */
test.describe('production: vercel.json rewrite parity (ESCSUITE-196)', () => {
  test('a path excluded from the catch-all with no file on disk gets the custom 404 page', async ({
    request,
  }) => {
    const missResponse = await request.get(
      'http://localhost:5190/assets/does-not-exist-escsuite-196.js'
    )
    expect(missResponse.status()).toBe(404)

    // dist/404.html is a byte-for-byte copy of the hub's own index.html
    // (scripts/build-all.mjs) — the "SPA fallback body".
    const indexResponse = await request.get('http://localhost:5190/')
    expect(await missResponse.text()).toBe(await indexResponse.text())
  })

  test('/privacy reaches the hub SPA with a 200', async ({ request }) => {
    const response = await request.get('http://localhost:5190/privacy')
    expect(response.status()).toBe(200)
  })

  // Review round 1, finding 1: pin a look-alike path end to end against the
  // real production layout too, not just the unit-level regression test in
  // serve-dist.test.mjs. `/artist-guide` only shares a word-prefix with
  // `artist` — it isn't under /artist/ — and 404'd under the old prefix-test
  // pattern.
  test('/artist-guide (a look-alike, not the artist app) reaches the hub SPA with a 200', async ({
    request,
  }) => {
    const response = await request.get('http://localhost:5190/artist-guide')
    expect(response.status()).toBe(200)

    const indexResponse = await request.get('http://localhost:5190/')
    expect(await response.text()).toBe(await indexResponse.text())
  })
})
