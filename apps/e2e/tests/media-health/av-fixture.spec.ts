import { test } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import {
  AV_FIXTURE_MP4,
  AV_FIXTURE_SILENCE,
  AV_FIXTURE_WEBM,
  expectPreviewAlive,
  expectPreviewFrameChangesOnSeek,
  expectWaveformDrawn,
  installMediaHealthProbe,
  waveformCanvas,
} from '../../utils/mediaHealth'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-348: both A/V fixtures, imported into ARTIST, pass every
 * media-health helper — a drawn waveform with a quieter silent window, a
 * preview that plays with sound, and a seek that shows a new frame.
 *
 * The MP4 twin is H.264/AAC: the Chromium Playwright pins (and CI runs)
 * decodes it; an older headless shell without H.264 (build 1194) fails it.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Measured on Chromium, which CI gates; not yet run on Firefox or WebKit'
)

for (const [label, fixture] of [
  ['WebM (VP9/Opus)', AV_FIXTURE_WEBM],
  ['MP4 (H.264/AAC)', AV_FIXTURE_MP4],
] as const) {
  test(`the ${label} A/V fixture is alive in the editor`, async ({ page }) => {
    test.setTimeout(60_000)
    await installMediaHealthProbe(page)
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, fixture)

    await expectWaveformDrawn(waveformCanvas(page), { silence: AV_FIXTURE_SILENCE })

    await page.getByTitle('Play (Space)').click()
    await expectPreviewAlive(page, { forMs: 1000 })
    await page.getByTitle('Pause (Space)').click()

    await expectPreviewFrameChangesOnSeek(page, () => page.getByTitle('Step forward (→)').click())
  })
}
