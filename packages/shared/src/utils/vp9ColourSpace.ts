/**
 * Writes the encoder's reported colour matrix into every VP9 key frame header.
 *
 * WebCodecs VP9 encoders often leave the key frame header's `color_space`
 * field at 0, "unknown" (Chromium, https://crbug.com/1377842; Firefox 155 too),
 * and report the matrix only in `decoderConfig.colorSpace`. The WebM Colour
 * element carries that report, which Chromium's `<video>` reads; Firefox's
 * `<video>` and ffmpeg read the header field instead. Mediabunny up to 1.65
 * rewrote the header from the report inside its Matroska muxer
 * (`fixVP9ColorSpace`); 1.66.0 removed that, so ESCAPECRAFT and ESCAPEARTIST
 * do it themselves before a packet reaches the muxer. ARTIST's correction of
 * Firefox's mislabelled report (ESCSUITE-284) relies on it.
 *
 * Two differences from mediabunny's version, both where it could damage a
 * frame: a matrix VP9 has no code for here leaves the header alone (it wrote
 * 0, "unknown", over whatever the encoder said), and so does anything that
 * would turn a header to or from `CS_RGB`, which changes the layout of the
 * bits after it. And it copies the bytes it changes rather than writing into
 * the caller's packet.
 *
 * Header layout: VP9 bitstream specification v0.6, 6.2 (uncompressed header)
 * and 6.2.2 (color_config).
 */

/** VP9 `color_space` codes for the WebCodecs matrices mediabunny mapped. */
const VP9_COLOR_SPACE = new Map<string, number>([
  ['bt470bg', 1], // CS_BT_601
  ['bt709', 2], // CS_BT_709
  ['smpte170m', 3], // CS_SMPTE_170
])
const CS_RGB = 7
const VP9_SYNC_CODE = 0x498342

function readBits(data: Uint8Array, at: number, count: number): number {
  let value = 0
  for (let i = at; i < at + count; i++) value = (value << 1) | ((data[i >> 3] >> (7 - (i & 7))) & 1)
  return value
}

/**
 * The bit offset of `color_space` in a VP9 key frame's uncompressed header,
 * or null when the bytes are not a key frame header that holds one (an
 * inter frame, a shown-again frame, a wrong sync code, or too few bytes).
 */
export function vp9ColourSpaceBitOffset(data: Uint8Array): number | null {
  // frame_marker(2), profile_low_bit, profile_high_bit, [reserved_zero],
  // show_existing_frame, frame_type, show_frame, error_resilient_mode,
  // frame_sync_code(24), [ten_or_twelve_bit], color_space(3): at most 37 bits.
  if (data.length < 5) return null
  const profile = readBits(data, 2, 1) | (readBits(data, 3, 1) << 1)
  let at = profile === 3 ? 5 : 4
  if (readBits(data, at++, 1) === 1) return null // show_existing_frame
  if (readBits(data, at++, 1) !== 0) return null // frame_type: 0 is KEY_FRAME
  at += 2
  if (readBits(data, at, 24) !== VP9_SYNC_CODE) return null
  at += 24
  if (profile >= 2) at++
  return at
}

/**
 * `data` with its VP9 key frame header's `color_space` set from `matrix`: a
 * copy when that changes a bit, `data` itself (untouched) when it does not or
 * may not.
 */
export function withVp9ColourSpace(data: Uint8Array, matrix: string | null | undefined): Uint8Array {
  const code = matrix == null ? undefined : VP9_COLOR_SPACE.get(matrix)
  if (code === undefined) return data
  const at = vp9ColourSpaceBitOffset(data)
  if (at === null) return data
  const current = readBits(data, at, 3)
  if (current === code || current === CS_RGB) return data
  const out = data.slice()
  for (let i = 0; i < 3; i++) {
    const mask = 1 << (7 - ((at + i) & 7))
    const index = (at + i) >> 3
    out[index] = (code >> (2 - i)) & 1 ? out[index] | mask : out[index] & ~mask
  }
  return out
}

/** The parts of mediabunny's `EncodedPacket` the stamper reads. */
export interface Vp9PacketLike<P> {
  readonly type: string
  readonly data: Uint8Array
  clone(options: { data: Uint8Array }): P
}

/** The parts of WebCodecs' `EncodedVideoChunkMetadata` the stamper reads. */
export interface Vp9ChunkMetadataLike {
  decoderConfig?: { colorSpace?: { matrix?: string | null } | null } | null
}

/**
 * One VP9 track's stamper: hand it each packet with the metadata the muxer
 * gets, in order. Like mediabunny's muxer, it takes the matrix from the first
 * metadata that carries a decoder configuration and stamps every key frame
 * after with it, including those that come with no metadata. A packet it
 * changes comes back as a clone; every other packet comes back as it was.
 */
export function createVp9ColourSpaceStamper(): <P extends Vp9PacketLike<P>>(
  packet: P,
  meta?: Vp9ChunkMetadataLike
) => P {
  let configured = false
  let matrix: string | null | undefined
  return (packet, meta) => {
    if (!configured && meta?.decoderConfig) {
      configured = true
      matrix = meta.decoderConfig.colorSpace?.matrix
    }
    if (packet.type !== 'key') return packet
    const data = withVp9ColourSpace(packet.data, matrix)
    return data === packet.data ? packet : packet.clone({ data })
  }
}
