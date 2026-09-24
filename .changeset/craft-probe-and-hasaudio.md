---
'@escapesuite/craft': patch
---

Two honesty fixes in the recorder.

A take recorded with "System Audio" ticked in CRAFT but the tick box cleared in the browser's
own share dialog has no sound in it at all, and is now stored as having none — both records
are built from `microphoneEnabled || (systemAudioEnabled && systemAudioShared)`, the flag the
controller already read off the display stream when the take started (ESCSUITE-62). Before, the
take was marked as having audio and its M4A button offered an audio-only download of silence.

And the codec probe now answers for H.264 and AAC independently: `supported`/`reason` are the
MP4 verdict, `audio`/`audioReason` the AAC one (ESCSUITE-61). A browser with an AAC encoder and
no H.264 encoder gets a disabled MP4 button and a working M4A one, instead of both disabled with
a sentence about video; the silent-MP4 note reads the AAC sentence too.
