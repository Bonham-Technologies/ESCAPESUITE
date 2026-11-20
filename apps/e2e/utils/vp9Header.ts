/**
 * The colour fields of a VP9 key frame's uncompressed header, read in Node
 * from a frame's bytes (ESCSUITE-485).
 *
 * Written from the VP9 bitstream specification v0.6, 6.2 (uncompressed
 * header) and 6.2.2 (color_config), and deliberately not imported from
 * `packages/shared/src/utils/vp9ColourSpace.ts`: this is the oracle that
 * code is checked against, so it must not share its mistakes. A packet that
 * is a superframe (several frames and an index at the end) starts with its
 * first frame's header, which is the one read here.
 */

export interface Vp9KeyFrameHeader {
  /** 0 to 3. */
  profile: number
  /** 0 CS_UNKNOWN, 1 CS_BT_601, 2 CS_BT_709, 3 CS_SMPTE_170, 4 CS_SMPTE_240, 5 CS_BT_2020, 6 CS_RESERVED, 7 CS_RGB. */
  colorSpace: number
}

/** The VP9 `color_space` code for each WebCodecs matrix that has one. */
export const VP9_COLOR_SPACE: Record<string, number> = { bt470bg: 1, bt709: 2, smpte170m: 3 }

/** The VP9 `color_space` code for each Matroska MatrixCoefficients value that has one. */
export const VP9_COLOR_SPACE_FOR_MATROSKA_MATRIX: Record<number, number> = { 1: 2, 5: 1, 6: 3 }

/** The header's profile and `color_space`, or null when `frame` is not a shown key frame. */
export function readVp9KeyFrameHeader(frame: Uint8Array): Vp9KeyFrameHeader | null {
  let at = 0
  const bit = () => {
    const byte = frame[at >> 3]
    if (byte === undefined) throw new Error('VP9 header runs past the end of the frame')
    return (byte >> (7 - (at++ & 7))) & 1
  }
  const bits = (count: number) => {
    let value = 0
    for (let i = 0; i < count; i++) value = (value << 1) | bit()
    return value
  }
  if (bits(2) !== 2) throw new Error('Not a VP9 frame: frame_marker is not 2')
  const low = bit()
  const profile = (bit() << 1) | low
  if (profile === 3) bit() // reserved_zero
  if (bit() === 1) return null // show_existing_frame
  if (bit() !== 0) return null // frame_type: 0 is KEY_FRAME
  bits(2) // show_frame, error_resilient_mode
  if (bits(24) !== 0x498342) throw new Error('VP9 key frame without its frame_sync_code')
  if (profile >= 2) bit() // ten_or_twelve_bit
  return { profile, colorSpace: bits(3) }
}
