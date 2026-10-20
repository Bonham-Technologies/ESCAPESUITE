<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Dialogs

**All five of the editor's modals** — `ExportDialog`, the shortcut sheet
(`components/KeyboardShortcuts/KeyboardShortcuts.tsx`), the project-load safety dialog
(`components/ProjectLoadDialog.tsx`), the session-restore prompt
(`app/SessionRestorePrompt.tsx`) and the resolution-change confirm
(`components/ResolutionPicker.tsx`) — get their keyboard behaviour from
**`useDialogBehaviour`** in `packages/shared/src/hooks`, imported as
`@escapesuite/shared/hooks`. ESCAPECRAFT's two modals use the same hook; it is the one
implementation for every dialog in the suite, and the place to change any of this.

Each carries the same five things: the hook's `ref` on the **panel** (not the backdrop),
`role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at its own heading's `id`,
and `tabIndex={-1}` on that same element — the last because the hook's Shift+Tab trap has an
arm for focus parked on the container, which is where a click on the dialog's own padding
lands. In return each gets initial focus inside itself, a Tab/Shift+Tab cycle that cannot
leave, Escape claimed in the capture phase, and focus restored to whatever opened it.

**Escape means something different in each, and that is a decision, not a default.** The hook
calls whatever it is handed, so the five answers are the five arguments:

| Modal | Escape calls | Why |
|-------|--------------|-----|
| `ExportDialog` | `handleCancel` | closes, aborting an export in flight exactly as the × and Cancel do (ESCSUITE-98: `handleExport`'s own promise chain checks a per-run identity — a fresh `AbortController` plus a `latestExportRef` that only ever advances to a *newer* run and is also cleared by `handleCancel` — before writing progress or error state, before its post-export download and `EXPORT_COMPLETE` host notification, and before clearing its own abort controller, so a run that has been cancelled or superseded can never clobber the export the user is actually looking at, nor resurrect its own download after the fact) |
| `KeyboardShortcuts` | `onClose` | the sheet holds no state and destroys nothing, so dismissing it is free |
| `ProjectLoadDialog` | `onCancel` | the other two answers both replace the current timeline; cancelling is the only one that leaves the editor as the user left it |
| `ResolutionPicker`'s confirm | `handleCancel` | confirming rewrites the project's resolution, which "may affect overlay positions and scaling" and cannot be undone automatically; cancelling costs nothing, and the select is controlled by the store's resolution so it snaps back to the preset still in force |
| `SessionRestorePrompt` | **nothing** — a module-level `swallowEscape()` no-op | `useSessionRestore`'s `handleDeclineSession` calls `clearSessionState()` on this tab's own slot or the legacy row, so "Start Fresh" **deletes** this tab's own or the legacy session, and leaves another tab's (ESCSUITE-306) — not offered here again until that tab saves newer work. Escape is the key people press to dismiss a thing; routing it to either button would either discard work or silently accept it. The hook still claims the key (so the editor's cascades behind the prompt never see it) and then does nothing: the prompt stays up, focus stays trapped, and the only two ways out are the two buttons — the right shape for a question that must be answered |

**The fifth modal is the odd one out in exactly one way: its open flag is not `App`'s own
state** (ESCSUITE-64, which adopted it — it used to have no role, no name, no trap, no Escape
and no place in `modalOpen`). `ResolutionPicker` owns `showConfirm`, and `App` has to know about
it to gate the editor's keys, so the picker reports it: an optional
`onConfirmOpenChange?: (open: boolean) => void`, handed down `App → MediaLibrarySidebar →
ResolutionPicker` (**two hops**, which is why it is a prop and not a field in the store's ui
slice — nothing else would ever read that field). `App` holds `resolutionConfirmOpen` and passes
`setResolutionConfirmOpen` itself, so the identity is stable. Inside the picker the report is
**derived from `showConfirm` in an effect**, not announced by the three handlers: it cannot then
drift from the state it describes, and the effect's cleanup means an unmount with the confirm up
— collapsing the sidebar — still reports it gone instead of leaving `modalOpen` stuck true and
the editor deaf. (Nothing can reach the collapse control from behind the overlay today; the
cleanup is there so that stays a fact about the CSS rather than a load-bearing assumption.) The
prop is optional on the picker, because the dialog is complete without a listener and the
picker's own tests render it bare; it is **required** on `MediaLibrarySidebar`, so `App` cannot
forget it.

There is no sixth: `ResolutionMismatchDialog`, the "ask on import" the project decided against
(media auto-fits instead), sat unimported for months and was deleted with its stylesheet and test.

Two shapes worth knowing, both about `isOpen`: `SessionRestorePrompt` is rendered only while
open (`App` holds the `{showSessionPrompt && pendingSession && …}` guard), so "closed" is
"unmounted" and it leaves the hook's second argument on its `true` default, like both CRAFT
modals. `ExportDialog`, `KeyboardShortcuts`, `ProjectLoadDialog` and `ResolutionPicker`'s
confirm are mounted for the life of their parent (the picker itself always is; the overlay is
the conditional part) and pass a flag — `isOpen`, or `showConfirm` — so the effect opens and
closes with it.

The shortcut sheet needed one thing beyond the wiring: its `.content` grid scrolls and holds
no controls, so it carries `tabIndex={0}` for a keyboard to scroll it at all (axe:
`scrollable-region-focusable`, which the new audit below caught). That also makes it the
sheet's second and last stop in the trap.

Two more things the audits turned up, both now fixed: the session-restore and project-load
dialogs' primary buttons were white on the `--accent-primary` fill at **2.75:1** and now use
`--accent-on-fill` like `ExportDialog` already did; and both dialogs titled themselves with an
`<h3>` under a page whose only `<h1>` is the logo, which skips a level (axe: `heading-order`).
Both are `<h2>` now, matching `ExportDialog` — the session prompt's `.sessionPrompt h3` selector
moved with it, and the project-load dialog's styling is on a `.title` class, so neither changed
how anything renders. The resolution confirm had **both** of the same two faults and took both
fixes with its adoption (`.confirmTitle` is a class too, so its `<h3>` → `<h2>` changed nothing
visual either).

**An open question, deliberately left alone**: `SessionRestorePrompt` swallows Escape, so it is a
dialog that demands an answer — which is what `role="alertdialog"` exists to tell assistive
technology. It keeps `role="dialog"`, so the dead Escape is an undeclared deviation from the APG
pattern. Changing it would move three test call sites and the audits' `include('[role="dialog"]')`
selector, and it is arguable either way (a restore *offer* is not an alert), so it was not taken
with the trap work.

The hook started life *here*, as an inline effect in `ExportDialog`, and was lifted into
CRAFT and then into `packages/shared`. The copy that stayed here had drifted in one way:
its Shift+Tab trap had arms for focus on the first control, focus null and focus outside
the dialog, but none for focus parked on the dialog **container** — which is where a click
on the dialog's own padding lands. Shift+Tab from there walked backwards out of an
`aria-modal` dialog. The shared hook treats the container as "at the start" and wraps to
the last control; `ExportDialog` carries `tabIndex={-1}` so the container is a focus target
at all.

ESCSUITE-208 fixed three more latent gaps in the shared hook, none reachable through any of
these five dialogs as shipped (no modal here holds a `position: fixed` control, a
`[contenteditable]`, an `<iframe>` or a native media player, and no two of these five can ever
be open at once — see `apps/craft/CLAUDE.md`'s "Dialogs" for why and for the full detail, since
the hook itself lives in `packages/shared` rather than in either app): the trap's "is this
control visible" check moved from `offsetParent !== null` to `getClientRects().length > 0`, so a
pinned control is no longer dropped from the trap the way a real browser's `offsetParent` would
drop it; the focusable-element selector gained arms for `[contenteditable]`, `audio[controls]`,
`video[controls]`, `iframe` and `summary`; and Escape now defers to a module-level stack of open
dialogs, so only the topmost instance's `onClose` runs if two were ever open together.

#### The modal gate on the global shortcuts

**While a modal is up, the editor behind it takes no key at all.** `App` computes one flag —
`const modalOpen = showExport || showShortcuts || showSessionPrompt || showProjectLoadDialog ||
resolutionConfirmOpen`
— and hands it to *both* of the app's `window` cascades: `useAppKeyboardShortcuts` and
`PlaybackControls` (which owns Space, the arrows, Home and End). Each returns from its handler immediately when it is true,
below the typing check and above every other branch — the same shape, and the same
comment, as ESCAPECRAFT's `useKeyboardShortcuts` (PR #381). The typing checks differ on purpose (ESCSUITE-247, "Keyboard
shortcuts" below): the transport still returns for every `input`, `textarea` and `select`, because a
native select changes its option on ArrowLeft/ArrowRight (and a slider moves) *and* lets the event bubble
to `window`, so the arrows would otherwise also step the playhead; the cascade returns only for text
entry. Pinned by a test in each suite. Before it, Space started playback,
Delete removed the selected clip and Ctrl+Z undid, all from behind a dialog the user could not
see past.

**Escape is the dialog's, never the global handler's** — and since all five modals use
`useDialogBehaviour`, that is now literally true of all five. The hook listens on `document` in
the **capture** phase and `stopPropagation()`s that one key, above every `window` bubble
listener, which is why Escape was the only key that already behaved correctly and why the gate
changes nothing about it.

The shortcut sheet keeps **one** key of its own on `window`: the second `?` (and Shift+`/`)
that toggles it shut, behind the same input/textarea typing guard the other two listeners open
with. The guard is still needed even though the sheet traps focus, because the listener is on
`window`, which every field in the document reaches. It needs no `stopPropagation`, because the
two cascades below it are already gated. That is what keeps the footer's "Press `?` to toggle
this panel" true. **Escape was bound there too until the sheet adopted the hook**; two
listeners for one key was one Escape path too many, and the `window` one was the one to go —
it could not `stopPropagation` anything useful and it sat below the hook's.

**Two cascade branches are consequently unreachable from `App`**: the hook's own `?` toggle and
the first arm of its Escape cascade (close the sheet). `showShortcuts` can only ever be `false`
by the time the gated handler runs, so `setShowShortcuts(!showShortcuts)` is permanently
`setShowShortcuts(true)`. They are **retained only for the hook's own unit tests and for the
branch-order contract** this file describes as the semantics of that file — nothing in the
running app reaches them. Folding the sheet's two keys back above the gate inside the one
cascade would remove the dead arms at the cost of the gate no longer sitting above every other
branch; if that trade is ever taken, this paragraph and the sheet's listener go together.

**`LoadingOverlay` is deliberately not in the flag, and is the one overlay with no trap.**
It carries `role="dialog" aria-modal="true"` for the screen reader, but it traps no focus,
holds nothing to interact with and is gone the moment the project finishes loading — there is
no dialog in front of the user to be confused by. `SessionRestorePrompt` and
`ProjectLoadDialog` (`useProjectActions`' `showProjectLoadDialog`) are both in the flag and
both trap focus: each is a question with buttons that waits for an answer.

**There is one `ProjectLoadDialog`, served from `useProjectActions`** (ESCSUITE-63). It used to
be rendered *twice*: `App`'s, plus a second instance inside `VideoUploader` with its own
`showProjectLoadDialog` / `pendingProjectFile` state and its own copies of the replace/merge
handlers, opened by dropping a `.veditor` on the uploader. That second flag was **not** in
`modalOpen`, so the editor behind the uploader's copy took every key — and Ctrl+O from there
opened `App`'s copy on top of it: two mounted dialogs, a duplicate `id="project-load-title"`
(the second dialog's `aria-labelledby` then silently resolving to the first heading), a duplicate
`data-testid="project-load-dialog"`, and two focus traps competing for Tab.

`useProjectActions` now exposes **`handleProjectFile(file)`** — the "given a project file: ask if
the timeline holds work, load it outright if not" half of `handleLoadProject`, which is all
`handleLoadProject` does after picking a file. It is threaded `App → MediaLibrarySidebar →
VideoUploader` as a **required** `onProjectFile`, so a caller that forgets it fails to compile
rather than silently swallowing a dropped project, and the uploader keeps no project state at
all: it recognises a `.veditor`, hands it up, and is done. Three behaviours the drop path used to
have differently went with the duplication, all of them the App path's and all of them better:
the load now shows the blocking `LoadingOverlay`, a success reports `Project loaded successfully`
through the notice channel rather than nothing at all, and a file that cannot be read reports
`Failed to load project` there too instead of a blocking `alert('Failed to load project file.')`
— the last `alert()` on any ARTIST *load* path (`confirm()` still guards Clear All and New Project;
the uploader's own refusal of a file that is not media at all stopped being an `alert()` in
ESCSUITE-249, below). Save-and-load
also announces its save, and a failed save, which the uploader's copy swallowed to the console.
The one thing that swap costs, for the record: `useNotification` is a single slot on a
three-second timer, so a failure the user happens not to be looking at is now missed, where an
`alert` demanded acknowledgement. It is the only one of the four that is arguably worse for the
user, and it is named in the changeset for that reason. `App.project.test.tsx`'s
`one project-load dialog` describe pins it — a dropped file that cannot be parsed reports through
the notice channel and calls no `alert`.

The flag and the trap are still worth having together — the flag stops the editor taking keys
from behind a dialog, the trap stops Tab walking out of one.

**The keyframe-graph gap is closed — by two fixes, because it had two routes in** (it was
recorded here as open: the F4 finding of the modal-gate review). Nothing gates the *keyframe
graph* on `modalOpen`: it is a focusable `role=listbox` with its own element-level handler, so a
user who reached it could still nudge, delete and add keyframes with the arrows, Delete and Enter
from behind a dialog.

1. **The Tab route** — `KeyboardShortcuts`, `SessionRestorePrompt` and `ProjectLoadDialog`
   trapped no focus, so Tab walked out of them and into the graph. All three now adopt
   `useDialogBehaviour`. **The fix was the trap, not another flag.**
2. **The pointer route** — and this is the half the trap cannot touch, and the half the original
   F4 note got wrong when it said "`ExportDialog` is immune because it really traps focus". A
   trap governs focus, not hit-testing. The keyframe panel is a `createPortal` sibling of `#root`
   and carried a bare `z-index: 1000`; every modal overlay is `--z-modal` (200). The panel
   therefore painted over the backdrop, the backdrop never received the click, and
   `document.elementFromPoint` at the graph returned the listbox — so a click focused the graph
   and Enter added a keyframe through an open `aria-modal` dialog, `ExportDialog` included. The
   palette gained **`--z-panel` (150)** — between `--z-dropdown` and `--z-modal` — and
   `KeyframePanel.module.css` uses it.

Neither half is provable in jsdom (there is no layout and no hit-testing), so both are held in
Chromium: `apps/e2e/tests/accessibility/core.spec.ts` has one axe audit per overlay for the role,
name and `aria-modal`, plus "an open modal covers the keyframe panel, so a pointer cannot reach
the graph behind it", which checks `elementFromPoint` at the graph's centre before and after the
sheet opens and then clicks there. **If `--z-panel` is ever raised above `--z-modal`, that test is
what fails.**
