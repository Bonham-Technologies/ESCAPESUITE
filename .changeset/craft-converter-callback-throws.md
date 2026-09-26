---
'@escapesuite/craft': patch
---

A conversion that hits an error while reading frames now fails with that error instead of staying on "Converting…" forever.

Every frame of an MP4 or composite conversion is drawn from a browser callback — a `requestVideoFrameCallback`, an animation frame, an `ended` listener — and the browser swallows a throw out of one of those: it is reported to the page, and nothing else happens. The next frame was never requested, the capture promise never settled, so the conversion's one `finally` never ran, every encoder it had built stayed open and the recording row never left "Converting…". A `drawImage` or an overlay draw from an element that has errored, and a `VideoFrame` built on a zero-sized canvas, all raise exactly that; ESCSUITE-74 removed the one cause that was reachable in practice (a dead encoder's `encode()`), and this covers the shape whatever the cause.

Each of those callback bodies now takes the same exit the cancellation path takes — stop the loop, stop both elements, stop listening, reject with what was thrown — so the failure reaches the library as `Conversion failed: …` and the encoders are released. Pinned by one arm per callback and per path in `converter.test.ts`, each with a one-second timeout, because a regression here is a hang (ESCSUITE-78).
