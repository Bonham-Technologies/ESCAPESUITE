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
 * stay as reported.
 *
 * The gate is the whole report Firefox 155 was measured giving, every time, for
 * VP9 and VP8 at every size probed — `primaries`, `transfer` and `matrix` all
 * `'bt709'` and `fullRange` `false` — not the matrix alone (ESCSUITE-284 review
 * M1). Any other report passes through by reference. So a Firefox that fixes
 * its encoder and changes its report — converting with BT.709 and reporting
 * sRGB transfer at full range the way Chromium does, say — falls out of the gate
 * on its own. One that fixes the pixels but keeps this identical report would be
 * mislabelled the other way; that residual risk is ESCSUITE-288, the upstream
 * report — https://bugzilla.mozilla.org/show_bug.cgi?id=2081037 (filed
 * 2026-10-12). When a Firefox release resolves it, re-run the ESCSUITE-284 probe
 * and retire this gate or narrow it to the new report. Measured on macOS only
 * (Playwright's Firefox 155 build); Firefox on Linux, Windows and Android passes
 * the engine gate unmeasured.
 */
export function relabelFirefoxVpxMeta(
  meta: EncodedVideoChunkMetadata | undefined
): EncodedVideoChunkMetadata | undefined {
  const config = meta?.decoderConfig;
  if (
    config?.colorSpace?.matrix !== 'bt709' ||
    config.colorSpace.primaries !== 'bt709' ||
    config.colorSpace.transfer !== 'bt709' ||
    config.colorSpace.fullRange !== false
  ) {
    return meta;
  }
  return { ...meta, decoderConfig: { ...config, colorSpace: { ...config.colorSpace, matrix: 'smpte170m' } } };
}
