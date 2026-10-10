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

  it('accepts avc3 as well as avc1', async () => {
    await expect(decoderConfigFor(video({ codec: 'avc3.42e01e' }), echoes, false)).resolves.toMatchObject({
      codec: 'avc3.42e01e',
    })
  })

  it('refuses every codec but H.264', async () => {
    for (const codec of ['hvc1.1.6.L93.B0', 'vp09.00.10.08', 'av01.0.04M.08']) {
      await expect(decoderConfigFor(video({ codec }), echoes, false)).rejects.toThrow(
        `Only H.264 is decoded in the worker; ${codec} needs the <video> path`
      )
    }
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
})
