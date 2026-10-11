// This tab's id (ESCSUITE-274): the key of its own session slot
// (`session:<tabId>`, `core/storage.ts`) and the name of the lock it holds for
// its lifetime (`escapeartist-tab:<tabId>`, `sessionLock.ts`).
//
// Kept in `sessionStorage`, which belongs to one tab and survives a reload: a
// reloaded tab finds its slot again, and a new tab — which starts with an empty
// `sessionStorage` — gets a new one. A browser copies `sessionStorage` into a
// *duplicated* tab, id and all; `useSessionRestore` notices that the copied id
// is still held by a live tab and calls `renewTabId()`.
//
// Where `sessionStorage` cannot be used at all (a sandboxed frame without
// `allow-same-origin` throws on every access), the tab still gets an id — one
// for this document only, so a reload starts a new slot rather than finding
// the old one.

/** The `sessionStorage` key this tab's id is kept under. */
export const TAB_ID_KEY = 'escapeartist-tab-id';

/**
 * A new id. `crypto.randomUUID` is exposed to secure contexts only, and an
 * editor served over plain http from a LAN address has none — that tab must
 * still start, so it gets a time-and-random id instead. Either is unique
 * enough for what it names: one tab's slot among a handful.
 */
function mintTabId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** This tab's id: the one it already has, or a new one kept for next time. */
export function readTabId(): string {
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored) return stored;
    const minted = mintTabId();
    sessionStorage.setItem(TAB_ID_KEY, minted);
    return minted;
  } catch {
    return mintTabId();
  }
}

/** Give this tab a new id in place of the one it has — a duplicated tab's copy. */
export function renewTabId(): string {
  const minted = mintTabId();
  try {
    sessionStorage.setItem(TAB_ID_KEY, minted);
  } catch {
    // Unusable sessionStorage: the new id lasts for this document only.
  }
  return minted;
}
