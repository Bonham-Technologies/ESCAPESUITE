/**
 * Corrects the colour label Firefox's VP9 and VP8 encoders report (ESCSUITE-284).
 *
 * Firefox 155's `VideoEncoder`, fed a canvas-built `VideoFrame`, converts RGB to
 * YUV with the **BT.601** matrix (the encoded YUV matches a BT.601 conversion of
 * the drawn RGB within 1.1 code values for VP9 and 2.1 for VP8; BT.709 would be
 * 17.3 out) but reports `decoderConfig.colorSpace` as
 * `{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }`.
 * Its own VP9 keyframe headers say `color_space` 0, "unknown".
 *
 * Mediabunny writes the reported colour space into two places, and the players
 * split between them (measured 2026-10-11 on a Firefox export, each label patched
 * by hand):
 *
 * - the WebM **Colour** element — what Chromium's `<video>` reads;
 * - every VP9 keyframe header's `color_space` (mediabunny's `fixVP9ColorSpace`
 *   rewrites it from the reported matrix) — what Firefox's `<video>` and ffmpeg
 *   read. VP8 has no such field and both decode it as BT.601 regardless.
 *
 * So correcting the report once corrects both labels, and a Firefox export reads
 * back within 3/255 of what was drawn in all three players, against up to 25/255
 * as reported.
 *
 * Only the matrix changes: Firefox converted the canvas's sRGB pixels with the
 * BT.601 *matrix*, not into BT.601 primaries, so primaries, transfer and range
 * stay as reported. Only the measured mislabel — a `'bt709'` matrix — is
 * corrected; any other report passes through, so a Firefox that starts
 * labelling what it converts needs nothing from here. A Firefox that instead
 * starts *converting* with BT.709 while still reporting it would be mislabelled
 * by this, which is why the gate is the measured engine and the measured label.
 */
export function relabelFirefoxVpxMeta(
  meta: EncodedVideoChunkMetadata | undefined
): EncodedVideoChunkMetadata | undefined {
  const config = meta?.decoderConfig;
  if (config?.colorSpace?.matrix !== 'bt709') return meta;
  return { ...meta, decoderConfig: { ...config, colorSpace: { ...config.colorSpace, matrix: 'smpte170m' } } };
}
