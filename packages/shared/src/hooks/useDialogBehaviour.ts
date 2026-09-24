// What every ESCAPE Suite modal owes a keyboard user: focus moves in when it
// opens, Tab cycles inside it, Escape closes it, and focus goes back to
// whatever opened it when it closes.
//
// One implementation, six dialogs: ESCAPECRAFT's Recording Tips and playback
// modals, and all four of ESCAPEARTIST's — the export dialog, the shortcut
// sheet, the project-load safety dialog and the session-restore prompt. It
// started as the export dialog's inline effect, was lifted into a CRAFT hook
// when CRAFT grew a second modal, and lives here now so ARTIST could drop its
// copy — which had drifted, missing the container-focus arm of the Shift+Tab
// trap — and so ARTIST's other three could adopt it rather than grow their own.
//
// Escape and a wrapping Tab are both handled in the **capture** phase on
// `document`, which is above every `window`-bubble listener in either app —
// CRAFT's `useKeyboardShortcuts` and `VideoPlayer`, ARTIST's
// `useAppKeyboardShortcuts`, all bind one there. Escape is the only key
// `stopPropagation()`d, which is what keeps an app's shortcuts from acting on a
// key the dialog has already claimed; a wrapping Tab is `preventDefault()`d
// only, since nothing else listens for Tab and swallowing it would be a promise
// this hook does not need to make. Every other key reaches the window
// untouched, which is how the playback dialog's VideoPlayer keeps Space, M and
// the arrows.
//
// The dialog element itself is expected to carry `tabIndex={-1}`. That is where
// focus lands when the dialog holds nothing focusable at all, and it is also
// what makes the container a focus target a click can land on — which the
// Shift+Tab trap has an arm for.
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Everything the browser will let a user Tab to, minus anything explicitly
 * taken out of the tab order.
 */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal keyboard behaviour for a dialog.
 *
 * Returns the ref to put on the dialog element.
 *
 * `isOpen` defaults to `true`, which is the right answer for a dialog rendered
 * only while it is open — both CRAFT dialogs, where "mounted" *is* "open" and
 * the effect runs once on mount and undoes itself on unmount. ARTIST's export
 * dialog is mounted the whole time and returns `null` when closed, so it passes
 * its own flag and the effect opens and closes with it.
 *
 * `onClose` is read through a ref because every call site passes a fresh arrow
 * every render; depending on it directly would re-run the effect — and so
 * re-take focus — on every keystroke the app re-renders for.
 */
export function useDialogBehaviour(
  onClose: () => void,
  isOpen = true
): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // Its own effect rather than an assignment in the render body, which
  // `react-hooks/refs` refuses. Declared first, so it has already run by the
  // time the effect below binds anything.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Re-read on every Tab rather than once: the playback dialog's controls come
    // and go with the player's own state, and the export dialog swaps its whole
    // body for a progress bar mid-export.
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );

    const firstOnOpen = getFocusable()[0];
    if (firstOnOpen) {
      firstOnOpen.focus();
    } else {
      dialog.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The dialog owns Escape while it is open; the app's shortcuts must not
        // also fire.
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing to move to, and Tab must not escape the dialog.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // `contains(null)` is false, so focus parked outside the dialog — on the
      // body, or on something behind it — is pulled back in by the same test.
      //
      // The container itself counts as "at the start": it is `tabIndex={-1}`,
      // so it is not in the tab order, but a click can land on it — which is
      // what clicking the playback dialog's <video>, or the export dialog's own
      // padding, does. Without that arm, Shift+Tab from there walks backwards
      // out of an `aria-modal` dialog.
      if (e.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // ARTIST's old copy wrote `?.focus?.()`. The second guard is dropped here
      // on purpose: the value is typed `HTMLElement | null`, and every
      // HTMLElement has `focus`, so that arm guards against nothing TypeScript
      // admits — and it would be a branch no test could ever cover, under a
      // package whose branch floor leaves about four to spare. The `?.` that
      // can fire (a null activeElement) is covered by a test.
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
