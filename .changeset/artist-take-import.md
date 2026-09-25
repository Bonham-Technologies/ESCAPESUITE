---
'@escapesuite/artist': minor
---

A recording sent from ESCAPECRAFT now lands **on the timeline**, not just in the media
library — and a recording made with "Record webcam as a separate track" arrives as the two
clips it really is, the screen and the camera, on two tracks.

**This changes what a single-file handoff does too.** "Send to Editor" used to add the
recording to the media library and leave the timeline empty for you to drag it onto; it now
places it for you. The whole take is one undo step, so a single Ctrl+Z takes it back off the
timeline and leaves the media in your library. A handoff into an editor that already holds
work **appends at the end** of the timeline rather than landing on top of it.

For a take recorded as separate tracks, the webcam clip arrives in the corner and at the size
it was recorded in — and, unlike the composited recording, you can now move it, resize it,
animate it or delete it. Its rounded/circular *shape* is not carried over yet; that is
coming with the clip mask that will apply to every clip, not only this one.

If the editor offers to resume a previous session while a recording is arriving, the
recording waits: it joins your media library straight away, and goes on the timeline once you
have answered — after the restored clips if you resume, at the start if you do not. Either
way it is still the one undo step.

If a part of a take is missing from storage — cleared, deleted by hand, or unreadable — the
rest still arrives and the editor says how many parts were skipped instead of reporting a
clean success. A part recorded by a newer ESCAPECRAFT than this editor knows about is added to
your media library, where you can see and delete it, rather than placed somewhere arbitrary.

Loading media from a URL (`?video=` and the host's `LOAD_VIDEO` message) is unchanged: those
still add to the library and place nothing.
