<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Import rows, the refusal notice and the metadata deadline (ESCSUITE-249)

`VideoUploader`'s upload rows are keyed by a per-file `id` (`uuidv4()`, minted when a file is
accepted into the loop), never by `fileName`: progress, completion, the fade-out, the error state
and Dismiss all match on `id`, and the list's React `key` is the same `id`. `fileName` is display
only, so two drops of `clip.mp4` get two rows with their own status and their own Dismiss, and
dismissing one leaves the other. The `.veditor` test lower-cases the name first, so `PROJECT.VEDITOR`
goes to `onProjectFile` like `project.veditor`. A drop with no recognised file at all is refused
through the editor's notice channel (`showNotification`) with "Only video, image, audio, caption
(.srt / .vtt) and .veditor files can be imported." (caption files joined the list in ESCSUITE-293)
instead of `window.alert()` — the last blocking `alert()` in the
app. `videoProcessor.ts`'s `settleMediaDuration` (behind `extractVideoMetadata`,
`extractAudioMetadata`, `loadMediaDuration` and so `resolveStoredDuration`) arms
`METADATA_LOAD_TIMEOUT_MS` (15 s) when it attaches its listeners; `loadedmetadata`, `error` and the
single release path clear it. On expiry it fails with "Could not read <name> — the browser did not
report its metadata within 15 s" through the same `fail` as the error path, so the row shows an
error and can be dismissed (and the object URL is revoked once). The end-seek duration probe keeps
its own 5 s timer, armed after `loadedmetadata`. Images load through `Image` and are untouched. The
media test double's `silent` script flag (`src/test/doubles/media.ts`) models an element that fires
nothing.

## Storage the browser will not open (ESCSUITE-414)

Where `getDB()` is refused (`isStorageUnavailable`, `@escapesuite/shared/storage`; re-exported by
`core/storageErrors.ts`), the uploader shows a notice under the drop zone from load, in
ESCAPECRAFT's wording family: "Your media library could not be opened — storage may be blocked in
this browser. Allow this site to store data, then reload." (`STORAGE_BLOCKED_NOTICE`,
`role="status"`, `#storage-blocked-notice`). It stays up, unlike the toast; the mount's library
read raises it, as does an import that is refused, and a read or an import that gets through takes
it down. A refused import's row reads `STORAGE_BLOCKED_IMPORT_MESSAGE` ("Storage is blocked in this
browser, so this file could not be imported. …") instead of the browser's sentence, and a project
load that cannot store a source says "… could not be stored: Storage is blocked in this browser."
The refusal is logged once for the page through `logStorageFailure` (the library read, the session
check, imports, the autosave and `clearSession` all go through it); the autosave raises no toast
for it, because "storage may be full" would not be true and the notice already says why. Any other
storage failure is logged as before. Regression: `apps/e2e/tests/regressions/ESCSUITE-414.spec.ts`.
