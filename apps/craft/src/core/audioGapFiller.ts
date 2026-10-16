/**
 * Silence for the audio buffers a `ScriptProcessorNode` never delivered
 * (ESCSUITE-296).
 *
 * `WebCodecsRecorder` stamps each audio pipeline by counting the samples
 * `onaudioprocess` hands it. A callback that never reaches the page — the main
 * thread was still busy with the last one, which is when Chromium drops it —
 * used to take its 4096 samples out of that count for good: 85.3 ms per loss,
 * and every later sound stamped that much before its picture. Each callback's
 * `playbackTime` is the context time of its buffer, so a gap between where the
 * last buffer ended and where this one starts *is* the lost audio, and filling
 * it with zero-valued `AudioData` keeps the count equal to context time.
 *
 * One helper for the mix and every audio companion, each with its own
 * instance — the arithmetic is the same and one copy cannot drift from
 * another.
 *
 * An event with no `playbackTime` (an engine that omits it; every test suite
 * written before this) takes exactly the old path: nothing is filled and
 * nothing is allocated.
 */

/**
 * The most silence one gap is filled with. A gap this long is not a dropped
 * callback but a stalled device (an output switching, a sink restarting);
 * encoding minutes of silence for it would be worse than the step it leaves.
 */
export const MAX_GAP_FILL_SECONDS = 5;

export interface AudioGapFiller {
  /**
   * Forget where the next buffer is expected, so the next one is taken as
   * given: at `start()`, and at every resume — the callbacks dropped while a
   * take is paused are the pause, not a loss.
   */
  reanchor(): void;
  /**
   * Called with each delivered buffer, before it is encoded. Encodes silence
   * for every sample between the end of the last buffer and `playbackTime`,
   * stamped contiguously from `timestampUs`, and returns the timestamp the
   * delivered buffer is to carry.
   */
  fill(playbackTime: number | undefined, numberOfFrames: number, timestampUs: number): number;
}

export interface AudioGapFillerOptions {
  /** The context's real rate — the rate the pipeline's AudioData carry. */
  sampleRate: number;
  /** The ScriptProcessorNode's buffer size: silence is encoded in chunks of it. */
  bufferLength: number;
  numberOfChannels: number;
  /** Names the pipeline in the one warning a capped fill gives. */
  label: string;
  /** Hand one AudioData to the pipeline's encoder. The filler closes it. */
  encode: (data: AudioData) => void;
}

export function createAudioGapFiller(options: AudioGapFillerOptions): AudioGapFiller {
  const { sampleRate, bufferLength, numberOfChannels, label, encode } = options;
  const halfBufferSeconds = bufferLength / sampleRate / 2;
  const maxFillFrames = Math.round(MAX_GAP_FILL_SECONDS * sampleRate);
  // Context time, in seconds, at which the next buffer should start; null
  // until a buffer has been seen since start() or the last resume.
  let expected: number | null = null;
  // One zero buffer, made on the first fill and reused for every chunk after:
  // `AudioData` copies what it is given.
  let zeros: Float32Array<ArrayBuffer> | null = null;
  let warned = false;

  return {
    reanchor() {
      expected = null;
    },

    fill(playbackTime, numberOfFrames, timestampUs) {
      if (typeof playbackTime !== 'number') return timestampUs;
      const previous = expected;
      // Before any encode, so an encoder that throws below does not have the
      // next callback fill the same gap again.
      expected = playbackTime + numberOfFrames / sampleRate;
      if (previous === null || playbackTime - previous < halfBufferSeconds) return timestampUs;

      let missing = Math.round((playbackTime - previous) * sampleRate);
      if (missing > maxFillFrames) {
        if (!warned) {
          warned = true;
          console.warn(
            `${label} audio stalled for ${(playbackTime - previous).toFixed(1)} s; ` +
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
