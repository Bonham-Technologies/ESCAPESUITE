---
'@escapesuite/artist': patch
---

Keyframes stop at a neighbour instead of bouncing back, and the Advanced export button says what it will actually download

**Dragging a keyframe into another one on the same property no longer lets it follow the pointer there and snap back on release.** Both the diamond row drag and the graph's point drag now stop the keyframe at the edge of the neighbour's space, on the side you dragged in from — aim at a neighbour from the left and the keyframe stops just short of it, from the right and it stops just past it — the same way a clip trim already stops dead at its own neighbour. A neighbour sitting right at the clip's end (every clip with a fade-out has one) pushes the keyframe just inside the clip rather than onto it. **The Advanced "Download" button in the export dialog now names the file it will actually produce.** A saved preference for MP4 in a browser that cannot encode it used to show an enabled "Download MP4" button that silently wrote a WebM file; the button now reads "Download WebM" in that case, matching what the click really does.
