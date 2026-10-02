// The one importer of `gifenc` (ESCSUITE-34).
//
// A GIF frame is three steps, not one: quantise the RGBA pixels down to a
// colour table, map every pixel to an index into that table, then write the
// indexed bitmap and its table into the stream. `gifenc` gives each step its
// own function so a caller can share a palette across frames or push the work
// into workers; v1 does neither — one palette per frame, no dithering, infinite
// loop — so the three calls always happen together and belong behind one
// method.
//
// Keeping them here also keeps `exportGIF.ts` testable: its unit and per-frame
// tests mock this module and count `addFrame` calls, rather than mocking a
// third-party package. `gifEncoder.test.ts` is the only test that runs the real
// encoder, which is why the dependency is pinned to an exact version.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** Colours in a frame's palette. The GIF format's own ceiling. */
export const GIF_MAX_COLORS = 256;

export interface GifWriter {
  /**
   * Quantise one RGBA frame to its own 256-colour palette and write it.
   * `delayMs` is the frame's on-screen time in milliseconds — which the GIF
   * container stores as centiseconds, so 67 ms (15 fps) lands as 7 cs.
   */
  addFrame(rgba: Uint8ClampedArray, width: number, height: number, delayMs: number): void;
  /** Bytes written to the GIF stream so far — the live size estimate's numerator. */
  bytesWritten(): number;
  /** Write the end-of-stream byte (once) and return the finished file. */
  finish(): Uint8Array;
}

/**
 * A GIF stream in `gifenc`'s "auto" mode: the header, the logical screen
 * descriptor and the Netscape looping extension are written on the first
 * `writeFrame`, so nothing here has to know whether a frame is the first one.
 */
export function createGifWriter(): GifWriter {
  const encoder = GIFEncoder();
  let finished = false;

  return {
    addFrame(rgba, width, height, delayMs) {
      // `delayMs` is trusted as given: the only caller (exportGIF) derives it from a
      // fixed fps set (10/15/20), so no clamping or validation happens here.
      if (finished) {
        throw new Error('GIF writer: addFrame() after finish()');
      }
      const palette = quantize(rgba, GIF_MAX_COLORS);
      const index = applyPalette(rgba, palette);
      encoder.writeFrame(index, width, height, { palette, delay: delayMs });
    },
    bytesWritten() {
      // The encoder's own stream cursor, not a count kept here: `bytesView()`
      // is a subarray of the buffer up to the cursor, so its length cannot
      // disagree with what was actually written.
      return encoder.bytesView().byteLength;
    },
    finish() {
      // Idempotent: an export's failure path can reach a finally after the
      // happy path has already finished, and a second trailer byte would
      // corrupt the file.
      if (!finished) {
        encoder.finish();
        finished = true;
      }
      return encoder.bytes();
    },
  };
}
