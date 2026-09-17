import type { Page } from '@playwright/test'

/**
 * Whether the page can convert a recording to MP4 — the same question
 * ESCAPECRAFT's own gate asks, in the same two parts.
 *
 * `probeMP4Support()` (`apps/craft/src/core/converter.ts`) checks the four
 * WebCodecs globals are there and then asks `VideoEncoder.isConfigSupported()`
 * about the exact H.264 configuration `convertToMP4` will configure. Presence
 * alone is not the question: a browser can have WebCodecs and no H.264
 * encoder, and it is the app's disabled-with-a-reason path that such a browser
 * must get.
 *
 * AAC is deliberately NOT part of this answer, for the same reason it does not
 * disable the button: `convertToMP4` drops the audio and writes a working
 * silent MP4 when there is no AAC encoder, so a browser in that state still
 * takes the enabled path — with a note saying the file will be silent.
 *
 * One copy, because the question belongs to the app rather than to a browser
 * name: WebCodecs has been arriving outside Chromium, so a spec that skipped on
 * `browserName` would run the "disabled with a reason" assertions against a
 * browser that can in fact convert.
 *
 * The configuration below is duplicated from `converter.ts` rather than
 * imported — it has to run inside the page — so it must be kept in step with
 * it; the unit test "asks about the same H.264 and AAC configuration the
 * conversion configures" pins the app's half.
 */
export async function canConvertToMp4(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (
      typeof VideoEncoder === 'undefined' ||
      typeof VideoFrame === 'undefined' ||
      typeof AudioEncoder === 'undefined' ||
      typeof AudioContext === 'undefined'
    ) {
      return false
    }

    try {
      const video = await VideoEncoder.isConfigSupported({
        codec: 'avc1.640028',
        width: 1280,
        height: 720,
        bitrate: 5_000_000,
        framerate: 30,
      })
      return Boolean(video.supported)
    } catch {
      return false
    }
  })
}
