/**
 * How long a library waveform's peaks last (ESCSUITE-403).
 *
 * `extractWaveformData` makes 100 peaks a second nominally, but a peak is
 * `peakBuckets`' bucket of samples over the rate the track was decoded at:
 * q − 1 samples (q = sampleRate / 100) for a track that is not a whole number
 * of buckets long, q for one that is. So a peak lasts 0.01 − 1/sampleRate or
 * 0.01 s, and which depends on the rate and the exact length. Read as 10 ms,
 * or as one fixed rate's bucket, the peaks drift against the media: 16 kHz
 * peaks read as 48 kHz ones put a pause 590 s in 2.5 s late.
 *
 * Peaks made since this ticket carry their own length
 * (`SourceVideo.waveformSecondsPerPeak`), which is exact. Peaks made before it
 * do not, and the rate they were decoded at was not kept (the track's own
 * rate, or the output device's when `decodeAudioData` decoded them), so their
 * length is only known to lie in a range: from a bucket one sample short at
 * the lowest rate any of those paths produces (`LOWEST_SAMPLE_RATE`) to a
 * whole 10 ms. Anything that must not misplace sound (silence detection)
 * reads the range; anything that only draws (the timeline's waveform,
 * ESCSUITE-418) can read `estimate`.
 *
 * One helper, so the cut and the drawing read peaks the same way.
 */

import type { SourceVideo } from '../store/types';

/** The peaks a second `extractWaveformData` makes nominally. */
export const NOMINAL_PEAKS_PER_SECOND = 100;

/**
 * The lowest sample rate peaks without a recorded length are assumed to have
 * been decoded at. 8 kHz is the lowest rate the codecs ESCAPEARTIST imports
 * are used at (narrowband speech) and the lowest an output device runs at.
 */
export const LOWEST_SAMPLE_RATE = 8_000;

/**
 * A recorded length outside this is not one an extractor wrote (a hand-edited
 * file, say), and is ignored as if absent. Every rate from 3 kHz up lands in it.
 */
const PLAUSIBLE_SECONDS_PER_PEAK = { min: 0.009, max: 0.0101 };

/** How long a source's peaks last, in seconds of source. */
export interface PeakTiming {
  /** The shortest a peak can last. */
  min: number;
  /** The longest a peak can last; `min` itself when the timing is exact. */
  max: number;
  /** The best single guess, for drawing: exact when `min === max`. */
  estimate: number;
  /** Whether the source recorded its peaks' length, so `min === max`. */
  exact: boolean;
}

/** Peaks with no recorded length: a bucket one sample short at the lowest rate, to a whole 10 ms. */
const LEGACY_TIMING: PeakTiming = {
  min: 1 / NOMINAL_PEAKS_PER_SECOND - 1 / LOWEST_SAMPLE_RATE,
  max: 1 / NOMINAL_PEAKS_PER_SECOND,
  // The commonest case before the ticket: 479 samples at 48 kHz, every
  // CRAFT WebM (Opus is 48 kHz only) and most AAC.
  estimate: 1 / NOMINAL_PEAKS_PER_SECOND - 1 / 48_000,
  exact: false,
};

/** How long `source`'s peaks last: exact when it recorded their length, a range otherwise. */
export function peakTimingOf(source: Pick<SourceVideo, 'waveformSecondsPerPeak'>): PeakTiming {
  const recorded = source.waveformSecondsPerPeak;
  if (
    typeof recorded === 'number' &&
    recorded >= PLAUSIBLE_SECONDS_PER_PEAK.min &&
    recorded <= PLAUSIBLE_SECONDS_PER_PEAK.max
  ) {
    return { min: recorded, max: recorded, estimate: recorded, exact: true };
  }
  return LEGACY_TIMING;
}
