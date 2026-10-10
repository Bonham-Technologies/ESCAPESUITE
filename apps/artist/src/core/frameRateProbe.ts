// Measuring a source's frame rate from the frames its own <video> presents
// (ESCSUITE-276).
//
// Before this, every imported video was stored at `frameRate: 30` — a
// placeholder nothing ever replaced — so anything that read the field (the
// in-page decoder's seek window first among them) was reading a constant.
// Containers do not answer the question through any API a page can reach, but
// the element does: `requestVideoFrameCallback` reports each presented frame's
// `mediaTime`, and the spacing between them is the rate.

/** How long the import-time probe may play: eight frames or 400 ms, whichever first. */
export const FRAME_RATE_PROBE = { maxFrames: 8, maxMs: 400 } as const;

export interface FrameRateProbeOptions {
  /** Stop once this many frames have been presented. */
  maxFrames: number;
  /** Stop after this long whatever has been presented. */
  maxMs: number;
}

/**
 * The broadcast rates a measured value is snapped to, each beside the exact
 * 1000/1001 rate it names. A measurement is noisy in the third decimal, and a
 * 29.97 source should be stored as 29.97, not as 29.96 or 29.98.
 */
const NTSC_RATES: ReadonlyArray<{ label: number; exact: number }> = [
  { label: 23.976, exact: 24000 / 1001 },
  { label: 29.97, exact: 30000 / 1001 },
  { label: 59.94, exact: 60000 / 1001 },
];

/** How close, relative to the NTSC rate, a measurement must be to snap to it. */
const SNAP_TOLERANCE = 0.006;

/**
 * Snap to an NTSC rate within 0.6 % of it, else round to two decimals.
 *
 * 0.6 % is wider than the 0.1 % between each NTSC rate and its whole-number
 * neighbour (23.976 / 24, 29.97 / 30, 59.94 / 60), so a measurement must also
 * be nearer the NTSC rate than the whole number for it to snap — otherwise a
 * 24 or 30 fps source would be stored as 23.976 or 29.97.
 */
function snapFrameRate(rate: number): number {
  for (const { label, exact } of NTSC_RATES) {
    const offNtsc = Math.abs(rate - exact);
    if (offNtsc <= exact * SNAP_TOLERANCE && offNtsc < Math.abs(rate - Math.round(exact))) {
      return label;
    }
  }
  return Math.round(rate * 100) / 100;
}

/**
 * The frame rate a run of presented frames' `mediaTime`s implies: one over the
 * median spacing between consecutive frames, snapped by `snapFrameRate`. The
 * median rather than the mean so a dropped frame — one spacing two frames wide
 * — does not move the answer. Fewer than three frames (fewer than two
 * spacings), or spacings that are not a rate at all, answer `undefined`.
 */
export function rateFromMediaTimes(mediaTimes: readonly number[]): number | undefined {
  if (mediaTimes.length < 3) return undefined;
  const deltas: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    deltas.push(mediaTimes[i] - mediaTimes[i - 1]);
  }
  deltas.sort((a, b) => a - b);
  const middle = deltas.length >> 1;
  const median = deltas.length % 2 === 1 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2;
  const rate = 1 / median;
  if (!Number.isFinite(rate)) return undefined;
  return snapFrameRate(rate);
}

/**
 * Play `video` muted and read its frame rate off the frames it presents.
 *
 * Collects `requestVideoFrameCallback`'s `mediaTime` until `maxFrames` frames
 * have been presented or `maxMs` has passed, then pauses the element, seeks it
 * back to 0 and answers `rateFromMediaTimes` of what it saw. Answers
 * `undefined` — without playing — for an element with no
 * `requestVideoFrameCallback`, and `undefined` at once when the browser
 * refuses to play. The caller owns the element and its `src`, which must stay
 * live until this settles.
 *
 * Settles exactly once: pausing a play() that has not resolved yet rejects it
 * with an AbortError, and that rejection arrives at `finish` after `finish`
 * has already run.
 */
export function measureFrameRate(
  video: HTMLVideoElement,
  { maxFrames, maxMs }: FrameRateProbeOptions
): Promise<number | undefined> {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const mediaTimes: number[] = [];
    let handle = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      video.cancelVideoFrameCallback(handle);
      video.pause();
      video.currentTime = 0;
      resolve(rateFromMediaTimes(mediaTimes));
    };

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      mediaTimes.push(metadata.mediaTime);
      if (mediaTimes.length >= maxFrames) {
        finish();
        return;
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };

    const deadline = setTimeout(finish, maxMs);
    video.muted = true;
    handle = video.requestVideoFrameCallback(onFrame);
    video.play().catch(finish);
  });
}
