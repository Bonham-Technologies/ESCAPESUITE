// Where a muxer writes a file too big for one buffer (ESCSUITE-305 review
// round 1, ESCSUITE-367).
//
// Chromium refuses any single ArrayBuffer of 2 GiB or more ("Array buffer
// allocation failed", measured on Chromium 141: 1.99 GiB allocates, 1.999 GiB
// throws). A Mediabunny `BufferTarget` builds the whole file in one, so an MP4
// export past ~55 minutes at Medium failed at `finalize()`, after the whole
// encode had run. Writing through a `StreamTarget` into this collector keeps
// the file as many parts and joins them into one Blob at the end.
import type { StreamTargetChunk } from 'mediabunny';

/**
 * Bytes collected in memory before they are handed to a Blob. A Blob's bytes
 * belong to the browser's blob store, which pages them to disk once it holds
 * more than it keeps in memory, so a two-hour export does not also need its
 * whole file in the page's own memory (ESCSUITE-367).
 */
export const SPILL_BYTES = 64 * 1024 * 1024;

/**
 * A stream whose chunks are kept as separate parts and joined into one Blob at
 * the end, so the output is never one contiguous ArrayBuffer — for a long take
 * or a long export that would be gigabytes, and an allocation that fails is an
 * error (or an out-of-memory crash) nothing can recover from.
 *
 * Mediabunny's muxers append, and then write back into bytes already written —
 * a WebM Cluster's size once the Cluster ends, the Segment's size, Duration
 * and SeekHead at the finish, an MP4's `moov` into the space `fastStart:
 * 'reserve'` kept for it. A write that lands on collected bytes overwrites
 * them in the part (or parts) it covers, and whatever runs past the end is
 * appended. Mediabunny pads any gap itself, so no write starts past the end.
 *
 * Once more than `spillBytes` sit in memory they move into one Blob part. A
 * write-back into a Blob part splices it — the slices before and after, with
 * the new bytes between — which copies nothing; write-backs are a handful per
 * file (a WebM's run one per Cluster), so the splices stay cheap.
 *
 * The parts are kept in the order the writes arrive, which is file order only
 * because the `StreamTarget` is left in its default mode: there Mediabunny
 * emits each flush as merged chunks sorted by start. Do not pass it
 * `chunked: true`, which can deliver a chunk ahead of the bytes before it.
 */
export function createChunkCollector(spillBytes: number = SPILL_BYTES): {
  writable: WritableStream<StreamTargetChunk>;
  toBlob: (type: string) => Blob;
} {
  const parts: Array<Uint8Array | Blob> = [];
  const starts: number[] = [];
  let end = 0;
  // Bytes in the trailing run of Uint8Array parts (everything before it is Blobs).
  let inMemory = 0;
  let firstInMemory = 0;

  const spill = () => {
    const run = parts.splice(firstInMemory) as BlobPart[];
    const runStart = starts.splice(firstInMemory)[0];
    parts.push(new Blob(run));
    starts.push(runStart);
    firstInMemory = parts.length;
    inMemory = 0;
  };

  const write = ({ data, position }: StreamTargetChunk) => {
    // The last part starting at or before `position`.
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= position) lo = mid + 1;
      else hi = mid;
    }
    let offset = 0;
    for (let i = Math.max(0, lo - 1); i < parts.length && offset < data.byteLength; i++) {
      const part = parts[i];
      const size = part instanceof Blob ? part.size : part.byteLength;
      const at = position + offset - starts[i];
      const n = Math.min(size - at, data.byteLength - offset);
      if (n <= 0) continue;
      const bytes = data.subarray(offset, offset + n);
      if (part instanceof Blob) {
        // Copied: the Blob constructor takes the bytes now, and Mediabunny may
        // reuse its buffer after the write resolves.
        parts[i] = new Blob([part.slice(0, at), bytes.slice(), part.slice(at + n)]);
      } else {
        part.set(bytes, at);
      }
      offset += n;
    }
    // Whatever is left lies past the end: append it. An append is all of it;
    // a write-back that fit inside what was collected leaves nothing. Kept as
    // a view, not copied: the muxer hands each write a fresh buffer it never
    // touches again (StreamTarget allocates one per flush).
    const rest = data.subarray(offset);
    if (rest.byteLength > 0) {
      parts.push(rest);
      starts.push(end);
      end += rest.byteLength;
      inMemory += rest.byteLength;
      if (inMemory >= spillBytes) spill();
    }
  };

  return {
    writable: new WritableStream<StreamTargetChunk>({ write }),
    toBlob: (type) => new Blob(parts as BlobPart[], { type }),
  };
}
