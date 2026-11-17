import { describe, it, expect, vi } from 'vitest'
import {
  createVp9ColourSpaceStamper,
  vp9ColourSpaceBitOffset,
  withVp9ColourSpace,
  type Vp9PacketLike,
} from './vp9ColourSpace'

/** First 24 bytes of a Firefox 155 VP9 profile 0 key frame: `color_space` 0, "unknown". */
const FIREFOX_KEYFRAME = Uint8Array.from([
  0x82, 0x49, 0x83, 0x42, 0x00, 0x77, 0xf0, 0x43, 0x76, 0x00, 0x38, 0x24,
  0x1c, 0x18, 0x50, 0x18, 0x00, 0x58, 0x67, 0xd8, 0xc1, 0xa0, 0x75, 0xed,
])

interface HeaderFields {
  profile?: 0 | 1 | 2 | 3
  showExisting?: 0 | 1
  frameType?: 0 | 1
  sync?: number
  colourSpace?: number
}

/** A VP9 uncompressed header up to `color_space`, then a run of set bits so a stray write shows. */
function header({ profile = 0, showExisting = 0, frameType = 0, sync = 0x498342, colourSpace = 0 }: HeaderFields): Uint8Array {
  const bits: number[] = [1, 0, profile & 1, profile >> 1]
  if (profile === 3) bits.push(0)
  bits.push(showExisting, frameType, 1, 0)
  for (let i = 23; i >= 0; i--) bits.push((sync >> i) & 1)
  if (profile >= 2) bits.push(1)
  for (let i = 2; i >= 0; i--) bits.push((colourSpace >> i) & 1)
  while (bits.length % 8 !== 0 || bits.length < 64) bits.push(1)
  const bytes = new Uint8Array(bits.length / 8)
  bits.forEach((bit, i) => {
    bytes[i >> 3] |= bit << (7 - (i & 7))
  })
  return bytes
}

function colourSpaceOf(data: Uint8Array): number {
  const at = vp9ColourSpaceBitOffset(data)!
  let value = 0
  for (let i = at; i < at + 3; i++) value = (value << 1) | ((data[i >> 3] >> (7 - (i & 7))) & 1)
  return value
}

/** Every bit of `a` and `b` that differs, by index. */
function differingBits(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < a.length * 8; i++) {
    if (((a[i >> 3] >> (7 - (i & 7))) & 1) !== ((b[i >> 3] >> (7 - (i & 7))) & 1)) out.push(i)
  }
  return out
}

describe('vp9ColourSpaceBitOffset', () => {
  it('finds the field in a real Firefox key frame (profile 0)', () => {
    expect(vp9ColourSpaceBitOffset(FIREFOX_KEYFRAME)).toBe(32)
    expect(colourSpaceOf(FIREFOX_KEYFRAME)).toBe(0)
  })

  it.each([
    [0, 32],
    [1, 32],
    [2, 33], // ten_or_twelve_bit before it
    [3, 34], // reserved_zero after the profile, and ten_or_twelve_bit
  ] as const)('finds it in a profile %i header at bit %i', (profile, offset) => {
    expect(vp9ColourSpaceBitOffset(header({ profile }))).toBe(offset)
  })

  it('answers null for anything that is not a key frame header', () => {
    expect(vp9ColourSpaceBitOffset(header({ showExisting: 1 }))).toBeNull()
    expect(vp9ColourSpaceBitOffset(header({ frameType: 1 }))).toBeNull()
    expect(vp9ColourSpaceBitOffset(header({ sync: 0x498343 }))).toBeNull()
    expect(vp9ColourSpaceBitOffset(FIREFOX_KEYFRAME.subarray(0, 4))).toBeNull()
    expect(vp9ColourSpaceBitOffset(new Uint8Array(0))).toBeNull()
  })
})

describe('withVp9ColourSpace', () => {
  it.each([
    ['bt470bg', 1],
    ['bt709', 2],
    ['smpte170m', 3],
  ])('writes %s as %i into a copy, changing no other bit', (matrix, code) => {
    const original = FIREFOX_KEYFRAME.slice()
    const out = withVp9ColourSpace(original, matrix)
    expect(out).not.toBe(original)
    expect(colourSpaceOf(out)).toBe(code)
    expect(Array.from(original)).toEqual(Array.from(FIREFOX_KEYFRAME))
    expect(differingBits(original, out).every((bit) => bit >= 32 && bit < 35)).toBe(true)
  })

  it('writes after ten_or_twelve_bit in profile 2 and 3 headers', () => {
    for (const profile of [2, 3] as const) {
      const out = withVp9ColourSpace(header({ profile }), 'smpte170m')
      expect(colourSpaceOf(out)).toBe(3)
      const at = vp9ColourSpaceBitOffset(out)!
      expect(differingBits(header({ profile }), out).every((bit) => bit >= at && bit < at + 3)).toBe(true)
    }
  })

  it('overwrites a different code the encoder wrote', () => {
    expect(colourSpaceOf(withVp9ColourSpace(header({ colourSpace: 2 }), 'smpte170m'))).toBe(3)
  })

  it('returns the bytes themselves when the field already says so', () => {
    const data = header({ colourSpace: 2 })
    expect(withVp9ColourSpace(data, 'bt709')).toBe(data)
  })

  it('leaves the header alone for a matrix VP9 has no code for here (mediabunny wrote 0 over it)', () => {
    const data = header({ colourSpace: 5 })
    for (const matrix of ['bt2020-ncl', 'smpte240m', 'rgb', 'toString', null, undefined]) {
      expect(withVp9ColourSpace(data, matrix)).toBe(data)
    }
  })

  it('never turns a CS_RGB header into another (the bits after it differ)', () => {
    const data = header({ profile: 1, colourSpace: 7 })
    expect(withVp9ColourSpace(data, 'bt709')).toBe(data)
  })

  it('leaves anything that is not a key frame header alone', () => {
    const inter = header({ frameType: 1 })
    expect(withVp9ColourSpace(inter, 'bt709')).toBe(inter)
  })
})

class PacketDouble implements Vp9PacketLike<PacketDouble> {
  readonly type: 'key' | 'delta'
  readonly data: Uint8Array
  constructor(type: 'key' | 'delta', data: Uint8Array) {
    this.type = type
    this.data = data
  }
  clone = vi.fn((options: { data: Uint8Array }) => new PacketDouble(this.type, options.data))
}

const config = (matrix?: string) => ({
  decoderConfig: { colorSpace: matrix === undefined ? undefined : { matrix } },
})

describe('createVp9ColourSpaceStamper', () => {
  it('stamps every key frame with the first decoder configuration’s matrix, metadata or not', () => {
    const stamp = createVp9ColourSpaceStamper()
    const first = new PacketDouble('key', FIREFOX_KEYFRAME.slice())
    const second = new PacketDouble('key', FIREFOX_KEYFRAME.slice())

    const outFirst = stamp(first, config('smpte170m'))
    const outSecond = stamp(second)

    expect(outFirst).not.toBe(first)
    expect(first.clone).toHaveBeenCalledOnce()
    expect(colourSpaceOf(outFirst.data)).toBe(3)
    expect(colourSpaceOf(outSecond.data)).toBe(3)
    expect(colourSpaceOf(first.data)).toBe(0)
  })

  it('keeps the first configuration, as the muxer does, when a later one differs', () => {
    const stamp = createVp9ColourSpaceStamper()
    stamp(new PacketDouble('key', FIREFOX_KEYFRAME.slice()), config('bt709'))
    const later = stamp(new PacketDouble('key', FIREFOX_KEYFRAME.slice()), config('smpte170m'))
    expect(colourSpaceOf(later.data)).toBe(2)
  })

  it('waits for metadata that carries a decoder configuration', () => {
    const stamp = createVp9ColourSpaceStamper()
    const bare = new PacketDouble('key', FIREFOX_KEYFRAME.slice())
    expect(stamp(bare, {})).toBe(bare)
    expect(colourSpaceOf(stamp(new PacketDouble('key', FIREFOX_KEYFRAME.slice()), config('bt709')).data)).toBe(2)
  })

  it('passes delta packets, and every packet of an unlabelled track, through as they came', () => {
    const labelled = createVp9ColourSpaceStamper()
    const delta = new PacketDouble('delta', FIREFOX_KEYFRAME.slice())
    labelled(new PacketDouble('key', FIREFOX_KEYFRAME.slice()), config('bt709'))
    expect(labelled(delta)).toBe(delta)

    const unlabelled = createVp9ColourSpaceStamper()
    const key = new PacketDouble('key', FIREFOX_KEYFRAME.slice())
    expect(unlabelled(key, config())).toBe(key)
    expect(key.clone).not.toHaveBeenCalled()
  })
})
