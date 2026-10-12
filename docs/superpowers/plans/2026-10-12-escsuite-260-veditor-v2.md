# ESCSUITE-260 `.veditor` v2 Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ESCAPEARTIST saves a project as a binary `.veditor` v2 container (16-byte header, JSON index, then the sources' raw bytes) that references the stored `Blob`s instead of reading them, and reopens it by slicing each part straight into IndexedDB. A project of any size can then be saved and reopened, limited only by the browser's download size and storage quota. v1 files still open. A load is checked against the storage estimate before anything is written, and rolled back if it fails partway. The headless kit reads both versions, and reads v2 with ranged file copies.

**Architecture:** one new pure module, `apps/artist/src/core/projectFileFormat.ts`. It holds the constants, `ProjectFileError`, the writer `encodeProjectFile` (returns `BlobPart[]` that hold the source `Blob`s by reference), and the reader halves: `isV2Header`, `readProjectFileIndex` (answers `null` for anything that is not v2, so the loader sniffs exactly once), `assertRangesTile`, `sliceRange` and the one size formatter, `formatSize`. `core/projectManager.ts` keeps its public surface (`saveProject`, `loadProject`, `extractMetadataFromBlob`, `showOpenProjectDialog`, `exportProjectMetadata`, `importProjectMetadata`, `ProjectFile`, `SourceVideoMeta`). The ESCSUITE-241 budget is deleted. `loadProject` routes v2 through the index and v1 through the unchanged JSON path. Both paths then feed one shared loop (`restoreSources`) and one shared per-source helper (`restoreSource`), so the ESCSUITE-97 recovery, the ESCSUITE-151 identity rules and the new rollback cannot drift apart. The v2 path also runs a quota pre-check before its first write. `app/useProjectActions.ts` shows a `ProjectFileError`'s message, standalone on save and as `Failed to load project: <reason>` on load. The kit's `loaders.ts` gains its own copy of the layout (it imports nothing from the apps on purpose). It sniffs the first 16 bytes, validates, checks the ranges tile, and copies each source with `fs.createReadStream({ start, end })`. Both packages pin the same literal header bytes in their tests.

**Tech Stack:** TypeScript 5.9, React 19, Zustand. Vitest 3 + Testing Library on jsdom 30. `src/test/setup.ts` swaps in Node's `Blob` and fake-indexeddb. Node 26 (`node:fs`, `node:stream/promises`) for the kit. Playwright 1.63 for the e2e spec, which CI runs. Changesets.

**Spec:** docs/superpowers/specs/2026-10-11-escsuite-260-veditor-v2-design.md

## Global Constraints

1. **Worktree and branch.** Work only in `/Users/littlemac/Projects/ESCAPESUITE-e260impl`, on `feat/escsuite-260-veditor-v2` (cut from `main` at `e0798044`). Never touch `/Users/littlemac/Projects/ESCAPESUITE` or another worktree. Run `pnpm install --offline` first if `node_modules` is missing. Never run `git stash`.
2. **Red first, and two commits per behaviour change.** Write the failing test, run it, and paste the exact failure text into your report. Commit the test (`test(...)`), then implement, run it green, and commit the implementation (`feat(...)` / `fix(...)` / `refactor(...)`). The steps below are in that order; do not reorder them.
3. **Test commands.** Artist, one file: from `apps/artist`, run `node_modules/.bin/vitest run src/<path>`. Artist, whole suite: `pnpm --filter=@escapesuite/artist exec vitest run`. Kit, one file: from `services/headless-artist`, run `node_modules/.bin/vitest run src/<path> --exclude '**/*.chromium.test.ts' --exclude '**/*.bench.test.ts'`. Kit, whole suite: `pnpm --filter=@escapesuite/headless-artist run test:run`. Types: `pnpm --filter=@escapesuite/artist exec tsc -b --noEmit` and `pnpm --filter=@escapesuite/headless-artist run typecheck`. Lint: `pnpm --filter=@escapesuite/<pkg> exec eslint .`. Run the touched package's whole suite, its typecheck and its lint at the end of every task.
4. **No coverage runs, no Playwright, no pushes, no subagents.** Do not run `test:coverage`, `test:e2e` (artist or kit: the kit's `*.chromium.test.ts` launch Chromium through Playwright), or `pnpm perf`. CI runs Task 8's Chromium case and Task 9's e2e spec. Do not edit the coverage paragraphs or table in the root `CLAUDE.md`, any `thresholds` block, or `scripts/coverage-report.mjs`.
5. **Every new conditional is reached from both sides by a test, or it is deleted.** That covers every `if`, ternary, and `&&` / `||` / `??` / `?.` operand. Each task names the cases that reach each side. The artist floors are 99 / 99 / 96 / 99. The new module must measure 100 / 100 / 100 / 100. The kit's floors are 99 / 99 / 98 / 98, with branches at 98.50, about three branches of headroom.
6. **Byte-identical files.** Every `*.perf.test.ts`, every `App.*rerender*.test.tsx` (`App.rerender.test.tsx` and its siblings), `ClipEditor.rerender.test.tsx`, `Toolbar.rerender.test.tsx` and `src/test/fixtures/perfScene.ts` must not change. Nothing here runs per frame. `App.rerender.test.tsx` imports `projectManagerDouble()` through `vi.mock`; changing the double's body (Task 4) does not change that file. Check at the end of every task:
   `git diff --name-only main -- '*.perf.test.ts' '*rerender*' 'apps/artist/src/test/fixtures/perfScene.ts'` must print nothing.
7. **Code style.** Artist source files (`.ts` under `src/` that are not tests) use semicolons, single quotes and 2-space indent. Artist test files and all kit files use no semicolons. Match the file you are in.
8. **The kit stays independent.** `services/headless-artist` imports nothing from `apps/artist` or `@escapesuite/shared`. It spells the header out itself, and drift is caught by the literal header pins in `apps/artist/src/core/projectFileFormat.test.ts` (Task 1) and `services/headless-artist/src/loaders.test.ts` (Task 7).
9. **User-visible copy.** The old sentences that go away are "This project is too large to save as a .veditor file…" and the progress text "Exporting video i/n...". `grep -rn` over `apps/e2e/tests` finds neither (verified at `e0798044`). Every new sentence is listed in the task that adds it. "Failed to load project" and "Failed to save project" stay as they are for non-format errors.
10. **Sizes are binary units, written "MiB" / "GiB"**, the convention `apps/artist/CLAUDE.md` and the ESCSUITE-241 messages already use. `formatSize(bytes)` answers `"<ceil(bytes / MiB)> MiB"` below 1 GiB and `"<(bytes / GiB).toFixed(1)> GiB"` from 1 GiB up. The quota sentence reads "This project needs 1.5 GiB of storage and this browser has 1.0 GiB free." (the spec's "1.8 GB" example, in this convention).
11. **Commit trailers.** End every commit message with a blank line and then:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU
```

12. **Line numbers** below were verified at `e0798044`. After a task edits a file, find code by the quoted text, not by line.

## Review Focus

The spec implies five input classes that its "Tests (red first)" list never names. Each is pinned to a test inside the task that owns the code. Reviewers should check that each pin exists and goes red if the code under it is broken.

1. **Non-ASCII text in the index.** A project name, a source name or a marker label outside ASCII makes the index's UTF-8 byte length differ from its JavaScript string length. If N is taken from `json.length`, the reader slices the wrong range. Pinned by Task 1's "counts the index in UTF-8 bytes, not characters" and Task 3's "round trips a project whose names and markers are not ASCII".
2. **Zero-length parts.** These are an empty stored source (a 0-byte `Blob`), a zero-byte index (N = 0), and in the kit a zero-length range (`end < start` would make Node throw). Pinned by Task 1's "gives an empty source a zero-length range", Task 2's "refuses an empty index as not JSON" and "accepts a zero-length source", Task 4's "saves and reopens a source of zero bytes", and Task 7's "writes an empty temp file for a zero-length range".
3. **Rollback triggered by something other than `storeVideo`.** That means a metadata probe that rejects after an earlier source was written, and a v1 file whose second source's base64 is invalid. The rollback lives in the shared loop, so it must fire for both. Pinned by Task 5's "rolls back when a later source's metadata probe fails" and "rolls back a v1 load too".
4. **A storage estimate that is not a plain number pair.** The cases are usage above quota (negative `available`) on a load that writes nothing new, and a present source whose declared bytes are huge. Pinned by Task 5's "accepts a load that writes nothing when usage is already over quota" and "does not count a source that is already stored".
5. **Thumbnails in a kit bundle.** The kit ignores thumbnails but must still tile their ranges, and must not copy them as sources. A misplaced thumbnail range must be refused. Pinned by Task 7's "copies each source byte for byte, forwards meta, and does not copy thumbnails" and "refuses a thumbnail range out of place".

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/artist/src/core/projectFileFormat.ts` | The v2 layout: constants, `ProjectFileError`, index types, `formatSize`, `encodeProjectFile`, `isV2Header`, `readProjectFileIndex`, `assertRangesTile`, `sliceRange` |
| `apps/artist/src/core/projectFileFormat.test.ts` | The module directly: the header pins, the writer, every refusal from both sides |
| `services/headless-artist/test/veditorV2.ts` | Test-only v2 bundle builder for the kit (`V2_HEADER_PREFIX`, `v2IndexAndPayload`, `assembleV2`) |
| `.changeset/escsuite-260-veditor-v2.md` | `@escapesuite/artist: minor`, `@escapesuite/headless-artist: minor` |

**Modified**

| File | Change |
|---|---|
| `apps/artist/src/core/projectManager.ts` | Load: sniff, the v2 path, shared `restoreSources` / `restoreSource`, quota pre-check, rollback. Save: v2 writer; the 241 budget deleted. Picker MIME key |
| `apps/artist/src/core/projectManager.test.ts` | Storage spies, v2 helpers, the 2 GiB double, v2 load / save / quota / rollback cases; the 241 suite deleted; round-trip helpers read v2 |
| `apps/artist/src/app/useProjectActions.ts` | `ProjectFileError` replaces `ProjectTooLargeError` on save; named load refusal |
| `apps/artist/src/app/useProjectActions.test.ts` | The writer-refusal describe; the named load refusal |
| `apps/artist/src/test/appDoubles.ts` | `projectManagerDouble()` drops its `ProjectTooLargeError` |
| `services/headless-artist/src/loaders.ts` | `loadBundle` sniffs; v1 and v2 share validation and materialisation; v2 tiling and ranged copies |
| `services/headless-artist/src/loaders.test.ts` | v2 suite, header pin, updated v1 version message |
| `services/headless-artist/src/run.chromium.test.ts` | v1-vs-v2 parity render |
| `apps/e2e/tests/integration/workflows.spec.ts` | Save → magic bytes → reopen through the uploader |
| `apps/artist/CLAUDE.md`, `services/headless-artist/README.md`, `CLAUDE.md` | Docs |

---

## Task 1: The format module, write side

**Files:**
- Create: `apps/artist/src/core/projectFileFormat.ts`
- Test: `apps/artist/src/core/projectFileFormat.test.ts`

**Interfaces:**
- Consumes: `type SourceVideoMeta` from `./projectManager` (type-only import; erased, so no runtime cycle). `type Project`, `type EditorBlock` from `../store/types`.
- Produces:
  - `export const MAGIC: Uint8Array` — `89 56 45 44 0D 0A 1A 0A`
  - `export const CONTAINER_VERSION = 2`
  - `export const HEADER_BYTES = 16`
  - `export const MAX_INDEX_BYTES = 64 * 1024 * 1024`
  - `export class ProjectFileError extends Error` (`name = 'ProjectFileError'`)
  - `export interface ByteRange { offset: number; length: number }`
  - `export interface ThumbnailRange extends ByteRange { mimeType: string }`
  - `export interface ProjectFileIndexVideo { id: string; name: string; mimeType: string; meta?: SourceVideoMeta; data: ByteRange; thumbnail?: ThumbnailRange }`
  - `export interface ProjectFileIndex { version: typeof CONTAINER_VERSION; project: Project; editor?: EditorBlock; videos: ProjectFileIndexVideo[] }`
  - `export interface ProjectFileSource { id: string; name: string; mimeType: string; meta?: SourceVideoMeta; blob: Blob; thumbnail?: Blob }`
  - `export function formatSize(bytes: number): string`
  - `export function encodeProjectFile(project: Project, editor: EditorBlock | undefined, sources: ProjectFileSource[], options?: { maxIndexBytes?: number }): BlobPart[]`. It returns `[header, indexBytes, source0, thumbnail0?, source1, …]`, with the source `Blob`s **by identity**.

- [ ] **Step 1: Write the failing test**

Create `apps/artist/src/core/projectFileFormat.test.ts`:

```ts
// The .veditor v2 container (ESCSUITE-260), tested directly: no storage, no
// DOM beyond Blob. src/test/setup.ts makes Node's Blob the global one.
import { describe, it, expect } from 'vitest'
import {
  CONTAINER_VERSION,
  HEADER_BYTES,
  MAGIC,
  MAX_INDEX_BYTES,
  ProjectFileError,
  encodeProjectFile,
  formatSize,
  type ProjectFileIndex,
} from './projectFileFormat'
import type { EditorBlock, Project } from '../store/types'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

const project = (name = 'P'): Project => ({
  id: 'p',
  name,
  created: 0,
  modified: 0,
  resolution: { width: 64, height: 48 },
  timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 },
})

/** A Blob that reports `size` and refuses every way of reading it. */
function untouchable(size: number, type: string): Blob {
  const blob = new Blob([], { type })
  Object.defineProperty(blob, 'size', { value: size })
  for (const read of ['arrayBuffer', 'text', 'stream', 'slice', 'bytes']) {
    Object.defineProperty(blob, read, {
      value: () => {
        throw new Error(`${read}() read a source on save`)
      },
    })
  }
  return blob
}

const indexOf = (parts: BlobPart[]): ProjectFileIndex =>
  JSON.parse(new TextDecoder().decode(parts[1] as Uint8Array)) as ProjectFileIndex

const indexLengthIn = (parts: BlobPart[]): number => {
  const header = parts[0] as Uint8Array
  return new DataView(header.buffer, header.byteOffset, HEADER_BYTES).getUint32(12, true)
}

describe('the v2 header', () => {
  it('starts with the 12 bytes the headless kit pins too (services/headless-artist/src/loaders.test.ts)', () => {
    const header = encodeProjectFile(project(), undefined, [])[0] as Uint8Array

    expect(header.length).toBe(16)
    expect(Array.from(header.subarray(0, 12))).toEqual([
      0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00,
    ])
    expect(Array.from(MAGIC)).toEqual([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(CONTAINER_VERSION).toBe(2)
    expect(HEADER_BYTES).toBe(16)
    expect(MAX_INDEX_BYTES).toBe(64 * MiB)
  })

  it('records the index length, little-endian, in bytes 12 to 16', () => {
    const parts = encodeProjectFile(project(), undefined, [])
    expect(indexLengthIn(parts)).toBe((parts[1] as Uint8Array).length)
  })

  // Review Focus 1: N is a byte count. A name outside ASCII makes it longer
  // than the JSON string, and a reader handed the string length would slice
  // the index short.
  it('counts the index in UTF-8 bytes, not characters', () => {
    const parts = encodeProjectFile(project('Café — 日本'), undefined, [])
    const json = JSON.stringify(indexOf(parts))

    expect(indexLengthIn(parts)).toBe(new TextEncoder().encode(json).length)
    expect(indexLengthIn(parts)).toBeGreaterThan(json.length)
  })
})

describe('encodeProjectFile', () => {
  const meta = { duration: 60, width: 1920, height: 1080, frameRate: 30 }

  it('hands the sources over by reference, in index order, without reading a byte of them', () => {
    const a = untouchable(200 * MiB, 'video/mp4')
    const thumbA = untouchable(64 * 1024, 'image/jpeg')
    const b = untouchable(312 * MiB, 'video/webm')

    const parts = encodeProjectFile(project(), undefined, [
      { id: 'a', name: 'a.mp4', mimeType: 'video/mp4', meta, blob: a, thumbnail: thumbA },
      { id: 'b', name: 'b.webm', mimeType: 'video/webm', meta, blob: b },
    ])

    expect(parts).toHaveLength(5)
    expect(parts[2]).toBe(a)
    expect(parts[3]).toBe(thumbA)
    expect(parts[4]).toBe(b)
    const index = indexOf(parts)
    expect(index.videos[0].data).toEqual({ offset: 0, length: 200 * MiB })
    expect(index.videos[0].thumbnail).toEqual({ offset: 200 * MiB, length: 64 * 1024, mimeType: 'image/jpeg' })
    expect(index.videos[1].data).toEqual({ offset: 200 * MiB + 64 * 1024, length: 312 * MiB })
    expect('thumbnail' in index.videos[1]).toBe(false)
  })

  it('writes the version, the project, each source\'s meta and the editor block into the index', () => {
    const editor: EditorBlock = { inPoint: 1, outPoint: 4, markers: [] }
    const parts = encodeProjectFile(project('Named'), editor, [
      { id: 'a', name: 'a.mp4', mimeType: 'video/mp4', meta, blob: new Blob([new Uint8Array([1, 2, 3])]) },
    ])

    const index = indexOf(parts)
    expect(index.version).toBe(2)
    expect(index.project.name).toBe('Named')
    expect(index.editor).toEqual(editor)
    expect(index.videos[0]).toEqual({
      id: 'a',
      name: 'a.mp4',
      mimeType: 'video/mp4',
      meta,
      data: { offset: 0, length: 3 },
    })
  })

  it('leaves the editor key out when there is no block', () => {
    expect('editor' in indexOf(encodeProjectFile(project(), undefined, []))).toBe(false)
  })

  it('writes a header and an index and nothing else for a project with no sources', () => {
    const parts = encodeProjectFile(project(), undefined, [])
    expect(parts).toHaveLength(2)
    expect(indexOf(parts).videos).toEqual([])
  })

  // Review Focus 2.
  it('gives an empty source a zero-length range and starts the next one where it started', () => {
    const parts = encodeProjectFile(project(), undefined, [
      { id: 'empty', name: 'e.mp4', mimeType: 'video/mp4', meta, blob: new Blob([], { type: 'video/mp4' }) },
      { id: 'next', name: 'n.mp4', mimeType: 'video/mp4', meta, blob: new Blob([new Uint8Array([7])]) },
    ])

    expect(indexOf(parts).videos.map((video) => video.data)).toEqual([
      { offset: 0, length: 0 },
      { offset: 0, length: 1 },
    ])
  })

  it('refuses an index over the cap, so it never writes a file its own reader would refuse', () => {
    const exact = (encodeProjectFile(project(), undefined, [])[1] as Uint8Array).length

    expect(() => encodeProjectFile(project(), undefined, [], { maxIndexBytes: exact })).not.toThrow()
    const error = (() => {
      try {
        encodeProjectFile(project(), undefined, [], { maxIndexBytes: exact - 1 })
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).name).toBe('ProjectFileError')
    expect((error as Error).message).toBe(
      `This project's index is ${exact} bytes, over the ${exact - 1}-byte limit a project file can hold.`
    )
  })
})

describe('formatSize', () => {
  it.each([
    [1, '1 MiB'],
    [MiB, '1 MiB'],
    [1.5 * MiB, '2 MiB'],
    [1023 * MiB, '1023 MiB'],
    [GiB, '1.0 GiB'],
    [1.5 * GiB, '1.5 GiB'],
    [1840 * MiB, '1.8 GiB'],
  ])('writes %d bytes as %s', (bytes, words) => {
    expect(formatSize(bytes)).toBe(words)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectFileFormat.test.ts`
Expected: the suite fails to load with `Error: Failed to resolve import "./projectFileFormat" from "src/core/projectFileFormat.test.ts". Does the file exist?`. Paste the exact text into the report.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/artist/src/core/projectFileFormat.test.ts
git commit -m "test(artist): pin the .veditor v2 header and writer (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

Create `apps/artist/src/core/projectFileFormat.ts`:

```ts
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
```

Both sides of each new conditional are reached by Step 1's cases:
- `formatSize`'s ternary: the MiB rows and the GiB rows of the `it.each`.
- `if (source.thumbnail)`: source `a` (has one) and source `b` (has none).
- `editor && { editor }`: the "writes … the editor block" case and the "leaves the editor key out" case.
- The cap: `maxIndexBytes: exact` passes and `exact - 1` throws.

- [ ] **Step 5: Run it green**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectFileFormat.test.ts` should pass every case. Then run the whole artist suite, `tsc -b --noEmit` and `eslint .` (Global Constraint 3), plus the byte-identical check (Global Constraint 6).

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/projectFileFormat.ts
git commit -m "feat(artist): the .veditor v2 container writer (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 2: The format module, read side

**Files:**
- Modify: `apps/artist/src/core/projectFileFormat.ts` (append after `encodeProjectFile`)
- Test: `apps/artist/src/core/projectFileFormat.test.ts` (replace the import block; append four describes)

**Interfaces:**
- Consumes: Task 1's constants, types, `ProjectFileError` and `formatSize`.
- Produces:
  - `export function isV2Header(bytes: Uint8Array): boolean`
  - `export async function readProjectFileIndex(blob: Blob): Promise<{ index: ProjectFileIndex; payloadStart: number } | null>`. It answers `null` when the first 16 bytes are not a v2 header, and throws `ProjectFileError` for a v2 file it refuses.
  - `export function assertRangesTile(index: ProjectFileIndex, payloadStart: number, size: number): void`
  - `export function sliceRange(blob: Blob, payloadStart: number, range: ByteRange, type: string): Blob`

The reader's refusal sentences are shown after "Failed to load project: " (Task 6), so they start in lower case:

| Refusal | Message |
|---|---|
| version > 2 | `this file was saved by a newer ESCAPEARTIST (format version 3); update ESCAPEARTIST to open it` |
| version < 2 | `its header names format version 1, which no ESCAPEARTIST writes` |
| N over cap | `its index claims 67108865 bytes, over the 67108864-byte limit` |
| 16 + N > size | `the file ends before its index does: it is 16 bytes and its index runs to byte 67108880` |
| index not JSON | `its index is not valid JSON` |
| index shape | `its index is not a version 2 project index` |
| entry | `video #0 has no id, name or type` |
| meta | `video #0's meta is not an object` |
| range | `video #0's data is not a byte range` / `video #0's thumbnail is not a byte range` |
| thumbnail type | `video #0's thumbnail has no type` |
| gap / overlap / order | `video #1's data starts at byte 2 of the media, where byte 3 was expected` |
| truncated | `the file is incomplete: it declares 3 MiB of media and holds 2 MiB (2097152 of 3145728 bytes), so it was probably cut off while downloading` |
| trailing bytes | `the file has 2 bytes after its last source` |

- [ ] **Step 1: Write the failing test**

In `apps/artist/src/core/projectFileFormat.test.ts`, replace the `import { … } from './projectFileFormat'` block with:

```ts
import {
  CONTAINER_VERSION,
  HEADER_BYTES,
  MAGIC,
  MAX_INDEX_BYTES,
  ProjectFileError,
  assertRangesTile,
  encodeProjectFile,
  formatSize,
  isV2Header,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
} from './projectFileFormat'
```

Then append to the end of the file:

```ts
/** Hand-built v2 bytes, for files the writer would never produce. */
function rawV2(
  index: unknown,
  payload: number[] = [],
  header: { version?: number; indexLength?: number } = {}
): Blob {
  const indexBytes = new TextEncoder().encode(typeof index === 'string' ? index : JSON.stringify(index))
  const head = new Uint8Array(HEADER_BYTES)
  head.set([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(head.buffer)
  view.setUint32(8, header.version ?? 2, true)
  view.setUint32(12, header.indexLength ?? indexBytes.length, true)
  return new Blob([head, indexBytes, new Uint8Array(payload)])
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'v',
  name: 'v.mp4',
  mimeType: 'video/mp4',
  data: { offset: 0, length: 3 },
  ...overrides,
})

const indexWith = (videos: unknown[]) => ({ version: 2, project: project(), videos })

async function refusal(blob: Blob): Promise<string> {
  const error = await readProjectFileIndex(blob).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ProjectFileError)
  return (error as Error).message
}

describe('isV2Header', () => {
  const header = () => Uint8Array.of(...MAGIC, 2, 0, 0, 0, 0, 0, 0, 0)

  it('knows a v2 header', () => {
    expect(isV2Header(header())).toBe(true)
  })

  it('refuses fewer than 16 bytes, however they start', () => {
    expect(isV2Header(header().subarray(0, 15))).toBe(false)
  })

  it('refuses a header one magic byte off, as a text-mode transfer leaves it', () => {
    const bytes = header()
    bytes[5] = 0x0d
    expect(isV2Header(bytes)).toBe(false)
  })
})

describe('readProjectFileIndex', () => {
  it('answers null for a v1 JSON file, so the loader takes the v1 path', async () => {
    const v1 = new Blob([JSON.stringify({ version: 1, project: project(), videos: [] })])
    await expect(readProjectFileIndex(v1)).resolves.toBeNull()
  })

  it('answers null for a file shorter than a header', async () => {
    await expect(readProjectFileIndex(new Blob(['{}']))).resolves.toBeNull()
  })

  it('reads back what the writer wrote, the payload starting right after the index', async () => {
    const meta = { duration: 9, width: 64, height: 48, frameRate: 30 }
    const parts = encodeProjectFile(project(), { inPoint: 1, outPoint: 2, markers: [] }, [
      {
        id: 'a',
        name: 'a.mp4',
        mimeType: 'video/mp4',
        meta,
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        thumbnail: new Blob([new Uint8Array([9])], { type: 'image/png' }),
      },
    ])
    const blob = new Blob(parts)

    const read = await readProjectFileIndex(blob)

    expect(read!.payloadStart).toBe(HEADER_BYTES + (parts[1] as Uint8Array).length)
    expect(read!.index.version).toBe(2)
    expect(read!.index.project.name).toBe('P')
    expect(read!.index.editor).toEqual({ inPoint: 1, outPoint: 2, markers: [] })
    expect(read!.index.videos).toEqual([
      {
        id: 'a',
        name: 'a.mp4',
        mimeType: 'video/mp4',
        meta,
        data: { offset: 0, length: 3 },
        thumbnail: { offset: 3, length: 1, mimeType: 'image/png' },
      },
    ])
    expect(() => assertRangesTile(read!.index, read!.payloadStart, blob.size)).not.toThrow()
  })

  it('hands project and editor back as it found them, for parseProject to judge', async () => {
    const read = await readProjectFileIndex(
      rawV2({ version: 2, project: { anything: true }, editor: { inPoint: 5, outPoint: 1 }, videos: [] })
    )
    expect(read!.index.project).toEqual({ anything: true })
    expect(read!.index.editor).toEqual({ inPoint: 5, outPoint: 1 })
  })

  it('refuses a newer container version by name', async () => {
    expect(await refusal(rawV2(indexWith([]), [], { version: 3 }))).toBe(
      'this file was saved by a newer ESCAPEARTIST (format version 3); update ESCAPEARTIST to open it'
    )
  })

  it('refuses a header that names a version no ESCAPEARTIST writes', async () => {
    expect(await refusal(rawV2(indexWith([]), [], { version: 1 }))).toBe(
      'its header names format version 1, which no ESCAPEARTIST writes'
    )
  })

  it('refuses an index longer than the cap before slicing it', async () => {
    expect(await refusal(rawV2('', [], { indexLength: MAX_INDEX_BYTES + 1 }))).toBe(
      `its index claims ${MAX_INDEX_BYTES + 1} bytes, over the ${MAX_INDEX_BYTES}-byte limit`
    )
  })

  it('takes an index exactly at the cap, and then refuses it for running past the end of a short file', async () => {
    expect(await refusal(rawV2('', [], { indexLength: MAX_INDEX_BYTES }))).toBe(
      `the file ends before its index does: it is 16 bytes and its index runs to byte ${16 + MAX_INDEX_BYTES}`
    )
  })

  it('refuses an index that is not JSON', async () => {
    expect(await refusal(rawV2('{oops'))).toBe('its index is not valid JSON')
  })

  // Review Focus 2.
  it('refuses an empty index as not JSON', async () => {
    expect(await refusal(rawV2(''))).toBe('its index is not valid JSON')
  })

  it.each([
    ['a list', []],
    ['an index of another version', { version: 1, project: project(), videos: [] }],
    ['an index whose videos are not a list', { version: 2, project: project(), videos: {} }],
  ])('refuses %s', async (_case, index) => {
    expect(await refusal(rawV2(index))).toBe('its index is not a version 2 project index')
  })

  it.each([
    ['a null entry', null],
    ['an id that is not a string', entry({ id: 7 })],
    ['a missing name', entry({ name: undefined })],
    ['a missing type', entry({ mimeType: undefined })],
  ])('refuses %s', async (_case, video) => {
    expect(await refusal(rawV2(indexWith([video]), [1, 2, 3]))).toBe('video #0 has no id, name or type')
  })

  it('names the entry that is broken when it is not the first', async () => {
    expect(await refusal(rawV2(indexWith([entry(), null]), [1, 2, 3]))).toBe('video #1 has no id, name or type')
  })

  it('refuses a meta that is not an object, and takes an entry with no meta', async () => {
    expect(await refusal(rawV2(indexWith([entry({ meta: 'x' })]), [1, 2, 3]))).toBe(
      "video #0's meta is not an object"
    )
    const read = await readProjectFileIndex(rawV2(indexWith([entry()]), [1, 2, 3]))
    expect(read!.index.videos[0].meta).toBeUndefined()
  })

  it.each([
    ['no data at all', undefined],
    ['a v1 base64 string', 'AAAA'],
    ['an offset that is not whole', { offset: 1.5, length: 3 }],
    ['a negative length', { offset: 0, length: -1 }],
    ['an offset past 2^53', { offset: 2 ** 53, length: 3 }],
  ])('refuses a data range that is %s', async (_case, data) => {
    expect(await refusal(rawV2(indexWith([entry({ data })]), [1, 2, 3]))).toBe("video #0's data is not a byte range")
  })

  it('refuses a thumbnail that is not a byte range', async () => {
    expect(await refusal(rawV2(indexWith([entry({ thumbnail: 'x' })]), [1, 2, 3]))).toBe(
      "video #0's thumbnail is not a byte range"
    )
  })

  it('refuses a thumbnail with no type', async () => {
    expect(
      await refusal(rawV2(indexWith([entry({ thumbnail: { offset: 3, length: 1 } })]), [1, 2, 3, 4]))
    ).toBe("video #0's thumbnail has no type")
  })
})

describe('assertRangesTile', () => {
  const tiled = (videos: ProjectFileIndex['videos']): ProjectFileIndex => ({ version: 2, project: project(), videos })
  const v = (offset: number, length: number, thumbnail?: { offset: number; length: number }) => ({
    id: 'v',
    name: 'v.mp4',
    mimeType: 'video/mp4',
    data: { offset, length },
    ...(thumbnail && { thumbnail: { ...thumbnail, mimeType: 'image/jpeg' } }),
  })
  const tileError = (index: ProjectFileIndex, payloadStart: number, size: number): string => {
    try {
      assertRangesTile(index, payloadStart, size)
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectFileError)
      return (error as Error).message
    }
    throw new Error('assertRangesTile accepted it')
  }

  it('accepts ranges that tile the payload exactly, thumbnails included', () => {
    expect(() => assertRangesTile(tiled([v(0, 3, { offset: 3, length: 2 }), v(5, 4)]), 100, 109)).not.toThrow()
  })

  it('accepts no sources and an empty payload', () => {
    expect(() => assertRangesTile(tiled([]), 100, 100)).not.toThrow()
  })

  // Review Focus 2.
  it('accepts a zero-length source', () => {
    expect(() => assertRangesTile(tiled([v(0, 0), v(0, 3)]), 100, 103)).not.toThrow()
  })

  it('refuses a gap before the first source', () => {
    expect(tileError(tiled([v(1, 3)]), 100, 104)).toBe(
      "video #0's data starts at byte 1 of the media, where byte 0 was expected"
    )
  })

  it('refuses an overlap', () => {
    expect(tileError(tiled([v(0, 3), v(2, 3)]), 100, 106)).toBe(
      "video #1's data starts at byte 2 of the media, where byte 3 was expected"
    )
  })

  it('refuses sources out of order', () => {
    expect(tileError(tiled([v(3, 2), v(0, 3)]), 100, 105)).toBe(
      "video #0's data starts at byte 3 of the media, where byte 0 was expected"
    )
  })

  it('refuses a thumbnail out of place', () => {
    expect(tileError(tiled([v(0, 3, { offset: 4, length: 1 })]), 100, 105)).toBe(
      "video #0's thumbnail starts at byte 4 of the media, where byte 3 was expected"
    )
  })

  it('names the shortfall of a truncated file', () => {
    expect(tileError(tiled([v(0, 3 * MiB)]), 100, 100 + 2 * MiB)).toBe(
      'the file is incomplete: it declares 3 MiB of media and holds 2 MiB (2097152 of 3145728 bytes), so it was probably cut off while downloading'
    )
  })

  it('names a gigabyte shortfall in GiB', () => {
    expect(tileError(tiled([v(0, 1840 * MiB)]), 100, 100 + 1203 * MiB)).toMatch(
      /^the file is incomplete: it declares 1\.8 GiB of media and holds 1\.2 GiB /
    )
  })

  it('refuses bytes after the last source', () => {
    expect(tileError(tiled([v(0, 3)]), 100, 105)).toBe('the file has 2 bytes after its last source')
  })
})

describe('sliceRange', () => {
  it('cuts one part out of the payload, in the type it is given', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])

    const part = sliceRange(blob, 4, { offset: 2, length: 3 }, 'image/png')

    expect(part.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual([6, 7, 8])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectFileFormat.test.ts`
Expected: Task 1's cases pass, and every new case fails with `TypeError: (0 , __vi_import_0__.isV2Header) is not a function` (or the same text for `readProjectFileIndex`, `assertRangesTile` or `sliceRange`). Paste one failure verbatim.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/artist/src/core/projectFileFormat.test.ts
git commit -m "test(artist): every refusal of the .veditor v2 reader, by name (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

Append to `apps/artist/src/core/projectFileFormat.ts`:

```ts
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
  return {
    version: CONTAINER_VERSION,
    // Handed back as found, as the v1 path does: `parseProject` validates both.
    project: value.project as Project,
    editor: value.editor as EditorBlock | undefined,
    videos: (value.videos as unknown[]).map(parseVideo),
  };
}

/** True when `bytes` starts with a full v2 header's magic. */
export function isV2Header(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_BYTES && MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * The index of a v2 file, and where its payload starts. Two small slices are
 * read, the header and the index, and never the payload. Answers `null` when
 * the file is not v2 (every v1 file, and anything else), so the caller sniffs
 * exactly once. A v2 file this refuses throws `ProjectFileError`.
 */
export async function readProjectFileIndex(
  blob: Blob
): Promise<{ index: ProjectFileIndex; payloadStart: number } | null> {
  const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  if (!isV2Header(head)) return null;

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

  const text = await blob.slice(HEADER_BYTES, payloadStart).text();
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
      `the file is incomplete: it declares ${formatSize(expected)} of media and holds ${formatSize(held)} ` +
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
```

Both sides of each new conditional are reached by Step 1's cases:
- `isV2Header`: `length >= 16` is false for the 15-byte case and true otherwise; `every` is false for the off-by-one case and true for the header case.
- `!isV2Header` in the reader: the v1 and `'{}'` cases return `null`; the rest go on.
- `version > 2`: version 3. `version !== 2`: version 1, and false for every accepted file.
- The cap: `MAX_INDEX_BYTES + 1` is refused; exactly `MAX_INDEX_BYTES` passes it, then the past-the-end check refuses it (a 16-byte file).
- The past-the-end check is false for every accepted file.
- The JSON `catch`: `'{oops'` and `''`.
- `parseIndex`'s three operands: the list, version 1, and videos `{}`.
- `parseVideo`'s four operands: `null`, `id: 7`, a missing name, a missing type.
- `meta !== undefined && !isRecord(meta)`: `meta: 'x'` (true/true); the no-meta entry (first operand false); the writer round trip (true/false).
- `readRange`'s operands: data missing, `'AAAA'`, offset 1.5, length -1, offset 2^53. `isByteCount`'s `&&`: 1.5 (first operand false), -1 (second false), valid (both true).
- `thumbnail !== undefined`: the writer round trip and the no-thumbnail entries.
- `typeof mimeType !== 'string'`: the thumbnail-with-no-type case, and the round trip.
- The tiling ternary: the cases with and without thumbnails.
- `offset !== expected`: gap, overlap, order and thumbnail.
- `expected > held`: the two truncation cases.
- `expected < held`: the trailing case.

- [ ] **Step 5: Run it green**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectFileFormat.test.ts`, all passing. Then the whole artist suite, `tsc -b --noEmit`, `eslint .` and the byte-identical check.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/projectFileFormat.ts
git commit -m "feat(artist): the .veditor v2 container reader: sniff, index, tiling, slices (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 3: `loadProject` reads v2 through one shared per-source helper

The loader comes before the writer. When Task 4 switches the writer to v2, every save-then-load test in `projectManager.test.ts` must already be able to read what it writes.

**Files:**
- Modify: `apps/artist/src/core/projectManager.ts`. Lines 3-5 (imports); line 54 (`CURRENT_VERSION`); lines 282-452 (`/** Load project from a file */` through the end of `loadProject`); line 589 (`exportProjectMetadata`'s `version: CURRENT_VERSION`); line 163 (`saveProject`'s `version: CURRENT_VERSION`).
- Test: `apps/artist/src/core/projectManager.test.ts`. Lines 1-27 (imports and the storage mock); new top-level helpers after line 83; a new describe after the `loadProject` describe (which ends at line 690).

**Interfaces:**
- Consumes: Task 2's `readProjectFileIndex`, `assertRangesTile`, `sliceRange`, `type ProjectFileIndex`.
- Produces, all module-private in `projectManager.ts`:
  - `const JSON_FILE_VERSION = 1` (rename of `CURRENT_VERSION`)
  - `interface SourceEntry { id: string; name: string; mimeType: string; meta?: SourceVideoMeta }`
  - `type StoredSource = Awaited<ReturnType<typeof getVideo>>`
  - `interface LoadedFile { project: Project; editor?: unknown; sourceVideos: SourceVideo[] }`
  - `async function restoreSource(entry: SourceEntry, blob: Blob, thumbnail: Blob | undefined, existing: StoredSource): Promise<SourceVideo>`
  - `async function restoreSources(count: number, restoreOne: (i: number) => Promise<SourceVideo>, onProgress?: (progress: number, message: string) => void): Promise<SourceVideo[]>`
  - `async function loadJsonFile(file: File, onProgress?): Promise<LoadedFile>`
  - `async function loadContainer(file: File, index: ProjectFileIndex, payloadStart: number, onProgress?): Promise<LoadedFile>`
  - `loadProject`'s signature and return shape are unchanged: `(file: File, onProgress?) => Promise<{ project: Project; sourceVideos: SourceVideo[]; editor?: unknown }>`.

- [ ] **Step 1: Write the failing tests**

In `apps/artist/src/core/projectManager.test.ts`:

(a) Replace lines 1-27 (from `import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'` through the closing `})` of `vi.mock('./storage', …)`) with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import {
  exportProjectMetadata,
  extractMetadataFromBlob,
  importProjectMetadata,
  loadProject,
  saveProject,
  showOpenProjectDialog,
  MAX_PROJECT_FILE_BASE64_BYTES,
  ProjectTooLargeError,
  type ProjectFile,
  type SourceVideoMeta,
} from './projectManager'
import { HEADER_BYTES, MAX_INDEX_BYTES, ProjectFileError, encodeProjectFile } from './projectFileFormat'
// The real storage layer, running on the fake-indexeddb installed by
// src/test/setup.ts — save/load really round-trips through IndexedDB here.
import { parseProject } from '../store/projectMigration'
import { deleteVideo, getAllVideoMetadata, getThumbnail, getVideo, storeThumbnail, storeVideo } from './storage'
import type { EditorBlock, Project, SourceVideo } from '../store/types'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { lastObjectUrl } from '../test/objectUrls'
import { installFileReaderDouble } from '../test/doubles/fileReader'

// Pass-through spies, so a test can see (and, for the 2 GiB and quota cases,
// fake) what save and load ask storage for. Everything else is the real layer.
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>()
  return {
    ...actual,
    getVideo: vi.fn(actual.getVideo),
    getThumbnail: vi.fn(actual.getThumbnail),
    storeVideo: vi.fn(actual.storeVideo),
    storeThumbnail: vi.fn(actual.storeThumbnail),
    deleteVideo: vi.fn(actual.deleteVideo),
    getStorageEstimate: vi.fn(actual.getStorageEstimate),
  }
})
```

(`MAX_PROJECT_FILE_BASE64_BYTES`, `ProjectTooLargeError`, `installFileReaderDouble` and `Mock` stay for now. Task 4 removes them together with the 241 suite. Import only what this task's tests use: `tsconfig.test.json` extends `noUnusedLocals`, so an unused import fails `tsc -b`. Task 4 adds `readProjectFileIndex`, `sliceRange` and `type ProjectFileIndex`, and Task 5 adds `getStorageEstimate`.)

(b) Insert these top-level helpers right after `decodeBase64` (after line 83):

```ts
const MiB = 1024 * 1024
const GiB = 1024 * MiB

/** A Blob that reports `size` and refuses every way of reading it. */
function untouchable(size: number, type: string): Blob {
  const blob = new Blob([], { type })
  Object.defineProperty(blob, 'size', { value: size })
  for (const read of ['arrayBuffer', 'text', 'stream', 'slice', 'bytes']) {
    Object.defineProperty(blob, read, {
      value: () => {
        throw new Error(`${read}() read a source`)
      },
    })
  }
  return blob
}

/**
 * A File the loader can slice, built from the writer's parts. Node's File:
 * src/test/setup.ts makes Node's Blob the global one, and jsdom's File would
 * turn a Node Blob part into the text "[object Blob]".
 */
const fileOf = (parts: BlobPart[], name = 'project.veditor'): File =>
  new NodeFile(parts as ConstructorParameters<typeof NodeFile>[0], name) as unknown as File

interface V2Source {
  id: string
  name?: string
  mimeType?: string
  meta?: SourceVideoMeta
  bytes: number[]
  thumbnail?: { bytes: number[]; type: string }
}

/** A v2 `.veditor` written by the real writer over real bytes. */
function v2File(project: Project, sources: V2Source[], editor?: EditorBlock): File {
  return fileOf(
    encodeProjectFile(
      project,
      editor,
      sources.map((source) => {
        const mimeType = source.mimeType ?? 'video/mp4'
        return {
          id: source.id,
          name: source.name ?? `${source.id}.mp4`,
          mimeType,
          meta: source.meta,
          blob: new Blob([new Uint8Array(source.bytes)], { type: mimeType }),
          thumbnail:
            source.thumbnail && new Blob([new Uint8Array(source.thumbnail.bytes)], { type: source.thumbnail.type }),
        }
      })
    )
  )
}

/** Hand-built v2 bytes, for files the writer would never produce. */
function rawV2File(
  index: unknown,
  payload: number[] = [],
  header: { version?: number; indexLength?: number } = {}
): File {
  const indexBytes = new TextEncoder().encode(typeof index === 'string' ? index : JSON.stringify(index))
  const head = new Uint8Array(HEADER_BYTES)
  head.set([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(head.buffer)
  view.setUint32(8, header.version ?? 2, true)
  view.setUint32(12, header.indexLength ?? indexBytes.length, true)
  return fileOf([head, indexBytes, new Uint8Array(payload)])
}

/**
 * A `.veditor` as large as its parts claim, without the bytes. `slice` hands
 * back the real header and index. Any other range returns an empty marker
 * Blob and is recorded, so a test can see exactly which ranges the loader cut
 * and that it never read the file whole.
 */
function virtualV2File(parts: BlobPart[]) {
  const header = parts[0] as Uint8Array
  const indexBytes = parts[1] as Uint8Array
  const payloadStart = HEADER_BYTES + indexBytes.length
  const size = payloadStart + parts.slice(2).reduce<number>((sum, part) => sum + (part as Blob).size, 0)
  const cuts: Array<{ start: number; end: number; type: string; marker: Blob }> = []
  const wholeReads: string[] = []
  const file = {
    name: 'huge.veditor',
    type: '',
    size,
    slice(start = 0, end = size, type = '') {
      if (start === 0 && end === HEADER_BYTES) return new Blob([header])
      if (start === HEADER_BYTES && end === payloadStart) return new Blob([indexBytes])
      const marker = new Blob([], { type })
      cuts.push({ start, end, type, marker })
      return marker
    },
    text: () => {
      wholeReads.push('text')
      return Promise.reject(new Error('read the whole file'))
    },
    arrayBuffer: () => {
      wholeReads.push('arrayBuffer')
      return Promise.reject(new Error('read the whole file'))
    },
    stream: () => {
      wholeReads.push('stream')
      throw new Error('read the whole file')
    },
  }
  return { file: file as unknown as File, cuts, wholeReads, payloadStart }
}
```

(c) Insert this describe right after the `loadProject` describe (after its closing `})` at line 690):

```ts
describe('loadProject, version 2 (ESCSUITE-260)', () => {
  let media: MediaDoubles
  const meta = (overrides: Partial<SourceVideoMeta> = {}): SourceVideoMeta => ({
    duration: 12,
    width: 640,
    height: 360,
    frameRate: 24,
    ...overrides,
  })

  beforeEach(() => {
    media = installMediaElementDoubles({ video: { duration: 42, videoWidth: 1280, videoHeight: 720 } })
    vi.mocked(storeVideo).mockClear()
    vi.mocked(storeThumbnail).mockClear()
  })

  afterEach(() => {
    media.uninstall()
  })

  it('reads the bytes, meta, editor block, crop and the thumbnail in its own type', async () => {
    const id = uniqueId('v2')
    const project = createTestProject(id)
    project.timeline.clips[0].crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }
    const editor: EditorBlock = { inPoint: 1, outPoint: 4, markers: [] }
    const file = v2File(
      project,
      [
        {
          id,
          name: 'clip.webm',
          mimeType: 'video/webm',
          meta: meta({ waveformData: [{ min: -1, max: 1 }] }),
          bytes: [0, 1, 255],
          thumbnail: { bytes: [9, 8, 7], type: 'image/png' },
        },
      ],
      editor
    )

    const progress: Array<[number, string]> = []
    const loaded = await loadProject(file, (p, m) => progress.push([p, m]))

    expect(loaded.project.timeline.clips[0].crop).toEqual({ left: 0.25, top: 0.1, right: 0, bottom: 0 })
    expect(loaded.project.modified).toBeGreaterThan(1234567890000)
    expect(loaded.editor).toEqual(editor)
    expect(loaded.sourceVideos[0]).toMatchObject({
      id,
      name: 'clip.webm',
      mimeType: 'video/webm',
      duration: 12,
      width: 640,
      height: 360,
      frameRate: 24,
      size: 3,
      waveformData: [{ min: -1, max: 1 }],
    })
    expect(loaded.sourceVideos[0].thumbnailUrl).toBe(lastObjectUrl())
    const stored = await getVideo(id)
    expect(Array.from(new Uint8Array(await stored!.blob.arrayBuffer()))).toEqual([0, 1, 255])
    expect(stored!.blob.type).toBe('video/webm')
    const thumb = await getThumbnail(id)
    expect(Array.from(new Uint8Array(await thumb!.arrayBuffer()))).toEqual([9, 8, 7])
    expect(thumb!.type).toBe('image/png') // v1 always wrote image/jpeg
    expect(media.videos).toHaveLength(0)
    expect(progress[0]).toEqual([0, 'Reading project file...'])
    expect(progress).toContainEqual([10, 'Restoring videos...'])
    expect(progress).toContainEqual([90, 'Restoring video 1/1...'])
    expect(progress[progress.length - 1]).toEqual([100, 'Project loaded!'])

    await deleteVideo(id)
  })

  it('loads a v2 project that holds no sources', async () => {
    const loaded = await loadProject(v2File(createTestProject('none'), []))
    expect(loaded.sourceVideos).toEqual([])
    expect(loaded.editor).toBeUndefined()
  })

  // Review Focus 1.
  it('round trips a project whose names and markers are not ASCII', async () => {
    const id = uniqueId('unicode')
    const project = { ...createTestProject(id), name: 'Café — 日本' }
    const editor: EditorBlock = {
      inPoint: null,
      outPoint: null,
      markers: [{ id: 'm', time: 1, label: 'Ünïcødé ✓', color: '#ffcc00' }],
    }

    const loaded = await loadProject(v2File(project, [{ id, name: 'クリップ.mp4', meta: meta(), bytes: [4, 5] }], editor))

    expect(loaded.project.name).toBe('Café — 日本')
    expect(loaded.editor).toEqual(editor)
    expect(loaded.sourceVideos[0].name).toBe('クリップ.mp4')
    expect(Array.from(new Uint8Array(await (await getVideo(id))!.blob.arrayBuffer()))).toEqual([4, 5])

    await deleteVideo(id)
  })

  it('loads a 2 GiB file by slicing it, never reading it whole', async () => {
    const a = uniqueId('huge-a')
    const b = uniqueId('huge-b')
    const { file, cuts, wholeReads, payloadStart } = virtualV2File(
      encodeProjectFile(createTestProject(a), undefined, [
        {
          id: a,
          name: 'a.mp4',
          mimeType: 'video/mp4',
          meta: meta(),
          blob: untouchable(1536 * MiB, 'video/mp4'),
          thumbnail: untouchable(MiB, 'image/jpeg'),
        },
        { id: b, name: 'b.webm', mimeType: 'video/webm', meta: meta(), blob: untouchable(511 * MiB, 'video/webm') },
      ])
    )
    expect(file.size - payloadStart).toBe(2 * GiB)
    vi.mocked(storeVideo).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    vi.mocked(storeThumbnail).mockResolvedValueOnce(undefined)

    const { sourceVideos } = await loadProject(file)

    expect(wholeReads).toEqual([])
    expect(cuts.map(({ start, end, type }) => ({ start, end, type }))).toEqual([
      { start: payloadStart, end: payloadStart + 1536 * MiB, type: 'video/mp4' },
      { start: payloadStart + 1536 * MiB, end: payloadStart + 1537 * MiB, type: 'image/jpeg' },
      { start: payloadStart + 1537 * MiB, end: payloadStart + 2048 * MiB, type: 'video/webm' },
    ])
    expect(vi.mocked(storeVideo).mock.calls.map(([id, blob]) => [id, blob])).toEqual([
      [a, cuts[0].marker],
      [b, cuts[2].marker],
    ])
    expect(vi.mocked(storeVideo).mock.calls[0][1]).toBe(cuts[0].marker)
    expect(vi.mocked(storeVideo).mock.calls[1][1]).toBe(cuts[2].marker)
    expect(vi.mocked(storeThumbnail).mock.calls).toEqual([[a, cuts[1].marker]])
    expect(vi.mocked(storeThumbnail).mock.calls[0][1]).toBe(cuts[1].marker)
    expect(sourceVideos.map((source) => source.id)).toEqual([a, b])
  })

  it('resurrects bytes but not CRAFT take identity for a source CRAFT no longer has (ESCSUITE-151)', async () => {
    const id = uniqueId('v2-deleted-take')
    const take: SourceVideo = {
      id,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
      overlayPlacement: { position: 'bottom-right', size: 0.25, shape: 'circle' },
      hasWebcam: true,
    }
    await storeVideo(id, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), take)
    await deleteVideo(id)

    const takeMeta: SourceVideoMeta = {
      duration: take.duration,
      width: take.width,
      height: take.height,
      frameRate: take.frameRate,
      mediaType: take.mediaType,
      source: take.source,
      takeId: take.takeId,
      role: take.role,
      startOffset: take.startOffset,
      overlayPlacement: take.overlayPlacement,
      hasWebcam: take.hasWebcam,
    }
    const { sourceVideos } = await loadProject(
      v2File(createTestProject(id), [{ id, name: take.name, mimeType: take.mimeType, meta: takeMeta, bytes: [1, 2, 3] }])
    )

    expect(sourceVideos[0].source).toBeUndefined()
    expect(sourceVideos[0].takeId).toBeUndefined()
    expect(sourceVideos[0].role).toBeUndefined()
    expect(sourceVideos[0].startOffset).toBeUndefined()
    expect(sourceVideos[0].overlayPlacement).toBeUndefined()
    expect(sourceVideos[0].duration).toBe(12)
    expect(sourceVideos[0].hasWebcam).toBe(true)
    const restored = (await getAllVideoMetadata()).find((v) => v.id === id)
    expect(restored!.source).toBeUndefined()
    expect(restored!.takeId).toBeUndefined()

    await deleteVideo(id)
  })

  it("keeps a present source's own CRAFT identity and writes nothing for it (ESCSUITE-151)", async () => {
    const id = uniqueId('v2-present')
    const stored: SourceVideo = {
      id,
      name: 'take.webm',
      duration: 12,
      width: 1280,
      height: 720,
      frameRate: 24,
      mimeType: 'video/webm',
      size: 3,
      mediaType: 'video',
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
      hasWebcam: true,
    }
    await storeVideo(id, new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), stored)
    vi.mocked(storeVideo).mockClear()

    const { sourceVideos } = await loadProject(
      v2File(createTestProject(id), [
        {
          id,
          name: 'take.webm',
          mimeType: 'video/webm',
          meta: meta({ duration: 20, frameRate: 30, waveformData: [{ min: -1, max: 1 }] }),
          bytes: [1, 2, 3],
          thumbnail: { bytes: [5], type: 'image/jpeg' },
        },
      ])
    )

    expect(sourceVideos[0]).toMatchObject({
      duration: 20,
      frameRate: 30,
      waveformData: [{ min: -1, max: 1 }],
      source: 'recording',
      takeId: id,
      role: 'screen',
      startOffset: 0,
    })
    expect(storeVideo).not.toHaveBeenCalled()
    expect(storeThumbnail).not.toHaveBeenCalled()
    expect((await getVideo(id))!.metadata).toEqual(stored)

    await deleteVideo(id)
  })

  it('sends a file whose magic is one byte off down the v1 path, where it fails as JSON', async () => {
    const bytes = new Uint8Array(
      await rawV2File({ version: 2, project: createTestProject('x'), videos: [] }).arrayBuffer()
    )
    bytes[3] = 0x45 // 'E' where the magic has 'D'

    const error = await loadProject(fileOf([bytes])).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SyntaxError)
    expect(error).not.toBeInstanceOf(ProjectFileError)
    expect(storeVideo).not.toHaveBeenCalled()
  })

  const refusedId = 'refused'
  const indexWith = (videos: unknown[]) => ({ version: 2, project: createTestProject(refusedId), videos })
  const one = (data: unknown) => [{ id: refusedId, name: 'v.mp4', mimeType: 'video/mp4', data }]

  it.each([
    ['a newer container version', () => rawV2File(indexWith([]), [], { version: 3 }), /newer ESCAPEARTIST/],
    [
      'an index longer than the cap',
      () => rawV2File('', [], { indexLength: MAX_INDEX_BYTES + 1 }),
      /over the 67108864-byte limit/,
    ],
    ['an index past the end of the file', () => rawV2File('{}', [], { indexLength: 4096 }), /ends before its index does/],
    ['an index that is not JSON', () => rawV2File('{oops'), /not valid JSON/],
    [
      'a range that is not a safe integer',
      () => rawV2File(indexWith(one({ offset: 0, length: 2 ** 53 })), [1, 2, 3]),
      /data is not a byte range/,
    ],
    ['a gap', () => rawV2File(indexWith(one({ offset: 1, length: 2 })), [1, 2, 3]), /starts at byte 1 of the media/],
    [
      'an overlap',
      () =>
        rawV2File(
          indexWith([...one({ offset: 0, length: 3 }), { id: 'other', name: 'o.mp4', mimeType: 'video/mp4', data: { offset: 2, length: 1 } }]),
          [1, 2, 3, 4]
        ),
      /video #1's data starts at byte 2/,
    ],
    [
      'sources out of order',
      () =>
        rawV2File(
          indexWith([...one({ offset: 1, length: 3 }), { id: 'other', name: 'o.mp4', mimeType: 'video/mp4', data: { offset: 0, length: 1 } }]),
          [1, 2, 3, 4]
        ),
      /video #0's data starts at byte 1/,
    ],
    [
      'a truncated payload',
      () => rawV2File(indexWith(one({ offset: 0, length: 10 })), [1, 2, 3]),
      /\(3 of 10 bytes\), so it was probably cut off while downloading/,
    ],
    ['trailing junk', () => rawV2File(indexWith(one({ offset: 0, length: 3 })), [1, 2, 3, 4, 5]), /2 bytes after its last source/],
  ])('refuses %s by name, and writes nothing', async (_case, build, reason) => {
    const error = await loadProject(build()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as Error).message).toMatch(reason)
    expect(storeVideo).not.toHaveBeenCalled()
    expect(storeThumbnail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts`
Expected: every existing case passes. Every new v2 case except "sends a file whose magic is one byte off …" fails. The loader today calls `file.text()` and `JSON.parse` on the binary file, so it throws `SyntaxError: Unexpected token '�', "�VED…" is not valid JSON`. The refusal table fails with `expected SyntaxError … to be an instance of ProjectFileError`. The 2 GiB case fails because `text()` was recorded (`expected [ 'text' ] to deeply equal []`, or the rejection "read the whole file"). Paste one of each.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/artist/src/core/projectManager.test.ts
git commit -m "test(artist): loadProject reads a .veditor v2 file by slicing it (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

In `apps/artist/src/core/projectManager.ts`:

(a) Replace lines 3-5 with:

```ts
import type { Project, SourceVideo, Clip, EditorBlock } from '../store/types';
import { getVideo, storeVideo, storeThumbnail, getThumbnail, resolveThumbnailUrl } from './storage';
import { loadMediaDuration, resolveStoredDuration } from './videoProcessor';
import { assertRangesTile, readProjectFileIndex, sliceRange, type ProjectFileIndex } from './projectFileFormat';
```

(b) Replace line 54, `const CURRENT_VERSION = 1;`, with:

```ts
/**
 * The version a v1 (JSON) `.veditor` declares. The writer produces v2
 * (`projectFileFormat.ts`); this is what the v1 loader accepts and what
 * `exportProjectMetadata`'s metadata-only JSON still says.
 */
const JSON_FILE_VERSION = 1;
```

Then change the two remaining uses: `version: CURRENT_VERSION,` in `saveProject` (line 163) and `version: CURRENT_VERSION,` in `exportProjectMetadata` (line 589) both become `version: JSON_FILE_VERSION,`. Task 4 deletes the `saveProject` one.

(c) Replace lines 282-452, from the `/**` above `export async function loadProject(` through the closing `}` of `loadProject` (the line after `return { project, sourceVideos, editor: projectFile.editor };`), with:

```ts
/** What either file version says about one source, beside its bytes. */
interface SourceEntry {
  id: string;
  name: string;
  mimeType: string;
  meta?: SourceVideoMeta;
}

/** The row already in the shared DB under a source's id, if there is one. */
type StoredSource = Awaited<ReturnType<typeof getVideo>>;

/** A file's contents once its sources are restored, before `loadProject` stamps `modified`. */
interface LoadedFile {
  project: Project;
  editor?: unknown;
  sourceVideos: SourceVideo[];
}

/**
 * Restore one source from either file version (ESCSUITE-260): `blob` is the
 * source's bytes, decoded from v1 base64 or sliced out of a v2 payload, and
 * `thumbnail` likewise. One helper for both versions, so the metadata
 * recovery and the identity rules below cannot drift between them.
 *
 * `existing` is the row already stored under this id, looked up by the
 * caller. A `.veditor` load restores the bytes ARTIST needs; it is not
 * authority over metadata it does not own (ESCSUITE-151). It decides two
 * things below: which five fields describe CRAFT's take identity, and whether
 * this source's bytes and thumbnail are written to the DB at all.
 */
async function restoreSource(
  entry: SourceEntry,
  blob: Blob,
  thumbnail: Blob | undefined,
  existing: StoredSource
): Promise<SourceVideo> {
  // A file saved since ESCSUITE-97 carries the live SourceVideo's own
  // fields in `meta`: waveform peaks, take identity, the real frame rate.
  // Those are trusted in preference to a blob probe. But `meta` came out of
  // `JSON.parse`, not the type checker: a hand-edited or corrupted file can
  // still carry a `duration`/`width`/`height` that is not a usable number
  // (review round 1), so each is validated and, only when it fails, recovered
  // from the blob rather than stored unquestioned. The common case, a `meta`
  // written by this same `saveProject`, never touches the blob at all. This
  // runs the same way whether or not `existing` is set: a present source's
  // own duration, dimensions and waveform are still worth restoring from the
  // file being reopened. Review round 1 tried reusing `existing.metadata`
  // wholesale instead, which silently dropped a reopened CRAFT take's
  // waveform (CRAFT never computes one) and let a stored non-finite duration
  // bypass this same recovery.
  //
  // An older file has no `meta` at all. If this id is already in the shared
  // DB, the stored record is still strictly more than a blob probe can ever
  // recover (waveform peaks, `hasAudio`, `recordedAt`), so it is trusted over
  // re-probing (review round 2). "Trusted" still means run through the same
  // `resolveStoredDuration`/`resolveMetaDimensions` recovery the `meta`
  // branch uses, not copied unquestioned: the stored record can itself carry
  // a `duration: Infinity` or an unusable dimension (review round 3). Only a
  // source this DB has never heard of falls back to reconstructing
  // everything from the blob, through `extractMetadataFromBlob`.
  let metadata: SourceVideo;
  if (entry.meta) {
    const duration = await resolveStoredDuration(blob, {
      ...entry.meta,
      name: entry.name,
    } as SourceVideo);
    const { width, height } = await resolveMetaDimensions(blob, entry.meta, entry);
    metadata = {
      ...entry.meta,
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: blob.size,
      duration,
      width,
      height,
    };
  } else if (existing) {
    const duration = await resolveStoredDuration(blob, existing.metadata);
    const { width, height } = await resolveMetaDimensions(blob, existing.metadata, existing.metadata);
    metadata = { ...existing.metadata, duration, width, height };
  } else {
    metadata = await extractMetadataFromBlob(blob, entry);
  }

  // A stored thumbnail (below) is the only legitimate source of a live
  // `thumbnailUrl`, never a value that arrived in the file itself. `meta` is
  // typed to exclude `thumbnailUrl`, but nothing stops a hand-edited file
  // from smuggling one in through the spread above, and it must not reach
  // IndexedDB via `storeVideo` (ESCSUITE-96 is exactly the failure a stale
  // `blob:` handle in storage causes) or survive into the returned
  // `SourceVideo` when the file has no real thumbnail (review round 1).
  delete metadata.thumbnailUrl;

  if (existing) {
    // CRAFT's take identity belongs to whatever is already stored under this
    // id, never to the file: these five fields are the only ones
    // `source: 'recording'` means anything for (apps/craft/src/core/storage.ts),
    // and a `.veditor` carrying an identical-looking `meta` must not be able
    // to assert them over what CRAFT, or an earlier load, actually wrote
    // (ESCSUITE-151).
    metadata.source = existing.metadata.source;
    metadata.takeId = existing.metadata.takeId;
    metadata.role = existing.metadata.role;
    metadata.startOffset = existing.metadata.startOffset;
    metadata.overlayPlacement = existing.metadata.overlayPlacement;
    // A `blob:` handle never survives a reload on its own (ESCSUITE-96), so
    // it is refreshed from what is actually stored. The file's own thumbnail
    // is not written for an id already present.
    metadata.thumbnailUrl = await resolveThumbnailUrl(entry.id);
  } else {
    // Not in the shared DB, so restoring it resurrects a copy under an
    // identity CRAFT no longer recognises as live. `source: 'recording'`
    // would put a take the user deleted in CRAFT back into CRAFT's library,
    // and `takeId`/`role`/`startOffset`/`overlayPlacement` describe a take
    // group this copy is not part of (ESCSUITE-151). Cleared outright, not
    // set to `'import'`: ARTIST's own importers never write a `source`.
    delete metadata.source;
    delete metadata.takeId;
    delete metadata.role;
    delete metadata.startOffset;
    delete metadata.overlayPlacement;

    await storeVideo(entry.id, blob, metadata);
    if (thumbnail) {
      await storeThumbnail(entry.id, thumbnail);
      metadata.thumbnailUrl = await resolveThumbnailUrl(entry.id);
    }
  }

  return metadata;
}

/** The restore loop both file versions share, with its progress reports. */
async function restoreSources(
  count: number,
  restoreOne: (i: number) => Promise<SourceVideo>,
  onProgress?: (progress: number, message: string) => void
): Promise<SourceVideo[]> {
  onProgress?.(10, 'Restoring videos...');
  const restored: SourceVideo[] = [];
  for (let i = 0; i < count; i++) {
    onProgress?.(10 + ((i + 1) / count) * 80, `Restoring video ${i + 1}/${count}...`);
    restored.push(await restoreOne(i));
  }
  return restored;
}

/**
 * A v1 file: one JSON document with every source base64-encoded inside it.
 * Unchanged since before ESCSUITE-260 except that each source now goes
 * through the shared `restoreSource`.
 */
async function loadJsonFile(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<LoadedFile> {
  const projectFile: ProjectFile = JSON.parse(await file.text());

  if (projectFile.version > JSON_FILE_VERSION) {
    throw new Error(
      `Project file version ${projectFile.version} is newer than supported version ${JSON_FILE_VERSION}`
    );
  }

  const sourceVideos = await restoreSources(
    projectFile.videos.length,
    async (i) => {
      const videoData = projectFile.videos[i];
      const blob = base64ToBlob(videoData.data, videoData.mimeType);
      // v1 never recorded a thumbnail's type; every one ESCAPEARTIST wrote was a JPEG.
      const thumbnail = videoData.thumbnail ? base64ToBlob(videoData.thumbnail, 'image/jpeg') : undefined;
      return restoreSource(videoData, blob, thumbnail, await getVideo(videoData.id));
    },
    onProgress
  );
  return { project: projectFile.project, editor: projectFile.editor, sourceVideos };
}

/**
 * A v2 container (ESCSUITE-260). The ranges are checked before anything is
 * written, and each part is a lazy slice of `file`, handed straight to
 * storage and to the metadata probes. A source never enters the JS heap.
 */
async function loadContainer(
  file: File,
  index: ProjectFileIndex,
  payloadStart: number,
  onProgress?: (progress: number, message: string) => void
): Promise<LoadedFile> {
  assertRangesTile(index, payloadStart, file.size);
  const existing = await Promise.all(index.videos.map((video) => getVideo(video.id)));

  const sourceVideos = await restoreSources(
    index.videos.length,
    async (i) => {
      const video = index.videos[i];
      const blob = sliceRange(file, payloadStart, video.data, video.mimeType);
      const thumbnail = video.thumbnail
        ? sliceRange(file, payloadStart, video.thumbnail, video.thumbnail.mimeType)
        : undefined;
      return restoreSource(video, blob, thumbnail, existing[i]);
    },
    onProgress
  );
  return { project: index.project, editor: index.editor, sourceVideos };
}

/**
 * Load a project from a `.veditor` file of either version. The first 16 bytes
 * decide: a v2 header goes through the index and slices, and anything else
 * takes the v1 path. A v2 file this refuses throws `ProjectFileError`.
 */
export async function loadProject(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<{ project: Project; sourceVideos: SourceVideo[]; editor?: unknown }> {
  onProgress?.(0, 'Reading project file...');

  const container = await readProjectFileIndex(file);
  const loaded = container
    ? await loadContainer(file, container.index, container.payloadStart, onProgress)
    : await loadJsonFile(file, onProgress);

  onProgress?.(95, 'Finalizing...');

  const project: Project = {
    ...loaded.project,
    modified: Date.now(),
  };

  onProgress?.(100, 'Project loaded!');

  // Handed back as found: `parseProject` validates it (a file is untrusted).
  return { project, sourceVideos: loaded.sourceVideos, editor: loaded.editor };
}
```

Both sides of each new conditional are reached:
- `container ?`: every v2 case and every existing v1 case.
- v1's `videoData.thumbnail ?`: the existing "restores a thumbnail" v1 case, and every v1 case without one.
- v2's `video.thumbnail ?`: the first v2 case and the 2 GiB case (`a`), and source `b` in the 2 GiB case.
- `restoreSource`'s three-way metadata choice and its `existing` branch keep their existing v1 cases, now joined by the v2 identity cases.

- [ ] **Step 5: Run it green**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts`, all passing (the v1 suites unchanged). Then the whole artist suite, `tsc -b --noEmit`, `eslint .` and the byte-identical check.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/projectManager.ts
git commit -m "feat(artist): loadProject reads .veditor v2 by slicing it, through one per-source helper shared with v1 (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 4: `saveProject` writes v2 and the ESCSUITE-241 budget goes

**Files:**
- Modify: `apps/artist/src/core/projectManager.ts`. Imports; lines 56-132 (`MAX_PROJECT_FILE_BASE64_BYTES` through `blobToBase64`); `saveProject` (lines 146-250).
- Modify: `apps/artist/src/app/useProjectActions.ts` (line 20 import; lines 99-103 and 217-221).
- Modify: `apps/artist/src/test/appDoubles.ts` (`projectManagerDouble`, lines 83-102).
- Test: `apps/artist/src/core/projectManager.test.ts`. Imports; delete `decodeBase64` and the 241 describe (lines 128-312); replace the `saveProject` describe (lines 314-429); edit the ESCSUITE-97 describe (lines 692-~1167) and the editor-block describe (lines 1341-1413).
- Test: `apps/artist/src/app/useProjectActions.test.ts` (line 11 import; lines 105-157).

**Interfaces:**
- Consumes: `encodeProjectFile`, `type ProjectFileSource`, `ProjectFileError`, `readProjectFileIndex`, `sliceRange`.
- Produces: `saveProject(project, sourceVideos, onProgress?, editor?): Promise<void>` (signature unchanged). It downloads `new Blob(encodeProjectFile(...), { type: 'application/octet-stream' })`. Progress: `(0, 'Preparing project data...')`, `(90, 'Creating project file...')`, `(100, 'Project saved!')`. No "Exporting" step.
- Deleted: `MAX_PROJECT_FILE_BASE64_BYTES`, `ProjectTooLargeError`, `MIB`, `base64Length`, `formatMiB`, `sourceBytes`, `blobToBase64` (all in `projectManager.ts`), and `ProjectTooLargeError` in `projectManagerDouble()`.

- [ ] **Step 1: Write the failing tests**

(a) `projectManager.test.ts` imports. Change the vitest import line to `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'` (drop `type Mock`). In the `./projectManager` import, delete the lines `MAX_PROJECT_FILE_BASE64_BYTES,` and `ProjectTooLargeError,`. Replace the `./projectFileFormat` import with:

```ts
import {
  HEADER_BYTES,
  MAX_INDEX_BYTES,
  ProjectFileError,
  encodeProjectFile,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
} from './projectFileFormat'
```

Delete the line `import { installFileReaderDouble } from '../test/doubles/fileReader'`. Delete the `decodeBase64` helper (its doc comment and function, lines 77-83).

(b) Delete the whole `describe('saveProject size budget (ESCSUITE-241)', …)` block (lines 128-312). This is spec test 7: its refusals become the red form of the new "twice the old budget" case below.

(c) Replace the whole `describe('saveProject', …)` block with:

```ts
/** A project whose clips use each of `ids`, in order. */
const projectUsing = (ids: string[]): Project => {
  const project = createTestProject(ids[0])
  project.timeline.clips = ids.map((id, i) => ({ ...project.timeline.clips[0], id: `clip${i}`, sourceVideoId: id }))
  return project
}

describe('saveProject', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let createObjectURL: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jsdom would try to navigate on a real anchor click; the click itself is
    // what we assert on, so intercept it and read the anchor it was made on.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    createObjectURL = vi.spyOn(URL, 'createObjectURL')
  })

  afterEach(() => {
    clickSpy.mockRestore()
    createObjectURL.mockRestore()
  })

  /** The .veditor handed to URL.createObjectURL for download, read back through the v2 reader. */
  async function capturedSave(): Promise<{ file: File; index: ProjectFileIndex; payloadStart: number }> {
    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    expect(blob.type).toBe('application/octet-stream')
    const file = fileOf([blob], 'saved.veditor')
    const container = await readProjectFileIndex(file)
    return { file, index: container!.index, payloadStart: container!.payloadStart }
  }

  const bytesAt = async (file: File, payloadStart: number, range: { offset: number; length: number }) =>
    Array.from(new Uint8Array(await sliceRange(file, payloadStart, range, '').arrayBuffer()))

  it('writes a v2 container holding the stored bytes and thumbnail, and triggers a download', async () => {
    const videoId = uniqueId('vid')
    const bytes = [0, 1, 2, 255, 254, 253]
    await storeVideo(videoId, new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), sourceVideo(videoId))
    await storeThumbnail(videoId, new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }))

    const progress: Array<[number, string]> = []
    await saveProject(createTestProject(videoId), [sourceVideo(videoId)], (p, m) => progress.push([p, m]))

    const { file, index, payloadStart } = await capturedSave()
    expect(index.version).toBe(2)
    expect(index.project.id).toBe('project1')
    expect(index.videos).toHaveLength(1)
    expect(index.videos[0].id).toBe(videoId)
    expect(index.videos[0].mimeType).toBe('video/mp4')
    expect(await bytesAt(file, payloadStart, index.videos[0].data)).toEqual(bytes)
    expect(index.videos[0].thumbnail!.mimeType).toBe('image/jpeg')
    expect(await bytesAt(file, payloadStart, index.videos[0].thumbnail!)).toEqual([9, 8, 7])

    expect(progress).toEqual([
      [0, 'Preparing project data...'],
      [90, 'Creating project file...'],
      [100, 'Project saved!'],
    ])

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('Test Project.veditor')
    expect(anchor.href).toContain(lastObjectUrl())
    // The anchor is removed again once clicked.
    expect(document.body.contains(anchor)).toBe(false)
  })

  it('omits the thumbnail when none is stored', async () => {
    const videoId = uniqueId('vid')
    await storeVideo(videoId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(videoId))

    await saveProject(createTestProject(videoId), [sourceVideo(videoId)])

    const { index } = await capturedSave()
    expect(index.videos[0].thumbnail).toBeUndefined()
  })

  it('writes only the videos the timeline actually uses', async () => {
    const usedId = uniqueId('used')
    const unusedId = uniqueId('unused')
    await storeVideo(usedId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(usedId))
    await storeVideo(unusedId, new Blob([new Uint8Array([2])], { type: 'video/mp4' }), sourceVideo(unusedId))

    await saveProject(createTestProject(usedId), [sourceVideo(usedId), sourceVideo(unusedId)])

    const { index } = await capturedSave()
    expect(index.videos.map((v) => v.id)).toEqual([usedId])
  })

  it('skips a referenced video whose blob is no longer in storage', async () => {
    const missingId = uniqueId('gone')
    await saveProject(createTestProject(missingId), [sourceVideo(missingId)])

    const { index } = await capturedSave()
    expect(index.videos).toEqual([])
    // The project itself is still written out.
    expect(index.project.timeline.clips).toHaveLength(1)
  })

  it('names the file "project.veditor" when the project has no name', async () => {
    const project = createTestProject(uniqueId('vid'))
    project.name = ''
    await saveProject(project, [])
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('project.veditor')
  })

  it('writes a clip crop into the .veditor (ESCSUITE-6)', async () => {
    const videoId = uniqueId('crop-save')
    await storeVideo(videoId, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(videoId))
    const project = createTestProject(videoId)
    project.timeline.clips[0].crop = { left: 0.25, top: 0.1, right: 0, bottom: 0 }

    await saveProject(project, [sourceVideo(videoId)])

    const { index } = await capturedSave()
    expect(index.project.timeline.clips[0].crop).toEqual({ left: 0.25, top: 0.1, right: 0, bottom: 0 })
  })

  // Review Focus 2.
  it('saves and reopens a source of zero bytes', async () => {
    const videoId = uniqueId('zero')
    await storeVideo(videoId, new Blob([], { type: 'video/mp4' }), sourceVideo(videoId))

    await saveProject(createTestProject(videoId), [sourceVideo(videoId)])
    const { file, index } = await capturedSave()
    expect(index.videos[0].data).toEqual({ offset: 0, length: 0 })

    await deleteVideo(videoId)
    const media = installMediaElementDoubles()
    try {
      const { sourceVideos } = await loadProject(file)
      expect(sourceVideos[0].size).toBe(0)
      expect((await getVideo(videoId))!.blob.size).toBe(0)
    } finally {
      media.uninstall()
      await deleteVideo(videoId)
    }
  })

  // Spec test 1, and the red form of the deleted ESCSUITE-241 refusals: twice
  // the old 256 MiB budget, with sources that throw if anything reads them.
  it('saves sources twice the old budget without reading a byte of them', async () => {
    const a = uniqueId('big-a')
    const b = uniqueId('big-b')
    const bigA = untouchable(200 * MiB, 'video/mp4')
    const thumbA = untouchable(64 * 1024, 'image/jpeg')
    const bigB = untouchable(312 * MiB, 'video/webm')
    vi.mocked(getVideo)
      .mockImplementationOnce(async () => ({ blob: bigA, metadata: sourceVideo(a) }))
      .mockImplementationOnce(async () => ({ blob: bigB, metadata: sourceVideo(b, 'b.webm', 'video/webm') }))
    vi.mocked(getThumbnail)
      .mockImplementationOnce(async () => thumbA)
      .mockImplementationOnce(async () => undefined)
    // Record what saveProject hands `new Blob` instead of letting Node's Blob
    // add up 512 MiB of reported sizes over empty handles. Refuse any FileReader.
    const RealBlob = globalThis.Blob
    const RealFileReader = globalThis.FileReader
    const made: Array<{ parts: BlobPart[]; type?: string }> = []
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          made.push({ parts, type: options?.type })
        }
      }
    )
    vi.stubGlobal(
      'FileReader',
      class {
        constructor() {
          throw new Error('FileReader read a source on save')
        }
      }
    )
    try {
      await saveProject(projectUsing([a, b]), [sourceVideo(a, 'First'), sourceVideo(b, 'Second', 'video/webm')])
    } finally {
      vi.stubGlobal('Blob', RealBlob)
      vi.stubGlobal('FileReader', RealFileReader)
    }

    expect(made).toHaveLength(1)
    expect(made[0].type).toBe('application/octet-stream')
    const parts = made[0].parts
    expect(parts[2]).toBe(bigA)
    expect(parts[3]).toBe(thumbA)
    expect(parts[4]).toBe(bigB)
    const index = JSON.parse(new TextDecoder().decode(parts[1] as Uint8Array)) as ProjectFileIndex
    expect(index.videos.map((v) => [v.id, v.name, v.data])).toEqual([
      [a, 'First', { offset: 0, length: 200 * MiB }],
      [b, 'Second', { offset: 200 * MiB + 64 * 1024, length: 312 * MiB }],
    ])
    expect(index.videos[0].thumbnail).toEqual({ offset: 200 * MiB, length: 64 * 1024, mimeType: 'image/jpeg' })
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
```

(d) In `describe('project file metadata round trip (ESCSUITE-97)', …)`:
- Delete the line `  let fileReader: ReturnType<typeof installFileReaderDouble>`, the line `    fileReader = installFileReaderDouble()` and the line `    fileReader.uninstall()`.
- Replace the helper

```ts
  /** The .veditor payload handed to URL.createObjectURL for download. */
  async function capturedProjectFile(): Promise<ProjectFile> {
    const blob = createObjectURL.mock.calls.at(-1)![0] as Blob
    return JSON.parse(await blob.text()) as ProjectFile
  }
```

with

```ts
  /** The .veditor handed to URL.createObjectURL for download, and its index. */
  async function captured(): Promise<{ file: File; index: ProjectFileIndex }> {
    const file = fileOf([createObjectURL.mock.calls.at(-1)![0] as Blob], 'take.veditor')
    return { file, index: (await readProjectFileIndex(file))!.index }
  }
```

- In both tests that call it: `const saved = await capturedProjectFile()` becomes `const saved = await captured()`; `expect(saved.videos[0].meta).toEqual({` becomes `expect(saved.index.videos[0].meta).toEqual({`; and `const reopened = new File([JSON.stringify(saved)], 'take.veditor', { type: 'application/json' })` becomes `const reopened = saved.file`. The second test asserts no `meta`, so it has only the first and third edits.

(e) In `describe('the editor block in the project file (ESCSUITE-245)', …)`:
- Delete `  let fileReader: ReturnType<typeof installFileReaderDouble>`, `    fileReader = installFileReaderDouble()` and `    fileReader.uninstall()`.
- Replace `lastFile` with:

```ts
  const lastFile = async (): Promise<File> =>
    fileOf([createObjectURL.mock.calls.at(-1)![0] as Blob], 'p.veditor')
```

- In 'writes the range and markers beside the project, not inside it', replace `const saved = JSON.parse(await (await lastFile()).text())` with `const saved = (await readProjectFileIndex(await lastFile()))!.index`.

(f) `apps/artist/src/app/useProjectActions.test.ts`. Replace line 11 with these two lines:

```ts
import { loadProject, saveProject, showOpenProjectDialog } from '../core/projectManager'
import { ProjectFileError } from '../core/projectFileFormat'
```

Then replace the whole `describe('a save the project is too large for (ESCSUITE-241)', …)` block (lines 105-157) with:

```ts
// The writer's one refusal (ESCSUITE-260): an index past MAX_INDEX_BYTES.
// Unreachable in practice, and shown by name when it happens. The class is the
// real one: core/projectFileFormat is not mocked, so `instanceof` means the
// same here and in the hook.
describe('a save the writer refuses (ESCSUITE-260)', () => {
  const refusal = () =>
    new ProjectFileError("This project's index is 70000000 bytes, over the 67108864-byte limit a project file can hold.")

  it('shows the refusal\'s own sentence, not the generic one, and does not count a save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(analytics, 'projectSaved').mockImplementation(() => {})
    vi.mocked(saveProject).mockRejectedValue(refusal())
    const { result } = mountActions()

    await act(async () => {
      await result.current.handleSaveProject()
    })

    expect(deps.showNotification).toHaveBeenCalledWith(refusal().message, 'error')
    expect(deps.showNotification).not.toHaveBeenCalledWith('Failed to save project', 'error')
    expect(analytics.projectSaved).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  it('counts a save that did land', async () => {
    vi.spyOn(analytics, 'projectSaved').mockImplementation(() => {})
    const { result } = mountActions()
    await act(async () => {
      await result.current.handleSaveProject()
    })
    expect(analytics.projectSaved).toHaveBeenCalledTimes(1)
  })

  it('save-and-load shows the sentence, does not load, and keeps the dialog and file for another choice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    const { result } = mountActions({ clipCount: 2 })
    await act(async () => {
      await result.current.handleLoadProject()
    })
    expect(result.current.showProjectLoadDialog).toBe(true)
    vi.mocked(saveProject).mockRejectedValue(refusal())

    await act(async () => {
      await result.current.handleProjectLoadSaveAndLoad()
    })

    expect(deps.showNotification).toHaveBeenCalledWith(refusal().message, 'error')
    expect(loadProject).not.toHaveBeenCalled()
    expect(result.current.showProjectLoadDialog).toBe(true)

    // The file is still pending: discarding now loads it.
    await act(async () => {
      await result.current.handleProjectLoadDiscardAndLoad()
    })
    expect(loadProject).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts src/app/useProjectActions.test.ts`
Expected failures:
- The `saveProject` cases fail at `capturedSave`'s `expected 'application/json' to be 'application/octet-stream'`.
- "saves sources twice the old budget…" fails with `ProjectTooLargeError: This project is too large to save as a .veditor file: its sources add up to 513 MiB…`.
- The ESCSUITE-97 and editor-block round trips fail with `TypeError: Cannot read properties of null (reading 'index')`, because the reader answers `null` for a v1 JSON file.
- The three useProjectActions writer-refusal cases: two fail because the hook does not yet treat `ProjectFileError` as a refusal, with `expected "spy" to be called with arguments: [ "This project's index is 70000000 bytes…", "error" ]`, received `"Failed to save project"`. The third, "counts a save that did land", passes because it never throws.

Paste the first line of each.

- [ ] **Step 3: Commit the red tests**

```bash
git add apps/artist/src/core/projectManager.test.ts apps/artist/src/app/useProjectActions.test.ts
git commit -m "test(artist): saveProject writes .veditor v2 and reads no source byte; the 241 budget suite goes (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

(a) `apps/artist/src/core/projectManager.ts`. Change the `./projectFileFormat` import to:

```ts
import {
  assertRangesTile,
  encodeProjectFile,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
  type ProjectFileSource,
} from './projectFileFormat';
```

(b) Delete lines 56-132 in full: the `MAX_PROJECT_FILE_BASE64_BYTES` doc comment and constant, `const MIB`, `base64Length`, `formatMiB`, `sourceBytes`, the `ProjectTooLargeError` class and the `blobToBase64` function. Keep `base64ToBlob`; the v1 loader still uses it.

(c) Change the comment on `ProjectFile` (the line `export interface ProjectFile {`) by inserting above it:

```ts
/**
 * A v1 `.veditor`: one JSON document with every source base64-encoded inside
 * it. Only read now: `saveProject` writes the v2 container
 * (`projectFileFormat.ts`, ESCSUITE-260), and `loadProject` still opens every
 * v1 file an older build wrote.
 */
```

(d) Replace `saveProject` (from `/**\n * Save project to a downloadable file\n */` through its closing `}`) with:

```ts
/**
 * Save the project and the sources its timeline uses as a v2 `.veditor`
 * (ESCSUITE-260). The stored blobs are IndexedDB handles: they go into the
 * file by reference, so no source byte is read, and the only bytes built here
 * are the header and the index. There is no size budget. The file is limited
 * by the browser's download size, not by the format.
 */
export async function saveProject(
  project: Project,
  sourceVideos: SourceVideo[],
  onProgress?: (progress: number, message: string) => void,
  /** Handed in, as `sourceVideos` is, rather than read from the store here. */
  editor?: EditorBlock
): Promise<void> {
  onProgress?.(0, 'Preparing project data...');

  // Get all videos used in the timeline
  const usedVideoIds = new Set(project.timeline.clips.map((c) => c.sourceVideoId));
  const usedVideos = sourceVideos.filter((v) => usedVideoIds.has(v.id));

  const sources: ProjectFileSource[] = [];
  for (const video of usedVideos) {
    const videoData = await getVideo(video.id);
    if (!videoData) continue;
    const thumbnail = await getThumbnail(video.id);

    const meta: SourceVideoMeta = {
      duration: video.duration,
      width: video.width,
      height: video.height,
      frameRate: video.frameRate,
      frameRateSource: video.frameRateSource,
      mediaType: video.mediaType,
      source: video.source,
      recordedAt: video.recordedAt,
      waveformData: video.waveformData,
      hasAudio: video.hasAudio,
      takeId: video.takeId,
      role: video.role,
      startOffset: video.startOffset,
      overlayPlacement: video.overlayPlacement,
      hasWebcam: video.hasWebcam,
    };

    sources.push({
      id: video.id,
      name: video.name,
      mimeType: video.mimeType,
      meta,
      blob: videoData.blob,
      thumbnail,
    });
  }

  onProgress?.(90, 'Creating project file...');

  const blob = new Blob(encodeProjectFile(project, editor, sources), { type: 'application/octet-stream' });

  // Download file
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name || 'project'}.veditor`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  onProgress?.(100, 'Project saved!');
}
```

(`saveProject` no longer mentions `JSON_FILE_VERSION`; the constant stays for the v1 loader and `exportProjectMetadata`.)

(e) `apps/artist/src/app/useProjectActions.ts`. Replace line 20 with:

```ts
import { saveProject, loadProject, showOpenProjectDialog } from '../core/projectManager';
import { ProjectFileError } from '../core/projectFileFormat';
```

In both `catch` blocks that read `error instanceof ProjectTooLargeError ? error.message : 'Failed to save project',`, replace that line with:

```ts
        error instanceof ProjectFileError ? error.message : 'Failed to save project',
```

(f) `apps/artist/src/test/appDoubles.ts`. Replace `projectManagerDouble` (lines 83-102) with:

```ts
export function projectManagerDouble() {
  // `ProjectFileError` is not here: it lives in core/projectFileFormat, which
  // no suite mocks, so `instanceof` means the same in the hook under test and
  // in the test that throws it (ESCSUITE-260).
  return {
    saveProject: vi.fn(() => Promise.resolve()),
    loadProject: vi.fn(() => Promise.resolve({ project: {}, sourceVideos: [] })),
    showOpenProjectDialog: vi.fn(() => Promise.resolve(null)),
  }
}
```

Coverage: `saveProject` keeps two decisions, `if (!videoData) continue` (the missing-blob case and the stored cases) and `project.name || 'project'` (the unnamed case and the named cases). The deleted budget removes about 20 covered branches from `projectManager.ts`. Both `instanceof` sites in `useProjectActions.ts` are reached from both sides, by the writer-refusal cases and by the existing "disk full" cases.

- [ ] **Step 5: Run it green**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts src/app/useProjectActions.test.ts`, all passing. Then the whole artist suite (every `App.*` suite mocks `projectManager` through the double you just edited), `tsc -b --noEmit`, `eslint .`, the byte-identical check, and `git grep -n "ProjectTooLargeError\|MAX_PROJECT_FILE_BASE64_BYTES\|blobToBase64" apps/artist/src`. The grep must print nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/projectManager.ts apps/artist/src/app/useProjectActions.ts apps/artist/src/test/appDoubles.ts
git commit -m "feat(artist): saveProject writes the .veditor v2 container by reference, with no size budget (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 5: The quota pre-check and the rollback

**Files:**
- Modify: `apps/artist/src/core/projectManager.ts`. Imports; `restoreSource`; `restoreSources`; `loadJsonFile`'s and `loadContainer`'s callbacks; one new function, `assertRoomFor`; one new function, `rollBack`.
- Test: `apps/artist/src/core/projectManager.test.ts`. One `vi.importActual` line after the `vi.mock` block; a new describe after the `loadProject, version 2` describe.

**Interfaces:**
- Consumes: `deleteVideo`, `getStorageEstimate` (`./storage`, re-exported from `@escapesuite/shared/storage`: `getStorageEstimate(): Promise<{ used: number; quota: number; available: number }>`, all zeros when `navigator.storage.estimate` is absent; `deleteVideo(id)` deletes the `videos` and `thumbnails` rows). `ProjectFileError`, `formatSize`.
- Produces, module-private:
  - `async function assertRoomFor(index: ProjectFileIndex, existing: StoredSource[]): Promise<void>`
  - `async function rollBack(written: string[]): Promise<void>`
  - `restoreSource(entry, blob, thumbnail, existing, written: string[])`, which gains a fifth parameter
  - `restoreSources(count, restoreOne: (i: number, written: string[]) => Promise<SourceVideo>, onProgress?)`
- New user-visible sentence: `This project needs <formatSize(needed)> of storage and this browser has <formatSize(free)> free.`

- [ ] **Step 1: Write the failing tests**

(a) In `projectManager.test.ts`, right after the `vi.mock('./storage', …)` block, add:

```ts
// The real functions behind the spies, for a test that lets one call through
// and fails the next.
const actualStorage = await vi.importActual<typeof import('./storage')>('./storage')
```

Change the `./storage` import line to:

```ts
import {
  deleteVideo,
  getAllVideoMetadata,
  getStorageEstimate,
  getThumbnail,
  getVideo,
  storeThumbnail,
  storeVideo,
} from './storage'
```

(b) Append after the `describe('loadProject, version 2 (ESCSUITE-260)', …)` block:

```ts
describe('loading a project into storage that may be full (ESCSUITE-260)', () => {
  let media: MediaDoubles
  const meta: SourceVideoMeta = { duration: 9, width: 64, height: 48, frameRate: 30 }
  const source = (id: string, size: number, thumbnail = 0) => ({
    id,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    meta,
    blob: untouchable(size, 'video/mp4'),
    ...(thumbnail > 0 ? { thumbnail: untouchable(thumbnail, 'image/jpeg') } : {}),
  })
  const estimate = (used: number, quota: number) =>
    vi.mocked(getStorageEstimate).mockResolvedValueOnce({ used, quota, available: quota - used })
  const seed = async (id: string) => {
    await actualStorage.storeVideo(id, new Blob([new Uint8Array([1])], { type: 'video/mp4' }), sourceVideo(id))
  }

  beforeEach(() => {
    media = installMediaElementDoubles()
    vi.mocked(storeVideo).mockClear()
    vi.mocked(storeThumbnail).mockClear()
    vi.mocked(deleteVideo).mockClear()
  })

  afterEach(() => {
    media.uninstall()
  })

  describe('the pre-check', () => {
    it('refuses, before any write, a load that needs more than the browser has free', async () => {
      const a = uniqueId('q-a')
      const b = uniqueId('q-b')
      const { file } = virtualV2File(
        encodeProjectFile(createTestProject(a), undefined, [source(a, GiB, 256 * MiB), source(b, 256 * MiB)])
      )
      estimate(3 * GiB, 4 * GiB)

      const error = await loadProject(file).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProjectFileError)
      expect((error as Error).message).toBe(
        'This project needs 1.5 GiB of storage and this browser has 1.0 GiB free.'
      )
      expect(storeVideo).not.toHaveBeenCalled()
      expect(storeThumbnail).not.toHaveBeenCalled()
    })

    it('names a smaller shortfall in MiB', async () => {
      const a = uniqueId('q-mib')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, 200 * MiB)]))
      estimate(GiB - 100 * MiB, GiB)

      await expect(loadProject(file)).rejects.toThrow(
        'This project needs 200 MiB of storage and this browser has 100 MiB free.'
      )
    })

    it('accepts a load that needs exactly what is free', async () => {
      const a = uniqueId('q-equal')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, GiB)]))
      estimate(3 * GiB, 4 * GiB)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      const { sourceVideos } = await loadProject(file)

      expect(sourceVideos.map((v) => v.id)).toEqual([a])
      expect(storeVideo).toHaveBeenCalledTimes(1)
    })

    // Review Focus 4.
    it('does not count a source that is already stored, however large the file says it is', async () => {
      const present = uniqueId('q-present')
      const fresh = uniqueId('q-new')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      const { file } = virtualV2File(
        encodeProjectFile(createTestProject(present), undefined, [source(present, 1.5 * GiB), source(fresh, 512 * MiB)])
      )
      estimate(3 * GiB, 4 * GiB)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      const { sourceVideos } = await loadProject(file)

      expect(sourceVideos.map((v) => v.id)).toEqual([present, fresh])
      expect(vi.mocked(storeVideo).mock.calls.map(([id]) => id)).toEqual([fresh])
      await actualStorage.deleteVideo(present)
    })

    it('skips the check when the browser measured nothing (quota 0, no estimate API)', async () => {
      const a = uniqueId('q-unmeasured')
      const { file } = virtualV2File(encodeProjectFile(createTestProject(a), undefined, [source(a, 1.5 * GiB)]))
      estimate(0, 0)
      vi.mocked(storeVideo).mockResolvedValueOnce(undefined)

      await expect(loadProject(file)).resolves.toBeDefined()
      expect(storeVideo).toHaveBeenCalledTimes(1)
    })

    // Review Focus 4.
    it('accepts a load that writes nothing when usage is already over quota', async () => {
      const present = uniqueId('q-over')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      const { file } = virtualV2File(encodeProjectFile(createTestProject(present), undefined, [source(present, GiB)]))
      estimate(5 * GiB, 4 * GiB)

      await expect(loadProject(file)).resolves.toBeDefined()
      expect(storeVideo).not.toHaveBeenCalled()
      await actualStorage.deleteVideo(present)
    })
  })

  describe('the rollback', () => {
    it('deletes what it wrote when a later write fails, and rethrows the original error', async () => {
      const first = uniqueId('rb-first')
      const second = uniqueId('rb-second')
      const failure = new Error('QuotaExceededError')
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(failure)

      const error = await loadProject(
        v2File(createTestProject(first), [
          { id: first, meta, bytes: [1] },
          { id: second, meta, bytes: [2] },
        ])
      ).catch((e: unknown) => e)

      expect(error).toBe(failure)
      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })

    it('never deletes a source that was stored before the load', async () => {
      const present = uniqueId('rb-present')
      const first = uniqueId('rb-new-1')
      const second = uniqueId('rb-new-2')
      await seed(present)
      vi.mocked(storeVideo).mockClear()
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(new Error('disk full'))

      await expect(
        loadProject(
          v2File(createTestProject(present), [
            { id: present, meta, bytes: [1] },
            { id: first, meta, bytes: [2] },
            { id: second, meta, bytes: [3] },
          ])
        )
      ).rejects.toThrow('disk full')

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(present)).toBeDefined()
      await actualStorage.deleteVideo(present)
    })

    it('warns once when a delete fails, and still rethrows the original error', async () => {
      const first = uniqueId('rb-warn')
      const second = uniqueId('rb-warn-2')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deleteFailure = new Error('database closed')
      vi.mocked(storeVideo).mockImplementationOnce(actualStorage.storeVideo).mockRejectedValueOnce(new Error('disk full'))
      vi.mocked(deleteVideo).mockRejectedValueOnce(deleteFailure)

      await expect(
        loadProject(
          v2File(createTestProject(first), [
            { id: first, meta, bytes: [1] },
            { id: second, meta, bytes: [2] },
          ])
        )
      ).rejects.toThrow('disk full')

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(`Could not remove source ${first} after a project load failed:`, deleteFailure)
      warn.mockRestore()
      await actualStorage.deleteVideo(first)
    })

    it('rolls back its own video when its thumbnail write fails', async () => {
      const id = uniqueId('rb-thumb')
      vi.mocked(storeThumbnail).mockRejectedValueOnce(new Error('thumbnail write failed'))

      await expect(
        loadProject(v2File(createTestProject(id), [{ id, meta, bytes: [1], thumbnail: { bytes: [2], type: 'image/jpeg' } }]))
      ).rejects.toThrow('thumbnail write failed')

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[id]])
      expect(await getVideo(id)).toBeUndefined()
    })

    // Review Focus 3.
    it("rolls back when a later source's metadata probe fails", async () => {
      const first = uniqueId('rb-probe-1')
      const second = uniqueId('rb-probe-2')
      media.script({ video: { fail: true } })

      await expect(
        loadProject(
          v2File(createTestProject(first), [
            { id: first, meta, bytes: [1] },
            { id: second, bytes: [2] }, // no meta: probed, and the probe fails
          ])
        )
      ).rejects.toThrow(`Failed to load video: ${second}.mp4`)

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })

    // Review Focus 3: the loop is shared, so a v1 file rolls back too.
    it('rolls back a v1 load too', async () => {
      const first = uniqueId('rb-v1-1')
      const second = uniqueId('rb-v1-2')
      const file = new File(
        [
          JSON.stringify({
            version: 1,
            project: createTestProject(first),
            videos: [
              { id: first, name: 'a.mp4', mimeType: 'video/mp4', data: base64Of([1, 2, 3]), meta },
              { id: second, name: 'b.mp4', mimeType: 'video/mp4', data: '***not base64***', meta },
            ],
          } satisfies ProjectFile),
        ],
        'old.veditor',
        { type: 'application/json' }
      )

      // atob's InvalidCharacterError: a DOMException, so asserted as any rejection.
      await expect(loadProject(file)).rejects.toBeTruthy()

      expect(vi.mocked(deleteVideo).mock.calls).toEqual([[first]])
      expect(await getVideo(first)).toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts`
Expected:
- "refuses, before any write…" and "names a smaller shortfall in MiB" fail. The load is not refused, so `expected undefined to be an instance of ProjectFileError` for the first, and `promise resolved … instead of rejecting` for the second.
- Every rollback case fails with `expected [] to deeply equal [ [ 'rb-…' ] ]` (nothing is deleted).
- "accepts a load that needs exactly what is free", "does not count a source that is already stored…", "skips the check…" and "accepts a load that writes nothing…" pass already. They are pins for the other side of each operand, and must stay green after Step 4.

Paste the first line of each failing case.

- [ ] **Step 3: Commit the red tests**

```bash
git add apps/artist/src/core/projectManager.test.ts
git commit -m "test(artist): a .veditor load checks the storage estimate first and rolls back what it wrote on failure (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

In `apps/artist/src/core/projectManager.ts`:

(a) Imports become:

```ts
import {
  deleteVideo,
  getStorageEstimate,
  getVideo,
  storeVideo,
  storeThumbnail,
  getThumbnail,
  resolveThumbnailUrl,
} from './storage';
import { loadMediaDuration, resolveStoredDuration } from './videoProcessor';
import {
  ProjectFileError,
  assertRangesTile,
  encodeProjectFile,
  formatSize,
  readProjectFileIndex,
  sliceRange,
  type ProjectFileIndex,
  type ProjectFileSource,
} from './projectFileFormat';
```

(b) In `restoreSource`, change the signature's last parameter line from `  existing: StoredSource` to:

```ts
  existing: StoredSource,
  /** Every id this load has stored so far; `restoreSources` deletes them if the load fails. */
  written: string[]
```

and replace the line `    await storeVideo(entry.id, blob, metadata);` with:

```ts
    await storeVideo(entry.id, blob, metadata);
    // Recorded as soon as the row exists, so a thumbnail write that fails
    // next still rolls this video back.
    written.push(entry.id);
```

(c) Replace `restoreSources` with:

```ts
/**
 * Delete every source this load stored, best-effort, each on its own: one that
 * cannot be deleted is warned about and left. It is unreferenced, and
 * ESCSUITE-268's "files from earlier sessions" list offers it for removal.
 * Only ids this call stored are ever here, so a source that was present before
 * the load is never touched.
 */
async function rollBack(written: string[]): Promise<void> {
  for (const id of written) {
    try {
      await deleteVideo(id);
    } catch (error) {
      console.warn(`Could not remove source ${id} after a project load failed:`, error);
    }
  }
}

/**
 * The restore loop both file versions share, with its progress reports. A
 * throw anywhere in it (a write, a thumbnail write, a metadata probe, a v1
 * source's base64) rolls back what this load stored, then rethrows the
 * original error (ESCSUITE-260).
 */
async function restoreSources(
  count: number,
  restoreOne: (i: number, written: string[]) => Promise<SourceVideo>,
  onProgress?: (progress: number, message: string) => void
): Promise<SourceVideo[]> {
  onProgress?.(10, 'Restoring videos...');
  const restored: SourceVideo[] = [];
  const written: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      onProgress?.(10 + ((i + 1) / count) * 80, `Restoring video ${i + 1}/${count}...`);
      restored.push(await restoreOne(i, written));
    }
  } catch (error) {
    await rollBack(written);
    throw error;
  }
  return restored;
}
```

(d) In `loadJsonFile`, change `async (i) => {` to `async (i, written) => {` and `return restoreSource(videoData, blob, thumbnail, await getVideo(videoData.id));` to `return restoreSource(videoData, blob, thumbnail, await getVideo(videoData.id), written);`.

(e) Insert above `loadContainer`:

```ts
/**
 * Refuses, before anything is written, a v2 load whose new media will not fit
 * in what the browser says is free (ESCSUITE-260). A source already stored
 * writes nothing (ESCSUITE-151) and is not counted. The sum is exact, so no
 * margin is added. The estimate is approximate and per-browser, so a load
 * that passes can still fail while writing; `restoreSources`' rollback covers
 * that. With no `navigator.storage.estimate`, the shared helper answers all
 * zeros. A quota of 0 means nothing was measured, and the check is skipped
 * rather than refusing every load. A negative `available` (usage already over
 * quota) counts as nothing free.
 */
async function assertRoomFor(index: ProjectFileIndex, existing: StoredSource[]): Promise<void> {
  const needed = index.videos.reduce(
    (sum, video, i) => (existing[i] ? sum : sum + video.data.length + (video.thumbnail?.length ?? 0)),
    0
  );
  const { quota, available } = await getStorageEstimate();
  const free = Math.max(0, available);
  if (quota > 0 && needed > free) {
    throw new ProjectFileError(
      `This project needs ${formatSize(needed)} of storage and this browser has ${formatSize(free)} free.`
    );
  }
}
```

(f) In `loadContainer`, insert `  await assertRoomFor(index, existing);` on the line after `const existing = await Promise.all(...)`. Change `async (i) => {` to `async (i, written) => {` and `return restoreSource(video, blob, thumbnail, existing[i]);` to `return restoreSource(video, blob, thumbnail, existing[i], written);`.

Both sides of each new conditional are reached:
- `existing[i] ?`: the present-source cases (true) and every new source (false).
- `video.thumbnail?.length ?? 0`: the refused case's source `a` has a thumbnail and `b` has none.
- `quota > 0 && needed > free`: the "skips the check" case (`quota` 0) and every other case (`quota` > 0). With quota > 0, the refused cases have `needed > free`, and the equal, present-only and over-quota cases do not.
- The rollback's `catch`: every rollback case. Its loop body runs zero times for the refused pre-check (no write yet) and once in each rollback case. The `deleteVideo` `catch` is reached by the warn case.

- [ ] **Step 5: Run it green**

From `apps/artist`: `node_modules/.bin/vitest run src/core/projectManager.test.ts`, all passing. Then the whole artist suite, `tsc -b --noEmit`, `eslint .` and the byte-identical check.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/core/projectManager.ts
git commit -m "feat(artist): refuse a .veditor load that will not fit, and roll back a load that fails partway (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 6: The load refusal is named, and the picker filters v2

**Files:**
- Modify: `apps/artist/src/app/useProjectActions.ts` (the `catch` in `loadProjectFile`, around line 170).
- Modify: `apps/artist/src/core/projectManager.ts` (`showOpenProjectDialog`: the `accept: { 'application/json': ['.veditor'] }` line and `input.accept = '.veditor,application/json';`).
- Test: `apps/artist/src/app/useProjectActions.test.ts` (in `describe('opening a project')`, after "reports a file it cannot read"); `apps/artist/src/core/projectManager.test.ts` (`describe('showOpenProjectDialog')`).

`components/VideoUploader.tsx` needs no change. Its drop routing tests the `.veditor` suffix case-insensitively, and its `accept` is `"video/*,image/*,audio/*,.veditor"` with no `application/json` (verified at `e0798044`).

**Interfaces:**
- Consumes: `ProjectFileError` (imported in Task 4).
- Produces: `loadProjectFile`'s catch shows `Failed to load project: <error.message>` for a `ProjectFileError`, and the bare `Failed to load project` otherwise. The picker asks for `{ 'application/octet-stream': ['.veditor'] }`, and the fallback input's `accept` is `'.veditor'`.

- [ ] **Step 1: Write the failing tests**

(a) In `useProjectActions.test.ts`, after the `it('reports a file it cannot read', …)` case, add:

```ts
  it('names a project file it refused, in the sentence a malformed project uses (ESCSUITE-260)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockRejectedValue(
      new ProjectFileError('This project needs 1.5 GiB of storage and this browser has 1.0 GiB free.')
    )
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(deps.showNotification).toHaveBeenCalledWith(
      'Failed to load project: This project needs 1.5 GiB of storage and this browser has 1.0 GiB free.',
      'error'
    )
    expect(deps.resetProject).not.toHaveBeenCalled()
    expect(revokeSourceThumbnails).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })
```

The existing "reports a file it cannot read" case (a plain `Error('not a project')` → bare "Failed to load project") is the other side of the new ternary. Keep it unchanged.

(b) In `projectManager.test.ts`'s `describe('showOpenProjectDialog')`, change `expect(this.accept).toBe('.veditor,application/json')` to `expect(this.accept).toBe('.veditor')`, and change

```ts
      types: [{ description: 'Video Editor Project', accept: { 'application/json': ['.veditor'] } }],
```

to

```ts
      types: [{ description: 'Video Editor Project', accept: { 'application/octet-stream': ['.veditor'] } }],
```

- [ ] **Step 2: Run them and watch them fail**

From `apps/artist`: `node_modules/.bin/vitest run src/app/useProjectActions.test.ts src/core/projectManager.test.ts`
Expected:
- The new hook case fails: `expected "spy" to be called with arguments: [ "Failed to load project: This project needs…", "error" ]`, received `[ "Failed to load project", "error" ]`.
- The picker case fails: `expected { …'application/json'… } to …'application/octet-stream'…`.
- The input cases fail: `expected '.veditor,application/json' to be '.veditor'`.

Paste each.

- [ ] **Step 3: Commit the red tests**

```bash
git add apps/artist/src/app/useProjectActions.test.ts apps/artist/src/core/projectManager.test.ts
git commit -m "test(artist): a refused .veditor is named on load, and the picker asks for the v2 type (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

(a) `useProjectActions.ts`, in `loadProjectFile`'s `catch`, replace `      showNotification('Failed to load project', 'error');` with:

```ts
      // A refused file names its reason (ESCSUITE-260): a damaged or cut-off
      // v2 file, or one that will not fit in storage. Anything else, such as a
      // v1 file that is not JSON, keeps the bare sentence.
      showNotification(
        error instanceof ProjectFileError ? `Failed to load project: ${error.message}` : 'Failed to load project',
        'error'
      );
```

(b) `projectManager.ts`, `showOpenProjectDialog`: replace `            accept: { 'application/json': ['.veditor'] },` with `            accept: { 'application/octet-stream': ['.veditor'] },`, and replace `    input.accept = '.veditor,application/json';` with:

```ts
    // The extension is what filters: a v2 file is binary (ESCSUITE-260), and a
    // v1 file an older build wrote carries the same extension.
    input.accept = '.veditor';
```

- [ ] **Step 5: Run it green**

Run both files, then the whole artist suite, `tsc -b --noEmit`, `eslint .` and the byte-identical check.

- [ ] **Step 6: Commit**

```bash
git add apps/artist/src/app/useProjectActions.ts apps/artist/src/core/projectManager.ts
git commit -m "feat(artist): name a refused .veditor on load, and filter the picker by extension (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 7: The headless kit reads v2

**Files:**
- Create: `services/headless-artist/test/veditorV2.ts`
- Modify: `services/headless-artist/src/loaders.ts`. Line 1 import; lines 118-138 (`assertVeditorVideo`); lines 226-320 (`interface VeditorBundle` through the end of `loadBundle`).
- Test: `services/headless-artist/src/loaders.test.ts`. Line 6 import; the "rejects a bundle with an unsupported version" case (lines 451-459); a new describe appended at the end.

**Interfaces:**
- Consumes: the existing `isRecord`, `assertSafeFileId`, `assertSourceMeta`, `assertUniqueSourceId`, `validateClipReferences`, `extensionOf`, `MIME_TO_EXTENSION`, `writeBase64ToFile`, `LoadedJob`, `VeditorVideo`, `VeditorVideoMeta`.
- Produces: `loadBundle(bundlePath: string, tmpRoot?: string): Promise<LoadedJob>` (signature unchanged), plus module-private `readBytes`, `readBundleBody`, `checkVideos`, `materialiseSources`, `assertRangesTile`, `copyRange`, `loadBundleV1`, `loadBundleV2`, `assertVeditorEntry`, `assertVeditorVideoV2`, `assertByteRange`, `isByteCount`. Test helper exports: `V2_HEADER_PREFIX`, `interface V2Source`, `v2IndexAndPayload(project, sources)`, `assembleV2(index, payload, header?)`.

New error sentences (all prefixed `bundle "<path>"`):
- `has version 3, but this build supports versions 1 and 2`
- `has a binary header naming version 1, which no ESCAPEARTIST writes`
- `declares a 67108865-byte index, over the 67108864-byte limit`
- `ends before its index does`
- `has an index that is not valid JSON`
- `has an index that does not declare "version": 2`
- `video #0 field "data" must be {"offset", "length"}, each a whole number of bytes >= 0` (the same for `"thumbnail"`)
- `video #0 field "data" starts at byte 1 of the media, expected 0`
- `is truncated: it declares 10 bytes of media but holds 3`
- `has 2 bytes after its last source`

The v1 JSON message `…but this build only supports version 1` becomes `…has version 2, but this build supports versions 1 and 2 (version 2 is the binary container, not JSON)`.

- [ ] **Step 1: Write the test helper and the failing tests**

Create `services/headless-artist/test/veditorV2.ts`:

```ts
// Builds `.veditor` v2 bundles for the kit's tests (ESCSUITE-260), laid out
// the way ESCAPEARTIST's writer lays them out
// (apps/artist/src/core/projectFileFormat.ts). Test-only: the kit never
// writes a bundle.

/**
 * The first 12 bytes of every v2 header: the magic, then version 2 as a
 * little-endian u32. Spelled out, not imported.
 * apps/artist/src/core/projectFileFormat.test.ts pins the same literal against
 * the editor's writer, so neither side can drift alone.
 */
export const V2_HEADER_PREFIX = [0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00] as const

export interface V2Source {
  id: string
  name: string
  mimeType: string
  bytes: Buffer
  meta?: Record<string, unknown>
  thumbnail?: { bytes: Buffer; mimeType: string }
}

/** The index and payload ESCAPEARTIST's writer would produce for these sources, in this order. */
export function v2IndexAndPayload(
  project: unknown,
  sources: V2Source[],
): { index: Record<string, unknown>; payload: Buffer } {
  const chunks: Buffer[] = []
  let offset = 0
  const videos = sources.map((source) => {
    const entry: Record<string, unknown> = {
      id: source.id,
      name: source.name,
      mimeType: source.mimeType,
      data: { offset, length: source.bytes.length },
    }
    if (source.meta) entry.meta = source.meta
    chunks.push(source.bytes)
    offset += source.bytes.length
    if (source.thumbnail) {
      entry.thumbnail = { offset, length: source.thumbnail.bytes.length, mimeType: source.thumbnail.mimeType }
      chunks.push(source.thumbnail.bytes)
      offset += source.thumbnail.bytes.length
    }
    return entry
  })
  return { index: { version: 2, project, videos }, payload: Buffer.concat(chunks) }
}

/** Header + index + payload. `header` overrides the version or the declared index length. */
export function assembleV2(
  index: unknown,
  payload: Buffer,
  header: { version?: number; indexLength?: number } = {},
): Buffer {
  const indexBytes = Buffer.from(typeof index === 'string' ? index : JSON.stringify(index), 'utf8')
  const head = Buffer.alloc(16)
  Buffer.from(V2_HEADER_PREFIX).copy(head, 0)
  if (header.version !== undefined) head.writeUInt32LE(header.version, 8)
  head.writeUInt32LE(header.indexLength ?? indexBytes.length, 12)
  return Buffer.concat([head, indexBytes, payload])
}
```

In `services/headless-artist/src/loaders.test.ts`, add after line 6:

```ts
import { V2_HEADER_PREFIX, assembleV2, v2IndexAndPayload, type V2Source } from '../test/veditorV2'
```

Replace the case `it('rejects a bundle with an unsupported version', …)` (lines 451-459) with:

```ts
  it('rejects a JSON bundle with a version above 1, naming both versions it does read', async () => {
    const dir = await makeTempDir()
    const veditor = JSON.parse(await fs.readFile(veditorFixture, 'utf8'))
    veditor.version = 2
    const badPath = path.join(dir, 'bad.veditor')
    await fs.writeFile(badPath, JSON.stringify(veditor))

    await expect(loadBundle(badPath, dir)).rejects.toThrow(
      `bundle "${badPath}" has version 2, but this build supports versions 1 and 2 (version 2 is the binary container, not JSON)`,
    )
  })
```

Append at the end of the file:

```ts
describe('loadBundle version 2 (ESCSUITE-260)', () => {
  const sourcePath = path.join(manifestFixtureDir, 'src-0.mp4')
  const fixtureProject = async () => JSON.parse(await fs.readFile(veditorFixture, 'utf8')).project

  /** The fixture project over its own source, as a v2 index and payload, plus any `extra` sources. */
  async function fixtureV2(extra: V2Source[] = []) {
    const bytes = await fs.readFile(sourcePath)
    return v2IndexAndPayload(await fixtureProject(), [
      { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes },
      ...extra,
    ])
  }

  async function writeBundle(dir: string, bytes: Buffer): Promise<string> {
    const bundlePath = path.join(dir, 'bundle.veditor')
    await fs.writeFile(bundlePath, bytes)
    return bundlePath
  }

  const videosOf = (index: Record<string, unknown>) => index.videos as Record<string, unknown>[]

  async function expectNoTempDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir)
    expect(entries.filter((entry) => entry.startsWith('headless-artist-'))).toEqual([])
  }

  it('reads the 16-byte header both packages pin, spelled out byte by byte', async () => {
    const dir = await makeTempDir()
    const { index, payload } = await fixtureV2()
    const indexBytes = Buffer.from(JSON.stringify(index))
    const length = Buffer.alloc(4)
    length.writeUInt32LE(indexBytes.length)
    const header = Buffer.from([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x00, 0x00, 0x00])
    expect([...header]).toEqual([...V2_HEADER_PREFIX])

    const job = await loadBundle(await writeBundle(dir, Buffer.concat([header, length, indexBytes, payload])), dir)
    try {
      expect(job.project.id).toBe('fixture')
      expect(job.sourceVideos).toEqual([{ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' }])
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
    } finally {
      await job.cleanup()
    }
  })

  // Review Focus 5.
  it('copies each source byte for byte, forwards meta, and does not copy thumbnails', async () => {
    const dir = await makeTempDir()
    const { index, payload } = await fixtureV2([
      {
        id: 'src-1',
        name: 'mic.webm',
        mimeType: 'video/webm;codecs=opus',
        bytes: Buffer.from('the second source'),
        meta: { mediaType: 'audio', width: 0, height: 0 },
        thumbnail: { bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' },
      },
    ])

    const job = await loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)
    try {
      expect(job.sourceVideos).toEqual([
        { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' },
        { mediaType: 'audio', width: 0, height: 0, id: 'src-1', name: 'mic.webm', mimeType: 'video/webm;codecs=opus' },
      ])
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
      expect((await fs.readFile(job.sourceFiles['src-1'])).toString()).toBe('the second source')
      expect((await fs.readdir(path.dirname(job.sourceFiles['src-0']))).sort()).toEqual(['src-0.mp4', 'src-1.webm'])
    } finally {
      await job.cleanup()
    }
  })

  // Review Focus 2.
  it('writes an empty temp file for a zero-length range, and the next source is still whole', async () => {
    const dir = await makeTempDir()
    const project = await fixtureProject()
    const { index, payload } = v2IndexAndPayload(project, [
      { id: 'empty', name: 'empty.mp4', mimeType: 'video/mp4', bytes: Buffer.alloc(0) },
      { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes: await fs.readFile(sourcePath) },
    ])

    const job = await loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)
    try {
      expect((await fs.stat(job.sourceFiles.empty)).size).toBe(0)
      expect((await fs.readFile(job.sourceFiles['src-0'])).equals(await fs.readFile(sourcePath))).toBe(true)
    } finally {
      await job.cleanup()
    }
  })

  it('still takes a JSON bundle down the version 1 path', async () => {
    const job = await loadBundle(veditorFixture, await makeTempDir())
    try {
      expect(job.sourceVideos).toEqual([{ id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4' }])
    } finally {
      await job.cleanup()
    }
  })

  it('names a directory it could not read', async () => {
    const dir = await makeTempDir()
    await expect(loadBundle(dir, dir)).rejects.toThrow(`bundle "${dir}" could not be read`)
  })

  describe('refuses, before any temp file exists', () => {
    async function refused(build: (index: Record<string, unknown>, payload: Buffer) => Buffer, message: string) {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      const bundlePath = await writeBundle(dir, build(index, payload))
      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(`bundle "${bundlePath}" ${message}`)
      await expectNoTempDir(dir)
    }

    it('a newer container version', () =>
      refused((index, payload) => assembleV2(index, payload, { version: 3 }), 'has version 3, but this build supports versions 1 and 2'))

    it('a header naming a version no ESCAPEARTIST writes', () =>
      refused(
        (index, payload) => assembleV2(index, payload, { version: 1 }),
        'has a binary header naming version 1, which no ESCAPEARTIST writes',
      ))

    it('an index over the cap', () =>
      refused(
        (index, payload) => assembleV2(index, payload, { indexLength: 64 * 1024 * 1024 + 1 }),
        'declares a 67108865-byte index, over the 67108864-byte limit',
      ))

    it('an index exactly at the cap that runs past the end of the file', () =>
      refused((index, payload) => assembleV2(index, payload, { indexLength: 64 * 1024 * 1024 }), 'ends before its index does'))

    it('an index that is not JSON', () =>
      refused((_index, payload) => assembleV2('{oops', payload), 'has an index that is not valid JSON'))

    it('an index that is a list', () =>
      refused((_index, payload) => assembleV2([], payload), 'has an index that does not declare "version": 2'))

    it('an index of another version', () =>
      refused(
        (index, payload) => assembleV2({ ...index, version: 1 }, payload),
        'has an index that does not declare "version": 2',
      ))

    it('an index with no project', () =>
      refused((index, payload) => assembleV2({ ...index, project: undefined }, payload), 'is missing "project"'))

    it('an index whose videos are not a list', () =>
      refused((index, payload) => assembleV2({ ...index, videos: {} }, payload), 'is missing "videos"'))

    it('a 2 GiB-claimed source in a file that holds a few bytes', () =>
      refused((index, payload) => {
        videosOf(index)[0].data = { offset: 0, length: 2 ** 31 }
        return assembleV2(index, payload.subarray(0, 10))
      }, 'is truncated: it declares 2147483648 bytes of media but holds 10'))

    it('trailing bytes after the last source', () =>
      refused(
        (index, payload) => assembleV2(index, Buffer.concat([payload, Buffer.from([1, 2])])),
        'has 2 bytes after its last source',
      ))

    it('a gap before the first source', () =>
      refused((index, payload) => {
        const data = videosOf(index)[0].data as { offset: number; length: number }
        videosOf(index)[0].data = { offset: 1, length: data.length - 1 }
        return assembleV2(index, payload)
      }, 'video #0 field "data" starts at byte 1 of the media, expected 0'))

    it('an overlap', async () => {
      const dir = await makeTempDir()
      const { index, payload } = v2IndexAndPayload(await fixtureProject(), [
        { id: 'src-0', name: 'src-0.mp4', mimeType: 'video/mp4', bytes: await fs.readFile(sourcePath) },
        { id: 'src-1', name: 'b.mp4', mimeType: 'video/mp4', bytes: Buffer.from([1, 2, 3]) },
      ])
      const second = videosOf(index)[1].data as { offset: number; length: number }
      videosOf(index)[1].data = { offset: second.offset - 1, length: 4 }
      const bundlePath = await writeBundle(dir, assembleV2(index, payload))

      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
        `video #1 field "data" starts at byte ${second.offset - 1} of the media, expected ${second.offset}`,
      )
      await expectNoTempDir(dir)
    })

    // Review Focus 5. The fixture's source is L bytes, so its thumbnail must start at L;
    // it is declared at L + 1.
    it('a thumbnail range out of place', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      const data = videosOf(index)[0].data as { offset: number; length: number }
      videosOf(index)[0].thumbnail = { offset: data.length + 1, length: 1, mimeType: 'image/jpeg' }
      const bundlePath = await writeBundle(dir, assembleV2(index, Buffer.concat([payload, Buffer.from([0, 9])])))

      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(
        `bundle "${bundlePath}" video #0 field "thumbnail" starts at byte ${data.length + 1} of the media, expected ${data.length}`,
      )
      await expectNoTempDir(dir)
    })
  })

  describe('refuses a malformed entry, naming the field', () => {
    async function refusedEntry(edit: (video: Record<string, unknown>) => void, message: string) {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      edit(videosOf(index)[0])
      const bundlePath = await writeBundle(dir, assembleV2(index, payload))
      await expect(loadBundle(bundlePath, dir)).rejects.toThrow(message)
      await expectNoTempDir(dir)
    }

    it('an entry that is not an object', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2()
      ;(index.videos as unknown[])[0] = null
      await expect(loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)).rejects.toThrow(
        'bundle video #0 must be an object',
      )
    })

    it('an id that is not a string', () =>
      refusedEntry((video) => (video.id = 7), 'bundle video #0 field "id" must be a string'))

    it('a missing type', () =>
      refusedEntry((video) => delete video.mimeType, 'bundle video #0 is missing "mimeType"'))

    it.each([
      ['a v1 base64 string', 'AAAA'],
      ['an offset that is not whole', { offset: 1.5, length: 3 }],
      ['a negative length', { offset: 0, length: -1 }],
    ])('a data range that is %s', (_case, data) =>
      refusedEntry(
        (video) => (video.data = data),
        'bundle video #0 field "data" must be {"offset", "length"}, each a whole number of bytes >= 0',
      ))

    it('a thumbnail that is not a byte range', () =>
      refusedEntry(
        (video) => (video.thumbnail = 'x'),
        'bundle video #0 field "thumbnail" must be {"offset", "length"}, each a whole number of bytes >= 0',
      ))

    it('a meta.mediaType that is not video, image or audio', () =>
      refusedEntry(
        (video) => (video.meta = { mediaType: 'hologram' }),
        'bundle video #0 field "meta.mediaType" must be one of video, image, audio',
      ))

    it('an id that would escape the temp directory', () =>
      refusedEntry((video) => (video.id = '../evil'), 'is not a safe file name'))

    it('a clip that references a source the bundle does not hold', () =>
      refusedEntry((video) => (video.id = 'renamed'), 'clip "clip-0" references unknown source "src-0"'))

    it('two entries under one id', async () => {
      const dir = await makeTempDir()
      const { index, payload } = await fixtureV2([
        { id: 'src-0', name: 'again.mp4', mimeType: 'video/mp4', bytes: Buffer.from([1]) },
      ])
      await expect(loadBundle(await writeBundle(dir, assembleV2(index, payload)), dir)).rejects.toThrow(
        'duplicate source id "src-0"',
      )
    })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

From `services/headless-artist`: `node_modules/.bin/vitest run src/loaders.test.ts --exclude '**/*.chromium.test.ts' --exclude '**/*.bench.test.ts'`
Expected:
- Every v2 case fails with `bundle "<path>" is not valid JSON` (today's loader `JSON.parse`s the binary file), or with the wrong message where a refusal was expected.
- The JSON version case fails: `expected … "but this build only supports version 1" to contain "but this build supports versions 1 and 2…"`.
- "still takes a JSON bundle down the version 1 path" passes.
- "names a directory it could not read" passes (`readFile` on a directory already fails into "could not be read"). It pins the new open-and-read path.

Paste one of each failure.

- [ ] **Step 3: Commit the red tests**

```bash
git add services/headless-artist/test/veditorV2.ts services/headless-artist/src/loaders.test.ts
git commit -m "test(headless-artist): read a .veditor v2 bundle by ranges, refusing by field (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

- [ ] **Step 4: Write the implementation**

In `services/headless-artist/src/loaders.ts`:

(a) Line 1 becomes:

```ts
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
```

(b) Replace `assertVeditorVideo` (lines 118-138, from `/**\n * Validates one \`videos[i]\` entry.` through its closing `}`) with:

```ts
/** A v2 entry's string fields: `data` is a byte range there, not a base64 string. */
const VEDITOR_V2_VIDEO_FIELDS = ['id', 'name', 'mimeType'] as const

/**
 * Validates what a `videos[i]` entry of either version shares: an object, `fields` present as
 * strings, and an optional `meta`. Without this a malformed bundle reaches the write loop as
 * `undefined`s. A `null` entry crashes on the property read, and a missing `mimeType` or `name`
 * quietly produces a `.bin` temp file the editor cannot decode.
 */
function assertVeditorEntry(
  value: unknown,
  index: number,
  fields: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`bundle video #${index} must be an object`)
  }
  for (const field of fields) {
    if (value[field] === undefined) {
      throw new Error(`bundle video #${index} is missing "${field}"`)
    }
    if (typeof value[field] !== 'string') {
      throw new Error(`bundle video #${index} field "${field}" must be a string`)
    }
  }
  if (value.meta !== undefined) {
    assertSourceMeta(value.meta, `bundle video #${index}`)
  }
}

/** One version 1 entry: `data` (and `thumbnail`, which the kit ignores) are base64 strings. */
function assertVeditorVideo(value: unknown, index: number): asserts value is VeditorVideo {
  assertVeditorEntry(value, index, VEDITOR_VIDEO_FIELDS)
}

/** A non-negative whole number JavaScript holds exactly. */
function isByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function assertByteRange(value: unknown, context: string): asserts value is ByteRange {
  if (!isRecord(value) || !isByteCount(value.offset) || !isByteCount(value.length)) {
    throw new Error(`${context} must be {"offset", "length"}, each a whole number of bytes >= 0`)
  }
}

/** One version 2 entry: `data` and the optional `thumbnail` are ranges of the payload. */
function assertVeditorVideoV2(value: unknown, index: number): asserts value is VeditorVideoV2 {
  assertVeditorEntry(value, index, VEDITOR_V2_VIDEO_FIELDS)
  assertByteRange(value.data, `bundle video #${index} field "data"`)
  if (value.thumbnail !== undefined) {
    assertByteRange(value.thumbnail, `bundle video #${index} field "thumbnail"`)
  }
}
```

(c) Replace lines 226-320 (from `interface VeditorBundle {` through the closing `}` of `loadBundle`) with:

```ts
/**
 * The v2 `.veditor` container (ESCSUITE-260): 16 header bytes (this magic, then the container
 * version and the index length as little-endian u32s), the UTF-8 JSON index, then every source's
 * (and thumbnail's) raw bytes back to back, in index order, with offsets counted from the
 * payload's first byte. Spelled out here rather than imported from apps/artist. Nothing in this
 * package imports the apps, the same reason the validators above are copies. Both packages'
 * tests pin the same header bytes literally, so the two readers cannot drift apart unnoticed.
 */
const V2_MAGIC = Buffer.from([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])
const V2_HEADER_BYTES = 16
const V2_VERSION = 2
/** ESCAPEARTIST's `MAX_INDEX_BYTES`: a corrupt header must not make the loader read gigabytes as text. */
const V2_MAX_INDEX_BYTES = 64 * 1024 * 1024

interface ByteRange {
  offset: number
  length: number
}

/** What both versions' entries share once validated. */
interface VeditorEntry {
  id: string
  name: string
  mimeType: string
  meta?: VeditorVideoMeta
}

interface VeditorVideoV2 extends VeditorEntry {
  data: ByteRange
  thumbnail?: ByteRange
}

/** Up to `length` bytes of the file from `position`; fewer only at the end of the file. */
async function readBytes(filePath: string, position: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** The project and the entries list both versions carry, before the entries are validated. */
function readBundleBody(
  bundle: Record<string, unknown>,
  bundlePath: string,
): { project: Project; videos: unknown[] } {
  if (!isRecord(bundle.project)) {
    throw new Error(`bundle "${bundlePath}" is missing "project"`)
  }
  if (!Array.isArray(bundle.videos)) {
    throw new Error(`bundle "${bundlePath}" is missing "videos"`)
  }
  return { project: bundle.project as unknown as Project, videos: bundle.videos }
}

/** Each entry valid, its id a safe and unique file name, every clip's source present. Before mkdtemp. */
function checkVideos<V extends VeditorEntry>(
  videos: unknown[],
  project: Project,
  assertVideo: (value: unknown, index: number) => asserts value is V,
): V[] {
  const sourceIds = new Set<string>()
  videos.forEach((video, index) => {
    assertVideo(video, index)
    assertSafeFileId(video.id, 'bundle video')
    assertUniqueSourceId(video.id, sourceIds)
  })
  validateClipReferences(project, sourceIds)
  return videos as V[]
}

/**
 * Writes each source to a temp file through `writeSource`, and builds the job. The temp
 * directory is removed if any write fails.
 */
async function materialiseSources<V extends VeditorEntry>(
  project: Project,
  videos: V[],
  tmpRoot: string,
  writeSource: (video: V, destPath: string) => Promise<void>,
): Promise<LoadedJob> {
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'headless-artist-'))

  const sourceFiles: Record<string, string> = {}
  const sourceVideos: SourceVideoInput[] = []

  try {
    for (const video of videos) {
      // Every field was validated before mkdtemp, so nothing here can be undefined.
      // Strip a `;codecs=...` parameter before the lookup, so "video/webm;codecs=vp9,opus"
      // still resolves to "webm" rather than falling through to the name or ".bin", and
      // lower-case it first so "Video/WebM" does too.
      const mimeBase = video.mimeType.split(';')[0].trim().toLowerCase()
      const ext = MIME_TO_EXTENSION[mimeBase] ?? extensionOf(video.name) ?? 'bin'
      const destPath = path.join(dir, `${video.id}.${ext}`)
      await writeSource(video, destPath)
      sourceFiles[video.id] = destPath
      // `meta` first, so the entry's own id/name/mimeType (the source of truth) always win,
      // the same order `projectManager.ts`'s `loadProject` applies to the identical `meta`.
      sourceVideos.push({ ...video.meta, id: video.id, name: video.name, mimeType: video.mimeType })
    }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    throw err
  }

  let cleaned = false
  return {
    project,
    sourceVideos,
    sourceFiles,
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The entries' ranges, in order (each source, then its thumbnail), must tile the payload
 * exactly: no gap, no overlap, nothing missing, nothing after the last source. A thumbnail is
 * checked here and never copied; the engine does not use it.
 */
function assertRangesTile(videos: VeditorVideoV2[], payloadBytes: number, bundlePath: string): void {
  let expected = 0
  videos.forEach((video, index) => {
    const ranges: Array<[string, ByteRange]> = [['data', video.data]]
    if (video.thumbnail) ranges.push(['thumbnail', video.thumbnail])
    for (const [field, range] of ranges) {
      if (range.offset !== expected) {
        throw new Error(
          `bundle "${bundlePath}" video #${index} field "${field}" starts at byte ${range.offset} of the media, expected ${expected}`,
        )
      }
      expected += range.length
    }
  })
  if (expected > payloadBytes) {
    throw new Error(`bundle "${bundlePath}" is truncated: it declares ${expected} bytes of media but holds ${payloadBytes}`)
  }
  if (expected < payloadBytes) {
    throw new Error(`bundle "${bundlePath}" has ${payloadBytes - expected} bytes after its last source`)
  }
}

/**
 * Copies `length` bytes from `start` to `destPath`. A ranged read stream, not a buffer: the
 * source never has to fit in memory. A zero-length range writes an empty file, because
 * `createReadStream` rejects `end < start`.
 */
async function copyRange(sourcePath: string, start: number, length: number, destPath: string): Promise<void> {
  if (length === 0) {
    await fs.writeFile(destPath, '')
    return
  }
  await pipeline(createReadStream(sourcePath, { start, end: start + length - 1 }), createWriteStream(destPath))
}

/**
 * A version 1 bundle: one JSON document with each source base64-encoded inside it. The whole
 * document is parsed in memory, but each source's base64 is decoded and streamed to a temp file
 * in chunks, never as one giant `Buffer.from(wholeString)`.
 */
async function loadBundleV1(bundlePath: string, tmpRoot: string): Promise<LoadedJob> {
  // `loadBundle` has already read this file's first bytes, so a read failure here is a race,
  // not a case to name.
  const raw = await fs.readFile(bundlePath, 'utf8')

  let bundle: unknown
  try {
    bundle = JSON.parse(raw)
  } catch {
    throw new Error(`bundle "${bundlePath}" is not valid JSON`)
  }

  if (!isRecord(bundle)) {
    throw new Error(`bundle "${bundlePath}" must be a JSON object`)
  }

  if (bundle.version !== 1) {
    if (typeof bundle.version === 'number' && bundle.version > 1) {
      throw new Error(
        `bundle "${bundlePath}" has version ${bundle.version}, but this build supports versions 1 and 2 (version 2 is the binary container, not JSON)`,
      )
    }
    throw new Error(`bundle "${bundlePath}" must declare "version": 1`)
  }

  const { project, videos: entries } = readBundleBody(bundle, bundlePath)
  const videos = checkVideos(entries, project, assertVeditorVideo)
  return materialiseSources(project, videos, tmpRoot, (video, destPath) => writeBase64ToFile(video.data, destPath))
}

/**
 * A version 2 bundle (ESCSUITE-260). Only the header and the index are read into memory. The
 * ranges are checked to tile the payload before any temp file exists, then each source is copied
 * with a ranged read, so a bundle of any size needs no more heap than a manifest does.
 */
async function loadBundleV2(bundlePath: string, head: Buffer, size: number, tmpRoot: string): Promise<LoadedJob> {
  const version = head.readUInt32LE(8)
  if (version !== V2_VERSION) {
    throw new Error(
      version > V2_VERSION
        ? `bundle "${bundlePath}" has version ${version}, but this build supports versions 1 and 2`
        : `bundle "${bundlePath}" has a binary header naming version ${version}, which no ESCAPEARTIST writes`,
    )
  }
  const indexLength = head.readUInt32LE(12)
  if (indexLength > V2_MAX_INDEX_BYTES) {
    throw new Error(
      `bundle "${bundlePath}" declares a ${indexLength}-byte index, over the ${V2_MAX_INDEX_BYTES}-byte limit`,
    )
  }
  const payloadStart = V2_HEADER_BYTES + indexLength
  if (payloadStart > size) {
    throw new Error(`bundle "${bundlePath}" ends before its index does`)
  }

  const raw = await readBytes(bundlePath, V2_HEADER_BYTES, indexLength)
  let index: unknown
  try {
    index = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error(`bundle "${bundlePath}" has an index that is not valid JSON`)
  }
  if (!isRecord(index) || index.version !== V2_VERSION) {
    throw new Error(`bundle "${bundlePath}" has an index that does not declare "version": 2`)
  }

  const { project, videos: entries } = readBundleBody(index, bundlePath)
  const videos = checkVideos(entries, project, assertVeditorVideoV2)
  assertRangesTile(videos, size - payloadStart, bundlePath)
  return materialiseSources(project, videos, tmpRoot, (video, destPath) =>
    copyRange(bundlePath, payloadStart + video.data.offset, video.data.length, destPath),
  )
}

/**
 * Loads a `.veditor` bundle, the editor's own save format, of either version. The first 16 bytes
 * decide: the v2 magic takes the ranged path, and anything else is read as version 1 JSON. For
 * large media saved by an older editor (version 1), prefer `loadManifest`, or open the project in
 * a current ESCAPEARTIST and save it again.
 */
export async function loadBundle(bundlePath: string, tmpRoot: string = os.tmpdir()): Promise<LoadedJob> {
  let size: number
  let head: Buffer
  try {
    size = (await fs.stat(bundlePath)).size
    head = await readBytes(bundlePath, 0, V2_HEADER_BYTES)
  } catch {
    throw new Error(`bundle "${bundlePath}" could not be read`)
  }

  if (head.length === V2_HEADER_BYTES && head.subarray(0, V2_MAGIC.length).equals(V2_MAGIC)) {
    return loadBundleV2(bundlePath, head, size, tmpRoot)
  }
  return loadBundleV1(bundlePath, tmpRoot)
}
```

`VeditorVideo` (lines 208-224) stays as it is; it satisfies `VeditorEntry` structurally. `VEDITOR_VIDEO_FIELDS` (line 77) stays.

Both sides of each new conditional are reached:
- The sniff `head.length === 16 && equals`: the existing `'[1, 2, 3]'` (9 bytes) and `'{ "version": 1,'` cases are under 16 bytes, so the first operand is false. The JSON fixture is ≥ 16 bytes but not the magic, so the second is false. Every v2 case makes both true.
- `version !== 2` and its ternary: versions 3 and 1, and every accepted file.
- The cap: `64 MiB + 1` refused; `64 MiB` exactly passes it and then fails the past-the-end check, which is false for every accepted file.
- `!isRecord(index) || index.version !== 2`: the list, version 1, and accepted files.
- `readBundleBody`'s two checks: the v2 "no project" / "videos not a list" cases and the existing v1 ones.
- `assertVeditorEntry`: the v1 suites reach every arm, and v2 adds "not an object", "id not a string" and "missing type".
- `assertByteRange`'s operands: `'AAAA'` (not a record), offset 1.5, length -1, and every accepted range. `isByteCount`'s `&&`: 1.5 fails the first operand, -1 the second.
- `thumbnail !== undefined` in `assertVeditorVideoV2` and `if (video.thumbnail)` in tiling: the thumbnail cases and every case without one.
- `offset !== expected`: gap, overlap, thumbnail-out-of-place.
- `expected > payloadBytes`: the 2 GiB case. `expected < payloadBytes`: the trailing case.
- `copyRange`'s `length === 0`: the zero-length case and every other copy.

- [ ] **Step 5: Run it green**

From `services/headless-artist`: `node_modules/.bin/vitest run src/loaders.test.ts --exclude '**/*.chromium.test.ts' --exclude '**/*.bench.test.ts'`, all passing. Then `pnpm --filter=@escapesuite/headless-artist run test:run`, `pnpm --filter=@escapesuite/headless-artist run typecheck` and `pnpm --filter=@escapesuite/headless-artist exec eslint .`. Also run `git grep -n "apps/artist\|@escapesuite/shared" services/headless-artist/src`; any hit must be a comment, not an import.

- [ ] **Step 6: Commit**

```bash
git add services/headless-artist/src/loaders.ts
git commit -m "feat(headless-artist): read .veditor v2 bundles with ranged copies, beside v1 (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 8: Kit Chromium parity, v1 against v2

**Files:**
- Test: `services/headless-artist/src/run.chromium.test.ts` (imports; one case inside `describe('runJob (real Chromium)')`).

**Interfaces:**
- Consumes: `runJob`, `BUNDLE`, `workDir`, `outDir`, `tmpRoot`, `VERSIONS`, `quiet`, `RENDER_TIMEOUT_MS`, `SERVICE_ROOT` (all in that file), and Task 7's `v2IndexAndPayload`, `assembleV2`.
- Produces: one Chromium case. It renders the v1 fixture `test/fixtures/project.veditor` and a v2 bundle of the same project over `test/fixtures/manifest/src-0.mp4`, and expects the same manifest `width`, `height` and `durationSec`. The source is `src-0.mp4` rather than `examples/clip.mp4` because `src-0.mp4` is exactly the bytes the v1 fixture embeds (the existing `loadBundle` test proves it), so the two bundles carry identical media.

This test launches Chromium, so it is not red first. It is a parity guard. The implementer does not run it (Global Constraint 4); CI's `e2e` job runs it through `test:e2e`.

- [ ] **Step 1: Write the case**

Add to the imports of `services/headless-artist/src/run.chromium.test.ts`:

```ts
import { assembleV2, v2IndexAndPayload } from '../test/veditorV2'
```

Add inside `describe('runJob (real Chromium)', () => {`, after the first case (`'renders a manifest job and delivers it through the volume sink'`):

```ts
  // ESCSUITE-260: the same project from a v1 JSON bundle and from a v2 container renders alike.
  // The v2 bundle is built here over test/fixtures/manifest/src-0.mp4, exactly the bytes the v1
  // fixture embeds, so the media is identical and only the container differs.
  it('renders the same project from a v1 and a v2 .veditor bundle alike', async () => {
    const v1Path = path.join(SERVICE_ROOT, 'test/fixtures/project.veditor')
    const v1 = JSON.parse(await fs.readFile(v1Path, 'utf8'))
    const source = await fs.readFile(path.join(SERVICE_ROOT, 'test/fixtures/manifest/src-0.mp4'))
    const { index, payload } = v2IndexAndPayload(v1.project, [
      { id: v1.videos[0].id, name: v1.videos[0].name, mimeType: v1.videos[0].mimeType, bytes: source },
    ])
    const v2Path = path.join(tmpRoot, 'project-v2.veditor')
    await fs.writeFile(v2Path, assembleV2(index, payload))

    const render = async (jobId: string, bundle: string) => {
      const outcome = await runJob(
        {
          jobId,
          input: { bundle: { path: bundle } },
          options: { format: 'mp4', quality: 'medium' },
          output: { sink: 'volume', config: { dir: outDir } },
        },
        { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: quiet },
      )
      expect(outcome.ok).toBe(true)
      return JSON.parse(await fs.readFile(path.join(outDir, `${jobId}.manifest.json`), 'utf8')) as {
        width: number
        height: number
        durationSec: number
      }
    }

    const fromV1 = await render('e2e-veditor-v1', v1Path)
    const fromV2 = await render('e2e-veditor-v2', v2Path)

    expect(fromV1).toMatchObject({ width: 64, height: 48 })
    expect({ width: fromV2.width, height: fromV2.height, durationSec: fromV2.durationSec }).toEqual({
      width: fromV1.width,
      height: fromV1.height,
      durationSec: fromV1.durationSec,
    })
    // Both renders' scratch dirs, and their bundle temp files, are gone.
    expect(await fs.readdir(workDir)).toEqual([])
  }, 2 * RENDER_TIMEOUT_MS)
```

- [ ] **Step 2: Typecheck and lint**

`pnpm --filter=@escapesuite/headless-artist run typecheck` and `pnpm --filter=@escapesuite/headless-artist exec eslint .` must both pass. Confirm `test:run` still excludes the file: `pnpm --filter=@escapesuite/headless-artist run test:run` must show no Chromium launch.

- [ ] **Step 3: Commit**

```bash
git add services/headless-artist/src/run.chromium.test.ts
git commit -m "test(headless-artist): a v1 and a v2 .veditor bundle render the same manifest in Chromium (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```

---

## Task 9: The e2e spec, the docs and the changeset

**Files:**
- Modify: `apps/e2e/tests/integration/workflows.spec.ts` (imports; the `'project can be saved'` test, lines 75-87).
- Modify: `apps/artist/CLAUDE.md`: the `projectManager.ts` entry (lines 346-357, and the "File format" paragraph from line 380); the `useProjectActions.ts` row (line 3545); the kit paragraph (around line 5017).
- Modify: `services/headless-artist/README.md` (line 114; lines 196-210; the sizing bullet around line 981).
- Modify: `CLAUDE.md` (root): the "Headless render service" bullet, line 338, and nothing else in the file.
- Create: `.changeset/escsuite-260-veditor-v2.md`

`apps/e2e/tests/accessibility/core.spec.ts`'s `{}` seed is unaffected and is **not** edited. Its own comment says the file is never read: the safety dialog asks before any load. Had it been read, 2 bytes is shorter than a header, so it would take the v1 path and fail as before.

- [ ] **Step 1: The e2e spec**

In `apps/e2e/tests/integration/workflows.spec.ts`, add `import { readFile } from 'node:fs/promises'` after the `@playwright/test` import. Change the `../../utils/artist` import to:

```ts
import {
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
  importMediaAndAddToTimeline,
} from '../../utils/artist'
```

Replace the test `test('project can be saved', async ({ page }) => { … })` inside `test.describe('Project Save and Reload', …)` with:

```ts
  // ESCSUITE-260: "Save Project" downloads a v2 `.veditor` container
  // (core/projectFileFormat.ts), not JSON, and the uploader opens it again.
  test('a saved project is a v2 container and reopens through the uploader', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.veditor$/)
    const savedPath = await download.path()
    expect(savedPath).toBeTruthy()
    const bytes = await readFile(savedPath!)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x56, 0x45, 0x44, 0x0d, 0x0a, 0x1a, 0x0a])

    // Start over, then open the file the way a user drops one in.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByRole('menuitem', { name: /New Project/ }).click()
    await expect(page.getByText(/^1 clip · 1 track$/)).toHaveCount(0)

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'reopened.veditor', mimeType: 'application/octet-stream', buffer: bytes })

    await expect(page.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })
```

Then run `pnpm --filter=@escapesuite/e2e run typecheck` (or `pnpm -r run typecheck`) and `pnpm --filter=@escapesuite/e2e exec eslint .`. Do **not** run Playwright.

- [ ] **Step 2: `apps/artist/CLAUDE.md`**

(a) In the `projectManager.ts` entry, replace the first line `- \`projectManager.ts\`: Project save/load to JSON files with embedded video references.` and the whole **Size limit (ESCSUITE-241)** paragraph after it (through `…A binary \`.veditor\` v2 container is a separate follow-up.`, line 357) with:

```markdown
- `projectManager.ts`: Project save/load to `.veditor` files.
  **Container (ESCSUITE-260)**: `saveProject` writes the v2 container defined in
  `projectFileFormat.ts`: 16 header bytes (`89 56 45 44 0D 0A 1A 0A`, then the container version 2 and
  the index length N as little-endian u32s), N bytes of UTF-8 JSON index (`{ version: 2, project,
  editor?, videos: [{ id, name, mimeType, meta?, data: { offset, length }, thumbnail?: { offset,
  length, mimeType } }] }`, offsets counted from the payload's first byte), then every used source's and
  thumbnail's bytes back to back in index order. The stored `Blob`s go into
  `new Blob([...], { type: 'application/octet-stream' })` **by reference**: no source byte is read on
  save, there is no `FileReader` and no base64, and the only bytes built in JS are the header and the
  index (whose bulk is waveform peaks). `loadProject` sniffs the first 16 bytes. A v2 header goes
  through `readProjectFileIndex`: a version above 2 is refused as "newer", and an N over
  `MAX_INDEX_BYTES` (64 MiB) or past the file's end is refused before anything is sliced. The
  index's shape and every offset and length (a non-negative safe integer) are validated. Then
  `assertRangesTile` requires the ranges to tile the payload exactly, in order, ending at the file's
  size: a gap, an overlap, a truncated download (named as "declares X of media and holds Y") and
  trailing bytes are each refused. Each part is then `file.slice`d straight into `storeVideo` /
  `storeThumbnail` and the metadata probes, so a source never enters the JS heap. Anything else
  (every file an older build wrote, and anything that is not a project) takes the unchanged v1 path:
  `file.text()`, `JSON.parse`, `base64ToBlob`. **Before any write**, the v2 path sums the data and
  thumbnail lengths of every entry whose id is not already stored (a present row writes nothing,
  ESCSUITE-151). It refuses, by name, a load that needs more than `getStorageEstimate()` says is free:
  "This project needs 1.5 GiB of storage and this browser has 1.0 GiB free." The check is skipped when
  `quota` is 0 (no estimate API, so nothing was measured), a negative `available` counts as nothing
  free, and no margin is added because the sum is exact. The estimate is approximate, so **a load that
  throws after it started writing rolls back** what it wrote. Every id this call stored is deleted
  through `deleteVideo` (video and thumbnail rows), each in its own `try`/`catch` with one
  `console.warn` per failure. An id that was present before the load is never touched, and the
  original error is rethrown. The rollback lives in the loop both versions share (`restoreSources`),
  so it covers a v1 load too. A row it cannot delete is unreferenced and shows in ESCSUITE-268's
  "files from earlier sessions" list. Every refusal is a `ProjectFileError` whose message is shown:
  `useProjectActions` says "Failed to load project: \<reason\>" for one, and shows the writer's one
  refusal (an index past the cap, unreachable in practice) on its own. **The format sets no project
  size limit**: a `.veditor` is limited by the browser's download size and its storage quota, not by
  the format. Measured 2026-10-12 on macOS: a project of about N GB saved and reopened in Chromium 153
  and Firefox 155 with the heap flat. WebKit carries the ESCSUITE-258 Blob-in-IndexedDB caveat. An
  older ESCAPEARTIST opening a v2 file fails at `JSON.parse` with its own "Failed to load project". The
  ESCSUITE-241 budget (`MAX_PROJECT_FILE_BASE64_BYTES`, `ProjectTooLargeError`, `blobToBase64`) is gone
  with the string it guarded. The picker asks for `application/octet-stream` and filters by the
  `.veditor` extension; the fallback input's `accept` is `.veditor`.
```

**The "N" in "about N GB" is the one value allowed to be filled in later.** Leave it as the literal `N`. The coordinator replaces it with the measured size after the manual 2 GB save-and-reopen check in Chromium and Firefox (spec, "Manual, before merge"). Do not invent a number.

(b) In the **File format** paragraph (it begins `**File format**: each entry in \`ProjectFile.videos\` carries the video's base64 bytes and,`), append at its end, after `…a latency and failure-mode change for that one caller.`:

```markdown
  Since ESCSUITE-260 the same `meta` rides in each v2 index entry, and both versions hand each source
  to one helper, `restoreSource(entry, blob, thumbnail, existing, written)`. The duration and
  dimension recovery above and the ESCSUITE-151 identity rules therefore cannot drift between v1 and
  v2. A v2 thumbnail keeps its own `mimeType`; a v1 one is still read as `image/jpeg`.
```

(c) In the `useProjectActions.ts` row (line 3545), replace the text `now a bad file shows "Failed to load project: \<reason\>" and the current project is never touched.` with:

```markdown
now a bad file shows "Failed to load project: \<reason\>" and the current project is never touched. A `.veditor` that `loadProject` itself refuses (a damaged or cut-off v2 file, or one that will not fit in storage, ESCSUITE-260) throws `ProjectFileError` and gets the same "Failed to load project: \<reason\>" sentence; any other throw keeps the bare "Failed to load project". On save, a `ProjectFileError` (the writer's index cap) is shown as its own message and anything else as "Failed to save project"; a failed save-and-load keeps its dialog either way.
```

(d) In the kit paragraph (around line 5017, the line that begins `` `loadBundle`) forwards each `videos[]` entry's optional `meta` ``), replace the text `` `loadBundle`) forwards `` with:

```markdown
`loadBundle`, which reads v1 JSON and, since ESCSUITE-260, the v2 container by ranged copies) forwards
```

- [ ] **Step 3: `services/headless-artist/README.md`**

(a) Line 114: replace `` | `input.bundle.path` | — | A `.veditor` file exported from the editor. | `` with `` | `input.bundle.path` | — | A `.veditor` file saved from the editor (version 1 or 2). | ``.

(b) Replace the first three paragraphs of the `### \`.veditor\` bundle` section (from `The editor's own export format: one JSON document holding the project and every source video` through `…for anything large, use a manifest.`) with the following. This block contains code fences, so it is shown here inside a tilde fence:

~~~markdown
The editor's own save format. A bundle is either of the two versions ESCAPEARTIST has written, and
the loader tells them apart by the first bytes.

**Version 2** (ESCAPEARTIST since ESCSUITE-260) is a binary container:

```
offset 0   8 bytes  magic  89 56 45 44 0D 0A 1A 0A
offset 8   u32 LE   container version = 2
offset 12  u32 LE   N = index length in bytes (at most 64 MiB)
offset 16  N bytes  UTF-8 JSON index
offset 16+N         every source's (and thumbnail's) raw bytes, back to back in index order
```

```json
{ "version": 2, "project": { … }, "editor": { … }, "videos": [ { "id": "src-0", "name": "clip.mp4", "mimeType": "video/mp4", "meta": { … }, "data": { "offset": 0, "length": 1048576 }, "thumbnail": { "offset": 1048576, "length": 4096, "mimeType": "image/jpeg" } } ] }
```

Offsets count from the payload's first byte. The loader reads the 16-byte header and the index and
nothing else into memory. It checks that the ranges tile the payload exactly: no gap, no overlap,
nothing missing (a truncated download is refused before any temp file is created) and nothing after
the last source. It then copies each source to a temp file with a ranged read. A version 2 bundle of
any size needs no more heap than a manifest does. Thumbnails and `editor` (the in/out points and
markers) are checked or carried but not used by the engine.

**Version 1** is one JSON document holding the project and every source base64-encoded inline:

```json
{ "version": 1, "project": { … }, "videos": [ { "id": "src-0", "name": "clip.mp4", "mimeType": "video/mp4", "data": "<base64>" } ] }
```

The loader decodes each video to a temp file in chunks, but **the JSON document itself is parsed whole
into memory**. A 4 GB version 1 bundle needs more than 4 GB of heap, and one past Node's maximum
string length (about 512 Mi characters) cannot be read at all. Open it in a current ESCAPEARTIST and
save it again to get a version 2 bundle, or use a manifest.

Either way, each `videos[].id` must be a safe file-name token (`/^[A-Za-z0-9._-]{1,128}$/`, not `.`
or `..`) because it becomes one. A malformed bundle is refused before Chromium launches, naming the
problem, for example: `bundle "<path>" has version 3, but this build supports versions 1 and 2`,
`bundle "<path>" is truncated: it declares 2147483648 bytes of media but holds 10`, or
`bundle "<path>" video #0 field "data" must be {"offset", "length"}, each a whole number of bytes >= 0`.
~~~

The two paragraphs that follow (the `"meta"` one and the `examples/job-veditor-volume.json` one) stay as they are.

(c) In "Sizing and throughput", the **Memory scales with resolution** bullet ends with the sentence "A `.veditor` input is the exception: it also needs headroom for the whole JSON document.", which wraps across two lines in the file. Replace that sentence with:

```markdown
A version 1 `.veditor` input is the exception: it also needs headroom for the whole JSON document. A
  version 2 one does not, because its sources are copied by ranged reads.
```

- [ ] **Step 4: Root `CLAUDE.md`**

In the "Headless render service (services/headless-artist)" bullet, replace `names its input as either a self-contained \`bundle\` or a \`manifest\`` with `names its input as either a self-contained \`.veditor\` \`bundle\` (v1 or v2) or a \`manifest\``. Touch nothing else in the root `CLAUDE.md`; the coverage paragraph is the coordinator's.

- [ ] **Step 5: The changeset**

Create `.changeset/escsuite-260-veditor-v2.md`:

```markdown
---
'@escapesuite/artist': minor
'@escapesuite/headless-artist': minor
---

Projects of any size can be saved and reopened now; the only limits are your browser's download size and the storage it has free.

A saved project (`.veditor`) used to hold every video as text inside one huge string, which capped a whole project at about 190 MB of media and read every video into memory on save. Projects are now saved in a new format that copies the videos into the file as they are, without reading them, and reopening one copies each video straight into the browser's storage. A project too big for the storage you have free is refused before anything is written, with a sentence saying how much it needs and how much is free. A load that fails partway removes what it had already copied. A damaged or cut-off project file is refused with the reason. Projects saved by earlier versions still open, but a project saved by this version cannot be opened by an older ESCAPEARTIST, which reports "Failed to load project". The headless render kit reads both the old and the new format, and reads the new one without loading the whole file into memory.
```

- [ ] **Step 6: Final checks**

Run, from the root:
- `pnpm --filter=@escapesuite/artist exec vitest run`
- `pnpm --filter=@escapesuite/headless-artist run test:run`
- `pnpm -r run typecheck`
- `pnpm --filter=@escapesuite/artist exec eslint .`
- `pnpm --filter=@escapesuite/headless-artist exec eslint .`
- `pnpm --filter=@escapesuite/e2e exec eslint .`
- the byte-identical check (Global Constraint 6)
- `git grep -n "Exporting video\|too large to save as a .veditor" apps services`, which must print nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/e2e/tests/integration/workflows.spec.ts apps/artist/CLAUDE.md services/headless-artist/README.md CLAUDE.md .changeset/escsuite-260-veditor-v2.md
git commit -m "docs: the .veditor v2 container in ARTIST and the headless kit; the save-and-reopen e2e reads the magic (ESCSUITE-260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QKvh2qnXJThTDcwYbZ54SU"
```
