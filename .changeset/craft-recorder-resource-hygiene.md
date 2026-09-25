---
'@escapesuite/craft': patch
---

A cancelled or failed separate-tracks take no longer leaves encoders, outputs or audio nodes open, and an unplugged microphone mid-take ends its own track instead of going silent.

None of this is visible to a user who records, stops and saves — it is what a take that is *cancelled*, or one whose companion pipeline fails, used to leave behind. `WebCodecsRecorder` now keeps construction-order registries of the codecs, Mediabunny outputs and audio source nodes a take builds, and its teardown works through all three: every codec that is not already closed is closed (guarded, because `close()` on a closed codec throws), every output still mid-file is `cancel()`led so Mediabunny releases its encoders and its target, and every `MediaStreamAudioSourceNode` is disconnected rather than waiting for the `AudioContext` to close. A separate-tracks take was leaving five codecs, four outputs and five source nodes open per cancelled take.

Alongside that: an output abandoned because its companion could not be set up, or because that companion encoded nothing, is cancelled rather than left started; each frame reader is cancelled once and dropped instead of twice; an encoder that finishes configuring after a `dispose()` is closed rather than assigned back over a torn-down recorder; and the `AudioData` of a buffer whose `encode()` throws is closed in a `finally` instead of leaking once per callback.

Every companion now watches its own track's `ended`, not just the camera's: an unplugged microphone ends that pipeline where its source died — the part is finalized short, and the screen keeps recording — where before a dead source node went on feeding silence into a `ScriptProcessorNode` that went on firing, so the part came out as long as the take and inaudible for most of it. A part that was cut before its first buffer is left out of the take entirely, and the controller's existing `SEPARATE_TRACK_NOT_SAVED` notice is what tells the user.
