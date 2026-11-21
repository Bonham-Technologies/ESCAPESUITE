// ESCSUITE-284 / ESCSUITE-503: Firefox's VP9 and VP8 `VideoEncoder`s convert a
// canvas-built frame with the BT.601 matrix but report
// `decoderConfig.colorSpace.matrix: 'bt709'`. ARTIST's WebM export and CRAFT's
// WebCodecs recorder both correct that exact report, in Firefox only. The
// relabel tests moved here, unchanged, from ARTIST's `vpxColorLabel.test.ts`
// when the helper moved to this package.
import { describe, it, expect } from 'vitest'
import { isFirefoxEngine, relabelFirefoxVpxMeta } from './firefoxVpxColour'

/** What Firefox 155 reports for both VP9 and VP8 (measured 2026-10-11). */
const FIREFOX_REPORT: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
}

const metaWith = (codec: string, colorSpace?: VideoColorSpaceInit): EncodedVideoChunkMetadata => ({
  decoderConfig: { codec, codedWidth: 1920, codedHeight: 1080, ...(colorSpace ? { colorSpace } : {}) },
})

describe('isFirefoxEngine', () => {
  it('is true for a Firefox user agent, on any platform', () => {
    expect(isFirefoxEngine({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0' })).toBe(true)
    expect(
      isFirefoxEngine({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0' })
    ).toBe(true)
  })

  it('needs both the Gecko/ and the Firefox/ token', () => {
    expect(isFirefoxEngine({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101' })).toBe(false)
    expect(isFirefoxEngine({ userAgent: 'Mozilla/5.0 Firefox/159.0' })).toBe(false)
  })

  it('is false for Chromium, Safari and no navigator at all', () => {
    expect(
      isFirefoxEngine({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      })
    ).toBe(false)
    expect(
      isFirefoxEngine({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15',
      })
    ).toBe(false)
    expect(isFirefoxEngine(undefined)).toBe(false)
  })
})

describe('relabelFirefoxVpxMeta', () => {
  it('relabels the matrix BT.601 (smpte170m) and leaves primaries, transfer and range alone', () => {
    const meta = metaWith('vp09.00.10.08', FIREFOX_REPORT)
    expect(relabelFirefoxVpxMeta(meta)?.decoderConfig?.colorSpace).toEqual({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'smpte170m',
      fullRange: false,
    })
  })

  it('keeps the rest of the decoder configuration and does not mutate what the encoder handed over', () => {
    const meta = metaWith('vp8', FIREFOX_REPORT)
    const out = relabelFirefoxVpxMeta(meta)
    expect(out?.decoderConfig).toMatchObject({ codec: 'vp8', codedWidth: 1920, codedHeight: 1080 })
    expect(meta.decoderConfig?.colorSpace?.matrix).toBe('bt709')
    expect(out).not.toBe(meta)
  })

  it('passes a chunk with no decoder configuration through untouched (every delta chunk)', () => {
    const delta: EncodedVideoChunkMetadata = {}
    expect(relabelFirefoxVpxMeta(delta)).toBe(delta)
    expect(relabelFirefoxVpxMeta(undefined)).toBeUndefined()
  })

  it('leaves any other report alone: only the measured mislabel is corrected', () => {
    const corrected = metaWith('vp8', { ...FIREFOX_REPORT, matrix: 'smpte170m' })
    const unlabelled = metaWith('vp8')
    expect(relabelFirefoxVpxMeta(corrected)).toBe(corrected)
    expect(relabelFirefoxVpxMeta(unlabelled)).toBe(unlabelled)
  })

  // Review M1: the gate is the whole measured report, not its matrix alone. A
  // Firefox that fixes its encoder the way Chromium works today — converting
  // with BT.709 and reporting sRGB transfer at full range — changes its report
  // and so falls out of the gate on its own instead of being relabelled wrong.
  it('passes the Chromium-shaped report through untouched (BT.709 matrix, sRGB transfer, full range)', () => {
    const chromiumShaped = metaWith('vp09.00.10.08', {
      primaries: 'bt709',
      transfer: 'iec61966-2-1',
      matrix: 'bt709',
      fullRange: true,
    })
    expect(relabelFirefoxVpxMeta(chromiumShaped)).toBe(chromiumShaped)
  })

  it.each([
    ['primaries', { primaries: 'smpte170m' }],
    ['transfer', { transfer: 'iec61966-2-1' }],
    ['range', { fullRange: true }],
    ['range left unreported', { fullRange: undefined }],
  ] as const)('passes a report that differs from the measured one only in its %s through untouched', (_, change) => {
    const meta = metaWith('vp09.00.10.08', { ...FIREFOX_REPORT, ...change })
    expect(relabelFirefoxVpxMeta(meta)).toBe(meta)
  })
})
