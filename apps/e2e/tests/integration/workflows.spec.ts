import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import {
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
  importMediaAndAddToTimeline,
  ARTIST_FIXTURE_MP4,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('Record in CRAFT, Edit in ARTIST', () => {
  // The real "recorded take becomes an ARTIST import" journey needs CRAFT and
  // ARTIST to share one IndexedDB, which only happens on the combined
  // production layout (the dev servers here put them on :5174 and :5175 —
  // two origins). That workflow is proven, un-skipped, by
  // tests/production/indexeddb-sharing.spec.ts's "a recording made in CRAFT
  // opens in ARTIST" (`pnpm test:e2e:production`).

  test('multiple recordings can be made', async ({ page }) => {
    test.setTimeout(60_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // Capability detection is async; the source toggles stay disabled until it
    // finishes and starting before then acquires no stream.
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
        timeout: 30_000,
      })
      await page.waitForTimeout(1500) // a take's length, not an arbitrary pause
      await page.getByRole('button', { name: 'Stop recording' }).click()

      // Each save finishing (and the row's "Play" button appearing) is what
      // makes the controls ready for the next recording, so this also gates
      // the loop's next iteration.
      await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(i + 1, {
        timeout: 30_000,
      })
    }
  })
})

test.describe('Export After Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('can access export from editor', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: 'Export video' })
    // Disabled while the timeline is empty — there is nothing to encode yet.
    await expect(exportButton).toBeDisabled()

    await seedTextClip(page)
    await expect(exportButton).toBeEnabled()
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
  // ESCSUITE-260: "Save Project" downloads a v2 `.veditor` container
  // (core/projectFileFormat.ts), not JSON, and the uploader opens it again.
  // The reopen is in a fresh browser context, whose IndexedDB is empty, so the
  // load cannot take the "row already present" path: it has to slice the
  // source out of the file and write it (`storeVideo`), quota check included.
  test('a saved project is a v2 container and reopens through the uploader', async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.veditor$/)
    const savedPath = await download.path()
    expect(savedPath).toBeTruthy()
    const bytes = await readFile(savedPath!)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])

    // Open the file the way a user drops one in, in a context with no stored media.
    const context = await browser.newContext()
    const fresh = await context.newPage()
    await fresh.goto('http://localhost:5175')
    await waitForAppReady(fresh, 'artist')
    await fresh
      .locator('input[type="file"]')
      .setInputFiles({ name: 'reopened.veditor', mimeType: 'application/octet-stream', buffer: bytes })

    await expect(fresh.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })
    await expect(fresh.getByText(/^1 clip · 1 track$/)).toBeVisible()
    // The source's tile is in the media library...
    await expect(fresh.getByTitle('source.mp4', { exact: true })).toBeVisible()
    // ...and its bytes were written to this context's storage, whole.
    const storedSizes = await fresh.evaluate(
      () =>
        new Promise<number[]>((resolve, reject) => {
          const request = indexedDB.open('video-editor-db')
          request.onerror = () => reject(new Error('open failed'))
          request.onsuccess = () => {
            const db = request.result
            const all = db.transaction('videos', 'readonly').objectStore('videos').getAll()
            all.onerror = () => reject(new Error('read failed'))
            all.onsuccess = () => {
              resolve((all.result as Array<{ blob: Blob }>).map((record) => record.blob.size))
              db.close()
            }
          }
        })
    )
    const fixtureSize = (await readFile(ARTIST_FIXTURE_MP4)).length
    expect(storedSizes).toEqual([fixtureSize])

    await context.close()
  })

  // "project persists across page reload" used to write a hand-rolled record
  // straight into IndexedDB (never read by the app) and then check for
  // `<div id="root">` after a reload — it asserted nothing the app actually
  // does. The real persistence mechanism — a session written to the
  // `settings` store and offered back as "Resume Previous Session?" on the
  // next load — is pinned by
  // tests/escapeartist/components.spec.ts's "Project Session" describe,
  // `'session restore prompt appears when applicable'`.
})

test.describe('Cross-Session State Persistence', () => {
  // "settings persist across sessions" used to round-trip a fabricated
  // `escapesuite-settings` localStorage key that no app code reads or
  // writes — it tested that `localStorage` itself persists within a browser
  // context, a standard browser API, not this app. Deleted rather than kept
  // as a placeholder.

  test('undo history clears when starting a new project', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    const undoButton = page.getByRole('button', { name: 'Undo (Ctrl+Z)' })
    await expect(undoButton).toBeDisabled()

    await seedTextClip(page)
    await expect(undoButton).toBeEnabled()

    // New Project confirms before discarding unsaved clips.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByRole('menuitem', { name: /New Project/ }).click()

    await expect(undoButton).toBeDisabled()
  })
})

test.describe('App-to-App Navigation', () => {
  test('each app renders its own identity at its own URL', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/how-to videos/i)

    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
    await expect(page.getByRole('heading', { level: 1, name: 'ESCAPECRAFT' })).toBeVisible()

    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    await expect(page.getByRole('heading', { level: 1, name: 'ESCAPEARTIST' })).toBeVisible()

    await context.close()
  })
})

test.describe('URL Parameter Handling', () => {
  test('an unresolvable loadVideo id reports "Recording not found"', async ({ page }) => {
    await page.goto('http://localhost:5175?loadVideo=test-123')
    await waitForAppReady(page, 'artist')

    // app/useHostIntegration.ts: a `loadVideo` id IndexedDB does not have
    // raises the app's one notice, rather than failing silently.
    await expect(page.getByRole('status')).toContainText('Recording not found')
  })

  // "project parameter handled" used to assert only `<div id="root">` after
  // navigating with `?project=<base64>`. The root CLAUDE.md says why that is
  // all it could ever assert: `?project=` is "documented but not currently
  // implemented" — `utils/integration.ts` parses it into `UrlParams.projectData`
  // and nothing reads that field, so there is no app behaviour beyond "did
  // not crash", which every other test's `waitForAppReady` already covers.
  // Deleted rather than kept as a placeholder for a feature that isn't there.

  test('a cross-origin video URL is refused and reported', async ({ page }) => {
    // Routed rather than a real fetch to example.com: the CORS/opaque-response
    // failure this reproduces is deterministic and needs no network access.
    await page.route('https://example.com/test.mp4', (route) => route.abort('failed'))

    await page.goto('http://localhost:5175?video=https://example.com/test.mp4')
    await waitForAppReady(page, 'artist')

    // utils/integration.ts's describeFetchFailure (ESCSUITE-130): a rejected
    // fetch to a different origin names that origin and the likely CSP cause.
    await expect(page.getByRole('status')).toContainText(
      /Could not load the video from https:\/\/example\.com/
    )
  })
})
