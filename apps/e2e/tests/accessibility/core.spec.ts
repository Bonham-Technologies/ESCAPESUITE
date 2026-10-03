import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import {
  runAxeCheck,
  checkImageAltText,
  checkHeadingHierarchy,
  checkFormLabels,
  checkLinkText,
} from '../../utils/accessibility'
import { ARTIST_URL, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * The same one-second fixture the integration and perf suites import — the
 * cheapest way to get a *media* clip onto the timeline, which is the only clip
 * kind whose inspector shows Blend Mode, Mask & Stroke, Effects and Transition.
 */
const ARTIST_FIXTURE_MP4 = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/headless/source.mp4'
)

test.describe('ESCAPEPLAN Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
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

test.describe('ESCAPECRAFT Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('recording UI passes axe-core audit', async ({ page }) => {
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
    const { valid } = await checkHeadingHierarchy(page)
    expect(valid).toBe(true)
  })

  test('toggle controls have proper state', async ({ page }) => {
    // Check that toggle buttons have aria-pressed or aria-checked
    const toggles = page.locator('[role="switch"], [aria-pressed], [aria-checked]')
    const count = await toggles.count()

    // Should have some toggles (webcam, mic, etc.)
    expect(count).toBeGreaterThanOrEqual(0)

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
    // asynchronous getSessionState() has decided whether to raise the
    // "Resume Previous Session?" prompt — exactly the hazard
    // `?suppressRestore=1` exists to rule out below, in the one test in
    // this file ("the clip inspector's controls have associated labels")
    // that already uses it for the same reason.
    await page.goto('http://localhost:5175?suppressRestore=1')
    await waitForAppReady(page, 'artist')
  })

  test('editor UI passes axe-core audit', async ({ page }) => {
    const results = await runAxeCheck(page, {
      // Disable color-contrast for canvas-based timeline
      disableRules: ['color-contrast'],
    })

    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('toolbar buttons have accessible names', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"], .toolbar, [class*="toolbar"]').first()
    const isVisible = await toolbar.isVisible().catch(() => false)

    if (isVisible) {
      const buttons = toolbar.getByRole('button')
      const count = await buttons.count()

      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        const name = await button.getAttribute('aria-label')
        const text = await button.textContent()
        const title = await button.getAttribute('title')

        const hasAccessibleName = !!(name || text?.trim() || title)
        expect(hasAccessibleName).toBe(true)
      }
    }
  })

  test('editor has valid heading hierarchy', async ({ page }) => {
    const { valid } = await checkHeadingHierarchy(page)
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
    const { unlabeled } = await checkFormLabels(page)
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
    const panel = page.locator('body > div:not(#root)').filter({ hasText: 'Keyframe Editor' })
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
    // The panel is a portal on document.body, so it is a sibling of #root —
    // which has a "Keyframe Editor" button of its own, hence the :not().
    const panel = page.locator('body > div:not(#root)').filter({ hasText: 'Keyframe Editor' })
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
    await panel.getByRole('button', { name: '×' }).first().focus()
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

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  test('ESCAPEARTIST has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
      // Exclude timeline canvas
      excludeSelector: 'canvas',
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })
})
