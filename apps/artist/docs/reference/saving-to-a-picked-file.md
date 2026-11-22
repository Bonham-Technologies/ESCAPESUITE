# Saving to a picked file (`src/core/saveFile.ts`, ESCSUITE-470)

Where the browser has the File System Access API's save picker (`window.showSaveFilePicker`,
Chromium and Edge), ESCAPEARTIST writes exports and projects straight to a file the user
chooses. Every other browser (Firefox, Safari, and any build or frame where the picker is missing
or not allowed) keeps the download it always had, with no change at all: `canPickSaveFile()` is
checked before anything is awaited, and the download path adds no `await` in front of the export.

## Export

- **The buttons say Export** (ESCSUITE-498). Where a click opens the picker (`mayPickSaveFile`:
  the browser has `showSaveFilePicker` and the page is the top-level page or from the same origin
  as it, since Chromium refuses the picker in a cross-origin frame and the export then downloads),
  the dialog's buttons read "Export WebM…", "Export MP4…" and "Export GIF…", the ellipsis saying a
  dialog follows; everywhere else they keep "Download WebM", "Download MP4" and "Download GIF". The
  accessible name is the text. The e2e specs select them with `exportButtonName(format)` from
  `apps/e2e/utils/artist.ts`, which matches either wording (e2e Chromium has no picker, so they
  read Download there); the ESCSUITE-470 spec asserts "Export WebM…" with its stand-in picker and
  "Download WebM" without one. `handleExport` asks for the picker by the same `mayPickSaveFile`,
  so the words and the click always agree: in a cross-origin frame it downloads without trying.
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
  bytes are on disk. That `File` is what an embedding host's `EXPORT_COMPLETE` carries; posting it
  passes a reference, so nothing is read into memory. `createWritable()` is opened without
  `keepExistingData`, so the stream starts empty and a picked file that held more than the
  export ends up holding the export alone (pinned in the e2e spec).
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
  browser has it); a file that held something keeps what it held. Chromium's save picker itself
  creates the chosen file, emptying one that already existed, the moment the user picks it, so a
  picked file is always empty here and a cancelled export over an existing file removes it rather
  than restoring it. Mediabunny closes its target on cancel as well as on finalize, so the sink's
  `WritableStream` is not the file's own stream: closing it commits nothing. A Cancel that lands
  after the exporter's last abort check, while `finish()` is committing, leaves the finished
  (complete) file in place. A run that wrote no bytes is not committed: `finish()` throws the
  exporters' own "no data was written" error instead, and the `discard()` after it removes the
  empty file.
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
- **Never over a project file with a source left out.** The download has always skipped a used
  source whose bytes are no longer in IndexedDB (ESCSUITE-330's missing source, a take deleted in
  CRAFT, ESCSUITE-151), which only ever made a new file. Writing over the project's file could
  overwrite the one file that still holds those bytes, so an in-place Save refuses, naming each
  source: `Not saved: the media for "<name>" is no longer stored in this browser, so the project
  file would lose it. The file was left as it was. Remove the clips that use it, then save. Or
  use Save Project As... to save a copy under a different name: replacing this file would lose
  that media.` (a `ProjectFileError` from `missingSourcesRefusal`, shown as the save's error;
  several sources read "them"). It warns against replacing the file because Chromium's picker
  empties a file it is pointed at before anything is written, and the copy is then written
  without the missing media, so picking the project's own file in Save As would lose the media
  only it may hold. It does not
  say to import the media again: an import makes a new source with a new id, which the clips
  that use the missing one do not pick up. The download path is unchanged.
- **The check comes first** (ESCSUITE-497). An in-place Save calls `findMissingSources` (a used
  source with no stored bytes, by name, or one the library no longer lists, by id) before
  anything else, so a save that would refuse opens no permission prompt and touches no file.
  `saveProjectToFile` checks again as it builds the file and still refuses a source that went in
  the meantime. The check is one IndexedDB read per used source; `mayWrite`'s prompt follows it
  within the click's activation window (Chromium's lasts five seconds and a read does not use it).
- **A new file may leave a source out** (ESCSUITE-497). The first Save and Save As write to a file
  the picker has just made (Chromium's picker empties a file that already existed as it is picked),
  so nothing in it can be lost. They pass `{ leaveOutMissing: true }`: the file is written as the
  download writes it, without the sources that have no bytes, and the save says so instead of
  "Project saved successfully": `Project saved without the media for "<name>", which is no longer
  stored in this browser. The clips that use it stay in the project, without media.` This matches the
  download's behaviour before ESCSUITE-470 (which said nothing) rather than asking first with a
  confirm dialog: the picker is still reached before any `await`, and a cancelled picker still
  saves nothing. The new file becomes the project's, so the next Save writes in place and refuses
  until its clips are removed. Save & Load in the "unsaved work"
  dialog leaves the source out the same way, without the notice, since the load's own notice
  follows at once.
- **Save As** (File menu, only where the picker exists; no shortcut) always asks and makes the new
  file the project's. When the project already has a file, it suggests `<project name> copy.veditor`
  rather than `<project name>.veditor`, so the picker's default answer is not the project's own file
  (ESCSUITE-497); with no file yet it suggests `<project name>.veditor`, as the first Save does. The
  name is known before the picker opens, so nothing is awaited first. New Project forgets the file, and so does opening a file that arrived any
  other way (a drop, the `<input>` fallback) and a host's `LOAD_PROJECT` (`App` wraps the
  `setProject` it hands `useHostIntegration` with `forgetProjectFile`), so the next Save asks.
- **One save at a time.** `save` ignores a second Save, Save As or Ctrl+S while one is running (a
  ref, so a press in the same tick is caught): it would open a second picker and clear `isSaving`
  while the first still wrote.
- **Save & Load** in the "unsaved work" dialog saves the same way; a cancelled picker loads
  nothing and leaves the dialog up.
- `.veditor` is unchanged.

## Testing

- Unit: `core/saveFile.test.ts` (the sink, against `test/doubles/fileHandle.ts`, an in-memory
  handle with Chromium's commit-on-close rule; it pins that the sink builds no Blob),
  `components/Export/ExportDialog.saveFile.test.tsx`, the ESCSUITE-470 block in
  `app/useProjectActions.test.ts` (with its ESCSUITE-497 cases), the `saveProjectToFile`,
  `findMissingSources` and `missingSourcesRefusal` cases in `core/projectManager.test.ts`, and a
  sink case in each exporter's suite.
- E2E: headless Chromium has no dialog to show, so its `showSaveFilePicker` rejects at once with
  `AbortError`; every e2e config launches Chromium with `--disable-blink-features=FileSystemAccessLocal`
  (`apps/e2e/utils/filePickers.ts`) so the existing specs keep downloading.
  `apps/e2e/tests/regressions/ESCSUITE-470.spec.ts` puts stand-in pickers back over the
  origin-private file system (`navigator.storage.getDirectory()`), whose handles have the same
  `createWritable()`, and reads the export back from there. Measured there (2026-11-19, a
  5-second text clip, by counting every Blob the page constructs during the export): the 19,014
  byte WebM was written to the file and the page built no Blob at all (largest: 0 bytes); the
  download path builds one Blob the size of the output.
  `apps/e2e/tests/regressions/ESCSUITE-497.spec.ts` deletes a clip's stored bytes, then checks
  that the first Save writes a project file and names the source, and that the Save after it
  refuses, opens no picker and leaves that file's bytes as they were.

Out of scope: Firefox and Safari (no save picker), the `.veditor` format, the three-hour export
limit.
