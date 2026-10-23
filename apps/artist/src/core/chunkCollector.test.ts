import { describe, expect, it } from 'vitest'
import { createChunkCollector } from './chunkCollector'

/** Write each chunk in order through the collector's stream, then read the bytes back. */
async function collect(chunks: Array<[number[], number]>, spillBytes?: number): Promise<number[]> {
  const collector = createChunkCollector(spillBytes)
  const writer = collector.writable.getWriter()
  for (const [data, position] of chunks) await writer.write({ type: 'write', data: new Uint8Array(data), position })
  await writer.close()
  return [...new Uint8Array(await collector.toBlob('video/webm').arrayBuffer())]
}

/** The same writes applied to one plain array: what the file must read as. */
function reference(chunks: Array<[number[], number]>): number[] {
  const out: number[] = []
  for (const [data, position] of chunks) data.forEach((b, i) => (out[position + i] = b))
  return out
}

describe('createChunkCollector', () => {
  it('joins appended chunks in order', async () => {
    expect(await collect([[[1, 2, 3], 0], [[4, 5], 3]])).toEqual([1, 2, 3, 4, 5])
  })

  it('overwrites bytes already collected when the muxer writes back into them', async () => {
    // A size or a SeekHead patched after the bytes after it were written.
    expect(await collect([[[1, 2, 3, 4], 0], [[5, 6, 7, 8], 4], [[9, 9], 1]])).toEqual([1, 9, 9, 4, 5, 6, 7, 8])
  })

  it('carries a write back across the boundary between two chunks', async () => {
    expect(await collect([[[1, 2, 3, 4], 0], [[5, 6, 7, 8], 4], [[9, 9], 3]])).toEqual([1, 2, 3, 9, 9, 6, 7, 8])
  })

  it('overwrites the tail and appends the rest of a write that runs past the end', async () => {
    expect(await collect([[[1, 2, 3, 4], 0], [[9, 9, 9], 2]])).toEqual([1, 2, 9, 9, 9])
  })

  it('makes an empty file of no writes', async () => {
    expect(await collect([])).toEqual([])
  })

  // ESCSUITE-367: past `spillBytes` the collected bytes move into Blob parts,
  // and a write-back must reach them there exactly as it reached them in memory.
  describe('once bytes have spilled into Blob parts', () => {
    it('joins appends across several spills', async () => {
      const chunks: Array<[number[], number]> = [[[1, 2, 3], 0], [[4, 5, 6], 3], [[7, 8, 9], 6], [[10], 9]]
      expect(await collect(chunks, 4)).toEqual(reference(chunks))
    })

    it("writes a fast-start moov back into the head's reserved space", async () => {
      // ftyp, reserved zeroes, then media: the moov lands in the zeroes at the finish.
      const chunks: Array<[number[], number]> = [
        [[0x66, 0x74], 0],
        [[0, 0, 0, 0], 2],
        [[11, 12, 13, 14, 15, 16], 6],
        [[21, 22, 23], 12],
        [[0x6d, 0x6f, 0x6f, 0x76], 2],
      ]
      expect(await collect(chunks, 4)).toEqual(reference(chunks))
    })

    it('splices a write-back that spans a spilled part and the bytes still in memory', async () => {
      const chunks: Array<[number[], number]> = [
        [[1, 2, 3, 4], 0],
        [[5, 6], 4],
        [[9, 9, 9, 9], 2],
      ]
      expect(await collect(chunks, 4)).toEqual([1, 2, 9, 9, 9, 9])
    })

    it('splices a write-back spanning two spilled parts and runs past the end', async () => {
      const chunks: Array<[number[], number]> = [
        [[1, 2, 3, 4], 0],
        [[5, 6, 7, 8], 4],
        [[9, 9, 9, 9, 9, 9, 9], 3],
      ]
      expect(await collect(chunks, 4)).toEqual(reference(chunks))
    })

    it('keeps the bytes it was given even if the muxer reuses its buffer after a write-back', async () => {
      const collector = createChunkCollector(2)
      const writer = collector.writable.getWriter()
      await writer.write({ type: 'write', data: new Uint8Array([1, 2, 3, 4]), position: 0 })
      const reused = new Uint8Array([7, 7])
      await writer.write({ type: 'write', data: reused, position: 1 })
      reused.fill(0)
      await writer.close()
      expect([...new Uint8Array(await collector.toBlob('video/mp4').arrayBuffer())]).toEqual([1, 7, 7, 4])
    })

    it('reads a many-spill file back byte for byte', async () => {
      // 1,000 writes of 1 KiB with a 64 KiB spill, then a write-back into the
      // first spilled part.
      const chunks: Array<[number[], number]> = []
      for (let i = 0; i < 1000; i++) chunks.push([Array.from({ length: 1024 }, (_, j) => (i + j) & 0xff), i * 1024])
      chunks.push([[0xaa, 0xbb], 10])
      expect(await collect(chunks, 64 * 1024)).toEqual(reference(chunks))
    })
  })
})
