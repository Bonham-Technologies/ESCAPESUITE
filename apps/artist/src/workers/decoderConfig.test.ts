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
    colour: { fullyTagged: false },
    duration: 1,
    samples: [],
    keyframeCount: 1,
    ...overrides,
  }
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
    const config = await decoderConfigFor(video({ codedHeight: 480, displayHeight: 480 }), echoes, false)

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
    const config = await decoderConfigFor(video(), echoes, true)

    expect(config.hardwareAcceleration).toBe('prefer-hardware')
  })

  it('refuses a configuration the browser cannot decode', async () => {
    const unsupported = async () => ({ supported: false })

    await expect(decoderConfigFor(video(), unsupported, false)).rejects.toThrow('Codec not supported: avc1.64001f')
  })

  it('asks for the display rotation, and keeps it when the browser applies it', async () => {
    const config = await decoderConfigFor(video({ rotation: 270 }), echoes, false)

    expect(config.rotation).toBe(270)
  })

  it('refuses a rotated track when the browser drops the rotation member', async () => {
    const ignoresRotation = async ({ rotation: _rotation, ...config }: OrientedDecoderConfig) => ({
      supported: true,
      config,
    })

    await expect(decoderConfigFor(video({ rotation: 90 }), ignoresRotation, false)).rejects.toThrow(
      "This browser's VideoDecoder cannot rotate its output; the source's 90° display rotation needs the <video> path"
    )
    // An upright track is not affected by the missing member.
    await expect(decoderConfigFor(video(), ignoresRotation, false)).resolves.not.toHaveProperty('rotation')
  })

  it('refuses a rotated track when the browser echoes nothing back', async () => {
    const noEcho = async () => ({ supported: true })

    await expect(decoderConfigFor(video({ rotation: 180 }), noEcho, false)).rejects.toThrow(/cannot rotate/)
  })

  // Fix round 1, M1. Measured in Chromium 153 (ESCSUITE-254): a stream whose
  // primaries, transfer and matrix are all specified is drawn by <video> in
  // its own colours, and VideoDecoder keeps them too whatever the config
  // says — so it is given no guess. A stream that leaves any of the three
  // unspecified is drawn by <video> with the size-based guess, even where it
  // tags the matrix alone (a 160x120 file tagged 'bt709' matrix-only shows
  // BT.601 in <video>), so it keeps the guess. Firefox 155's VideoDecoder
  // ignores the config and matched its <video> in every case.
  describe('colour', () => {
    it('gives a fully tagged stream no colour space, so its own tags stand', async () => {
      const config = await decoderConfigFor(
        video({ codedHeight: 480, colour: { fullyTagged: true, fullRange: false } }),
        echoes,
        false
      )

      expect(config).not.toHaveProperty('colorSpace')
    })

    it('guesses for a stream that tags only part of its colour', async () => {
      const config = await decoderConfigFor(video({ codedHeight: 480, colour: { fullyTagged: false } }), echoes, false)

      expect(config.colorSpace).toEqual(assumedColorSpace(480))
    })

    it("keeps a stream's own full-range signal in the guess", async () => {
      const config = await decoderConfigFor(
        video({ codedHeight: 480, colour: { fullyTagged: false, fullRange: true } }),
        echoes,
        false
      )

      expect(config.colorSpace).toEqual({ ...assumedColorSpace(480), fullRange: true })
    })
  })
})
