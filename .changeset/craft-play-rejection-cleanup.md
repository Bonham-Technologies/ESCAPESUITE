---
'@escapesuite/craft': patch
---

A conversion whose video cannot start playing now tears itself down like every other failure: a refused `play()` goes out through the converter's one failure exit, cancelling the frame callback it had just registered, pausing both the screen and (on a composite) the camera element, reporting the camera part that never drew a frame, and dropping the abort listener — then rejecting with the play error itself, as it always did.
