/**
 * Silence for the audio buffers a `ScriptProcessorNode` never delivered
 * (ESCSUITE-296).
 *
 * `WebCodecsRecorder` stamps each audio pipeline by counting the samples
 * `onaudioprocess` hands it. A callback that never reaches the page used to
 * take its 4096 samples out of that count for good: 85.3 ms per loss, and
 * every later sound stamped that much before its picture.
 *
 * **The rule.** The filler anchors on the first event's `playbackTime` after
 * `start()` or a resume and from then on counts the samples it has seen, so
 * each event has an *offset*: its `playbackTime` minus where the count says
 * this buffer should start. It fills only when the **smallest** offset over the
 * last `GAP_WINDOW` (8, about 0.7 s) events is at least half a buffer, and then
 * with that offset rounded to whole buffers.
 *
 * **Why a windowed minimum, not each event's own gap.** Blink and WebKit are
 * recalled (review round 1; not measured) to compute `playbackTime` when the
 * main thread *dispatches* the event, not from the buffer's position. A
 * callback that is merely late then carries a later time — a gap that is not
 * one — and the callbacks queued behind a main-thread hang arrive back to back
 * with about the same time. Filling each event's own gap turned that jitter
 * into seconds of inserted silence per minute of jank: the same growing drift,
 * with the audio lagging instead. A dispatch delay is never negative, so it
 * lifts single offsets and the minimum ignores it; a lost buffer moves *every*
 * later offset up by one buffer, so the minimum sees it. Two more guards:
 * - a window whose `playbackTime`s span less than half its nominal length is a
 *   burst queued behind a hang (its offsets fall one buffer per event as the
 *   queue drains), and is not judged at all;
 * - a minimum below zero means the anchor itself came from a late event, so
 *   the anchor follows it down — otherwise a later loss would read as 85 ms
 *   less than it is.
 * After a fill the window starts again, so only events that came after it
 * judge the next one. The cost: a fill lands up to 8 callbacks after its loss,
 * so the audio in between is 85 ms early for about 0.7 s. And the filler is equally right if
 * `playbackTime` is the buffer's exact position, where every offset is 0.
 *
 * One helper for the mix and every audio companion, each with its own
 * instance — the arithmetic is the same and one copy cannot drift from
 * another. An event with no `playbackTime` (an engine that omits it; every test
 * suite written before this) takes exactly the old path: nothing is filled and
 * nothing is allocated.
 */

/**
 * The most silence one fill encodes. A persistent offset this large is not a
 * dropped callback; encoding minutes of silence for it would be worse than the
 * step it leaves, so the rest of it is taken into the anchor and stays a step.
 */
export const MAX_GAP_FILL_SECONDS = 5;

/** Events whose smallest offset decides a fill — about 0.7 s of 4096-sample buffers at 48 kHz. */
export const GAP_WINDOW = 8;

export interface AudioGapFiller {
  /**
   * Forget the anchor, the count and the window, so the next buffer is taken
   * as given: at `start()`, and at every resume — the callbacks dropped while a
   * take is paused are the pause, not a loss.
   */
  reanchor(): void;
  /**
   * Called with each delivered buffer, before it is encoded. Encodes the
   * silence the window has proved was lost, stamped contiguously from
   * `timestampUs`, and returns the timestamp the delivered buffer is to carry.
   */
  fill(playbackTime: number | undefined, numberOfFrames: number, timestampUs: number): number;
}

export interface AudioGapFillerOptions {
  /** The context's real rate — the rate the pipeline's AudioData carry. */
  sampleRate: number;
  /** The ScriptProcessorNode's buffer size: silence is encoded in whole buffers of it. */
  bufferLength: number;
  numberOfChannels: number;
  /** Names the pipeline in the one warning a capped fill gives. */
  label: string;
  /** Hand one AudioData to the pipeline's encoder. The filler closes it. */
  encode: (data: AudioData) => void;
}

export function createAudioGapFiller(options: AudioGapFillerOptions): AudioGapFiller {
  const { sampleRate, bufferLength, numberOfChannels, label, encode } = options;
  const bufferSeconds = bufferLength / sampleRate;
  const maxFillBuffers = Math.floor(MAX_GAP_FILL_SECONDS / bufferSeconds);
  const minWindowSpan = ((GAP_WINDOW - 1) * bufferSeconds) / 2;
  // The window, as two rings: each event's offset and its playbackTime.
  // Allocated once; nothing per callback.
  const offsets = new Float64Array(GAP_WINDOW);
  const times = new Float64Array(GAP_WINDOW);
  let size = 0;
  let next = 0;
  // Context seconds the count is measured from; null until an event is seen
  // since start() or the last resume.
  let anchor: number | null = null;
  // Frames since the anchor: delivered plus filled.
  let counted = 0;
  // One zero buffer, made on the first fill and reused for every buffer of
  // silence after: `AudioData` copies what it is given.
  let zeros: Float32Array<ArrayBuffer> | null = null;
  let warned = false;


  return {
    reanchor() {
      anchor = null;
      counted = 0;
      size = 0;
      next = 0;
    },

    fill(playbackTime, numberOfFrames, timestampUs) {
      if (typeof playbackTime !== 'number') return timestampUs;
      anchor ??= playbackTime;
      offsets[next] = playbackTime - (anchor + counted / sampleRate);
      times[next] = playbackTime;
      next = (next + 1) % GAP_WINDOW;
      size = Math.min(size + 1, GAP_WINDOW);
      counted += numberOfFrames;

      // Full, `next` is the oldest slot and the one before it the newest.
      if (size < GAP_WINDOW) return timestampUs;
      if (times[(next + GAP_WINDOW - 1) % GAP_WINDOW] - times[next] < minWindowSpan) {
        return timestampUs;
      }
      let min = offsets[0];
      for (let i = 1; i < GAP_WINDOW; i++) min = Math.min(min, offsets[i]);
      if (min < 0) {
        anchor += min;
        for (let i = 0; i < GAP_WINDOW; i++) offsets[i] -= min;
        return timestampUs;
      }
      if (min < bufferSeconds / 2) return timestampUs;

      let buffers = Math.round(min / bufferSeconds);
      if (buffers > maxFillBuffers) {
        if (!warned) {
          warned = true;
          console.warn(
            `${label} audio fell ${min.toFixed(1)} s behind; filling ${MAX_GAP_FILL_SECONDS} s of it with silence`
          );
        }
        anchor += min - maxFillBuffers * bufferSeconds;
        buffers = maxFillBuffers;
      }
      counted += buffers * bufferLength;
      // Start the window again. The events from before the loss describe a
      // count that no longer exists: kept, they would read as a late anchor
      // and pull it down by a buffer, and the next window would fill the
      // same loss a second time.
      size = 0;
      next = 0;

      zeros ??= new Float32Array(bufferLength * numberOfChannels);
      let timestamp = timestampUs;
      for (let i = 0; i < buffers; i++) {
        const data = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: bufferLength,
          numberOfChannels,
          timestamp,
          data: zeros,
        });
        try {
          encode(data);
        } finally {
          data.close();
        }
        timestamp += bufferSeconds * 1_000_000;
      }
      return timestamp;
    },
  };
}
