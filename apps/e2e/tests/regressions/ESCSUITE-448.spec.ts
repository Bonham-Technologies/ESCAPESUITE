import { test, expect, type Frame, type Page } from '@playwright/test'
import { ARTIST_URL, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { runAxeCheck, waitForAnimationsToFinish } from '../../utils/accessibility'

/**
 * ESCSUITE-448: ARTIST asked "Delete clip …?", "Delete track …?", "Start a new
 * project?" and the media library's removals with the browser's own
 * `confirm()`. In an iframe sandboxed without `allow-modals`, `confirm()`
 * answers false without showing anything, so in such an embed those buttons
 * silently did nothing.
 *
 * Now they ask in the editor's own dialog, which a sandbox cannot refuse.
 *
 * The host page is served from ARTIST's own origin (as in
 * tests/integration/host-embedding.spec.ts), and the iframe gets every
 * sandbox token an embed would plausibly grant except `allow-modals`.
 */

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
const HOST_URL = `${ARTIST_URL}/__e2e-sandboxed-host`
const QUESTION = /^Delete clip "/

function hostHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>e2e sandboxed host</title>
    <style>
      html, body { margin: 0; height: 100%; }
      iframe { display: block; border: 0; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <iframe title="ESCAPEARTIST" sandbox="${SANDBOX}" src="/?suppressRestore=1"></iframe>
  </body>
</html>`
}

/** Open the host page and hand back ARTIST's frame, once the editor has mounted. */
async function openSandboxed(page: Page): Promise<Frame> {
  await page.route(HOST_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hostHtml() })
  )
  await page.goto(HOST_URL)
  const frame = await (await page.locator('iframe').elementHandle())!.contentFrame()
  expect(frame, 'the host page has no ARTIST frame').not.toBeNull()
  await frame!.locator('main').first().waitFor({ state: 'attached' })
  return frame!
}

test.describe('ESCSUITE-448: confirmations work in an iframe sandboxed without allow-modals', () => {
  test('Delete clip asks in the editor and deletes the clip', async ({ page }) => {
    // Any native dialog that does open is accepted, so the only thing that
    // can refuse a native confirm here is the sandbox.
    let nativeDialogs = 0
    page.on('dialog', (dialog) => {
      nativeDialogs += 1
      void dialog.accept()
    })
    const frame = await openSandboxed(page)

    // The sandbox is in force: a native confirm answers false and shows nothing.
    expect(await frame.evaluate(() => window.confirm('probe'))).toBe(false)
    expect(nativeDialogs).toBe(0)

    await seedTextClip(frame)
    await frame.getByRole('button', { name: 'Delete clip' }).click()

    const dialog = frame.getByRole('alertdialog', { name: QUESTION })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(dialog).toHaveCount(0)
    await expect(frame.getByText(/^0 clips/)).toBeVisible()
    expect(nativeDialogs).toBe(0)
  })

  test('Cancel and Escape keep the clip and give focus back to Delete clip', async ({ page }) => {
    const frame = await openSandboxed(page)
    await seedTextClip(frame)
    const deleteButton = frame.getByRole('button', { name: 'Delete clip' })
    const dialog = frame.getByRole('alertdialog', { name: QUESTION })

    await deleteButton.click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(deleteButton).toBeFocused()

    await deleteButton.click()
    await expect(dialog).toBeVisible()
    await frame.locator('body').press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(deleteButton).toBeFocused()

    await expect(frame.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })
})

test.describe('ESCSUITE-448: the confirm dialog passes axe', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`Delete clip's dialog (${theme} theme)`, async ({ page }) => {
      await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
      }
      await seedTextClip(page)
      await page.getByRole('button', { name: 'Delete clip' }).click()
      const dialog = page.getByRole('alertdialog', { name: QUESTION })
      await expect(dialog).toBeVisible()
      await waitForAnimationsToFinish(dialog)

      const results = await runAxeCheck(page, { includeSelector: '[role="alertdialog"]' })
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }
})
