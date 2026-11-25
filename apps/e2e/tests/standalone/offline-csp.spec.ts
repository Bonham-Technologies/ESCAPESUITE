import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './cspGuard'
import { waitForAppReady } from '../../utils/ready'
import { ARTIST_FIXTURE_MP4 } from '../../utils/artist'
import type { CspViolationTracker } from '../../utils/cspViolations'

/**
 * ESCSUITE-467: the offline file blocks its own network access.
 *
 * Each standalone build carries a Content-Security-Policy `<meta>` that
 * admits no network scheme or host (`scripts/offline-csp.mjs`). Here code
 * injected into the running page tries the three commonest ways out (a
 * `fetch()`, a WebSocket and a remote `<img>`) and each one must be refused
 * by the browser with a `securitypolicyviolation` event naming the directive
 * that refused it, before any request is made.
 *
 * Both apps, both ways the file is opened: served over http (how the rest of
 * this suite runs it) and from `file://` (how a downloaded copy runs).
 * `dist-single-file.spec.ts` checks the policy text itself.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APPS = [
  {
    name: 'ESCAPECRAFT',
    app: 'craft' as const,
    http: 'http://localhost:5184',
    file: pathToFileURL(path.resolve(HERE, '../../../craft/dist/index.html')).href,
  },
  {
    name: 'ESCAPEARTIST',
    app: 'artist' as const,
    http: 'http://localhost:5185',
    file: pathToFileURL(path.resolve(HERE, '../../../artist/dist/index.html')).href,
  },
]

/** `.invalid` never resolves (RFC 2606), so nothing could answer even if a request left. */
const REMOTE = 'example.invalid'

test.use({ allowCspViolations: true })

/**
 * Every attempt that got past the policy to the network layer. Playwright's
 * routing sees a request only once the browser actually tries to send it; a
 * request the policy refused never gets here (Chromium still reports it as a
 * `request` event that fails with `net::ERR_BLOCKED_BY_CSP`, so that event is
 * not evidence either way). Anything that does get here is aborted, so a
 * broken policy still cannot reach the network from a test run.
 */
async function trackReachedNetwork(page: Page): Promise<string[]> {
  const reached: string[] = []
  await page.context().route(`**://${REMOTE}/**`, (route) => {
    reached.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  // Not `routeWebSocket`: that replaces the page's WebSocket with a mock, so
  // the policy would never be asked. The `websocket` event fires when the
  // browser opens a real socket, which a refused one never is.
  page.on('websocket', (socket) => reached.push(socket.url()))
  return reached
}

async function blockedBy(tracker: CspViolationTracker, directive: string, host: string) {
  await expect
    .poll(() => tracker.violations().filter((v) => v.via === 'event' && v.directive === directive && v.blockedURI.includes(host)).length)
    .toBeGreaterThan(0)
}

for (const { name, app, http, file } of APPS) {
  for (const [how, url] of [
    ['served over http', http],
    ['opened from file://', file],
  ] as const) {
    test.describe(`${name} offline file ${how}: the browser blocks the network`, () => {
      let reached: string[] = []

      test.beforeEach(async ({ page }) => {
        reached = await trackReachedNetwork(page)
        await page.goto(url)
        await waitForAppReady(page, app)
      })

      test('an injected fetch() is refused by connect-src', async ({ page, cspViolations }) => {
        const outcome = await page.evaluate(
          (target) => fetch(target).then(() => 'resolved', (error: Error) => `rejected: ${error.name}`),
          `https://${REMOTE}/beacon`
        )
        expect(outcome).toBe('rejected: TypeError')
        await blockedBy(cspViolations, 'connect-src', REMOTE)
        expect(reached).toEqual([])
      })

      test('an injected WebSocket is refused by connect-src', async ({ page, cspViolations }) => {
        const outcome = await page.evaluate(
          (target) =>
            new Promise<string>((resolve) => {
              try {
                const socket = new WebSocket(target)
                socket.onopen = () => resolve('open')
                socket.onerror = () => resolve('error')
              } catch (error) {
                resolve(`threw: ${(error as Error).name}`)
              }
            }),
          `wss://${REMOTE}/socket`
        )
        expect(outcome).not.toBe('open')
        await blockedBy(cspViolations, 'connect-src', REMOTE)
        expect(reached).toEqual([])
      })

      test('an injected remote <img> is refused by img-src', async ({ page, cspViolations }) => {
        const outcome = await page.evaluate(
          (target) =>
            new Promise<string>((resolve) => {
              const img = document.createElement('img')
              img.onload = () => resolve('loaded')
              img.onerror = () => resolve('error')
              img.src = target
              document.body.append(img)
            }),
          `https://${REMOTE}/pixel.png`
        )
        expect(outcome).toBe('error')
        await blockedBy(cspViolations, 'img-src', REMOTE)
        expect(reached).toEqual([])
      })
    })
  }
}

/**
 * ESCAPEARTIST's `?video=` parameter fetches the address it is given
 * (docs/reference/integration-api.md). In the offline file the policy admits
 * media carried in the address itself (`data:`) and refuses any network
 * address, which the editor reports by origin instead of loading it.
 */
const SOURCE_MP4_DATA_URL = `data:video/mp4;base64,${readFileSync(ARTIST_FIXTURE_MP4).toString('base64')}`

for (const [how, base] of [
  ['served over http', APPS[1].http],
  ['opened from file://', APPS[1].file],
] as const) {
  test.describe(`ESCAPEARTIST offline file ${how}: ?video=`, () => {
    test('loads a data: address', async ({ page, cspViolations }) => {
      await page.goto(`${base}?suppressRestore=1&video=${encodeURIComponent(SOURCE_MP4_DATA_URL)}`)
      await waitForAppReady(page, 'artist')
      await expect(page.getByRole('button', { name: 'Add to timeline' })).toBeVisible({ timeout: 30_000 })
      expect(cspViolations.violations()).toEqual([])
    })

    test('refuses a network address and says why', async ({ page, cspViolations }) => {
      const reached = await trackReachedNetwork(page)
      await page.goto(`${base}?suppressRestore=1&video=${encodeURIComponent(`https://${REMOTE}/clip.mp4`)}`)
      await waitForAppReady(page, 'artist')
      await expect(
        page.getByText(`Could not load the video from https://${REMOTE}: this deployment does not allow loading from other origins (Content-Security-Policy)`, { exact: false })
      ).toBeVisible({ timeout: 15_000 })
      await blockedBy(cspViolations, 'connect-src', REMOTE)
      expect(reached).toEqual([])
    })
  })
}
