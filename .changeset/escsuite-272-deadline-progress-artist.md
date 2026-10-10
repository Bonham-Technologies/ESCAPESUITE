---
'@escapesuite/artist': patch
---

A long MP4 export no longer gives up on the background decoder while it is still working.

When one frame took the decoder more than 15 seconds to reach — a long stretch between keyframes on a slow machine, or a transition that keeps sending one decoder back and forth — ESCAPEARTIST used to decide the decoder had died, and finished the rest of the export in the page, slower and only while the tab stayed in the foreground. The decoder now reports each frame it decodes on the way, and the 15-second limit counts from the last sign of life rather than from when the frame was asked for, so only a decoder that has really stopped answering is replaced.
