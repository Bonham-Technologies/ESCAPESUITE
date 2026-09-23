---
'@escapesuite/craft': patch
---

ESCAPECRAFT: the M4A button tells the truth after a reload, and the clock stops redrawing the app

Two small fixes with nothing else in common.

**A recording now remembers whether it had sound.** Whether a take captured
audio was only ever held in memory, so after a reload every recording in the
library claimed it had some — which put an enabled M4A button on screen-only
takes, where the conversion could only fail and say so. The answer is now
written into the recording's stored metadata when the take is saved, from the
same expression the library entry uses, and read back on load. Recordings saved
before this change keep the benefit of the doubt: their M4A button stays on
offer, and the converter still refuses the ones with nothing to convert.

**The elapsed timer and the countdown no longer re-render the whole screen.**
The duration ticks once a second for the whole length of a take, and the
countdown three times before one; each tick used to redraw the header, the
sources panel, the library, the preview stage and the transport bar, for a value
that moves five characters or one digit. The two numbers now subscribe to the
store where they are drawn, so a tick costs exactly that and nothing else —
which matters most on the low-spec machines this tool is meant to run on. No
visible change.
