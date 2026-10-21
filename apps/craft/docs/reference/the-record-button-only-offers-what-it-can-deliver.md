<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# The record button only offers what it can deliver

`RecorderControls` takes a `blockedReason: string | null`. Non-null and the record button
loses its handler, goes `disabled`, puts the reason in its `title`, and prints it under the
bar as the button's `aria-describedby` target — the same "say why" shape the Sources rows
already use. `App` computes it once with `recordBlockedReason()`
(`src/utils/recordReadiness.ts`) and hands the same answer to `useKeyboardShortcuts` as
`canRecord`, so **R and the button always agree**.

It blocks for three reasons:

1. **Capability detection has not landed.** The store's `capabilities` start all-false
   while `detectCapabilities()` resolves, so an early click used to reach
   `acquireStreams()`, take no branch, hand the recorder nothing and die in a
   `console.error`. `capabilitiesReady` is false until detection answers — and is raised
   on a detection *failure* too, so the button never sits on "Checking…" forever. (With
   the capabilities left all-false it stays disabled, but for reason 2, with a sentence
   that says what is actually wrong.)
2. **Nothing enabled is actually capturable** — every toggle off, or every enabled toggle
   pointing at a capability this browser lacks. The three sources counted are exactly the
   three `acquireStreams()` asks for, each gated on "the toggle AND the capability".
   **System audio is deliberately not one of them**: it is not requested separately, it
   rides on the screen capture, so a "system audio only" take captures nothing at all.
3. **There is nowhere to put the take** — `hasStorageSpace` in the store.

**Nothing may be awaited between the click and `getDisplayMedia`.** That is why reason 3
is a store flag rather than a check inside `handleStartRecording`: the capture request
needs the click's user activation, an `await` in front of it can spend that activation
(WebKit forwards a gesture across promises only briefly), and the `NotAllowedError` that
follows would be a failure the user never caused. `refreshStorageSpace()` — a store action
that never rejects — measures it **off** the click path: on mount
(`useCapabilityBootstrap`), after every save (`.finally` on the save chain, since a take
that failed took no room either), and after every delete (`useRecordingLibrary`, because
deleting is the remedy the blocked button recommends). The comment in
`handleStartRecording` marking the no-await stretch is load-bearing; keep it.

`hasSpaceForRecording()` itself (`core/storage.ts`) **errs toward letting you record**, in
both directions it can be wrong:

- a quota of `0` is *unknown*, not *full* — reading it as full refused every take in any
  browser without `navigator.storage`, jsdom included, which is why the helper was dead
  code for so long;
- the bar is the **lower** of `estimate + 50MB buffer` and a quarter of the reported quota,
  so a private or ephemeral profile with an 80MB quota is not told to "delete a recording"
  in a window that has nothing stored.

A missed warning ends with IndexedDB reporting its own quota error at save time, which the
save path already surfaces; a false "no space" refuses the take outright with advice the
user cannot act on. Only the first of those is recoverable.

**During the 3-2-1 countdown the button cancels, not stops** (ESCSUITE-106). `recorder.stop()`
is a no-op before `start()` — both recorders check `isRecordingActive` first — so a button that
kept reading "Stop recording" and calling `onStop` for `countdown` did nothing when clicked:
the ticker kept running and the take began anyway. `RecorderControls`' record button now checks
`state` before `isRecordingActive`: `idle` starts, `countdown` calls the same `onCancel` App
already passes it (`cancelCountdown`, via the ternary in `App.tsx`'s JSX), and only `recording` /
`paused` call `onStop`. The button's accessible name and title become "Cancel countdown" for
that one state, so it, Escape and the bar's own neighbouring Cancel button all agree on what
happens to a countdown. No new prop was needed — `onCancel` already carried the right function
for `countdown`, `RecorderControls` just wasn't using it for the big button.
