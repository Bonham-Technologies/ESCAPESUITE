---
'@escapesuite/craft': patch
---

Three recorder fixes:

- Pressing Escape during the countdown now releases the recorder along with the capture. It used to leave the audio graph and level monitor running, so a handful of cancelled takes in a row would exhaust the browser's audio contexts and stop recording from starting at all.
- Microphone-only recordings work again. With both Screen and Webcam switched off, starting a take failed outright in Chrome; audio-only takes now record through the MediaRecorder path.
- Stopping the screen share at an awkward moment is handled properly. If the recording is paused, it now finishes and saves what was captured instead of sitting in Paused over a dead capture and producing a truncated file; if it happens during the countdown, the take is abandoned and the app returns to idle instead of starting a recording with no source.
