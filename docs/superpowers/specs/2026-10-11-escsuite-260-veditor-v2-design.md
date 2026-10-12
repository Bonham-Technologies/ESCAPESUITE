# ESCSUITE-260 — `.veditor` v2 container — design

**Status:** approved by the operator 2026-10-12 (all five questions answered; see Decisions). Jira:
ESCSUITE-260. Base: `main` at `89988d16`.
**Scope:** ESCAPEARTIST (`apps/artist`) and the headless kit (`services/headless-artist`).
**Ticket rulings already made:** write v2 only, read v1 and v2; `parseProject` still validates the
project JSON; the kit either learns v2 or is told it is v1-only; the ESCSUITE-241 budget goes from
the writer. Changesets `@escapesuite/artist: minor` and `@escapesuite/headless-artist: minor`.

## Decisions (operator, 2026-10-12)

1. **Format:** the custom binary container with a leading JSON index (B below). Zip was declined:
   its mandatory CRC-32 pass reads every source byte through JS on save, which is the cost this
   ticket removes, and nobody has asked to open a project in an unzip tool.
2. **Extension:** keep `.veditor`; the loader sniffs the first 8 bytes. Every drop route, picker
   filter, kit path and doc stays as it is. An older build opening a v2 file fails at `JSON.parse`
   with its existing "Failed to load project"; the changeset says so.
3. **Kit:** learns v2 in this ticket, with a kit minor changeset and a Chromium parity case.
4. **Quota on load:** both halves in scope — a headroom pre-check that refuses by name before any
   write, and a best-effort rollback of the sources a failed load already wrote. See "Quota and
   rollback on load".
5. **Sizes:** no number is promised. The docs say the file is limited by the browser's download
   size and storage quota, not by the format, and record one manual measurement as evidence.

## Goal

Save and reopen a project whose sources add up to gigabytes without building one huge string,
without reading source bytes into the JS heap on save, and without reading the whole file into
the heap on load.

## Non-goals

- Compression. Video, audio and JPEG thumbnails do not compress; deflate would only cost CPU on
  low-spec machines.
- Integrity hashes over the payload. Hashing means reading every byte through JS on save, which is
  exactly the cost this ticket removes. Truncation and junk are caught by exact length checks
  (below); a per-entry hash can be added later as an additive index field.
- A v1 writer or a "save compatible" option (ruled out by the ticket).
- Writing in place through the File System Access API. A save is still a download.

## Code map (what exists)

- `core/projectManager.ts` — `ProjectFile` (`version: 1`, `project`, optional `editor`
  (ESCSUITE-245), and `videos[]` of `{ id, name, mimeType, data: base64, thumbnail?: base64, meta? }`).
  - `saveProject`: collects the used sources from storage (`getVideo`, `getThumbnail`: Blob
    handles, so sizes cost nothing); runs the ESCSUITE-241 pre-pass (`MAX_PROJECT_FILE_BASE64_BYTES`
    = 256 MiB of base64 across all sources and thumbnails, then `ProjectTooLargeError` naming the
    total, the limit and the largest source); then `blobToBase64` (FileReader `readAsDataURL`, with a
    short-read refusal) per source and thumbnail; builds `meta` (`SourceVideoMeta` =
    `Omit<SourceVideo, 'id'|'name'|'mimeType'|'size'|'thumbnailUrl'>`, ESCSUITE-97);
    `JSON.stringify` the whole thing; downloads `<name>.veditor` as `application/json`.
  - `loadProject`: `file.text()` and `JSON.parse` the whole file; refuses `version > 1`;
    `base64ToBlob` per source; takes metadata from `meta` (recovering unusable duration and dimensions
    from the blob), else from a present stored row (ESCSUITE-151 round 2), else from a blob probe;
    strips a smuggled `thumbnailUrl`; for a present id it keeps CRAFT's five identity fields and
    writes nothing; for a new id it clears them and calls `storeVideo` / `storeThumbnail` (the
    thumbnail is always decoded as `image/jpeg`). It returns `{ project, sourceVideos, editor }`
    unvalidated.
  - `showOpenProjectDialog` (`accept: { 'application/json': ['.veditor'] }`, fallback
    `input.accept = '.veditor,application/json'`).
- `app/useProjectActions.ts` — `handleSaveProject` and `handleProjectLoadSaveAndLoad` show
  `error.message` for `ProjectTooLargeError` and "Failed to save project" otherwise; a failed
  save-and-load keeps its dialog. `loadProjectFile` runs `parseProject(project, editor)` before
  `resetProject()`, revokes refused sources' thumbnails (ESCSUITE-113), and calls `clearHistory()`
  last (ESCSUITE-164). Any throw from `loadProject` shows a bare "Failed to load project".
- `store/projectMigration.ts` — `parseProject(input, editorInput?)`. This is unchanged by the
  ticket: v2 hands it the same `project` and `editor` objects.
- `core/storage.ts` / `@escapesuite/shared/storage` — `storeVideo(id, blob, metadata)` is one
  `db.put`, so a lazily sliced `Blob` goes straight into IndexedDB without passing through JS.
- `components/VideoUploader.tsx` — routes a drop to the project path by the `.veditor` suffix
  (case-insensitive), and `accept="…,.veditor"`.
- `services/headless-artist/src/loaders.ts` — `loadBundle` uses `fs.readFile(path, 'utf8')` and
  `JSON.parse`, accepts only `version: 1`, validates entries (`assertVeditorVideo`,
  `assertSafeFileId`, `assertSourceMeta`, `validateClipReferences`), and decodes each `data` string
  to a temp file in 4 MiB base64 chunks. Note that **the kit has the same string ceiling**:
  `readFile(…, 'utf8')` of a file past Node's maximum string length (about 512 Mi characters) throws,
  so it cannot open a bundle past roughly the size the editor now refuses anyway. It ignores
  `editor` and thumbnails. The README admits that "a 4 GB bundle needs more than 4 GB of heap".
- Dependencies: **no zip library anywhere in the workspace.** `pnpm why fflate` is empty, and the
  lockfile has no `fflate`, `jszip`, `yauzl`, `client-zip` or `@zip.js`. Artist's runtime deps are
  `gifenc`, `idb`, `mediabunny`, `mp4box` and the React stack.

## Candidate formats

### A. Zip (stored, no compression), via `fflate` or hand-rolled

`project.json` plus `sources/<id>` and `thumbs/<id>` entries, with the central directory at the end.

- **For:** any OS can unzip and inspect it; random access through the central directory.
- **Against:**
  - CRC-32 is mandatory in every local header or data descriptor, so every source byte goes
    through JS once on save (CPU-bound on a low-spec machine, plus transient chunk allocations).
    That is the very read v2 exists to avoid. Writing CRC 0 produces a non-conforming file that
    some unzippers reject.
  - Past 4 GiB in an entry or an offset the archive needs ZIP64. As far as I know `fflate` does not
    write ZIP64; this needs verifying before anyone relies on it.
  - `fflate`'s streaming `Zip` emits `Uint8Array` chunks. An output `Blob` built from them is a
    second full copy, where B and C can reference the IndexedDB-backed `Blob`s directly.
  - On read, `unzip` wants the whole buffer, and streaming `Unzip` is sequential. Random access
    still means hand-parsing the central directory.
  - It adds a runtime dependency to a single-file standalone build. The size is unmeasured here:
    a few KB to tens of KB depending on tree-shaking.
- **Hand-rolled stored zip** drops the dependency but keeps the CRC pass and the ZIP64 work:
  roughly 200 lines of format code, for an interoperability benefit nobody has asked for.

### B. Binary container, leading JSON index (chosen)

```
offset 0   8 bytes  magic  89 56 45 44 0D 0A 1A 0A   ("\x89VED\r\n\x1a\n", PNG-style)
offset 8   u32 LE   container version = 2
offset 12  u32 LE   N = index length in bytes (<= MAX_INDEX_BYTES)
offset 16  N bytes  UTF-8 JSON index
offset 16+N         payload: every part's raw bytes, concatenated in index order
```

Index:
`{ "version": 2, "project": {…}, "editor"?: {…}, "videos": [ { "id", "name", "mimeType", "meta"?, "data": { "offset", "length" }, "thumbnail"?: { "offset", "length", "mimeType" } } ] }`.
Offsets are relative to the payload start, so the index's own length never feeds back into them.

- **Write:** sizes are known up front (Blob handles), so the index is built first and the file
  is `new Blob([header, indexBytes, video0, thumb0, video1, …], { type: 'application/octet-stream' })`.
  The source `Blob`s are referenced, never read. The only bytes built in JS are the 16-byte header
  and the index, whose bulk is `waveformData`.
- **Read:** `file.slice(0, 16).arrayBuffer()`, then `file.slice(16, 16 + N).text()` and
  `JSON.parse`, then `file.slice(16 + N + offset, … + length, mimeType)` per part. That slice goes
  straight into `storeVideo` / `storeThumbnail` and into the existing metadata probes, which already
  take a `Blob`. A 2 GB file never enters the heap.
- **Truncation and junk are refused before anything is written to IndexedDB:** the ranges must tile
  the payload exactly, in order, ending at `file.size`. Because the index comes first, a truncated
  download can be named ("declares 1,840 MiB of media, holds 1,203 MiB") rather than reported as
  "no index found".
- **Magic:** the high-bit first byte means a v2 file can never parse as JSON or be mistaken for
  text, and the CR LF / SUB / LF tail catches the corruption a text-mode transfer causes.
- **Forward compatibility:** new optional fields go in the index JSON (the same additive rule `meta`
  and `editor` followed under v1). Only a layout change bumps the u32 version. A reader refuses a
  version above 2 by name, as `loadProject` already does for v1.
- **The kit gets random access for free:** two small reads, then ranged
  `fs.createReadStream({ start, end })` per source.

### C. Binary container, trailing index (records, then index, then footer)

The same pieces, with the index and a fixed footer (`indexOffset`, `indexLength`, magic) written last.

- **For:** a writer can stream parts of unknown length, which matters for a future
  encode-while-saving.
- **Against:** our writer always knows every length, so this flexibility buys nothing today. A
  truncated file loses its index entirely and can only be refused as "not a project file", and every
  read starts with a seek to the end. Its one advantage is irrelevant here.

## Recommendation

**B.** It is about 100 lines of pure, fully testable code with no dependency and zero source bytes
read on save. It reads by slicing, refuses truncation with a precise message before any write, and
the kit can read it with ranged streams. Zip's only real advantage is opening the file in an OS
unzip tool, and that does not pay for a mandatory CRC pass over every byte plus ZIP64.

**Extension: keep `.veditor`, sniff the first 8 bytes.** The drop routing, the picker filters,
`input.bundle.path`, users' existing habits and every doc keep working. On save the `Blob` type
becomes `application/octet-stream`, and the picker's MIME key changes to match (the `.veditor`
extension is what actually filters). An older build that opens a v2 file fails at `JSON.parse` and
says "Failed to load project". That cannot be fixed retroactively, and the changeset says so.

## Implementation shape

- New `core/projectFileFormat.ts` (pure, no DOM, no storage):
  - `MAGIC`, `CONTAINER_VERSION = 2`, `MAX_INDEX_BYTES`.
  - `encodeProjectFile(index, parts, { maxIndexBytes })`, which returns `BlobPart[]`.
  - `isV2(headBytes)`.
  - `readProjectFileIndex(blob)`, which returns `{ index, payloadStart }` or throws
    `ProjectFileError`.
  - `sliceRange(blob, payloadStart, range, type)`.
  - `assertRangesTile(index, payloadStart, size)`.
  - `ProjectFileError extends Error`, with a message meant to be shown.
- `projectManager.ts`:
  - `saveProject` keeps its storage pre-pass (it already skips a missing record) and builds `meta`
    as now. It then calls `encodeProjectFile` and downloads the result. The progress sequence keeps
    its first and last messages; the per-video "Exporting" step has nothing left to do.
  - `loadProject` sniffs the head. A v2 file goes through the index and slices; anything else goes
    down the v1 path unchanged (`file.text()`, `JSON.parse`, `base64ToBlob`). The per-source body
    (meta recovery, the ESCSUITE-151 identity rules, the thumbnail resolve) becomes one shared helper
    fed `(entry, blob, thumbnailBlob?)`, so v1 and v2 cannot drift. The v2 thumbnail keeps its own
    `mimeType` rather than v1's hard-coded `image/jpeg`.
  - The function returns `{ project, sourceVideos, editor }` exactly as before, so `parseProject`
    and `loadProjectFile` do not change.
  - Deleted: `MAX_PROJECT_FILE_BASE64_BYTES`, `ProjectTooLargeError`, `blobToBase64`,
    `base64Length`, `sourceBytes` and `formatMiB`. `base64ToBlob` stays for v1.
- `useProjectActions.ts`: both save paths show `ProjectFileError`'s message (the only writer refusal
  left), and `loadProjectFile`'s catch shows `Failed to load project: <reason>` for a
  `ProjectFileError`. A corrupt or truncated v2 file, and a file that will not fit in storage, are
  thereby refused by name, through the same sentence shape `parseProject` failures already use.

## Size bounds: what replaces the 241 budget

- **The writer has no budget.** No string grows with the media, so `ProjectTooLargeError` and its
  two `instanceof` branches go.
- **`MAX_INDEX_BYTES` (proposed 64 MiB)** bounds the one string still built. The reader refuses a
  header that claims more, before slicing (a hostile or corrupt `N` must not make us read 4 GiB).
  The writer refuses the same cap, so it never writes a file its own reader rejects. In practice this
  is unreachable: about 2,000 waveform samples per source means kilobytes. The cap is a parameter
  with a default so a test can reach both sides cheaply.
- **Offsets and lengths** must be `Number.isSafeInteger` and ≥ 0 (exact to 2^53); the header's u32
  only bounds the index.
- **The real ceilings are the browser's:** blob-URL download size, and IndexedDB quota on load.
  Neither is promised as a number (decision 5). The docs and changeset say "limited by the
  browser's download size and storage quota, not by the format", name those two places, and record
  the manual check below as "verified at about N GB on Chromium and Firefox on macOS, 2026-10-12" —
  evidence, not a guarantee.

## Quota and rollback on load (decision 4)

Both halves live in `loadProject`'s v2 path and are written so the v1 path can share them
(`loadProject` already walks both through one per-source helper).

- **Pre-check.** After the index is parsed and the ranges are checked, and before any write, sum the
  `data.length` and `thumbnail.length` of every entry whose id is **not** already present in storage
  (a present row writes nothing, ESCSUITE-151), and compare it with `getStorageEstimate().available`
  from `@escapesuite/shared/storage`. If the total exceeds the headroom, throw `ProjectFileError`
  with "This project needs 1.8 GB of storage and this browser has 0.9 GB free." (both figures from
  one `formatGiB`/`formatMiB` helper picking the unit by size). The estimate is approximate and
  per-browser, so a load that passes can still fail at write time; the check removes the common case,
  and the rollback covers the rest. A browser with no `navigator.storage.estimate` reports
  `available: 0` from the shared helper today, which would refuse every load — so the check is
  skipped when `quota` is 0 (nothing was measured), not when `available` is 0. No buffer is added
  beyond the sum: `hasSpaceForFile`'s 10 MB margin is for one import; here the sum is exact.
- **Rollback.** `loadProject` keeps a list of the ids it has written (`storeVideo` succeeded) in
  this call. If any later `storeVideo`, `storeThumbnail` or probe throws, it deletes each written id
  through `deleteVideo` (`packages/shared/src/storage/index.ts`, which deletes the `videos` row and
  the `thumbnails` row for that id), each in its own `try`/`catch`
  with one `console.warn` per failure, then rethrows the original error. Ids that were present before
  the load are never deleted. Rollback is best-effort: a row it fails to delete is unreferenced and
  appears in ESCSUITE-268's "files from earlier sessions" list, which is the backstop.
- `useProjectActions.ts` shows the pre-check's sentence through the same `Failed to load project:
  <reason>` shape as every other `ProjectFileError`.

## v1 compatibility

- Every v1 file still opens through the unchanged v1 path, including its existing limit (a v1 file
  past the string ceiling could never have been written whole anyway). A file that is neither v2
  nor JSON still fails as today.
- ARTIST has no save-in-place. Every save is a fresh download, so a project opened from a v1 file is
  written as v2 on its next save and the original v1 file is never touched. No "migrate on Save As"
  decision is needed.
- `apps/e2e/tests/accessibility/core.spec.ts`'s `{}` seed file and `workflows.spec.ts`'s
  suffix-only download check are unaffected.

## Kit (decision 3: learns v2)

`loadBundle` opens the file with `fs.open` and reads 16 bytes. If the magic matches, it reads `N`
bytes and parses the index. It runs the existing validators: `assertVeditorVideo` adapted so a v2
entry's `data` is a range rather than a string, plus `assertSafeFileId`, `assertUniqueSourceId`,
`assertSourceMeta` and `validateClipReferences`. It checks that the ranges tile the payload, then
`pipeline(fs.createReadStream(path, { start, end: start + length - 1 }), createWriteStream(dest))`
per video. A zero-length range gets an empty file (Node rejects `end < start`); that is one branch,
with a case. Anything else takes today's v1 path. The kit stays independent of `@escapesuite/shared`
(it already duplicates its validators "since nothing here imports it"); the layout is a dozen lines,
and drift is caught by both packages pinning the same 16 header bytes literally. Error messages read
`bundle "<path>" …` as today; "only supports version 1" becomes "supports versions 1 and 2". This
also removes the kit's own heap ceiling on bundles, which today is the real reason the README steers
large jobs to a manifest. The alternative is to leave the kit v1-only. Then every save from a current
editor is unusable as a bundle, and the README must tell users to write a manifest instead, which
means unpacking sources by hand because the v2 bytes are not addressable files. That is a worse
answer than about 60 lines of loader code. The changeset is `@escapesuite/headless-artist: minor`.

## Tests (red first)

Artist (`core/projectFileFormat.test.ts`, `core/projectManager.test.ts`, `app/useProjectActions.test.ts`):

1. **Round trip at 2× the old limit, nothing materialised.** Use stored doubles whose `Blob`s report
   `size` 200 MiB and 312 MiB (about 512 MiB, twice the old 256 MiB budget) and whose
   `arrayBuffer`, `text`, `stream` and `slice` throw. `saveProject` must resolve and must not call
   FileReader. The parts handed to `new Blob` contain the source `Blob`s **by identity**, and the
   index offsets and lengths match the reported sizes. Red today: `ProjectTooLargeError`. To avoid
   jsdom summing real part sizes, assert on `encodeProjectFile`'s returned parts and on the index
   bytes, not on the downloaded `Blob.size`.
2. **Load from a virtual 2 GiB file.** Use a `File` double whose `slice` returns real bytes for the
   header and index ranges and a recording marker for payload ranges. The test asserts that
   `storeVideo` / `storeThumbnail` receive slices with exact `[start, end)` and type, and that
   `text` / `arrayBuffer` are never called on the whole file.
3. A real small round trip (bytes, `meta`, the `editor` block, the crop, the thumbnail type) through
   real jsdom `Blob`s, and the ESCSUITE-151 identity cases re-run against v2 entries.
4. **v1 still loads.** Keep the existing v1 suites; they become fixtures written as JSON strings,
   since the writer no longer produces them.
5. **Refused by name:**
   - bad magic sniffing falls to v1 and fails JSON;
   - version 3;
   - `N` over the cap;
   - `N` past `file.size`;
   - index not JSON;
   - a range that is not a safe integer;
   - ranges that overlap, leave a gap or are out of order;
   - a truncated payload (named shortfall);
   - trailing junk.

   Each refusal is checked to write nothing to IndexedDB, and `loadProjectFile` shows
   `Failed to load project: <reason>`.
5a. **Quota pre-check:** with `getStorageEstimate` stubbed to `{ quota: 4 GiB, available: 1 GiB }`
   and a file declaring 1.5 GiB of new media, `loadProject` throws the sentence naming both figures
   and writes nothing; with an id already present, that entry's bytes are not counted and the load
   proceeds; with `quota: 0` (no estimate API) the check is skipped; a total exactly equal to the
   headroom is accepted.
5b. **Rollback:** `storeVideo` resolves for the first source and rejects for the second → the first
   id is deleted, the original error is rethrown, and an id that was present before the load is not
   deleted; `deleteVideo` itself rejecting is warned once and does not mask the original error; a
   thumbnail write rejecting rolls back its own video too.
6. The writer refuses an index past the cap, with `maxIndexBytes` lowered; the save-and-load dialog
   stays open on it.
7. The ESCSUITE-241 budget suite is deleted with the code it tested; its "refuses" cases are the red
   form of case 1.

Kit (`loaders.test.ts`, `run.chromium.test.ts`):

- A v2 bundle loads: temp files are byte-identical to the source ranges and `meta` is forwarded.
- A zero-length range produces an empty file.
- v1 is unchanged.
- The refusals from case 5 are named per field.
- A 2 GiB-claimed truncated file is refused before `mkdtemp`.
- **Parity:** one Chromium case renders the same project from a v1 bundle and from a v2 bundle (a
  test-local writer over `examples/clip.mp4`) and expects the same verification manifest (dimensions,
  `durationSec`).

E2E (CI runs it; the implementer does not): `workflows.spec.ts` saves, asserts the download starts
with the magic, reopens it through the uploader and finds the clip.

Manual, before merge (decision 5): save and reopen a project with sources adding up to about 2 GB in
Chromium and Firefox on this machine, watching the heap stay flat, and record the measured size,
browsers and date in the ticket and the changelog as evidence rather than a promise. WebKit is
subject to the ESCSUITE-258 Blob-in-IDB caveat.

## Coverage expectations

- **Artist (floors 99 / 99 / 96 / 99, at 99.84 / 99.39 / 96.55 / 99.76):** the deletion removes about
  20 covered branches from `projectManager.ts` and 4 from `useProjectActions.ts` (the 241 pre-pass,
  `blobToBase64`, the `instanceof` checks). The new module must be 100 / 100 / 100 / 100, with every
  refusal reached from both sides. A defensive arm nothing can reach is deleted, not tested. Expect
  the figures to move by hundredths and no floor to be crossed.
- **Kit (floors 99 / 99 / 98 / 98, branches at 98.50):** about 3 branches of headroom, so every v2
  arm (the sniff, the cap, tiling, zero-length, the version) needs both sides tested.
- `*.perf.test.ts` and `App.*rerender*` files must stay byte-identical. Nothing here runs per frame.

## Docs to touch

- `apps/artist/CLAUDE.md`, the `projectManager.ts` entry:
  - Replace the "Size limit (ESCSUITE-241)" paragraph with the v2 layout, the sniff and the bounds.
  - Note the per-source helper shared by v1 and v2 in "File format".
  - Delete "A binary `.veditor` v2 container is a separate follow-up."
  - Update the `useProjectActions.ts` row for the named load refusal.
- `services/headless-artist/README.md`, the `.veditor` bundle section: both versions, the v2 layout,
  ranged copies, and dropping the "4 GB needs 4 GB of heap" caveat for v2.
- Root `CLAUDE.md`, the Headless render service bullet: "a `.veditor` bundle (v1 or v2)". The
  coverage paragraph is the coordinator's.
- Changesets: `.changeset/escsuite-260-veditor-v2.md` with `@escapesuite/artist: minor`, plus
  `@escapesuite/headless-artist: minor` if the kit is adopted. The text should say that projects
  of any size save now, and that older builds cannot open the new files.

## Open questions

None. The five questions this proposal put to the operator (format, extension, kit scope, quota on
load, sizes to promise) were answered on 2026-10-12 and are recorded under "Decisions" at the top.
