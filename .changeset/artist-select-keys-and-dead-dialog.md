---
'@escapesuite/artist': patch
---

Fixed the resolution picker, the export dialog's dropdowns and the keyframe panel's easing
select losing arrow-key presses to the playhead. With one of those dropdowns focused,
ArrowLeft/ArrowRight now change the selected option as expected instead of stepping the
transport backward or forward a frame.
