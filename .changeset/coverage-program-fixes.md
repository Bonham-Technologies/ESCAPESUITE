---
"@escapesuite/craft": patch
"@escapesuite/artist": patch
---

Bugs found and fixed while bringing both apps under a coverage floor:

ESCAPECRAFT:

- A recording whose thumbnail could not be extracted in time leaked the blob URL it had opened.
- Converting a recording with an already-cancelled export hung instead of stopping straight away.
- Cancelling a conversion between its two passes left the video and audio encoders open.
- A compositor overlay with zero padding was given the default padding instead.
- The screen and webcam capture stayed live after a take ended, so the browser kept showing "sharing" and the camera light stayed on.
- The microphone stayed live after a take ended, for the same reason.
- Disposing a recorder stopped nothing, leaving its combined stream running.

ESCAPEARTIST:

- Starting a new project left the previous project's markers on the timeline.
- MP4 exports played a wipe-up transition as a wipe-down and vice versa; they now match the preview.
- Cancelling an export while it was muxing was ignored, and the export finished anyway.
- Ctrl+B never split the selected clip, and Ctrl+V changed the active tool instead of pasting.
- Dragging a left, right, top or bottom resize handle in the preview resized both axes at once instead of the one being dragged.
