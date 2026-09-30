---
'@escapesuite/craft': patch
---

A take recorded with Screen and Webcam both off (Microphone alone) is now stored as an audio recording — no invented 1920x1080 frame, no generated thumbnail — the same way its mic and system-audio companions already are, so ESCAPEARTIST places it on an audio track instead of a picture-less video clip. Its library row also greys out the MP4 button with the same "no picture" reason M4A already gives for a silent take, instead of offering a conversion that could only fail after the click (ESCSUITE-143).
