---
'@escapesuite/craft': patch
---

Fixed a recording's saved duration counting a final pause left open when Stop was pressed

Pausing a recording and then pressing Stop without resuming first — rather than resuming and then stopping — used to add the whole paused span onto the take's duration: a 10 second recording paused for 60 seconds and then stopped was saved, listed and analytics-reported as 70 seconds long, and any player reading that duration scaled its seek bar to match. This only affected takes recorded through the MediaRecorder path (composited picture-in-picture, audio-only takes, and any browser without WebCodecs) — the WebCodecs recording path already got this right. The recorder now finishes latching the open pause before handing off to the browser's stop, so the reported duration matches what was shown on screen the moment before Stop was pressed.
