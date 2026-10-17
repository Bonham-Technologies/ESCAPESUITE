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
//
// An **embedded** editor never reads or writes that key (ESCSUITE-332).
// `sessionStorage` belongs to the top-level tab, so every same-origin frame in
// one host page shares it: a second ESCAPEARTIST frame read the first frame's
// id, found its lock held, renewed — and wrote its new id over the shared key,
// so after a host reload the two frames swapped sessions. In a frame instead:
// - a host that names the frame with `?tabKey=<name>` gets the id
//   `host:<name>`, the same on every load, so each named frame keeps its own
//   slot (`session:host:<name>`) and lock across a host reload. The key is used
//   only as a suffix of storage and lock names, so nothing beyond the trim and
//   length cap `parseUrlParams` applies is done to it;
// - a frame with no name gets an id for this page load only: a host reload
//   starts it a new slot, and its old one is offered like any departed tab's,
//   newest free first — the trade for not naming it.
// A `host:` id is never renewed into another one: a second frame given the
// same key is the host's mistake, said once in the console, and that frame
// takes an id for this page load, so it overwrites nothing.

/** The `sessionStorage` key this tab's id is kept under. */
export const TAB_ID_KEY = 'escapeartist-tab-id';

/**
 * A new id. `crypto.randomUUID` is exposed to secure contexts only, and an
 * editor served over plain http from a LAN address has none — that tab must
 * still start, so it gets 128 random bits from `crypto.getRandomValues`, which
 * every context has, written as hex.
 */
function mintTabId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** Where this document runs, as far as its id is concerned (ESCSUITE-332). */
export interface TabIdSource {
  /** Framed by a host page (`isEmbedded()`). */
  embedded: boolean;
  /** `?tabKey=`, the host's name for this frame; `null` when it named none. */
  tabKey: string | null;
}

/** A top-level tab: the id lives in its own `sessionStorage`. */
const TOP_LEVEL: TabIdSource = { embedded: false, tabKey: null };

/**
 * This tab's id: the one it already has, or a new one kept for next time — or,
 * in a frame, the host's name for it or an id for this page load.
 */
export function readTabId({ embedded, tabKey }: TabIdSource = TOP_LEVEL): string {
  if (embedded) return tabKey ? `host:${tabKey}` : mintTabId();
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

/**
 * Give this tab a new id in place of the one it has — a duplicated tab's copy,
 * or, in a frame, a second frame the host gave the same `?tabKey=`.
 */
export function renewTabId({ embedded, tabKey }: TabIdSource = TOP_LEVEL): string {
  const minted = mintTabId();
  if (embedded) {
    if (tabKey) {
      console.warn(
        `ESCAPEARTIST: another editor in this page is already using ?tabKey=${tabKey}; ` +
          'this one keeps its session for this page load only. Give each frame its own tabKey.'
      );
    }
    return minted;
  }
  try {
    sessionStorage.setItem(TAB_ID_KEY, minted);
  } catch {
    // Unusable sessionStorage: the new id lasts for this document only.
  }
  return minted;
}
