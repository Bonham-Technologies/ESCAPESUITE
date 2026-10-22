import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserContext, Locator, Page, expect } from '@playwright/test'

/**
 * Media-health assertions (ESCSUITE-348): is the media on screen actually
 * alive, not just present?
 *
 * A visible waveform `<canvas>` with nothing drawn on it, or a preview canvas
 * that stopped repainting, passes every "is it visible" check. These helpers
 * read the pixels and the media elements instead, so a missing waveform, a
 * frozen preview or a silent playback fails the test that hits it.
 *
 * Each helper is pinned to fail on its own broken case by
 * `tests/media-health/self-test.spec.ts`; a helper that always passes can't
 * land.
 */

const fixturesDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '../fixtures/av')

/**
 * 5 s, 640×360 testsrc2 at 30 fps (every frame differs) with a 440 Hz tone at
 * 0–2 s, digital silence at 2–3 s and the tone again at 3–5 s. VP9/Opus, so
 * every Playwright Chromium decodes it, the container's included.
 * `fixtures/av/make-fixture.sh` regenerates it.
 */
export const AV_FIXTURE_WEBM = resolvePath(fixturesDir, 'tone-gap.webm')

/**
 * {@link AV_FIXTURE_WEBM}'s H.264/AAC twin: same picture, same audio. CI's
 * Chromium decodes it; the cloud container's headless shell does not.
 */
export const AV_FIXTURE_MP4 = resolvePath(fixturesDir, 'tone-gap.mp4')

/** The fixtures' layout, in seconds of source time. */
export const AV_FIXTURE_TIMING = {
  duration: 5,
  silence: { start: 2, end: 3 },
} as const

/**
 * The fixtures' silent window as fractions of an *untrimmed* clip's width,
 * the shape {@link expectWaveformDrawn}'s `silence` option takes.
 */
export const AV_FIXTURE_SILENCE = {
  start: AV_FIXTURE_TIMING.silence.start / AV_FIXTURE_TIMING.duration,
  end: AV_FIXTURE_TIMING.silence.end / AV_FIXTURE_TIMING.duration,
} as const

/** ARTIST's preview canvas: the only `<canvas>` that is not a timeline waveform. */
export function previewCanvas(page: Page): Locator {
  return page.locator('canvas:not([class*="waveform"])').first()
}

/**
 * A clip's waveform canvas. `clip` is the clip's element on the timeline
 * (`[data-clip-id]`), or omitted for the first clip that draws one.
 */
export function waveformCanvas(page: Page, clip?: Locator): Locator {
  return (clip ?? page.locator('[data-clip-id]').filter({ has: page.locator('canvas[class*="waveform"]') }).first())
    .locator('canvas[class*="waveform"]')
}

/**
 * Track the page's media elements, so {@link expectPreviewAlive} can read
 * them. ARTIST's preview `<video>`s are never attached to the document
 * (`components/Preview/usePreviewMedia.ts` makes them with `createElement`
 * and draws them onto the canvas), so nothing in the DOM finds them.
 *
 * Install it before the page loads: on the `context`, or on the `page`
 * before its `goto`.
 *
 * Every `<video>`/`<audio>` made with `document.createElement` lands on
 * `window.__mediaHealth.elements`. Each `<video>` also counts the frames it
 * presents, through `requestVideoFrameCallback`.
 */
export async function installMediaHealthProbe(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    type Probe = { elements: HTMLMediaElement[]; frames: WeakMap<HTMLMediaElement, number> }
    const w = window as unknown as { __mediaHealth?: Probe }
    if (w.__mediaHealth) return
    const probe: Probe = { elements: [], frames: new WeakMap() }
    w.__mediaHealth = probe

    const track = (el: HTMLMediaElement) => {
      probe.elements.push(el)
      probe.frames.set(el, 0)
      if (el instanceof HTMLVideoElement && 'requestVideoFrameCallback' in el) {
        const onFrame = () => {
          probe.frames.set(el, (probe.frames.get(el) ?? 0) + 1)
          el.requestVideoFrameCallback(onFrame)
        }
        el.requestVideoFrameCallback(onFrame)
      }
    }

    const original = Document.prototype.createElement
    Document.prototype.createElement = function (
      this: Document,
      tagName: string,
      options?: ElementCreationOptions
    ) {
      const el = original.call(this, tagName, options)
      if (el instanceof HTMLMediaElement) track(el)
      return el
    } as typeof Document.prototype.createElement
  })
}

interface MediaSnapshot {
  probeInstalled: boolean
  elements: Array<{
    paused: boolean
    muted: boolean
    volume: number
    currentTime: number
    presentedFrames: number
    /** Chromium's `webkitAudioDecodedByteCount`; null where the browser lacks it. */
    audioBytes: number | null
    hasSource: boolean
  }>
  /** The preview canvas, shrunk to 160×90 RGBA: enough to tell two frames apart. */
  canvas: number[] | null
}

function snapshot(page: Page): Promise<MediaSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __mediaHealth?: { elements: HTMLMediaElement[]; frames: WeakMap<HTMLMediaElement, number> }
    }
    const probe = w.__mediaHealth
    const elements = (probe?.elements ?? []).map((el) => ({
      paused: el.paused,
      muted: el.muted,
      volume: el.volume,
      currentTime: el.currentTime,
      presentedFrames: probe!.frames.get(el) ?? 0,
      audioBytes:
        typeof (el as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount === 'number'
          ? (el as unknown as { webkitAudioDecodedByteCount: number }).webkitAudioDecodedByteCount
          : null,
      hasSource: !!el.currentSrc || !!el.src,
    }))

    const source = document.querySelector('canvas:not([class*="waveform"])') as HTMLCanvasElement | null
    let canvas: number[] | null = null
    if (source && source.width > 0 && source.height > 0) {
      const small = document.createElement('canvas')
      small.width = 160
      small.height = 90
      const ctx = small.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(source, 0, 0, small.width, small.height)
      canvas = Array.from(ctx.getImageData(0, 0, small.width, small.height).data)
    }
    return { probeInstalled: !!probe, elements, canvas }
  })
}

/**
 * The share of cells two shrunk canvases disagree on: a cell differs when any
 * colour channel moved by more than 24 of 255, above scaling noise.
 */
function canvasDistance(a: number[] | null, b: number[] | null): number {
  // A missing canvas on either side is no evidence of a new frame.
  if (!a || !b || a.length !== b.length) return 0
  let changed = 0
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > 24 ||
      Math.abs(a[i + 1] - b[i + 1]) > 24 ||
      Math.abs(a[i + 2] - b[i + 2]) > 24
    ) {
      changed++
    }
  }
  return changed / (a.length / 4)
}

/**
 * At or below this share of changed cells two preview frames count as the
 * same picture. The same frame drawn twice changes none; one 30 fps step of
 * the A/V fixtures' testsrc2 changed 1.2–1.6 % of them, measured
 * in a 1080p project in headless Chromium.
 */
const SAME_FRAME_DISTANCE = 0.002

/**
 * Fail unless the preview is playing: over `forMs`, a playing `<video>`'s
 * `currentTime` and presented-frame count both advance, the preview canvas
 * repaints, and the sound is live.
 *
 * "The audio graph is running" in ARTIST means the element itself: the
 * preview plays sound by unmuting the playing `<video>` (or `<audio>`), with
 * no Web Audio graph in between. So the sound check is an element that is
 * playing, unmuted, at a volume above zero, and, on Chromium, whose decoded
 * audio byte count grows.
 *
 * The caller starts playback; this only watches. Needs
 * {@link installMediaHealthProbe}.
 */
export async function expectPreviewAlive(
  page: Page,
  { forMs = 1000, audio = true }: { forMs?: number; audio?: boolean } = {}
): Promise<void> {
  const before = await snapshot(page)
  expect(before.probeInstalled, 'installMediaHealthProbe must run before the page loads').toBe(true)
  await page.waitForTimeout(forMs) // the observation window itself, not a wait for something
  const after = await snapshot(page)
  expect(before.canvas, 'the preview canvas is not on the page').not.toBeNull()
  expect(after.canvas, 'the preview canvas left the page while playing').not.toBeNull()

  const pairs = after.elements.map((el, i) => ({ before: before.elements[i], after: el }))
  const playing = pairs.filter((p) => p.before && p.after.hasSource && !p.after.paused)
  expect(playing.length, 'no preview media element is playing').toBeGreaterThan(0)

  const minAdvance = (forMs / 1000) * 0.4
  const advancing = playing.filter((p) => p.after.currentTime - p.before.currentTime >= minAdvance)
  expect(
    advancing.length,
    `no playing element's currentTime advanced by ${minAdvance.toFixed(2)} s in ${forMs} ms`
  ).toBeGreaterThan(0)

  // On the same element whose clock advanced: a paused element's seek also
  // presents a frame, so frames from any other element prove nothing.
  const presenting = advancing.filter((p) => p.after.presentedFrames - p.before.presentedFrames >= 2)
  expect(
    presenting.length,
    `the playing preview <video> presented no new frames in ${forMs} ms`
  ).toBeGreaterThan(0)

  expect(
    canvasDistance(before.canvas, after.canvas),
    `the preview canvas did not repaint in ${forMs} ms`
  ).toBeGreaterThan(SAME_FRAME_DISTANCE)

  if (audio) {
    const audible = advancing.filter((p) => !p.after.muted && p.after.volume > 0)
    expect(audible.length, 'no playing element is unmuted: the preview is silent').toBeGreaterThan(0)
    const decoding = audible.filter(
      (p) => p.after.audioBytes === null || p.after.audioBytes > (p.before.audioBytes ?? 0)
    )
    expect(decoding.length, `no audible element decoded any audio in ${forMs} ms`).toBeGreaterThan(0)
  }
}

/**
 * Fail unless `seek` makes the preview present a new frame within
 * `timeoutMs`: the canvas has to end on a different picture from the one
 * before the seek. The caller picks a target whose frame differs (any two
 * times of the A/V fixtures do).
 */
export async function expectPreviewFrameChangesOnSeek(
  page: Page,
  seek: () => Promise<void>,
  { timeoutMs = 3000 }: { timeoutMs?: number } = {}
): Promise<void> {
  const before = await snapshot(page)
  expect(before.canvas, 'the preview canvas is not on the page').not.toBeNull()
  await seek()
  await expect
    .poll(async () => canvasDistance(before.canvas, (await snapshot(page)).canvas), {
      message: `the preview showed no new frame within ${timeoutMs} ms of the seek`,
      timeout: timeoutMs,
    })
    .toBeGreaterThan(SAME_FRAME_DISTANCE)
}

/**
 * Fail unless a waveform canvas has something drawn on it and, when
 * `silence` is given, draws less in that window than outside it.
 *
 * `silence` is a window of the *clip*, as fractions of its width (0 = the
 * clip's left edge, 1 = its right edge); {@link AV_FIXTURE_SILENCE} is the
 * fixtures' for an untrimmed clip. The canvas may be windowed to the
 * visible part of a long clip, so its columns are mapped onto the clip's box
 * rather than assumed to span it. A margin of a tenth of the window's width
 * is left out on each side, so a bar straddling the edge counts for neither.
 *
 * Polled for `timeoutMs`, so a waveform still being computed is waited for.
 */
export async function expectWaveformDrawn(
  canvas: Locator,
  { silence, timeoutMs = 10_000 }: { silence?: { start: number; end: number }; timeoutMs?: number } = {}
): Promise<void> {
  await expect(canvas).toBeVisible({ timeout: timeoutMs })

  const measure = () =>
    canvas.evaluate(
      (el, window_) => {
        const c = el as HTMLCanvasElement
        if (c.width === 0 || c.height === 0) return { drawn: 0, silent: null, tone: null }
        const clip = c.closest('[data-clip-id]') ?? c.parentElement!
        const clipBox = clip.getBoundingClientRect()
        const box = c.getBoundingClientRect()
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        let drawn = 0
        let silentSum = 0
        let silentCols = 0
        let toneSum = 0
        let toneCols = 0
        const margin = window_ ? (window_.end - window_.start) / 10 : 0
        for (let x = 0; x < c.width; x++) {
          let column = 0
          for (let y = 0; y < c.height; y++) if (data[(y * c.width + x) * 4 + 3] > 0) column++
          drawn += column
          if (!window_) continue
          const at = (box.left + ((x + 0.5) / c.width) * box.width - clipBox.left) / clipBox.width
          if (at > window_.start + margin && at < window_.end - margin) {
            silentSum += column
            silentCols++
          } else if (at < window_.start - margin || at > window_.end + margin) {
            toneSum += column
            toneCols++
          }
        }
        return {
          drawn,
          silent: silentCols ? silentSum / silentCols : null,
          tone: toneCols ? toneSum / toneCols : null,
        }
      },
      silence ?? null
    )

  await expect
    .poll(async () => (await measure()).drawn, {
      message: 'the waveform canvas has nothing drawn on it',
      timeout: timeoutMs,
    })
    .toBeGreaterThan(0)

  if (silence) {
    const { silent, tone } = await measure()
    expect(silent, 'the silent window is not on the waveform canvas').not.toBeNull()
    expect(tone, 'no tone window is on the waveform canvas').not.toBeNull()
    // A silent column still draws its 1 px floor bar; a tone column at this
    // fixture's level fills well over half the canvas height.
    expect(silent!, 'the waveform draws as much in the silent window as in the tone').toBeLessThan(tone! / 3)
  }
}
