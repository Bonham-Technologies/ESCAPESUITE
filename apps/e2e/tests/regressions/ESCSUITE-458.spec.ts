import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-458: `/privacy`, `/terms` and `/limitations` were served with the
 * home page's title, description and canonical; only JavaScript corrected them
 * after the page loaded, so a search engine reading the HTML saw three copies
 * of the home page. The production suite (`tests/production/route-heads.spec.ts`)
 * checks the deployed layout; this checks the hub itself: the HTML it serves for
 * each route already carries that route's head, before any script runs, and it
 * is the same head the page sets once it is running.
 */
const HUB = 'http://localhost:5173'
const ORIGIN = 'https://escapesuite.io'

function decodeEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function servedHead(html: string) {
  const one = (pattern: RegExp) => {
    const matches = [...html.matchAll(pattern)]
    expect(matches, String(pattern)).toHaveLength(1)
    return decodeEntities(matches[0][1])
  }
  return {
    title: one(/<title>([\s\S]*?)<\/title>/g),
    description: one(/<meta\s+name="description"\s+content="([^"]*)"/g),
    canonical: one(/<link\s+rel="canonical"\s+href="([^"]*)"/g),
  }
}

test.describe('ESCSUITE-458: each hub route is served with its own head', () => {
  test.beforeEach(async ({ page }) => {
    // The hub's analytics script is not served locally.
    await page.route('**/va.vercel-scripts.com/**', (route) => route.abort())
  })

  test('the served HTML names each route, not the home page', async ({ request }) => {
    const heads = []
    for (const path of ['/', '/privacy', '/terms', '/limitations']) {
      const head = servedHead(await (await request.get(`${HUB}${path}`)).text())
      expect(head.canonical, path).toBe(`${ORIGIN}${path}`)
      heads.push(head)
    }
    expect(new Set(heads.map((h) => h.title)).size).toBe(heads.length)
    expect(new Set(heads.map((h) => h.description)).size).toBe(heads.length)
  })

  for (const path of ['/privacy', '/terms', '/limitations']) {
    test(`${path}: the running page keeps the head it was served`, async ({ page, request }) => {
      const head = servedHead(await (await request.get(`${HUB}${path}`)).text())

      await page.goto(`${HUB}${path}`)
      await waitForAppReady(page, 'plan')

      await expect(page).toHaveTitle(head.title)
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', head.description)
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', head.canonical)
    })
  }
})
