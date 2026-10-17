// The other tabs' session slots this tab has declined (ESCSUITE-306).
//
// "Start Fresh" on another tab's slot deletes nothing: a tab whose lock is free
// may only have been discarded — Chrome's Memory Saver, on by default, unloads
// a background tab's page (its Web Lock goes with it) but keeps the tab and its
// `sessionStorage`, so it reloads with its id and looks for its own slot. The
// slot is left for it, and this list is how the declining tab knows not to
// offer it again (`findOfferableSlot` skips every id on it). Another tab, with
// a list of its own, may still be offered the slot.
//
// Kept in `sessionStorage` beside the tab id (`tabId.ts`), so it belongs to this
// tab and survives its reloads. Where `sessionStorage` cannot be written (a
// sandboxed frame throws on every access), a declined id is kept for this
// document instead, so the slot is still not offered again until it unloads.

/** The `sessionStorage` key the list is kept under: a JSON array of tab ids. */
export const DECLINED_SLOTS_KEY = 'escapeartist-declined-slots';

/** Ids declined in this document that `sessionStorage` would not take. */
const inThisDocument = new Set<string>();

/** Every slot this tab has declined: what `sessionStorage` holds, and this document's. */
export function readDeclinedSlots(): Set<string> {
  const declined = new Set(inThisDocument);
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY) ?? '[]');
    if (Array.isArray(stored)) for (const id of stored) declined.add(id);
  } catch {
    // Unusable sessionStorage, or a value that is not JSON: this document's list stands.
  }
  return declined;
}

/** Remember that this tab declined `tabId`'s slot. */
export function rememberDeclinedSlot(tabId: string): void {
  const declined = readDeclinedSlots();
  declined.add(tabId);
  try {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify([...declined]));
  } catch {
    inThisDocument.add(tabId);
  }
}
