import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, makeToneWav, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-472: the timeline's markers can be copied, or saved as a .txt, as a
 * YouTube chapter list from the export dialog: one `M:SS Title` line per
 * marker, times from the start of the exported range, an "Intro" at 0:00 when
 * the first marker is later, "Chapter N" for an unlabelled one. With in and
 * out points set the list is timed from the section (markers outside it
 * dropped) unless "Full video" is picked, matching the two export buttons.
 * The row is left out when there is no marker. A list YouTube would not accept (fewer
 * than three chapters, one under ten seconds) shows a warning naming the rule.
 *
 * A 120 s tone is the timeline; nothing is exported, so this runs everywhere.
 * The clipboard is stubbed on the prototype (Firefox and WebKit cannot be
 * granted clipboard permission).
 */

const TONE_SECONDS = 120

type Range = { inPoint: number; outPoint: number }

function projectFile(markerTimes: Array<[number, string]>, range?: Range): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      project: {
        id: 'chapters-project',
        name: 'Chapters',
        created: 1700000000000,
        modified: 1700000000000,
        resolution: { width: 640, height: 360 },
        timeline: {
          tracks: [
            { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [
            {
              id: 'tone-clip',
              sourceVideoId: 'tone',
              name: 'tone.wav',
              startTime: 0,
              endTime: TONE_SECONDS,
              duration: TONE_SECONDS,
              trackId: 'track1',
              timelinePosition: 0,
              blendMode: 'normal',
              transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
              effects: { blur: 0 },
              transition: { type: 'none', duration: 0.5 },
            },
          ],
          textOverlays: [],
          shapeOverlays: [],
          duration: TONE_SECONDS,
        },
      },
      editor: {
        inPoint: range?.inPoint ?? null,
        outPoint: range?.outPoint ?? null,
        markers: markerTimes.map(([time, label], i) => ({ id: `m${i}`, time, label, color: '#ffcc00' })),
      },
      videos: [{ id: 'tone', name: 'tone.wav', mimeType: 'audio/wav', data: makeToneWav(TONE_SECONDS).toString('base64') }],
    })
  )
}

async function loadProject(page: Page, markerTimes: Array<[number, string]>, range?: Range) {
  await page.addInitScript(() => {
    ;(window as unknown as { __copied: string | null }).__copied = null
    Clipboard.prototype.writeText = async (text: string) => {
      ;(window as unknown as { __copied: string | null }).__copied = text
    }
  })
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'chapters.veditor',
    mimeType: 'application/json',
    buffer: projectFile(markerTimes, range),
  })
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Chapters', { timeout: 30_000 })
  await expect(page.getByText('1 clip · 1 track')).toBeVisible({ timeout: 30_000 })
}

const EXPECTED = '0:00 Intro\n0:15 Setup\n0:40 Chapter 2\n1:30 Wrap up'

test.describe('ESCSUITE-472: markers as YouTube chapters in the export dialog', () => {
  test.describe.configure({ timeout: 90_000 })

  test('Copy chapters puts the YouTube list on the clipboard, and the .txt holds the same', async ({ page }) => {
    await loadProject(page, [[15, 'Setup'], [40, ''], [90, 'Wrap up']])
    await openExportDialog(page)

    const row = page.getByRole('group', { name: 'Chapters' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0)

    await row.getByRole('button', { name: 'Copy chapters' }).click()
    await expect(row.getByRole('status')).toHaveText('Chapters copied')
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(EXPECTED)

    const downloading = page.waitForEvent('download')
    await row.getByRole('button', { name: 'Download chapters .txt' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('Chapters-chapters.txt')
    const stream = await download.createReadStream()
    let saved = ''
    for await (const chunk of stream) saved += chunk.toString()
    expect(saved.trim()).toBe(EXPECTED)
  })

  test('a list YouTube would not accept shows a warning naming the rule, and still copies', async ({ page }) => {
    await loadProject(page, [[5, 'Setup']])
    await openExportDialog(page)

    const row = page.getByRole('group', { name: 'Chapters' })
    await expect(row.getByRole('status').filter({ hasText: /at least 3 chapters/ })).toBeVisible()
    await expect(row.getByRole('status').filter({ hasText: /at least 10 seconds/ })).toBeVisible()
    await row.getByRole('button', { name: 'Copy chapters' }).click()
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(
      '0:00 Intro\n0:05 Setup'
    )
  })

  test('with in and out points the list follows the section, or the full video when picked', async ({ page }) => {
    await loadProject(page, [[5, 'Before'], [40, 'In A'], [70, 'In B'], [110, 'After']], { inPoint: 30, outPoint: 100 })
    await openExportDialog(page)

    const row = page.getByRole('group', { name: 'Chapters' })
    await expect(row.getByRole('radio', { name: /^Section/ })).toBeChecked()
    await row.getByRole('button', { name: 'Copy chapters' }).click()
    await expect(row.getByRole('status').filter({ hasText: 'Chapters copied' })).toHaveCount(1)
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(
      '0:00 Intro\n0:10 In A\n0:40 In B'
    )

    await row.getByRole('radio', { name: 'Full video' }).check()
    await row.getByRole('button', { name: 'Copy chapters' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied))
      .toBe('0:00 Intro\n0:05 Before\n0:40 In A\n1:10 In B\n1:50 After')
  })

  test('without markers the Chapters row is left out', async ({ page }) => {
    await loadProject(page, [])
    await openExportDialog(page)
    await expect(page.getByRole('button', { name: 'Export Full Video' }).or(page.getByRole('button', { name: 'Download WebM' })).first()).toBeVisible()
    await expect(page.getByRole('group', { name: 'Chapters' })).toHaveCount(0)
  })
})
