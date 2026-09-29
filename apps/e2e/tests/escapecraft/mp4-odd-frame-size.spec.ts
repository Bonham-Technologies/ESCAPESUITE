import { test, expect } from '@playwright/test'

/**
 * ESCSUITE-136: an H.264 encoder refuses an odd-sized frame outright — the
 * reason `convertToMP4` (`apps/craft/src/core/converter.ts`) rounds a
 * recording's width and height down to the nearest even number, via
 * `encodeWidth` / `encodeHeight`, before it ever configures one.
 *
 * Pinned here, against the real browser API, so the rounding cannot later be
 * deleted as looking cosmetic: `probeMP4Support()` — and this suite's own
 * `canConvertToMp4()` (`utils/webcodecs.ts`) — only ever ask about a
 * representative 1280x720, so nothing else in the suite would notice if a
 * *specific recording's* odd size regressed. A composited PiP take on a
 * display wider than 1280 whose scaled height lands odd (a stock 14"/16"
 * MacBook Pro at its default resolution, per `compositor.ts`'s own
 * arithmetic — see the finding) is exactly such a recording, and its MP4
 * download must not depend on this ever being re-verified by hand.
 *
 * Needs no recording and no media devices — the only thing under test is
 * what the browser's own WebCodecs implementation answers — so this is
 * deliberately its own file rather than a case tacked onto
 * `mp4-download.spec.ts`.
 */

const CRAFT_URL = 'http://localhost:5174'

test.describe('H.264 encoder support for odd frame sizes (ESCSUITE-136)', () => {
  test('refuses an odd height and an odd width, and accepts the same sizes rounded down to even', async ({
    page,
  }) => {
    await page.goto(CRAFT_URL)

    const results = await page.evaluate(async () => {
      if (typeof VideoEncoder === 'undefined') return null

      const ask = (width: number, height: number) =>
        VideoEncoder.isConfigSupported({
          codec: 'avc1.640028',
          width,
          height,
          bitrate: 5_000_000,
          framerate: 30,
        }).then((r) => r.supported)

      return {
        // 1280x831: the compositor's own scaled canvas on a 14" MacBook Pro
        // at its default 1512x982 resolution — see the finding's table.
        oddHeight: await ask(1280, 831),
        oddWidth: await ask(1279, 719),
        evenRounded: await ask(1280, 830),
        plain720p: await ask(1280, 720),
      }
    })

    test.skip(results === null, 'This browser has no WebCodecs VideoEncoder')

    expect(results!.oddHeight).toBe(false)
    expect(results!.oddWidth).toBe(false)
    expect(results!.evenRounded).toBe(true)
    expect(results!.plain720p).toBe(true)
  })
})
