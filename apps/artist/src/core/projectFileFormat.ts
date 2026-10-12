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

/** A file this module refuses, or a project the writer refuses. The message is shown to the user. */
export class ProjectFileError extends Error {
  name = 'ProjectFileError';
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

/** Bytes as the user reads them: whole MiB below 1 GiB, GiB to one decimal from there. */
export function formatSize(bytes: number): string {
  return bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GiB` : `${Math.ceil(bytes / MIB)} MiB`;
}

/**
 * The parts of a v2 file, ready for `new Blob(parts)`: the header, the index
 * bytes, then every source (and its thumbnail, when it has one) by reference.
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
    if (source.thumbnail) {
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
