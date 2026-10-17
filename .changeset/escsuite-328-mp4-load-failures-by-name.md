---
'@escapesuite/artist': patch
---

An MP4 export no longer quietly drops a clip it could not read

If a video in your project failed to load while an MP4 was being exported, the clip was left out of the file with only a console warning, and an image that never loaded could stall the export. The MP4 export now stops and names the file it could not read, whether the browser refused it or said nothing for 15 seconds, and images get the same 15-second limit; WebM and GIF exports still skip such a clip with a warning and finish the rest.
