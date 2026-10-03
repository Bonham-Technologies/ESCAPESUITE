import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPECRAFT Recording Interface', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('server responds', async ({ page }) => {
    // The recorder itself is what "responds" — a doctype/`<div id="root">`
    // check survives any amount of React failure (ESCSUITE-201 K-3), so
    // assert the control every other test in this describe depends on.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('page has title', async ({ page }) => {
    await expect(page).toHaveTitle(/ESCAPECRAFT/)
  })

  test('has source selection options', async ({ page }) => {
    // The real source-selection UI is the Screen toggle (`SourceToggles.tsx`)
    // — always rendered, never hidden until needed.
    await expect(page.getByRole('button', { name: 'Screen' })).toBeVisible()
  })

  test('shows webcam toggle option', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Webcam' })).toBeVisible()
  })

  test('shows microphone toggle option', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeVisible()
  })
})

test.describe('ESCAPECRAFT Recording Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('has recording settings area', async ({ page }) => {
    // The "Sources" panel is the recorder's configuration area — always
    // rendered as a heading, not a modal or a collapsed drawer.
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
  })

  test('webcam position options exist', async ({ page }) => {
    // The position grid only draws once the webcam is on
    // (`WebcamOverlaySettings.tsx`), so turn it on first.
    await page.getByRole('button', { name: 'Webcam' }).click()

    const positionGroup = page.getByRole('group', { name: 'Webcam position' })
    await expect(positionGroup).toBeVisible()
    await expect(positionGroup.getByRole('button')).toHaveCount(4)
  })

  // ESCSUITE-201: there is no settings control for the countdown's duration
  // anywhere in ESCAPECRAFT — `countdownSeconds` is a fixed default (3s),
  // never exposed as a UI option — so a test asserting one "exists" has no
  // real feature to find. Deleted rather than kept as a placeholder; the
  // countdown's real, user-visible half (the 3-2-1 overlay during an actual
  // countdown) is covered by `escapecraft/components.spec.ts`'s "countdown
  // display appears".
})

test.describe('ESCAPECRAFT Recording List', () => {
  test.beforeEach(async ({ page }) => {
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows recordings list section', async ({ page }) => {
    // The library panel is always mounted — `RecordingsList.tsx` renders its
    // "Recordings" heading and an explicit empty state rather than hiding
    // itself when there is nothing saved yet.
    await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible()
    await expect(page.getByText('No recordings yet')).toBeVisible()
  })

  test('has send to editor option when recordings exist', async ({ page, browserName }) => {
    test.setTimeout(120_000)
    // ESCSUITE-177: WebKit cannot store a Blob in IndexedDB in Playwright
    // (`UnknownError: Error preparing Blob/File data to be stored in object
    // store`), and this test needs the take saved before there is a row to
    // find the editor link on.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    // Capability detection is async; Start acquires no stream if clicked
    // before it finishes.
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    // The test's own name says "when recordings exist" — so make one exist.
    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()

    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })
  })
})

test.describe('ESCAPECRAFT User Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('has header or navigation', async ({ page }) => {
    // `AppHeader.tsx` always renders a real `<header>`.
    await expect(page.locator('header')).toBeVisible()
  })

  test('has no account controls', async ({ page }) => {
    // The recorder is account-free: nothing to sign into, nothing to sign out of
    const accountUI = page
      .getByRole('button', { name: /sign in|sign out|profile|account/i })
      .or(page.locator('[data-testid="user-button"]'))

    expect(await accountUI.count()).toBe(0)
  })
})
