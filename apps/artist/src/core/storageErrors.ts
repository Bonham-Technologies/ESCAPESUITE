// What ESCAPEARTIST says about a storage write that ran out of room, or about
// storage the browser will not open at all, and how it recognises each. Its own module, not `storage.ts`, because the App and hook
// suites replace `storage.ts` wholesale with a double (`test/appDoubles.ts`),
// and a constant read through that double would be `undefined`.

import { isStorageUnavailable } from '@escapesuite/shared/storage';

/**
 * The one sentence a quota failure reads as, wherever it is hit: the media
 * library's import row, the session autosave's notice (ESCSUITE-217) and a
 * project load that could not store a source (ESCSUITE-302).
 */
export const STORAGE_QUOTA_MESSAGE = 'Storage quota exceeded. Remove some media to free up space.';

/**
 * Whether a rejected storage write was a quota error, read through
 * `error.cause ?? error` — the shape ESCAPECRAFT's `failureName` reads
 * (ESCSUITE-210): a caller that adds context wraps the browser's own
 * `DOMException` as `cause`, while `idb` rejects with the bare one.
 */
export function isQuotaExceeded(error: unknown): boolean {
  const err = error as { name?: string; cause?: unknown } | null | undefined;
  return ((err?.cause ?? err) as { name?: string } | null | undefined)?.name === 'QuotaExceededError';
}

// Storage the browser will not open (ESCSUITE-414): site data blocked, Firefox's
// "Never remember history", storage denied by policy or to an embed. Every
// read and write rejects then, with the browser's own sentence, which is no
// use to anyone on screen. `isStorageUnavailable` tells that refusal apart
// from a read or a write that failed (`@escapesuite/shared/storage`'s `getDB`).
export { isStorageUnavailable };

/**
 * The media library's notice while storage cannot be opened, shown from load
 * and kept up — ESCAPECRAFT's `LIBRARY_UNREADABLE` says the same of its own
 * library.
 */
export const STORAGE_BLOCKED_NOTICE =
  'Your media library could not be opened — storage may be blocked in this browser. Allow this site to store data, then reload.';

/** What a write that needed storage says instead of the browser's error: an import's row, a project load. */
export const STORAGE_BLOCKED_MESSAGE = 'Storage is blocked in this browser.';

/** An import's row, when the file could not be stored because storage cannot be opened. */
export const STORAGE_BLOCKED_IMPORT_MESSAGE =
  'Storage is blocked in this browser, so this file could not be imported. Allow this site to store data, then reload.';

/** Set once a refused open has been logged: the page logs it once, not per call. */
let refusalLogged = false;

/**
 * Log a storage failure. A refused open is logged once for the whole page,
 * whoever hits it first — the library read at load, the session check, an
 * import, the autosave — and is quiet after that: while the browser refuses,
 * every call fails the same way and the notice already says why. Any other
 * failure is logged as it comes, under `context`.
 */
export function logStorageFailure(context: string, error: unknown): void {
  if (isStorageUnavailable(error)) {
    if (refusalLogged) return;
    refusalLogged = true;
    console.error('Browser storage could not be opened, so media and sessions cannot be kept:', error);
    return;
  }
  console.error(context, error);
}
