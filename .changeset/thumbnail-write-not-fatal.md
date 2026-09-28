---
"@escapesuite/craft": patch
---

Fixed a failed thumbnail write reporting a recording as "not saved" when it was in fact stored

A recording's thumbnail is written to storage after its (much larger) video, so a storage quota running out was most likely to hit the thumbnail rather than the video — and when it did, the whole save used to fail: "The recording could not be saved — it is not in your library," even though the video and its metadata were already committed. The take was invisible in the library until the next reload, was already available to ESCAPEARTIST in the background, and — for a "Record webcam as a separate track" take — its webcam, microphone and system audio companions were never written at all. A thumbnail is cosmetic: a failed thumbnail write (or a thumbnail that can't be decoded from the file) is now logged to the console and the take is added to the library without one, exactly like a companion part that couldn't be saved; only the video and its metadata failing to write still reports the recording as not saved.
