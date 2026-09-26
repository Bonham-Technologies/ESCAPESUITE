---
'@escapesuite/craft': patch
---

A cancelled or failed MP4/M4A conversion no longer leaves hardware encoders open, and an encoder failure now says what the encoder said.

Every `VideoEncoder`/`AudioEncoder` a conversion builds is registered and released in that conversion's one `finally`, guarded on the codec having not already closed itself — the `close()` calls used to sit on the success path, after the flush, where a cancellation or a failure part-way never reached them.

And an asynchronous codec failure now reaches the caller. The `error:` callbacks only wrote a console line, so the conversion carried on handing frames to a dead encoder — whose `encode()` throws from inside a `requestVideoFrameCallback`, where nothing catches it, so the conversion hung, holding every other encoder open, and the row never returned to idle. The callback now aborts the work in flight and the conversion rejects with the codec's own error, so the library says `Conversion failed: <what the encoder said>` instead of nothing at all. No file is muxed out of an encoder that has died, and cancelling still outranks a failure: a conversion the user cancelled raises no notice, exactly as before.

Ceilings for it are exact in `converter.perf.test.ts` — encoders built against encoders released, on the success, cancellation and encoder-failure outcomes of all three conversions (plain MP4, composite MP4, M4A) — and the WebCodecs test double is now strict about a second `close()`, the way the real API is (ESCSUITE-74, closing the tripwire ESCSUITE-66 had to leave lenient).
