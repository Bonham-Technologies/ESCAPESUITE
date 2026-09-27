---
'@escapesuite/artist': patch
---

Cancelling an export and starting another right away no longer leaves the new export uncancellable

Cancel, ×, and Escape all stop working on a second export started right after cancelling a
first one: the cancelled export's promise usually rejects a little later, at its next internal
wait, and that late rejection's cleanup was unconditionally clearing the shared abort-controller
reference — discarding the new export's controller along with it. From then on Cancel closed the
dialog without actually aborting anything, and the export the user thought they'd stopped kept
encoding to completion, still triggering the browser download and notifying an embedding host.
The dialog now only clears (or resets progress/error state for) a run's own controller, so a
stale export can no longer touch the one the user is actually looking at.
