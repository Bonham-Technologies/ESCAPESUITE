---
"@escapesuite/craft": patch
---

The "Record webcam as a separate track" setting is now fixed at the moment a take starts.

Flipping it while a recording is running no longer changes how that take is saved: the
recording is stored as the mode it was started in — camera placement and all — even when the
browser loses the extra files on the way out, where before such a take was filed as though it
had been recorded as one composited file.

Internal tidy behind it: the toggle no longer borrows the capture sources' CSS class (same
appearance, one fewer way for a test to address the wrong button), and a test that removed a
browser API now puts it back the way it found it.
