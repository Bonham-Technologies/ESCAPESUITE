// The `.veditor` v2 container (ESCSUITE-260).
//
//   offset 0   8 bytes  magic  89 56 45 44 0D 0A 1A 0A   ("\x89VED\r\n\x1a\n", PNG-style)
//   offset 8   u32 LE   container version = 2
//   offset 12  u32 LE   N = index length in bytes (<= MAX_INDEX_BYTES)
//   offset 16  N bytes  UTF-8 JSON index
//   offset 16+N         payload: every part's raw bytes, back to back in index order
//
// Version 1 was one JSON string with every source base64-encoded inside it.
// V8's longest string (about 512 Mi characters) capped a whole project, and a
// save read every source byte through `FileReader`. Here the writer hands the
// stored `Blob`s to `new Blob([...])` by reference and reads none of them, and
// the reader slices each part back out of the file. A source goes from the
// file into IndexedDB without passing through the JS heap. The only bytes
// built in JS are the 16-byte header and the index.
//
// The high-bit first byte means a v2 file can never parse as JSON, and the
// CR LF / SUB / LF tail catches the damage a text-mode transfer does. Offsets
// are relative to the payload's start, so the index's own length never feeds
// back into them. A new optional field goes in the index JSON, following the
// additive rule `meta` and `editor` followed under v1. Only a layout change
// bumps the u32 version.
//
// The headless kit reads the same layout with its own copy of these constants
// (`services/headless-artist/src/loaders.ts` imports nothing from the apps on
// purpose). Both packages' tests pin the same header bytes literally, so a
// change made to one and not the other turns red.
//
// Pure: no DOM beyond `Blob`, no storage. Every refusal is a
// `ProjectFileError`, whose message is meant to be shown.
import type { EditorBlock, Project } from '../store/types';
import type { SourceVideoMeta } from './projectManager';

export const MAGIC = Uint8Array.of(0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a);
export const CONTAINER_VERSION = 2;
export const HEADER_BYTES = 16;

/**
 * The longest index a file may declare. The index is the one string still
 * built in JS, and its bulk is about 2,000 waveform samples per source, so a
 * real project's index is kilobytes. The cap stops a corrupt or hostile header
 * from making the reader slice and decode gigabytes as text. The writer
 * refuses the same cap, so it never writes a file its own reader rejects.
 */
export const MAX_INDEX_BYTES = 64 * 1024 * 1024;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * A file this module refuses, or a project the writer refuses. The message is
 * shown to the user. A refusal that wraps a failure of its own (a read, a
 * write or a metadata probe that rejected, ESCSUITE-302) carries that failure
 * as `cause`, so the console keeps the browser's own words.
 */
export class ProjectFileError extends Error {
  name = 'ProjectFileError';
  // `declare`: no own property on a refusal that has no cause. The app's lib
  // is ES2020, whose `Error` has no `cause` and no options argument.
  declare readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options) Object.assign(this, { cause: options.cause });
  }
}

/**
 * Read part of a project file, or refuse by name when the read rejects
 * (ESCSUITE-302): a `RangeError` is V8's string or ArrayBuffer ceiling, "the
 * file is too large to read"; anything else (the file moved, a permission
 * lost) is "the file could not be read". Either way the read's own error is
 * the `cause`. Used for the v1 `file.text()` and for the header and index
 * reads every file goes through.
 */
export async function readOrRefuse<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new ProjectFileError(
      error instanceof RangeError ? 'the file is too large to read' : 'the file could not be read',
      { cause: error }
    );
  }
}

/** A span of the payload, counted from the payload's first byte. */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface ThumbnailRange extends ByteRange {
  mimeType: string;
}

export interface ProjectFileIndexVideo {
  id: string;
  name: string;
  mimeType: string;
  meta?: SourceVideoMeta;
  data: ByteRange;
  thumbnail?: ThumbnailRange;
}

/** The JSON between the header and the payload. */
export interface ProjectFileIndex {
  version: typeof CONTAINER_VERSION;
  project: Project;
  editor?: EditorBlock;
  videos: ProjectFileIndexVideo[];
}

/**
 * One used source as `saveProject` hands it over. `blob` and `thumbnail` are
 * IndexedDB handles: this module reads their `size` and `type`, never their
 * bytes.
 */
export interface ProjectFileSource {
  id: string;
  name: string;
  mimeType: string;
  meta?: SourceVideoMeta;
  blob: Blob;
  thumbnail?: Blob;
}

/**
 * Bytes as the user reads them: whole MiB below 1 GiB, GiB to one decimal from
 * there. A figure that is needed or declared rounds up (the default); one that
 * is free or held passes `round: 'down'`. A sentence that names one of each
 * about a shortfall therefore never shows the same figure twice: 100.5 MiB
 * needed against 100.2 MiB free reads "101 MiB" and "100 MiB".
 */
export function formatSize(bytes: number, { round = 'up' }: { round?: 'up' | 'down' } = {}): string {
  const whole = round === 'down' ? Math.floor : Math.ceil;
  // `bytes * 10` is a whole number and GIB a power of two, so the tenths are
  // exact and never land a hair past a boundary.
  return bytes >= GIB ? `${(whole((bytes * 10) / GIB) / 10).toFixed(1)} GiB` : `${whole(bytes / MIB)} MiB`;
}

/**
 * The parts of a v2 file, ready for `new Blob(parts)`: the header, the index
 * bytes, then every source (and its thumbnail, when it has a non-empty one) by
 * reference.
 * The index is built here from the sources' sizes, so its offsets cannot
 * disagree with the parts that follow it.
 */
export function encodeProjectFile(
  project: Project,
  editor: EditorBlock | undefined,
  sources: ProjectFileSource[],
  { maxIndexBytes = MAX_INDEX_BYTES }: { maxIndexBytes?: number } = {}
): BlobPart[] {
  const payload: BlobPart[] = [];
  const videos: ProjectFileIndexVideo[] = [];
  let offset = 0;
  for (const source of sources) {
    const video: ProjectFileIndexVideo = {
      id: source.id,
      name: source.name,
      mimeType: source.mimeType,
      meta: source.meta,
      data: { offset, length: source.blob.size },
    };
    payload.push(source.blob);
    offset += source.blob.size;
    // An empty thumbnail is left out, as v1's `''` was: a zero-length range
    // would restore as an empty thumbnail, a broken tile in the library.
    if (source.thumbnail && source.thumbnail.size > 0) {
      video.thumbnail = { offset, length: source.thumbnail.size, mimeType: source.thumbnail.type };
      payload.push(source.thumbnail);
      offset += source.thumbnail.size;
    }
    videos.push(video);
  }

  const index: ProjectFileIndex = {
    version: CONTAINER_VERSION,
    project,
    ...(editor && { editor }),
    videos,
  };
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  if (indexBytes.length > maxIndexBytes) {
    throw new ProjectFileError(
      `This project's index is ${indexBytes.length} bytes, over the ${maxIndexBytes}-byte limit a project file can hold.`
    );
  }

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint32(8, CONTAINER_VERSION, true);
  view.setUint32(12, indexBytes.length, true);
  return [header, indexBytes, ...payload];
}

function fail(reason: string): never {
  throw new ProjectFileError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-negative whole number JavaScript holds exactly: an offset or a length. */
function isByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readRange(value: unknown, where: string): ByteRange {
  if (!isRecord(value) || !isByteCount(value.offset) || !isByteCount(value.length)) {
    fail(`${where} is not a byte range`);
  }
  return { offset: value.offset as number, length: value.length as number };
}

function parseVideo(value: unknown, i: number): ProjectFileIndexVideo {
  const at = `video #${i}`;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string'
  ) {
    fail(`${at} has no id, name or type`);
  }
  if (value.meta !== undefined && !isRecord(value.meta)) {
    fail(`${at}'s meta is not an object`);
  }
  const video: ProjectFileIndexVideo = {
    id: value.id as string,
    name: value.name as string,
    mimeType: value.mimeType as string,
    // Shape only: `restoreSource` recovers an unusable duration or dimension
    // from the blob, exactly as it does for a v1 file's `meta`.
    meta: value.meta as SourceVideoMeta | undefined,
    data: readRange(value.data, `${at}'s data`),
  };
  if (value.thumbnail !== undefined) {
    const range = readRange(value.thumbnail, `${at}'s thumbnail`);
    const mimeType = (value.thumbnail as Record<string, unknown>).mimeType;
    if (typeof mimeType !== 'string') {
      fail(`${at}'s thumbnail has no type`);
    }
    video.thumbnail = { ...range, mimeType };
  }
  return video;
}

function parseIndex(value: unknown): ProjectFileIndex {
  if (!isRecord(value) || value.version !== CONTAINER_VERSION || !Array.isArray(value.videos)) {
    fail('its index is not a version 2 project index');
  }
  const videos = (value.videos as unknown[]).map(parseVideo);
  // One id, one row in the shared DB: a second entry would restore over the
  // first, or be taken for a source the same load had just written.
  const ids = new Set<string>();
  for (const { id } of videos) {
    if (ids.has(id)) fail(`the index lists source "${id}" twice`);
    ids.add(id);
  }
  return {
    version: CONTAINER_VERSION,
    // Handed back as found, as the v1 path does: `parseProject` validates both.
    project: value.project as Project,
    editor: value.editor as EditorBlock | undefined,
    videos,
  };
}

/** True when `bytes` opens with the eight magic bytes, however long it is. */
function startsWithMagic(bytes: Uint8Array): boolean {
  return MAGIC.every((byte, i) => bytes[i] === byte);
}

/** True when `bytes` starts with a full v2 header's magic. */
export function isV2Header(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_BYTES && startsWithMagic(bytes);
}

/**
 * The index of a v2 file, and where its payload starts. Two small slices are
 * read, the header and the index, and never the payload. Answers `null` when
 * the file does not open with the magic (every v1 file, and anything else), so
 * the caller sniffs exactly once. A v2 file this refuses, one cut short of its
 * header included, throws `ProjectFileError`.
 */
export async function readProjectFileIndex(
  blob: Blob
): Promise<{ index: ProjectFileIndex; payloadStart: number } | null> {
  const head = new Uint8Array(await readOrRefuse(() => blob.slice(0, HEADER_BYTES).arrayBuffer()));
  if (!isV2Header(head)) {
    // The magic alone decides the version, as it does in the headless kit: a
    // file that opens with it but stops short of a whole header is a broken
    // v2 file, refused by name, not a v1 file left to fail as JSON.
    if (startsWithMagic(head)) {
      fail(`the file ends before its header does: it is ${blob.size} bytes and a header is ${HEADER_BYTES}`);
    }
    return null;
  }

  const view = new DataView(head.buffer);
  const version = view.getUint32(8, true);
  if (version > CONTAINER_VERSION) {
    fail(`this file was saved by a newer ESCAPEARTIST (format version ${version}); update ESCAPEARTIST to open it`);
  }
  if (version !== CONTAINER_VERSION) {
    fail(`its header names format version ${version}, which no ESCAPEARTIST writes`);
  }
  const indexLength = view.getUint32(12, true);
  if (indexLength > MAX_INDEX_BYTES) {
    fail(`its index claims ${indexLength} bytes, over the ${MAX_INDEX_BYTES}-byte limit`);
  }
  const payloadStart = HEADER_BYTES + indexLength;
  if (payloadStart > blob.size) {
    fail(`the file ends before its index does: it is ${blob.size} bytes and its index runs to byte ${payloadStart}`);
  }

  const text = await readOrRefuse(() => blob.slice(HEADER_BYTES, payloadStart).text());
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('its index is not valid JSON');
  }
  return { index: parseIndex(parsed), payloadStart };
}

/**
 * The index's ranges, in order (each source, then its thumbnail), must tile
 * the payload exactly: no gap, no overlap, nothing out of order, ending at
 * the file's last byte. Checked before anything is written, so a truncated
 * download is refused by name rather than half-loaded.
 */
export function assertRangesTile(index: ProjectFileIndex, payloadStart: number, size: number): void {
  let expected = 0;
  index.videos.forEach((video, i) => {
    const ranges: Array<[string, ByteRange]> = video.thumbnail
      ? [['data', video.data], ['thumbnail', video.thumbnail]]
      : [['data', video.data]];
    for (const [part, range] of ranges) {
      if (range.offset !== expected) {
        fail(`video #${i}'s ${part} starts at byte ${range.offset} of the media, where byte ${expected} was expected`);
      }
      expected += range.length;
    }
  });
  const held = size - payloadStart;
  if (expected > held) {
    fail(
      `the file is incomplete: it declares ${formatSize(expected)} of media and holds ${formatSize(held, { round: 'down' })} ` +
        `(${held} of ${expected} bytes), so it was probably cut off while downloading`
    );
  }
  if (expected < held) {
    fail(`the file has ${held - expected} bytes after its last source`);
  }
}

/** One part of the payload, lazily: nothing is read until a consumer reads the slice. */
export function sliceRange(blob: Blob, payloadStart: number, range: ByteRange, type: string): Blob {
  const start = payloadStart + range.offset;
  return blob.slice(start, start + range.length, type);
}
