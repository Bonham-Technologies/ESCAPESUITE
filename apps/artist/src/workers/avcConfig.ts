/**
 * What an H.264 stream says about itself in its sequence parameter set's VUI
 * (ITU-T H.264 7.3.2.1.1 and E.1.1), read from the avcC record the decode
 * worker hands VideoDecoder (ESCSUITE-254).
 *
 * Two things the `<video>` oracle honours and a raw VideoDecoder config does
 * not carry by itself depend on it: the stream's own colour description and
 * range (which decide whether the worker supplies a colour-space guess), and
 * its sample aspect ratio (a non-square pixel is drawn wider or narrower by
 * `<video>`; the worker refuses such a stream rather than guess).
 *
 * Everything before the VUI is parsed only to be skipped. A parameter set
 * that ends before the parser does is malformed, and throws; so does a record
 * with no SPS at all.
 */

export interface AvcStreamInfo {
  /** `colour_description_present_flag`'s three codes, when the stream sends them. */
  colour?: { primaries: number; transfer: number; matrix: number };
  /** `video_full_range_flag`, when the stream sends a video signal type. */
  fullRange?: boolean;
  /** False when the VUI gives a sample aspect ratio other than 1:1. */
  squarePixels: boolean;
}

/** Profiles whose SPS carries chroma format, bit depths and scaling matrices (7.3.2.1.1). */
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** `aspect_ratio_idc` meaning "the SAR follows explicitly" (Table E-1). */
const EXTENDED_SAR = 255;

/** Remove emulation-prevention bytes: every `00 00 03` becomes `00 00`. */
export function unescapeRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}

  u(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.bytes[this.bit >> 3];
      if (byte === undefined) throw new Error('Malformed H.264 sequence parameter set');
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return value;
  }

  flag(): boolean {
    return this.u(1) === 1;
  }

  /** Unsigned Exp-Golomb. */
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) zeros++;
    return 2 ** zeros - 1 + this.u(zeros);
  }

  /** Signed Exp-Golomb. */
  se(): number {
    const code = this.ue();
    return code % 2 === 1 ? (code + 1) / 2 : -(code / 2);
  }
}

/** Skip one scaling list of `size` entries (7.3.2.1.1.1). */
function skipScalingList(bits: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + bits.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

/** Read the VUI facts from the first SPS of an avcC record (the box's payload, no header). */
export function readAvcConfig(avcC: Uint8Array): AvcStreamInfo {
  // With its parameter sets in-band (avc3) the record may carry none, and then
  // nothing below can be checked: refused rather than assumed square and
  // untagged.
  if ((avcC[5] & 0x1f) === 0) {
    throw new Error(
      'The avcC record carries no sequence parameter set (in-band parameter sets); the <video> path draws this source'
    );
  }
  const length = (avcC[6] << 8) | avcC[7];
  // Skip the one-byte NAL unit header.
  const bits = new BitReader(unescapeRbsp(avcC.subarray(9, 8 + length)));

  const profile = bits.u(8);
  bits.u(16); // constraint flags, level_idc
  bits.ue(); // seq_parameter_set_id
  if (HIGH_PROFILES.has(profile)) {
    const chromaFormat = bits.ue();
    if (chromaFormat === 3) bits.u(1); // separate_colour_plane_flag
    bits.ue(); // bit_depth_luma_minus8
    bits.ue(); // bit_depth_chroma_minus8
    bits.u(1); // qpprime_y_zero_transform_bypass_flag
    if (bits.flag()) {
      // seq_scaling_matrix_present_flag
      const lists = chromaFormat === 3 ? 12 : 8;
      for (let i = 0; i < lists; i++) {
        if (bits.flag()) skipScalingList(bits, i < 6 ? 16 : 64);
      }
    }
  }
  bits.ue(); // log2_max_frame_num_minus4
  const pocType = bits.ue();
  if (pocType === 0) {
    bits.ue(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (pocType === 1) {
    bits.u(1); // delta_pic_order_always_zero_flag
    bits.se(); // offset_for_non_ref_pic
    bits.se(); // offset_for_top_to_bottom_field
    const cycle = bits.ue();
    for (let i = 0; i < cycle; i++) bits.se();
  }
  bits.ue(); // max_num_ref_frames
  bits.u(1); // gaps_in_frame_num_value_allowed_flag
  bits.ue(); // pic_width_in_mbs_minus1
  bits.ue(); // pic_height_in_map_units_minus1
  if (!bits.flag()) bits.u(1); // frame_mbs_only_flag; mb_adaptive_frame_field_flag
  bits.u(1); // direct_8x8_inference_flag
  if (bits.flag()) {
    // frame_cropping_flag: four offsets
    for (let i = 0; i < 4; i++) bits.ue();
  }
  if (!bits.flag()) return { squarePixels: true }; // vui_parameters_present_flag

  const info: AvcStreamInfo = { squarePixels: true };
  if (bits.flag()) {
    // aspect_ratio_info_present_flag
    const idc = bits.u(8);
    if (idc === EXTENDED_SAR) {
      const width = bits.u(16);
      const height = bits.u(16);
      // 0:0 is "unspecified", as idc 0 is.
      info.squarePixels = width === height || width === 0 || height === 0;
    } else {
      info.squarePixels = idc <= 1; // 0 unspecified, 1 is 1:1
    }
  }
  if (bits.flag()) bits.u(1); // overscan_info_present_flag; overscan_appropriate_flag
  if (bits.flag()) {
    // video_signal_type_present_flag
    bits.u(3); // video_format
    info.fullRange = bits.flag();
    if (bits.flag()) {
      // colour_description_present_flag
      info.colour = { primaries: bits.u(8), transfer: bits.u(8), matrix: bits.u(8) };
    }
  }
  return info;
}
