import { readFile } from 'node:fs/promises'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, inspector, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { analyseAudio, levelBetween, playheadSeconds, timelineClips } from '../../utils/timeline'
import { AV_FIXTURE_TIMING, AV_FIXTURE_WEBM } from '../../utils/mediaHealth'
import { ANALYSIS_ORIGIN, mediabunnyBundle } from '../../utils/avSync'

/**
 * ESCSUITE-519: speeding a clip up shortens the timeline, but the in and out
 * points (and the markers) stay where they were set. The export dialog offered
 * "Export Section" over the raw points: a section wholly past the new end
 * exported seconds of black with no sound and still said "Export complete!",
 * one that straddled the end padded the picture with black to the old out
 * point, and the Chapters row listed markers past the end.
 *
 * Now a section wholly past the end cannot be exported and the dialog says why
 * (in text the disabled button points at); one that straddles the end is
 * clamped to it, its button says the clamped range, and its export holds
 * picture and sound for exactly that long; the chapter list stops at the end.
 *
 * The clip is the A/V fixture (`tone-gap.webm`): 5 s of testsrc2 over a tone,
 * silent from 2 s to 3 s of source. The in point, the markers and the out
 * point are set with the keys a user presses (the arrows step the playhead by
 * a second; I, M and O at the playhead), then the speed from the inspector.
 */

const FPS = 30
const ONE_FRAME = 1 / FPS

/** Set the in point and markers at whole seconds, the out point at the end, as a user does. */
async function setPointsByKey(page: Page, inAt: number, markersAt: number[]) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Home')
  for (let second = 0; second < AV_FIXTURE_TIMING.duration; second++) {
    await expect.poll(() => playheadSeconds(page)).toBeCloseTo(second, 1)
    if (second === inAt) await page.keyboard.press('i')
    if (markersAt.includes(second)) await page.keyboard.press('m')
    await page.keyboard.press('ArrowRight')
  }
  await page.keyboard.press('End')
  await page.keyboard.press('o')
}

/** Set the (only) clip's speed from the inspector's Speed section. */
async function setSpeed(page: Page, speed: number) {
  await timelineClips(page).first().click({ position: { x: 8, y: 8 } })
  await inspector(page).getByRole('button', { name: /^Speed/ }).click()
  const button = inspector(page).getByRole('button', { name: `${speed}×`, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(timelineClips(page).first()).toContainText(`${speed}×`)
}

/** The text of every element a control's `aria-describedby` names. */
async function describedBy(page: Page, id: string | null): Promise<string> {
  const texts = await Promise.all(
    (id ?? '').split(/\s+/).filter(Boolean).map((one) => page.locator(`[id="${one}"]`).textContent())
  )
  return texts.join(' ')
}

interface ExportReading {
  duration: number
  videoDuration: number
  /** Mean luma of the picture's middle third (where the 640×360 fixture sits) at each checked time. */
  luma: number[]
}

/** Read the export's length and picture with Mediabunny, in a blank page on a secure origin. */
async function readExport(context: BrowserContext, exported: Buffer, at: number[]): Promise<ExportReading> {
  const page = await context.newPage()
  try {
    const base = `${ANALYSIS_ORIGIN}/__section-past-end`
    await page.route(`${base}/index.html`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Section</title>' })
    )
    await page.route(`${base}/export`, (route) => route.fulfill({ contentType: 'application/octet-stream', body: exported }))
    await page.goto(`${base}/index.html`)
    await page.addScriptTag({ content: mediabunnyBundle() })
    return await page.evaluate(
      async ({ base, at }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const MB = (window as any).Mediabunny
        const bytes = await (await fetch(`${base}/export`)).arrayBuffer()
        const input = new MB.Input({ source: new MB.BufferSource(bytes), formats: MB.ALL_FORMATS })
        const duration: number = await input.computeDuration()
        const track = await input.getPrimaryVideoTrack()
        if (!track) throw new Error('the export has no video track')
        const videoDuration: number = await track.computeDuration()
        const w: number = track.displayWidth
        const h: number = track.displayHeight
        const sink = new MB.CanvasSink(track, {
          width: 64,
          height: 36,
          fit: 'fill',
          crop: { left: Math.round(w / 3), top: Math.round(h / 3), width: Math.round(w / 3), height: Math.round(h / 3) },
        })
        const luma: number[] = []
        for (const t of at) {
          const wrapped = await sink.getCanvas(t)
          if (!wrapped) throw new Error(`no frame at ${t} s`)
          const { data } = (wrapped.canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, 64, 36)
          let sum = 0
          for (let p = 0; p < data.length; p += 4) sum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
          luma.push(sum / (data.length / 4))
        }
        return { duration, videoDuration, luma }
      },
      { base, at }
    )
  } finally {
    await page.close()
  }
}

test.describe('ESCSUITE-519: Export Section after a speed-up stops at the end of the timeline', () => {
  test.beforeEach(async ({ page }) => {
    // Vercel Analytics' dev script is a third-party host: never reached from a test.
    await page.route('https://va.vercel-scripts.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    )
    // The chapter list is read off a stubbed clipboard (Firefox and WebKit
    // cannot be granted clipboard permission).
    await page.addInitScript(() => {
      ;(window as unknown as { __copied: string | null }).__copied = null
      Clipboard.prototype.writeText = async (text: string) => {
        ;(window as unknown as { __copied: string | null }).__copied = text
      }
    })
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)
  })

  test('a section wholly past the end cannot be exported, and the dialog says why', async ({ page }) => {
    test.setTimeout(120_000)
    // In at 2 s, out at 5 s; at 4× the timeline is 1.25 s long.
    await setPointsByKey(page, 2, [])
    await setSpeed(page, 4)
    await openExportDialog(page)

    const section = page.getByRole('button', { name: /^Export Section/ })
    await expect(section).toHaveText('Export Section (0:02 - 0:05)')
    await expect(section).toBeDisabled()
    const reason = await describedBy(page, await section.getAttribute('aria-describedby'))
    expect(reason).toContain('Cannot export the section: it starts at 0:02 and the timeline ends at 0:01')
    await expect(page.getByText(/^Cannot export the section: it starts at 0:02/)).toBeVisible()

    // The whole (sped-up) timeline still exports.
    await expect(page.getByRole('button', { name: 'Export Full Video' })).toBeEnabled()
  })

  test('a section that straddles the end is clamped: its label, its export and its chapters stop at the end', async ({
    page,
    context,
    browserName,
  }) => {
    test.setTimeout(180_000)
    // In at 1 s, out at 5 s, markers at 1 s and 3 s; at 2× the timeline is
    // 2.5 s long, so the section is 1–2.5 s and the 3 s marker is past the end.
    // (2×, not the ticket's 4×: above 2× a clip is silent by design, and the
    // export must be shown to hold sound.)
    await setPointsByKey(page, 1, [1, 3])
    await setSpeed(page, 2)
    await openExportDialog(page)

    // Soft, so the export below is still read and judged when these fail.
    const section = page.getByRole('button', { name: /^Export Section/ })
    await expect.soft(section).toHaveText('Export Section (0:01 - 0:02)')
    await expect(section).toBeEnabled()

    // Chapters: the section's list holds only the marker on the timeline.
    const chapters = page.getByRole('group', { name: 'Chapters' })
    await expect.soft(chapters.getByRole('radio', { name: /^Section/ })).toHaveAccessibleName('Section (0:01 - 0:02)')
    await chapters.getByRole('button', { name: 'Copy chapters' }).click()
    expect.soft(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe('0:00 Chapter 1')

    const downloading = page.waitForEvent('download', { timeout: 120_000 })
    await section.click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/\.webm$/)
    const path = await download.path()
    expect(path, 'the export has no file').toBeTruthy()
    const bytes = await readFile(path!)

    // 1.5 s of export: timeline 1–2.5 s, source 2–5 s at 2×.
    const length = 2.5 - 1
    const reading = await readExport(context, bytes, [0.25, 0.75, 1.25])
    expect(Math.abs(reading.videoDuration - length), `video runs ${reading.videoDuration} s`).toBeLessThanOrEqual(ONE_FRAME + 1e-6)
    expect(Math.abs(reading.duration - length), `file runs ${reading.duration} s`).toBeLessThanOrEqual(ONE_FRAME + 1e-6)

    // Sound: as long as the picture, silent for the source's 2–3 s (the
    // export's first 0.5 s), then the tone.
    const audio = await analyseAudio(page, bytes)
    expect(Math.abs(audio.duration - length), `sound runs ${audio.duration} s`).toBeLessThanOrEqual(ONE_FRAME + 0.03)
    expect(levelBetween(audio, 0.7, 1.4), 'the tone plays after the silence').toBeGreaterThan(0.05)

    // Picture: every checked frame shows the fixture. WebKit (Playwright's
    // Linux build) decodes its own WebM export as black at any speed (see the
    // ESCSUITE-471 spec), so it checks length and sound only.
    if (browserName === 'webkit' && reading.luma.every((l) => l === 0)) {
      test.info().annotations.push({ type: 'skipped-check', description: 'WebKit decodes its WebM export as black: picture not checked' })
      return
    }
    for (const [i, l] of reading.luma.entries()) expect(l, `frame ${i} is not black: ${JSON.stringify(reading)}`).toBeGreaterThan(30)
  })
})
