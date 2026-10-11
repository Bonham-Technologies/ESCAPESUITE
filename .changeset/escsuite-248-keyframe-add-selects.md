---
'@escapesuite/artist': patch
---

Adding a keyframe where one already is selects it instead of overwriting its easing and spending an undo step, and an audio clip's keyframe panel lists only Volume.

Pressing Enter in the keyframe graph, or double-clicking the graph or a property row, at a time that already held a keyframe used to rewrite that keyframe with the default "Ease In-Out" easing — losing a "Linear" or any other easing you had chosen — and put a do-nothing step on the undo history, while announcing that a keyframe had been added. It now selects the keyframe that is already there (opening that property's graph when the double-click was on its row), leaves it exactly as it was, adds nothing to the undo history, and screen readers hear "Keyframe at 1.20 s selected". An audio-only clip no longer offers Position, Scale, Rotation, Opacity or Blur, which did nothing to a sound; its panel lists Volume alone, and a graph left open on a picture property closes when you select an audio clip.
