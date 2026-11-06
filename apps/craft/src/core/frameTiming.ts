/**
 * The per-encoder half of `WebCodecsRecorder`'s frame timing: given how far
 * the recording clock has run when a frame is captured, the timestamp it is
 * encoded with and whether it is a key frame — or that it is dropped. The
 * clock itself (audio-context or `performance.now()` time, pauses excluded) is
 * the recorder's; see `nextFrameTiming()` there and
 * `docs/reference/frame-timestamps-and-keyframes.md`.
 *
 * **One 30 fps slot per frame (ESCSUITE-417).** The recorder declares its
 * frame rate to Mediabunny's `addVideoTrack`, and Mediabunny's WebM muxer
 * snaps every timestamp to that grid (`roundToDivisor(t, frameRate)`). Two
 * frames captured inside one slot came out on one timecode, and when the
 * second was a key frame the muxer could not start a Cluster on it — the
 * Cluster in progress already held that timecode — so it sat mid-Cluster with
 * no cue, and Chromium never completed a seek past it (ESCSUITE-412). So:
 *
 * - a frame whose own slot is free keeps its own timestamp;
 * - a frame captured inside the slot of the frame before it goes into the
 *   next slot, stamped at that slot's own time — it is shown one slot (33 ms)
 *   late, never more;
 * - a frame whose own slot is behind the last one used is **dropped**: the
 *   slot after the last one is more than one slot past its capture, and
 *   moving it there would let a run of collisions (a source faster than
 *   30 fps, the clock pulled back by an audio-context refresh) push the video
 *   ever further ahead of its sound. A 30 fps track has no room for it.
 *
 * Distinct slots are distinct millisecond timecodes, so no two frames of a
 * take share one. Timestamps also stay strictly increasing, which is what
 * `VideoEncoder` and Mediabunny need.
 */

/**
 * One encoder's bookkeeping. Per encoder, because each is fed its own
 * timeline and owes its own viewer a key frame once a second; sharing it would
 * have two interleaved pipelines take each other's slots and key frames.
 */
export interface FrameTiming {
  /** The slot of the last frame handed to this encoder; -1 before the first. */
  lastSlot: number;
  /** Recording-clock microsecond mark at which this encoder's next key frame is due. */
  nextKeyFrameUs: number;
}

export function newFrameTiming(): FrameTiming {
  return { lastSlot: -1, nextKeyFrameUs: 0 };
}

/**
 * The slot Mediabunny's muxer puts a timestamp in, as an index on the
 * `frameRate` grid — its own arithmetic (`Math.round(seconds * frameRate)`).
 */
export function frameSlot(timestampUs: number, frameRate: number): number {
  return Math.round((timestampUs / 1e6) * frameRate);
}

/** The microsecond timestamp of a slot itself. */
function slotTimestampUs(slot: number, frameRate: number): number {
  return Math.round((slot * 1e6) / frameRate);
}

/**
 * Stamp the frame captured `elapsedUs` into the recording, or `null` to drop
 * it (see the module comment). Advances `timing` only for a frame it stamps.
 * A key frame once per elapsed second: the first frame stamped at or past
 * `nextKeyFrameUs`, the first of a take always one.
 */
export function stampFrame(
  timing: FrameTiming,
  elapsedUs: number,
  frameRate: number
): { timestamp: number; keyFrame: boolean } | null {
  // A context clock extrapolated a hair behind start() must not stamp below 0.
  const capturedUs = Math.max(0, Math.round(elapsedUs));
  const ownSlot = frameSlot(capturedUs, frameRate);
  let timestamp: number;
  if (ownSlot > timing.lastSlot) {
    timestamp = capturedUs;
    timing.lastSlot = ownSlot;
  } else if (ownSlot === timing.lastSlot) {
    timing.lastSlot = ownSlot + 1;
    timestamp = slotTimestampUs(timing.lastSlot, frameRate);
  } else {
    return null;
  }

  const keyFrame = timestamp >= timing.nextKeyFrameUs;
  if (keyFrame) {
    timing.nextKeyFrameUs = timestamp + 1_000_000;
  }
  return { timestamp, keyFrame };
}
