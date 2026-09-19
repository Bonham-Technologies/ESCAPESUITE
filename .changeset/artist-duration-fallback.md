---
"@escapesuite/artist": patch
---

WebM files with no duration header — raw MediaRecorder output, or an ESCAPECRAFT take whose metadata fix failed — used to hang forever on import, stuck on "Processing…": the editor believed the `Infinity` the browser reported and then asked for a thumbnail at `Infinity × 0.1`, a seek a browser refuses. They now import with their real length, recovered by seeking to the end of the file, and say so plainly if it cannot be found. The same recovery covers recordings opened from ESCAPECRAFT by link.
