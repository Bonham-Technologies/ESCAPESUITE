---
"@escapesuite/artist": patch
---

Undo stays one step per gesture even when a write inside the gesture is refused. Every edit the store refuses now says so, so the inspector's sliders, the preview's handles, a trim and a clip drag never treat a refused write as the one that opened their undo entry, and a keyframe nudge on a locked track no longer announces a move that did not happen.
