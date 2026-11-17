// Persistent storage (ESCSUITE-468)
//
// Recordings and imported media sit in IndexedDB as "best-effort" data, which
// the browser may delete without asking: when the disk runs low, and in Safari
// after seven days of browser use with no interaction with the site. An origin
// granted persistence through `navigator.storage.persist()` is skipped by that
// clean-up. Neither app asked before.
//
// The request goes out after the first save of a session, never on load:
// Firefox shows a prompt and wants it to follow a user action, and Chromium and
// Safari decide on their own without one. It goes out at most once per page
// load, so a refusal is not asked again on every save. What the apps show is
// always what `navigator.storage.persisted()` answers, read on mount and again
// after every save.
//
// Nothing here throws. A browser with no Storage API, a `persist()` that
// rejects (a sandboxed embed, a denied permission) and one that throws all read
// as "not persisted", which is the honest answer: the data may be deleted.

/** Said beside the storage figure while the browser has agreed to keep the data. */
export const STORAGE_PERSISTED_MESSAGE = 'Protected from automatic clean-up'

/** Said beside the storage figure otherwise, including when the browser cannot say. */
export const STORAGE_NOT_PERSISTED_MESSAGE =
  'Your browser may delete these if it runs low on space; download what you want to keep.'

/** The sentence for a persistence state. */
export function storagePersistenceMessage(persisted: boolean): string {
  return persisted ? STORAGE_PERSISTED_MESSAGE : STORAGE_NOT_PERSISTED_MESSAGE
}

/** The last state read, or null before the first read answers. */
let current: boolean | null = null
const listeners = new Set<() => void>()

/** Set by the first request of this page load; later saves only re-read. */
let requested = false

/** Numbers each read, so an older one answering late is not published. */
let latestRead = 0

function publish(persisted: boolean): void {
  if (current === persisted) return
  current = persisted
  for (const listener of listeners) listener()
}

/** The last persistence state read, or null before one has been. */
export function getStoragePersisted(): boolean | null {
  return current
}

/** Hear every change of the state; returns the unsubscribe. */
export function subscribeStoragePersisted(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether the browser has granted this origin persistent storage, from
 * `navigator.storage.persisted()`. Never asks, so it is safe on load. False
 * when the API is missing or fails.
 */
export async function readStoragePersisted(): Promise<boolean> {
  // Only the newest read publishes: a mount read still pending when a save's
  // request re-reads must not overwrite the newer answer if it lands last.
  const read = ++latestRead
  let persisted: boolean
  try {
    persisted = (await navigator.storage?.persisted?.()) === true
  } catch {
    persisted = false
  }
  if (read === latestRead) publish(persisted)
  return persisted
}

/**
 * Ask the browser to keep this origin's storage, the first time this page
 * load calls it, then re-read the state. Call it after a save has been
 * written, never on load. Later calls only re-read.
 */
export async function requestStoragePersistence(): Promise<boolean> {
  if (!requested) {
    requested = true
    try {
      await navigator.storage?.persist?.()
    } catch {
      // A refusal is answered by the re-read below.
    }
  }
  return readStoragePersisted()
}
