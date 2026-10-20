<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Black Flash Prevention (`src/core/elementFrames.ts`, `src/core/canvasRenderer.ts`)
To prevent black frames during export:
- **Seek timeout**: 500ms for reliable seeking. One-shot, and since ESCSUITE-159 the two
  halves cancel each other the way the readiness wait's do: the `'seeked'` listener clears
  the fallback, and the fallback removes the listener. A seek that landed used to leave the
  timer pending for the rest of its half-second, to resolve a promise that had already
  settled — one per seeked frame, for a whole export's worth of frames — and a fallback that
  won used to leave its `{ once: true }` listener on an element whose object URL the export
  is about to revoke
- **Frame readiness**: the element-drawing frame composer (`elementFrames.ts`'s
  `syncVideoToTime`, which `exportWebM.ts` had inline until ESCSUITE-34) waits for
  `video.readyState >= 2`
  (`HAVE_CURRENT_DATA`), event-based with a `requestAnimationFrame` poll and a 300ms fallback.
  The two halves cancel each other (ESCSUITE-156): whichever settles the wait stops the other
  — `cancelAnimationFrame` on the outstanding poll handle when the fallback fires,
  `clearTimeout` on the fallback when the frame data arrives first. The poll used to keep
  re-queueing itself after the fallback had already resolved the wait, so a source that never
  reaches `HAVE_CURRENT_DATA` cost an animation frame per frame **for the life of the page**,
  long after the export that started it finished
- **Post-seek verification**: Always waits for frame data after successful seek
- **A seek that never completes fails by name, never as a black file** (ESCSUITE-305): Firefox
  wedges for good on a seek into a Cues-less WebM — no `'seeked'`, `seeking` stays true,
  `readyState` stays 1, for that element and a fresh one alike — so each frame sat out both
  fallbacks, the `readyState >= 2` gate skipped the draw, and a WebM or GIF export of an
  ESCAPECRAFT PiP take finished "Export complete!" at 0.8 s a frame with a black picture
  (measured: `{"seeked":31,"seekFallback":434,"readyFallback":434,"readyOk":0,"drawn":32}` over
  466 frames). Three consecutive wedged seeks of one element (`WEDGED_SEEK_FRAMES`) now throw
  `SourceNotSeekableError`, surfaced as `ExportError` `code: 'SOURCE_NOT_SEEKABLE'`; the dialog
  shows its message as it does any `ExportError`'s but offers **no other video format** for it
  — neither WebM's "Try MP4 Instead" nor MP4's failure screen and "Try WebM Instead" — because
  the other format draws from the same `<video>` and wedges the same way (review round 1); and
  the headless kit maps the code to a permanent failure (exit 2 / 400). What counts is an
  element still `seeking` with no frame once a request's waits are over, and the count resets
  whenever a request starts over an element no longer seeking, or ends with a landed seek or a
  frame to draw. So a seek still in flight over a frame it can already draw is not counted; a
  seek that settles late, after the fallbacks, counts for its own request and is cleared by the
  next one's start — a slow machine whose seeks land between requests is never refused (a new
  seek aborts the one in flight, so an element whose every seek outlasts the waits plus the gap to
  the next request — about 800 ms on WebM/GIF, 600 ms on MP4 — stays `seeking` across three
  requests and is refused; those frames could not have been drawn either way, since the draw
  needs `readyState >= 2`); a fallback over an element that stopped seeking but has no frame yet
  leaves the count alone; and a request held at one time over a seek still outstanding counts
  after a wait: on the MP4 path the same 500 ms `seeked` wait plus 100 ms readiness wait a seek
  gets, on the WebM/GIF path the composer's 300 ms readiness wait alone (no seek is issued, so
  no `seeked` wait) — the rule is the same, the slack per held request differs. The measured
  wedge keeps `seeking` true for good, so it is refused on its third request. The counter is
  two integer compares per request; the perf ceilings are unchanged. The cure for the file itself is "Seek
  index repair at import"; this is what a source that was never repaired (stored before the
  repair, or a remux that failed) gets on Firefox
- **Transition safety**: `drawTransition()` (`canvasRenderer.ts`) warns when a transition's video
  is below `readyState >= 1` — "forgiving" on purpose, per its own comment, to match the preview
  player's threshold rather than the frame loop's stricter `>= 2`
