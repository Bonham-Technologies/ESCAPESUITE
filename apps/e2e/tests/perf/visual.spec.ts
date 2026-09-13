import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { SCENE_RESOLUTION_LABEL, loadPerfScene, type SceneProject } from '../../utils/perf'

/**
 * Pixel guard for the preview, alongside the benchmarks it protects.
 *
 * The performance work on the preview changes *how* a frame is rasterised —
 * what size the backing store is, what transform the context carries — while
 * every draw call keeps its arguments in project space. The unit suites assert
 * the calls; this asserts the result: the composited frame still looks the same
 * to a camera pointed at the element.
 *
 * Why here and not in the ESCAPEARTIST suite CI runs: a screenshot baseline is
 * per-platform, and the one committed beside this file was taken on the
 * machine the benchmarks are run on. Under `tests/perf/` it runs when someone
 * runs the benchmarks — the moment the comparison is wanted — and never turns
 * a Linux CI runner red for having different font rasterisation.
 *
 * The tolerance is real: the frame is composited at a different raster size, so
 * every edge in it is resampled differently. `maxDiffPixelRatio` allows 2% of
 * pixels to differ; a composition that moved, cropped or dropped anything moves
 * far more than that.
 */
/** The blur the guard below puts on the scene's shape overlay, in project pixels. */
const BLUR_PROJECT_PX = 12

test.describe('preview pixels', () => {
  test.skip(
    SCENE_RESOLUTION_LABEL !== '1280x720',
    'the committed baseline is the default 1280x720 scene'
  )

  test('composites the scene the same way at 3s', async ({ page }, testInfo) => {
    // The baseline PNG is platform-specific (Playwright suffixes it with the
    // browser and OS). It was captured on macOS; a runner without a baseline
    // for its own platform must not fail the informational perf job — and it
    // must not silently write one either. Skip until a baseline for that
    // platform is committed (generate it from a CI artifact, never locally).
    const baseline = testInfo.snapshotPath('preview-720p-3s.png')
    test.skip(!existsSync(baseline), `no screenshot baseline for this platform: ${baseline}`)

    await loadPerfScene(page)

    // Home, then three one-second steps: an exact 3.000s playhead, with a
    // full-frame V1 clip, the V2 picture-in-picture, and both overlays live —
    // and far from any transition boundary, so no float wobble can flip which
    // branch composites the frame.
    await page.getByTitle('Go to start (Home)').click()
    for (let step = 0; step < 3; step++) {
      await page.getByTitle('Step forward (→)').click()
    }

    // The scrub seeks every live source and redraws when the seeks report back.
    // Wait for the frame to settle rather than racing the second draw.
    await page.waitForTimeout(1500)

    // The preview is the first canvas in the document (App renders it above the
    // timeline's waveforms).
    await expect(page.locator('canvas').first()).toHaveScreenshot('preview-720p-3s.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('blurs an overlay by the width the project asks for', async ({ page }) => {
    // Blur is the one thing a scale transform does not carry: `ctx.filter`
    // lengths are pixels of the output bitmap, and the current transform does
    // not touch them (the same filter under a halved transform blurs across
    // exactly as many device pixels). Rasterising at display size therefore has
    // to ask for a project-space blur in the device pixels it currently covers.
    //
    // A screenshot cannot see this: the benchmark scene's only blur is on clips
    // of solid red, and even with a blur put on the blue shape, a 3.4x-too-wide
    // blur on a 100px box moves 930 of 81320 pixels — under any tolerance that
    // survives resampling. So this measures the blur itself: how far the edge
    // between the shape and the frame takes to cross, converted back into
    // project pixels. That number is what the project asked for, whatever size
    // the preview happens to rasterise at.
    await loadPerfScene(page, (project: SceneProject) => {
      for (const clip of project.timeline.clips as { shapeData?: unknown; effects?: unknown }[]) {
        if (clip.shapeData) clip.effects = { blur: BLUR_PROJECT_PX }
      }
      return project
    })

    await page.getByTitle('Go to start (Home)').click()
    await page.waitForTimeout(1500)

    const band = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no preview canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no preview context')

      // The shape overlay is a blue rectangle in the upper left of a red frame.
      // Scan every row of that quadrant and count the pixels that are neither:
      // the blur band is the only place the two colours mix.
      const { data } = ctx.getImageData(0, 0, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2))
      let mixed = 0
      let blue = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        const isRed = r > 200 && g < 60 && b < 60
        const isBlue = b > 180 && r < 140
        if (isBlue) blue++
        else if (!isRed) mixed++
      }
      return { mixed, blue, rasterWidth: canvas.width }
    })

    // Back into project pixels: the band is an area, so it scales with k^2.
    const scale = band.rasterWidth / 1280
    const inProjectPixels = band.mixed / (scale * scale)

    // Measured on this scene: ~21000 project pixels of band for a 12px blur —
    // the same number whether the preview rasterises 1:1 or at a third of the
    // size, which is the whole point — against ~56000 when the radius is handed
    // over unscaled. The bounds sit either side of that gap with room for a
    // different rasteriser, and `blue` catches the degenerate case of a shape
    // blurred so far that nothing of it is left to measure.
    expect(band.blue).toBeGreaterThan(0)
    expect(inProjectPixels).toBeGreaterThan(8_000)
    expect(inProjectPixels).toBeLessThan(35_000)
  })
})
