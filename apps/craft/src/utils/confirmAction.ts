// CRAFT's own `confirm()` (ESCSUITE-483).
//
// Deleting a take used to happen on one click. It now asks first, and it asks
// in `ConfirmDialog`, which `App` renders, rather than through the browser's
// `confirm()`: in an iframe sandboxed without `allow-modals` that answers
// false without showing anything, so in such an embed Delete would silently
// do nothing (the same reason ESCAPEARTIST's `confirmAction` exists,
// ESCSUITE-448 — this is the same shape, kept in CRAFT because the two apps
// share no state).
//
// The question lives in a module-level slot rather than in React state: the
// library panel asks it, `App` draws the dialog and reads the same slot for
// the shortcuts' `modalOpen`, and one question at a time is a fact about the
// page.
import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  /** The dialog's title — the question, naming what it is about. */
  title: string;
  /** What happens if the user says yes, in a sentence or two. */
  message: string;
  /** The destructive button's label; the other button is always Cancel. */
  confirmLabel: string;
  /**
   * Where focus goes when the dialog closes. The control that asked is the
   * right answer, but WebKit does not focus a button on click, so
   * `useDialogBehaviour`'s own restore (to whatever was focused when the
   * dialog opened) would put focus on the page body there.
   */
  returnFocus?: HTMLElement | null;
}

interface PendingRequest extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

let current: PendingRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: PendingRequest | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

/**
 * Ask in CRAFT's confirm dialog. Resolves true when the user presses the
 * confirm button, false on Cancel, Escape or a click on the backdrop.
 *
 * A second question while one is still up replaces it, and the first one
 * resolves false: nothing destructive happens without its own answer.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    publish({ ...request, resolve });
  });
}

/** Answer the question that is up, if any. */
export function answerConfirm(confirmed: boolean): void {
  const request = current;
  if (!request) return;
  publish(null);
  request.resolve(confirmed);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ConfirmRequest | null {
  return current;
}

/** The question that is up, or null. */
export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(subscribe, snapshot);
}
