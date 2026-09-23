---
"@escapesuite/artist": patch
---

Global keyboard shortcuts stop while a modal is open. With the export dialog, the shortcut
sheet, the "Resume Previous Session?" prompt or the project-load safety dialog in front of the
editor, Space no longer starts playback, Delete no longer removes the selected clip and Ctrl+Z
no longer undoes. Both of the app's window listeners — the shortcut cascade and the transport's
— now take a `modalOpen` gate, and the shortcut sheet binds its own Escape, `?` and Shift+`/`
so it still closes on a key.
