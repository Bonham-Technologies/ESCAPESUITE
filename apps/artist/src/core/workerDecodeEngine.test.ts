// ESCSUITE-254 fix round 1, B1: the decode worker is admitted only in an
// engine whose worker output was measured against that engine's own <video>
// — Chromium (0.045 / 0.268 / 255 at the parity frames) and Firefox
// (0.336 / 0.920, eight colour and size variants exact). Everything else,
// WebKit included (4.46-17.45/255 apart), stays on <video>, and so does the
// next engine nobody has measured: admitting one is ESCSUITE-262.
import { describe, it, expect } from 'vitest'
import { isFirefoxEngine, isMeasuredFrameRateEngine, isMeasuredWorkerDecodeEngine } from './workerDecodeEngine'

const UA = {
  chromium:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15',
  jsdom: 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
}

describe('isMeasuredWorkerDecodeEngine', () => {
  it('admits a Chromium engine, by its userAgentData brand', () => {
    expect(
      isMeasuredWorkerDecodeEngine({
        userAgent: UA.chromium,
        userAgentData: { brands: [{ brand: 'Not=A?Brand' }, { brand: 'HeadlessChrome' }, { brand: 'Chromium' }] },
      })
    ).toBe(true)
  })

  it('does not take a Chromium-looking user agent string for the brand', () => {
    expect(isMeasuredWorkerDecodeEngine({ userAgent: UA.chromium })).toBe(false)
    expect(isMeasuredWorkerDecodeEngine({ userAgent: UA.chromium, userAgentData: { brands: [{ brand: 'Google Chrome' }] } })).toBe(false)
  })

  it('admits Firefox, by its Gecko/ and Firefox/ tokens', () => {
    expect(isMeasuredWorkerDecodeEngine({ userAgent: UA.firefox })).toBe(true)
  })

  it('refuses WebKit', () => {
    expect(isMeasuredWorkerDecodeEngine({ userAgent: UA.safari })).toBe(false)
  })

  it('refuses an engine nobody has measured (jsdom here)', () => {
    expect(isMeasuredWorkerDecodeEngine({ userAgent: UA.jsdom })).toBe(false)
  })

  it('refuses when there is no navigator at all', () => {
    expect(isMeasuredWorkerDecodeEngine(undefined)).toBe(false)
  })
})

// ESCSUITE-284: the same Firefox test, exported for the WebM exporter's colour
// relabel, which corrects a mislabel measured on Firefox 155 alone.
describe('isFirefoxEngine', () => {
  it('recognises Firefox by its Gecko/ and Firefox/ tokens', () => {
    expect(isFirefoxEngine({ userAgent: UA.firefox })).toBe(true)
  })

  it('needs both tokens', () => {
    expect(isFirefoxEngine({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101' })).toBe(false)
  })

  it('is false when there is no navigator at all', () => {
    expect(isFirefoxEngine(undefined)).toBe(false)
  })

  it('is false for Chromium, WebKit and jsdom', () => {
    expect(
      isFirefoxEngine({ userAgent: UA.chromium, userAgentData: { brands: [{ brand: 'Chromium' }] } })
    ).toBe(false)
    expect(isFirefoxEngine({ userAgent: UA.safari })).toBe(false)
    expect(isFirefoxEngine({ userAgent: UA.jsdom })).toBe(false)
  })
})

// ESCSUITE-327: the frame-rate probe's allow-list is narrower than the worker's.
// The worker's Firefox parity was measured against Firefox's own <video>; the
// probe's rVFC metadata was never characterised there (a 120 fps MP4 read
// 124.62, a 30 fps WebM 34.33, both stored 'measured').
describe('isMeasuredFrameRateEngine', () => {
  const chromium = {
    userAgent: UA.chromium,
    userAgentData: { brands: [{ brand: 'Not=A?Brand' }, { brand: 'Chromium' }] },
  }

  it('admits a Chromium engine, by its userAgentData brand', () => {
    expect(isMeasuredFrameRateEngine(chromium)).toBe(true)
  })

  it('refuses Firefox, which the worker predicate admits', () => {
    const firefox = { userAgent: UA.firefox }
    expect(isMeasuredWorkerDecodeEngine(firefox)).toBe(true)
    expect(isMeasuredFrameRateEngine(firefox)).toBe(false)
    expect(isMeasuredWorkerDecodeEngine(chromium)).toBe(isMeasuredFrameRateEngine(chromium))
  })

  it('refuses WebKit, an unmeasured engine and a Chromium-looking user agent string', () => {
    expect(isMeasuredFrameRateEngine({ userAgent: UA.safari })).toBe(false)
    expect(isMeasuredFrameRateEngine({ userAgent: UA.jsdom })).toBe(false)
    expect(isMeasuredFrameRateEngine({ userAgent: UA.chromium })).toBe(false)
  })

  it('refuses when there is no navigator at all', () => {
    expect(isMeasuredFrameRateEngine(undefined)).toBe(false)
  })
})
