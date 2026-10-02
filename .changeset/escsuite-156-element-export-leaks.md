---
'@escapesuite/artist': patch
---

A failed WebM or GIF export releases the media it had loaded, a corrupt image no longer aborts an export, and a video that never becomes ready no longer leaves a frame poll running

A WebM or GIF export that fails while setting up its encoder now releases the media it had
loaded instead of leaking it; a corrupt image in the project no longer aborts the export; and a
video that never becomes ready no longer leaves a frame poll running.

Nothing about a successful export changes. These are three things that only showed up when
something went wrong: an export that fell over between loading your media and encoding the first
frame left every video and image it had opened behind, and your browser only got that memory
back when you reloaded the page — so a few failed exports in a row could leave a long editing
session noticeably heavier. One image file the browser cannot decode used to stop a whole export
rather than being skipped the way an unreadable video already was. And a clip whose picture
never arrives left a check running on every animation frame, for as long as the tab stayed open.
