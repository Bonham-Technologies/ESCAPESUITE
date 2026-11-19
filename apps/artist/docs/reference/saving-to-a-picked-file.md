# Saving to a picked file (`src/core/saveFile.ts`, ESCSUITE-470)

Where the browser has the File System Access API's save picker (`window.showSaveFilePicker`,
Chromium and Edge), ESCAPEARTIST writes exports and projects straight to a file the user
chooses. Every other browser (Firefox, Safari, and any build or frame where the picker is missing
or not allowed) keeps the download it always had, with no change at all: `canPickSaveFile()` is
checked before anything is awaited, and the download path adds no `await` in front of the export.

## Export

- **The picker comes first.** `handleExport` works out the format and the file name
  (`<project>.<format>`) and calls `chooseSaveDestination` before any `await`, because the picker
  needs the click's user activation and an earlier `await` can spend it. The picker's type list
  holds the one format being exported.
- **Cancel starts nothing.** A picker the user dismisses (`AbortError`) returns before the
  progress bar, the analytics event or the exporter. A picker the page may not open
  (`SecurityError`: no activation left, a cross-origin frame) falls back to the download. Any
  other failure ("File picker already active.") is shown as `Export failed: Could not choose where
  to save: …` and starts nothing.
- **MP4 and WebM stream.** `openFileSink(handle)` opens a `FileSystemWritableFileStream` and hands
  the exporter an `ExportSink` (`{ writable, finish }`), the exporters' new last parameter, whose
  default is the `chunkCollector` the download uses. Mediabunny's `StreamTarget` chunks are
  already `{ type: 'write', position, data }`, the stream's positioned-write form, so its
  write-backs (a WebM Cluster's size, the Segment's size, Duration and SeekHead; the MP4 `moov`
  in its reserved space) land on bytes already written. No Blob of the output is ever built:
  `finish()` closes the stream, which commits it, and answers `handle.getFile()`, a `File` whose
  bytes are on disk. That `File` is what an embedding host's `EXPORT_COMPLETE` carries.
- **GIF does not stream.** `gifenc` produces the whole file at the end, so a GIF is encoded as
  before and its finished blob is written to the picked file in one go (`sink.writeAll`). A GIF is
  small next to a video (the dialog already warns about long ones).
- **Commit before "complete".** Each exporter calls `sink.finish()` after `finalize()` and after
  its last abort check, before it reports `complete`, so a commit the disk refuses still fails the
  export. The completion line says where it went: `Export complete! Saved to <name>.`
- **Cancel and failure leave nothing.** The stream writes to a swap copy the browser moves into
  place only on `close()`. The dialog's `catch` calls `sink.discard()` on every cancel or failure,
  which `abort()`s the stream (deleting the copy). A file that was empty when the export opened
  it (the one the picker just made) is also removed (`FileSystemHandle.remove()`, where the
  browser has it); a file that held something keeps what it held. Mediabunny closes its target on
  cancel as well as on finalize, so the sink's `WritableStream` is not the file's own stream:
  closing it commits nothing.
- **A failed write stops the export.** The first write the stream refuses is worded for the user
  (`fileWriteError`: `QuotaExceededError` "the disk is full", `NotAllowedError`/`SecurityError`
  "permission to write to it was taken away", `NotFoundError` "it was moved or deleted",
  `NoModificationAllowedError`/`InvalidStateError` "another program is using it") and aborts the
  run through its `AbortController`; the dialog reports that failure in place of the abort, as
  `Export failed: Could not write "<name>": …`, and offers no other format (it would go to the
  same disk). The muxer is not told: every sink write resolves and later ones are dropped,
  because an error Mediabunny read mid-encode would surface as an unhandled rejection in the
  encoder's output callback rather than as the export's failure. `finish()` throws it too, so a
  run the abort did not reach in time still fails.

## Project Save (`src/app/useProjectActions.ts`)

- **Save writes in place.** `useProjectActions` keeps the handle of the project's file: the one
  `showOpenProjectDialog` opened through `showOpenFilePicker` (remembered against the `File` by
  `rememberFileHandle`, read back by `fileHandleOf` once the load succeeds), or the one the first
  Save picked. Save then writes over it with `saveProjectToFile` (the same bytes `saveProject`
  downloads, written whole by `writeBlobToFile` or not at all). A handle from the open picker is
  read-only until `mayWrite` asks for `readwrite` access, also before any `await`; refused, the
  save says `Not saved: permission to write to "<name>" was not given. Use Save Project As... to
  choose a file.`
- **Save As** (File menu, only where the picker exists; no shortcut) always asks and makes the new
  file the project's. New Project forgets the file, and so does opening a file that arrived any
  other way (a drop, the `<input>` fallback), so the next Save asks.
- **Save & Load** in the "unsaved work" dialog saves the same way; a cancelled picker loads
  nothing and leaves the dialog up.
- `.veditor` is unchanged.

## Testing

- Unit: `core/saveFile.test.ts` (the sink, against `test/doubles/fileHandle.ts`, an in-memory
  handle with Chromium's commit-on-close rule; it pins that the sink builds no Blob),
  `components/Export/ExportDialog.saveFile.test.tsx`, the ESCSUITE-470 block in
  `app/useProjectActions.test.ts`, and a sink case in each exporter's suite.
- E2E: headless Chromium has no dialog to show, so its `showSaveFilePicker` rejects at once with
  `AbortError`; every e2e config launches Chromium with `--disable-blink-features=FileSystemAccessLocal`
  (`apps/e2e/utils/filePickers.ts`) so the existing specs keep downloading.
  `apps/e2e/tests/regressions/ESCSUITE-470.spec.ts` puts stand-in pickers back over the
  origin-private file system (`navigator.storage.getDirectory()`), whose handles have the same
  `createWritable()`, and reads the export back from there. Measured there (2026-11-19, a
  5-second text clip, by counting every Blob the page constructs during the export): the 19,014
  byte WebM was written to the file and the page built no Blob at all (largest: 0 bytes); the
  download path builds one Blob the size of the output.

Out of scope: Firefox and Safari (no save picker), the `.veditor` format, the three-hour export
limit.
