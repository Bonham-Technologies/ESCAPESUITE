---
'@escapesuite/craft': patch
---

Dialogs behave like dialogs, for the keyboard and for a screen reader.

- **Escape closes them.** The Recording Tips dialog had no way out but the mouse; it now
  closes on Escape, as the playback dialog already did.
- **Focus goes in, stays in, and comes back.** Opening either dialog moves focus into it,
  Tab and Shift+Tab cycle within it instead of wandering onto the app behind, and closing it
  puts focus back on the button that opened it.
- **The recorder's shortcuts no longer fire from inside a dialog.** Pressing R while the
  Recording Tips dialog was open started a screen recording behind it, complete with the
  browser's capture prompt; P, S and Escape reached the recorder the same way. Nothing
  behind a dialog takes keys now. Inside the playback dialog, the player keeps its own keys
  — Space, M, F and the arrows still work.
- **The Recording Tips can be scrolled from the keyboard.** The tips scroll and hold no
  controls of their own, so there was nothing to Tab to and no way to reach the text below
  the fold without a mouse.
- **The live recording label, the timer and the notice line are readable.** Their red was
  4.2:1 against the app's background, under the WCAG AA minimum; it has been lifted to
  5.7:1. The record button and the recording dot keep the original brand red.
