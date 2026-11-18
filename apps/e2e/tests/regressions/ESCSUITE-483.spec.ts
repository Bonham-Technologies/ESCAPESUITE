import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { recordATake } from '../../utils/craft'
import { runAxeCheck, waitForAnimationsToFinish } from '../../utils/accessibility'

/**
 * ESCSUITE-483: the trash icon in CRAFT's library deleted a take — every file
 * of it — on one click, with no question and no undo, right next to "Open in
 * Editor".
 *
 * Now it asks in CRAFT's own dialog (not the browser's `confirm()`, which a
 * sandboxed embed answers "no" without showing). Cancel and Escape keep the
 * take and put focus back on the row's Delete button; only the dialog's own
 * Delete button deletes it, from the list and from storage. The dialog passes
 * axe in both themes.
 */

const CRAFT_URL = 'http://localhost:5174'

test.describe('ESCSUITE-483: deleting a take asks first', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`Cancel and Escape keep the take; confirming deletes it (${theme} theme)`, async ({ page }) => {
      // A native dialog would be the wrong fix: count any that open.
      let nativeDialogs = 0
      page.on('dialog', (dialog) => {
        nativeDialogs += 1
        void dialog.dismiss()
      })

      await mockSyntheticMedia(page)
      await grantMediaPermissions(page)
      await page.goto(`${CRAFT_URL}/?theme=${theme}`)
      await waitForAppReady(page, 'craft')
      await recordATake(page)

      const name = (await page.locator('[class*="recordingName"]').first().textContent())!.trim()
      expect(name).not.toBe('')
      const deleteButton = page.getByRole('button', { name: `Delete ${name}`, exact: true })
      const playButtons = page.getByRole('button', { name: /^Play / })
      const dialog = page.getByRole('alertdialog')

      // Delete, then Cancel: the dialog names the take, and nothing goes.
      await deleteButton.click()
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(name)
      await waitForAnimationsToFinish(dialog)
      const results = await runAxeCheck(page, { includeSelector: '[role="alertdialog"]' })
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(playButtons).toHaveCount(1)
      await expect(deleteButton).toBeFocused()

      // Delete, then Escape: the same.
      await deleteButton.click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(playButtons).toHaveCount(1)
      await expect(deleteButton).toBeFocused()

      // Delete, then the dialog's own Delete: the take goes.
      await deleteButton.click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText('No recordings yet')).toBeVisible()

      // Gone from storage too, not just from the list.
      await page.reload()
      await waitForAppReady(page, 'craft')
      await expect(page.getByText('No recordings yet')).toBeVisible()
      await expect(playButtons).toHaveCount(0)

      expect(nativeDialogs, 'a native dialog opened').toBe(0)
    })
  }
})
