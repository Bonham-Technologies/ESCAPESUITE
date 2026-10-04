// ESCSUITE-208 — the shared focus trap (`useDialogBehaviour` in
// `@escapesuite/shared/hooks`) against a real dialog in a real browser, where
// `offsetParent`, `getClientRects()` and native element tabbability actually
// exist. Reuses the shape of hunt-i's throwaway verification probe
// (`.superpowers/briefs/probe-dialog-trap.spec.ts`), kept as a permanent
// regression pin against CRAFT's "Recording Tips" dialog — one click to open,
// no media devices needed.
//
// Two cases, named for the hunt findings that drove the fix:
// - I-U3: a `position: fixed` control inside the dialog used to be dropped
//   from the trap entirely (a real browser reports `offsetParent === null`
//   for it, same as "hidden"), so it took neither initial focus nor a Tab.
// - I-U2: a `[contenteditable]` element the trap's selector had no arm for
//   used to leak focus out of the dialog on Tab once a click landed on it.
import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

const CRAFT = 'http://localhost:5174'

async function openHelpDialog(page: import('@playwright/test').Page) {
  await page.goto(CRAFT)
  await waitForAppReady(page, 'craft')
  await page.getByRole('button', { name: /help - recording tips/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Recording Tips' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('dialog focus trap (I-U3): a position: fixed control stays in the trap', () => {
  test('takes initial focus and is reached by Tab', async ({ page }) => {
    await page.goto(CRAFT)
    await waitForAppReady(page, 'craft')

    // Pin the dialog's own close button with position: fixed BEFORE it opens,
    // so the hook's one-shot getFocusable() on open sees the real computed
    // style.
    await page.addStyleTag({ content: '[aria-label="Close help"] { position: fixed; }' })

    await page.getByRole('button', { name: /help - recording tips/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Recording Tips' })
    await expect(dialog).toBeVisible()

    // Facts first: it really is pinned, on screen, and offsetParent-less —
    // the exact shape a real position: fixed control reports.
    const facts = await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Close help"]') as HTMLElement
      return {
        computedPosition: getComputedStyle(btn).position,
        offsetParent: btn.offsetParent === null ? 'null' : 'element',
        hasBox: btn.getBoundingClientRect().width > 0,
      }
    })
    expect(facts.computedPosition).toBe('fixed')
    expect(facts.offsetParent).toBe('null')
    expect(facts.hasBox).toBe(true)

    await expect(page.getByRole('button', { name: 'Close help' })).toBeFocused()

    let reachedByTab = false
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      if (
        await page.evaluate(
          () => document.activeElement === document.querySelector('[aria-label="Close help"]')
        )
      ) {
        reachedByTab = true
        break
      }
    }
    expect(reachedByTab, 'Tab never reached the position: fixed close button').toBe(true)
  })
})

test.describe('dialog focus trap (I-U2): [contenteditable] stays inside the trap', () => {
  test('a click onto it, then Tab, keeps focus inside the dialog', async ({ page }) => {
    const dialog = await openHelpDialog(page)

    await dialog.evaluate((el) => {
      const content = el.querySelector('[class*="helpContent"]') as HTMLElement
      const div = document.createElement('div')
      div.contentEditable = 'true'
      div.textContent = 'notes'
      div.setAttribute('data-probe', 'ce')
      div.style.minHeight = '40px'
      div.style.border = '1px solid red'
      content.appendChild(div)
    })

    await page.locator('[data-probe="ce"]').click()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-probe'))).toBe(
      'ce'
    )

    await page.keyboard.press('Tab')

    const inside = await dialog.evaluate((el) => el.contains(document.activeElement))
    expect(inside, 'focus left the dialog after a click + Tab onto the contenteditable').toBe(
      true
    )
  })
})
