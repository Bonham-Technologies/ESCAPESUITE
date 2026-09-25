---
'@escapesuite/artist': patch
---

Two fixes to the audio parts of an ESCAPECRAFT take (ESCSUITE-71).

**An audio part handed over from ESCAPECRAFT now shows its waveform on the timeline.** The
media library draws one for every file you import, audio and video alike, but a take arriving
from ESCAPECRAFT's "Send to Editor" skipped that step — so its microphone and system-audio
tracks sat on the timeline as bare rectangles, and the screen recording's own mixed audio had
no waveform either. Nothing else ever filled them in: the waveform is computed once, when the
media arrives, so a handed-over part simply never had one. Every part of a handed-over take now
arrives with the same waveform the library's own import computes. A part ESCAPECRAFT
recorded with no audio in it is left alone rather than decoded, a take recorded in a quiet
room keeps the "has audio" flag ESCAPECRAFT saved for it, and a waveform that cannot be read
costs that part its waveform and nothing else — the take is still imported and still placed.

**Audio clips explicitly carry no picture transform.** An audio part has no picture, so the
position, scale and rotation an imported clip gets are meaningless for one — it is never
drawn. That was already what happened, but only as a side effect of an audio part being
stored with no width or height: the same accident meant that, had the parts of a take ever
been handed over in a different order, the webcam's corner would have been measured against a
part with no picture and the camera would have landed in the wrong place on any recording
smaller than the project. Both are now stated: an audio clip takes the documented default
transform, and the rectangle the camera's corner is measured in is the take's picture.
