---
"@escapesuite/craft": patch
---

A recording whose microphone could not be opened no longer claims to have audio.

The stored `hasAudio` was the microphone *toggle*, and a toggle only asks: on a machine
with no microphone the capability is missing, the capture comes back empty, and the take is
recorded with no sound in it — while both of its records said it had some and the M4A
button offered an audio download of that silence, which could only fail. The answer is now
the track the take really acquired, resolved once when the take starts (the same fact the
recorder builds its audio parts from and the controller counts them with), so the take, its
parts and its buttons cannot disagree. Such a row's M4A button is now disabled and says
why: "This recording has no audio". The system-audio half is unchanged — ticking it still
only asks, and the browser's own share dialog still answers.
