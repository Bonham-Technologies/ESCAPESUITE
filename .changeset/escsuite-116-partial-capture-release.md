---
"@escapesuite/craft": patch
---

A capture request that stalls after the screen share is answered no longer leaves the browser's "sharing your screen" bar up until the stalled prompt eventually settles.

`acquireStreams()` used to hand nothing back until the whole request — screen, then webcam, then microphone — settled, so the 60-second deadline (ESCSUITE-109) had nothing to release when the share picker was answered but a camera or microphone prompt was left sitting: the deadline still returned the app to idle, but the live screen share kept running until that stalled prompt finally resolved, which could be never. `acquireStreams` now takes an optional `onPartial` reporter, called after each stage lands with the streams acquired so far, and the deadline branch releases the latest report immediately instead of waiting for the request to finish. Whatever the request hands over afterwards is still released on arrival, same as before — the two releases can name the same stream twice, which is safe: stopping an already-stopped track is a no-op.
