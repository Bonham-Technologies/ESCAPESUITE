/**
 * Silence for the audio a `ScriptProcessorNode` never delivered
 * (ESCSUITE-296).
 *
 * `WebCodecsRecorder` stamps each audio pipeline by counting the samples
 * `onaudioprocess` hands it. Content the page never receives used to come out
 * of that count for good: every later sound stamped that much before its
 * picture, a drift that grew with the take.
 *
 * **What was measured** (the ESCSUITE-296 rig, headless Chromium 156,
 * 2026-10; `scratchpad/report-drift-measure.md` in that work):
 * - `playbackTime` is computed when the main thread *dispatches* the event,
 *   not from the buffer's position: under jank it sits one buffer ahead of
 *   `currentTime` from p5 to p95, and its offset from the sample count tracks
 *   dispatch lateness with r = 1.00, slope 0.99.
 * - A real loss arrives as **creep of one 128-sample render quantum at a
 *   time** (2.67 ms at 48 kHz), not as a dropped 4096-sample buffer: on a 60 s
 *   take under 60 ms-per-100 ms jank the floor of that offset rose ~43 ms over
 *   the minute, and the A/V markers drifted −41 ms with it.
 * - So **whole-buffer rules miss it**: the largest rolling minimum was 80 ms
 *   over 8 callbacks and 58.7 ms over 24, under the 0.95-buffer threshold one
 *   round of this fix used — while a half-buffer threshold (the round before)
 *   filled a buffer that was never lost, because lateness above half a buffer
 *   can be sustained with no loss at all. And counting each event's own gap
 *   (the first round) read +87, −25 and −33 lost callbacks on takes that lost
 *   0, 0 and 1.
 *
 * **The rule — fill the rise in the baseline deficit, in render quanta.**
 * Each event has a *deficit*: its reference time minus the samples delivered
 * since the anchor, in seconds. The reference is the event's own
 * `playbackTime` (every engine sends it; that it is read at dispatch is
 * harmless, because only minimums are used), else the context's `currentTime`
 * read in the callback — the same dispatch-time reading — else there is none
 * and the event takes the old path untouched (what keeps
 * `webcodecsRecorder.perf.test.ts` exact). Lateness only ever *raises* a
 * deficit, so the **baseline** — the minimum over a window of the last
 * `GAP_WINDOW_MIN_EVENTS` (8) events or `GAP_WINDOW_SECONDS` (4 s) of them,
 * whichever is more — ignores it, while lost content raises it for good. The
 * first full window's baseline is the **anchor**, so a constant dispatch
 * latency is never filled. From then on, a baseline two quanta or more above
 * the anchor is filled with all but one of those quanta, as zero-valued
 * `AudioData` stamped contiguously before the delivered buffer, and the anchor
 * rises by what was filled.
 *
 * Why those numbers, measured on the rig's real log and on simulations
 * (`scratchpad/dbg296/q2.py`): a 2 s window over-filled the real take by
 * 16 ms (a transient rise of its rolling minimum that later fell back), 4 s
 * matched it; and filling every quantum the moment it shows filled a few ms
 * of pure jitter over ten minutes, where leaving the last quantum filled none
 * — the residual it leaves is under 2 quanta (5.3 ms) and never accumulates.
 * A window whose reference times span under half its nominal length is a
 * burst queued behind a hang (its deficits fall back to the floor as the
 * queue drains) and is not judged at all. A fill lands a window after the loss
 * it fills.
 *
 * One fill is capped at `MAX_GAP_FILL_SECONDS` (5 s) with one warning per
 * pipeline; the rest of such a rise stays a step. One helper for the mix and
 * every audio companion, each with its own instance.
 */

/** The Web Audio render quantum, in frames. Fixed by the spec. */
export const RENDER_QUANTUM = 128;

/** The most silence one fill encodes; the rest of the rise stays a step. */
export const MAX_GAP_FILL_SECONDS = 5;

/** The window is at least this many events... */
export const GAP_WINDOW_MIN_EVENTS = 8;
/** ...and at least this many seconds of them: 47 events of 4096 at 48 kHz. */
export const GAP_WINDOW_SECONDS = 4;

/** Events in the window for a pipeline at this rate and buffer size. */
export function gapWindowEvents(sampleRate: number, bufferLength: number): number {
  return Math.max(GAP_WINDOW_MIN_EVENTS, Math.ceil((GAP_WINDOW_SECONDS * sampleRate) / bufferLength));
}

export interface AudioGapFiller {
  /**
   * Forget the anchor, the count and the window, so the next window sets a
   * new anchor: at `start()`, and at every resume — what the page did not see
   * while a take was paused is the pause, not a loss.
   */
  reanchor(): void;
  /**
   * Called with each delivered buffer, before it is encoded. Encodes the
   * silence the baseline has proved was lost, stamped contiguously from
   * `timestampUs`, and returns the timestamp the delivered buffer is to carry.
   */
  fill(playbackTime: number | undefined, numberOfFrames: number, timestampUs: number): number;
}

export interface AudioGapFillerOptions {
  /** The context's real rate — the rate the pipeline's AudioData carry. */
  sampleRate: number;
  /** The ScriptProcessorNode's buffer size: silence is encoded in chunks of at most this. */
  bufferLength: number;
  numberOfChannels: number;
  /** Names the pipeline in the one warning a capped fill gives. */
  label: string;
  /** The context's `currentTime`, for an event with no `playbackTime`. */
  readCurrentTime: () => number | undefined;
  /** Hand one AudioData to the pipeline's encoder. The filler closes it. */
  encode: (data: AudioData) => void;
}

export function createAudioGapFiller(options: AudioGapFillerOptions): AudioGapFiller {
  const { sampleRate, bufferLength, numberOfChannels, label, readCurrentTime, encode } = options;
  const bufferSeconds = bufferLength / sampleRate;
  const quantumSeconds = RENDER_QUANTUM / sampleRate;
  const maxFillFrames = Math.floor((MAX_GAP_FILL_SECONDS * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM;
  const windowEvents = gapWindowEvents(sampleRate, bufferLength);
  const minWindowSpan = ((windowEvents - 1) * bufferSeconds) / 2;
  // The window, as two rings: each event's deficit and its reference time.
  // Allocated once; nothing per callback.
  const deficits = new Float64Array(windowEvents);
  const times = new Float64Array(windowEvents);
  let size = 0;
  let next = 0;
  // Frames delivered since start() or the last resume.
  let delivered = 0;
  // The baseline deficit nothing has been lost from; null until the first
  // full window.
  let anchor: number | null = null;
  // One zero buffer, made on the first fill and reused for every chunk of
  // silence after: `AudioData` copies what it is given.
  let zeros: Float32Array<ArrayBuffer> | null = null;
  let warned = false;

  return {
    reanchor() {
      anchor = null;
      delivered = 0;
      size = 0;
      next = 0;
    },

    fill(playbackTime, numberOfFrames, timestampUs) {
      const reference = typeof playbackTime === 'number' ? playbackTime : readCurrentTime();
      if (typeof reference !== 'number') return timestampUs;
      deficits[next] = reference - delivered / sampleRate;
      times[next] = reference;
      next = (next + 1) % windowEvents;
      size = Math.min(size + 1, windowEvents);
      delivered += numberOfFrames;

      // Full, `next` is the oldest slot and the one before it the newest.
      if (size < windowEvents) return timestampUs;
      if (times[(next + windowEvents - 1) % windowEvents] - times[next] < minWindowSpan) {
        return timestampUs;
      }
      let baseline = deficits[0];
      for (let i = 1; i < windowEvents; i++) baseline = Math.min(baseline, deficits[i]);
      if (anchor === null) {
        anchor = baseline;
        return timestampUs;
      }
      // All but the last quantum of the rise (the 0.05 absorbs float error on
      // what are whole quanta).
      const quanta = Math.floor((baseline - anchor) / quantumSeconds + 0.05) - 1;
      if (quanta <= 0) return timestampUs;
      anchor += quanta * quantumSeconds;

      let missing = quanta * RENDER_QUANTUM;
      if (missing > maxFillFrames) {
        if (!warned) {
          warned = true;
          console.warn(
            `${label} audio fell ${(missing / sampleRate).toFixed(1)} s behind; ` +
              `filling ${MAX_GAP_FILL_SECONDS} s of it with silence`
          );
        }
        missing = maxFillFrames;
      }

      zeros ??= new Float32Array(bufferLength * numberOfChannels);
      let timestamp = timestampUs;
      while (missing > 0) {
        const frames = Math.min(missing, bufferLength);
        const data = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels,
          timestamp,
          data: zeros.subarray(0, frames * numberOfChannels),
        });
        try {
          encode(data);
        } finally {
          data.close();
        }
        timestamp += (frames / sampleRate) * 1_000_000;
        missing -= frames;
      }
      return timestamp;
    },
  };
}
