// Which ESCAPEARTIST tabs are alive (ESCSUITE-274, after ESCSUITE-227).
//
// Every tab autosaves to a slot of its own (`session:<tabId>`, `core/storage.ts`)
// and holds the exclusive Web Lock `escapeartist-tab:<tabId>` for its lifetime.
// A lock dies with its page, so a slot whose tab lock is free belongs to a tab
// that closed or crashed — a session to offer back — and a slot whose lock is
// held is a live tab's work in progress, which a second tab must neither offer
// as its own nor throw away.
//
// `useSessionAutosave` holds this tab's lock (`holdTabLock`); `useSessionRestore`
// asks after its *own* id (`probeTabLock`) before anything else: a duplicated
// tab starts with a copy of its original's `sessionStorage`, id and all, and
// finds that id held. That probe has to be *requested* before this tab's own hold on the lock, or
// it would find this tab's queued request and answer "held" against itself —
// which the two hooks' effect order guarantees (the restore check is the
// editor's second effect and calls this synchronously; the hold is the
// autosave's, after it).
//
// A tab with no slot of its own probes a departed tab's lock (`probeTabLock`)
// and, finding it free, claims that tab's *offer* lock, `escapeartist-offer:<id>`
// (`claimOfferLock`, ESCSUITE-283), holding it while the offer stands: a second
// fresh tab opened with it finds the offer held and is offered the next slot or
// none, instead of both adopting the same session. The offer is a lock of its
// own, never the tab lock, so the tab lock still means only "this tab is alive":
// the departed tab coming back (a reload after a renderer crash, a tab the
// browser restores lazily) finds its own id free, keeps it, and is offered its
// own slot first — and the tab whose offer has gone stale asks again before it
// answers (`useSessionRestore`).
//
// All three take `locks` as an argument so the tests can hand in a double. Where
// the browser has no Web Locks at all (jsdom, a very old browser) every tab
// answers as if it were alone. A lock manager that *rejects* is treated the
// same way: the spec rejects with `SecurityError` on an opaque origin (a
// sandboxed frame, or `file://` in an engine that treats it as opaque — the
// offline build), and a tab there should still be offered and save its
// session rather than silently doing neither.

/** The lock a live tab holds for its lifetime. */
export function tabLockName(tabId: string): string {
  return `escapeartist-tab:${tabId}`;
}

/** The lock a tab holds while another tab's slot is on offer to it (ESCSUITE-283). */
export function offerLockName(tabId: string): string {
  return `escapeartist-offer:${tabId}`;
}

/** A release with nothing to let go of: no Web Locks, or nothing claimed. */
export const NO_HOLD = (): void => {};

/** Whether the tab with this id is alive right now. */
export type TabLockState = 'free' | 'held';

/**
 * Ask whether the tab with this id is alive, without taking its lock: an
 * `ifAvailable` request is handed `null` when the lock is held or queued for,
 * and is released the moment its callback returns when it is not.
 */
export function probeTabLock(
  tabId: string,
  locks: LockManager | undefined = navigator.locks
): Promise<TabLockState> {
  if (!locks) return Promise.resolve('free');
  return locks
    .request(tabLockName(tabId), { ifAvailable: true }, (lock): TabLockState =>
      lock ? 'free' : 'held'
    )
    .catch((error: unknown): TabLockState => {
      // Unusable locks: answer as a lone tab, the same as no `navigator.locks`.
      console.error('Failed to probe a tab lock:', error);
      return 'free';
    });
}

/**
 * Hold this tab's lock until the returned function runs (or the page goes
 * away). A request released before it is granted — StrictMode's
 * cleanup-then-remount, or the id changing under a duplicated tab — lets go
 * of the lock the moment it is handed it.
 */
export function holdTabLock(
  tabId: string,
  locks: LockManager | undefined = navigator.locks
): () => void {
  if (!locks) return NO_HOLD;

  // Assigned by the executor below, which runs synchronously.
  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  locks.request(tabLockName(tabId), () => hold).catch((error: unknown) => {
    // Unusable locks: nothing to hold. The tab still saves its own slot; a
    // later tab's probe of it answers "free" for the same reason.
    console.error("Failed to hold this tab's lock:", error);
  });

  return releaseHold;
}

/**
 * Claim the offer of a departed tab's slot while it is on offer (ESCSUITE-283):
 * an `ifAvailable` request for `escapeartist-offer:<tabId>`, kept until the
 * returned function runs (on an answer; a closed page releases it on its own).
 * Resolves to that function, or `null` when another tab already holds the
 * offer — the same slot is on offer to it — and nothing was taken. The tab
 * lock itself is never touched: whether the tab is gone is `probeTabLock`'s.
 */
export function claimOfferLock(
  tabId: string,
  locks: LockManager | undefined = navigator.locks
): Promise<(() => void) | null> {
  if (!locks) return Promise.resolve(NO_HOLD);

  // Assigned by the executor below, which runs synchronously.
  let releaseClaim!: () => void;
  const claim = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });

  return new Promise((answer) => {
    locks
      .request(offerLockName(tabId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          answer(null);
          return undefined;
        }
        answer(releaseClaim);
        return claim;
      })
      .catch((error: unknown) => {
        // Unusable locks: answer as a lone tab, the same as no `navigator.locks`.
        console.error('Failed to claim a session offer:', error);
        answer(NO_HOLD);
      });
  });
}
