/**
 * Firefox, by its `Gecko/` and `Firefox/` tokens: the one Firefox test. ARTIST's
 * decode worker allow-list reads it (`workerDecodeEngine.ts`), and so do the two
 * colour relabels below, ARTIST's WebM export and CRAFT's WebCodecs recorder.
 */
export function isFirefoxEngine(nav: { userAgent: string } | undefined): boolean {
  if (!nav) return false;
  return /Gecko\//.test(nav.userAgent) && /Firefox\//.test(nav.userAgent);
}

/**
 * Corrects the colour label Firefox's VP9 and VP8 encoders report for a
 * canvas-built frame (ESCSUITE-284, ESCSUITE-503).
 *
 * Firefox's `VideoEncoder`, fed a canvas-built `VideoFrame`, converts RGB to
 * YUV with the **BT.601** matrix but reports `decoderConfig.colorSpace` as
 * `{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }`.
 * Its own VP9 keyframe headers say `color_space` 0, "unknown". Measured:
 *
 * - Firefox 155 (macOS), an ARTIST export (ESCSUITE-284): the encoded YUV
 *   matches a BT.601 conversion of the drawn RGB within 1.1 code values for
 *   VP9 and 2.1 for VP8; BT.709 would be 17.3 out.
 * - Firefox 159 (Linux), a CRAFT take, whose frames are drawn from a `<video>`
 *   onto a canvas because Firefox has no `MediaStreamTrackProcessor`
 *   (ESCSUITE-503): BT.601 within 1.2 code values, BT.709 up to 16.9 out, the
 *   same as a bare canvas frame fed straight to the encoder.
 *
 * Mediabunny writes the reported colour space into the WebM **Colour** element
 * (what Chromium's `<video>` reads), and the shared
 * `createVp9ColourSpaceStamper` writes its matrix into every VP9 keyframe
 * header's `color_space` (what Firefox's `<video>` and ffmpeg read; VP8 has no
 * such field and both decode it as BT.601 regardless). So correcting the report
 * once corrects both labels, and a Firefox file reads back within 3/255 of what
 * was drawn in all three players, against up to 25/255 as reported (ARTIST's
 * `webm-export-reliability.md` has the table).
 *
 * Only the matrix changes: Firefox converted the canvas's sRGB pixels with the
 * BT.601 *matrix*, not into BT.601 primaries, so primaries, transfer and range
 * stay as reported.
 *
 * The gate is the whole report Firefox was measured giving, every time, for
 * VP9 and VP8 at every size probed (`primaries`, `transfer` and `matrix` all
 * `'bt709'` and `fullRange` `false`), not the matrix alone (ESCSUITE-284 review
 * M1). Any other report passes through by reference. So a Firefox that fixes
 * its encoder and changes its report (converting with BT.709 and reporting
 * sRGB transfer at full range the way Chromium does, say) falls out of the gate
 * on its own. One that fixes the pixels but keeps this identical report would
 * be mislabelled the other way; that residual risk is ESCSUITE-288. Upstream
 * this is https://bugzilla.mozilla.org/show_bug.cgi?id=2057760. That bug weighs
 * two fixes: changing the report to smpte170m (then this gate falls out on its
 * own) or converting with BT.709 and keeping the report (then the pixels change
 * under an identical report and this gate must go BEFORE that Firefox reaches
 * release, since CI runs Chromium only). When 2057760 lands, read which
 * shipped, re-run the ESCSUITE-284 probe, and retire or cap the gate
 * accordingly.
 *
 * Callers apply it only in Firefox ({@link isFirefoxEngine}), and only to
 * frames built from a canvas, the one case measured.
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
