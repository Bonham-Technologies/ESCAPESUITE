// What both of ESCAPECRAFT's modals owe a keyboard user: focus moves in when
// they open, Tab cycles inside them, Escape closes them, and focus goes back to
// whatever opened them when they close.
//
// The implementation is ESCAPEARTIST's, lifted rather than invented: the same
// focusable-element selector, the same document-level capture listener and the
// same restore-on-unmount as `apps/artist/src/components/Export/ExportDialog.tsx`
// has carried since its own accessibility pass. It lives in a hook here because
// CRAFT has two dialogs rather than one. (Consolidating ARTIST's copy onto this
// hook means moving it into `packages/shared`, which is a change to two more
// packages and is deliberately not part of this one.)
//
// Escape and a wrapping Tab are both handled in the **capture** phase on
// `document`, which is above every `window`-bubble listener in the app —
// `useKeyboardShortcuts` and `VideoPlayer` both bind one. Escape is the only key
// `stopPropagation()`d, which is what keeps the recorder's shortcuts from acting
// on a key the dialog has already claimed; a wrapping Tab is `preventDefault()`d
// only, since nothing else listens for Tab and swallowing it would be a promise
// this hook does not need to make. Every other key reaches the window untouched,
// which is how the playback dialog's VideoPlayer keeps Space, M and the arrows.
//
// The dialog element itself is expected to carry `tabIndex={-1}` — that is where
// focus lands when the dialog holds nothing focusable at all.
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Everything the browser will let a user Tab to, minus anything explicitly
 * taken out of the tab order. Copied from ExportDialog so the two dialogs agree
 * on what "focusable" means.
 */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal keyboard behaviour for a dialog that is mounted only while it is open.
 *
 * Returns the ref to put on the dialog element. Both CRAFT dialogs render only
 * when open, so "mounted" *is* "open" and the effect has no `isOpen` argument:
 * it runs once on mount and undoes itself on unmount.
 *
 * `onClose` is read through a ref because both call sites pass a fresh arrow
 * every render; depending on it directly would re-run the effect — and so
 * re-take focus — on every keystroke the app re-renders for.
 */
export function useDialogBehaviour(onClose: () => void): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // Its own effect rather than an assignment in the render body, which
  // `react-hooks/refs` refuses. Declared first, so it has already run by the
  // time the effect below binds anything.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Re-read on every Tab rather than once: the playback dialog's controls come
    // and go with the player's own state.
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
        // The dialog owns Escape while it is open; the recorder's shortcuts
        // must not also fire.
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
      // what clicking the playback dialog's <video> does, neither the video nor
      // its wrapper being focusable. Without that arm, Shift+Tab from there
      // walks backwards out of an `aria-modal` dialog.
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
      // ARTIST's copy writes `?.focus?.()`. The second guard is dropped here on
      // purpose: the value is typed `HTMLElement | null`, and every HTMLElement
      // has `focus`, so that arm guards against nothing TypeScript admits — and
      // it would be a branch no test could ever cover, under a package whose
      // branch floor leaves about four to spare. The `?.` that can fire (a null
      // activeElement) is covered by a test.
      previouslyFocused?.focus();
    };
  }, []);

  return dialogRef;
}
