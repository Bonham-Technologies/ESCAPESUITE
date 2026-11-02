import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { installMediaHealthProbe } from '../../utils/mediaHealth'
import { describeGrowth, installResourceProbe, readLiveCounts, type ResourceCounts } from '../../utils/resourceProbe'

/**
 * ESCSUITE-350: the resource probe counts what it claims to. A probe that
 * always reads 0 would turn the soak (`tests/escapeartist/soak.spec.ts`)
 * into a green no-op, so each kind is made, counted live, released the way
 * the probe's table says, and counted gone, on a blank routed page.
 *
 * The page is served on `localhost` (routed, no server behind the port)
 * because WebCodecs exists only in a secure context.
 */
const ORIGIN = 'http://localhost:5999'

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'readLiveCounts forces a GC through Chromium’s DevTools protocol'
)

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ body: '<!doctype html><title>probe</title>', contentType: 'text/html' })
  )
})

test('each kind is counted live until it is released', async ({ page }) => {
  // Both probes, mediaHealth's first: they compose over createElement.
  await installMediaHealthProbe(page)
  await installResourceProbe(page)
  await page.goto(ORIGIN)

  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w.ctx = new AudioContext()
    w.offline = new OfflineAudioContext(1, 128, 8000)
    w.vdec = new VideoDecoder({ output: () => {}, error: () => {} })
    w.adec = new AudioDecoder({ output: () => {}, error: () => {} })
    w.worker = new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })))
    const video = document.createElement('video')
    video.src = URL.createObjectURL(new Blob(['x'], { type: 'video/webm' }))
    w.video = video
    const audio = new Audio()
    audio.src = 'data:audio/wav;base64,'
    w.audio = audio
  })
  const held = await readLiveCounts(page)
  expect(held.live).toEqual({
    audioContext: 1,
    offlineAudioContext: 1,
    videoDecoder: 1,
    audioDecoder: 1,
    worker: 1,
    objectUrl: 2,
    mediaElement: 2,
  })
  // mediaHealth's probe still sees the element, so neither wrapper clobbered the other.
  expect(
    await page.evaluate(() => (window as unknown as { __mediaHealth: { elements: unknown[] } }).__mediaHealth.elements.length)
  ).toBe(1)
  // And the site names the caller, for a failure message.
  expect(held.liveSites.length).toBeGreaterThan(0)

  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    await w.ctx.close()
    await w.offline.startRendering()
    w.vdec.close()
    w.adec.close()
    w.worker.terminate()
    URL.revokeObjectURL(w.video.src)
    w.video.src = ''
    w.audio.removeAttribute('src')
    w.audio.load()
  })
  const released = await readLiveCounts(page)
  // One object URL is left: the worker's script URL, never revoked here.
  expect(released.live).toEqual({
    audioContext: 0,
    offlineAudioContext: 0,
    videoDecoder: 0,
    audioDecoder: 0,
    worker: 0,
    objectUrl: 1,
    mediaElement: 0,
  })
  expect(released.created.mediaElement).toBe(2)
})

test('a dropped, unclosed decoder stops counting once it is collected', async ({ page }) => {
  // A dropped media element is not pinned the same way: Chromium can keep a
  // detached element with a source alive after the page lets go of it (it
  // did in about half the runs of an errored data: source), and the probe
  // then counts it, which errs towards reporting a leak.
  await installResourceProbe(page)
  await page.goto(ORIGIN)
  await page.evaluate(() => {
    // Made in a function of its own, so no local of this one holds it.
    const drop = () => {
      new VideoDecoder({ output: () => {}, error: () => {} })
    }
    drop()
    ;(window as unknown as { kept: VideoDecoder }).kept = new VideoDecoder({ output: () => {}, error: () => {} })
  })
  const after = await readLiveCounts(page)
  expect(after.created.videoDecoder).toBe(2)
  expect(after.live.videoDecoder).toBe(1)
})

// ESCSUITE-366: a decoder made inside a dedicated worker used to be invisible,
// and ARTIST's only VideoDecoder lives in its decode worker.
const WORKER_SCRIPT = `
let decoder = null
let url = null
onmessage = (event) => {
  if (event.data === 'make') {
    decoder = new VideoDecoder({ output: () => {}, error: () => {} })
    url = URL.createObjectURL(new Blob(['x']))
  } else if (event.data === 'close') {
    decoder.close()
    URL.revokeObjectURL(url)
  }
  postMessage(event.data)
}
`

/**
 * Start a module worker served from the page's own origin, as Vite serves
 * ARTIST's. A real server on `localhost` rather than a route: the probe
 * rewrites worker scripts with a route of its own, which fetches the script
 * from the network.
 */
async function startWorker(page: Page): Promise<void> {
  const server = createServer((request, response) => {
    const isWorker = request.url === '/probe-worker.js'
    response.writeHead(200, { 'content-type': isWorker ? 'text/javascript' : 'text/html' })
    response.end(isWorker ? WORKER_SCRIPT : '<!doctype html><title>probe</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  await installResourceProbe(page)
  await page.goto(`http://localhost:${port}/`)
  await page.evaluate(() => {
    const worker = new Worker('/probe-worker.js', { type: 'module' })
    ;(window as unknown as { worker: Worker }).worker = worker
  })
}

const servers: Server[] = []
test.afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function tellWorker(page: Page, message: 'make' | 'close'): Promise<void> {
  await page.evaluate(
    (message) =>
      new Promise<void>((resolve) => {
        const worker = (window as unknown as { worker: Worker }).worker
        worker.addEventListener('message', () => resolve(), { once: true })
        worker.postMessage(message)
      }),
    message
  )
}

const NONE: ResourceCounts = {
  audioContext: 0,
  offlineAudioContext: 0,
  videoDecoder: 0,
  audioDecoder: 0,
  worker: 0,
  objectUrl: 0,
  mediaElement: 0,
}

test('a decoder and a blob URL made inside a worker are counted until they are released', async ({ page }) => {
  await startWorker(page)
  const baseline = await readLiveCounts(page)
  expect(baseline.live).toEqual({ ...NONE, worker: 1 })

  await tellWorker(page, 'make')
  const held = await readLiveCounts(page)
  expect(held.live).toEqual({ ...NONE, worker: 1, videoDecoder: 1, objectUrl: 1 })
  expect(held.liveSites.filter((r) => r.site.startsWith('worker: ')).map((r) => r.kind).sort()).toEqual([
    'objectUrl',
    'videoDecoder',
  ])

  await tellWorker(page, 'close')
  const released = await readLiveCounts(page)
  expect(released.live).toEqual(baseline.live)
  // Reported over the channel, a moment after the worker made it.
  await expect.poll(async () => (await readLiveCounts(page)).created.videoDecoder).toBe(1)
})

test('an unclosed decoder in a worker is reported as growth, naming the worker', async ({ page }) => {
  await startWorker(page)
  const baseline = await readLiveCounts(page)

  await tellWorker(page, 'make')
  const growth = describeGrowth(baseline.live, await readLiveCounts(page), NONE)

  expect(growth).toHaveLength(2)
  expect(growth.find((line) => line.startsWith('videoDecoder: 1 live'))).toContain('worker: ')
})

test('a terminated worker takes its decoder with it', async ({ page }) => {
  await startWorker(page)
  await tellWorker(page, 'make')
  await page.evaluate(() => (window as unknown as { worker: Worker }).worker.terminate())

  const after = await readLiveCounts(page)
  expect(after.live).toEqual(NONE)
  // What it made is still counted as made, reported to the page as it was made.
  await expect.poll(async () => (await readLiveCounts(page)).created).toMatchObject({ videoDecoder: 1, objectUrl: 1 })
})

test("a worker's reports reach only the page that started it", async ({ page, context }) => {
  await startWorker(page)
  // A second page on the same origin hears the same BroadcastChannels.
  const other = await context.newPage()
  await installResourceProbe(other)
  await other.goto(page.url())

  await tellWorker(page, 'make')
  await expect.poll(async () => (await readLiveCounts(page)).created.videoDecoder).toBe(1)
  expect((await readLiveCounts(other)).created).toEqual(NONE)
})
