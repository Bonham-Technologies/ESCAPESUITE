---
'@escapesuite/craft': patch
---

Long recordings no longer drift further out of sync the longer they run

A screen or webcam recording's sound could slide further from the picture the longer it ran — on a busy machine by seconds over ten minutes, and on any machine slowly over an hour — because the sound and the picture were timed by two different clocks. They are now timed by the same one: a moment of sound the browser drops is kept as a moment of silence instead of pulling everything after it early, a moment that only arrived late is not mistaken for one that was lost, the picture follows the audio device's own clock, and a computer whose audio runs at a rate other than 48 kHz is recorded at the rate it really uses — or, if that rate cannot be recorded, the recording says so instead of starting without sound.
