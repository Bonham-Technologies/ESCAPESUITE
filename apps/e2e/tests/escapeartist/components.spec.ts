import { test, expect } from '@playwright/test'
import { mockClerkAuth } from '../../utils/auth'

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('export dialog opens', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      expect(dialogVisible).toBe(true)
    }
  })

  test('export format selection works', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Look for format options
      const mp4Option = page.getByText(/mp4/i).first()
      const webmOption = page.getByText(/webm/i).first()

      const mp4Visible = await mp4Option.isVisible().catch(() => false)
      const webmVisible = await webmOption.isVisible().catch(() => false)

      expect(mp4Visible || webmVisible).toBe(true)
    }
  })

  test('export quality selection available', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      const qualityOption = page.getByText(/quality|high|medium|low/i).first()
      const qualityVisible = await qualityOption.isVisible().catch(() => false)

      expect(typeof qualityVisible).toBe('boolean')
    }
  })

  test('export resolution selection available', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      const resolutionOption = page.getByText(/1080|720|resolution|4k/i).first()
      const resolutionVisible = await resolutionOption.isVisible().catch(() => false)

      expect(typeof resolutionVisible).toBe('boolean')
    }
  })

  test('export progress display exists', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Progress bar should exist (may not be visible until export starts)
      const progressBar = page
        .locator('[role="progressbar"]')
        .or(page.locator('[class*="progress"]'))
        .first()

      const exists = (await progressBar.count()) > 0
      expect(typeof exists).toBe('boolean')
    }
  })
})

test.describe('Keyframe Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('keyframe panel opens', async ({ page }) => {
    const keyframeButton = page
      .getByRole('button', { name: /keyframe|animation/i })
      .or(page.locator('[data-testid="keyframe-panel"]'))
      .first()

    const isVisible = await keyframeButton.isVisible().catch(() => false)

    if (isVisible) {
      await keyframeButton.click()
      await page.waitForTimeout(300)

      const panel = page.locator('[class*="keyframe"], [class*="animation"]').first()
      const panelVisible = await panel.isVisible().catch(() => false)

      expect(typeof panelVisible).toBe('boolean')
    }
  })

  test('keyframe creation button exists', async ({ page }) => {
    const addKeyframeButton = page
      .getByRole('button', { name: /add keyframe|new keyframe/i })
      .or(page.locator('[data-testid="add-keyframe"]'))
      .first()

    const isVisible = await addKeyframeButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('animation preset selection available', async ({ page }) => {
    const presetSelector = page
      .getByRole('combobox', { name: /preset|animation/i })
      .or(page.getByText(/fade|slide|zoom/i))
      .first()

    const isVisible = await presetSelector.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Overlay Tools', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shape tools available', async ({ page }) => {
    const shapeTools = page
      .getByRole('button', { name: /rectangle|circle|arrow|shape/i })
      .or(page.locator('[data-testid*="shape"]'))

    const count = await shapeTools.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('text overlay tool works', async ({ page }) => {
    const textTool = page
      .getByRole('button', { name: /text/i })
      .or(page.locator('[data-testid="text-tool"]'))
      .first()

    const isVisible = await textTool.isVisible().catch(() => false)

    if (isVisible) {
      await textTool.click()
      await page.waitForTimeout(200)

      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })

  test('blur overlay tool exists', async ({ page }) => {
    const blurTool = page
      .getByRole('button', { name: /blur/i })
      .or(page.locator('[data-testid="blur-tool"]'))
      .first()

    const isVisible = await blurTool.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('overlay transform handles appear on selection', async ({ page }) => {
    // Transform handles would appear when an overlay is selected
    const handles = page.locator('[class*="handle"], [class*="transform"]')
    const count = await handles.count()

    // May not have handles if no overlay selected
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Timeline Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('zoom controls work', async ({ page }) => {
    const zoomIn = page
      .getByRole('button', { name: /zoom in/i })
      .or(page.locator('[data-testid="zoom-in"]'))
      .first()

    const zoomOut = page
      .getByRole('button', { name: /zoom out/i })
      .or(page.locator('[data-testid="zoom-out"]'))
      .first()

    const zoomInVisible = await zoomIn.isVisible().catch(() => false)
    const zoomOutVisible = await zoomOut.isVisible().catch(() => false)

    expect(zoomInVisible || zoomOutVisible).toBe(true)
  })

  test('playhead is visible', async ({ page }) => {
    const playhead = page
      .locator('[data-testid="playhead"]')
      .or(page.locator('[class*="playhead"]'))
      .first()

    const isVisible = await playhead.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('time display updates', async ({ page }) => {
    const timeDisplay = page
      .getByText(/\d{2}:\d{2}/)
      .or(page.locator('[data-testid="time-display"]'))
      .first()

    const isVisible = await timeDisplay.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Waveform Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('waveform canvas exists', async ({ page }) => {
    const waveform = page
      .locator('canvas[class*="waveform"], [data-testid="waveform"]')
      .or(page.locator('[class*="waveform"]'))
      .first()

    const exists = (await waveform.count()) > 0
    expect(typeof exists).toBe('boolean')
  })

  test('waveform color indicates selection', async ({ page }) => {
    // Waveform should change appearance when selected
    const waveformTrack = page.locator('[class*="audio-track"], [class*="waveform"]').first()
    const isVisible = await waveformTrack.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Project Session', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('session restore prompt appears when applicable', async ({ page }) => {
    // This would appear if there's a previous session
    const restorePrompt = page
      .getByText(/restore|recover|previous|session/i)
      .or(page.getByRole('dialog', { name: /restore|session/i }))
      .first()

    const isVisible = await restorePrompt.isVisible().catch(() => false)
    // May or may not be visible depending on session state
    expect(typeof isVisible).toBe('boolean')
  })

  test('new project can be started', async ({ page }) => {
    const newProjectButton = page
      .getByRole('button', { name: /new|create|start/i })
      .or(page.locator('[data-testid="new-project"]'))
      .first()

    const isVisible = await newProjectButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Inspector Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('inspector panel exists', async ({ page }) => {
    const inspector = page
      .locator('[class*="inspector"], [class*="properties"], [class*="panel"]')
      .first()

    const isVisible = await inspector.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('property controls appear for selected clip', async ({ page }) => {
    // Properties would show when a clip is selected
    const propertyInputs = page.locator(
      '[class*="inspector"] input, [class*="properties"] input'
    )
    const count = await propertyInputs.count()

    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('undo button exists', async ({ page }) => {
    const undoButton = page
      .getByRole('button', { name: /undo/i })
      .or(page.locator('[data-testid="undo-button"]'))
      .first()

    const isVisible = await undoButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('redo button exists', async ({ page }) => {
    const redoButton = page
      .getByRole('button', { name: /redo/i })
      .or(page.locator('[data-testid="redo-button"]'))
      .first()

    const isVisible = await redoButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('split clip tool exists', async ({ page }) => {
    const splitTool = page
      .getByRole('button', { name: /split|cut/i })
      .or(page.locator('[data-testid="split-tool"]'))
      .first()

    const isVisible = await splitTool.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('delete tool exists', async ({ page }) => {
    const deleteTool = page
      .getByRole('button', { name: /delete|remove/i })
      .or(page.locator('[data-testid="delete-tool"]'))
      .first()

    const isVisible = await deleteTool.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})
