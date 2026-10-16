---
'@escapesuite/craft': patch
---

Long recordings no longer drift out of sync

A screen or webcam recording's sound could slide further from the picture the longer it ran — on a busy machine by seconds over ten minutes, and on any machine slowly over an hour — because the sound and the picture were timed by two different clocks. They are now timed by the same one: a moment of sound the browser drops is kept as a moment of silence instead of pulling everything after it early, the picture follows the audio device's own clock, and a computer whose audio runs at a rate other than 48 kHz is recorded at the rate it really uses. Recordings of any length stay in sync to the last frame.
