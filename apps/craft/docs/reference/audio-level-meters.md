<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Audio level meters

Both recorders read their analysers on `requestAnimationFrame` and push an `AudioLevels` to the
store through `onAudioLevels`; `SourceToggles` draws the meters. **Both gate that to one sample
every 80 ms** (`AUDIO_LEVEL_INTERVAL_MS` in `webcodecs-recorder.ts`, `updateInterval` in
`recorder.ts`) — ~12.5 Hz, which is plenty for a meter and a twelfth of the cost. Ungated,
and back when `App` subscribed to the whole store, that was 60 whole-tree renders a second for
the length of a take.

Two more rules the WebCodecs recorder follows and `Recorder` does not yet:

- Each analyser is paired with the `Uint8Array` it reads into (`LevelMeter`), allocated once
  from `frequencyBinCount` — which never changes — and refilled in place, instead of a fresh
  typed array per source per sample.
- A take with **no** microphone and no system audio starts no monitor at all — there is no
  analyser to read, so the loop would only write a hard-coded `{ microphone: 0, system: 0 }`
  into the store for a meter that cannot move. It does send that value **once**, before
  returning. This one-shot predates ESCSUITE-114's fix below and is now belt-and-braces rather
  than load-bearing — the store already reads zero at the start of every take regardless — but
  it costs one store write per take, not per frame, so it stays rather than adding a branch to
  skip it.

Neither recorder's monitor ever emits a zero on its own once it has something real to measure —
it just keeps sending whatever it last read, for as long as the take runs. And `dispose()`,
which both cancel paths and the unmount teardown call instead of `stop()`, cancels the monitor's
`requestAnimationFrame` loop without emitting at all — so a cancel produced no zero of any kind
before ESCSUITE-114. `useRecordingController` now shares one `zeroAudioLevels()` helper, called
from every path that ends a take: the stop path (`onStop`, past the `cancelledRef.current` guard
— a stop that lands for a take already thrown away has nothing left to zero, since the cancel
that raised the flag already did), `handleCancelRecording`, `cancelCountdown`, and the unmount
teardown (which already reset `state` / `currentDuration` / `countdownValue` for the same
module-singleton-store reason and had omitted `audioLevels`). Whichever way a take ends, the
next one's meter — closed by `showMeters` for every state but `'countdown'` / `'recording'` /
`'paused'`, ESCSUITE-104 — never opens on a level the take before it left behind; `'countdown'`
is the state that matters here, since the recorder (and its monitor) is already initialize()d by
the time a countdown starts, before the meter has a reading of its own to show.

**`capturedThumbnailRef` follows the same rule (ESCSUITE-176).** `handleStopRecording` writes it
before `recorder.stop()` even resolves, and `useRecordingSave` is the only place that reads and
clears it — once a save actually runs. A take thrown away on any other path never reaches a save,
so without a matching clear there, the ref still held the thrown-away take's frame the next time
one was needed: a cancel followed by a take that ends on its own (the recorder's own `onStop` —
"Stop sharing" is exactly this, not a Stop click) read `capturedThumbnailRef.current` in
`useRecordingSave` and preferred it over decoding one from the new take's own blob, so the second
take was saved with the first take's picture. The same three paths that call `zeroAudioLevels()`
now also clear this ref: `handleCancelRecording`, `cancelCountdown`, and the unmount teardown.
`useRecordingController.test.ts`'s "audio levels" cases pin it: non-zero while a take is live,
zero after a stop asked for and one the recorder fired on its own, zero after each of the two
cancel paths, and zero already sitting there the moment the next take reaches `'countdown'`.

**A level push now costs the Sources panel and nothing else.** `App` selects each field it
reads and does not read `audioLevels` at all; `SourceTogglesPanel` owns the subscription and
hands the value to the props-only `SourceToggles` (see the App section above). Measured
2026-09-16 over 12 pushes, before → after: `App` 12 → 0 renders, `AppHeader` 12 → 0,
`RecordingsList` 12 → 0, `RecorderControls` 12 → 0, `RecordingPreview` 12 → 0, `SourceToggles`
12 → 12. `App.rerender.test.tsx` asserts those five as exact zeros — conservation, not a
ceiling: a component that does not subscribe re-renders never — and asserts that the meters
still draw the level `App` never handed them, so a panel that subscribed to nothing could not
pass by rendering zero times.

`webcodecsRecorder.perf.test.ts` and `recorder.perf.test.ts` assert all of this as counts —
at most 13 emissions per 60 animation frames in *both* files, so the two monitors cannot drift
apart again. `Recorder`'s per-sample analyser buffer is pinned there as a finding, with the
assertion to flip when it is hoisted.
