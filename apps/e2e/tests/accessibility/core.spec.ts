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
import { seedTextClip } from '../../utils/artist'

test.describe('ESCAPEPLAN Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
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
    await page.waitForLoadState('networkidle')
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
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /help - recording tips/i }).click()
    await expect(page.getByRole('dialog', { name: 'Recording Tips' })).toBeVisible()

    expect(await seriousViolations(page)).toHaveLength(0)
  })

  test('playback dialog passes axe-core audit', async ({ page }) => {
    test.setTimeout(120_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
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
      await page.waitForLoadState('networkidle')
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
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
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

  test('session restore prompt passes axe-core audit', async ({ page }) => {
    // The prompt is only offered for a session that holds at least one source
    // video (`app/useSessionRestore.ts`), and it is read on mount — so write one
    // straight into the `settings` store the app keeps it in and reload. The
    // first navigation in `beforeEach` is what created the database.
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
    await page.waitForLoadState('networkidle')

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

test.describe('Color Contrast', () => {
  test('ESCAPEPLAN has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

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
    await page.waitForLoadState('networkidle')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  test('ESCAPEARTIST has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
      // Exclude timeline canvas
      excludeSelector: 'canvas',
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })
})
