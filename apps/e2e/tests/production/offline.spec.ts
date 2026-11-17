import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { importMediaAndAddToTimeline, openExportDialog } from '../../utils/artist'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-469: after the first visit, each hosted app loads with no
 * connection. `scripts/offline.mjs` (run by `pnpm build:deploy`) gives the hub
 * (`/`), ESCAPECRAFT (`/craft/`) and ESCAPEARTIST (`/artist/`) a service
 * worker each, which precaches that app's build and serves the cached page
 * when the network is gone.
 *
 * Runs on the combined `dist/` served by `scripts/serve-dist.mjs` with
 * `vercel.json`'s headers, the hosted CSP included. Service workers are
 * Chromium-tested here; the production project is Chromium only.
 */

const ORIGIN = 'http://localhost:5190'
const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '../../../..')
const DIST = join(REPO_ROOT, 'dist')
const WEBM_FIXTURE = resolve(here, '../../fixtures/av/tone-gap.webm')

/** Waits until `scope`'s own worker (not the hub's, for an app) has activated. */
async function waitForWorker(page: Page, origin: string, scope: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (scopeUrl) => {
          const registration = await navigator.serviceWorker.getRegistration(scopeUrl)
          if (!registration || registration.scope !== scopeUrl) return null
          return registration.active?.state ?? null
        }, origin + scope),
      { timeout: 60_000, message: `the ${scope} service worker never activated` }
    )
    .toBe('activated')
}

/** Every URL in every Cache Storage cache this origin holds, by cache name. */
async function cachedUrls(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {}
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      result[name] = (await cache.keys()).map((request) => request.url)
    }
    return result
  })
}

/** A fresh context with the third-party analytics debug host stubbed out. */
async function newContext(browser: import('@playwright/test').Browser): Promise<BrowserContext> {
  const context = await browser.newContext()
  await context.route('**/va.vercel-scripts.com/**', (route) => route.abort())
  return context
}

test.describe('Hosted apps work offline after the first visit (ESCSUITE-469)', () => {
  test('the hub: offline reload, and its other pages, from the cache', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/`)
    await waitForAppReady(page, 'plan')
    await waitForWorker(page, ORIGIN, '/')

    await context.setOffline(true)
    await page.reload()
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('button', { name: /start recording/i }).first()).toBeVisible()

    await page.goto(`${ORIGIN}/limitations`)
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('heading', { level: 1, name: /known limitations/i })).toBeVisible()
    await context.close()
  })

  test('ESCAPECRAFT: offline reload, then record a take', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await newContext(browser)
    const page = await context.newPage()
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto(`${ORIGIN}/craft/`)
    await waitForAppReady(page, 'craft')
    await waitForWorker(page, ORIGIN, '/craft/')

    await context.setOffline(true)
    await page.reload()
    await waitForAppReady(page, 'craft')

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({ timeout: 30_000 })
    await context.close()
  })

  test('ESCAPEARTIST: offline reload, import a WebM and export a WebM', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/artist/`)
    await waitForAppReady(page, 'artist')
    await waitForWorker(page, ORIGIN, '/artist/')

    await context.setOffline(true)
    await page.reload()
    await waitForAppReady(page, 'artist')

    await importMediaAndAddToTimeline(page, WEBM_FIXTURE)
    await openExportDialog(page)
    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
    await page.getByRole('button', { name: 'Download WebM' }).first().click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.webm$/)
    expect(statSync(await download.path()).size).toBeGreaterThan(1000)
    await context.close()
  })

  test('the worker never answers or caches analytics, only the app’s own files', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/`)
    await waitForAppReady(page, 'plan')
    await waitForWorker(page, ORIGIN, '/')

    // Now controlled by the hub's worker.
    const responses: { url: string; fromServiceWorker: boolean }[] = []
    page.on('response', (response) =>
      responses.push({ url: response.url(), fromServiceWorker: response.fromServiceWorker() })
    )
    await page.reload()
    await waitForAppReady(page, 'plan')
    await expect.poll(() => responses.some(({ url }) => url.includes('/_vercel/insights/'))).toBe(true)

    for (const { url, fromServiceWorker } of responses) {
      if (url.includes('/_vercel/')) expect(fromServiceWorker, url).toBe(false)
      if (url.includes('/assets/')) expect(fromServiceWorker, url).toBe(true)
    }

    const cached = await cachedUrls(page)
    const names = Object.keys(cached)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^escapesuite-offline-plan-[0-9a-f]{16}$/)
    for (const url of cached[names[0]]) {
      expect(url.startsWith(`${ORIGIN}/`), url).toBe(true)
      expect(url).not.toContain('/_vercel/')
      expect(url).not.toMatch(/\/(craft|artist)\//)
    }
    await context.close()
  })

  test('an app embedded in a host page (the integration API) registers no worker', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    // A same-origin host page, as the integration API's hosts are on the hosted site.
    await page.route(`${ORIGIN}/escsuite-469-host`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Host</title><iframe src="/craft/" width="900" height="600"></iframe>',
      })
    )
    await page.goto(`${ORIGIN}/escsuite-469-host`)
    const frame = page.frameLocator('iframe')
    await expect(frame.getByRole('button', { name: 'Start recording' })).toBeVisible({ timeout: 30_000 })
    const craft = page.frames().find((f) => f.url().startsWith(`${ORIGIN}/craft/`))!
    await craft.waitForFunction(() => document.readyState === 'complete')
    await page.waitForTimeout(2000)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
    await context.close()
  })

  test('each app has a manifest Chromium accepts for install', async ({ browser }) => {
    const context = await newContext(browser)
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    for (const scope of ['/', '/craft/', '/artist/']) {
      await page.goto(`${ORIGIN}${scope}`)
      await waitForWorker(page, ORIGIN, scope)
      const { url, errors, data } = await cdp.send('Page.getAppManifest')
      expect(url).toBe(`${ORIGIN}${scope}manifest.webmanifest`)
      expect(errors).toEqual([])
      expect(JSON.parse(data ?? '{}')).toMatchObject({ scope, start_url: scope, display: 'standalone' })
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
      expect(installabilityErrors.map((e) => e.errorId)).toEqual([])
    }
    await context.close()
  })
})

/** A free loopback port for a second copy of the site. */
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => done(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function serveCopy(dir: string, port: number): Promise<ChildProcess> {
  const server = spawn(
    process.execPath,
    [join(REPO_ROOT, 'apps/e2e/scripts/serve-dist.mjs'), '--dir', dir, '--port', String(port)],
    { stdio: 'ignore' }
  )
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://localhost:${port}/sw.js`)).status
        } catch {
          return 0
        }
      },
      { timeout: 15_000 }
    )
    .toBe(200)
  return server
}

test.describe('A new deploy replaces the old offline copy (ESCSUITE-469)', () => {
  test('two build ids: the second load serves the new assets, online and offline, and says Updated', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    expect(existsSync(join(DIST, 'sw.js')), 'run `pnpm build:deploy` first').toBe(true)
    const copy = mkdtempSync(join(tmpdir(), 'escsuite-469-'))
    cpSync(DIST, copy, { recursive: true })
    const port = await freePort()
    const origin = `http://localhost:${port}`
    const server = await serveCopy(copy, port)
    const context = await newContext(browser)
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/`)
      await waitForAppReady(page, 'plan')
      await waitForWorker(page, origin, '/')
      const [firstCache] = Object.keys(await cachedUrls(page))
      expect(firstCache).toMatch(/^escapesuite-offline-plan-/)

      // The second deploy: the hub's script under a new hashed name that also
      // marks the window, then the same offline step build:deploy runs.
      const assets = join(copy, 'assets')
      const oldScript = readdirSync(assets).find((name) => name.endsWith('.js'))!
      const newScript = 'index-escsuite469second.js'
      writeFileSync(
        join(assets, newScript),
        readFileSync(join(assets, oldScript), 'utf8') + '\n;window.__escsuite469Build = "second";\n'
      )
      rmSync(join(assets, oldScript))
      for (const html of ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'limitations/index.html']) {
        const file = join(copy, html)
        writeFileSync(file, readFileSync(file, 'utf8').replaceAll(`/assets/${oldScript}`, `/assets/${newScript}`))
      }
      const offline = spawn(process.execPath, [join(REPO_ROOT, 'scripts/offline.mjs'), copy], { stdio: 'ignore' })
      await new Promise((done) => offline.once('exit', done))
      expect(offline.exitCode).toBe(0)

      // The next load: new page, new worker, and the note saying so.
      await page.reload()
      await waitForAppReady(page, 'plan')
      expect(await page.evaluate(() => (window as { __escsuite469Build?: string }).__escsuite469Build)).toBe('second')
      await expect(page.getByRole('status').filter({ hasText: 'Updated to the latest version of ESCAPE Suite.' })).toBeVisible({
        timeout: 30_000,
      })
      // The note shows when the new worker takes over; it deletes the old
      // cache as it finishes activating.
      await expect.poll(async () => Object.keys(await cachedUrls(page)), { timeout: 15_000 }).toHaveLength(1)
      const cached = await cachedUrls(page)
      const [secondCache] = Object.keys(cached)
      expect(secondCache).not.toBe(firstCache)
      expect(cached[secondCache]).toContain(`${origin}/assets/${newScript}`)
      expect(cached[secondCache]).not.toContain(`${origin}/assets/${oldScript}`)

      // Dismiss works.
      await page.getByRole('button', { name: 'Dismiss' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toHaveCount(0)

      // And with no connection, the new build is what loads.
      await context.setOffline(true)
      await page.reload()
      await waitForAppReady(page, 'plan')
      expect(await page.evaluate(() => (window as { __escsuite469Build?: string }).__escsuite469Build)).toBe('second')
      // A first install shows no note.
      await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toHaveCount(0)
    } finally {
      await context.close()
      server.kill()
      rmSync(copy, { recursive: true, force: true })
    }
  })

  test('the kill switch unregisters the worker and clears its cache', async ({ browser }) => {
    test.setTimeout(90_000)
    const copy = mkdtempSync(join(tmpdir(), 'escsuite-469-kill-'))
    cpSync(DIST, copy, { recursive: true })
    const port = await freePort()
    const origin = `http://localhost:${port}`
    const server = await serveCopy(copy, port)
    const context = await newContext(browser)
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/craft/`)
      await waitForAppReady(page, 'craft')
      await waitForWorker(page, origin, '/craft/')

      const kill = spawn(process.execPath, [join(REPO_ROOT, 'scripts/offline.mjs'), copy, '--kill-switch'], {
        stdio: 'ignore',
      })
      await new Promise((done) => kill.once('exit', done))
      expect(kill.exitCode).toBe(0)

      // The next load checks the worker for an update and gets the kill switch.
      await page.reload()
      await waitForAppReady(page, 'craft')
      await expect
        .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), {
          timeout: 30_000,
        })
        .toBe(0)
      expect(Object.keys(await cachedUrls(page)).filter((name) => name.startsWith('escapesuite-offline-craft-'))).toEqual([])
    } finally {
      await context.close()
      server.kill()
      rmSync(copy, { recursive: true, force: true })
    }
  })
})
