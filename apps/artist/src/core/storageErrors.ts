// What ESCAPEARTIST says about a storage write that ran out of room, and how it
// recognises one. Its own module, not `storage.ts`, because the App and hook
// suites replace `storage.ts` wholesale with a double (`test/appDoubles.ts`),
// and a constant read through that double would be `undefined`.

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
