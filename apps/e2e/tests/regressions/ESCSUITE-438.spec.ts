import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { installSpeechStub, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-438: "Stop transcribing" works while the sound is being prepared,
 * preparing shows how far it has got, and a run cannot hang after the sound
 * has finished playing.
 *
 * Repro from the ticket: with a recogniser whose `stop()` never fires `onend`,
 * 17 s after starting a 6 s timeline the control still read "Transcribing on
 * this device… 0:06 / 0:06". Now the run finishes with what was heard about
 * 5 s after the sound ends. And "Preparing the sound…" showed no progress.
 *
 * The recogniser is the stub in `utils/speechStub.ts` (with a vendor brand, so
 * the headless shell's real `available()` is never called). The mix is made
 * slow enough to press Stop during it by handing out every stored file's
 * bytes a little at a time, switched on only after the import (`__slowReadsMs`).
 */

// 8 s, not 6: the stub's second interim result fires at 5 s and stop() at the
// clip's end clears its timers, so a 6 s clip left only 1 s of slack on a busy
// runner before the second caption was lost.
const CLIP_SECONDS = 8
const STOPPED = 'Transcription stopped. No captions were added.'
const DONE = 'Transcribed 2 captions onto the Captions track.'
/** With `__slowReadsMs` at 150, the 20 s clip's 1.9 MB take about 9 s to read. */
const SLOW_PIECE_BYTES = 32 * 1024

/**
 * Once `window.__slowReadsMs` is set, a `Blob` stream hands out at most
 * `SLOW_PIECE_BYTES` at a time, each that long after the last. Chromium hands
 * a stored file's whole stream out as one chunk, so delaying chunks alone
 * would hold the mix up once and then let it run to the end at full speed.
 *
 * WebKit never streams a stored file: mediabunny's `BlobSource` reads it there
 * as `blob.slice(a, b).arrayBuffer()`, 64 KiB at a time (its `isWebKit()`
 * check, for WebKit's `Blob.stream()` bugs). So `arrayBuffer()` is slowed too,
 * by the same delay for every `SLOW_PIECE_BYTES` it reads: every engine then
 * reads the 20 s clip in about the same 9 s.
 */
async function installSlowReads(page: Page): Promise<void> {
  await page.addInitScript((pieceBytes) => {
    const w = window as unknown as { __slowReadsMs?: number }
    const arrayBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function (this: Blob) {
      const delay = w.__slowReadsMs
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay * Math.ceil(this.size / pieceBytes)))
      return arrayBuffer.call(this)
    }
    const stream = Blob.prototype.stream
    Blob.prototype.stream = function (this: Blob) {
      const inner = stream.call(this)
      const delay = w.__slowReadsMs
      if (!delay) return inner
      const reader = inner.getReader()
      let pending = new Uint8Array(0)
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          if (pending.length === 0) {
            const { done, value } = await reader.read()
            if (done) {
              controller.close()
              return
            }
            pending = value
          }
          controller.enqueue(pending.slice(0, pieceBytes))
          pending = pending.subarray(pieceBytes)
        },
        cancel: (reason) => reader.cancel(reason),
      }) as ReturnType<Blob['stream']>
    }
  }, SLOW_PIECE_BYTES)
}

async function openWithClip(page: Page, seconds: number): Promise<void> {
  // 48 kHz, so the mix streams the file chunk by chunk (other rates are decoded whole).
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(seconds, 48000) })
  await expect(timelineClips(page)).toHaveCount(1)
}

test.describe('ESCSUITE-438: stopping while the sound is prepared, and a run that cannot hang', () => {
  test.describe.configure({ timeout: 90_000 })

  test('preparing the sound shows its progress, and Stop then frees the control within 1 s, adding nothing', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await installSlowReads(page)
    await openWithClip(page, 20)
    await page.evaluate(() => {
      ;(window as unknown as { __slowReadsMs: number }).__slowReadsMs = 150
    })

    await transcribeButton(page).click()
    await expect(page.getByText('Preparing the sound…')).toBeVisible({ timeout: 10_000 })
    // How far the mix has got, next to the preparing line, and it moves.
    const percent = page.getByText('Preparing the sound…').locator('..').getByText(/^\d+%$/)
    await expect(percent).toBeVisible()
    await expect.poll(async () => parseInt((await percent.textContent()) ?? '0', 10), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(page.getByText('Preparing the sound…')).toBeVisible()

    await page.getByRole('button', { name: 'Stop transcribing' }).click()
    await expect(transcribeButton(page)).toBeVisible({ timeout: 1_000 })
    await expect(page.getByRole('button', { name: 'Stop transcribing' })).toHaveCount(0)
    await expect(page.getByText(STOPPED)).toBeVisible({ timeout: 1_000 })
    await expect(page.getByText('Preparing the sound…')).toHaveCount(0)

    // Well past where a mix and a listen would have ended: nothing was heard or added.
    await page.waitForTimeout(5_000)
    expect((await stubRecord(page)).starts).toEqual([])
    await expect(timelineClips(page)).toHaveCount(1)
    await expect(page.getByText(/Transcribed \d+ captions? onto the Captions track/)).toHaveCount(0)
  })

  test('a recogniser that never ends after stop() still finishes with what was heard, about 5 s after the sound ends', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available', stopNeverEnds: true })
    await openWithClip(page, CLIP_SECONDS)

    await transcribeButton(page).click()
    await expect(page.getByText(/Transcribing on this device/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`0:0${CLIP_SECONDS} / 0:0${CLIP_SECONDS}`)).toBeVisible({ timeout: (CLIP_SECONDS + 5) * 1000 })

    // The ticket saw a 6 s timeline still reading 0:06 / 0:06 eleven seconds later.
    await expect(page.getByText(DONE)).toBeVisible({ timeout: 8_000 })
    await expect(transcribeButton(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop transcribing' })).toHaveCount(0)
    await expect(timelineClips(page)).toHaveCount(3)
  })
})
