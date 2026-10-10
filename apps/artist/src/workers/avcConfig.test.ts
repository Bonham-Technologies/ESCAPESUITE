// ESCSUITE-254 fix round 1: the VUI facts the decode worker needs from an
// H.264 stream — its own colour description and range (M1), and whether its
// pixels are square (MD1) — read from the avcC record. Real fixtures for the
// shapes x264 writes; hand-built parameter sets for the rest of the syntax.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAvcConfig, unescapeRbsp } from './avcConfig'
import { demuxVideoTrack } from './mp4Demux'

const MEDIA = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/media')

async function avcOf(name: string): Promise<Uint8Array> {
  const bytes = readFileSync(resolve(MEDIA, name))
  const { description } = await demuxVideoTrack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return description!
}

/** Writes an SPS bit by bit, Exp-Golomb included. */
class BitWriter {
  private bits: number[] = []
  u(count: number, value: number) {
    for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2)
    return this
  }
  flag(on: boolean) {
    return this.u(1, on ? 1 : 0)
  }
  ue(value: number) {
    const code = value + 1
    const length = Math.floor(Math.log2(code))
    return this.u(length, 0).u(length + 1, code)
  }
  se(value: number) {
    return this.ue(value > 0 ? 2 * value - 1 : -2 * value)
  }
  bytes(): Uint8Array {
    const padded = [...this.bits, 1]
    while (padded.length % 8) padded.push(0)
    const out = new Uint8Array(padded.length / 8)
    padded.forEach((bit, i) => (out[i >> 3] |= bit << (7 - (i & 7))))
    return out
  }
}

/** An avcC record around one SPS RBSP (no emulation bytes needed by these). */
function avcC(sps: Uint8Array): Uint8Array {
  const nal = [0x67, ...sps]
  return Uint8Array.from([1, sps[0], 0, 31, 0xff, 0xe1, nal.length >> 8, nal.length & 0xff, ...nal, 0])
}

interface SpsShape {
  profile: number
  chromaFormat?: number
  scalingLists?: Array<number[] | null>
  pocType: 0 | 1 | 2
  pocCycle?: number[]
  frameMbsOnly?: boolean
  cropping?: boolean
  vui?: (bits: BitWriter) => void
}

function sps({ profile, chromaFormat = 1, scalingLists, pocType, pocCycle = [], frameMbsOnly = true, cropping = false, vui }: SpsShape) {
  const bits = new BitWriter().u(8, profile).u(8, 0).u(8, 31).ue(0)
  if (profile === 100) {
    bits.ue(chromaFormat)
    if (chromaFormat === 3) bits.flag(false)
    bits.ue(0).ue(0).flag(false).flag(!!scalingLists)
    for (const list of scalingLists ?? []) {
      bits.flag(list !== null)
      for (const delta of list ?? []) bits.se(delta)
    }
  }
  bits.ue(0).ue(pocType)
  if (pocType === 0) bits.ue(2)
  if (pocType === 1) {
    bits.flag(false).se(-1).se(2).ue(pocCycle.length)
    for (const offset of pocCycle) bits.se(offset)
  }
  bits.ue(4).flag(false).ue(39).ue(29).flag(frameMbsOnly)
  if (!frameMbsOnly) bits.flag(false)
  bits.flag(true).flag(cropping)
  if (cropping) bits.ue(0).ue(0).ue(0).ue(4)
  bits.flag(!!vui)
  vui?.(bits)
  return avcC(bits.bytes())
}

/** A VUI with the given aspect, overscan and signal-type parts. */
function vui({ aspect, overscan = false, signal }: { aspect?: number[]; overscan?: boolean; signal?: { fullRange: boolean; colour?: number[] } }) {
  return (bits: BitWriter) => {
    bits.flag(!!aspect)
    if (aspect) {
      bits.u(8, aspect[0])
      if (aspect[0] === 255) bits.u(16, aspect[1]).u(16, aspect[2])
    }
    bits.flag(overscan)
    if (overscan) bits.flag(true)
    bits.flag(!!signal)
    if (signal) {
      bits.u(3, 5).flag(signal.fullRange).flag(!!signal.colour)
      for (const code of signal.colour ?? []) bits.u(8, code)
    }
    bits.flag(false).flag(false).flag(false).flag(false) // chroma loc, timing, nal hrd, vcl hrd
    bits.flag(false).flag(false) // pic_struct, bitstream restriction
  }
}

describe('readAvcConfig on x264 output', () => {
  it('reads a BT.709 colour description and limited range', async () => {
    expect(readAvcConfig(await avcOf('h264-tagged709-480p.mp4'))).toEqual({
      squarePixels: true,
      fullRange: false,
      colour: { primaries: 1, transfer: 1, matrix: 1 },
    })
  })

  it('reads a full-range signal with no colour description', async () => {
    expect(readAvcConfig(await avcOf('h264-fullrange-480p.mp4'))).toEqual({ squarePixels: true, fullRange: true })
  })

  it('reads nothing from a stream that sends no signal type', async () => {
    expect(readAvcConfig(await avcOf('h264-bframes.mp4'))).toEqual({ squarePixels: true })
  })
})

describe('readAvcConfig on the rest of the SPS syntax', () => {
  it('skips a baseline SPS with pic_order_cnt_type 1, field coding and cropping, and no VUI', () => {
    const config = sps({ profile: 66, pocType: 1, pocCycle: [1, -1], frameMbsOnly: false, cropping: true })
    expect(readAvcConfig(config)).toEqual({ squarePixels: true })
  })

  it('skips 4:4:4 scaling lists, one cut short by a zero next-scale', () => {
    const config = sps({
      profile: 100,
      chromaFormat: 3,
      // List 0 sets next-scale to 0 at once (8 + -8), ending it; list 6 runs its 64 entries.
      scalingLists: [[-8], null, null, null, null, null, Array(64).fill(0), null, null, null, null, null],
      pocType: 2,
      vui: vui({ aspect: [1] }),
    })
    expect(readAvcConfig(config)).toEqual({ squarePixels: true })
  })

  it('skips 4:2:0 scaling lists', () => {
    const config = sps({ profile: 100, scalingLists: [null, null, null, null, null, null, null, [-8]], pocType: 0 })
    expect(readAvcConfig(config)).toEqual({ squarePixels: true })
  })

  it('reads the sample aspect ratio', () => {
    const square = (aspect: number[]) =>
      readAvcConfig(sps({ profile: 100, pocType: 0, vui: vui({ aspect, overscan: true }) })).squarePixels
    expect(square([0])).toBe(true) // unspecified
    expect(square([1])).toBe(true) // 1:1
    expect(square([14])).toBe(false) // 4:3
    expect(square([255, 4, 4])).toBe(true)
    expect(square([255, 0, 0])).toBe(true) // unspecified
    expect(square([255, 4, 3])).toBe(false)
    expect(square([255, 4, 0])).toBe(true) // a zero is unspecified
  })

  it('reads a partial colour description as sent', () => {
    expect(
      readAvcConfig(sps({ profile: 100, pocType: 0, vui: vui({ signal: { fullRange: false, colour: [2, 2, 1] } }) }))
    ).toEqual({ squarePixels: true, fullRange: false, colour: { primaries: 2, transfer: 2, matrix: 1 } })
  })

  // Fix round 2: an avcC with no SPS (avc3, parameter sets in-band) hides the
  // colour description and the sample aspect ratio the worker checks, so it
  // keeps the <video> path.
  it('refuses an avcC with no SPS', () => {
    expect(() => readAvcConfig(Uint8Array.from([1, 100, 0, 31, 0xff, 0xe0, 0]))).toThrow(
      'The avcC record carries no sequence parameter set (in-band parameter sets); the <video> path draws this source'
    )
  })

  it('refuses a parameter set that ends before its syntax does', () => {
    const whole = sps({ profile: 100, pocType: 0, vui: vui({ signal: { fullRange: false, colour: [1, 1, 1] } }) })
    const cut = whole.slice(0, 12)
    cut[7] = cut.length - 8
    expect(() => readAvcConfig(cut)).toThrow('Malformed H.264 sequence parameter set')
  })
})

describe('unescapeRbsp', () => {
  it('drops the emulation-prevention byte after two zeros, and only there', () => {
    expect(Array.from(unescapeRbsp(Uint8Array.from([0, 0, 3, 1, 0, 3, 0, 0, 3, 0, 0, 0, 3])))).toEqual([
      0, 0, 1, 0, 3, 0, 0, 0, 0, 0,
    ])
  })
})
