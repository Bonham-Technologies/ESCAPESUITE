/**
 * Type definitions for gifenc 1.0.3, which ships none.
 *
 * Written from the package's own source (`src/index.js`, `src/palettize.js`,
 * `src/pnnquant2.js`, `src/stream.js`) and its README, and verified by
 * `src/core/gifEncoder.test.ts` running the real package. Only the surface
 * `core/gifEncoder.ts` uses is declared; the quantiser's other exports
 * (`prequantize`, `nearestColorIndex`, `snapColorsToPalette`, …) are left out
 * on purpose, so adding a use of one is a visible change rather than a silent
 * `any`. Same shape and same reason as `src/types/mp4box.d.ts`.
 */
declare module 'gifenc' {
  /** A colour table: one `[r, g, b]` (or `[r, g, b, a]`) triple per entry, in bytes. */
  export type GifPalette = number[][];

  /** How a pixel is packed before quantisation. `rgb565` is the default and the only one used here. */
  export type GifPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface GifQuantizeOptions {
    format?: GifPixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** Reduce an RGBA frame to a palette of no more than `maxColors` colours. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: GifQuantizeOptions
  ): GifPalette;

  /** Map each pixel of an RGBA frame to its nearest palette index. One byte per pixel. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifPixelFormat
  ): Uint8Array;

  export interface GifWriteFrameOptions {
    /** Required on the first frame (global colour table); a later frame's becomes a local one. */
    palette?: GifPalette;
    /** Frame delay in **milliseconds**; gifenc rounds it to centiseconds on the way out. */
    delay?: number;
    /** `-1` once, `0` forever (the default), any positive integer a repeat count. First frame only. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** Only meaningful with `{ auto: false }`. */
    first?: boolean;
    dispose?: number;
    colorDepth?: number;
  }

  export interface GifEncoderHandle {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions
    ): void;
    /** Writes the GIF header. Only needed with `{ auto: false }`. */
    writeHeader(): void;
    /** Writes the end-of-stream trailer byte. */
    finish(): void;
    /**
     * A zero-copy view of everything written so far — its length is the stream
     * cursor, and its buffer is the stream's whole (power-of-two) capacity.
     *
     * `Uint8Array<ArrayBuffer>`, not the default `Uint8Array<ArrayBufferLike>`:
     * the stream's backing store is a plain `new Uint8Array(capacity)` and this
     * is a `subarray` of it, so it cannot be backed by a `SharedArrayBuffer` —
     * and `new Blob([...])` will not take a view that might be. Same narrowing,
     * same reason, as `LevelMeter.data` in ESCAPECRAFT's
     * `core/webcodecs-recorder.ts`.
     *
     * The package's sibling `bytes()` (the same range, `slice`d into a buffer of
     * its own) is deliberately **not** declared: nothing here needs a copy, and
     * this file declares only the surface `core/gifEncoder.ts` uses.
     */
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoderHandle;
}
