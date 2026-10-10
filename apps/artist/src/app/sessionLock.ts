// Which ESCAPEARTIST tab owns the session slot (ESCSUITE-227).
//
// Every tab of one origin shares one autosave slot — `settings` /
// `current-session` in `video-editor-db` — so two tabs used to take turns
// overwriting it, and a second tab was offered the first one's *live* work as
// a session to resume (and, on Start Fresh, threw it away). One tab at a time
// now owns the slot, decided by an exclusive Web Lock that dies with its page:
// a closed or crashed tab hands the slot to the next one queued for it.
//
// `useSessionRestore` asks `probeSessionOwner()` before offering a session;
// `useSessionAutosave` asks `acquireSessionOwnership()` for the slot and
// writes nothing until it is granted. The probe has to be *requested* before
// the same tab's own acquisition, or it would find this tab's queued request
// and answer "held" against itself — which the two hooks' effect order
// guarantees (the restore check is the editor's second effect and calls this
// synchronously; the ownership request is the autosave's, after it).
//
// Both take `locks` as an argument so the tests can hand in a double. Where
// the browser has no Web Locks at all (jsdom, a very old browser) both answer
// as if the tab were alone — which is exactly how the editor behaved before.
// A lock manager that *rejects* is treated the same way: the spec rejects with
// `SecurityError` on an opaque origin (a sandboxed frame, or `file://` in an
// engine that treats it as opaque — the offline build), and a tab there should
// still be offered and save its session rather than silently doing neither.

/** The one lock name every ESCAPEARTIST tab of an origin queues on. */
export const SESSION_LOCK_NAME = 'escapeartist-session';

/** Whether another live tab owns the session slot right now. */
export type SessionOwner = 'free' | 'held';

/**
 * Ask whether another tab owns the session, without taking it: an
 * `ifAvailable` request is handed `null` when the lock is held or queued for,
 * and is released the moment its callback returns when it is not.
 */
export function probeSessionOwner(
  locks: LockManager | undefined = navigator.locks
): Promise<SessionOwner> {
  if (!locks) return Promise.resolve('free');
  return locks
    .request(SESSION_LOCK_NAME, { ifAvailable: true }, (lock): SessionOwner =>
      lock ? 'free' : 'held'
    )
    .catch((error: unknown): SessionOwner => {
      // Unusable locks: answer as a lone tab, the same as no `navigator.locks`.
      console.error('Failed to probe the session lock:', error);
      return 'free';
    });
}

/**
 * Queue for the session slot, and call `onAcquired` once this tab owns it.
 *
 * The lock is held until the returned function runs (or the page goes away).
 * A request released before it was granted — StrictMode's cleanup-then-remount,
 * or a tab unmounting while another still owns the slot — never calls
 * `onAcquired`, and lets go of the lock the moment it is handed it.
 */
export function acquireSessionOwnership(
  onAcquired: () => void,
  locks: LockManager | undefined = navigator.locks
): () => void {
  if (!locks) {
    onAcquired();
    return () => {};
  }

  let released = false;
  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  locks
    .request(SESSION_LOCK_NAME, () => {
      if (released) return undefined;
      onAcquired();
      return hold;
    })
    .catch((error: unknown) => {
      // Unusable locks: own the slot as a lone tab would, the same as no
      // `navigator.locks` — unless the request was already released.
      console.error('Failed to acquire the session lock:', error);
      if (!released) onAcquired();
    });

  return () => {
    released = true;
    releaseHold();
  };
}
