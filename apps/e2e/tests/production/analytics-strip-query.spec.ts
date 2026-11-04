import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-406: no Vercel Web Analytics record carries the page's query string
 * or fragment.
 *
 * A website that embeds ESCAPEARTIST puts `?title=`, `?project=` (a whole
 * base64 project), `?video=` and the like in the editor's address. Vercel's
 * insights script reports `location.href` with every page view and every
 * custom event, so without the shared `analyticsBeforeSend` hook on each
 * `<Analytics />` mount all of it went to Vercel.
 *
 * Runs against the combined `dist/` from `pnpm build:deploy`: the hosted build,
 * with `<Analytics />` compiled in and `vercel.json`'s CSP enforced. What that
 * layout lacks is Vercel's platform route `/_vercel/insights/script.js` (the
 * script `@vercel/analytics` injects; `serve-dist.mjs` 404s it), so without
 * help nothing would ever be sent and the test would prove nothing. So:
 *
 * - the script request is fulfilled with Vercel's real script, vendored
 *   byte for byte in `fixtures/vercel-insights/` (see its README), so the
 *   app's own `beforeSend` runs through the same code it meets on Vercel;
 * - the script skips automated browsers (`navigator.webdriver`), so an init
 *   script reports `false` there, which is all it checks besides a "Headless"
 *   user agent (the Desktop Chrome device's has none);
 * - its `view` and `event` posts are caught, recorded and answered here, so
 *   nothing leaves the machine.
 *
 * Every case first proves records were actually sent, so a broken send path
 * fails it rather than passing it vacuously.
 */

const ORIGIN = 'http://localhost:5190'

const INSIGHTS_SCRIPT = readFileSync(
  resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/vercel-insights/script.js'),
  'utf8'
)

const SECRET_TITLE = 'secret-title-406'
const SECRET_FRAGMENT = 'secret-fragment-406'
/** A whole project, base64 encoded, the way an integration host passes one. */
const SECRET_PROJECT = Buffer.from(
  JSON.stringify({ name: 'secret-project-406', tracks: [], clips: [] })
).toString('base64')

/** A 1×1 PNG, so a real import fires ESCAPEARTIST's `Video Imported` event. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

interface InsightsRecord {
  /** `view` or `event`, the endpoint it was posted to. */
  endpoint: string
  /** The request URL, query included. */
  url: string
  /** The raw JSON body. */
  body: string
  /** The page address the record reports. */
  o: string | undefined
  /** The custom event's name, for an `event` record. */
  en: string | undefined
}

/** Serve the real insights script and record everything it posts. */
async function captureInsights(page: Page): Promise<InsightsRecord[]> {
  const records: InsightsRecord[] = []

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      configurable: true,
      get: () => false,
    })
  })

  await page.route(`${ORIGIN}/_vercel/insights/**`, async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    if (pathname === '/_vercel/insights/script.js') {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: INSIGHTS_SCRIPT,
      })
      return
    }

    const body = request.postData() ?? ''
    let parsed: { o?: string; en?: string } = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      // Recorded raw all the same: the leak check reads `body`, not `o`.
    }
    records.push({
      endpoint: pathname.replace('/_vercel/insights/', ''),
      url: request.url(),
      body,
      o: parsed.o,
      en: parsed.en,
    })
    await route.fulfill({ status: 200, body: 'OK' })
  })

  return records
}

/** Assert no record, URL or body, holds any of `secrets`, and each reports `expectedPage`. */
function expectNoLeak(records: InsightsRecord[], secrets: string[], expectedPage: string): void {
  for (const record of records) {
    for (const secret of secrets) {
      expect(record.url, `${record.endpoint} request URL`).not.toContain(secret)
      expect(record.body, `${record.endpoint} request body`).not.toContain(secret)
    }
    expect(record.o, `${record.endpoint} record's page address`).toBe(expectedPage)
  }
}

test.describe('analytics records carry the page path only (ESCSUITE-406)', () => {
  test('ESCAPEARTIST opened with a host query sends neither the title nor the project', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const records = await captureInsights(page)

    await page.goto(
      `${ORIGIN}/artist/?title=${SECRET_TITLE}&project=${encodeURIComponent(SECRET_PROJECT)}` +
        `#${SECRET_FRAGMENT}`
    )
    await waitForAppReady(page, 'artist')

    // The page view.
    await expect
      .poll(() => records.filter((r) => r.endpoint === 'view').length, {
        message: 'the insights script posted no page view',
      })
      .toBeGreaterThan(0)

    // A custom event, from a real import: `trackEvent()` → `track()` →
    // the script's `event` post.
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'still.png', mimeType: 'image/png', buffer: PNG_1X1 })
    await expect(page.getByRole('button', { name: 'Add to timeline' })).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(() => records.filter((r) => r.en === 'Video Imported').length, {
        message: 'the insights script posted no Video Imported event',
      })
      .toBeGreaterThan(0)

    expectNoLeak(
      records,
      [
        SECRET_TITLE,
        SECRET_PROJECT,
        encodeURIComponent(SECRET_PROJECT),
        // The base64 without its padding, in case only part of it survives.
        SECRET_PROJECT.replace(/=+$/, ''),
        SECRET_FRAGMENT,
      ],
      `${ORIGIN}/artist/`
    )
  })

  for (const { app, path, query } of [
    { app: 'craft', path: '/craft/', query: '?hostOrigin=https%3A%2F%2Fhost.example&tabKey=secret-tab-406' },
    { app: 'plan', path: '/', query: '?ref=secret-ref-406' },
  ] as const) {
    test(`${app === 'craft' ? 'ESCAPECRAFT' : 'ESCAPEPLAN'}'s page view drops the query too`, async ({
      page,
    }) => {
      const records = await captureInsights(page)

      await page.goto(`${ORIGIN}${path}${query}#${SECRET_FRAGMENT}`)
      await waitForAppReady(page, app)

      await expect
        .poll(() => records.filter((r) => r.endpoint === 'view').length, {
          message: 'the insights script posted no page view',
        })
        .toBeGreaterThan(0)

      expectNoLeak(records, ['secret-', 'host.example'], `${ORIGIN}${path}`)
    })
  }
})
