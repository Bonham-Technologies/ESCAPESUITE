---
'@escapesuite/craft': minor
---

"Record webcam as a separate track" now splits the sound as well as the picture. A take
recorded with it on produces a file per source: the screen, the webcam, the microphone and the
system audio — whichever of them the take actually had — all from one recorder off one clock, so
they line up by construction rather than by measurement. Each appears as its own row in the
library under its take, labelled with the track it is ("Webcam track", "Microphone track",
"System audio track"), playable, downloadable and deletable on its own; deleting the take
deletes all of them.

**The screen recording still carries the mixed audio**, exactly as before. Downloading the
screen part alone gives you a complete, audible recording, and nothing about a take recorded
without the mode changes at all. The audio files are extra — for anyone who wants to level the
microphone against the system audio, or cut one out, in the editor.

The toggle's help text says so before you choose it. It still costs about **twice the CPU and
twice the storage**, it is still **Chromium/Edge only**, and where a browser cannot serve it the
toggle stays on screen and disabled with the reason said out loud.

A lost track never costs the take: if one source's encoder, muxer or save fails, everything else
is still recorded, stored and listed, and the app says a separate track could not be saved. That
one sentence replaces the webcam-specific wording, because it is now true of any of the three
companion tracks rather than only the camera.

Unchanged, and still named on the row it applies to: **MP4 and M4A of a separate-tracks take
cover the screen track only for now** — they carry the mixed audio, so they are complete
recordings, but the webcam track is not drawn into them yet. Download any part's own WebM from
its row until the composite lands.

**ESCAPEARTIST needs no change for this.** The handoff already resolves every part of a take by
its `takeId` and places each one on its own track, and the microphone and system roles were
already in the order it reads them in — so an audio part sent over arrives beside the screen and
the camera the way the camera did.
