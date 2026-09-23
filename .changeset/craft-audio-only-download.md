---
'@escapesuite/craft': minor
---

ESCAPECRAFT: download a recording's audio on its own, as M4A

A third download per row, beside WebM and MP4: **M4A** — the take's audio alone,
AAC in an MP4 container (`audio/mp4`, `.m4a`). A mic-only take is already an
audio recording, but what ESCAPECRAFT stores for it is an audio-only WebM: it
plays, and it is not an "audio file" to most tools, while the MP4 conversion
refuses a take with no video outright. Now the sound of any take comes out as a
file audio editors, podcast tools and phones open.

The conversion is local, like the others — `decodeAudioData`, a WebCodecs AAC
encode, a Mediabunny mux — and it is the tail of the MP4 conversion and nothing
else: no playback, no canvas, no video frames, so it costs a fraction of an MP4
of the same take. The two conversions share one slot (one at a time, whichever
it is), one progress row with a Cancel button, and one notice channel, whose
wording is now the format-neutral "Conversion failed: …".

It is gated in the same "say why, do not hide" shape as the MP4 button, with one
difference that follows from the format: a browser with no AAC encoder still
writes a *silent* MP4, and cannot write an M4A at all, so there the M4A button
is disabled with the probe's own sentence while MP4 stays on offer. A take with
no audio in it disables M4A alone, saying so.

Out of scope, and named here so it is not mistaken for shipped: the other half
of the original request — handing microphone and system audio to ESCAPEARTIST as
*separate* tracks — needs the recorder to write two audio tracks, which is
ESCSUITE-14's shape and not this change.
