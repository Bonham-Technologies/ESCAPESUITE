// The saves of other tabs' session slots this tab has declined (ESCSUITE-306).
//
// "Start Fresh" on another tab's slot deletes nothing: a tab whose lock is free
// may only have been discarded — Chrome's Memory Saver, on by default, unloads
// a background tab's page (its Web Lock goes with it) but keeps the tab and its
// `sessionStorage`, so it reloads with its id and looks for its own slot. The
// slot is left for it, and this list is how the declining tab knows not to
// offer that same save again (`findOfferableSlot` skips a slot whose current
// `timestamp` is a declined one). An entry names the **save** — the slot's tab
// id and the `timestamp` every autosave stamps afresh — not the tab: once that
// tab saves newer work into its slot, the user has not turned that down
// (ESCSUITE-289's principle) and it is offered again. Another tab, with a list
// of its own, may still be offered the slot.
//
// Kept in `sessionStorage` beside the tab id (`tabId.ts`), so it belongs to this
// tab and survives its reloads (and a duplicated tab inherits it, as it does the
// id). Where `sessionStorage` cannot be written (a sandboxed frame throws on
// every access), a declined save is kept for this document instead.

/** The `sessionStorage` key the list is kept under: a JSON array of `DeclinedSave`. */
export const DECLINED_SLOTS_KEY = 'escapeartist-declined-slots';

/** One declined save: whose slot, and which save of it. */
export interface DeclinedSave {
  tabId: string;
  timestamp: number;
}

/** Saves declined in this document that `sessionStorage` would not take. */
let inThisDocument: DeclinedSave[] = [];

const isDeclinedSave = (entry: unknown): entry is DeclinedSave =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as DeclinedSave).tabId === 'string' &&
  typeof (entry as DeclinedSave).timestamp === 'number';

/**
 * Every save this tab has declined: this document's, then what `sessionStorage`
 * holds. A stored entry of any other shape — the first version's bare tab ids
 * included — is dropped; nothing is migrated.
 */
export function readDeclinedSlots(): DeclinedSave[] {
  const declined = [...inThisDocument];
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(DECLINED_SLOTS_KEY) ?? '[]');
    if (Array.isArray(stored)) declined.push(...stored.filter(isDeclinedSave));
  } catch {
    // Unusable sessionStorage, or a value that is not JSON: this document's list stands.
  }
  return declined;
}

/** Remember that this tab declined `save`; it replaces any earlier entry for the same tab. */
export function rememberDeclinedSlot(save: DeclinedSave): void {
  const declined = readDeclinedSlots().filter((entry) => entry.tabId !== save.tabId);
  declined.push(save);
  try {
    sessionStorage.setItem(DECLINED_SLOTS_KEY, JSON.stringify(declined));
  } catch {
    inThisDocument = declined;
  }
}

/** Test-only: forget this document's fallback list, as a new document would. */
export function __resetDeclinedSlotsForTests(): void {
  inThisDocument = [];
}
