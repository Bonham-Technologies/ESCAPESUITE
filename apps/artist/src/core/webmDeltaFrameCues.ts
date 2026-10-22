// WebM index reading, and the repair of cues written on delta frames
// (ESCSUITE-359).
//
// The EBML readers here are shared with `webmSeekIndex.ts` (ESCSUITE-305).
// This module imports nothing, so the storage layer can repair a stored take
// on read without loading the muxer.

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
export const HEAD_BYTES = 64 * 1024;

export const EBML_ID = 0x1a45dfa3;
export const SEGMENT_ID = 0x18538067;
export const SEEK_HEAD_ID = 0x114d9b74;
const SEEK_ID = 0x4dbb;
const SEEK_ID_ID = 0x53ab;
const SEEK_POSITION_ID = 0x53ac;
export const CUES_ID = 0x1c53bb6b;
export const CLUSTER_ID = 0x1f43b675;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_NUMBER_ID = 0xd7;
const TRACK_TYPE_ID = 0x83;
const CUE_POINT_ID = 0xbb;
const CUE_TIME_ID = 0xb3;
const CUE_TRACK_POSITIONS_ID = 0xb7;
const CUE_TRACK_ID = 0xf7;
const CUE_CLUSTER_POSITION_ID = 0xf1;
const SIMPLE_BLOCK_ID = 0xa3;
const BLOCK_GROUP_ID = 0xa0;
const BLOCK_ID = 0xa1;
const REFERENCE_BLOCK_ID = 0xfb;
const VOID_ID = 0xec;
const CUES_ID_BYTES = [0x1c, 0x53, 0xbb, 0x6b];

export interface ElementHeader {
  id: number;
  /** `Infinity` for the "unknown size" a live recorder writes. */
  size: number;
  dataStart: number;
}

/** One EBML variable-length integer, or null where none can be read. */
export function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number } | null {
  // A zero first byte, or a position past the end (`undefined`), both count as
  // nine leading zeros, which no EBML vint has.
  const length = Math.clz32(bytes[pos]) - 23;
  if (length > 8 || pos + length > bytes.length) return null;
  let value = keepMarker ? bytes[pos] : bytes[pos] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i];
  return { value, length };
}

export function readHeader(bytes: Uint8Array, pos: number): ElementHeader | null {
  const id = readVint(bytes, pos, true);
  const size = id && readVint(bytes, pos + id.length, false);
  if (!id || !size) return null;
  const unknown = size.value === 2 ** (7 * size.length) - 1;
  return { id: id.value, size: unknown ? Infinity : size.value, dataStart: pos + id.length + size.length };
}

export function readUint(bytes: Uint8Array, element: ElementHeader): number {
  let value = 0;
  for (let i = element.dataStart; i < element.dataStart + element.size; i++) value = value * 256 + bytes[i];
  return value;
}

/**
 * Where a SeekHead says the Cues element is, relative to the Segment's data, or
 * null when it names none. Steps into each Seek entry and reads its SeekID and
 * SeekPosition in the order every muxer writes them, SeekID first.
 */
export function cuesPositionIn(head: Uint8Array, seekHead: ElementHeader): number | null {
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

// Mediabunny's muxer starts a Cluster at a key frame, except that a Cluster may
// hold no more than 32.767 s (a block's timestamp is an int16 of milliseconds
// from its Cluster's). Past that it starts one on whatever frame comes next and
// still writes a CuePoint for every track in it. A MediaRecorder take can go
// minutes between key frames, so the remux above gave most of a long take's
// Clusters a video cue on a delta frame. Chromium trusts a cue as a key frame:
// a seek onto one hands the VP8/VP9 decoder a frame it cannot start from, and
// the element plays on without ever presenting another picture. Every far seek
// lands on another such cue, so the preview stays frozen until a reload, and
// freezes again on the next far seek.
//
// The cure is to drop those video cues and keep the rest. A player then seeks
// to the last real key frame before the target and decodes forward, as it did
// on the file before it had an index. Audio cues stay: every audio packet is a
// key frame. The Cues element is rewritten where it lies, at the same length
// (an EBML Void fills what the dropped cues held), so every other byte of the
// file, and every position the SeekHead names, stays as it was. The output is
// a Blob of slices of the input plus the new Cues, never one copy of the file.

/**
 * Only the Clusters a muxer may have had to start on a delta frame are read:
 * the first, and any that starts this long or more after the one before it.
 * Mediabunny forces one only after 32.767 s, and every other Cluster it starts
 * at a key frame on every track, so this finds all of the cues the remux wrote
 * wrong while reading a handful of Clusters rather than every one of an hour.
 */
const FORCED_CLUSTER_GAP_MS = 32_000;
/** A Cues element larger than this is left alone rather than read into memory. */
const MAX_CUES_BYTES = 16 * 1024 * 1024;
/** Elements of a Cluster read, at most, looking for a track's first block. */
const MAX_CLUSTER_ELEMENTS = 1024;
/** Enough bytes for an element header plus a block's track, timecode and flags. */
const PEEK_BYTES = 64;

interface Child extends ElementHeader {
  start: number;
  end: number;
}

async function bytesAt(blob: Blob, pos: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(pos, pos + length).arrayBuffer());
}

/** The children of the element whose data runs from `start` to `end`, or null where one cannot be read. */
function childrenOf(bytes: Uint8Array, start: number, end: number): Child[] | null {
  const out: Child[] = [];
  for (let pos = start; pos < end; ) {
    const header = readHeader(bytes, pos);
    if (!header || header.dataStart + header.size > end) return null;
    out.push({ ...header, start: pos, end: header.dataStart + header.size });
    pos = header.dataStart + header.size;
  }
  return out;
}

/** The track numbers of the video tracks a Tracks element lists. */
function videoTracksIn(head: Uint8Array, tracks: ElementHeader): Set<number> | null {
  const entries = childrenOf(head, tracks.dataStart, tracks.dataStart + tracks.size);
  if (!entries) return null;
  const video = new Set<number>();
  for (const entry of entries) {
    if (entry.id !== TRACK_ENTRY_ID) continue;
    const fields = childrenOf(head, entry.dataStart, entry.end);
    if (!fields) return null;
    const number = fields.find((f) => f.id === TRACK_NUMBER_ID);
    const type = fields.find((f) => f.id === TRACK_TYPE_ID);
    if (number && type && readUint(head, type) === 1) video.add(readUint(head, number));
  }
  return video;
}

/** Where the Segment's data starts, where its Cues element is, and which tracks are video. */
async function readIndexLayout(
  blob: Blob
): Promise<{ segmentDataStart: number; cuesAt: number; videoTracks: Set<number> } | null> {
  const head = await bytesAt(blob, 0, HEAD_BYTES);
  const ebml = readHeader(head, 0);
  if (ebml?.id !== EBML_ID) return null;
  const segment = readHeader(head, ebml.dataStart + ebml.size);
  if (segment?.id !== SEGMENT_ID) return null;

  let cuesAt: number | null = null;
  let videoTracks: Set<number> | null = null;
  for (let pos = segment.dataStart; ; ) {
    const element = readHeader(head, pos);
    if (!element || element.id === CLUSTER_ID || element.size === Infinity) break;
    if (element.id === CUES_ID) cuesAt = pos;
    else if (element.id === SEEK_HEAD_ID && cuesAt === null) {
      const position = cuesPositionIn(head, element);
      if (position !== null) cuesAt = segment.dataStart + position;
    } else if (element.id === TRACKS_ID) {
      if (element.dataStart + element.size > head.length) return null;
      videoTracks = videoTracksIn(head, element);
    }
    pos = element.dataStart + element.size;
  }
  if (cuesAt === null || !videoTracks || videoTracks.size === 0) return null;
  return { segmentDataStart: segment.dataStart, cuesAt, videoTracks };
}

/** A Block or SimpleBlock's track number and where its flags byte is, from its data start. */
function blockTrack(bytes: Uint8Array, dataStart: number): { track: number; flagsAt: number } | null {
  const track = readVint(bytes, dataStart, false);
  if (!track || dataStart + track.length + 2 >= bytes.length) return null;
  return { track: track.value, flagsAt: dataStart + track.length + 2 };
}

/**
 * Whether a BlockGroup is a key frame of `track`: true or false for one of its
 * blocks (a delta frame carries a ReferenceBlock), `undefined` for another
 * track's, null where it cannot be read.
 */
async function blockGroupIsKey(blob: Blob, start: number, end: number, track: number): Promise<boolean | null | undefined> {
  let found = false;
  for (let pos = start, n = 0; pos < end; n++) {
    if (n >= MAX_CLUSTER_ELEMENTS) return null;
    const peek = await bytesAt(blob, pos, PEEK_BYTES);
    const child = readHeader(peek, 0);
    if (!child || child.size === Infinity) return null;
    if (child.id === BLOCK_ID) {
      const block = blockTrack(peek, child.dataStart);
      if (!block) return null;
      if (block.track !== track) return undefined;
      found = true;
    } else if (child.id === REFERENCE_BLOCK_ID) return found ? false : null;
    pos += child.dataStart + child.size;
  }
  return found ? true : null;
}

/** Whether the first block of `track` in the Cluster at `clusterAt` is a key frame, or null where that cannot be read. */
async function firstBlockIsKey(blob: Blob, clusterAt: number, track: number): Promise<boolean | null> {
  const cluster = readHeader(await bytesAt(blob, clusterAt, PEEK_BYTES), 0);
  if (cluster?.id !== CLUSTER_ID) return null;
  const end = cluster.size === Infinity ? blob.size : clusterAt + cluster.dataStart + cluster.size;
  for (let pos = clusterAt + cluster.dataStart, n = 0; pos < end && n < MAX_CLUSTER_ELEMENTS; n++) {
    const peek = await bytesAt(blob, pos, PEEK_BYTES);
    const child = readHeader(peek, 0);
    if (!child || child.size === Infinity || child.id === CLUSTER_ID) return null;
    if (child.id === SIMPLE_BLOCK_ID) {
      const block = blockTrack(peek, child.dataStart);
      if (!block) return null;
      if (block.track === track) return (peek[block.flagsAt] & 0x80) !== 0;
    } else if (child.id === BLOCK_GROUP_ID) {
      const key = await blockGroupIsKey(blob, pos + child.dataStart, pos + child.dataStart + child.size, track);
      if (key !== undefined) return key;
    }
    pos += child.dataStart + child.size;
  }
  return null;
}

/** An EBML size vint of exactly `length` bytes. */
function sizeVint(value: number, length: number): number[] {
  const out = new Array<number>(length);
  for (let i = length - 1, rest = value; i >= 0; i--, rest = Math.floor(rest / 256)) out[i] = rest & 0xff;
  out[0] |= 0x80 >> (length - 1);
  return out;
}

/** The fewest bytes a size vint for `value` takes (the all-ones pattern means "unknown", so it is skipped). */
function sizeLength(value: number): number {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) length++;
  return length;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** `id` and `content` as one element, its size field `length` bytes long. */
function element(id: number[], content: Uint8Array, length = sizeLength(content.byteLength)): Uint8Array {
  return concat([new Uint8Array([...id, ...sizeVint(content.byteLength, length)]), content]);
}

/** An EBML Void element exactly `total` bytes long (2 at least). */
function voidOf(total: number): Uint8Array {
  const length = total - 2 <= 126 ? 1 : 8;
  return element([VOID_ID], new Uint8Array(total - 1 - length), length);
}

/**
 * The same file with every video CuePoint dropped whose Cluster starts that
 * track on a delta frame, or null when there is none to drop — not a WebM this
 * can read, no Cues, or every cue already on a key frame. A Cluster or a cue
 * this cannot read is left as it is: only a cue proven wrong is dropped.
 */
export async function dropDeltaFrameCues(blob: Blob): Promise<Blob | null> {
  const layout = await readIndexLayout(blob);
  if (!layout) return null;
  const { segmentDataStart, cuesAt, videoTracks } = layout;

  const cuesHeader = readHeader(await bytesAt(blob, cuesAt, 12), 0);
  if (cuesHeader?.id !== CUES_ID || cuesHeader.size === 0 || cuesHeader.size > MAX_CUES_BYTES) return null;
  const cuesLength = cuesHeader.dataStart + cuesHeader.size;
  if (cuesAt + cuesLength > blob.size) return null;
  const cues = await bytesAt(blob, cuesAt, cuesLength);
  const points = childrenOf(cues, cuesHeader.dataStart, cuesLength);
  if (!points) return null;

  // Each CuePoint's time and its track positions.
  const parsed = points.map((point) => {
    if (point.id !== CUE_POINT_ID) return null;
    const fields = childrenOf(cues, point.dataStart, point.end);
    const time = fields?.find((f) => f.id === CUE_TIME_ID);
    if (!fields || !time) return null;
    const positions = fields.flatMap((field) => {
      if (field.id !== CUE_TRACK_POSITIONS_ID) return [];
      const inner = childrenOf(cues, field.dataStart, field.end);
      const track = inner?.find((f) => f.id === CUE_TRACK_ID);
      const cluster = inner?.find((f) => f.id === CUE_CLUSTER_POSITION_ID);
      return track && cluster ? [{ field, track: readUint(cues, track), cluster: readUint(cues, cluster) }] : [];
    });
    return { fields, time: readUint(cues, time), positions };
  });

  // The Clusters worth reading: the first, and any forced after a long gap.
  const clusterStart = new Map<number, number>();
  for (const point of parsed) {
    for (const { cluster } of point?.positions ?? []) {
      clusterStart.set(cluster, Math.min(clusterStart.get(cluster) ?? Infinity, point!.time));
    }
  }
  const byTime = [...clusterStart].sort((a, b) => a[1] - b[1]);
  const suspect = new Set(
    byTime.filter(([, time], i) => i === 0 || time - byTime[i - 1][1] >= FORCED_CLUSTER_GAP_MS).map(([cluster]) => cluster)
  );

  const dropped = new Set<Child>();
  for (const point of parsed) {
    for (const { field, track, cluster } of point?.positions ?? []) {
      if (!videoTracks.has(track) || !suspect.has(cluster)) continue;
      if ((await firstBlockIsKey(blob, segmentDataStart + cluster, track)) === false) dropped.add(field);
    }
  }
  if (dropped.size === 0) return null;

  const kept: Uint8Array[] = [];
  points.forEach((point, i) => {
    const raw = cues.subarray(point.start, point.end);
    const fields = parsed[i]?.fields;
    if (!fields || !fields.some((f) => dropped.has(f))) {
      kept.push(raw);
      return;
    }
    const left = fields.filter((f) => !dropped.has(f));
    // A CuePoint with no track position left is dropped whole.
    if (!left.some((f) => f.id === CUE_TRACK_POSITIONS_ID)) return;
    kept.push(element([CUE_POINT_ID], concat(left.map((f) => cues.subarray(f.start, f.end)))));
  });

  // The new Cues at the same length, a Void filling the rest. The room is two
  // bytes at least, the smallest Void: every dropped CueTrackPositions frees
  // its id and size byte, and no size field written here grows, because each
  // holds a smaller number in the fewest bytes.
  const content = concat(kept);
  const cuesElement = element(CUES_ID_BYTES, content);
  const rewritten = [cuesElement, voidOf(cuesLength - cuesElement.byteLength)];
  return new Blob([blob.slice(0, cuesAt), ...(rewritten as BlobPart[]), blob.slice(cuesAt + cuesLength)], {
    type: blob.type,
  });
}
