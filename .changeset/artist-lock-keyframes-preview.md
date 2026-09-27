---
"@escapesuite/artist": patch
---

The keyframe panel and the preview honour a locked track. The keyframe panel now says "Track locked — unlock it in the timeline to edit keyframes", refuses a keyframe drag, a double-click add, a right-click delete and the easing menu, and tells a keyboard user "Track is locked" instead of silently doing nothing — while still letting them read the curve, walk it and select a keyframe. On the preview canvas a clip on a locked track can still be clicked to select it, but it can no longer be dragged, resized or rotated, and the cursor shows `not-allowed` before the press rather than leaving the clip sitting still for no visible reason.
