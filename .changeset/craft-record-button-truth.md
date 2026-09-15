---
'@escapesuite/craft': patch
---

The record button tells the truth, and a failure is no longer silent.

- **Record is disabled until it can actually record.** It used to be live from the first
  paint, while the browser was still being asked what it can capture — an early click did
  nothing at all, with no explanation. It now waits for that answer, and stays disabled
  with the reason on screen when nothing you have switched on can be captured in this
  browser. The R shortcut follows the same rule.
- **A recording that failed to save says so.** A failed save used to look exactly like a
  successful one: nothing in the library and nothing to explain it. Failures — a save that
  did not complete, a recordings list that could not be read, no storage space left for a
  new take — are now announced in the header.
- **You are told when system audio was not shared.** Switching on "System Audio" only asks
  for it; the browser's own share dialog has a separate tick box. If it was left clear, the
  app now says so and greys the System meter instead of leaving it sitting at zero.
- **A recording that may not scrub says so.** When the container repair fails the take is
  still saved, as before, but you are told it may not be seekable rather than discovering
  it later.
- **Downloads no longer get cancelled in some browsers**, and re-opening a recording no
  longer shows the previous one's duration.
