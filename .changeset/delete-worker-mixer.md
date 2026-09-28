---
"@escapesuite/artist": patch
---

Exports no longer spin up a Web Worker that never actually did anything, and a clip's volume keyframes are now guaranteed to reach the exported audio.

Every export mixed its audio on the main thread already — the Worker fast path (`extractAndMixAudioWithWorker`) probed for `OfflineAudioContext` support *inside* the worker before using it, and real browsers never expose that API to a worker, so the probe always failed and every export fell back to the main-thread mixer. That worker path is now deleted, along with the probe. It also mixed differently from the mixer that actually ran: it multiplied by the track's volume alone, so a keyframed volume fade would have been dropped had it ever run for real. Separately, a clip whose track had been deleted was previously mixed into the export at full volume instead of being left out — it is now skipped, the same as a muted track.
