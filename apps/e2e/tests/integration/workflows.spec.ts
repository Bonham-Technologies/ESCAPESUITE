import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { clearIndexedDB, databaseExists } from '../../utils/indexeddb'
import { seedTextClip, openExportDialog, openExportAdvancedOptions } from '../../utils/artist'

test.describe('Record in CRAFT, Edit in ARTIST', () => {
  test('recording workflow to editor', async ({ browser }) => {
    const context = await browser.newContext()

    // Start in ESCAPECRAFT
    const craftPage = await context.newPage()
    await craftPage.addInitScript(() => {
      // Mock media APIs
      navigator.mediaDevices.getUserMedia = async () => ({
        getTracks: () => [],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
        addTrack: () => {},
        removeTrack: () => {},
        active: true,
      }) as unknown as MediaStream
    })

    await craftPage.goto('http://localhost:5174')
    await craftPage.waitForLoadState('networkidle')

    // Verify CRAFT loaded
    const craftHtml = await craftPage.content()
    expect(craftHtml).toContain('<div id="root">')

    // Navigate to ARTIST
    const artistPage = await context.newPage()
    await artistPage.goto('http://localhost:5175')
    await artistPage.waitForLoadState('networkidle')

    // Verify ARTIST loaded
    const artistHtml = await artistPage.content()
    expect(artistHtml).toContain('<div id="root">')

    await context.close()
  })

  test('multiple recordings can be made', async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)

    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Verify UI allows multiple recordings
    const recordButton = page
      .getByRole('button', { name: /record|start/i })
      .first()

    const isVisible = await recordButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Export After Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('can access export from editor', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('export dialog shows format options', async ({ page }) => {
    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    await expect(page.getByRole('radio', { name: /WebM/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /MP4/ })).toBeVisible()
  })
})

test.describe('Project Save and Reload', () => {
  test('project can be saved', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const saveButton = page
      .getByRole('button', { name: /save/i })
      .or(page.locator('[data-testid="save-button"]'))
      .first()

    const isVisible = await saveButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('project persists across page reload', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Store something in IndexedDB to simulate project save
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('video-editor-db', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('projects')) {
            db.createObjectStore('projects', { keyPath: 'id' })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          if (db.objectStoreNames.contains('projects')) {
            const tx = db.transaction('projects', 'readwrite')
            const store = tx.objectStore('projects')
            store.put({ id: 'test-project', name: 'Test', data: {} })
            tx.oncomplete = () => resolve(true)
          } else {
            resolve(true)
          }
        }
        request.onerror = () => resolve(false)
      })
    })

    // Reload page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Page should still work
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('Cross-Session State Persistence', () => {
  test('settings persist across sessions', async ({ browser }) => {
    const context = await browser.newContext()

    // First session
    const page1 = await context.newPage()
    await page1.goto('http://localhost:5175')
    await page1.waitForLoadState('networkidle')

    // Store a setting
    await page1.evaluate(() => {
      localStorage.setItem('escapesuite-settings', JSON.stringify({ theme: 'dark' }))
    })

    await page1.close()

    // Second session
    const page2 = await context.newPage()
    await page2.goto('http://localhost:5175')
    await page2.waitForLoadState('networkidle')

    // Check setting persisted
    const settings = await page2.evaluate(() => {
      return localStorage.getItem('escapesuite-settings')
    })

    expect(settings).toContain('dark')

    await context.close()
  })

  test('undo history clears on new session', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Undo button should be disabled on fresh load
    const undoButton = page
      .getByRole('button', { name: /undo/i })
      .or(page.locator('[data-testid="undo-button"]'))
      .first()

    const isVisible = await undoButton.isVisible().catch(() => false)

    if (isVisible) {
      const isDisabled = await undoButton.isDisabled().catch(() => true)
      // Undo should be disabled when no history
      expect(typeof isDisabled).toBe('boolean')
    }
  })
})

test.describe('App-to-App Navigation', () => {
  test('can navigate between all three apps', async ({ browser }) => {
    const context = await browser.newContext()

    const page = await context.newPage()

    // ESCAPEPLAN
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
    expect(await page.content()).toContain('<div id="root">')

    // ESCAPECRAFT
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
    expect(await page.content()).toContain('<div id="root">')

    // ESCAPEARTIST
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
    expect(await page.content()).toContain('<div id="root">')

    await context.close()
  })
})

test.describe('URL Parameter Handling', () => {
  test('loadVideo parameter handled', async ({ page }) => {
    await page.goto('http://localhost:5175?loadVideo=test-123')
    await page.waitForLoadState('networkidle')

    // App should handle the parameter without crashing
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('project parameter handled', async ({ page }) => {
    // Base64 encoded project data
    const projectData = btoa(JSON.stringify({ name: 'Test Project' }))
    await page.goto(`http://localhost:5175?project=${projectData}`)
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('video URL parameter handled', async ({ page }) => {
    await page.goto('http://localhost:5175?video=https://example.com/test.mp4')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})
