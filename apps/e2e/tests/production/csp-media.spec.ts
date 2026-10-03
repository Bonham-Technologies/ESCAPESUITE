import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { captureConsole } from '../../utils/seekable'
import { waitForAppReady } from '../../utils/ready'

/**
 * blob: media survives the REAL hosted Content-Security-Policy (ESCSUITE-121).
 *
 * Part 1 of this ticket (already on main) fixed `vercel.json`'s CSP to include
 * `media-src 'self' blob:` after it shipped without that directive and broke
 * every `<video src="blob:…">` on escapesuite.io — while the whole e2e suite,
 * including the production-layout suite, stayed green. The reason it stayed
 * green: `scripts/serve-dist.mjs`, the server `pnpm test:e2e:production` runs
 * against, mirrored `vercel.json`'s *rewrites* but sent none of its *headers* —
 * so this suite exercised the hosted layout with none of the hosted policy.
 * `serve-dist.mjs` now reads and sends `vercel.json`'s headers (see
 * `serve-dist.test.mjs` for the unit coverage of that), and this spec is the
 * regression test: it proves a `<video>` fed a `blob:` URL — the shape of both
 * ESCAPEARTIST's imported-source preview and ESCAPECRAFT's own recording
 * pipeline — actually decodes and draws under the CSP this server now sends,
 * with `securitypolicyviolation` wired up to fail loudly instead of silently.
 *
 * RED FIRST: with the headers mirrored, removing `media-src 'self' blob:` from
 * `vercel.json` and running this spec reproduces exactly the failure that
 * shipped — see the report for the pasted output.
 */

const ARTIST_URL = 'http://localhost:5190/artist/'
const CRAFT_URL = 'http://localhost:5190/craft/'
const FIXTURE_MP4 = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/headless/source.mp4'
)

/**
 * Record every `securitypolicyviolation` the page fires onto
 * `window.__cspViolations`, keyed by `effectiveDirective` — installed via
 * `addInitScript` so it is listening from the very first script the page runs,
 * before `page.goto` returns.
 */
async function trackCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__cspViolations.push(event.effectiveDirective)
    })
  })
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
}

test.describe('CSP allows blob: media on the hosted layout (ESCSUITE-121)', () => {
  test('ESCAPEARTIST decodes and draws an imported blob: source', async ({ page }) => {
    test.setTimeout(60_000)
    const consoleLog = captureConsole(page)
    await trackCspViolations(page)

    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // Import through the media library's file input — the source is decoded
    // via a `<video src="blob:…">` element, which is exactly what `media-src`
    // gates. "Add to timeline" appearing is the library reporting the source
    // decoded successfully.
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_MP4)
    const addToTimeline = page.getByRole('button', { name: 'Add to timeline' })
    try {
      await expect(addToTimeline).toBeVisible({ timeout: 60_000 })
    } catch (error) {
      // A blocked media-src stops the import at the decode step, so this never
      // appears — surfacing the violations and console here is what makes that
      // failure legible instead of a bare locator timeout.
      throw new Error(
        `"Add to timeline" never appeared: ${error}\n` +
          `CSP violations: ${JSON.stringify(await cspViolations(page))}\n` +
          `console:\n${consoleLog.messages.join('\n')}`,
        { cause: error }
      )
    }
    await addToTimeline.click()
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })

    // Seek so the preview actually decodes and composites a frame of the
    // blob: source rather than showing whatever was already on the canvas.
    // The fixture is a 1-second clip, so "Home" is the seek: stepping forward
    // a whole second from there would land exactly on the clip's out point.
    await page.getByTitle('Go to start (Home)').click()
    await page.waitForTimeout(1000)

    const nonBlackPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no preview canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no preview context')
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) count++
      }
      return count
    })
    expect(
      nonBlackPixels,
      `preview canvas looked blank; console:\n${consoleLog.messages.join('\n')}`
    ).toBeGreaterThan(0)

    expect(
      await cspViolations(page),
      `console:\n${consoleLog.messages.join('\n')}`
    ).toEqual([])
  })

  test('ESCAPECRAFT records a take and renders its library thumbnail', async ({ page }) => {
    test.setTimeout(60_000)
    const consoleLog = captureConsole(page)
    await trackCspViolations(page)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    // Screen is on by default; a plain screen-only take is enough — the
    // thumbnail is generated by drawing a frame of the stored `blob:` recording
    // into a canvas, the same `media-src`-gated shape as ESCAPEARTIST's preview.
    await expect(page.getByRole('button', { name: 'Screen', exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })

    const thumbnail = page.locator('img[class*="recordingThumbnail"]').first()
    await expect(thumbnail).toBeVisible({ timeout: 30_000 })
    await expect(thumbnail).toHaveAttribute('src', /^blob:/)

    expect(
      await cspViolations(page),
      `console:\n${consoleLog.messages.join('\n')}`
    ).toEqual([])
  })
})
