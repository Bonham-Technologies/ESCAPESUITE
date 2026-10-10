import { test, expect } from '@playwright/test'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import { checkFocusOrder, runAxeCheck } from '../../utils/accessibility'
import { seedTextClip, keyframePanel } from '../../utils/artist'
import { recordAndOpenPlayback } from '../../utils/craft'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEPLAN Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
  })

  test('can tab through navigation links', async ({ page, browserName }) => {
    // `Layout.tsx` always renders a real `<header>`/`<nav>` — no `if
    // (isVisible)` guard needed around the only assertion (ESCSUITE-202 K-4).
    //
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
  })

  test('Enter key activates buttons', async ({ page }) => {
    // "Open the editor" calls `launchTool('artist')`, which `window.open`s
    // in dev — a real, observable consequence instead of a doctype check
    // that survives any amount of React failure (ESCSUITE-202 K-3).
    const button = page.getByRole('button', { name: 'Open the editor' })
    await button.focus()

    const popupPromise = page.waitForEvent('popup')
    await page.keyboard.press('Enter')
    const popup = await popupPromise
    expect(popup.url()).toContain(':5175')
    await popup.close()
  })

  // ESCSUITE-187: a `Space key activates buttons` case used to live here,
  // but it asserted nothing a regression could break (doctype-only) and the
  // real Space behaviour worth proving — ESCSUITE-185's playback dialog —
  // needs ESCAPECRAFT, not ESCAPEPLAN. It moved to the
  // `VideoPlayer Keyboard Shortcuts` describe below.

  // ESCSUITE-214: ESCAPEPLAN's skip link, the gap ESCSUITE-202 surfaced here
  // and left unfixed (that was a test-only ticket). `Layout.tsx` renders it as
  // its first child on every route, off-screen until focused.
  test('the skip link is the first Tab stop and moves focus into main', async ({
    page,
    browserName,
  }) => {
    // ESCSUITE-177: WebKit's default "Tab to links" preference is off, so a
    // plain Tab never reaches a link — Option+Tab (Alt+Tab here) is the
    // real-Safari equivalent, the same as `can tab through navigation links`.
    const advance = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'

    const skipLink = page.getByRole('link', { name: 'Skip to main content' })

    // Off-screen before it is focused — present in the tab order, absent from
    // the page.
    const hidden = await skipLink.boundingBox()
    expect(hidden?.y).toBeLessThan(0)

    // The very first Tab, with nothing focused yet, lands on it — ahead of the
    // header's logo link, GitHub link and theme toggle.
    await page.keyboard.press(advance)
    await expect(skipLink).toBeFocused()

    // ...and it is on screen once it has focus.
    const shown = await skipLink.boundingBox()
    expect(shown?.y).toBeGreaterThanOrEqual(0)

    await page.keyboard.press('Enter')

    await expect(page.locator('main')).toBeFocused()
  })

  test('focusable elements have visible focus', async ({ page }) => {
    // Tab to first few elements and check for focus indicators
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')

      const result = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return { onBody: true, hasFocusIndicator: false }

        const styles = window.getComputedStyle(el)
        const outlineWidth = parseInt(styles.outlineWidth) || 0
        const boxShadow = styles.boxShadow !== 'none'

        return { onBody: false, hasFocusIndicator: outlineWidth > 0 || boxShadow }
      })

      // Focus actually moved off the document (ESCAPEPLAN has real nav
      // links and CTA buttons to land on) and is visible once it does —
      // the old version's `if (!el || el === document.body) return true`
      // made a broken focus ring and a broken Tab order indistinguishable.
      expect(result.onBody).toBe(false)
      expect(result.hasFocusIndicator).toBe(true)
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
    // The idle recorder always has focusable chrome (the source toggles,
    // Start recording, Help) — assert that rather than skip past what would
    // otherwise be an empty page.
    const focusableCount = await page.evaluate(() => {
      const focusable = document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      return focusable.length
    })
    expect(focusableCount).toBeGreaterThan(0)

    await page.click('body')
    const focusOrder = await checkFocusOrder(page)
    expect(focusOrder.length).toBeGreaterThan(0)
  })

  test('Enter toggles recording buttons', async ({ page }) => {
    // Enter is the browser's own activation key for a focused `<button>` —
    // the same native behaviour `Space toggles toggle switches` below
    // asserts for Space, here for the other activation key. The first
    // `[aria-pressed]` match is the Screen toggle (`SourceToggles.tsx`).
    const toggle = page
      .locator('[role="switch"]')
      .or(page.locator('[aria-pressed]'))
      .first()

    await expect(toggle).toBeVisible()
    const initialState = await toggle.getAttribute('aria-pressed')
    expect(initialState).not.toBeNull()

    await toggle.focus()
    await page.keyboard.press('Enter')

    await expect(toggle).toHaveAttribute('aria-pressed', initialState === 'true' ? 'false' : 'true')
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

  test('Escape cancels the countdown', async ({ page }) => {
    // CRAFT has no source-selection popover for Escape to close — there is
    // nothing behind "Screen"/"Webcam" but a plain toggle button. What
    // Escape really cancels here, in every state but idle, is the live take
    // (ESCSUITE-106/174): the 3-2-1 countdown reaches the real
    // `onCancel` the record button's own "Cancel countdown" label takes.
    //
    // The describe's own `beforeEach` uses the inert `mockGetUserMedia`
    // stream (no real tracks), which every other test here is fine with —
    // but assigning it to the preview `<video>`'s `srcObject` throws
    // (`TypeError: ... not of type MediaStream`), and with no error
    // boundary around it that crashes the whole app before the countdown
    // ever shows. Re-navigating with `mockSyntheticMedia`'s real
    // canvas-backed stream avoids that crash.
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Cancel countdown' })).toBeVisible({
      timeout: 10_000,
    })

    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('webcam toggle responds to keyboard', async ({ page }) => {
    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })
    await expect(webcamToggle).toBeVisible()
    const initialState = await webcamToggle.getAttribute('aria-pressed')
    expect(initialState).not.toBeNull()

    await webcamToggle.focus()
    await page.keyboard.press('Enter')

    await expect(webcamToggle).toHaveAttribute(
      'aria-pressed',
      initialState === 'true' ? 'false' : 'true'
    )
  })

  test('microphone toggle responds to keyboard', async ({ page }) => {
    const micToggle = page.getByRole('button', { name: 'Microphone' })
    await expect(micToggle).toBeVisible()
    const initialState = await micToggle.getAttribute('aria-pressed')
    expect(initialState).not.toBeNull()

    await micToggle.focus()
    await page.keyboard.press('Enter')

    await expect(micToggle).toHaveAttribute(
      'aria-pressed',
      initialState === 'true' ? 'false' : 'true'
    )
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
    // ESCSUITE-202 K-1: the old version's fallback — `if (focusableCount ===
    // 0) { expect(true).toBe(true); return }` — was a literal always-pass
    // placeholder. `checkFocusOrder` identifies a focused element by
    // `id || data-testid || tagName`, which collapses every unlabelled
    // icon-only toolbar button to the same "button" string and reports a
    // false cycle after the second one — so this counts real Tab stops by
    // marking each focused element as it is visited, the actual claim
    // "can tab through toolbar" makes: the editor's toolbar, File menu and
    // inspector alone are comfortably more than five focusable elements.
    await page.click('body')
    let distinctStops = 0
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      const isNew = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return false
        if (el.hasAttribute('data-e2e-tab-seen')) return false
        el.setAttribute('data-e2e-tab-seen', '1')
        return true
      })
      if (isNew) distinctStops++
    }
    expect(distinctStops).toBeGreaterThan(5)
  })

  // ESCSUITE-202 surfaced this as a real app defect and left it for
  // ESCSUITE-216, which fixed it: `FileMenu.tsx` wraps `role="menu"` around
  // what are now four `role="menuitem"` buttons with a roving tabindex and
  // the APG key model. The old "arrow keys navigate in menus" placeholder
  // asserted `toBeDefined()` on a string behind an `if (isVisible)` — true
  // for `undefined` too — and these two cases replace it.
  test('arrow keys move focus inside the File menu', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'File menu' })
    await trigger.focus()
    await page.keyboard.press('Enter')

    const menu = page.getByRole('menu', { name: 'File options' })
    await expect(menu).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Opening the menu puts focus on its first item, and it is the menu's
    // only tab stop.
    const focusedText = () => page.evaluate(() => document.activeElement?.textContent ?? '')
    expect(await focusedText()).toContain('New Project')

    await page.keyboard.press('ArrowDown')
    expect(await focusedText()).toContain('Open Project...')

    await page.keyboard.press('ArrowUp')
    expect(await focusedText()).toContain('New Project')

    // Wrapped past the first item round to the last one that can take focus.
    // Export Video is disabled on an empty timeline, so the wrap steps over
    // it and lands on Save Project — a `disabled` <button> is out of
    // `.focus()`'s reach as well as out of the tab order.
    await expect(page.getByRole('menuitem', { name: /Export Video/ })).toBeDisabled()
    await page.keyboard.press('ArrowUp')
    expect(await focusedText()).toContain('Save Project')

    await page.keyboard.press('Home')
    expect(await focusedText()).toContain('New Project')
  })

  test('Escape closes the File menu and gives focus back to its button', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'File menu' })
    await trigger.focus()
    await page.keyboard.press('Enter')

    const menu = page.getByRole('menu', { name: 'File options' })
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(menu).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  })

  // ESCSUITE-243: the keyframe panel's rows were `<div onClick>`, so the
  // graph's own keyboard model (arrows, Enter, Delete, easing cycling) could
  // only be reached with a mouse. The rows are now buttons in one labelled
  // group with a roving tab stop, Enter opens a row's graph with focus on it,
  // and Escape hands focus back.
  test('the keyframe panel is operable from the keyboard and passes axe', async ({ page }) => {
    await seedTextClip(page)
    await page.keyboard.press('k')
    const panel = keyframePanel(page)
    await expect(panel).toBeVisible()

    const group = panel.getByRole('group', { name: 'Animated properties' })
    const opacity = group.getByRole('button', { name: 'Opacity' })
    const blur = group.getByRole('button', { name: 'Blur' })

    // One tab stop for the rows: from the play button a single Tab lands on
    // the first row, and a second leaves them all.
    await panel.getByRole('button', { name: 'Play clip preview' }).focus()
    await page.keyboard.press('Tab')
    await expect(group.getByRole('button', { name: 'Position X' })).toBeFocused()
    await page.keyboard.press('Tab')
    expect(
      await group.evaluate((el) => el.contains(document.activeElement))
    ).toBe(false)

    // Arrows walk the rows and wrap; End jumps.
    await group.getByRole('button', { name: 'Position X' }).focus()
    await page.keyboard.press('ArrowUp')
    await expect(blur).toBeFocused()
    await page.keyboard.press('Home')
    await expect(group.getByRole('button', { name: 'Position X' })).toBeFocused()

    // Enter opens the row's graph and puts focus on it.
    await opacity.focus()
    await page.keyboard.press('Enter')
    await expect(opacity).toHaveAttribute('aria-pressed', 'true')
    const graph = page.getByRole('listbox', { name: 'Keyframes for Opacity' })
    await expect(graph).toBeFocused()

    // The open panel — rows, graph, close buttons, play button — audits clean.
    // Colour contrast is carved out for the same reason the graph audit in
    // core.spec.ts carves it out: SVG over the app's dark chrome.
    await graph.dblclick()
    await expect(graph.getByRole('option')).toHaveCount(2)
    const results = await runAxeCheck(page, {
      includeSelector: 'body > div:not(#root)',
      disableRules: ['color-contrast'],
    })
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )
    expect(serious).toHaveLength(0)
    expect(results.passes).toBeGreaterThan(0)

    // Escape: the first spends itself on the active keyframe (the graph claims
    // it), the second returns focus to the row that opened the graph.
    await graph.focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(opacity).toBeFocused()
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

  // ESCSUITE-270: a button the mouse clicked keeps focus; Space must play or
  // pause, not press that button again. A keyboard-focused button keeps Space.
  test('Space after a mouse-clicked track button plays; after Tab it presses the button', async ({
    page,
  }) => {
    await seedTextClip(page)

    await page.getByTitle('Mute', { exact: true }).first().click()
    await expect(page.getByTitle('Unmute', { exact: true }).first()).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()
    // The mute button was not pressed a second time.
    await expect(page.getByTitle('Unmute', { exact: true }).first()).toBeVisible()

    await page.keyboard.press('Space')
    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    await page.click('body')
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab')
      const onMute = await page.evaluate(
        () => document.activeElement?.getAttribute('title') === 'Unmute',
      )
      if (onMute) break
    }
    await page.keyboard.press('Space')
    await expect(page.getByTitle('Mute', { exact: true }).first()).toBeVisible()
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
  })

  test('keyboard shortcuts work without focus on inputs', async ({ page }) => {
    // Bare "z" is not a shortcut (undo is Ctrl/Cmd+Z) — the old version
    // pressed a key that does nothing and then asserted a doctype, which
    // would pass whether or not the real shortcut worked. `seedTextClip`
    // leaves focus on the "Add Text" button (a plain button, not an input),
    // so Ctrl+Z firing from there is the real claim this test's name makes.
    await seedTextClip(page)
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()

    await page.keyboard.press('Control+z')
    await expect(page.getByText(/^0 clips/)).toBeVisible()
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
    // `PlaybackControls.tsx`'s global ArrowLeft/ArrowRight handler steps the
    // playhead a whole second at a time (not a frame — the test's own name
    // is loose about that, the shortcut itself is real) whenever focus is
    // off an input, select or textarea. The preview's timecode readout is
    // the real, observable consequence.
    await seedTextClip(page)
    const timecode = page.locator('[class*="timecode"]').first()
    await expect(timecode).toHaveText('00:00.000')

    await page.keyboard.press('ArrowRight')
    await expect(timecode).toHaveText('00:01.000')

    await page.keyboard.press('ArrowLeft')
    await expect(timecode).toHaveText('00:00.000')
  })
})

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
    test.setTimeout(120_000)
    await recordAndOpenPlayback(page)

    // `VideoPlayer.tsx`'s keydown handler is window-level, not tied to focus
    // on the video element itself.
    const video = page.locator('video')
    expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(false)
    await expect(page.getByTitle('Mute (M)')).toBeVisible()

    await page.keyboard.press('m')

    expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(true)
    await expect(page.getByTitle('Unmute (M)')).toBeVisible()

    await page.keyboard.press('m')
    expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(false)
  })

  // ESCSUITE-201: ESCAPECRAFT's VideoPlayer has no fullscreen feature at all
  // — no button, no 'f' key handler, nothing in `VideoPlayer.tsx`'s keydown
  // switch names it. "F key toggles fullscreen" had no feature to find and
  // is deleted rather than kept as a placeholder for one that does not exist.

  test('Arrow keys seek video', async ({ page }) => {
    test.setTimeout(120_000)
    await recordAndOpenPlayback(page)

    // Pause first — a playing video's currentTime keeps advancing on its
    // own, which would make a 5s `skip` hard to tell apart from ordinary
    // playback.
    const transportToggle = page.getByTitle(/^(Play|Pause) \(Space\)$/)
    if ((await transportToggle.getAttribute('title')) === 'Pause (Space)') {
      await transportToggle.click()
    }
    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    const video = page.locator('video')
    const before = await video.evaluate((el) => (el as HTMLVideoElement).currentTime)

    // The real take is only a couple of seconds long, so a +5s skip clamps
    // to its end (`seekTo`'s own clamp) rather than landing exactly at +5.
    await page.keyboard.press('ArrowRight')
    const afterRight = await video.evaluate((el) => (el as HTMLVideoElement).currentTime)
    expect(afterRight).toBeGreaterThan(before)

    await page.keyboard.press('ArrowLeft')
    const afterLeft = await video.evaluate((el) => (el as HTMLVideoElement).currentTime)
    expect(afterLeft).toBeLessThan(afterRight)
  })
})
