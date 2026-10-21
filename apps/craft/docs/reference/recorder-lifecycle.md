<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Recorder lifecycle

The recorder is created **and `initialize()`d before the countdown starts**, so from that moment
it already owns an AudioContext, an audio capture node (an AudioWorkletNode, or a ScriptProcessorNode
on the fallback path), an rAF audio-level monitor that loops
forever and — on the WebCodecs fallback capture path — a `<video>` appended to the document.
**Every exit from a take therefore has to `dispose()` it**: cancelling the countdown, cancelling
the recording, a recorder error, a start that failed (`initialize()` can throw *after* the audio
graph exists — an all-sources-off take reaches MediaRecorder, which builds the AudioContext before
discovering it has no tracks), and the unmount teardown. `useRecordingController` funnels all five
through one `disposeRecorder()` helper — and the two interval tickers through
`clearCountdownTicker()` / `clearDurationTicker()` — so a new exit path cannot quietly skip them.
Skipping disposal leaks one AudioContext per attempt, and Chrome refuses to create more after
about six. The duration ticker is cleared in `onStop` as well, because a recorder can finish a
take on its own (the capture ended) with nobody having gone through `handleStopRecording`.

A sixth exit belongs to neither list: a render-time throw anywhere in the app's React tree
(ESCSUITE-212). Before this there was no boundary at all, so a throw unmounted the whole app to
a blank page while a live recorder kept capturing into a UI nobody could see or stop. `main.tsx`
now wires `@escapesuite/shared`'s `ErrorBoundary` (mounted by `bootstrapApp()` around `<App />`)
to `useRecordingController`'s own `disposeLiveRecordingSession` as its `onError` — the same
`disposeRecorder()` / `stopAllStreamsRef.current()` the unmount teardown already calls, now
reachable from outside React through one module-level slot the mounted controller keeps current,
because `onError` is bound once at bootstrap, before any component (and so any ref) exists. Both
calls are idempotent, so this running once from `onError` and again from React's own unmount
cleanup costs nothing twice over. This is not a general safety net for a live take, only for a
**render-time** throw: an exception out of an event handler (`handleStopRecording`, say), a
`setTimeout`/`requestAnimationFrame` callback or a rejected promise reaches no React error
boundary at all and leaves the recorder running exactly as before this ticket.

The capture can also die on its own — the user hits the browser's "Stop sharing" — and the take
is not always mid-recording when it does. Both recorders handle the video track's `ended` event
in all three states:

- **recording** → stop and deliver the blob (unchanged)
- **paused** → also stop and deliver. A paused take over a dead capture can never be resumed, so
  leaving the UI in Paused only guarantees a truncated file when Stop is finally pressed.
  `MediaRecorder.stop()` from `'paused'` still fires `onstop`; WebCodecs keeps `isRecordingActive`
  true across `pause()`, so its `stop()` finalizes normally
- **before `start()`** (i.e. during the countdown) → nothing was captured, so there is no blob to
  deliver. Both recorders call `onError` with `'Capture ended before recording started'`, which is
  the only channel they have back to the controller; `onError` there clears the countdown ticker,
  disposes the recorder and returns to idle. ESCAPECRAFT has no in-app notification surface, so the
  user sees the console warning and the app back at idle rather than a toast
- **after `stop()`** → ignored. Both classes keep a `hasStarted` flag precisely because "not
  recording right now" is *also* true while a stopped take is being finalized: `MediaRecorder.stop()`
  flips `state` to `'inactive'` synchronously and `WebCodecsRecorder.stop()` drops
  `isRecordingActive` before awaiting the encoder flushes and `output.finalize()`, while the `ended`
  listener lives until `cleanup()`. Pressing Stop and then clicking the browser's "Stop sharing" bar
  lands in that window, and reporting it as an error would have the controller dispose the muxer
  mid-finalize and lose the recording

That same synchronous `state` flip used to cost `recorder.ts` a correct duration when Stop was
pressed **while paused** (ESCSUITE-105): `getDuration()` only subtracted the open pause while
`state === 'paused'`, but `stop()` had already flipped it to `'inactive'` by the time `onstop`
(and the controller's `cleanup()` read) ran, so the whole open pause counted as recorded time — a
10s take paused for 60s and then stopped read as 70s. `stop()` now latches
`pausedDuration += Date.now() - pauseStartTime` itself before calling `mediaRecorder.stop()`, the
same bookkeeping `resume()` already does, so the paused arm and the stopped arm of `getDuration()`
agree by construction. `WebCodecsRecorder` never had this bug: its `stop()` leaves
`isPausedState` untouched, so its own `getDuration()` keeps subtracting the open pause straight
through finalization.

**A separate-tracks take has up to three companion pipelines, and none of them ends the take.**
`WebCodecsRecorder` holds `companions: CompanionPipeline[]` — one `kind: 'video'` pipeline for the
webcam and one `kind: 'audio'` pipeline per audio source the take really has — each with its own
encoder, its own Mediabunny `Output` and its own `failed` flag. **Every companion watches its own
track's `ended`** (`watchCompanionTrack()`, one handler per role): it warns
`'<Track> track ended: <label>'` and calls `endCompanion()`, which stops that pipeline's capture —
`readerActive = false` for the camera, `capture.stop()` for an audio source — while the screen keeps
recording, and `stop()` then finalizes a **shorter** part, or none at all if nothing was ever
encoded. The encoder is deliberately left open there, because `stop()` still has to flush the tail
of the part into the file. An unplugged microphone is why the audio half exists: a dead
`MediaStreamAudioSourceNode` goes on feeding silence to a capture that goes on running, so without
it the part came out as long as the take and inaudible for most of it. Stopping an AudioWorklet
capture (ESCSUITE-299) still delivers what was rendered before the end — the chunks queued on their
way to the page and the tail the processor flushes — and then lets the node go; stopping the
ScriptProcessorNode fallback disconnects it, and its own gate stops counting at once rather than
waiting for the audio thread to notice the disconnect. A *failed* companion's capture is stopped
the same way, and the chunks still on their way are dropped by its nulled encoder.

`failCompanion()` is `endCompanion()` **plus the `failed` flag** (and, for an audio pipeline, a
nulled encoder): the difference between the two is whether what was already encoded is still worth
delivering. Every encoder has its own error handler, because `createVideoEncoder` takes
the handler as a parameter with no default and each audio pipeline builds its own: the primary's
still reports through `onError`, a companion's warns (`'<Track> track encoder failed: …'`), calls
`failCompanion()` and reports nothing, because
`onError` is what makes the controller dispose the recorder and throw away a screen recording that
is still being made. Flush and finalize are isolated per pipeline (`flushCompanions()`,
`finalizeCompanions()`, each loop iteration in its own try/catch rather than one around the loop,
so one pipeline's refusal does not cost the others theirs — and the flush's own catch matters
because it runs *before* the primary's `output.finalize()`, so a rejection that escaped it would
skip that finalize and report `onError` over a screen recording that was already complete).

**Four cases leave a part out** of what `stop()` delivers: a pipeline that could not be *set up*
at all (each builder has its own try/catch — an `Output.start()` or a `configure()` the browser
refuses warns, releases what it holds and records the take without that track, because
`canRecordSeparateTracks()` proves the APIs exist and nothing can prove the camera's dimensions
are an encodable VP9 config or that a third Opus encoder will configure), one that encoded
nothing, one that gave up (`failed`), and one whose `finalize()` threw. A pipeline that failed to
set up is never pushed onto the list at all, so `stop()` and `cleanup()` both skip it. An empty
row in the library and a second ARTIST source with nothing in it are worse than a missing part,
and none of the four may ever cost the take its primary blob.

**Everything a take acquires is released on the way out, whichever way it ends** (ESCSUITE-66).
A finished take releases most of it itself — `stop()` flushes and closes every encoder and
finalizes every output worth storing — but a take that is **cancelled** or that **fails** reaches
none of that, and a separate-tracks take is holding five codecs, four Mediabunny outputs, five
`MediaStreamAudioSourceNode`s and two frame readers when it happens. Neither the fields nor
`companions` can answer "what is still open?", because a pipeline that gave up has its `encoder`
nulled and `cleanup()` clears the list, so the recorder keeps three construction-order registries
— `codecs`, `outputs`, `sourceNodes` — and `cleanup()` works through all three:

- **`closeCodecs()`** closes every codec whose `state` is not already `'closed'`. The guard is not
  optional: `close()` on a closed codec throws `InvalidStateError`. Codecs are registered at
  *construction* (`registerCodec()`), before their `configure()` is awaited, which is what makes a
  `dispose()` landing inside that await safe — `this.videoEncoder` is cleared by `cleanup()` and
  then assigned again by the resolving `createVideoEncoder`, but the encoder itself was already on
  the list and is already closed
- **`cancelOutput()`** on every output still sitting at `output.state === 'started'`. Mediabunny
  holds an unfinalized output's encoders and its target open until it is told the file is over;
  `'finalized'` and `'canceled'` are done with, and one that never started holds nothing. The same
  call runs eagerly on the two paths that abandon an output mid-take: a companion whose setup
  failed (its `Output.start()` already succeeded, and nothing downstream can reach it — it was
  never pushed onto `companions`) and, in `finalizeCompanions()`, a companion that is `failed` or
  encoded nothing. A cancel that throws is warned and swallowed — the primary blob may be finished
  and about to be delivered, and must never be lost to a muxer that will not let go
- **`disconnect()`** on every source node. A `MediaStreamAudioSourceNode` is otherwise released
  only when the `AudioContext` closes, which is late for the mix's two taps and never for a
  companion's — its pipeline is gone long before the take is
- **`releaseFrameReader()` / `releaseCompanionReader()`** cancel each reader **and null the field**.
  Dropping it is the point: `stop()` releases the readers and then `cleanup()` runs from its
  `finally`, so a reader still on the field was being cancelled twice, and the `if (reader)` guards
  that could never be false were unreachable branches

`webcodecsRecorder.perf.test.ts` pins every one of these as an **exact** conservation law rather
than a ceiling — codecs closed == codecs constructed, outputs finalized-or-cancelled == outputs
started (and never both), source nodes disconnected == connected, one cancel per reader — over a
finished separate-tracks take and over a cancelled one ("one cancelled take"). The `AudioData`
handed to each audio `encode()` is closed in a `finally` for the same reason: `close()` as the
next statement leaked the decoded buffer every time `encode()` threw, which for a codec closed
under the callback is ~11.7 times a second for the rest of the take.

**A take can be thrown away while it is still being set up, and then nothing more may be
built** (ESCSUITE-73). `initialize()` awaits half a dozen times — the fallback capture
`<video>` starting, the AudioContext resuming, `Output.start()`, each codec's `configure()`,
the AudioWorklet module loading (ESCSUITE-299: `createCapture()` closes a capture that finishes
building after a dispose, rather than putting it on a registry `cleanup()` has already swept),
each companion — and `dispose()` lands inside one of those awaits for real: the screen's
unmount teardown calls `disposeRecorder()` synchronously while `handleStartRecording` is still
parked on the `initialize()` it started, and the recorder's own `onError` does the same when
the capture ends mid-setup (the video track's `ended` listener is installed before
`Output.start()`). `cleanup()` has then already swept the three registries above *and cleared
them*, so whatever the resolving step goes on to build is built into a recorder nothing will
ever tear down again — a second AudioContext with its own analysers and graph, up to four
Mediabunny outputs holding their encoders and their targets open, up to five codecs, and a
track `ended` listener `trackEndedHandlers` can no longer remove. Setup then walked into one
of the fields `cleanup()` *nulled* — `videoTrack`, `audioContext` — and threw a `TypeError`
out of `initialize()`, which `handleStartRecording` reported as `START_FAILED`: a notice, in
the module-singleton store, about a take the user never saw. The level monitor's share was
one stray sample rather than a runaway loop, and worth stating precisely because it is easy to
assume otherwise: `cleanup()` nulls both meters, so a `startAudioLevelMonitoring()` reached
after it takes its **no-meter branch** and pushes a single
`{ microphone: 0, system: 0 }` — one whole-app re-render on behalf of a take that no longer
exists — rather than scheduling anything.

So `cleanup()` raises a **`disposed` flag first**, and every await in the setup path is
followed by `abortIfDisposed()`. Three decisions carry it:

- **It throws.** `TakeDisposedDuringSetup` is caught by `initialize()` and by nothing else,
  which keeps the guard to one decision rather than an `if` at each of nine call sites — and
  the two companion builders' existing `catch` blocks already release exactly what their half
  was holding (the output, and the camera's reader), so the error is thrown *into* those
  catches and re-raised by them rather than guarded around them. A disposal is warned about
  nowhere: a take that no longer exists is not a take recorded without its camera
- **`initialize()` resolves.** A rejection would reach `handleStartRecording`'s catch and
  raise `START_FAILED` — a notice, in the module-singleton store, read out on the next mount,
  about a recording the user never saw. Every other failure still rejects exactly as before
- **Only one step has anything to release**: an `Output` whose `start()` resolves *after* the
  sweep sits at `'started'` and is no longer on `this.outputs`, so `abortIfDisposed()` takes
  it as an argument and cancels it. A codec still configuring was registered at construction
  and is already closed (ESCSUITE-66); the `<video>`, the AudioContext and the primary's
  reader are all fields `cleanup()` reached

`startAudioLevelMonitoring()` moved out of the setup body to `initialize()` itself, past the
guard. That move is **structural**, not a repair of anything the loop did: monitoring is now
unreachable after a dispose, so neither the rAF loop nor that one stray sample can belong to a
take that is gone.

The controller closes the same window from its own side, with **two** guards after
`initialize()`, because being superseded and being torn down are different facts and want
different answers (ESCSUITE-109):

1. **Superseded — touch nothing.** `if (attemptRef.current !== null && attemptRef.current !==
   myAttempt) return;`. A cancel frees Record while this await is parked, so by the time it
   resumes the next take may have acquired its capture and built *its* recorder — and
   `recorderRef`, the store's streams and `stopAllStreams` all belong to that take by then.
   Whatever this attempt owned was released by the cancel that superseded it, so it has nothing
   left to do and no right to do anything.
2. **Torn down — tear down.** `if (!recorderRef.current) { disposeRecorder(); stopAllStreams();
   return; }`. Any `disposeRecorder()` nulls that ref: the unmount teardown, both cancels, and
   the recorder's own `onError`, which cancels nothing and so raises no flag — the case
   `cancelledRef` alone cannot see. Without it, a capture stopped during setup left `'countdown'`
   in the store and an interval ticking against a null recorder: a 3-2-1 over nothing, with a
   next mount coming up inside it. `cancelledRef` is deliberately *not* asked here — every path
   that raises it disposes the recorder on the same line, so the ref answers for it, and asking
   both would be a decision that can never go the other way.

Getting that split wrong is not a cosmetic bug and has its own test ("when a newer take is
already being set up"): one guard that tore down on both facts disposed the newer take's recorder
and put its sharing bar out mid-take, and then the newer take's own resume found a null recorder
ref and returned **without setting a state** — leaving the UI in `'preparing'`, where the record
button is disabled and Cancel does not render, with a reload as the only way out.

The start notice is withheld on both of them — the `catch` returns as soon as the token is not its
own — so a browser that *does* reject out of a half-torn-down setup (an AudioContext closed under
a pending `resume()`) still says nothing to a user who has left. Guard 2 **tears the take down**
rather than returning bare (ESCSUITE-93): both calls are no-ops on every path that reaches it
today — the unmount teardown, the recorder's own `onError`, and `handleCancelRecording` from
Escape in `'preparing'` while `initialize()` is parked — because each has already done them. A
bare return is nevertheless a promise that every *future* way of arriving there will have cleaned
up first, and the window below is the one that broke it.

**There is an earlier window still, and a cancel cannot clean up after it** (ESCSUITE-93).
`handleStartRecording` parks on `await acquireStreams()` — the screen-share picker is on screen,
or the camera permission prompt is — and that is *before* `setStreams()`, so the Escape that
lands underneath it (in `'preparing'`, which `useKeyboardShortcuts` routes to
`handleCancelRecording`) raises the flag, disposes a recorder that does not exist yet, returns
the app to idle and calls a `stopAllStreams()` that reads the store and **finds nothing there**.
The resumed start then did all of it anyway — the live streams into the store, the compositor
started, `createRecorder()`, `await initialize()` — and only then reached the guard above, which
returned without disposing: the sharing bar and the camera light stayed on for the rest of the
session behind a UI that said idle, a compositor rAF loop drew forever in PiP, and an orphaned
recorder pushed audio levels ~12x/s into the store. Repeat it and Chrome refuses further
AudioContexts, so later takes fail to start. So the attempt is asked again **immediately after
`acquireStreams()` answers** — the token and `cancelledRef` together, one `abandoned` question
(ESCSUITE-109) — and that exit releases what the request handed back itself —
`stopStream()` on each of the three captures — and builds nothing on top of it: no `setStreams`
(the store would mirror a capture already being thrown away, on a component that may be
unmounted), no preview, no compositor, no recorder. It is deliberately the earliest exit, and the
only one whose law is that nothing was ever *made*: `useRecordingController.test.ts`'s "while the
capture request is still outstanding" asserts zero recorders built, a null `compositorRef`, an
untouched store and every acquired track stopped **exactly once** — in the cancel case and in the
unmount case alike — and then that the *next* Record click still starts a take, because a gate
left closed on the cancelled path would brick the button for the session and say nothing.

**One start at a time, and the token that says which start.** `state` is the *rendered* truth and
is written a render before it is read, so nothing but that lag stood between two fast clicks on
Record — or two presses of R — and two overlapping starts, with the second `recorderRef.current =`
orphaning the first recorder's AudioContext, level monitor and muxer where no `dispose()` could
ever reach them. `attemptRef` is the synchronous truth: an **attempt token** — an empty object,
because identity is all it carries — set at entry and dropped in the `finally` of the same attempt
(per attempt, not a latch), with a second call while one is in flight a no-op.

It replaced a boolean (ESCSUITE-109) because a boolean could only be dropped when the attempt
*settled*: a take cancelled while the picker was still on screen left Record inert until that
picker was answered — bounded and sub-second when a device opens normally, and for a picker nobody
ever answers, dead for the rest of the session with nothing said about it. So
`handleCancelRecording`, `cancelCountdown` and the unmount teardown all **drop the token**, which
does both halves at once: Record is free at cancel time, and the attempt that resumes afterwards
finds a token that is no longer its own. **Every post-`await` guard in the start path asks it** —
the one after `acquireStreams()` and the pair after `initialize()` (see "two guards" below) — so
an abandoned attempt
releases what it was handed and builds nothing, rather than walking on into a take that is now
live; and the `catch` asks it first of all, because tearing down there would tear down *that*
take. A stale attempt has nothing of its own to release beyond what the request handed it: only a
cancel or the unmount teardown can drop the token mid-flight, and both dispose the recorder and
release the capture on their way past. `useRecordingController.test.ts`'s "and the next take is
started before it arrives" drives the ordering both ways round — the abandoned request answering
before the new take's own, and after it — and asserts the abandoned tracks stopped exactly once
with the live take's recorder, streams and countdown untouched.

`cancelCountdown` raises `cancelledRef` as well, so the two cancel paths have one shape
(ESCSUITE-109). It is the only cancel that used to be visible to the post-`initialize()` guard
solely through the recorder ref it nulled, and to a start still parked on its capture request not
at all.

**Five of the recorder's six callbacks carry the same identity.** The attempt token above answers
for the *start path*; the callbacks `createRecorder` is given — `onStart`, `onPause`, `onResume`,
`onStop`, `onError` — answer for what happens after a take is live, and used to have no identity
of their own: each acted on whatever `recorderRef`, the tickers and the streams held **when it
fired**, not on the recorder it was built for. A recorder disposed by a cancel can still flush a
last chunk or report a dead encoder afterwards (ESCSUITE-66/73 make it rare, not impossible), and
by then `recorderRef.current` may be a newer take's recorder — B, live and recording — so A's late
`onError` disposed B and stopped B's streams, and A's late `onStop` (past `cancelledRef`, which a
start resets) would have saved A's blob as B's take. Fixed the same way as the start path
(ESCSUITE-118): `const me: AnyRecorder = createRecorder({ ... }, ...); recorderRef.current = me;`
— the callbacks only ever run once initialization has resumed after `createRecorder` returns, so
`me` is settled before any of them can read it — captures the exact instance in the closure, and
`onStart`, `onPause`, `onResume` and `onStop` each open with `if (recorderRef.current !== me)
return;` before doing anything else. `onError` guards the same way but **logs first**: its
`console.error('Recording error:', error)` runs before the identity check, deliberately, so the
console still hears about a late failure from a recorder nobody is listening to any more — a test
pins the console call happening even when the rest of the callback is skipped. `onStop` had a
second guard here too, `if (cancelledRef.current) return;`, for a stop landing after the take was
cancelled or the screen went away — but it turned out to be unreachable, and was deleted
(ESCSUITE-118 fix round 2): every path that raises `cancelledRef` (`cancelCountdown`,
`handleCancelRecording`, the unmount teardown) calls `disposeRecorder()` on the same line, which
nulls `recorderRef.current`, so the identity guard two lines above always returns first. The
identity guard is what actually drops a cancelled take's late stop now, and its comment says so.

The identity guard also catches a narrower case than supersession: a recorder whose *own* `onError`
disposed it. `disposeRecorder()` nulls `recorderRef.current`, and nothing raises `cancelledRef` on
that path — so on the MediaRecorder path, where the browser can still call `onstop` with whatever
chunks it had recorded after an `onerror` (`core/recorder.ts`'s `mediaRecorder.onerror` /
`onstop`), the take's own late `onStop` used to save that partial blob as if the take had ended
normally. `recorderRef.current !== me` is true once the ref is `null`, exactly as it is once the
ref points at a different recorder, so that late `onStop` is dropped too — correctly: the take was
already reported as failed and returned to `'idle'`, and saving a blob afterwards would resurrect
a take the user was just told had failed.

`onAudioLevels` is the one callback left unguarded, because it needs no guard: both recorders
cancel their rAF level-monitor loop synchronously inside `dispose()`'s `cleanup()`, so a disposed
recorder is never still mid-loop when this fires.

**The save's completion carries the same identity** (ESCSUITE-174). `onStop` kicks the save off
and returns; the `setState('idle')` that follows it used to land in whatever the store held
whenever the save settled, and a save is a container repair, a metadata probe, a thumbnail decode
and two IndexedDB writes — seconds on a multi-MB take over a slow disk. Anything that took the app
out of `'saving'` inside that window left Record live, and the finished save's own `'idle'` then
landed on the take started *after* it: recording, with the store saying idle, so the transport bar
offered "Start recording" with no Stop and no Cancel, and a Record click reassigned
`recorderRef.current` over a recorder nothing could ever dispose. Escape was the only way in that
the UI offered (see "Keyboard Shortcuts" — it no longer is; the transport bar's own Cancel renders
only while a take is live, under `isRecordingActive`, never in `'saving'`), but the clobber is a
property of the completion rather than of the key: the guard is the half that holds if any future
control, or the unmount teardown, takes the app out of `'saving'`. So the chain is
`saveRecording(...).catch(...).then(...)`: the two arms converge on **one** state write, guarded by
`if (recorderRef.current !== me) return;` — the same `me` the five callbacks carry. Once the ref has
moved on, this take is not the app's any more and whatever moved it has already set the state it
wanted. Two things stay deliberately **unguarded** either side of that write: `SAVE_FAILED` and its
`console.error`, because the user's recording really is not in the library whatever they have moved
on to, and the `refreshStorageSpace()` in the `finally`, because the write happened either way.

**The invariant that guard rests on**: an ordinary save passes it because neither
`handleStopRecording` nor `onStop` disposes the recorder — the ref still points at `me` when the
save settles, seconds later — and every path that *does* move it off `me` has already written a
state (both cancels, the unmount teardown, the recorder's own `onError`, the start path's catch).
**A stop that disposed the recorder would have to write `'idle'` itself**, or this guard would
strand every ordinary save in `'saving'`. That matters because `'saving'` has **no user-reachable
exit at all** — the Record button is disabled there, the Cancel button is not rendered, and
Escape is inert — so the save promise settling is the only way out, and **the one thing on that
path that could never settle now has a deadline** (ESCSUITE-180).

`core/thumbnailGenerator.ts`'s `generateThumbnail` had an `onerror` and no clock, so a `<video>`
that neither loads nor errors — a container Chromium's demuxer will not commit to, a decoder that
never reports — parked the save, and with it the app, for the life of the tab. Both probes on the
save path now race **`THUMBNAIL_TIMEOUT_MS`** (5 s, exported from that module): the number
`extractVideoMetadata` has waited since it was written, named so `generateThumbnail` shares it
rather than carrying a second one. Same shape as `CAPTURE_TIMEOUT_MS` (ESCSUITE-109/116) and for
the same reason — nothing here can be aborted, so a clock is the only way out — but far shorter,
because nothing is waiting on a *person*: a decode either starts within a second or two or it is
not going to. On expiry the probe rejects through the same cleanup its `onerror` arm uses (object
URL revoked, element back to NETWORK_EMPTY, and the frame request `onloadeddata` queued cancelled,
so an abandoned probe cannot be followed by a `captureFrame()` that draws a frame for it — a
`toBlob` callback already in flight when the deadline fires instead finds the promise settled and
its own cleanup a harmless no-op), and the caller lands on the **placeholder** — the arm
ESCSUITE-107 already built for a thumbnail that cannot be had. So a save never waits for a frame
that is not coming: it finishes with the placeholder tile and returns to `'idle'`.

**Deliberately not a deadline on the whole save.** The two IndexedDB writes that follow have no
safe abandon point — giving up partway through `storeVideo` would leave a take half in the library,
which is exactly the failure ESCSUITE-107 was about — so the deadline stops at the last thing on
that path that can be dropped harmlessly.

**A microphone that cannot be opened does not cost the take** (ESCSUITE-184). `acquireStreams`
(`hooks/useMediaStreams.ts`) asks for the three sources in order — screen, webcam, microphone —
and used to release everything it held and rethrow on *any* failure, so a user who had already
picked the window they wanted to share lost it the moment `requestMicrophone()` rejected, with
`CAPTURE_REFUSED`/`START_FAILED` and nothing recorded. The microphone's request now sits in its
own try/catch, and the catch cannot tell *why* it failed — the prompt was refused, the device is
already in use by another app, it was unplugged between the capability check and the request —
so it treats every rejection the same way: the screen and webcam captures are kept, the take
proceeds without sound, and the result carries `micUnavailable: true` so the controller can raise
`MIC_UNAVAILABLE` through the one notice channel.

The reasoning for why this is the *only* optional source: a take with no sound is a take — the
ESCSUITE-14 companion shape with the mic part simply absent, which every consumer already reads,
because a machine with no microphone has produced exactly that since ESCSUITE-70. A refused
**screen** capture still fails the take (there is nothing to record), and so does a refused
**webcam** in a PiP take, because the overlay is what the user explicitly asked for. The one
exception to the exception: a **microphone-only** take whose microphone could not be opened has
nothing left either, so `!screen && !webcam` rethrows and that take fails exactly as it did
before.

Three details follow from the shape:

- **`AcquisitionResult` is a wider type than `AcquiredStreams`**, which is what `onPartial`
  still reports. The deadline release (ESCSUITE-116) reads the latest `onPartial` report and has
  no use for `micUnavailable`, so the reporter's shape is unchanged — and the microphone stage is
  still reported whether or not it produced a stream, because a screen capture that landed before
  an unavailable microphone must be in the report the expiry releases.
- **The controller cannot work this out for itself.** `mic: null` with the toggle on is *also*
  what a machine with no microphone looks like, and `useRecordingController` has no
  `capabilities` to tell the two apart — hence the flag rather than an inference.
- **Nothing else needed changing.** `micAcquired` is already "the toggle AND a track on the
  stream that came back" (ESCSUITE-70), so an unavailable microphone is `false` there by
  construction: `expectedCompanions` counts no mic part, both recorders' audio wiring is guarded
  on `micStream &&`, and the `CapturedTake` the save path is handed describes a recording with no
  microphone — so the library's M4A gate, the MP4 conversion and the ARTIST handoff all see the
  take as it was actually recorded.

**A capture request the browser never answers gets a deadline.** `getDisplayMedia` and
`getUserMedia` take no `AbortController`, so a picker or a permission prompt left on screen — or a
camera or microphone driver wedged such that `getUserMedia` never settles — used to park
`handleStartRecording` for the life of the tab: `'preparing'` with no way out but a reload, and
Record inert behind it (ESCSUITE-109). So the request is raced against
`CAPTURE_TIMEOUT_MS` (60 s, a constant in `useRecordingController.ts`, generous because the share
picker is a dialog a user may legitimately leave sitting). On expiry the app raises
`CAPTURE_UNANSWERED` through the one notice channel, returns to `'idle'` and frees Record. The
request is still out there, so `acquireStreams` is not a black box for the deadline branch:
`acquireStreams` takes an optional `onPartial` reporter, called after each stage lands
(screen, then webcam, then microphone) with the streams acquired so far — nulls for stages not
yet reached — and `handleStartRecording` keeps the latest report in a local, closed over by
nothing but this one attempt. Answered-and-parked used to mean live: the picker settled, the
camera prompt never did, and the browser's "sharing your screen" bar stayed up until *that*
prompt eventually settled too (ESCSUITE-116). Now the deadline branch releases the latest
partial report immediately — the share bar goes down at the deadline, not whenever the stalled
prompt gets around to it — whether or not the take had already been cancelled (the release sits
before the `abandoned` guard that decides whether to say anything, so a thrown-away take still
gets its screen share stopped, silently). A second, narrower window stays open past the deadline
itself: a stage that lands *after* the clock has given up but before the whole request finally
settles — the camera prompt answered a minute late, the microphone driver unwedging itself an
hour later — used to sit in `onPartial`'s latest report with nothing reading it again until the
request settled, which could be never. An `expired` flag closes it: once the deadline branch has
fired, the same `onPartial` callback releases whatever it is handed on the spot, rather than only
updating the local the deadline branch already read. Only *then* — whether through the deadline's
own release, the `expired` callback, or both — does whatever the request eventually hands over
also get released on arrival, same as before: `releaseAcquired`, the same three `stopStream()`
calls the cancelled path makes, moved onto a promise nobody is awaiting any more. The releases can
name the same stream more than once — a stage already reported through `onPartial`, before or
after the deadline, is handed back again inside the final `acquired` once the request does settle
— and that is safe on purpose: `stopStream` stops tracks, and stopping an already-stopped track is
a no-op. A request that *rejects* after the clock ran out still says nothing, because the user was
already told. The token is the abort:
nothing is plumbed into the browser APIs, which would not take it. The clock is armed *after* the
request is issued and with nothing awaited in between, so it costs the click's user activation
nothing, and it is cleared however the race ends, including by the request throwing — a 60-second
timer left armed behind every take is a leak, which
`useRecordingController.test.ts`'s "never starts the clock for a request that answers at once"
pins by counting the timers a started take leaves running.

`webcodecsRecorder.perf.test.ts` pins the whole of it as exact conservation over one such take
("one take disposed while it was still setting up"): three codecs closed, two outputs
cancelled, three source nodes and one processor disconnected, two readers cancelled, one
AudioContext closed, **zero level samples pushed**, and zero `requestAnimationFrame` calls
beside it as the guard that the monitor call stays where it is.

**Audio companions are a second tap, never a diversion.** The primary output keeps the mixed
`AudioEncoder` and the mixed Opus track exactly as before — a screen-only download still has
sound, and the composite MP4 has the mix to draw on without decoding a single part. Each companion adds its own
`MediaStreamAudioSourceNode` on the same track, its own audio capture (the same kind the mix uses —
an AudioWorkletNode, or a 4096-sample ScriptProcessorNode on the fallback path; one take has one
audio-capture mechanism, decided once, because two in the same take would be two things to keep in
step for no gain), its own `AudioEncoder` and its own
Opus-only `Output`. A companion exists exactly when its source is in the mix: the conditions
are the ones `initialize()` already asks when it wires the mix — a toggle AND the stream it names
(`config.microphoneEnabled` with `micStream`, `config.systemAudioEnabled` with an audio track on
`screenStream`) — with the companion additionally requiring an audio *track* on `micStream`, which
costs nothing because a stream with no audio track contributes nothing to the mix either. That is
the same pair `useRecordingController`'s `expectedCompanions` asks, so the number built and the
number the take is counted as asking for cannot disagree. `useRecordingSave`'s `hasAudio` cannot disagree about the
**microphone** either, since ESCSUITE-70: that half is the same pair, resolved once by the
controller as `micAcquired` and carried to the save path in `onStop`'s closure, so a take whose
microphone toggle is on and whose `acquireStreams` came back with `mic: null` builds no mic
companion, is counted as asking for none, and is stored as having no audio. Its **system** half is
weaker by construction: `systemAudioShared` is read from the store at save time and reset only by
the next take's start, so it describes this take until another begins (stated on the expression
itself). The
**level meters are untouched** — the mix's own two analysers, on the mix's own source nodes; a
companion adds a tap, never a meter.

**A lost part is said out loud, from whichever layer knows.** A short list on this callback is also
what an ordinary take delivers, so the recorder cannot report the loss and `useRecordingSave`
cannot see it (it saves what it is handed). The **controller** can: it resolved the mode before
the countdown and counted how many companions the take asked for — the camera, plus one per audio
source it really has — so `onStop` raises `SEPARATE_TRACK_NOT_SAVED` when fewer arrive, and says
nothing for a composited take, whose `expectedCompanions` is 0. `useRecordingSave` raises **the
same notice** for the other half of the same promise: a part lost in *storage* — metadata,
thumbnail or a write that throws — is caught, warned per role and reported once however many were
lost, and the primary is stored and listed exactly as a single-file take would be. One string
either way; the console has the detail.

Losing every part is the case that shows why the resolved mode has to be *carried* rather than
inferred (ESCSUITE-68). The controller hands `separateTracks` to `saveRecording` on the same
`captured` object as `micAcquired`, in the same closure, so a take whose companions all went
missing inside the recorder is still stored as the take it was: its primary named by its own
`takeId`, with `role: 'screen'`, `startOffset: 0` and the `overlayPlacement` the camera was framed
at — the only record of that geometry there is. Read off the companion list alone, the same take
was stored as though it had been composited.

`onStop` is uniform on the WebCodecs path: `(blob, companions)` for every take, the list in role
order (webcam, mic, system, because that is the order the pipelines are built in) and `null` where
there are none, so an ordinary take reports that it had none rather than saying nothing.
`Recorder` (MediaRecorder) still calls it with the blob alone. One `RecorderStopCallback`
(`store/types.ts`) types both, which is what makes the controller's single callback assignable
to either recorder.

**Composited Picture-in-Picture is the gap**: the stream handed to the recorder there is the
compositor's canvas track, not the screen track, so none of the above fires when the user stops
sharing during a composited PiP take. Fixing that means watching the source tracks in
`compositor.ts`. A *separate-tracks* PiP take is not affected — its recorder holds the raw
screen track, so every row of the list above applies to it as it does to a screen-only take.

**Audio-only takes use the MediaRecorder path.** `SourceToggles` lets both video sources be switched
off; `WebCodecsRecorder` is built around a video track and throws
`'No video track available for recording'` without one. `createRecorder` / `canUseWebCodecsRecorder`
/ `getRecorderType` take `hasVideoSource` alongside `isPiP` for exactly this, and the controller
computes it as `(config.screenEnabled && !!screen) || (config.webcamEnabled && !!webcam)` — the same
"a stream AND its toggle" test both recorders apply when they pick a video track, since a capability
the browser lacks yields a `null` stream with the toggle still on. (`separateTracks` is the third
argument all three take, and the recorder asks the same "a stream AND its toggle" question of the
screen before it builds a companion at all: a take configured for the screen but started without
one is recording the *webcam* as its primary, and a companion there would be one camera in two
files.) `getRecorderType` gets it too:
its answer is what `useRecordingSave` keys the `fixWebMMetadata` repair off, so an audio-only take
would otherwise be saved as unseekable WebM.

**The same boolean is what keeps an audio-only take's own stored metadata honest (ESCSUITE-143).**
The controller carries it as `CapturedTake.hasVideoSource`, and `useRecordingSave` reads it for the
primary the same way `part?.isAudio` reads a companion's role: no picture means no
`extractVideoMetadata` probe (which reports `videoWidth || 1920`, so an audio file would otherwise
come back a lying `1920x1080`), no thumbnail (a mic/system companion's own contract — the library
draws its empty placeholder), and `buildSourceVideo`'s new `capturedPicture` argument turns both
`mediaType` and `frameRate` to the audio companions' own answer: `'audio'`, `width: 0`, `height: 0`,
`frameRate: 0`, duration the recorder's own clock. Before this, a take with Screen and Webcam both
off and only the microphone on — which `recordReadiness.ts` allows — was the one shape
`companionPartFor` could never see, because a plain take's primary carries no `role` at all: it was
stored exactly like a screen recording, and ESCAPEARTIST placed it on a video track with a picture
that never came.
