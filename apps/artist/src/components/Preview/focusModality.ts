// Whether the control that holds focus was put there by the pointer (ESCSUITE-270).
//
// `:focus-visible` cannot answer this at keydown time: Chromium records "had a
// keyboard event" before it dispatches the keydown, so a button the mouse
// focused already matches `:focus-visible` by the time a Space handler runs.
// So the modality is recorded where it can still be seen — `pointerdown` arms
// a flag, `focusin` consumes it, and any `keydown` disarms it first, so a Tab
// or arrow that moves focus never inherits an earlier click.

let pendingPointer = false;
let focusedByPointer = false;

/** True when the element that currently holds focus received it from a pointer press. */
export function wasFocusedByPointer(): boolean {
  return focusedByPointer;
}

/** Installs the three capture-phase listeners; returns the uninstall. */
export function installFocusModalityTracker(target: Window | Document = window): () => void {
  const onPointerDown = () => {
    pendingPointer = true;
  };
  const onKeyDown = () => {
    pendingPointer = false;
  };
  const onFocusIn = () => {
    focusedByPointer = pendingPointer;
    pendingPointer = false;
  };
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('focusin', onFocusIn, true);
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('focusin', onFocusIn, true);
  };
}
