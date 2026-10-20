<!-- Moved verbatim from apps/craft/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# The PiP frame gate

Only Picture-in-Picture composites — including a separate-tracks take, which still draws the
overlay for the preview (`startPreviewOnly()`) while the recorder reads the raw tracks, so the
gate there bounds what the preview costs rather than what a `captureStream` throws away.
`Compositor.render` requests an animation frame every
frame — 60 a second on an ordinary display — and draws on a fraction of them, because
`canvas.captureStream(frameRate)` samples the canvas at the take's frame rate (30 by
default) and drawing faster is work thrown away.

**The gate is a deadline with a tolerance, not "has a frame interval elapsed since the last
draw".** That distinction is the whole of ESCSUITE-54, and it is worth keeping:

- `1000 / 30` is not merely close to two 60 Hz ticks, it is **bit-for-bit the same IEEE 754
  double** as `2 * (1000 / 60)` (`node -e "console.log((1000/30) === 2*(1000/60))"` → `true`).
  An elapsed-time gate therefore clears after two animation frames with *zero* margin, and
  fails the instant dispatch jitter puts either frame a nanosecond under ideal.
- Snapping the reference to the drawing frame's own `performance.now()` charges that miss
  forward instead of letting it cancel, so the loop settles into a mix of 33 ms and 50 ms
  gaps. Measured before the fix: **22.4–22.8 composited fps** against a 30 fps target, 2.63
  animation frames per composited frame.

So `render` holds `nextFrameDue`, draws when `now >= nextFrameDue - FRAME_TOLERANCE_MS`, and
advances `nextFrameDue` **by one frame interval from the schedule**, not from `now`. Two
decisions carry the design:

- `FRAME_TOLERANCE_MS = 4` — how early a tick may run a frame due on the next tick. It has
  to exceed real dispatch jitter and stay well under one 60 Hz tick (16.7 ms). **One test
  bounds it from both sides**: the `jittered` row of "never draws on two consecutive %s
  60Hz ticks", which runs the invariant over `JITTER_CYCLE_MS`. Below ~0.5 ms the tolerance
  stops absorbing the cycle's short pair and a second frame lands inside one
  `captureStream` window; at or above ~16.5 ms a tick a whole frame early qualifies. Both
  ends are red, so deleting the constant does not ship silently. The `evenly spaced` row of
  the same test bounds **nothing** — see the note below — and the jitter *count* test bounds
  nothing either: 60 jittered ticks draw exactly 30 frames at every tolerance from 0 to 20,
  because it is the schedule-based advance and not the tolerance that fixes the count.
- The **stall clamp**: if `now - nextFrameDue > frameInterval` the schedule is resynced to
  `now + frameInterval` instead of being advanced one interval at a time. Without it, a
  hidden tab or a long GC pause would come back owing fifteen frames and draw them back to
  back into a canvas nobody was sampling. Pinned by "resyncs after a stall instead of
  bursting to catch up" (which also goes red at a tolerance of 17 ms).

**What the gate guarantees, and what it only usually does.** The unconditional property —
the one to rely on — is that **the deadline advances a full interval per draw, so the mean
draw rate can never exceed the target**, whatever the tick spacing. "No two consecutive
ticks both draw" is weaker: it is exact for **evenly spaced** ticks (with `1000 / 30`
bit-for-bit `2 * (1000 / 60)`, "the last tick did not draw" and "this tick draws" are exact
complements, which is why that row of the test holds at any tolerance below one 60 Hz tick,
0 included — at 16.667 ms and above the base case breaks, `start()`'s draw and the first
loop tick both qualifying), but
under non-uniform jitter two adjacent ticks can both draw — measured at ±2 ms random
jitter: at most 2 in a row, sustained rate 30.11 fps. That is a cadence wobble, not a rate
breach, and it is why the mean-rate property is the one the design rests on.

`start()` sets `nextFrameDue = 0`, which is always in the past, so the first frame is drawn
immediately — `compositor.perf.test.ts` counts a second of 60 Hz ticks as exactly
`TARGET_FPS + 1` draws for that reason.
