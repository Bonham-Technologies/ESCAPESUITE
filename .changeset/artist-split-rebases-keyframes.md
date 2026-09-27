---
'@escapesuite/artist': patch
---

Splitting a clip now rebases its keyframes and animation presets instead of copying the whole animation onto both halves

Split (the razor tool, Ctrl+B, or the inspector's Split) used to hand both halves the parent clip's whole `animation` object: a fade-in near the start of the original clip replayed from the second half's own start too, and a fade-out was regenerated against each half's own (shorter) duration, so one fade became two. Each property's custom keyframes are now clipped and shifted at the cut, with a synthesised keyframe at the new boundary holding the interpolated value so neither half's picture jumps; the in-preset stays with the first half and the out-preset with the second, with the half that loses a preset cleared to "none" rather than carrying a dangling one. `animation` and `transform` are also deep-copied for each half, so the two clips no longer share references and editing one can no longer silently change the other.
