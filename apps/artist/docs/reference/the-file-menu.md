<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# The File menu (`src/app/FileMenu.tsx`, `src/app/menuNavigation.ts`)

The header's File dropdown is **not** a dialog and does not use `useDialogBehaviour` — it is the
APG *menu* pattern, which has no focus trap and one tab stop rather than a cycle. Its markup had
promised that pattern since it was written (`aria-haspopup="menu"` on the trigger, `role="menu"`
on the dropdown) over four plain `<button>`s with no `menuitem` role and no key handling at all,
which is an `aria-required-children` violation of critical impact that no audit had ever opened
the menu to see; ESCSUITE-202 surfaced it and left it, and ESCSUITE-216 implemented it. Each item
is a `role="menuitem"` button and the hairline rule is a `role="separator"` (both roles the `menu`
role owns, so the audit passes); opening the menu puts focus on the first item; a roving `tabIndex`
leaves exactly one tab stop; ArrowDown/ArrowUp move and wrap, Home and End jump to the ends, and
all four **step over a disabled item** — a `disabled` `<button>` is out of `.focus()`'s reach as
well as out of the tab order, which is why the arrows walk a list of focusable indexes rather than
all four rows. The arithmetic is the pure `nextMenuIndex(current, key, count)`, which answers
`null` for every key the menu does not claim, so **Enter and Space stay the browser's own
activation** for a `<button>` rather than being re-implemented. Escape closes the menu, hands focus
back to the trigger and is `stopPropagation`'d — the editor's Escape cascade is a `window` listener
(`app/useAppKeyboardShortcuts.ts`), and closing a menu must not also leave crop mode, clear the
in/out points or drop the selection behind it, the same bargain `useDialogBehaviour` strikes for
every modal — while Tab closes the menu *without* claiming the key, so focus moves on the way it
always would. The trigger's `aria-expanded` reflects the state and its `aria-controls` names the
dropdown while it is open (and only while it is open: axe excuses a dangling `aria-controls` only
under `aria-expanded="false"`). Held in jsdom by `app/FileMenu.test.tsx` and
`app/menuNavigation.test.ts`, and in Chromium by two cases in
`apps/e2e/tests/accessibility/keyboard-navigation.spec.ts` plus an axe audit of the open menu in
`core.spec.ts` — the one that is red against the old markup.
