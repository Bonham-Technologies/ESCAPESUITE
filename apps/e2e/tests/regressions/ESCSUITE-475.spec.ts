import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog, exportButtonName } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-475: Zoom to region. With a video clip selected and the playhead
 * where the zoom should start, "Zoom to region" opens a box on the preview and
 * a form under it; Apply writes x, y, scaleX and scaleY keyframes that ease in
 * to the box, hold, and ease back out, as one undo step.
 *
 * The source, `fixtures/zoom-region/quadrants.webm`, is four flat colours, one
 * per quarter of a 640x360 frame (red, green / blue, white). The region set
 * here, x 240 y 0, 320 wide, straddles the red-green border in the top half,
 * so at the hold's midpoint the exported frame must be red on its left half
 * and green on its right, top to bottom, with the border at x 160 — the region
 * scaled up twice into the frame. Before and after the zoom the four
 * quadrants are back where they were.
 *
 * The region is set with the four number fields, the keyboard and
 * screen-reader way in; the second case drags a box on the preview instead.
 *
 * WebKit's Linux port paints a `<video>` outside the document black, so the
 * in-page WebM export there has no picture to check (see ESCSUITE-454): the
 * export case skips its export half in WebKit where the probe sees that, after
 * the tool and undo/redo have been checked, and fails rather than skips
 * anywhere else.
 */

const FIXTURE = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/zoom-region/quadrants.webm')
const WIDTH = 640
const HEIGHT = 360
const CLIP_SECONDS = 6

type Colour = 'red' | 'green' | 'blue' | 'white' | 'black'
const COLOURS: Record<Colour, [number, number, number]> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  white: [255, 255, 255],
  black: [0, 0, 0],
}
/** The fixture's own layout. */
const QUADRANTS: [number, number, Colour][] = [
  [160, 90, 'red'],
  [480, 90, 'green'],
  [160, 270, 'blue'],
  [480, 270, 'white'],
]
/** The region x 240 y 0 320x180 filling the frame: red left of x 160, green right of it. */
const ZOOMED: [number, number, Colour][] = [
  [40, 20, 'red'],
  [140, 180, 'red'],
  [40, 340, 'red'],
  [180, 20, 'green'],
  [600, 180, 'green'],
  [600, 340, 'green'],
]

interface ProjectShape {
  resolution: { width: number; height: number }
  timeline: {
    clips: { id: string; animation?: { keyframes: Record<string, { time: number; value: number }[] | undefined> } }[]
  }
}

/** The editor's project, through `GET_STATE`. */
function getProject(page: Page): Promise<ProjectShape> {
  return page.evaluate(
    () =>
      new Promise<ProjectShape>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GET_STATE never answered')), 15_000)
        const onMessage = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (detail?.type !== 'STATE') return
          clearTimeout(timer)
          window.removeEventListener('videoeditor:message', onMessage)
          resolve(detail.payload.project)
        }
        window.addEventListener('videoeditor:message', onMessage)
        window.postMessage({ type: 'GET_STATE' }, '*')
      })
  )
}

/** The one clip's x / y / scaleX / scaleY keyframe times, or [] for none. */
async function zoomKeyframes(page: Page): Promise<Record<string, number[]>> {
  const { keyframes = {} } = (await getProject(page)).timeline.clips[0].animation ?? {}
  return Object.fromEntries(['x', 'y', 'scaleX', 'scaleY'].map((p) => [p, (keyframes[p] ?? []).map((kf) => kf.time)]))
}

/**
 * Import the fixture into a project of its own size, and select its clip.
 * `copies: 2` puts a second copy of the clip right after the first
 * (ESCSUITE-500 needs another clip to select).
 */
async function openFixture(page: Page, copies: 1 | 2 = 1): Promise<void> {
  await page.route('https://va.vercel-scripts.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  )
  await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, FIXTURE)
  const project = await getProject(page)
  project.resolution = { width: WIDTH, height: HEIGHT }
  if (copies === 2) {
    const first = project.timeline.clips[0] as ProjectShape['timeline']['clips'][number] & { timelinePosition: number }
    project.timeline.clips.push({ ...first, id: `${first.id}-copy`, timelinePosition: first.timelinePosition + CLIP_SECONDS } as typeof first)
  }
  await page.evaluate((payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'), project)
  await expect(page.getByText(copies === 2 ? /^2 clips/ : /^1 clip/).first()).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-clip-id]').first().click()
}

/** Move the playhead to about `seconds` with a click on the ruler. */
async function seek(page: Page, seconds: number): Promise<void> {
  const clip = (await page.locator('[data-clip-id]').first().boundingBox())!
  const ruler = (await page.getByRole('group', { name: 'Timeline ruler' }).boundingBox())!
  await page.mouse.click(clip.x + (seconds / CLIP_SECONDS) * clip.width, ruler.y + ruler.height / 2)
}

async function openZoomToRegion(page: Page, by: 'mouse' | 'keyboard' = 'mouse'): Promise<void> {
  const button = page.getByRole('button', { name: 'Zoom to region' })
  if (by === 'keyboard') {
    await button.focus()
    await page.keyboard.press('Enter')
  } else {
    await button.click()
  }
  await expect(page.getByRole('heading', { name: 'Zoom to region' })).toBeVisible()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Type a number into one of the form's fields and commit it. */
async function setField(page: Page, name: string, value: number): Promise<void> {
  const field = page.getByLabel(name, { exact: true })
  await field.fill(String(value))
  await field.press('Enter')
}

async function regionFields(page: Page): Promise<number[]> {
  const names = ['Region X', 'Region Y', 'Region width', 'Region height']
  return Promise.all(names.map(async (n) => Number(await page.getByLabel(n, { exact: true }).inputValue())))
}

/** Export the timeline as a WebM at project resolution and return its bytes. */
async function exportWebm(page: Page): Promise<Buffer> {
  await page.getByRole('radio', { name: /WebM/ }).check()
  await page.locator('select').filter({ has: page.locator('option[value="480p"]') }).selectOption('project')
  const download = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: exportButtonName('webm') }).last().click()
  return readFileSync(await (await download).path())
}

/**
 * Decode `bytes` (a WebM) in a `<video>` outside the document and name the
 * colour at each of `points` in the frame at each of `times`, nearest of the
 * fixture's four and black. Each read waits for the seek's frame callback as
 * well as 'seeked' (ESCSUITE-437).
 */
async function readColours(
  page: Page,
  bytes: Buffer,
  times: number[],
  points: [number, number][]
): Promise<Colour[][]> {
  return page.evaluate(
    async ({ base64, times, points, colours }) => {
      const binary = atob(base64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([array], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.src = url
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('the WebM did not load'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const result: string[][] = []
      for (const time of times) {
        const presented = new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 2_000)
          video.requestVideoFrameCallback(() => {
            clearTimeout(fallback)
            resolve()
          })
        })
        const seeked = new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
        })
        video.currentTime = time
        await seeked
        await presented
        ctx.drawImage(video, 0, 0)
        result.push(
          points.map(([x, y]) => {
            const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
            let best = ''
            let bestDistance = Infinity
            for (const [name, [cr, cg, cb]] of Object.entries(colours)) {
              const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
              if (distance < bestDistance) {
                best = name
                bestDistance = distance
              }
            }
            return best
          })
        )
      }
      URL.revokeObjectURL(url)
      return result
    },
    { base64: bytes.toString('base64'), times, points, colours: COLOURS }
  ) as Promise<Colour[][]>
}

test.describe('ESCSUITE-475: Zoom to region', () => {
  test('a region set with the number fields is zoomed into in the exported WebM, as one undo step', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    await openFixture(page)

    // Read first, judged only before the export: the tool, the keyframes and
    // undo/redo below are checked in every engine, WebKit's included.
    const probe = await readColours(page, readFileSync(FIXTURE), [1], QUADRANTS.map(([x, y]) => [x, y]))
    const blackDetachedVideo = browserName === 'webkit' && probe[0].every((c) => c === 'black')
    if (!blackDetachedVideo) {
      expect(probe[0], 'the fixture read by the detached-element reader').toEqual(QUADRANTS.map(([, , c]) => c))
    }

    await seek(page, 1)
    await openZoomToRegion(page, 'keyboard')
    // Opened from the keyboard, focus lands on the form's first field.
    await expect(page.getByLabel('Region X', { exact: true })).toBeFocused()
    await setField(page, 'Region width', 320)
    await setField(page, 'Region X', 240)
    await setField(page, 'Region Y', 0)
    expect(await regionFields(page), 'the box keeps the output aspect ratio').toEqual([240, 0, 320, 180])
    await page.getByRole('button', { name: 'Apply zoom' }).click()
    await expect(page.getByRole('heading', { name: 'Zoom to region' })).toBeHidden()

    const written = await zoomKeyframes(page)
    const [start, , , end] = written.scaleX
    expect(written.scaleX, 'ease in, hold, ease out').toHaveLength(4)
    expect(start).toBeGreaterThan(0.8)
    expect(end - start).toBeCloseTo(4, 6) // 0.5 s in, 3 s hold, 0.5 s out
    for (const property of ['x', 'y', 'scaleY']) expect(written[property]).toEqual(written.scaleX)

    await test.step('one undo removes the whole zoom, one redo restores it', async () => {
      await page.locator('body').click({ position: { x: 1, y: 1 } })
      await page.keyboard.press('Control+z')
      await expect.poll(() => zoomKeyframes(page)).toEqual({ x: [], y: [], scaleX: [], scaleY: [] })
      await page.keyboard.press('Control+Shift+z')
      await expect.poll(() => zoomKeyframes(page)).toEqual(written)
    })

    test.skip(
      blackDetachedVideo,
      'This engine paints a <video> outside the document black (WebKit’s Linux port does), so the in-page export draws no picture to check'
    )
    await openExportDialog(page)
    await openExportAdvancedOptions(page)
    test.skip(!(await page.getByRole('radio', { name: /WebM/ }).isEnabled()), 'This browser cannot export WebM')
    const bytes = await exportWebm(page)

    const mid = (start + end) / 2
    const [before, during, after] = await readColours(
      page,
      bytes,
      [start / 2, mid, (end + CLIP_SECONDS) / 2],
      [...QUADRANTS, ...ZOOMED].map(([x, y]) => [x, y])
    )
    const unzoomed = QUADRANTS.map(([, , c]) => c)
    expect(before.slice(0, 4), 'before the zoom, the four quadrants').toEqual(unzoomed)
    expect(during.slice(4), 'at the hold midpoint, the region scaled up to fill the frame').toEqual(ZOOMED.map(([, , c]) => c))
    expect(after.slice(0, 4), 'after the zoom, the four quadrants again').toEqual(unzoomed)
  })

  test('a box dragged on the preview takes the output aspect ratio and stays on the picture', async ({ page }) => {
    await openFixture(page)
    await seek(page, 1)
    await openZoomToRegion(page)

    // The form opening under the picture shrinks it a frame or two later (the
    // canvas' ResizeObserver): measure the picture once it has stopped moving.
    const picker = page.getByTestId('zoom-region-picker')
    let picture = (await picker.boundingBox())!
    await expect
      .poll(async () => {
        const next = (await picker.boundingBox())!
        const settled = JSON.stringify(next) === JSON.stringify(picture)
        picture = next
        return settled
      })
      .toBe(true)
    const scale = picture.width / WIDTH
    const at = (x: number, y: number) => [picture.x + x * scale, picture.y + y * scale] as const

    // From project (400, 40), 200 across and 40 down: a 200x112.5 box.
    await page.mouse.move(...at(400, 40))
    await page.mouse.down()
    await page.mouse.move(...at(500, 60), { steps: 4 })
    await page.mouse.move(...at(600, 80), { steps: 4 })
    await page.mouse.up()
    const [x, y, width, height] = await regionFields(page)
    // A pointer lands on whole CSS pixels, and the picture is only a third of
    // the project's size here: allow one CSS pixel, in project pixels, per end.
    const cssPixel = 1 / scale
    expect(Math.abs(x - 400)).toBeLessThanOrEqual(cssPixel + 0.5)
    expect(Math.abs(y - 40)).toBeLessThanOrEqual(cssPixel + 0.5)
    expect(Math.abs(width - 200)).toBeLessThanOrEqual(2 * cssPixel + 0.5)
    expect(width / height).toBeCloseTo(16 / 9, 1)

    // Dragged past the picture's right edge: moved back on, not cut short.
    await page.mouse.move(...at(500, 200))
    await page.mouse.down()
    await page.mouse.move(...at(700, 260), { steps: 8 })
    await page.mouse.up()
    const [x2, , width2] = await regionFields(page)
    expect(x2 + width2).toBeLessThanOrEqual(WIDTH + 0.01)

    // Escape leaves the tool and keeps the clip selected, writing nothing.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Zoom to region' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Zoom to region' })).toHaveAttribute('aria-pressed', 'false')
    expect(await zoomKeyframes(page)).toEqual({ x: [], y: [], scaleX: [], scaleY: [] })
  })

  // ESCSUITE-500: leaving the clip closes the tool for good. Before the fix the
  // latch stayed set while another clip (or none) was selected, so selecting
  // the first clip again reopened the box and the form unasked. Crop mode
  // (the same kind of latch) is checked the same way.
  test('selecting another clip and then the first one again shows the tool closed', async ({ page }) => {
    await openFixture(page, 2)
    const clips = page.locator('[data-clip-id]')
    const zoomButton = page.getByRole('button', { name: 'Zoom to region' })
    const zoomHeading = page.getByRole('heading', { name: 'Zoom to region' })

    await seek(page, 1)
    await openZoomToRegion(page)
    await clips.nth(1).click()
    await expect(zoomHeading).toBeHidden()
    await clips.nth(0).click()
    await expect(zoomButton).toHaveAttribute('aria-pressed', 'false')
    await expect(zoomHeading).toBeHidden()
    await expect(page.getByTestId('zoom-region-picker')).toHaveCount(0)

    const cropButton = page.getByRole('button', { name: 'Crop on canvas' })
    await cropButton.click()
    await expect(cropButton).toHaveAttribute('aria-pressed', 'true')
    await clips.nth(1).click()
    await clips.nth(0).click()
    await expect(cropButton).toHaveAttribute('aria-pressed', 'false')
  })
})
