---
"@escapesuite/artist": patch
---

An MP4 export with a transition no longer leaks a decoded video frame per frame, and a WebM export that hits an encoder error no longer leaks the frame it was encoding.

The MP4 exporter tracked decoded frames pending cleanup in a map keyed by the source and the timestamp it was fetched at. That key was not always unique: the outgoing clip of a transition is fetched once as an ordinary clip on the timeline and again as the transition's own outgoing side, at the exact same source time, and each of those fetches is a genuinely separate decoded frame. The second fetch silently pushed the first out of the map, so it was never closed — every frame of a transition left one full decoded frame for the browser to eventually garbage-collect, which is exactly the "VideoFrame was garbage collected without being closed" warning some exports were producing. Frames pending cleanup are now kept in a set instead, so every one of them gets closed.

Separately, the WebM exporter's own encode step had no error handling around it: if the encoder threw partway through an export (a codec error, or running out of memory), the frame it had just been asked to encode was left unclosed on the way out, because the failure path never reached the line that closes it. That call is now wrapped so the frame is always closed, matching how the MP4 exporter already handles the same situation.
