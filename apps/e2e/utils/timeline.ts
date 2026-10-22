import { readFile } from 'node:fs/promises'
import { Browser, BrowserContext, Locator, Page, expect } from '@playwright/test'
import { ARTIST_URL } from './artist'
import { waitForAppReady } from './ready'

/**
 * Editing ESCAPEARTIST's timeline through the UI, the way a user does
 * (ESCSUITE-351): razor clicks, Delete, drags, Save, reopen and Export.
 *
 * Times come from the clips' own boxes on screen. Callers measure the
 * timeline's scale once with {@link pixelsPerSecond} on a clip of known
 * length, and every later position is that clip's pixels over that scale.
 */

/** Every clip on the timeline, in DOM order (the project's clip order, not position). */
export function timelineClips(page: Page): Locator {
  return page.locator('[data-clip-id]')
}

/**
 * The `index`-th clip from the left, by where it sits on screen. A split
 * may keep the original clip's id on either piece, so DOM order says nothing
 * about which is which.
 */
export async function clipFromLeft(page: Page, index: number): Promise<Locator> {
  const ids = await timelineClips(page).evaluateAll((els) =>
    els
      .map((el) => ({ id: el.getAttribute('data-clip-id')!, left: el.getBoundingClientRect().left }))
      .sort((a, b) => a.left - b.left)
      .map(({ id }) => id)
  )
  expect(ids.length, `no clip ${index} from the left`).toBeGreaterThan(index)
  return page.locator(`[data-clip-id="${ids[index]}"]`)
}

/** The preview's playhead time, in seconds, read off its timecode (`MM:SS.mmm`). */
export async function playheadSeconds(page: Page): Promise<number> {
  const text = (await page.locator('[class*="timecode"]').first().textContent()) ?? ''
  const match = /(\d+):(\d+(?:\.\d+)?)/.exec(text)
  expect(match, `no timecode in "${text}"`).not.toBeNull()
  return Number(match![1]) * 60 + Number(match![2])
}

/** A clip's start and end on the timeline, in seconds. */
export interface ClipSpan {
  start: number
  end: number
}

/** The timeline's scale: a clip `durationSec` long, measured on screen. */
export async function pixelsPerSecond(clip: Locator, durationSec: number): Promise<number> {
  const box = await clip.boundingBox()
  expect(box, 'the clip is not on screen').not.toBeNull()
  return box!.width / durationSec
}

/**
 * Every clip's span, left to right, from the boxes the timeline draws,
 * measured from the left edge of the clips' row, where 0 s is.
 */
export async function clipSpans(page: Page, pxPerSec: number): Promise<ClipSpan[]> {
  const boxes = await timelineClips(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, width: r.width }
    })
  )
  // The clips' row, not the lane: the lane's box includes its header column.
  const origin = await timelineClips(page)
    .first()
    .evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left)
  return boxes
    .map(({ left, width }) => ({ start: (left - origin) / pxPerSec, end: (left - origin + width) / pxPerSec }))
    .sort((a, b) => a.start - b.start)
}

/** Click `clip` at `atSec` seconds from its left edge with the Razor tool, then go back to Select. */
export async function razorSplit(page: Page, clip: Locator, atSec: number, pxPerSec: number): Promise<void> {
  const box = await clip.boundingBox()
  expect(box, 'the clip to split is not on screen').not.toBeNull()
  await page.getByTitle(/^Razor Tool/).click()
  await page.mouse.click(box!.x + atSec * pxPerSec, box!.y + box!.height / 2)
  await page.getByTitle(/^Selection Tool/).click()
}

/** Select `clip` and press Delete. */
export async function deleteClip(page: Page, clip: Locator): Promise<void> {
  await clip.click()
  await page.keyboard.press('Delete')
}

/**
 * Drag `clip` along its track by `dxSec` seconds (negative is left), in
 * small steps so the drag reads as one. Snapping is left as the user has it.
 */
export async function dragClipBy(page: Page, clip: Locator, dxSec: number, pxPerSec: number): Promise<void> {
  const box = await clip.boundingBox()
  expect(box, 'the clip to drag is not on screen').not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dxSec * pxPerSec * i) / steps, y)
  await page.mouse.up()
}

/** Save the project the way the user does and return the `.veditor` bytes. */
export async function saveProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.veditor$/)
  const path = await download.path()
  expect(path, 'the saved project has no file').toBeTruthy()
  return readFile(path!)
}

/**
 * Open a saved project in a fresh browser context, whose storage is empty,
 * through the uploader as a user drops one in. Returns the page and its
 * context; the caller closes the context.
 *
 * `prepare` runs on the new context before any page loads (for init
 * scripts such as the media-health probe).
 */
export async function reopenProject(
  browser: Browser,
  bytes: Buffer,
  prepare?: (context: BrowserContext) => Promise<void>
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext()
  try {
    await prepare?.(context)
    const page = await context.newPage()
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'reopened.veditor', mimeType: 'application/octet-stream', buffer: bytes })
    await expect(page.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })
    return { page, context }
  } catch (error) {
    await context.close()
    throw error
  }
}

/** Export the timeline as WebM through the export dialog and return the file's bytes. */
export async function exportWebM(page: Page): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export video' }).click()
  const downloadWebM = page.getByRole('button', { name: /download webm/i }).first()
  await expect(downloadWebM).toBeVisible({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await downloadWebM.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.webm$/)
  const path = await download.path()
  expect(path, 'the export has no file').toBeTruthy()
  return readFile(path!)
}

/** What {@link analyseAudio} reads off a file's decoded audio. */
export interface AudioAnalysis {
  /** The decoded audio's length, in seconds. */
  duration: number
  /** RMS level of each 10 ms window, first channel. */
  rms: number[]
}

/** Decode `bytes` in the page with `decodeAudioData` and measure it in 10 ms windows. */
export async function analyseAudio(page: Page, bytes: Buffer): Promise<AudioAnalysis> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    const ctx = new OfflineAudioContext(1, 1, 48_000)
    const buffer = await ctx.decodeAudioData(data.buffer)
    const samples = buffer.getChannelData(0)
    const window = Math.round(buffer.sampleRate / 100)
    const rms: number[] = []
    for (let start = 0; start + window <= samples.length; start += window) {
      let sum = 0
      for (let i = start; i < start + window; i++) sum += samples[i] * samples[i]
      rms.push(Math.sqrt(sum / window))
    }
    return { duration: buffer.duration, rms }
  }, bytes.toString('base64'))
}

/** The longest run of 10 ms windows under `floor` RMS, in seconds. */
export function longestSilence({ rms }: AudioAnalysis, floor = 0.01): number {
  let longest = 0
  let run = 0
  for (const level of rms) {
    run = level < floor ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  return longest / 100
}

/** The mean RMS of the 10 ms windows between `from` and `to` seconds. */
export function levelBetween({ rms }: AudioAnalysis, from: number, to: number): number {
  const slice = rms.slice(Math.floor(from * 100), Math.ceil(to * 100))
  return slice.length ? slice.reduce((sum, level) => sum + level, 0) / slice.length : 0
}
