import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-446: the Recording Tips dialog mentions "Float controls" only where
 * the button itself is drawn, i.e. where Document Picture-in-Picture exists
 * (Chromium) and CRAFT is the top-level page. Safari has no such API, so the
 * line must be absent there.
 */
test('Recording Tips mention Float controls exactly where the Float controls button exists', async ({ page }) => {
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
  const supported = await page.evaluate(() => 'documentPictureInPicture' in window)

  await page.getByRole('button', { name: 'Help - Recording Tips' }).click()
  const help = page.getByRole('dialog', { name: 'Recording Tips' })
  await expect(help).toBeVisible()

  const line = help.getByText('Float controls', { exact: true })
  if (supported) {
    await expect(line).toBeVisible()
    await expect(help).toContainText('stays on top of whatever you are recording')
  } else {
    await expect(line).toHaveCount(0)
  }
})
