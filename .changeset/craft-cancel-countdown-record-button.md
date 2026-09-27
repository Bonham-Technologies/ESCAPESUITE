---
'@escapesuite/craft': patch
---

During the 3-2-1 countdown, the record button now cancels the countdown instead of pretending to stop a take that hasn't started

The big record button used to read "Stop recording" for the whole countdown, but a recorder can't be stopped before it starts, so clicking it did nothing at all — the countdown kept ticking and the take began anyway. During the countdown the button now reads "Cancel countdown" and cancels it, exactly like pressing Escape or clicking the bar's own Cancel button already did, so all three now agree.
