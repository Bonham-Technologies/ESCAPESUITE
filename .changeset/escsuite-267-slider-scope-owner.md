---
'@escapesuite/artist': patch
---

Dragging one inspector slider while another still has focus is one undo step again instead of one per move.

Pressing a slider in the clip inspector while a different slider still held keyboard focus made the first slider's loss of focus end the drag that had just started, so every value the new drag passed through became its own undo step — enough, on a long drag, to push everything you had done before it off the undo history. Each drag now belongs to the slider you pressed: another slider losing focus, or releasing a key, no longer ends it, so the drag is one undo step however focus was sitting when it began.
