/**
 * ESCSUITE-470: headless Chromium answers `showSaveFilePicker` at once with an
 * AbortError (it has no dialog to show), which ESCAPEARTIST reads as the user
 * cancelling, so every spec that exports or saves and waits for a download
 * would get none. Chromium launched without its local file pickers puts the
 * editor on its download path, as in a browser that has none;
 * `tests/regressions/ESCSUITE-470.spec.ts` stubs the picker with an
 * OPFS-backed handle to cover the other path.
 */
export const NO_LOCAL_FILE_PICKERS = '--disable-blink-features=FileSystemAccessLocal'
