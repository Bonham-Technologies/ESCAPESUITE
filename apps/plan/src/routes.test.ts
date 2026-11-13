import vercelConfig from '../../../vercel.json'
import { HUB_PATHS } from './routes'

/**
 * ESCSUITE-455: `vercel.json` used to rewrite every path outside craft, artist and
 * assets to the hub's `index.html`, so a made-up URL answered 200 with the home page
 * (a soft 404). It now rewrites exactly the hub's own routes, so anything else falls
 * through to `404.html` with status 404. This pins the two lists to each other:
 * add a hub page without its rewrite (or the reverse) and this fails.
 */
const rewrites: ReadonlyArray<{ source: string; destination: string }> = vercelConfig.rewrites

describe('vercel.json rewrites and the hub routes (ESCSUITE-455)', () => {
  it('rewrites exactly the hub routes to the hub, and nothing else', () => {
    const hubSources = rewrites
      .filter(({ destination }) => destination === '/index.html')
      .map(({ source }) => source)
    expect([...hubSources].sort()).toEqual([...HUB_PATHS].sort())
  })

  it('keeps the CRAFT and ARTIST SPA fallbacks', () => {
    expect(rewrites).toContainEqual({ source: '/craft/(.*)', destination: '/craft/index.html' })
    expect(rewrites).toContainEqual({ source: '/artist/(.*)', destination: '/artist/index.html' })
    expect(rewrites).toHaveLength(HUB_PATHS.length + 2)
  })

  // Before ESCSUITE-455 the catch-all also served `/privacy/` (with the slash) as
  // the page. Without a rewrite for it, it would now 404, breaking any link that
  // used it; a permanent redirect to the canonical path keeps those links working.
  it('redirects each hub page with a trailing slash to its canonical path', () => {
    const redirects: ReadonlyArray<{ source: string; destination: string; permanent?: boolean }> =
      vercelConfig.redirects
    for (const path of HUB_PATHS.filter((p) => p !== '/')) {
      expect(redirects).toContainEqual({ source: `${path}/`, destination: path, permanent: true })
    }
  })

  it('lists the hub routes as plain paths', () => {
    expect(HUB_PATHS).toEqual(['/', '/privacy', '/terms', '/limitations'])
  })
})
