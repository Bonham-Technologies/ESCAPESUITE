import { test, expect, type CDPSession, type Page } from '@playwright/test'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { CAPTURE_SIZE, CAPTURE_SIZE_LABEL, CRAFT_URL } from '../../utils/craftPerf'
import { keptTakes, syncAccessHandlesAvailable } from '../../utils/craftTakes'
import { round, writePerfResult } from '../../utils/perf'

/**
 * Benchmark: how the page's memory grows over a WebCodecs take, with the take
 * kept on the device as it records (ESCSUITE-466) and without.
 *
 * Before ESCSUITE-466 every WebCodecs take was muxed into a Mediabunny
 * `BufferTarget`: the whole file sat in the page's memory until Stop, so a
 * take's memory grew with its length at the recording's own bit rate. A take
 * kept on the device muxes into a `StreamTarget` whose bytes go straight to a
 * worker and from there to an OPFS file, and nothing of it stays behind.
 *
 * Two arms, one screen-only take each (`TAKE_SECONDS` long):
 *
 * - **`kept`** — the app as it ships, in a browser that hands workers an OPFS
 *   sync access handle.
 * - **`inMemory`** — the same take with `navigator.storage.getDirectory` taken
 *   away before the app loads, which is exactly the fallback a browser without
 *   OPFS gets: the take is muxed into a `BufferTarget`, as every take was
 *   before.
 *
 * Every `SAMPLE_EVERY_SECONDS` during the take the page is collected
 * (`HeapProfiler.collectGarbage`) and read with CDP `Runtime.getHeapUsage`:
 * the JS heap **plus `backingStorageSize`**, because an `ArrayBuffer`'s bytes
 * live outside the JS heap and `performance.memory` alone would not see a
 * `BufferTarget` grow at all. The figure reported is the least-squares slope
 * of those samples, in bytes per second, beside the slope of the bytes the
 * take has on disk (the `kept` arm only) — the recording's own rate, which is
 * what the `inMemory` arm's slope should match and the `kept` arm's should not.
 *
 * It asserts nothing about the numbers, as no benchmark here does. The checks
 * are that the arm measured what it says: the `kept` arm's take really is on
 * the device and growing, the `inMemory` arm's app said it is keeping the take
 * in memory only, and both takes stored.
 */

const TAKE_SECONDS = 20
const SAMPLE_EVERY_SECONDS = 3
/** Samples start after the encoder and the first Clusters have settled. */
const FIRST_SAMPLE_SECONDS = 3

interface Sample {
  seconds: number
  memoryBytes: number
  diskBytes: number
}

/** Least-squares slope of y over x. */
function slope(points: Array<[number, number]>): number {
  const n = points.length
  const mx = points.reduce((sum, [x]) => sum + x, 0) / n
  const my = points.reduce((sum, [, y]) => sum + y, 0) / n
  let num = 0
  let den = 0
  for (const [x, y] of points) {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

/** JS heap plus ArrayBuffer backing stores, after a forced collection. */
async function readMemory(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  const usage = (await cdp.send('Runtime.getHeapUsage')) as {
    usedSize: number
    backingStorageSize?: number
  }
  expect(
    usage.backingStorageSize,
    'Runtime.getHeapUsage reported no backingStorageSize: this Chromium cannot see ArrayBuffer memory'
  ).toBeDefined()
  return usage.usedSize + usage.backingStorageSize!
}

async function diskBytes(page: Page): Promise<number> {
  const takes = await keptTakes(page)
  return takes.reduce((sum, take) => sum + (take.files['primary.webm'] ?? 0), 0)
}

async function measureArm(page: Page, arm: 'kept' | 'inMemory'): Promise<Sample[]> {
  if (arm === 'inMemory') {
    await page.addInitScript(() => {
      Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined, configurable: true })
    })
  }
  await mockSyntheticMedia(page, { ...CAPTURE_SIZE })
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await page.waitForLoadState('networkidle')
  const cdp = await page.context().newCDPSession(page)

  await expect(page.getByRole('button', { name: 'Screen', exact: true })).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  const started = Date.now()

  const samples: Sample[] = []
  for (let at = FIRST_SAMPLE_SECONDS; at <= TAKE_SECONDS; at += SAMPLE_EVERY_SECONDS) {
    const wait = started + at * 1000 - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const memoryBytes = await readMemory(cdp)
    const disk = arm === 'kept' ? await diskBytes(page) : 0
    samples.push({ seconds: (Date.now() - started) / 1000, memoryBytes, diskBytes: disk })
  }

  if (arm === 'kept') {
    expect(samples.at(-1)!.diskBytes, 'the take never reached the device').toBeGreaterThan(samples[0].diskBytes)
  } else {
    // The app says so when it falls back, which is the proof it did.
    await expect(page.getByText(/kept in memory only/)).toBeVisible()
  }

  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(1, { timeout: 60_000 })
  await cdp.detach()
  return samples
}

test.describe('ESCAPECRAFT take memory', () => {
  test('craft-take-memory', async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000)
    const probe = await browser.newPage()
    await probe.goto(CRAFT_URL)
    const canKeep = await syncAccessHandlesAvailable(probe)
    await probe.close()
    test.skip(!canKeep, 'This browser hands workers no OPFS sync access handle, so no take is kept on the device')

    const result: Record<string, number | string> = {}
    for (const arm of ['kept', 'inMemory'] as const) {
      // A fresh context per arm: its own origin storage, and nothing of the
      // other arm's take left in the page.
      const context = await browser.newContext()
      await context.route('https://va.vercel-scripts.com/**', (route) => route.abort())
      try {
        const samples = await measureArm(await context.newPage(), arm)
        result[`${arm}MemoryBytesPerSecond`] = round(slope(samples.map((s) => [s.seconds, s.memoryBytes])), 0)
        result[`${arm}MemoryGrowthBytes`] = samples.at(-1)!.memoryBytes - samples[0].memoryBytes
        if (arm === 'kept') {
          result.diskBytesPerSecond = round(slope(samples.map((s) => [s.seconds, s.diskBytes])), 0)
        }
      } finally {
        await context.close()
      }
    }
    writePerfResult({
      name: 'craft-take-memory',
      runs: 1,
      captureSize: CAPTURE_SIZE_LABEL,
      takeSeconds: TAKE_SECONDS,
      sampleEverySeconds: SAMPLE_EVERY_SECONDS,
      ...result,
    })
    console.log('craft-take-memory', JSON.stringify(result))
  })
})
