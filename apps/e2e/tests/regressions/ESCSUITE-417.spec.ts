import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { readWebmLayout, videoLayoutProblems } from '../../utils/webmLayout'

/**
 * ESCSUITE-417: an ESCAPECRAFT WebCodecs take could hold a key frame on the
 * WebM timecode of the delta frame before it, and Chromium never completes a
 * seek past such a key frame — no `seeked`, `seeking` stays true, `readyState`
 * stays 1 (ESCSUITE-412, `fixtures/seek-wedge/README.md`). The recorder
 * declares 30 fps to Mediabunny, which snaps every timestamp to that grid, so
 * two frames captured inside one 33 ms slot landed on one timecode. Since
 * ESCSUITE-412 ARTIST's export recovers from it by reloading the source from a
 * remux; the recording itself was still written that way.
 *
 * The recorder now gives every frame a slot of its own. This records a real
 * screen take with the capture jitter that used to do it forced on every
 * second, then reads the stored bytes and seeks every frame of them.
 *
 * The jitter. An init script makes the take stamp its video in
 * `performance.now()` time (an audio context reporting no output timestamp,
 * which the recorder already handles) and moves the clock reading the
 * recorder takes for each frame it reads off the MediaStreamTrackProcessor —
 * the read it throttles on and stamps with. It watches the encoder to learn
 * the take's start and when the next key frame is due, and on every second
 * hands the recorder two frames 27.5 ms apart, both inside the slot the key
 * frame falls in: the first a delta, the second due to be the key frame. The
 * gap clears the recorder's 26.7 ms throttle, and every other frame keeps its
 * real capture time or close to it. Before the fix each of those pairs was a
 * key frame on its delta's timecode, mid-Cluster with no cue, and the seeks
 * wedged from the first of them on.
 *
 * Chromium only: the WebCodecs recorder and the wedge are Chromium's.
 */

const CRAFT_URL = 'http://localhost:5174'

/** Force the collision described above; `window.__jitter` reports what it did. */
async function forceKeyFrameCollisions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const SLOT = 1000 / 30
    // Past the recorder's throttle (0.8 of a slot, 26.7 ms), short of a slot.
    const GAP = 27.5
    const realNow = performance.now.bind(performance)
    let override: number | null = null
    performance.now = () => override ?? realNow()

    // No usable output timestamp: the recorder stamps video in performance.now() time.
    AudioContext.prototype.getOutputTimestamp = function () {
      return { contextTime: 0, performanceTime: 0 }
    }

    const state = {
      /** performance.now() at the recorder's start(), learned from the first encode. */
      start: null as number | null,
      /** The clock reading handed to the frame being read. */
      reading: null as number | null,
      lastKeyUs: 0,
      lastE: 0,
      pendingKeyAt: null as number | null,
      /** Pairs handed over; and of those, the ones whose second frame was encoded as the key frame. */
      pairs: 0,
      keyedPairs: 0,
      awaitingKey: false,
    }
    ;(window as unknown as { __jitter: typeof state }).__jitter = state

    const encode = VideoEncoder.prototype.encode
    VideoEncoder.prototype.encode = function (this: VideoEncoder, frame: VideoFrame, options?: VideoEncoderEncodeOptions) {
      if (state.start === null && state.reading !== null) {
        state.start = state.reading - frame.timestamp / 1000
        state.lastE = frame.timestamp / 1000
      }
      if (state.awaitingKey) {
        if (options?.keyFrame) state.keyedPairs += 1
        state.awaitingKey = false
      }
      if (options?.keyFrame) state.lastKeyUs = frame.timestamp
      return encode.call(this, frame, options)
    }

    /** The recording-clock time (ms since start) to give the frame just read. */
    const elapsedFor = (start: number): number => {
      if (state.pendingKeyAt !== null) {
        const e = state.pendingKeyAt
        state.pendingKeyAt = null
        state.awaitingKey = true
        state.pairs += 1
        return e
      }
      const real = realNow() - start
      // A frame the recorder's throttle will drop anyway keeps its real time.
      if (real - state.lastE < 26) return real
      const natural = Math.max(real, state.lastE + GAP)
      const nextKey = state.lastKeyUs / 1000 + 1000
      // The slot whose 0.375 point is the first at or past the key frame's due
      // time: the key frame goes there, its delta 27.5 ms before it — 0.45 of
      // a slot before the middle, so both are well inside the one slot.
      const slot = Math.ceil(nextKey / SLOT - 0.375)
      const keyAt = (slot + 0.375) * SLOT
      const deltaAt = keyAt - GAP
      if (deltaAt < nextKey && deltaAt >= state.lastE + GAP && Math.abs(natural - deltaAt) < SLOT) {
        state.pendingKeyAt = keyAt
        return deltaAt
      }
      // No room this second: put the key frame at the 0.375 point anyway, so
      // the next one is due where there is.
      return natural >= nextKey ? Math.max(natural, keyAt) : natural
    }

    const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor
    if (!Processor) return
    ;(window as unknown as { MediaStreamTrackProcessor: unknown }).MediaStreamTrackProcessor = function (init: { track: MediaStreamTrack }) {
      const processor = new Processor(init)
      if (init.track.kind !== 'video') return processor
      return {
        readable: {
          getReader() {
            const reader = processor.readable.getReader()
            return {
              async read() {
                const result = await reader.read()
                if (!result.done) {
                  const start = state.start
                  const e = start === null ? null : elapsedFor(start)
                  if (e !== null && e - state.lastE >= 26) state.lastE = e
                  state.reading = start === null ? realNow() : start + e!
                  // The recorder reads the clock straight after this read
                  // resolves, in the same microtask checkpoint; the next task
                  // sees the real clock again.
                  override = state.reading
                  setTimeout(() => {
                    override = null
                  }, 0)
                }
                return result
              },
              cancel: (reason?: unknown) => reader.cancel(reason),
              releaseLock: () => reader.releaseLock(),
              get closed() {
                return reader.closed
              },
            }
          },
        },
      }
    }
  })
}

/** The newest recorded blob out of ESCAPECRAFT's IndexedDB, as bytes. */
async function storedTakeBytes(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          getAll.onerror = () => reject(new Error('Failed to read videos store'))
          getAll.onsuccess = async () => {
            const records = getAll.result as Array<{ blob: Blob }>
            if (records.length === 0) return reject(new Error('No recordings stored'))
            const bytes = new Uint8Array(await records[0].blob.arrayBuffer())
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
            resolve(btoa(binary))
          }
        }
      })
  )
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * Seek a fresh `<video>` over the stored take to each of `times` (seconds) in
 * turn; the first seek that does not land within 3 s, with the element's
 * state, or null when every one landed.
 */
async function firstWedgedSeek(page: Page, times: number[]) {
  return page.evaluate(
    async (targets) => {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          getAll.onsuccess = () => resolve((getAll.result as Array<{ blob: Blob }>)[0].blob)
          getAll.onerror = () => reject(new Error('Failed to read videos store'))
        }
      })
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      const url = URL.createObjectURL(blob)
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error('The stored take would not load in a <video>'))
          video.src = url
        })
        for (const target of targets) {
          const landed = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 3000)
            video.addEventListener('seeked', () => (clearTimeout(timer), resolve(true)), { once: true })
            video.currentTime = target
          })
          if (!landed) return { target, seeking: video.seeking, readyState: video.readyState }
        }
        return null
      } finally {
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
      }
    },
    times
  )
}

test.describe('ESCSUITE-417: a CRAFT take captured with jitter seeks every frame', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', "The WebCodecs recorder and the seek wedge are Chromium's")

  test('no frame shares a timecode, every key frame has a Cluster and a cue, and every seek lands', async ({ page }) => {
    test.setTimeout(120_000)
    const lines: string[] = []
    page.on('console', (message) => lines.push(message.text()))
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await forceKeyFrameCollisions(page)

    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')
    const screenSource = page.locator('[class*="sourceToggle"]').filter({ hasText: 'Screen' }).last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    // The take's length: six seconds, so five or six forced collisions.
    await page.waitForTimeout(6000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({ timeout: 30_000 })

    // The take really went the way this spec means it to: the WebCodecs
    // recorder, reading frames off the track, stamping in performance.now()
    // time, handed a key-frame collision on most of its seconds.
    expect(lines).toContain('Using MediaStreamTrackProcessor for frame capture')
    expect(lines).toContain('Video stamped in performance.now() time (no usable audio-context clock)')
    const jitter = await page.evaluate(() => (window as unknown as { __jitter: { pairs: number; keyedPairs: number } }).__jitter)
    expect(jitter.pairs, 'forced collisions').toBeGreaterThanOrEqual(4)
    expect(jitter.keyedPairs, 'forced collisions whose second frame was the key frame').toBe(jitter.pairs)

    const layout = readWebmLayout(await storedTakeBytes(page))
    expect(layout.videoBlocks.length).toBeGreaterThan(120)
    // Soft, so a failure here still goes on to say whether the seeks wedged.
    expect.soft(videoLayoutProblems(layout)).toEqual([])

    // Every frame, in order, in one element: a wedge is permanent, so the
    // first seek past a bad key frame and every one after it would hang.
    const wedge = await firstWedgedSeek(
      page,
      layout.videoBlocks.map((block) => block.time / 1000)
    )
    expect(wedge, 'a seek never landed').toBeNull()
  })
})
