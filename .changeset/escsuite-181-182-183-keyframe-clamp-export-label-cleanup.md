---
'@escapesuite/artist': patch
---

Keyframes stop at a neighbour instead of bouncing back, the Advanced export button says what it will actually download, and a dead field is gone

Three small fixes to ESCAPEARTIST. **Dragging a keyframe past another one on the same property no longer lets it follow the pointer there and snap back on release.** Both the diamond row drag and the graph's point drag now stop the point just short of (or just past) a neighbouring keyframe, the same way a clip trim already stops dead at its own neighbour, instead of letting the drop land on it and refusing it afterwards. **The Advanced "Download" button in the export dialog now names the file it will actually produce.** A saved preference for MP4 in a browser that cannot encode it used to show an enabled "Download MP4" button that silently wrote a WebM file; the button now reads "Download WebM" in that case, matching what the click really does. **Deleted a dead field.** `DragState.offsetX`, left over from an earlier fix to the timeline's clip drag, was written on every mousedown and read by nothing — it is gone, with no change in behaviour.
