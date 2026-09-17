import type { Page } from '@playwright/test'

/**
 * Whether the page can convert to MP4 — the same four globals ESCAPECRAFT's
 * `isMP4ConversionSupported()` (`apps/craft/src/core/converter.ts`) checks.
 *
 * One copy, because the question belongs to the app rather than to a browser
 * name: WebCodecs has been arriving outside Chromium, so a spec that skipped on
 * `browserName` would run the "disabled with a reason" assertions against a
 * browser that can in fact convert. Note that this, like the app's own check,
 * is a *presence* check and not a codec probe — a browser with WebCodecs but no
 * H.264 encoder answers true here and fails later, at `configure()`.
 */
export async function hasWebCodecs(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof AudioEncoder !== 'undefined' &&
      typeof AudioContext !== 'undefined'
  )
}
