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
 * The rates a measurement is snapped to: the whole-number and 1000/1001 (NTSC)
 * rates video is actually made at, from film to high-frame-rate capture.
 */
const STANDARD_RATES: readonly number[] = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120,
];

/**
 * How close, relative to a standard rate, a measurement must be to snap to it.
 * 1.5 % covers the millisecond rounding a WebM's timestamps carry over the
 * span of eight frames up to 60 fps (about 0.4 % at 30, 0.9 % at 60); at
 * 120 fps eight frames span 58 ms, ±1.7 %, and an unlucky reading rounds to
 * two decimals instead.
 */
const SNAP_TOLERANCE = 0.015;

/**
 * The nearest standard rate when it is within 1.5 %, else `rate` rounded to two
 * decimals. "Nearest" is what keeps a 24 or 30 fps source from being stored as
 * 23.976 or 29.97: the two are 0.1 % apart, and the measurement picks the one
 * it is closer to. From millisecond timestamps over eight frames they cannot
 * be told apart at all, so either answer is as right as the file allows.
 */
function snapFrameRate(rate: number): number {
  let nearest = STANDARD_RATES[0];
  let nearestOff = Infinity;
  for (const standard of STANDARD_RATES) {
    const off = Math.abs(rate - standard) / standard;
    if (off < nearestOff) {
      nearest = standard;
      nearestOff = off;
    }
  }
  return nearestOff <= SNAP_TOLERANCE ? nearest : Math.round(rate * 100) / 100;
}

/**
 * The frame rate a run of presented frames' `mediaTime`s implies.
 *
 * Not one over the median spacing: a WebM stamps frames in whole milliseconds,
 * so a 30 fps file's spacings are 33, 34, 33… ms and any one of them reads as
 * 30.30 or 29.41 — about 3 % out, at every rate, and stored as `'measured'`.
 * The median spacing is used only to **count** the intervals the run spans,
 * `k = round(span / median)`, and the rate is `k / span`, so the millisecond of
 * rounding is spread over the whole span rather than one interval. The median
 * rather than the mean so a dropped frame raises `k` instead of skewing the
 * spacing; and of the positive spacings only, so a repeated or reordered
 * presentation time cannot halve it. Then `snapFrameRate`.
 *
 * Fewer than three frames, a run that ends no later than it starts, or one too
 * short to hold a single interval answers `undefined`.
 */
export function rateFromMediaTimes(mediaTimes: readonly number[]): number | undefined {
  if (mediaTimes.length < 3) return undefined;
  const span = mediaTimes[mediaTimes.length - 1] - mediaTimes[0];
  if (!(span > 0)) return undefined;
  const spacings: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const spacing = mediaTimes[i] - mediaTimes[i - 1];
    if (spacing > 0) spacings.push(spacing);
  }
  spacings.sort((a, b) => a - b);
  const middle = spacings.length >> 1;
  const median =
    spacings.length % 2 === 1 ? spacings[middle] : (spacings[middle - 1] + spacings[middle]) / 2;
  const intervals = Math.round(span / median);
  if (intervals < 1) return undefined;
  return snapFrameRate(intervals / span);
}

/**
 * Play `video` muted and read its frame rate off the frames it presents.
 *
 * Seeks it to 0, then collects `requestVideoFrameCallback`'s `mediaTime`
 * until `maxFrames` frames have been presented or `maxMs` has passed, then
 * pauses the element, seeks it back to 0 and answers `rateFromMediaTimes` of
 * what it saw. Answers
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
    // From the first frame, wherever the element was left: the duration probe
    // leaves a headerless WebM at its end, where playing presents nothing.
    video.currentTime = 0;
    handle = video.requestVideoFrameCallback(onFrame);
    video.play().catch(finish);
  });
}
