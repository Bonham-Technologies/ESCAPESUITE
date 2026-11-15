// The editor's own `confirm()` (ESCSUITE-448).
//
// The browser's `confirm()` answers false without showing anything in an
// iframe sandboxed without `allow-modals`, so in such an embed every button
// that asked first silently did nothing. `confirmAction` asks the same
// question in `ConfirmDialog`, which `App` renders, and answers with a
// promise instead of a return value.
//
// The question lives here, in a module-level slot, rather than in a React
// context: `useProjectActions` asks it from inside `App` itself, above any
// provider `App` could render, and the dialog is one fact about the page (two
// can never be up at once). `App` reads the same slot for `modalOpen`.
import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  /** The question, word for word as the native prompt asked it. */
  message: string;
  /** The destructive button's label; the other button is always Cancel. */
  confirmLabel: string;
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
 * Ask `message` in the editor's confirm dialog. Resolves true when the user
 * presses `confirmLabel`, false on Cancel or Escape.
 *
 * A second question while one is still up replaces it, and the first one
 * resolves false: nothing destructive happens without its own answer.
 */
export function confirmAction(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    publish({ message, confirmLabel, resolve });
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
