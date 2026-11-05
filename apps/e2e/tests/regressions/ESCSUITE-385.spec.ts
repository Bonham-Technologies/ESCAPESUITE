import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, makeToneWav, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-385: one MP4 or WebM export takes at most three hours
 * (ESCSUITE-367), and a longer timeline disabled both downloads with the
 * reason only in a `title` tooltip, which keyboard and touch users never see.
 * The reason told them to "set in and out points" without saying how. The
 * dialog now says it in visible text that names the I and O keys, and each
 * download it disables points at that text with `aria-describedby`.
 *
 * The timeline is over three hours long without three hours of media: a 2 s
 * tone at 0 s and the same tone at 10,800 s. A synthesised WAV decodes in
 * every browser, and nothing is exported, so this runs everywhere.
 */

const TONE_SECONDS = 2
const LATE_TONE_AT = 3 * 60 * 60
const TOO_LONG = 'Cannot export more than 3 hours at once: set in and out points and export it in sections'
const KEYS = /press I\b.*\bO\b/i

function longProjectFile(wav: Buffer, editor: { inPoint: number | null; outPoint: number | null }): Buffer {
  const clip = (id: string, timelinePosition: number) => ({
    id,
    sourceVideoId: 'tone',
    name: 'tone.wav',
    startTime: 0,
    endTime: TONE_SECONDS,
    duration: TONE_SECONDS,
    trackId: 'track1',
    timelinePosition,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
  })
  return Buffer.from(
    JSON.stringify({
      version: 1,
      project: {
        id: 'too-long-project',
        name: 'Over three hours',
        created: 1700000000000,
        modified: 1700000000000,
        resolution: { width: 640, height: 360 },
        timeline: {
          tracks: [
            { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [clip('early', 0), clip('late', LATE_TONE_AT)],
          textOverlays: [],
          shapeOverlays: [],
          duration: LATE_TONE_AT + TONE_SECONDS,
        },
      },
      editor: { ...editor, markers: [] },
      videos: [{ id: 'tone', name: 'tone.wav', mimeType: 'audio/wav', data: wav.toString('base64') }],
    })
  )
}

async function loadLongProject(page: Page, editor: { inPoint: number | null; outPoint: number | null }) {
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'over-three-hours.veditor',
    mimeType: 'application/json',
    buffer: longProjectFile(makeToneWav(TONE_SECONDS), editor),
  })
  // Durable state, not the transient "Project loaded" toast, which a slow load can miss.
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Over three hours', { timeout: 30_000 })
  await expect(page.getByText('2 clips · 1 track')).toBeVisible({ timeout: 30_000 })
}

/** The disabled button points, with `aria-describedby`, at visible text giving the reason and the keys. */
async function expectVisibleReason(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeDisabled()
  const ids = (await button.getAttribute('aria-describedby'))?.split(/\s+/).filter(Boolean) ?? []
  expect(ids, 'the disabled button is not tied to a visible reason').not.toHaveLength(0)
  for (const id of ids) await expect(page.locator(`[id="${id}"]`)).toBeVisible()
  // `title` alone also makes a description, so ask for what only the visible
  // notice says: the keys.
  await expect(button).toHaveAccessibleDescription(KEYS)
}

test.describe('ESCSUITE-385: a timeline over three hours says why export is off, and how to set a section', () => {
  // Loading the project decodes its media; on a busy runner that alone can take most of the default 30 s.
  test.describe.configure({ timeout: 90_000 })

  test('both downloads point at visible text naming the I and O keys', async ({ page }) => {
    await loadLongProject(page, { inPoint: null, outPoint: null })
    await openExportDialog(page)

    const notice = page.getByText(TOO_LONG)
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(KEYS)

    await expectVisibleReason(page, page.getByRole('button', { name: 'Download WebM' }))
    await openExportAdvancedOptions(page)
    await expectVisibleReason(page, page.getByRole('button', { name: /^Download (WebM|MP4|GIF)$/ }).last())
  })

  test('with a section set, only the full-video export is off, and it says why', async ({ page }) => {
    await loadLongProject(page, { inPoint: 0, outPoint: TONE_SECONDS })
    await openExportDialog(page)

    await expect(page.getByText(TOO_LONG)).toBeVisible()
    await expectVisibleReason(page, page.getByRole('button', { name: 'Export Full Video' }))
    await expect(page.getByRole('button', { name: /^Export Section/ })).not.toHaveAttribute('aria-describedby', /.+/)
  })
})
