// What every ESCAPE Suite modal owes a keyboard user: focus moves in when it
// opens, Tab cycles inside it, Escape closes it, and focus goes back to
// whatever opened it when it closes.
//
// One implementation, seven dialogs: ESCAPECRAFT's Recording Tips and playback
// modals, and all five of ESCAPEARTIST's — the export dialog, the shortcut
// sheet, the project-load safety dialog, the session-restore prompt and
// `ResolutionPicker`'s change-resolution confirm. It started as the export
// dialog's inline effect, was lifted into a CRAFT hook when CRAFT grew a second
// modal, and lives here now so ARTIST could drop its copy — which had drifted,
// missing the container-focus arm of the Shift+Tab trap — and so ARTIST's other
// four could adopt it rather than grow their own.
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
//
// ESCSUITE-208 fixed three latent gaps a real browser exposes that jsdom's own
// test doubles had been hiding:
//
// - `getFocusable()` used to filter on `el.offsetParent !== null`, which a
//   real browser sets to `null` for *any* `position: fixed` element — so a
//   pinned control inside a dialog was dropped from the trap entirely, not
//   merely skipped as hidden. `getClientRects().length > 0` means "this
//   element is actually rendered" without caring about its positioning
//   scheme, which is what the trap is really asking. No `offsetParent`
//   fallback: every engine this project supports (Chromium, Firefox, WebKit)
//   implements `getClientRects`, so a fallback path would be dead code.
// - `FOCUSABLE_SELECTOR` only named the control types the seven existing
//   dialogs happen to use. A `[contenteditable]`, an `<iframe>`, a `<summary>`
//   or a native `<audio controls>`/`<video controls>` player is tabbable too,
//   and the old selector's silence about them meant Tab from one walked
//   straight out of an `aria-modal` dialog rather than wrapping.
// - Escape used `stopPropagation()`, which does nothing for two listeners
//   bound to the *same* node — every open dialog's capture listener lives on
//   `document`, so a second dialog's Escape also ran the first dialog's
//   `onClose`. `stopImmediatePropagation()` would not have fixed this
//   correctly: capture-phase listeners on one node fire in the order they
//   were *added*, so the earliest-opened (bottommost) dialog's listener runs
//   first — unconditionally stopping immediate propagation there would close
//   the dialog underneath instead of the one on top, and the topmost dialog's
//   own listener would never even run. A tiny module-level stack of open
//   dialogs fixes this correctly: every instance's listener still runs (so
//   each still claims the key via `preventDefault`/`stopPropagation`, keeping
//   it from the app's shortcuts), but only the topmost instance's `onClose`
//   actually fires. No dialog in either app can reach a two-dialog-open state
//   today — every overlay is `position: fixed; inset: 0` and every keyboard
//   trigger is gated behind the same "a modal is open" flag — so this is
//   hardening against a state nothing can drive yet, not a fix for something
//   a user has hit.
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Everything the browser will let a user Tab to, minus anything explicitly
 * taken out of the tab order.
 *
 * The five element-type arms (`[contenteditable]`, `audio[controls]`,
 * `video[controls]`, `iframe`, `summary`) deliberately ignore
 * `tabindex="-1"` — `button:not(:disabled)` always has, too. A `-1` keeps an
 * element out of the page's own Tab order but not out of `.focus()`'s reach,
 * and this selector only needs the latter: the trap calls `.focus()`
 * directly, it never simulates a browser's Tab key.
 */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe, summary';

/**
 * Every dialog instance currently open, oldest first. The last entry is the
 * topmost one — the one Escape should close. A module-level array rather than
 * context or a store: this hook has no provider to hang state on, and "which
 * dialogs are open right now" is a fact about the page, not about any one
 * component's render.
 */
const openDialogs: symbol[] = [];

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

    // This instance's place in the open-dialog stack. Declared here so
    // `handleKeyDown`'s closure below can capture it, but not pushed until
    // right before the listener that reads it is bound — see there for why.
    const id = Symbol('dialog');

    // Re-read on every Tab rather than once: the playback dialog's controls come
    // and go with the player's own state, and the export dialog swaps its whole
    // body for a progress bar mid-export.
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0
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
        // also fire. Every open dialog's listener still claims the key this
        // way, but only the topmost one actually closes — see the module doc
        // comment for why `stopImmediatePropagation()` alone would pick the
        // wrong dialog.
        e.preventDefault();
        e.stopPropagation();
        if (openDialogs[openDialogs.length - 1] !== id) return;
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

    // Pushed immediately before the listener that reads it is bound, rather
    // than up where `id` is declared, so as little as possible sits between
    // the push and the `return` below that registers its pop. If something
    // earlier in this effect threw, the effect body would never reach its
    // `return`, React would never see a cleanup function to run, and the
    // pushed id would stay on the stack forever — disabling Escape for every
    // dialog opened after it, for the rest of the page's life. Nothing
    // between here and the `return` can throw today (`addEventListener`
    // does not), so this is hardening against a risk the code does not
    // currently carry, not a fix for one it does.
    openDialogs.push(id);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // No `=== -1` guard: this closure's `id` was pushed exactly once, right
      // above, by this same effect run, and this cleanup is the only thing
      // that ever removes it — the push and the pop are 1:1 by construction,
      // so `indexOf` finding nothing is not a state this code can reach.
      openDialogs.splice(openDialogs.indexOf(id), 1);
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
