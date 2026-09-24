---
'@escapesuite/artist': patch
---

Two dialog fixes in the editor.

**The resolution-change confirm is a real modal (ESCSUITE-64).** `ResolutionPicker`'s
"Change Resolution" overlay had no `role`, no accessible name, no focus trap, no Escape and
no place in `App`'s `modalOpen` — Tab walked out behind it and Delete, Space and Ctrl+Z all
still reached the editor. It now uses the same shared `useDialogBehaviour` the editor's other
four modals use, titles itself with an `<h2>`, takes the `--accent-on-fill` contrast fix its
primary button needed, cancels on Escape, and reports its open state up to `App` so the editor
behind it takes no key while it is up.

**One project-load dialog (ESCSUITE-63).** Dropping a `.veditor` on the media library opened a
second, duplicate "Load Project" dialog that `modalOpen` knew nothing about, so Ctrl+O stacked
`App`'s copy on top of it — two dialogs, two focus traps, duplicate ids. The uploader now hands
the file to `useProjectActions`, which owns the one dialog: the drop path gains the loading
overlay and the "Project loaded successfully" / "Failed to load project" notices the File-menu
path always had, its save-and-load answer now reports the save — and a failed save — instead of
swallowing it to the console, and it loses the blocking `alert()` it used to report an unreadable
file with. That last one is the only change of the four that costs a user anything: the notice is
one slot on a three-second timer, where an `alert` demanded acknowledgement.
