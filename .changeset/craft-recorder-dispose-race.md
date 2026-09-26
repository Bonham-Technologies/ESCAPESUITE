---
'@escapesuite/craft': patch
---

Leaving the recorder while it is still setting up no longer leaves codecs, outputs or an
audio-level loop running.

`WebCodecsRecorder.initialize()` awaits half a dozen times — the capture `<video>` starting,
the AudioContext resuming, the muxer's `Output.start()`, each codec's `configure()`, each
companion pipeline — and a take can be thrown away inside any one of those awaits: closing or
navigating away from the recorder calls `dispose()` synchronously while the start it is parked
on carries on underneath. The teardown had already run and cleared its registries by the time
the parked step resolved, so everything setup went on to build afterwards was built into a
recorder nothing would ever tear down again: a second AudioContext with its own node graph, up
to four Mediabunny outputs holding their encoders and their targets open, up to five codecs
each holding a hardware encoder session, a capture-track listener that could no longer be
removed, and — where it got that far — an `requestAnimationFrame` level-meter loop with
nothing left to stop it. Where it did not get that far it crashed instead, on a field the
teardown had nulled, and the crash was reported to the user as "The recording could not be
started" for a take they had already walked away from.

Setting up now stops where it stands: the teardown raises a flag, every await in the setup path
is followed by a check, and whatever the resolving step produced is released — the codec closed,
the output cancelled — through the same registries a cancelled take uses, so the recorder's
conservation laws (every codec closed, every started output cancelled or finalized, every
source node disconnected) hold for this exit too. `initialize()` resolves quietly rather than
failing, and the start path drops a countdown it can no longer run and withholds the notice,
so nothing is said about a recording that never existed. Nothing changes for a take that is
recorded, stopped and saved.
