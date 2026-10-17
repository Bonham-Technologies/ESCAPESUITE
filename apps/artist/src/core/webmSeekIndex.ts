// Seek index repair at import (ESCSUITE-305).
//
// Firefox will not seek a WebM that has no Cues index into a Cluster that does
// not start with a key frame: `seeked` never fires, `seeking` stays true and
// `readyState` stays at HAVE_METADATA for the life of the element. Chrome's
// MediaRecorder starts a Cluster about every second whatever the key frames
// are, and `webm-duration-fix` — which ESCAPECRAFT runs over every
// MediaRecorder take — records a cue only for a video *SimpleBlock*. Chrome
// writes every frame of the compositor's canvas stream as a *BlockGroup* (VP9
// with alpha carries BlockAdditions), so every composited-PiP take ESCAPECRAFT
// has ever stored has an empty Cues element (`1c53bb6b 80`), and ESCAPEARTIST
// on Firefox exported each one as a black picture.
//
// The cure measured on the real take is an index: the same bytes with a real
// Cues element seek 48/48 on Firefox. Mediabunny's muxer writes one CuePoint
// per Cluster and starts a Cluster at key frames, so a packet copy through it —
// no decoder, no encoder — produces exactly that. It runs once, at import, and
// only for a WebM whose index is missing or empty: one header read decides, and
// a file that already has an index (every Mediabunny-written file, every
// ESCAPECRAFT WebCodecs take) is never rewritten.
import {
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  StreamTarget,
  WEBM,
  WebMOutputFormat,
  type AudioCodec,
  type EncodedPacket,
  type InputAudioTrack,
  type InputTrack,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';

/** `video/webm` or `audio/webm`, with or without parameters (`;codecs=vp9,opus`). */
export function isWebmType(type: string): boolean {
  return /^(video|audio)\/webm\s*(;|$)/i.test(type);
}

/**
 * How much of the file the probe reads to find the SeekHead or the first
 * Cluster. Everything before the first Cluster of a recorder's file — the EBML
 * header, the SeekHead, Info, Tracks and an index written up front — is a few
 * hundred bytes; 64 KiB leaves room for a large CodecPrivate.
 */
const HEAD_BYTES = 64 * 1024;

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const SEEK_HEAD_ID = 0x114d9b74;
const SEEK_ID = 0x4dbb;
const SEEK_ID_ID = 0x53ab;
const SEEK_POSITION_ID = 0x53ac;
const CUES_ID = 0x1c53bb6b;
const CLUSTER_ID = 0x1f43b675;

interface ElementHeader {
  id: number;
  /** `Infinity` for the "unknown size" a live recorder writes. */
  size: number;
  dataStart: number;
}

/** One EBML variable-length integer, or null where none can be read. */
function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number } | null {
  // A zero first byte, or a position past the end (`undefined`), both count as
  // nine leading zeros, which no EBML vint has.
  const length = Math.clz32(bytes[pos]) - 23;
  if (length > 8 || pos + length > bytes.length) return null;
  let value = keepMarker ? bytes[pos] : bytes[pos] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i];
  return { value, length };
}

function readHeader(bytes: Uint8Array, pos: number): ElementHeader | null {
  const id = readVint(bytes, pos, true);
  const size = id && readVint(bytes, pos + id.length, false);
  if (!id || !size) return null;
  const unknown = size.value === 2 ** (7 * size.length) - 1;
  return { id: id.value, size: unknown ? Infinity : size.value, dataStart: pos + id.length + size.length };
}

function readUint(bytes: Uint8Array, element: ElementHeader): number {
  let value = 0;
  for (let i = element.dataStart; i < element.dataStart + element.size; i++) value = value * 256 + bytes[i];
  return value;
}

/**
 * Where a SeekHead says the Cues element is, relative to the Segment's data, or
 * null when it names none. Steps into each Seek entry and reads its SeekID and
 * SeekPosition in the order every muxer writes them, SeekID first.
 */
function cuesPositionIn(head: Uint8Array, seekHead: ElementHeader): number | null {
  const end = seekHead.dataStart + seekHead.size;
  let namesCues = false;
  for (let pos = seekHead.dataStart; pos < end; ) {
    const child = readHeader(head, pos);
    if (!child) return null;
    if (child.id === SEEK_ID) {
      pos = child.dataStart;
      continue;
    }
    if (child.id === SEEK_ID_ID) namesCues = readUint(head, child) === CUES_ID;
    else if (child.id === SEEK_POSITION_ID && namesCues) return readUint(head, child);
    pos = child.dataStart + child.size;
  }
  return null;
}

/**
 * Whether this WebM has no usable seek index: its Cues element is empty, or it
 * has none and its media begins. False for anything that is not a WebM this can
 * read — junk, a truncated header, a layout whose first Cluster lies past the
 * bytes the probe reads — because a file that cannot be read cannot be repaired
 * either, and leaving it alone is what happened before.
 */
export async function needsSeekIndexRepair(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const ebml = readHeader(head, 0);
  if (ebml?.id !== EBML_ID) return false;
  const segment = readHeader(head, ebml.dataStart + ebml.size);
  if (segment?.id !== SEGMENT_ID) return false;

  for (let pos = segment.dataStart; ; ) {
    const element = readHeader(head, pos);
    if (!element) return false;
    if (element.id === CUES_ID) return element.size === 0;
    if (element.id === CLUSTER_ID) return true;
    if (element.id === SEEK_HEAD_ID) {
      const cuesPosition = cuesPositionIn(head, element);
      if (cuesPosition !== null) {
        const at = segment.dataStart + cuesPosition;
        const cues = readHeader(new Uint8Array(await blob.slice(at, at + 12).arrayBuffer()), 0);
        return cues?.id !== CUES_ID || cues.size === 0;
      }
    }
    pos = element.dataStart + element.size;
  }
}

/** Every packet of one track, in order, into its output source, then close it. */
async function copyPackets(
  track: InputTrack,
  add: (packet: EncodedPacket) => Promise<void>,
  close: () => void
): Promise<void> {
  for await (const packet of new EncodedPacketSink(track).packets()) await add(packet);
  close();
}

/**
 * Where the remux writes: a stream whose chunks are kept as separate Blob parts
 * and joined into one Blob at the end, so the output is never one contiguous
 * ArrayBuffer — for a long take that would be gigabytes, and an allocation that
 * fails is an out-of-memory crash nothing can catch (review round 1).
 *
 * Mediabunny's muxer appends, and then writes back into bytes it has already
 * written — a Cluster's size once the Cluster ends, the Segment's size, Duration
 * and SeekHead at the finish. A write that lands on collected bytes overwrites
 * them in the part (or parts) it covers, and whatever runs past the end is
 * appended. Mediabunny pads any gap itself, so no write starts past the end.
 */
export function createChunkCollector(): {
  writable: WritableStream<StreamTargetChunk>;
  toBlob: (type: string) => Blob;
} {
  const parts: Uint8Array[] = [];
  const starts: number[] = [];
  let end = 0;

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
      const at = position + offset - starts[i];
      const n = Math.min(parts[i].byteLength - at, data.byteLength - offset);
      parts[i].set(data.subarray(offset, offset + n), at);
      offset += n;
    }
    // Whatever is left lies past the end: append it. An append is all of it;
    // a write-back that fit inside what was collected leaves nothing.
    const rest = data.subarray(offset);
    if (rest.byteLength > 0) {
      parts.push(rest);
      starts.push(end);
      end += rest.byteLength;
    }
  };

  return {
    writable: new WritableStream<StreamTargetChunk>({ write }),
    toBlob: (type) => new Blob(parts as BlobPart[], { type }),
  };
}

/**
 * The same packets in a new WebM with a Cues index: every track's encoded
 * packets — timestamps, key flags, bytes and side data (a VP9 alpha plane
 * among them) — copied through Mediabunny's muxer with no decoder and no
 * encoder. The result keeps the original's MIME type.
 *
 * Throws on anything it cannot copy — a track with a codec Mediabunny cannot
 * name, a track that is neither video nor audio (its audio source refuses the
 * codec) — and the caller keeps the original bytes.
 */
export async function remuxWithSeekIndex(blob: Blob): Promise<Blob> {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
  try {
    const collector = createChunkCollector();
    const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(collector.writable) });
    const pumps: Array<() => Promise<void>> = [];

    for (const track of await input.getTracks()) {
      // A codec Mediabunny cannot name is null, and both sources refuse it.
      if (track.isVideoTrack()) {
        const source = new EncodedVideoPacketSource(track.codec as VideoCodec);
        // Declared up front rather than left to the first packet, so an alpha
        // track whose first frame happens to carry no alpha plane keeps AlphaMode.
        output.addVideoTrack(source, { canBeTransparent: await track.canBeTransparent() });
        const meta = { decoderConfig: (await track.getDecoderConfig()) as VideoDecoderConfig };
        pumps.push(() => copyPackets(track, (packet) => source.add(packet, meta), () => source.close()));
      } else {
        // Anything that is not video is copied as audio: a subtitle track's
        // codec is not an audio codec, so its source refuses it and the remux
        // throws, which keeps the original.
        const audio = track as InputAudioTrack;
        const source = new EncodedAudioPacketSource(audio.codec as AudioCodec);
        output.addAudioTrack(source);
        const meta = { decoderConfig: (await audio.getDecoderConfig()) as AudioDecoderConfig };
        pumps.push(() => copyPackets(audio, (packet) => source.add(packet, meta), () => source.close()));
      }
    }

    await output.start();
    await Promise.all(pumps.map((pump) => pump()));
    await output.finalize();
    return collector.toBlob(blob.type);
  } finally {
    input.dispose();
  }
}

/**
 * The bytes to store for an imported file: a WebM with no usable seek index
 * remuxed with one, anything else exactly as it came. A probe or a remux that
 * throws leaves the original and says so once — the import goes on, and a
 * browser that can seek the file (Chromium) is no worse off than before.
 */
export async function withSeekIndex(blob: Blob, name: string): Promise<Blob> {
  try {
    // Inside the try: a record with no bytes at all is kept as it came, for the
    // caller's own checks to decide about, rather than thrown on here.
    if (!isWebmType(blob.type)) return blob;
    return (await needsSeekIndexRepair(blob)) ? await remuxWithSeekIndex(blob) : blob;
  } catch (error) {
    console.warn(`Could not add a seek index to "${name}"; keeping it as recorded:`, error);
    return blob;
  }
}
