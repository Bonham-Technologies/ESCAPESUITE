import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { captureConsole } from '../../utils/seekable'
import { waitForAppReady } from '../../utils/ready'

/**
 * The hosted CSP admits ESCAPECRAFT's AudioWorklet (ESCSUITE-299).
 *
 * A WebCodecs take captures its audio through an AudioWorklet whose module is
 * loaded from a `blob:` URL (there is no file to serve it from in the
 * single-file build). A worklet module is fetched under `script-src`, and
 * `vercel.json`'s `script-src` once had no `blob:` — so `addModule()` was
 * refused on escapesuite.io and every hosted take quietly fell back to the
 * ScriptProcessorNode capture, while the dev server, which sends no policy,
 * showed the worklet working. `scripts/serve-dist.mjs` sends `vercel.json`'s
 * real headers (ESCSUITE-121), so this is the one place the policy and the
 * recorder meet before they meet on the hosted deployment.
 *
 * The recorder says which path a take got in one `console.info` line, at
 * `initialize()` — which is what both cases read.
 */

const CRAFT_URL = 'http://localhost:5190/craft/'
const WORKLET_LINE = /Recording audio through an AudioWorklet/
const FALLBACK_LINE = /Recording audio through a ScriptProcessorNode/

/** Every `securitypolicyviolation` the page fires, as `effectiveDirective blockedURI`, from its first script on. */
async function trackCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`)
    })
  })
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
}

/** Record a short screen take (the microphone is on by default, so the take has a mix). */
async function recordShortTake(page: Page): Promise<void> {
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')
  await expect(page.getByRole('button', { name: 'Screen', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 30_000 }
  )
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({ timeout: 30_000 })
}

test.describe('ESCAPECRAFT audio capture under the hosted CSP (ESCSUITE-299)', () => {
  test('records through the AudioWorklet, with no policy violation', async ({ page }) => {
    test.setTimeout(90_000)
    const consoleLog = captureConsole(page)
    await trackCspViolations(page)

    await recordShortTake(page)

    expect(
      consoleLog.matching(WORKLET_LINE),
      `the take did not use the AudioWorklet; console:\n${consoleLog.messages.join('\n')}`
    ).toHaveLength(1)
    expect(consoleLog.matching(FALLBACK_LINE)).toEqual([])
    expect(
      await cspViolations(page),
      `console:\n${consoleLog.messages.join('\n')}`
    ).toEqual([])
  })

  test('the inverse: the same policy without blob: in script-src refuses the module, and the take falls back', async ({
    page,
  }) => {
    // `serve-dist.mjs` reads `vercel.json` at import, so serving a second copy
    // of it would mean a second server; the served document's own header is
    // rewritten here instead — the rest of the policy is the real one.
    test.setTimeout(90_000)
    await page.route(CRAFT_URL, async (route) => {
      const response = await route.fetch()
      const headers = response.headers()
      const policy = headers['content-security-policy']
      expect(policy, 'serve-dist.mjs sent no Content-Security-Policy').toBeTruthy()
      expect(policy).toMatch(/script-src[^;]* blob:/)
      headers['content-security-policy'] = policy.replace(/(script-src[^;]*?) blob:/, '$1')
      await route.fulfill({ response, headers })
    })
    const consoleLog = captureConsole(page)
    await trackCspViolations(page)

    await recordShortTake(page)

    expect(
      consoleLog.matching(FALLBACK_LINE),
      `console:\n${consoleLog.messages.join('\n')}`
    ).toHaveLength(1)
    expect(consoleLog.matching(WORKLET_LINE)).toEqual([])
    // The refusal itself. Chromium (156, measured 2026-10-16) reports a blocked
    // worklet module nowhere a test can see: no `securitypolicyviolation` fires
    // on the document and no "Refused to load" line reaches the console. The
    // one trace is the `addModule` rejection the recorder logs in its own line —
    // `AbortError: Failed to load worklet module script: blob:…` — so that is
    // what is pinned; a violation event is recorded if one ever appears, and a
    // failure prints both.
    const violations = await cspViolations(page)
    expect(
      consoleLog.matching(/Failed to load worklet module script: blob:/),
      `the fallback line does not name the blob: module's refusal.\nCSP violations: ${JSON.stringify(violations)}\n` +
        `console:\n${consoleLog.messages.join('\n')}`
    ).toHaveLength(1)
  })
})
