// The GIF encoder wrapper, against the REAL gifenc (ESCSUITE-34).
//
// Deliberately not mocked: this is the one place the third-party encoder's API
// is verified rather than assumed, so the byte counts below are exact and come
// from running gifenc 1.0.3 — which is why the dependency is pinned without a
// caret. Everything downstream (exportGIF.ts and its two test files) mocks
// `./gifEncoder` and counts calls; nothing else ever touches gifenc.
import { describe, it, expect } from 'vitest'
import { createGifWriter, GIF_MAX_COLORS } from './gifEncoder'

/** A 2x2 frame of one opaque colour — one palette entry, so every byte count below is deterministic. */
function solidFrame(r: number, g: number, b: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(2 * 2 * 4)
  for (let i = 0; i < 4; i++) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/**
 * Every Graphic Control Extension's delay field, in centiseconds, in order.
 *
 * A GCE is `0x21 0xF9 0x04 <packed> <delayLo> <delayHi> <transparentIndex> 0x00`
 * (gifenc `src/index.js`'s `encodeGraphicControlExt`). Scanning for the
 * three-byte introducer is safe for these fixtures specifically: the whole file
 * is under a hundred bytes, the colour table holds one real colour plus one
 * black pad, and the LZW payload of a four-pixel single-colour image is six
 * bytes — there is no room for a false positive, and the assertions below pin
 * the file's total length so there never will be.
 */
function frameDelaysCs(bytes: Uint8Array): number[] {
  const delays: number[] = []
  for (let i = 0; i + 7 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      delays.push(bytes[i + 4] | (bytes[i + 5] << 8))
    }
  }
  return delays
}

describe('createGifWriter', () => {
  it('writes a GIF89a file that ends with the trailer byte', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    const bytes = writer.finish()

    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
    // 0x3B is the GIF end-of-stream trailer; `finish()` is the only writer of it.
    expect(bytes[bytes.length - 1]).toBe(0x3b)
  })

  it('carries each frame’s delay in centiseconds, rounded from milliseconds', () => {
    const writer = createGifWriter()
    // 10 fps and 15 fps. 100 ms is exactly 10 cs; 67 ms rounds to 7 cs, so a
    // "15 fps" GIF really plays at ~14.3 fps — the format's own granularity,
    // recorded here rather than left to be discovered.
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    writer.addFrame(solidFrame(0, 0, 255), 2, 2, 67)

    expect(frameDelaysCs(writer.finish())).toEqual([10, 7])
  })

  it('reports the bytes written so far, growing with each frame', () => {
    const writer = createGifWriter()
    expect(writer.bytesWritten()).toBe(0)

    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    const afterFirst = writer.bytesWritten()
    writer.addFrame(solidFrame(0, 0, 255), 2, 2, 67)
    const afterSecond = writer.bytesWritten()

    // Measured against gifenc 1.0.3 on 2026-10-01: 65 bytes after the first
    // frame (header + logical screen descriptor + global colour table +
    // Netscape extension + the frame itself) and 98 after the second. Exact
    // rather than a range, because this is the number the live size estimate
    // divides by and a stubbed encoder would not produce it.
    expect(afterFirst).toBe(65)
    expect(afterSecond).toBe(98)
    // finish() writes exactly one more byte — the trailer.
    expect(writer.finish().byteLength).toBe(afterSecond + 1)
  })

  it('refuses a frame written after finish()', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)
    writer.finish()

    expect(() => writer.addFrame(solidFrame(0, 255, 0), 2, 2, 100)).toThrow(
      /addFrame\(\) after finish\(\)/
    )
  })

  it('writes one trailer however many times finish() is called', () => {
    const writer = createGifWriter()
    writer.addFrame(solidFrame(255, 0, 0), 2, 2, 100)

    const first = writer.finish()
    const second = writer.finish()

    // A second finish() must not append a second trailer: the dialog's own
    // error path can reach the finally after the happy path already finished.
    expect(second.byteLength).toBe(first.byteLength)
    expect(second[second.byteLength - 1]).toBe(0x3b)
  })
})

describe('GIF_MAX_COLORS', () => {
  it('is 256, the GIF format’s own ceiling', () => {
    expect(GIF_MAX_COLORS).toBe(256)
  })
})
