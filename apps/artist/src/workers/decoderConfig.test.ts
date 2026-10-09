// ESCSUITE-254: the configuration the decode worker gives VideoDecoder, and
// the tracks it refuses so they keep the <video> path. Each rule is a
// measurement against Chromium's <video> element; see decoderConfig.ts.
import { describe, it, expect, vi } from 'vitest'
import { assumedColorSpace, decoderConfigFor, type OrientedDecoderConfig } from './decoderConfig'
import type { DemuxedVideo } from './mp4Demux'

function video(overrides: Partial<DemuxedVideo> = {}): DemuxedVideo {
  return {
    codec: 'avc1.64001f',
    codedWidth: 1280,
    codedHeight: 720,
    displayWidth: 1280,
    displayHeight: 720,
    description: new Uint8Array([1, 100, 0, 31]),
    rotation: 0,
    duration: 1,
    samples: [],
    keyframeCount: 1,
    ...overrides,
  }
}

/** User agents the ESCSUITE-254 parity measurement ran in (Playwright 1.63's browsers), and two it implies. */
const UA = {
  chromium:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15',
  /** Chrome on iOS is WebKit underneath. */
  chromeOnIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
}

/** A browser that supports everything and echoes back the members it implements. */
const echoes = vi.fn(async (config: OrientedDecoderConfig) => ({ supported: true, config }))

describe('assumedColorSpace', () => {
  it('is BT.601 below 720 lines and BT.709 from 720 up, as Chromium <video> assumes', () => {
    const rec601 = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false }
    const rec709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }
    expect(assumedColorSpace(120)).toEqual(rec601)
    expect(assumedColorSpace(718)).toEqual(rec601)
    expect(assumedColorSpace(720)).toEqual(rec709)
    expect(assumedColorSpace(2160)).toEqual(rec709)
  })
})

describe('decoderConfigFor', () => {
  it('configures the track as demuxed, with the colour space <video> would assume and no hardware requirement', async () => {
    const config = await decoderConfigFor(video({ codedHeight: 480, displayHeight: 480 }), echoes, false, UA.chromium)

    expect(config).toEqual({
      codec: 'avc1.64001f',
      codedWidth: 1280,
      codedHeight: 480,
      description: new Uint8Array([1, 100, 0, 31]),
      colorSpace: assumedColorSpace(480),
      hardwareAcceleration: 'no-preference',
    })
  })

  it('asks for a hardware decoder only when configured to', async () => {
    const config = await decoderConfigFor(video(), echoes, true, UA.chromium)

    expect(config.hardwareAcceleration).toBe('prefer-hardware')
  })

  it('accepts avc3 as well as avc1', async () => {
    await expect(decoderConfigFor(video({ codec: 'avc3.42e01e' }), echoes, false, UA.chromium)).resolves.toMatchObject({
      codec: 'avc3.42e01e',
    })
  })

  it('refuses every codec but H.264', async () => {
    for (const codec of ['hvc1.1.6.L93.B0', 'vp09.00.10.08', 'av01.0.04M.08']) {
      await expect(decoderConfigFor(video({ codec }), echoes, false, UA.chromium)).rejects.toThrow(
        `Only H.264 is decoded in the worker; ${codec} needs the <video> path`
      )
    }
  })

  it('refuses a configuration the browser cannot decode', async () => {
    const unsupported = async () => ({ supported: false })

    await expect(decoderConfigFor(video(), unsupported, false, UA.chromium)).rejects.toThrow('Codec not supported: avc1.64001f')
  })

  it('asks for the display rotation, and keeps it when the browser applies it', async () => {
    const config = await decoderConfigFor(video({ rotation: 270 }), echoes, false, UA.chromium)

    expect(config.rotation).toBe(270)
  })

  it('refuses a rotated track when the browser drops the rotation member', async () => {
    const ignoresRotation = async ({ rotation: _rotation, ...config }: OrientedDecoderConfig) => ({
      supported: true,
      config,
    })

    await expect(decoderConfigFor(video({ rotation: 90 }), ignoresRotation, false, UA.chromium)).rejects.toThrow(
      "This browser's VideoDecoder cannot rotate its output; the source's 90° display rotation needs the <video> path"
    )
    // An upright track is not affected by the missing member.
    await expect(decoderConfigFor(video(), ignoresRotation, false, UA.chromium)).resolves.not.toHaveProperty('rotation')
  })

  it('refuses a rotated track when the browser echoes nothing back', async () => {
    const noEcho = async () => ({ supported: true })

    await expect(decoderConfigFor(video({ rotation: 180 }), noEcho, false, UA.chromium)).rejects.toThrow(/cannot rotate/)
  })

  // ESCSUITE-254 cross-browser measurement: decoding the same H.264 frames in
  // a worker and seeking the same file in <video>, then drawing both on a
  // canvas, differs by 0.00/255 in Chromium 153 and Firefox 155 and by
  // 4.46-17.45/255 in WebKit 26.6 (colour, not timing: the neighbouring
  // frames are identical and differ just as much). Nothing WebKit's
  // isConfigSupported answers tells it apart from Firefox for an upright
  // track, so the engine is read from the user agent.
  it('refuses WebKit, whose VideoDecoder output does not match its own <video>', async () => {
    for (const userAgent of [UA.safari, UA.chromeOnIos]) {
      await expect(decoderConfigFor(video(), echoes, false, userAgent)).rejects.toThrow(
        "WebKit's VideoDecoder output does not match its <video> (measured up to 17/255 apart); the <video> path decodes this source"
      )
    }
  })

  it('decodes in Chromium-based browsers and Firefox, where the outputs measured identical', async () => {
    for (const userAgent of [UA.chromium, UA.edge, UA.firefox]) {
      await expect(decoderConfigFor(video(), echoes, false, userAgent)).resolves.toMatchObject({ codec: 'avc1.64001f' })
    }
  })
})
