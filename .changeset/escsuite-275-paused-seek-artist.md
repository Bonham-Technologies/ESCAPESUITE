---
'@escapesuite/artist': patch
---

A paused preview now shows the right frame when a video appears under the playhead or two videos move at once.

When the editor is paused and a video's element is created with the playhead part-way into its clip — a source brought back by undo, a project or session opened with the playhead away from the start, a frame step pressed before the video had loaded — the preview now seeks that video to the playhead instead of showing the clip's first frame until you move it. And when a step or scrub moves two videos at once (picture-in-picture, or both sides of a transition), the preview repaints after the last of them has landed rather than the first, so neither is left showing its old frame.
