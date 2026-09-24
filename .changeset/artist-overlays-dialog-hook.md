---
'@escapesuite/artist': patch
---

The editor's three untrapped overlays adopt the shared dialog hook.

The shortcut sheet, the project-load safety dialog and the "Resume Previous Session?"
prompt looked modal but trapped no focus: Tab walked straight out of each of them into
the editor behind, and only the sheet answered Escape at all. All three now use
`useDialogBehaviour` from `@escapesuite/shared/hooks`, the same way `ExportDialog` does —
`role="dialog"`, `aria-modal`, `aria-labelledby` its own heading, initial focus inside,
a Tab/Shift+Tab cycle that cannot leave, and focus restored to the opener on close.

Escape's meaning is decided per overlay, not inherited: the sheet closes (as it always
did, now through the hook rather than a second `window` listener, so there is one Escape
path); the project-load dialog cancels, the only one of its three answers that leaves the
timeline alone; and the session prompt **swallows** Escape — declining calls
`clearSessionState()`, so a dismissal key must not reach it. The prompt stays up with
focus trapped, and the two buttons remain the only ways out.

Two things fall out of the traps. The keyframe graph could previously be nudged, extended
and deleted from behind these three overlays, because it is focusable and its handler is
element-level rather than gated on the editor's modal flag; with the traps in place it
cannot hold focus behind them at all. And the sheet's scrolling body was unreachable by
keyboard — it now carries `tabIndex={0}`, so a keyboard user can scroll it.
