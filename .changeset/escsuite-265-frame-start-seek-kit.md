---
'@escapesuite/headless-artist': patch
---

WebM and GIF renders no longer repeat one source frame in three in place of the frame that should be there

The kit renders through the same bundle as the editor, and its WebM and GIF outputs are drawn from a video element that was asked for each frame at the exact moment the frame starts; Chromium resolves that moment at microsecond precision and, on one frame start in three, showed the previous frame. Each frame is now asked for a tenth of a millisecond after its start. MP4 renders of an H.264 source, which the kit's Chromium decodes in the background worker, were already correct; an MP4 render of a WebM source, or of a source the worker refuses, goes through the same video element and is fixed with the rest.
