---
'@escapesuite/craft': patch
---

The 3-2-1 countdown is announced to screen readers — "Recording starts in 3", 2, 1 — so the cancel window is no longer silent.

The countdown digit was drawn on screen only, so between pressing Record and the take starting a screen-reader user heard nothing, even though that is the window in which the take can still be cancelled. The header's status region now says "Recording starts in 3", "…in 2" and "…in 1" as the numbers change, and the on-screen digit is hidden from assistive technology so it is not read twice. When the take starts the region already says "Recording", so nothing more is added.
