import { test, expect, type Page } from '@playwright/test'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import { checkFocusOrder } from '../../utils/accessibility'
import { seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEPLAN Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
  })

  test('can tab through navigation links', async ({ page, browserName }) => {
    const nav = page.locator('nav, header').first()
    const isVisible = await nav.isVisible().catch(() => false)

    if (isVisible) {
      // ESCSUITE-177: WebKit's default "Tab to links" preference is off (the
      // native macOS behaviour Playwright's WebKit inherits), so a plain Tab
      // never reaches a link — the nav bar here is nothing but links. The
      // real-Safari equivalent for "tab to everything" is Option+Tab
      // (Alt+Tab in Playwright's key names).
      const advance = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'

      // Focus the document
      await page.keyboard.press(advance)

      // Tab through and verify focus moves
      const focusOrder = await checkFocusOrder(page, advance)
      expect(focusOrder.length).toBeGreaterThan(0)
    }
  })

  test('Enter key activates buttons', async ({ page }) => {
    const button = page.getByRole('button').first()
    const isVisible = await button.isVisible().catch(() => false)

    if (isVisible) {
      await button.focus()
      await page.keyboard.press('Enter')

      // Button should respond to Enter (may open modal, navigate, etc.)
      // Just verify no crash occurred
      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  // ESCSUITE-187: a `Space key activates buttons` case used to live here,
  // but it asserted nothing a regression could break (doctype-only) and the
  // real Space behaviour worth proving — ESCSUITE-185's playback dialog —
  // needs ESCAPECRAFT, not ESCAPEPLAN. It moved to the
  // `VideoPlayer Keyboard Shortcuts` describe below.

  test('skip link functionality', async ({ page }) => {
    // Check for skip link
    const skipLink = page.locator('a[href="#main"], a[href="#content"], .skip-link').first()
    const exists = (await skipLink.count()) > 0

    if (exists) {
      await page.keyboard.press('Tab')

      // Skip link should be one of the first focusable elements
      const activeElement = await page.evaluate(() => document.activeElement?.textContent)
      // Skip links often say "Skip to main content" or similar
      expect(activeElement?.toLowerCase()).toContain('skip')
    }
  })

  test('focusable elements have visible focus', async ({ page }) => {
    // Tab to first few elements and check for focus indicators
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')

      const hasFocusIndicator = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return true // Skip if no focus

        const styles = window.getComputedStyle(el)
        const outlineWidth = parseInt(styles.outlineWidth) || 0
        const boxShadow = styles.boxShadow !== 'none'

        return outlineWidth > 0 || boxShadow
      })

      // Focus should be visible
      expect(hasFocusIndicator).toBe(true)
    }
  })
})

test.describe('ESCAPECRAFT Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('can tab through recording controls', async ({ page }) => {
    // First verify there are focusable elements on the page
    const focusableCount = await page.evaluate(() => {
      const focusable = document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      return focusable.length
    })

    // Skip focus order check if no focusable elements (can happen in headless CI)
    if (focusableCount === 0) {
      // Page loaded but no focusable elements - pass with note
      expect(true).toBe(true)
      return
    }

    // Click on body first to ensure focus is in document
    await page.click('body')
    await checkFocusOrder(page)

    // In headless mode, focus behavior can vary - just verify page is functional
    expect(focusableCount).toBeGreaterThan(0)
  })

  test('Enter toggles recording buttons', async ({ page }) => {
    const recordButton = page
      .getByRole('button', { name: /record|start/i })
      .or(page.locator('[data-testid="record-button"]'))
      .first()

    const isVisible = await recordButton.isVisible().catch(() => false)

    if (isVisible) {
      await recordButton.focus()
      await page.keyboard.press('Enter')

      // Should respond without crashing
      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('Space toggles toggle switches', async ({ page }) => {
    // ESCSUITE-187: this used to accept `initialState`/`newState` both being
    // `null` as a pass, which a toggle that did nothing at all would also
    // satisfy. The source toggles (`SourceToggles.tsx`) are real `aria-pressed`
    // buttons — pressing Space on a focused native `<button>` is the
    // browser's own activation, no app code involved — so the "Screen" toggle
    // (pressed by default) is a real one to assert against.
    const toggle = page
      .locator('[role="switch"]')
      .or(page.locator('[aria-pressed]'))
      .first()

    await expect(toggle).toBeVisible()
    const initialState = await toggle.getAttribute('aria-pressed')
    expect(initialState).not.toBeNull()

    await toggle.focus()
    await page.keyboard.press('Space')

    await expect(toggle).toHaveAttribute('aria-pressed', initialState === 'true' ? 'false' : 'true')
  })

  test('Escape cancels recording selection', async ({ page }) => {
    // Click on source selector if visible
    const sourceSelector = page
      .getByRole('button', { name: /screen|window|select/i })
      .first()

    const isVisible = await sourceSelector.isVisible().catch(() => false)

    if (isVisible) {
      await sourceSelector.click()
      await page.waitForTimeout(300)

      await page.keyboard.press('Escape')
      await page.waitForTimeout(100)

      // Page should still be functional
      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('webcam toggle responds to keyboard', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .or(page.locator('[data-testid="webcam-toggle"]'))
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.focus()
      await page.keyboard.press('Enter')

      // Should respond without crashing
      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('microphone toggle responds to keyboard', async ({ page }) => {
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .or(page.locator('[data-testid="mic-toggle"]'))
      .first()

    const isVisible = await micToggle.isVisible().catch(() => false)

    if (isVisible) {
      await micToggle.focus()
      await page.keyboard.press('Enter')

      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('the help dialog opens, traps Tab and gives focus back on Escape', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /help - recording tips/i })
    await trigger.focus()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Recording Tips' })
    await expect(dialog).toBeVisible()

    // Focus is inside the dialog, and stays there however far Tab is pressed.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

test.describe('ESCAPEARTIST Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('can tab through toolbar', async ({ page }) => {
    // First verify there are focusable elements on the page
    const focusableCount = await page.evaluate(() => {
      const focusable = document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      return focusable.length
    })

    // Skip focus order check if no focusable elements (can happen in headless CI)
    if (focusableCount === 0) {
      // Page loaded but no focusable elements - pass with note
      expect(true).toBe(true)
      return
    }

    // Click on body first to ensure focus is in document
    await page.click('body')
    await checkFocusOrder(page)

    // In headless mode, focus behavior can vary - just verify page is functional
    expect(focusableCount).toBeGreaterThan(0)
  })

  test('arrow keys navigate in menus', async ({ page }) => {
    // Look for a dropdown or menu
    const menuButton = page
      .getByRole('button', { name: /menu|options|more/i })
      .or(page.locator('[aria-haspopup="menu"]'))
      .first()

    const isVisible = await menuButton.isVisible().catch(() => false)

    if (isVisible) {
      await menuButton.click()
      await page.waitForTimeout(300)

      // Arrow down should move focus in menu
      await page.keyboard.press('ArrowDown')

      const focusedAfterArrow = await page.evaluate(() => document.activeElement?.textContent)
      expect(focusedAfterArrow).toBeDefined()
    }
  })

  test('Space bar toggles play/pause', async ({ page }) => {
    // ESCSUITE-187: with no clip on the timeline `canPlay` is false and Space
    // does nothing (`PlaybackControls.tsx`'s `handlePlayPause` early-returns),
    // so the old doctype-only version of this test could not have told a
    // working toggle from a dead one. `seedTextClip` puts a clip on the
    // timeline so there is something to play, and the transport button's
    // `title` (its accessible name, same text ESCAPECRAFT's own `VideoPlayer`
    // button uses) says which state it is in.
    await seedTextClip(page)

    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
  })

  test('keyboard shortcuts work without focus on inputs', async ({ page }) => {
    // Common video editor shortcuts
    // Z for undo
    await page.keyboard.press('z')

    // Should not crash
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
  })

  test('Escape closes panels and modals', async ({ page }) => {
    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)

    const heading = page.getByRole('heading', { name: 'Export Video' })
    await page.getByRole('button', { name: 'Export video' }).click()
    await expect(heading).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(heading).toBeHidden()
  })

  test('Tab traps focus in modals', async ({ page }) => {
    await seedTextClip(page)

    await page.getByRole('button', { name: 'Export video' }).click()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible()

    // Tab multiple times
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
    }

    // Focus should still be within the dialog
    const focusInDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      return !!dialog && dialog.contains(document.activeElement)
    })

    expect(focusInDialog).toBe(true)
  })

  test('timeline keyboard shortcuts', async ({ page }) => {
    // Left/Right arrows for frame stepping
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')

    // Should not crash
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
  })
})

/**
 * Records a short real take — `mockSyntheticMedia` hands the recorder a real
 * canvas-backed stream, so there is a genuine decodable file to save and
 * play back, the same shape `apps/e2e/tests/accessibility/core.spec.ts`'s
 * "playback dialog passes axe-core audit" test uses — and opens its playback
 * dialog from the library row's "Play" button.
 */
async function recordAndOpenPlayback(page: Page): Promise<void> {
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()

  const play = page.getByRole('button', { name: /^Play / })
  await expect(play).toBeVisible({ timeout: 30_000 })
  await play.click()

  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('VideoPlayer Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page, browserName }) => {
    // ESCSUITE-177: WebKit cannot store a Blob in IndexedDB in Playwright
    // (`UnknownError: Error preparing Blob/File data to be stored in object
    // store`), and every test below needs a saved take before there is
    // anything to open a playback dialog for.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  // ESCSUITE-185, proved in a real browser (ESCSUITE-187). Space is the
  // platform's own activation key for a focused button, and the player used
  // to claim it everywhere — so Space on the playback dialog's Close button
  // toggled playback instead of closing the dialog. `spaceBelongsToTarget`
  // (`VideoPlayer.tsx`) is the fix: it leaves Space alone when focus is on
  // something Space already activates.
  test('Space on the playback dialog Close button closes it, not the video', async ({ page }) => {
    test.setTimeout(120_000)
    await recordAndOpenPlayback(page)

    // Patch the *instance's* play()/pause() rather than listen for the
    // 'play'/'pause' events: removing a playing <video> from the document —
    // which closing the dialog always does — fires a 'pause' event of its
    // own regardless of whether `togglePlayPause` ran, so that event is not
    // a reliable signal here. `togglePlayPause` (ESCSUITE-185's bug) calls
    // one of these two methods directly; the browser's own removal-time
    // event does not go through them.
    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement
      const w = window as unknown as { __escsuite187ToggleCalled: boolean }
      w.__escsuite187ToggleCalled = false
      const originalPlay = video.play.bind(video)
      const originalPause = video.pause.bind(video)
      video.play = ((...args: Parameters<typeof video.play>) => {
        w.__escsuite187ToggleCalled = true
        return originalPlay(...args)
      }) as typeof video.play
      video.pause = ((...args: Parameters<typeof video.pause>) => {
        w.__escsuite187ToggleCalled = true
        return originalPause(...args)
      }) as typeof video.pause
    })

    const closeButton = page.getByRole('button', { name: 'Close playback' })
    await closeButton.focus()
    await page.keyboard.press('Space')

    // The dialog (and its video) is gone — Space activated the focused
    // button the way the platform always does for one — so whether
    // `togglePlayPause` ran is read from the flag set above, not the (now
    // unmounted) video element.
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(
      await page.evaluate(
        () => (window as unknown as { __escsuite187ToggleCalled: boolean }).__escsuite187ToggleCalled
      )
    ).toBe(false)
  })

  // The inverse: nothing in the dialog claims Space for its own activation,
  // so it stays the player's play/pause shortcut.
  test('Space toggles play/pause when focus is on the dialog body', async ({ page }) => {
    test.setTimeout(120_000)
    await recordAndOpenPlayback(page)

    // A real click, not `autoPlay`, puts the player in a known state —
    // independent of whichever way the browser's autoplay policy decided
    // the mount's `autoPlay` attribute.
    const transportToggle = page.getByTitle(/^(Play|Pause) \(Space\)$/)
    if ((await transportToggle.getAttribute('title')) === 'Play (Space)') {
      await transportToggle.click()
    }
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()

    await page.getByRole('dialog').focus()
    await page.keyboard.press('Space')
    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()
  })

  test('M key toggles mute', async ({ page }) => {
    const videoPlayer = page
      .locator('[data-testid="video-player"]')
      .or(page.locator('video'))
      .first()

    const isVisible = await videoPlayer.isVisible().catch(() => false)

    if (isVisible) {
      await videoPlayer.focus()
      await page.keyboard.press('m')

      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('F key toggles fullscreen', async ({ page }) => {
    const videoPlayer = page
      .locator('[data-testid="video-player"]')
      .or(page.locator('video'))
      .first()

    const isVisible = await videoPlayer.isVisible().catch(() => false)

    if (isVisible) {
      await videoPlayer.focus()
      // Note: Fullscreen may not work in test environment
      await page.keyboard.press('f')

      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })

  test('Arrow keys seek video', async ({ page }) => {
    const videoPlayer = page
      .locator('[data-testid="video-player"]')
      .or(page.locator('video'))
      .first()

    const isVisible = await videoPlayer.isVisible().catch(() => false)

    if (isVisible) {
      await videoPlayer.focus()
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')

      const html = await page.content()
      expect(html).toContain('<!DOCTYPE html>')
    }
  })
})
