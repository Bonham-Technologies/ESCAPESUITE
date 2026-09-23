import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { canConvertToMp4, canEncodeAac } from '../../utils/webcodecs'

/**
 * ESCAPECRAFT downloads a recording's audio as M4A, converted in the page.
 *
 * The take is real — `mockSyntheticMedia` hands the app an animated canvas
 * stream and an oscillator-backed microphone, so the recorder produces a
 * genuine WebM with genuine sound in it — and the conversion is the real
 * `convertToM4A`: `decodeAudioData`, AAC encode, Mediabunny mux. The claim
 * being tested is stronger than "a file arrived": the bytes that land are
 * handed back to the page and decoded, so a container the browser could not
 * read would fail here rather than pass as a download.
 *
 * Which half runs is decided by the browser in front of it rather than by its
 * name, as in `mp4-download.spec.ts` — but the question has one more part.
 * `convertToMP4` drops the audio and writes a silent MP4 where there is no AAC
 * encoder; `convertToM4A` has nothing left to write and refuses, so the
 * enabled path needs `canEncodeAac()` as well as `canConvertToMp4()`.
 *
 * The second test is the other gate, and it is about the recording rather than
 * the browser: a take recorded with the microphone off has no audio in it, and
 * the button must say so rather than hand back an empty file.
 */

const CRAFT_URL = 'http://localhost:5174'

/** Record one take, with or without the microphone, and wait for its row. */
async function record(page: Page, options: { microphone: boolean }): Promise<void> {
  await page.goto(CRAFT_URL)
  await page.waitForLoadState('networkidle')

  // Capability detection is async; the source toggles stay disabled until it
  // finishes and a take started before then acquires no stream.
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

  const microphone = page.getByRole('button', { name: 'Microphone' })
  await expect(microphone).toBeEnabled({ timeout: 30_000 })
  // The microphone is on by default, so only the silent take touches it.
  if (!options.microphone) await microphone.click()
  await expect(microphone).toHaveAttribute('aria-pressed', String(options.microphone))

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
    timeout: 30_000,
  })
}

test.describe('ESCAPECRAFT M4A download', () => {
  test.beforeEach(async ({ page }) => {
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
  })

  test('converts the audio and saves a decodable .m4a file', async ({ page }) => {
    await record(page, { microphone: true })
    test.skip(
      !((await canConvertToMp4(page)) && (await canEncodeAac(page))),
      'This browser cannot encode AAC'
    )
    test.setTimeout(180_000)

    const m4aButton = page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })
    await expect(m4aButton).toBeEnabled()

    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
    await m4aButton.click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.m4a$/)

    // Not merely "a file arrived": the bytes go back into the page and are
    // decoded there. An M4A that Web Audio cannot read is not an audio file.
    const path = await download.path()
    const bytes = readFileSync(path)
    expect(bytes.byteLength).toBeGreaterThan(1000)

    const duration = await page.evaluate(async (base64) => {
      const binary = atob(base64)
      const buffer = new ArrayBuffer(binary.length)
      const view = new Uint8Array(buffer)
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
      const context = new AudioContext()
      try {
        const decoded = await context.decodeAudioData(buffer)
        return decoded.duration
      } finally {
        await context.close()
      }
    }, bytes.toString('base64'))

    // The take runs for two seconds; anything over one proves it carried the
    // recording's audio rather than a header and silence.
    expect(duration).toBeGreaterThan(1)

    // Back to idle: no progress row, and the button available again.
    await expect(page.getByRole('progressbar', { name: /Converting .+ to M4A/ })).toHaveCount(0)
    await expect(m4aButton).toBeEnabled()
  })

  test('offers M4A disabled, saying so, on a take with no audio in it', async ({ page }) => {
    await record(page, { microphone: false })

    const m4aButton = page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })
    await expect(m4aButton).toBeVisible()
    await expect(m4aButton).toBeDisabled()
    await expect(m4aButton).toHaveAttribute('title', 'This recording has no audio')

    // The take is still a video, so the other two downloads are untouched.
    await expect(page.getByRole('button', { name: /^Download (?!.+ as ).+$/ })).toBeEnabled()
  })

  test('offers M4A disabled, with a reason, where it cannot encode AAC', async ({ page }) => {
    await record(page, { microphone: true })
    test.skip(
      (await canConvertToMp4(page)) && (await canEncodeAac(page)),
      'This browser can convert — the enabled path is above'
    )

    const m4aButton = page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })
    await expect(m4aButton).toBeVisible()
    await expect(m4aButton).toBeDisabled()
    // Whichever way the probe refused names itself in the reason.
    await expect(m4aButton).toHaveAttribute('title', /WebCodecs|H\.264|AAC|could not say/)
  })
})
