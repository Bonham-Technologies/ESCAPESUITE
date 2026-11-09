import { test, expect, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import {
  runAxeCheck,
  waitForAnimationsToFinish,
  checkImageAltText,
  checkHeadingHierarchy,
  checkFormLabels,
  checkLinkText,
} from '../../utils/accessibility'
import {
  ARTIST_URL,
  ARTIST_FIXTURE_MP4,
  seedTextClip,
  keyframePanel,
  importMediaAndAddToTimeline,
  inspector,
  openMobileInspector,
  openExportDialog,
  openExportAdvancedOptions,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEPLAN Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    // ESCSUITE-202 K-7: every test below is a pure negative (zero
    // violations, zero images without alt text, zero unlabelled forms, at
    // most two vague links) — every one of those is also true of a page
    // with nothing rendered on it. Anchor the whole describe on the real
    // landing page once, here, rather than in each test.
    await expect(page.locator('h1').first()).toBeVisible()
  })

  test('landing page passes axe-core audit', async ({ page }) => {
    const results = await runAxeCheck(page, {})

    // Allow minor/moderate issues but fail on serious/critical
    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('landing page has valid heading hierarchy', async ({ page }) => {
    const { valid, errors } = await checkHeadingHierarchy(page)

    // Log any errors for debugging
    if (!valid) {
      console.log('Heading hierarchy errors:', errors)
    }

    expect(valid).toBe(true)
  })

  test('landing page images have alt text', async ({ page }) => {
    const { withoutAlt } = await checkImageAltText(page)
    expect(withoutAlt).toBe(0)
  })

  test('landing page forms have labels', async ({ page }) => {
    const { unlabeled } = await checkFormLabels(page)
    expect(unlabeled).toHaveLength(0)
  })

  test('landing page links have meaningful text', async ({ page }) => {
    const { vague } = await checkLinkText(page)
    // Some vague links may be acceptable in navigation
    expect(vague.length).toBeLessThanOrEqual(2)
  })
})

// ESCSUITE-402: the hub's Known limitations page, in both themes — it is mostly
// links inside running text, which is where a palette tuned for one theme
// fails contrast (or link-in-text-block) in the other. `?theme=` is the shared
// theme system's own override and does not persist.
test.describe('ESCAPEPLAN Known limitations Accessibility', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`/limitations passes axe-core audit (${theme} theme)`, async ({ page }) => {
      await page.goto(`http://localhost:5173/limitations?theme=${theme}`)
      await waitForAppReady(page, 'plan')
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
      }
      // Anchor on the real page: an empty one has no violations either.
      await expect(page.getByRole('heading', { level: 1, name: /known limitations/i })).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: 'Check it yourself' })).toBeVisible()

      const results = await runAxeCheck(page, {})
      expect(results.violations).toEqual([])
    })
  }

  test('/limitations has a valid heading hierarchy', async ({ page }) => {
    await page.goto('http://localhost:5173/limitations')
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('heading', { level: 1, name: /known limitations/i })).toBeVisible()

    const { valid, errors } = await checkHeadingHierarchy(page)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  test('the hub footer links to /limitations', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await waitForAppReady(page, 'plan')
    await page.locator('footer').getByRole('link', { name: 'Known limitations' }).click()
    await expect(page).toHaveURL(/\/limitations$/)
    await expect(page.getByRole('heading', { level: 1, name: /known limitations/i })).toBeVisible()
  })
})

// ESCSUITE-413: the legal pages are running text full of links, like
// /limitations, and no audit visited them, so a link drawn in the button
// accent (2.96:1 on the dark background) shipped unnoticed. Both themes, every
// rule axe runs by default, zero violations allowed.
test.describe('ESCAPEPLAN legal pages Accessibility', () => {
  const pages = [
    { path: '/privacy', heading: /privacy policy/i },
    { path: '/terms', heading: /terms of service/i },
  ] as const
  for (const { path, heading } of pages) {
    for (const theme of ['dark', 'light'] as const) {
      test(`${path} passes axe-core audit (${theme} theme)`, async ({ page }) => {
        await page.goto(`http://localhost:5173${path}?theme=${theme}`)
        await waitForAppReady(page, 'plan')
        if (theme === 'light') {
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
        } else {
          await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
        }
        // Anchor on the real page and on its in-text links: an empty page, or
        // one whose links failed to render, has no violations either.
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        await expect(
          page.getByRole('main').getByRole('link', { name: 'Bonham Technologies, LLC' }),
        ).toBeVisible()

        const results = await runAxeCheck(page, {})
        expect(results.violations).toEqual([])
      })
    }
  }
})

test.describe('ESCAPECRAFT Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('recording UI passes axe-core audit', async ({ page }) => {
    // ESCSUITE-201 K-7: an axe audit is a pure negative, satisfied by a page
    // with nothing in it. Prove the idle recorder shell actually rendered
    // before trusting zero violations — the live-take and dialog audits
    // below cover the states this one does not reach.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    const results = await runAxeCheck(page)

    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('recording controls have accessible names', async ({ page }) => {
    // Check that buttons have accessible names
    const buttons = page.getByRole('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)
      if (!isVisible) continue

      const name = await button.getAttribute('aria-label')
      const text = await button.textContent()
      const title = await button.getAttribute('title')

      // Button should have some accessible name
      const hasAccessibleName = !!(name || text?.trim() || title)
      expect(hasAccessibleName).toBe(true)
    }
  })

  test('recording UI has valid heading hierarchy', async ({ page }) => {
    // Zero headings is a "valid" hierarchy too — `checkHeadingHierarchy`
    // only reports skipped levels and duplicate h1s, so this floors it on
    // the idle shell's own stable set: the h1 "ESCAPECRAFT" logo
    // (AppHeader.tsx) plus the h2 "Sources" and "Recordings" section
    // titles (WebcamOverlaySettings' "Webcam Overlay" h2 only renders once
    // the webcam is on, and the Help dialog's headings only once it is
    // open — neither is true on a fresh idle load).
    const { valid, headings } = await checkHeadingHierarchy(page)
    expect(headings).toHaveLength(3)
    expect(valid).toBe(true)
  })

  test('toggle controls have proper state', async ({ page }) => {
    // Check that toggle buttons have aria-pressed or aria-checked
    const toggles = page.locator('[role="switch"], [aria-pressed], [aria-checked]')
    const count = await toggles.count()

    // The four source toggles (Screen/Webcam/Microphone/System Audio) are
    // always present.
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const toggle = toggles.nth(i)
      const pressed = await toggle.getAttribute('aria-pressed')
      const checked = await toggle.getAttribute('aria-checked')

      // Toggle should have explicit state
      const hasState = pressed !== null || checked !== null
      expect(hasState).toBe(true)
    }
  })
})

/**
 * ESCAPECRAFT beyond the idle page.
 *
 * The audit above only ever sees the recorder sitting still. These three runs
 * cover the states a user actually spends time in — the Recording Tips modal,
 * the playback modal over a saved take, and a take in progress — in the same
 * shape as the ESCAPEARTIST Export-dialog audit: open the thing, prove it is on
 * screen, then count serious/critical violations.
 *
 * The playback and mid-recording runs need capture that produces real frames,
 * so they install `mockSyntheticMedia` rather than the inert `mockGetUserMedia`
 * stub the block above uses — an empty stream never reaches `recording`.
 */
test.describe('ESCAPECRAFT Dialog and Recording Accessibility', () => {
  /** Wait for capability detection: the source toggles are dead until it lands. */
  async function waitForCapabilities(page: Page) {
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
  }

  async function seriousViolations(page: Page) {
    const results = await runAxeCheck(page)
    return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  }

  test('help dialog passes axe-core audit', async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    await page.getByRole('button', { name: /help - recording tips/i }).click()
    await expect(page.getByRole('dialog', { name: 'Recording Tips' })).toBeVisible()

    expect(await seriousViolations(page)).toHaveLength(0)
  })

  test('playback dialog passes axe-core audit', async ({ page, browserName }) => {
    test.setTimeout(120_000)
    // ESCSUITE-177: a saved take is required before there is anything to
    // play back, and Playwright's WebKit cannot store a Blob in IndexedDB at
    // all on this platform (confirmed with a bare `objectStore.put(blob,
    // key)`, no app code involved — `UnknownError: Error preparing Blob/File
    // data to be stored in object store`).
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
    await waitForCapabilities(page)

    // A take has to exist before there is anything to play back.
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

    expect(await seriousViolations(page)).toHaveLength(0)
  })

  /**
   * The library with a finished take in it (ESCSUITE-92). The audits above see
   * the recorder idle, mid-take and its two dialogs; none of them sees a
   * recording ROW — Play, the three downloads, Open in Editor, Delete — or the
   * conversion progress row that replaces the downloads while an MP4 is being
   * made. Same shape as the playback audit: record a take, then audit the page
   * with the row in it, then start a conversion and audit again while the
   * progress row is up.
   */
  test('the library with a finished take passes axe-core audit, rows and conversion included', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000)
    // ESCSUITE-177: same WebKit Blob-in-IndexedDB gap as the playback dialog
    // audit above — this test needs the recorded take saved too.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
    await waitForCapabilities(page)

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    const play = page.getByRole('button', { name: /^Play / })
    await expect(play).toBeVisible({ timeout: 30_000 })

    // The row: every control named, and named for the take.
    // The library is the one <section> headed "Recordings" (it carries no
    // landmark role of its own).
    const list = page.locator('section', { has: page.getByRole('heading', { name: 'Recordings' }) })
    const rowButtons = list.getByRole('button')
    const count = await rowButtons.count()
    expect(count).toBeGreaterThanOrEqual(5)
    for (let i = 0; i < count; i++) {
      await expect(rowButtons.nth(i)).toHaveAccessibleName(/\S/)
    }
    await expect(list.getByRole('button', { name: /^Download .+ as MP4$/ })).toBeVisible()
    await expect(list.getByRole('button', { name: /^Delete / })).toBeVisible()

    expect(await seriousViolations(page)).toHaveLength(0)
    const { unlabeled } = await checkFormLabels(page)
    expect(unlabeled).toHaveLength(0)

    // The conversion row. The synthetic take is a WebCodecs recording in
    // Chromium, so the MP4 button is enabled; the conversion is bound to
    // playback speed, which leaves the progress row up long enough to audit.
    const mp4 = list.getByRole('button', { name: /^Download .+ as MP4$/ })
    await expect(mp4).toBeEnabled()
    await mp4.click()
    const bar = list.getByRole('progressbar')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(bar).toHaveAccessibleName(/^Converting .+ to MP4$/)
    await expect(list.getByRole('button', { name: /^Cancel MP4 conversion of / })).toBeVisible()

    expect(await seriousViolations(page)).toHaveLength(0)

    await list.getByRole('button', { name: /^Cancel MP4 conversion of / }).click()
    await expect(bar).toBeHidden({ timeout: 15_000 })
  })

  // Both themes, because a take in progress is where the app draws its one red
  // text — the "Recording" label and the running timer — and a colour token
  // tuned for one palette is a contrast failure in the other. `?theme=` is the
  // app's own override (`parseThemeFromUrl` in @escapesuite/shared/theme) and
  // does not persist, so each run is independent.
  for (const theme of ['dark', 'light'] as const) {
    test(`a take in progress passes axe-core audit (${theme} theme)`, async ({ page }) => {
      test.setTimeout(120_000)

      await mockSyntheticMedia(page)
      await grantMediaPermissions(page)
      await page.goto(`http://localhost:5174/?theme=${theme}`)
      await waitForAppReady(page, 'craft')
      // applyTheme sets data-theme for light and *removes* it for dark, so the
      // two assertions are not symmetrical.
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
      }
      await waitForCapabilities(page)

      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
        timeout: 30_000,
      })

      expect(await seriousViolations(page)).toHaveLength(0)

      // Leave the app idle rather than mid-capture, so teardown is not racing an
      // encoder that is still writing.
      await page.getByRole('button', { name: 'Stop recording' }).click()
    })
  }
})

test.describe('ESCAPEARTIST Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    // ESCSUITE-177 review "Races" 2: waitForAppReady resolves at React's
    // first commit (attachment), which can land before ARTIST's
    // asynchronous listSessionStates() has decided whether to raise the
    // "Resume Previous Session?" prompt — exactly the hazard
    // `?suppressRestore=1` exists to rule out below, in the one test in
    // this file ("the clip inspector's controls have associated labels")
    // that already uses it for the same reason.
    await page.goto('http://localhost:5175?suppressRestore=1')
    await waitForAppReady(page, 'artist')
  })

  // ESCSUITE-415: both themes, and `region` (moderate) is asserted on its own:
  // the toolbar sat between the header and <main>, in no landmark, so a
  // screen-reader user moving by landmark skipped every editing tool. The
  // serious/critical filter below never saw it. `?theme=` is the app's own
  // override and does not persist.
  for (const theme of ['dark', 'light'] as const) {
    test(`editor UI passes axe-core audit (${theme} theme)`, async ({ page }) => {
      await page.goto(`http://localhost:5175?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      // Dark *removes* data-theme, so the attribute alone also holds before
      // initTheme has run. window.ESCAPE_THEME is exposed only after the theme
      // is applied, so polling it proves this page really resolved `theme`.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as { ESCAPE_THEME?: { getResolvedTheme(): string } }).ESCAPE_THEME?.getResolvedTheme() ??
              null
          )
        )
        .toBe(theme)
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
      }
      // ESCSUITE-202 K-7: an axe audit is a pure negative, satisfied by a page
      // with nothing in it. Prove the idle editor shell actually rendered
      // before trusting zero violations — the dialog/keyframe/clip-inspector
      // audits elsewhere in this describe cover the states this one does not
      // reach.
      await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()
      await expect(page.getByTitle('Selection Tool (V)')).toBeVisible()

      const results = await runAxeCheck(page, {
        // Disable color-contrast for canvas-based timeline
        disableRules: ['color-contrast'],
      })

      const outsideLandmarks = results.violations
        .filter((v) => v.id === 'region')
        .map((v) => ({ nodes: v.nodes, first: v.firstNode?.target }))
      expect(outsideLandmarks, 'content outside any landmark').toEqual([])

      const seriousViolations = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      )

      expect(seriousViolations).toHaveLength(0)
    })
  }

  test('the open File menu passes axe-core audit (ESCSUITE-216)', async ({ page }) => {
    // Red before ESCSUITE-216 and never seen by any audit, because no audit
    // had opened the menu: `role="menu"` over four plain `<button>`s is an
    // `aria-required-children` violation of critical impact.
    await page.getByRole('button', { name: 'File menu' }).click()
    await expect(page.getByRole('menu', { name: 'File options' })).toBeVisible()
    expect(await page.getByRole('menuitem').count()).toBe(4)

    const results = await runAxeCheck(page, {
      // Disable color-contrast for canvas-based timeline
      disableRules: ['color-contrast'],
    })

    expect(results.violations.map((violation) => violation.id)).not.toContain(
      'aria-required-children'
    )
    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )
    expect(seriousViolations).toHaveLength(0)
  })

  test('toolbar buttons have accessible names', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"], .toolbar, [class*="toolbar"]').first()
    await expect(toolbar).toBeVisible()

    const buttons = toolbar.getByRole('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const name = await button.getAttribute('aria-label')
      const text = await button.textContent()
      const title = await button.getAttribute('title')

      const hasAccessibleName = !!(name || text?.trim() || title)
      expect(hasAccessibleName).toBe(true)
    }
  })

  test('editor has valid heading hierarchy', async ({ page }) => {
    // Zero headings is "valid" too (`checkHeadingHierarchy` only reports
    // skipped levels and duplicate h1s), which a gutted page would also
    // report — floor it on the idle shell's own stable set: just the h1
    // "ESCAPEARTIST" logo (`AppHeader.tsx`). Every other heading in the app
    // is inside a dialog or the clip inspector's selected state, neither of
    // which is true on a fresh idle load.
    const { valid, headings } = await checkHeadingHierarchy(page)
    expect(headings).toHaveLength(1)
    expect(valid).toBe(true)
  })

  test('modals have proper dialog role', async ({ page }) => {
    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)
    await page.getByRole('button', { name: 'Export video' }).click()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    const labelledBy = await dialog.getAttribute('aria-labelledby')
    const label = await dialog.getAttribute('aria-label')
    expect(labelledBy || label).toBeTruthy()
  })

  test('form inputs have associated labels', async ({ page }) => {
    // An empty page reports zero unlabelled controls too — prove the idle
    // shell actually had real inputs to check: the resolution picker and the
    // default track's volume slider are both unconditionally on screen.
    const { labeled, unlabeled } = await checkFormLabels(page)
    expect(labeled).toBeGreaterThanOrEqual(2)
    expect(unlabeled).toHaveLength(0)
  })

  /**
   * The clip inspector, which the audit above never sees.
   *
   * `form inputs have associated labels` runs with nothing selected, so the
   * inspector is its empty state — a prompt and five buttons — and not one of
   * the panel's twenty-odd controls was ever in front of it. They had no names:
   * every row was a `<label>Blur</label><input/>` pair with no `htmlFor`.
   * ESCSUITE-89 named them all, and this is the end-to-end half of that
   * contract — in a real browser, where the name is the browser's own
   * computation and axe's, not a test's.
   *
   * Run over the three clip kinds whose sections differ: a media clip (the only
   * one with Blend Mode, Mask & Stroke, Effects and Transition Out), a text
   * overlay and a shape overlay. Each one's sections are opened first — four
   * default closed, and a closed section renders none of its controls — and the
   * dropdowns that hide rows behind a choice are given one, so the conditional
   * rows are audited too.
   */
  test("the clip inspector's controls have associated labels", async ({ page, browserName }) => {
    // A real media import, then three axe passes over a panel of twenty-odd
    // controls.
    test.setTimeout(180_000)
    // ESCSUITE-177: the "a media clip" step below imports a real file, which
    // stores its bytes in IndexedDB — and Playwright's WebKit cannot store a
    // Blob there at all on this platform (confirmed with a bare
    // `objectStore.put(blob, key)`, no app code involved —
    // `UnknownError: Error preparing Blob/File data to be stored in object
    // store`).
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    /**
     * Open every section that is currently closed.
     *
     * Addressed by shape rather than by a list of titles: the point is to reach
     * whatever the panel renders for this clip, and a list here would go stale
     * the next time a section is added. A section is the element that holds a
     * collapsible header; it renders its body only while it is open.
     */
    const openEverySection = async () => {
      const sections = page.locator('[class*="section"]:has(> [class*="collapsibleHeader"])')
      const count = await sections.count()
      expect(count).toBeGreaterThan(3)

      for (let i = 0; i < count; i++) {
        const section = sections.nth(i)
        const body = section.locator('[class*="collapsibleContent"]')
        if ((await body.count()) === 0) {
          await section.locator('[class*="collapsibleToggle"]').click()
          await expect(body).toBeVisible()
        }
      }
    }

    /**
     * Put the panel back to its empty state, which is the only place the
     * overlay-creating buttons live.
     *
     * Escape is the editor's deselect, and `useAppKeyboardShortcuts` ignores
     * every key while focus is in an input, a select or a textarea — so focus a
     * plain button first. A section header is one, and focusing it toggles
     * nothing.
     */
    const deselectClip = async () => {
      await page.locator('[class*="collapsibleToggle"]').first().focus()
      await page.keyboard.press('Escape')
      await expect(page.getByText('Select a clip to edit')).toBeVisible()
    }

    /** Both audits over whatever the inspector is currently showing. */
    const auditInspector = async (what: string) => {
      const { labeled, unlabeled } = await checkFormLabels(page)
      expect(unlabeled, `unlabeled controls with ${what} selected`).toEqual([])
      // An empty panel would report no unlabeled controls either, so prove the
      // audit had the inspector in front of it: the page chrome alone carries a
      // handful of fields, an open inspector carries a dozen and a half more.
      expect(labeled, `labeled controls with ${what} selected`).toBeGreaterThan(14)

      const results = await runAxeCheck(page, {
        // Same carve-out as the editor audit above: the canvas timeline's
        // contrast is not something axe can compute.
        disableRules: ['color-contrast'],
      })
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      )
      expect(serious, `axe violations with ${what} selected`).toEqual([])
    }

    // `?suppressRestore=1` so an autosaved session from an earlier test in this
    // worker cannot put a dialog in front of the panel.
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    await test.step('a media clip', async () => {
      await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)
      const addToTimeline = page.getByRole('button', { name: 'Add to timeline' })
      await expect(addToTimeline).toBeVisible({ timeout: 60_000 })
      await addToTimeline.click()
      // Just the clip: how many tracks the default project starts with is not
      // this test's business.
      // Two elements can say "1 clip" (the info bar and the media card's usage
      // line), so this is not a strict single match.
      await expect(page.getByText(/1 clip/).first()).toBeVisible({ timeout: 15_000 })

      // Select it the way a user does, and prove the inspector is showing a
      // clip rather than its empty state.
      await page.locator('[data-clip-id]').first().click()
      await expect(page.getByRole('button', { name: 'Transform', exact: true })).toBeVisible()

      await openEverySection()

      // Four rows exist only once a choice has been made: each animation
      // group's duration and easing, the transition's duration, and the mask's
      // corner radius. Choosing through the controls' own names is also a check
      // that those names are what this ticket says they are.
      await page.getByLabel('Animate In', { exact: true }).selectOption('fade')
      await page.getByLabel('Animate Out', { exact: true }).selectOption('fade')
      await page.getByLabel('Type', { exact: true }).selectOption('fade')
      await page.getByLabel('Mask shape', { exact: true }).selectOption('rounded')
      await expect(page.getByLabel('Corner Radius', { exact: true })).toBeVisible()
      // The duration slider's name is composed by `aria-labelledby` (the group
      // heading plus its own label), which a role query resolves and a label
      // query does not.
      await expect(page.getByRole('slider', { name: 'Animate In Duration', exact: true })).toBeVisible()

      await auditInspector('a media clip')
    })

    await test.step('a text overlay', async () => {
      await deselectClip()
      await page.getByRole('button', { name: 'Add Text' }).click()
      await expect(page.getByRole('button', { name: 'Text Content', exact: true })).toBeVisible()

      await openEverySection()
      await page.getByLabel('Animate In', { exact: true }).selectOption('fade')
      await page.getByLabel('Animate Out', { exact: true }).selectOption('fade')

      await auditInspector('a text overlay')
    })

    await test.step('a shape overlay', async () => {
      await deselectClip()
      await page.getByRole('button', { name: 'Rectangle' }).click()
      await expect(page.getByRole('button', { name: 'Shape', exact: true })).toBeVisible()

      await openEverySection()
      await page.getByLabel('Animate In', { exact: true }).selectOption('fade')
      await page.getByLabel('Animate Out', { exact: true }).selectOption('fade')

      await auditInspector('a shape overlay')
    })
  })

  /**
   * The editor's three other modals.
   *
   * Same shape as the Export-dialog audit above and the CRAFT dialog audits
   * further up: open the thing, prove it really is an `aria-modal` dialog with
   * an accessible name, then count serious/critical violations inside it.
   *
   * The audit is scoped to `[role="dialog"]` rather than run over the whole
   * page: the editor behind these carries a canvas timeline whose contrast axe
   * cannot compute, which is why the page-wide audit above disables
   * `color-contrast` outright. Scoping keeps that rule live *inside* the dialog,
   * where it can actually be judged. An `include` that matched nothing would
   * also report zero violations, so each run asserts it had something in front
   * of it.
   */
  async function dialogViolations(page: Page) {
    // ESCSUITE-393: not mid-fade, or axe judges contrast at partial opacity.
    await waitForAnimationsToFinish(page.locator('[role="dialog"]').first())
    const results = await runAxeCheck(page, { includeSelector: '[role="dialog"]' })
    expect(results.passes).toBeGreaterThan(0)
    return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  }

  test('keyboard shortcuts sheet passes axe-core audit', async ({ page }) => {
    // `?` is the only way in — there is no button for it.
    await page.keyboard.press('Shift+Slash')

    const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('aria-modal', 'true')

    expect(await dialogViolations(page)).toHaveLength(0)
  })

  // ESCSUITE-369: the sheet's footer (the `?` tip and the version line) is
  // --text-muted, whose light value was 3.74:1 on the sheet's --bg-secondary.
  // The sheet's local override is gone since ESCSUITE-421 darkened the token
  // itself (5.68:1 there), so this audit now also guards the token.
  // `?theme=` is the app's own override and does not persist.
  // ESCSUITE-405: the group headings ("Tools", "Playback", ...) are audited
  // too. They were --accent-primary, #4a9eff at 2.56:1 on the light
  // --bg-secondary; they are now --accent-text, whose light value is a darker
  // blue that clears 4.5:1.
  test('keyboard shortcuts sheet passes axe-core audit (light theme)', async ({ page }) => {
    await page.goto('http://localhost:5175?suppressRestore=1&theme=light')
    await waitForAppReady(page, 'artist')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.keyboard.press('Shift+Slash')
    const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(/^ESCAPEARTIST v/)).toBeVisible()
    await waitForAnimationsToFinish(sheet)

    // The headings are in the audited subtree: prove it, so a markup change
    // that drops them cannot make this pass by auditing less.
    await expect(sheet.getByRole('heading', { level: 3, name: 'Tools' })).toBeVisible()

    const results = await runAxeCheck(page, { includeSelector: '[role="dialog"]' })
    expect(results.passes).toBeGreaterThan(0)
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    ).toHaveLength(0)
  })

  test('an open modal covers the keyframe panel, so a pointer cannot reach the graph behind it', async ({
    page,
  }) => {
    // The focus trap closes the *Tab* route into the keyframe graph. It cannot
    // close the *pointer* route, because that is a question of stacking: the
    // panel is a `createPortal` sibling of #root and used to carry a bare
    // `z-index: 1000`, while every modal overlay is `--z-modal` (200). It
    // therefore painted over the dialog's backdrop, `elementFromPoint` at the
    // graph returned the listbox, and a click there focused the graph and let
    // Enter add a keyframe from behind an `aria-modal` dialog. The panel now
    // uses `--z-panel` (150), below the modals.
    await seedTextClip(page)
    await page.keyboard.press('k')
    const panel = keyframePanel(page)
    await expect(panel).toBeVisible()
    await panel.getByText('Opacity', { exact: true }).click()

    const graph = page.getByRole('listbox', { name: 'Keyframes for Opacity' })
    await expect(graph).toBeVisible()
    const box = (await graph.boundingBox())!
    const cx = Math.round(box.x + box.width / 2)
    const cy = Math.round(box.y + box.height / 2)

    // What `document.elementFromPoint` returns at that coordinate, classified
    // against the two subtrees that matter. Both the keyframe panel and the
    // sheet call their outer element `.panel`, so a `[class*="panel"]` test
    // cannot tell them apart — walk to each subtree's root and use `contains`.
    const hitAt = (x: number, y: number) =>
      page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py)
        const graphEl = document.querySelector('[role="listbox"]')
        /** The portal's outermost element: the one whose parent is <body>. */
        const portalRoot = (from: Element | null) => {
          let node = from
          while (node && node.parentElement !== document.body) node = node.parentElement
          return node
        }
        const panelRoot = portalRoot(graphEl)
        const dialogEl = document.querySelector('[role="dialog"]')
        return {
          isGraph: el === graphEl,
          inKeyframePanel: !!(el && panelRoot && panelRoot.contains(el)),
          // The dialog, something inside it, or the backdrop that holds it.
          inDialogLayer: !!(
            el &&
            dialogEl &&
            (el === dialogEl || dialogEl.contains(el) || el === dialogEl.parentElement)
          ),
        }
      }, [x, y])

    // With nothing in front of it, that point really is the graph — otherwise
    // the assertion below would pass for the wrong reason.
    expect(await hitAt(cx, cy)).toEqual({
      isGraph: true,
      inKeyframePanel: true,
      inDialogLayer: false,
    })

    await page.keyboard.press('Shift+Slash')
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible()

    // ...and now the sheet is what a click at that point would hit: the graph is
    // no longer the hit target and nothing in the keyframe panel is either.
    expect(await hitAt(cx, cy)).toEqual({
      isGraph: false,
      inKeyframePanel: false,
      inDialogLayer: true,
    })

    // The consequence: clicking there cannot focus the graph — the click lands
    // in the sheet, which is what used to be unreachable at this coordinate.
    await page.mouse.click(cx, cy)
    expect(await graph.evaluate((el) => el === document.activeElement)).toBe(false)
  })

  test('project load dialog passes axe-core audit', async ({ page }) => {
    // The safety dialog only appears when there is work to lose, so seed a clip
    // first. Opening a project goes through the File System Access API; stub the
    // picker so the file arrives without a native dialog. The file is never read
    // on this path — the dialog is the question asked *before* the load — so any
    // handle that answers `getFile()` will do.
    await seedTextClip(page)
    await page.evaluate(() => {
      ;(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [
        { getFile: async () => new File(['{}'], 'seed.veditor', { type: 'application/json' }) },
      ]
    })

    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByText('Open Project...').click()

    const dialog = page.getByRole('dialog', { name: 'Load Project' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    expect(await dialogViolations(page)).toHaveLength(0)
  })

  test('resolution-change confirm passes axe-core audit', async ({ page }) => {
    // The fifth modal, and the only one opened by changing a form control
    // rather than by a button: picking any preset that is not the project's
    // current resolution raises the confirm.
    await page.getByLabel('Resolution').selectOption('4K')

    const dialog = page.getByRole('dialog', { name: 'Change Resolution' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    expect(await dialogViolations(page)).toHaveLength(0)
  })

  test('session restore prompt passes axe-core audit', async ({ page }) => {
    // The prompt is only offered for a session that holds at least one source
    // video (`app/useSessionRestore.ts`), and it is read on mount — so write one
    // straight into the `settings` store the app keeps it in and reload.
    //
    // This is the one test in the describe that *wants* the prompt, so it
    // overrides `beforeEach`'s `?suppressRestore=1` with a plain navigation
    // first — `reload()` below re-requests whatever URL the page is
    // currently on, and the whole point here is that URL must not carry
    // `?suppressRestore=1` when it does.
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    await page.evaluate(async () => {
      const session = {
        project: {
          id: 'seeded',
          name: 'Seeded Session',
          width: 1280,
          height: 720,
          frameRate: 30,
          duration: 0,
          created: 0,
          modified: 0,
          timeline: { clips: [], tracks: [], duration: 0 },
        },
        sourceVideos: [
          {
            id: 'video1',
            name: 'video1.mp4',
            duration: 10,
            width: 1280,
            height: 720,
            frameRate: 30,
            mimeType: 'video/mp4',
            size: 1000,
          },
        ],
        currentTime: 0,
        selectedClipId: null,
        zoom: 1,
        timestamp: Date.now(),
      }
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open database'))
        request.onsuccess = () => {
          const tx = request.result.transaction('settings', 'readwrite')
          tx.objectStore('settings').put(session, 'current-session')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(new Error('Failed to seed session'))
        }
      })
    })
    await page.reload()
    await waitForAppReady(page, 'artist')

    const prompt = page.getByRole('dialog', { name: 'Resume Previous Session?' })
    await expect(prompt).toBeVisible()
    await expect(prompt).toHaveAttribute('aria-modal', 'true')

    expect(await dialogViolations(page)).toHaveLength(0)
  })

  test('keyframe graph passes axe-core audit and is keyboard reachable', async ({ page }) => {
    // The graph only exists inside the keyframe panel, which only draws one for
    // a selected clip — so seed a clip (it is selected on creation), open the
    // panel with `k`, and click the Opacity track to open its curve.
    await seedTextClip(page)
    await page.keyboard.press('k')
    const panel = keyframePanel(page)
    await expect(panel).toBeVisible()
    await panel.getByText('Opacity', { exact: true }).click()

    const graph = page.getByRole('listbox', { name: 'Keyframes for Opacity' })
    await expect(graph).toBeVisible()

    // A text clip has no opacity keyframes, and an empty listbox makes axe
    // report `aria-required-children` as *incomplete* rather than auditing it.
    // Double-clicking the graph adds one at the pointer, and the store adds its
    // own at 0s, so the audited listbox holds two real options.
    await graph.dblclick()
    await expect(graph.getByRole('option')).toHaveCount(2)

    const results = await runAxeCheck(page, {
      includeSelector: '[role="listbox"]',
      // Same carve-out the editor audit above makes: the graph is drawn in SVG
      // over the app's dark chrome and axe cannot compute its contrast.
      disableRules: ['color-contrast'],
    })
    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )
    expect(seriousViolations).toHaveLength(0)
    // An `include` that matched nothing would also report zero violations, so
    // prove the audit actually had the listbox in front of it.
    expect(results.passes).toBeGreaterThan(0)

    // Reachable by Tab from inside the panel — not just focusable by script.
    await panel.getByRole('button', { name: 'Close keyframe panel' }).focus()
    let reached = false
    for (let i = 0; i < 20 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await graph.evaluate((el) => el === document.activeElement)
    }
    expect(reached).toBe(true)

    // ...and once there, the arrows move the active option.
    await expect(graph).not.toHaveAttribute('aria-activedescendant', /.+/)
    await page.keyboard.press('ArrowRight')
    await expect(graph).toHaveAttribute('aria-activedescendant', 'kf-opacity-0')
  })
})

/**
 * ESCSUITE-4: the media library's upload progress bar pulsed forever —
 * `grep -rn "prefers-reduced-motion"` found nothing in the whole repo — and
 * its six ad-hoc font sizes ran as small as 8px (a media-type badge). The
 * fix wraps the pulse in `@media (prefers-reduced-motion: reduce)` and
 * replaces the six sizes with a scale whose floor is 11px.
 */
test.describe('ESCAPEARTIST Media Library Motion and Type Scale', () => {
  /**
   * `.progressFill` only exists in the DOM for the brief window a file is
   * `'processing'` (ESCSUITE-4 review round 1, QUALITY-1: a first version of
   * this test waited up to 3s to catch it live and skipped the whole
   * assertion if it missed — silently passing on a fast machine without
   * checking anything). Reading the compiled CSS-module class name straight
   * out of the loaded stylesheet — it is declared whether or not any element
   * currently carries it — and asserting against a probe element this test
   * creates and owns removes the timing dependency entirely: the probe
   * exists for exactly as long as the assertion needs it to.
   *
   * ESCAPEARTIST has more than one CSS module with a local class literally
   * named `progressFill` — `ExportDialog.module.css`'s has no `animation` at
   * all — so round 2 found matching on the selector text alone picks
   * whichever one `document.styleSheets` happens to list first, not
   * necessarily `VideoUploader.module.css`'s. Requiring the same rule's
   * `animation` declaration to also name the pulse keyframes ties the two
   * together and finds the right one regardless of sheet order.
   *
   * The keyframe name itself is also a CSS-module-scoped identifier (e.g.
   * `_pulse_161md_1`, confirmed by inspecting the dev server's compiled
   * CSS), never the literal `pulse` — callers match `/pulse/i` rather than
   * asserting equality against it.
   */
  async function pulseAnimationName(targetPage: Page): Promise<string> {
    await targetPage.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(targetPage, 'artist')

    const progressFillClass = await targetPage.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        for (const rule of Array.from(rules)) {
          if (!/animation:[^;]*pulse/i.test(rule.cssText)) continue
          const match = rule.cssText.match(/\.([\w-]*progressFill[\w-]*)/)
          if (match) return match[1]
        }
      }
      return null
    })
    if (!progressFillClass) {
      throw new Error(
        'could not find a .progressFill rule whose animation names the pulse keyframes in any stylesheet'
      )
    }

    return targetPage.evaluate((className) => {
      const probe = document.createElement('div')
      probe.className = className
      document.body.appendChild(probe)
      const name = window.getComputedStyle(probe).animationName
      probe.remove()
      return name
    }, progressFillClass)
  }

  test('the upload progress animation turns off under reduced motion and stays on without it (ESCSUITE-4)', async ({
    page,
    browser,
  }) => {
    // `reduce`: the `@media (prefers-reduced-motion: reduce) { .progressFill
    // { animation: none } }` override turns the pulse off entirely.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await pulseAnimationName(page)).toBe('none')

    // `no-preference`, in a separate browser context so this check never
    // shares a page with the `reduce` one above: the pulse is still running
    // (a hashed keyframe name, e.g. `_pulse_161md_1`, hence the pattern
    // rather than an exact match), which is what proves the assertion above
    // is actually exercising the media query rather than a typo
    // (`animation: none` unconditionally, say) that would read "none"
    // either way.
    const context = await browser.newContext({ reducedMotion: 'no-preference' })
    try {
      const otherPage = await context.newPage()
      const name = await pulseAnimationName(otherPage)
      expect(name).not.toBe('none')
      expect(name).toMatch(/pulse/i)
    } finally {
      await context.close()
    }
  })

  test('no library text is smaller than 11px, and the media-type badge stays inside its thumbnail (ESCSUITE-4)', async ({
    page,
    browserName,
  }) => {
    // ESCSUITE-177: this test imports a real file (the inline 1x1 PNG
    // below), which stores its bytes in IndexedDB — and Playwright's WebKit
    // cannot store a Blob there at all on this platform (confirmed with a
    // bare `objectStore.put(blob, key)`, no app code involved —
    // `UnknownError: Error preparing Blob/File data to be stored in object
    // store`).
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    // A 1x1 PNG, inline rather than a fixture file: `processImageFile` needs
    // real, decodable image bytes (`<img>`'s `onload` has to fire), and an
    // image is the cheapest media kind that renders a `.mediaTypeBadge` at
    // all — a plain video gets none (QUALITY-2: the badge/thumbnail
    // containment check below needs one on screen).
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    await page.locator('input[type="file"]').setInputFiles({
      name: 'badge-fixture.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    })

    await expect(page.getByRole('button', { name: 'Add to timeline' })).toBeVisible({
      timeout: 60_000,
    })

    // Every bit of rendered text in the sidebar that holds the uploader and
    // the library — the one panel ESCSUITE-4 found six ad-hoc sizes in.
    const sidebar = page.locator('aside', { has: page.locator('#media-library-title') })
    const fontSizes = await sidebar.locator('*').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.childElementCount === 0 && !!node.textContent?.trim())
        .map((node) => parseFloat(window.getComputedStyle(node).fontSize))
    )
    expect(fontSizes.length).toBeGreaterThan(0)
    for (const size of fontSizes) {
      expect(size).toBeGreaterThanOrEqual(11)
    }

    // QUALITY-2: the badge's font-size grew 8px -> 11px; prove its box still
    // sits inside the 64x36px thumbnail's corner rather than spilling past
    // its left or top edge — which the thumbnail's own `overflow: hidden`
    // would hide visually rather than prevent. `.mediaTypeBadge` is
    // `position: absolute` with only `bottom`/`right` set, so nothing but
    // its own (now smaller) padding keeps it off those two edges.
    const badge = page.locator('[class*="mediaTypeBadge"]').first()
    await expect(badge).toBeVisible()
    const thumbnail = badge.locator('xpath=..')
    const badgeBox = await badge.boundingBox()
    const thumbnailBox = await thumbnail.boundingBox()
    expect(badgeBox).not.toBeNull()
    expect(thumbnailBox).not.toBeNull()
    if (badgeBox && thumbnailBox) {
      expect(badgeBox.x).toBeGreaterThanOrEqual(thumbnailBox.x)
      expect(badgeBox.y).toBeGreaterThanOrEqual(thumbnailBox.y)
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(thumbnailBox.x + thumbnailBox.width)
      expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(thumbnailBox.y + thumbnailBox.height)
    }
  })
})

test.describe('Color Contrast', () => {
  test('ESCAPEPLAN has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    // A page with nothing rendered reports zero contrast violations too —
    // prove the real landing page was there to audit (ESCSUITE-202 K-7).
    await expect(page.locator('h1').first()).toBeVisible()

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  test('ESCAPECRAFT has adequate color contrast', async ({ page }) => {
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // A page with nothing rendered reports zero contrast violations too —
    // prove the real recorder shell was there to audit.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  // Beside the idle-shell check above: the take-in-progress state draws the
  // app's one red text (the "Recording" label and the running timer, see
  // `ESCAPECRAFT Dialog and Recording Accessibility`'s own take-in-progress
  // audits above), which a colour token tuned for the idle shell alone could
  // still fail.
  test('ESCAPECRAFT has adequate color contrast during a live take', async ({ page }) => {
    test.setTimeout(60_000)

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
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)

    await page.getByRole('button', { name: 'Stop recording' }).click()
  })

  test('ESCAPEARTIST has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // A page with nothing rendered reports zero contrast violations too —
    // prove the real editor shell was there to audit (ESCSUITE-202 K-7).
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
      // Exclude timeline canvas
      excludeSelector: 'canvas',
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  /**
   * Every colour-contrast failure axe finds under `include` (the whole page
   * when omitted), one line per node, so a failure names each place and its
   * ratio instead of a count and the first node. The canvas timeline is left
   * out for the same reason as the audit above: axe cannot compute its
   * contrast.
   */
  async function contrastFailures(page: Page, include?: string): Promise<string[]> {
    let builder = new AxeBuilder({ page }).withRules(['color-contrast']).exclude('canvas')
    if (include) builder = builder.include(include)
    const results = await builder.analyze()
    // Prove the rule had text in front of it: zero failures over zero nodes
    // would pass too.
    const checked = [...results.passes, ...results.violations].flatMap((r) => r.nodes).length
    expect(checked, `color-contrast nodes checked under ${include ?? 'the page'}`).toBeGreaterThan(0)
    return results.violations.flatMap((v) =>
      v.nodes.map((n) => {
        const data = n.any[0]?.data as
          | { fgColor?: string; bgColor?: string; contrastRatio?: number }
          | undefined
        const text = n.html.replace(/\s+/g, ' ').slice(0, 80)
        return `${n.target.join(' ')} ${data?.fgColor} on ${data?.bgColor} = ${data?.contrastRatio}:1 ${text}`
      })
    )
  }

  // ESCSUITE-421: a light-theme survey found the light --text-muted (#718096)
  // under 4.5:1 on every surface but white (3.74:1 on --bg-secondary, 3.38:1
  // on --bg-tertiary, 3.10:1 on --bg-hover) and the header Export button's
  // white label at 2.75:1 on its --accent-primary fill. The idle-editor audit
  // above never sees either: Export is only enabled with a clip, most muted
  // text lives in the inspector's selected state and the media library, and
  // that audit runs in the dark theme. This one runs with a real clip
  // imported, selected and showing in the inspector, then over the hovered
  // library row and the export dialog's advanced options. The Export button's
  // hover state is the next test's, in both themes.
  test('ESCAPEARTIST has adequate color contrast in the light theme with a clip selected (ESCSUITE-421)', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000)
    // Same limitation as "the clip inspector's controls have associated
    // labels": the import stores a Blob in IndexedDB.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=light`)
    await waitForAppReady(page, 'artist')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    // Before the import: the empty preview's placeholder sits on a #111 box
    // in both themes, so a darker light --text-muted must not reach it.
    await test.step('the empty editor', async () => {
      await expect(page.getByText('Add clips to the timeline to preview')).toBeVisible()
      await expect(page.getByText('Select a clip to edit')).toBeVisible()
      await waitForAnimationsToFinish(page.locator('#root'))
      expect(await contrastFailures(page), 'light-theme contrast failures, empty editor').toEqual([])
    })

    await test.step('editor with a clip selected', async () => {
      await importMediaAndAddToTimeline(page)
      await openMobileInspector(page)
      await page.locator('[data-clip-id]').first().click()
      // The inspector shows the clip, not its "Select a clip to edit" state.
      await expect(page.getByRole('button', { name: 'Transform', exact: true })).toBeVisible()
      await expect(inspector(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Export video' })).toBeEnabled()
      await page.mouse.move(0, 0)
      await waitForAnimationsToFinish(page.locator('#root'))

      expect(await contrastFailures(page), 'light-theme contrast failures, clip selected').toEqual([])
    })

    await test.step('the hovered media library row', async () => {
      const row = page.locator('[class*="videoItem"]').first()
      await row.hover()
      await waitForAnimationsToFinish(row)
      expect(
        await contrastFailures(page, '[class*="videoItem"]'),
        'light-theme contrast failures, library row hovered'
      ).toEqual([])
    })

    await test.step('the export dialog with advanced options open', async () => {
      await openExportDialog(page)
      await openExportAdvancedOptions(page)
      await page.mouse.move(0, 0)
      await waitForAnimationsToFinish(page.locator('[role="dialog"]').first())
      expect(
        await contrastFailures(page, '[role="dialog"]'),
        'light-theme contrast failures, export dialog'
      ).toEqual([])
    })
  })

  // ESCSUITE-421: the header Export button's label was white on the
  // --accent-primary fill, 2.75:1 in both themes. On hover the more specific
  // .headerButton:hover rule turned it --text-primary, which the dark theme
  // draws at 2.72:1 on the hover fill. Both states, both themes; a text clip is
  // the cheapest way to enable the button.
  for (const theme of ['dark', 'light'] as const) {
    test(`the header Export button's label meets AA, hovered too (${theme} theme, ESCSUITE-421)`, async ({
      page,
    }) => {
      await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as { ESCAPE_THEME?: { getResolvedTheme(): string } }).ESCAPE_THEME?.getResolvedTheme() ??
              null
          )
        )
        .toBe(theme)
      await seedTextClip(page)

      const exportButton = page.getByRole('button', { name: 'Export video' })
      await expect(exportButton).toBeEnabled()
      await page.mouse.move(0, 0)
      await waitForAnimationsToFinish(exportButton)
      expect(
        await contrastFailures(page, 'button[aria-label="Export video"]'),
        `${theme}-theme Export button contrast failures`
      ).toEqual([])

      await exportButton.hover()
      await waitForAnimationsToFinish(exportButton)
      expect(
        await contrastFailures(page, 'button[aria-label="Export video"]'),
        `${theme}-theme Export button contrast failures, hovered`
      ).toEqual([])
    })
  }

  type Rgb = [number, number, number]

  /** WCAG 2 contrast ratio between two opaque colours. */
  function contrast(a: Rgb, b: Rgb): number {
    const lum = ([r, g, b]: Rgb) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }

  /**
   * The colours one control is painted with, read from the computed style:
   * its label ink, its own fill, the edge that outlines it (its border when it
   * has one, else the first box-shadow colour, else its fill) and the surface
   * it sits on (its parent's background, translucent layers composited down to
   * the first opaque one). axe judges text only, so this is how an icon label
   * (WCAG 1.4.11, 3:1) and a pressed state's edge are measured.
   */
  async function paintOf(target: Locator) {
    return target.evaluate((el) => {
      type Rgba = [number, number, number, number]
      const parse = (c: string): Rgba | null => {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return [p[0], p[1], p[2], p[3] ?? 1]
      }
      const over = (top: Rgba, bottom: Rgba): Rgba => [
        ...([0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])) as [number, number, number]),
        1,
      ]
      const backgroundFrom = (start: Element | null): Rgba => {
        const layers: Rgba[] = []
        for (let n = start; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor)
          if (c && c[3] > 0) {
            layers.push(c)
            if (c[3] === 1) break
          }
        }
        return layers.reverse().reduce((acc, layer) => over(layer, acc), [255, 255, 255, 1] as Rgba)
      }
      const rgb = (c: Rgba) => [c[0], c[1], c[2]] as [number, number, number]
      const cs = getComputedStyle(el)
      const fill = backgroundFrom(el)
      const ink = over(parse(cs.color) as Rgba, fill)
      const shadow = parse(cs.boxShadow)
      const edge =
        parseFloat(cs.borderTopWidth) >= 1
          ? over(parse(cs.borderTopColor) as Rgba, fill)
          : shadow
            ? over(shadow, fill)
            : fill
      return { ink: rgb(ink), fill: rgb(fill), edge: rgb(edge), surface: rgb(backgroundFrom(el.parentElement)) }
    })
  }

  // ESCSUITE-422: accent-filled controls drew white labels on --accent-primary
  // (#4a9eff), 2.75:1 in both themes: the preview's play button (an icon, so
  // 3:1 applies, still short) and the inspector's pressed style buttons among
  // them. In the light theme the pressed state's edge and the selected clip's
  // ring were --accent-primary too, 2.1-2.75:1 on the surfaces they sit on,
  // under WCAG 1.4.11's 3:1. Both themes: the dark one must keep passing.
  for (const theme of ['dark', 'light'] as const) {
    test(`accent-filled controls keep their labels and edges readable (${theme} theme, ESCSUITE-422)`, async ({
      page,
    }) => {
      await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as { ESCAPE_THEME?: { getResolvedTheme(): string } }).ESCAPE_THEME?.getResolvedTheme() ??
              null
          )
        )
        .toBe(theme)
      // A text clip: it is selected on creation, enables the play button and
      // opens the inspector's Text Content section with its B / I buttons.
      await seedTextClip(page)

      await test.step('the play button', async () => {
        const play = page.getByRole('button', { name: 'Play (Space)' })
        await expect(play).toBeEnabled()
        await page.mouse.move(0, 0)
        await waitForAnimationsToFinish(play)
        const idle = await paintOf(play)
        expect(contrast(idle.ink, idle.fill), `${theme} play icon on its fill`).toBeGreaterThanOrEqual(3)

        await play.hover()
        await waitForAnimationsToFinish(play)
        const hovered = await paintOf(play)
        expect(contrast(hovered.ink, hovered.fill), `${theme} play icon on its hover fill`).toBeGreaterThanOrEqual(3)
      })

      await test.step('a pressed style button', async () => {
        const bold = page.getByRole('button', { name: 'B', exact: true })
        await bold.click()
        await expect(bold).toHaveAttribute('aria-pressed', 'true')
        await page.mouse.move(0, 0)
        await waitForAnimationsToFinish(bold)

        const pressed = await paintOf(bold)
        expect(contrast(pressed.ink, pressed.fill), `${theme} pressed B label on its fill`).toBeGreaterThanOrEqual(4.5)
        // The pressed state is told apart from the surface by its fill or by
        // its edge; one of them has to reach 3:1.
        expect(
          Math.max(contrast(pressed.edge, pressed.surface), contrast(pressed.fill, pressed.surface)),
          `${theme} pressed B edge or fill on its surface`
        ).toBeGreaterThanOrEqual(3)

        await bold.hover()
        await waitForAnimationsToFinish(bold)
        const hovered = await paintOf(bold)
        expect(contrast(hovered.ink, hovered.fill), `${theme} pressed B label, hovered`).toBeGreaterThanOrEqual(4.5)
      })

      await test.step('the active tool', async () => {
        // A borderless pressed button: its edge is the inset ring.
        const select = page.getByTitle('Selection Tool (V)')
        await expect(select).toHaveClass(/active/)
        await page.mouse.move(0, 0)
        await waitForAnimationsToFinish(select)
        const active = await paintOf(select)
        expect(contrast(active.ink, active.fill), `${theme} active tool icon on its fill`).toBeGreaterThanOrEqual(3)
        expect(
          Math.max(contrast(active.edge, active.surface), contrast(active.fill, active.surface)),
          `${theme} active tool edge or fill on its group`
        ).toBeGreaterThanOrEqual(3)
      })

      await test.step("the selected clip's ring", async () => {
        const clip = page.locator('[data-clip-id]').first()
        await expect(clip).toHaveClass(/clipSelected/)
        await page.mouse.move(0, 0)
        await waitForAnimationsToFinish(clip)
        const selected = await paintOf(clip)
        expect(
          contrast(selected.edge, selected.surface),
          `${theme} selected clip ring on the track`
        ).toBeGreaterThanOrEqual(3)
      })
    })
  }

  /**
   * The colour a range input's thumb is painted with, and the track it runs
   * on. A thumb is a pseudo-element in the browser's own shadow tree, and
   * `getComputedStyle(input, '::-webkit-slider-thumb')` hands back the input's
   * style instead, so this finds the stylesheet rules that style this input's
   * thumb (`::-webkit-slider-thumb` or `::-moz-range-thumb`, whichever the
   * browser kept), and resolves their `background` through a probe element
   * beside the input, so `var(--accent-ring)` takes the live theme's value.
   * The track is the input's own computed background; the surface is what the
   * input sits on.
   */
  async function thumbPaintOf(slider: Locator) {
    return slider.evaluate((el) => {
      type Rgba = [number, number, number, number]
      const parse = (c: string): Rgba | null => {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return [p[0], p[1], p[2], p[3] ?? 1]
      }
      const over = (top: Rgba, bottom: Rgba): Rgba => [
        ...([0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])) as [number, number, number]),
        1,
      ]
      const backgroundFrom = (start: Element | null): Rgba => {
        const layers: Rgba[] = []
        for (let n = start; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor)
          if (c && c[3] > 0) {
            layers.push(c)
            if (c[3] === 1) break
          }
        }
        return layers.reverse().reduce((acc, layer) => over(layer, acc), [255, 255, 255, 1] as Rgba)
      }
      const thumbBackgrounds: string[] = []
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules && !(rule instanceof CSSStyleRule)) {
            visit((rule as CSSGroupingRule).cssRules)
            continue
          }
          if (!(rule instanceof CSSStyleRule)) continue
          for (const selector of rule.selectorText.split(',')) {
            const m = selector.trim().match(/^(.*)::-(?:webkit-slider|moz-range)-thumb$/)
            if (!m) continue
            let matches: boolean
            try {
              matches = el.matches(m[1])
            } catch {
              // A selector this engine cannot parse styles nothing here.
              matches = false
            }
            const value = rule.style.backgroundColor || rule.style.background
            if (matches && value) thumbBackgrounds.push(value)
          }
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visit(sheet.cssRules)
        } catch {
          // A cross-origin sheet: ARTIST loads none of its own.
        }
      }
      const value = thumbBackgrounds.at(-1)
      if (!value) return null
      const probe = document.createElement('span')
      el.parentElement?.appendChild(probe)
      probe.style.backgroundColor = value
      const thumb = parse(getComputedStyle(probe).backgroundColor) as Rgba
      probe.remove()
      const surface = backgroundFrom(el.parentElement)
      const track = backgroundFrom(el)
      const rgb = (c: Rgba) => [c[0], c[1], c[2]] as [number, number, number]
      return { thumb: rgb(over(thumb, track)), track: rgb(track), surface: rgb(surface) }
    })
  }

  // ESCSUITE-423: ESCSUITE-422 left the progress fills and slider thumbs on
  // --accent-primary (#4a9eff), 2.1-2.75:1 in the light theme against the
  // tracks and surfaces they sit on, under WCAG 1.4.11's 3:1 for a graphical
  // object that shows state (how far an export has got, where a slider is).
  // Both themes: the dark one must keep passing.
  for (const theme of ['dark', 'light'] as const) {
    test(`the export progress fill and the inspector's slider thumbs stand out from their tracks (${theme} theme, ESCSUITE-423)`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await page.goto(`${ARTIST_URL}/?suppressRestore=1&theme=${theme}`)
      await waitForAppReady(page, 'artist')
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as { ESCAPE_THEME?: { getResolvedTheme(): string } }).ESCAPE_THEME?.getResolvedTheme() ??
              null
          )
        )
        .toBe(theme)
      await seedTextClip(page)

      await test.step("a Transform slider's thumb", async () => {
        const posX = page.getByLabel('Pos X', { exact: true })
        if (!(await posX.isVisible())) {
          await page.getByRole('button', { name: 'Transform', exact: true }).click()
        }
        await expect(posX).toBeVisible()
        const paint = await thumbPaintOf(posX)
        expect(paint, 'no stylesheet rule paints the Pos X thumb').not.toBeNull()
        const { thumb, track, surface } = paint as NonNullable<typeof paint>
        expect.soft(contrast(thumb, track), `${theme} Pos X thumb on its track`).toBeGreaterThanOrEqual(3)
        expect.soft(contrast(thumb, surface), `${theme} Pos X thumb on the inspector`).toBeGreaterThanOrEqual(3)
      })

      await test.step('the export progress fill', async () => {
        // The same export as screen-reader.spec.ts's "announces export
        // progress": the progress view only exists while an export runs.
        await openExportDialog(page)
        await openExportAdvancedOptions(page)
        await page.getByRole('radio', { name: /MP4/ }).check()
        await page.getByRole('button', { name: 'Download MP4' }).first().click()

        const bar = page.getByRole('dialog').getByRole('progressbar', { name: 'Export progress' })
        await expect(bar).toBeVisible({ timeout: 30_000 })
        const fill = bar.locator('> div').first()
        const paint = await paintOf(fill)
        // paintOf's `fill` is the fill composited over the bar; its `surface`
        // is the bar's own track colour.
        expect.soft(contrast(paint.fill, paint.surface), `${theme} export progress fill on its track`).toBeGreaterThanOrEqual(
          3
        )
      })
    })
  }
})
