// Measuring a source's frame rate from the frames its own <video> presents
// (ESCSUITE-276).
//
// Before this, every imported video was stored at `frameRate: 30` — a
// placeholder nothing ever replaced — so anything that read the field (the
// in-page decoder's seek window first among them) was reading a constant.
// Containers do not answer the question through any API a page can reach, but
// the element does: `requestVideoFrameCallback` reports each presented frame's
// `mediaTime`, and the spacing between them is the rate.

/**
 * The import-time probe: eight frames or 500 ms, whichever first, at half speed.
 *
 * Half speed because `requestVideoFrameCallback` fires at most once per
 * *rendered* frame: at 1x on a 60 Hz display a 120 fps file shows every other
 * frame, and its callbacks describe a 60 fps file (review round 2). At 0.5x a
 * source up to twice the display's refresh rate can be sampled; at exactly
 * twice it is presented at the refresh rate with no headroom, and a real
 * 120 fps run reported a callback for only some of its frames.
 * `rateFromMediaTimes` counts the intervals from the compositor's own
 * presented-frame counter where the engine reports one, so a callback the page
 * missed — a busy main thread, a loaded machine — changes how many callbacks
 * the probe sees but not the rate it reads; without the counter it counts them
 * from the media times. A source faster than twice the refresh rate has frames
 * the compositor itself never presents, which neither count sees, and still
 * under-reads.
 *
 * 500 ms rather than 400 because half speed halves the media the budget
 * covers. 500 ms of wall time is 250 ms of media: at 24 fps that is six
 * intervals, seven frames, so the slowest common rate never reaches the
 * eight-frame cap (8 frames x 1/24 s = 333 ms of media = 667 ms of wall time)
 * but clears the three-frame floor with room; at 60 fps and above the cap
 * ends the probe first (8 frames at 60 fps = 133 ms of media, 267 ms of wall).
 * The coordinator ratified 500 over the brief's 400 in review round 3: about
 * seven frames at 24 fps rather than five, exact in the real 24 fps runs, for
 * 100 ms more once per import.
 */
export const FRAME_RATE_PROBE = { maxFrames: 8, maxMs: 500, playbackRate: 0.5 } as const;

export interface FrameRateProbeOptions {
  /** Stop once this many frames have been presented. */
  maxFrames: number;
  /** Stop after this long whatever has been presented. */
  maxMs: number;
  /** Play at this rate while probing; the element's own rate is put back after. */
  playbackRate: number;
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
 * span of eight frames (about 0.4 % at 30, 0.9 % at 60). At 120 fps eight
 * frames with none dropped span only 58 or 59 ms once rounded, which reads
 * 120.69 or 118.64 — both inside it. Dropped frames lengthen the span, which
 * only shrinks the rounding's share of it, so they never push a reading out.
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
 * The frame rate a run of presented frames implies, from each frame callback's
 * `mediaTime` and, where the engine reports it, its `presentedFrames`.
 *
 * Not one over a spacing: a WebM stamps frames in whole milliseconds, so a
 * 30 fps file's spacings are 33, 34, 33… ms and any one of them reads as 30.30
 * or 29.41 — about 3 % out, at every rate, and stored as `'measured'`. The rate
 * is `intervals / span`, the source intervals the run covers over its media
 * span, so the millisecond of rounding is spread over the whole span rather
 * than one interval. Then `snapFrameRate`.
 *
 * **The count, from the compositor** (review round 3, G1). `presentedFrames`
 * is the compositor's own count of the frames it has presented, so the count
 * between the first and last callback is the number of source intervals
 * between them, whatever the page missed. A busy main thread — the import's
 * own thumbnail and waveform work, a loaded machine — delays frame callbacks,
 * and can make every spacing the page sees a multiple of the true interval: a
 * 60 fps file read 20 and 16 from its media times alone in real Chromium. It
 * changes how many callbacks the probe sees, not the counter, which an
 * instrumented run matched to every media-time jump, one for one, quiet, loaded
 * and busy. A counter that advanced less than once per callback describes no
 * run of presented frames, and is refused. `droppedVideoFrames` is not read:
 * Chromium advances it about once per callback on every file, quiet or not,
 * while every presented frame is consecutive.
 *
 * **The count, from the media times** — the fallback for an engine whose frame
 * callbacks carry no `presentedFrames`. Each spacing is counted on its own, as
 * `round(spacing / smallest)` whole intervals, against the smallest positive
 * spacing in the run. A dropped frame therefore adds one interval wherever it
 * falls, and each spacing's rounding error stays inside that spacing — about
 * 4 % of one interval at 120 fps with millisecond stamps, so a gap of up to
 * about ten frames still counts exactly. Review round 2 (F1) found the count it
 * replaced, `round(span / median)`, wrong once frames drop: with millisecond
 * stamps the median of a 120 fps run is a rounded 8 ms against a true 8.33, and
 * over a long span the difference becomes a whole interval (a real run read
 * 126.87); and once half the spacings are doubled the median is a doubled one
 * and the rate halves. The smallest spacing is the true interval unless every
 * presented frame dropped one or more frames before it — a source faster than
 * twice the display's refresh rate, or a run under load — and then this count
 * under-reads, with nothing in the media times to show it. A repeated
 * presentation time (a zero spacing) counts nothing.
 *
 * On a variable-rate source (a screen capture, a MediaRecorder take) the
 * media-time count follows the closest pair of frames presented, so it errs
 * high, never low.
 *
 * Fewer than three frames, a run that ends no later than it starts, one whose
 * presentation times go backwards, or one whose counter advanced fewer times
 * than there were callbacks after the first answers `undefined`.
 */
export function rateFromMediaTimes(
  mediaTimes: readonly number[],
  presentedFrames?: readonly (number | undefined)[]
): number | undefined {
  if (mediaTimes.length < 3) return undefined;
  const last = mediaTimes.length - 1;
  const span = mediaTimes[last] - mediaTimes[0];
  if (!(span > 0)) return undefined;
  let smallest = Infinity;
  for (let i = 1; i < mediaTimes.length; i++) {
    const spacing = mediaTimes[i] - mediaTimes[i - 1];
    if (spacing < 0) return undefined;
    if (spacing > 0 && spacing < smallest) smallest = spacing;
  }

  // NaN — so the media times decide — unless both ends carry a finite count.
  const presented = (presentedFrames?.[last] ?? NaN) - (presentedFrames?.[0] ?? NaN);
  if (Number.isFinite(presented)) {
    // One presented frame per callback is the least a real run can show; with
    // three or more callbacks this also refuses a count below two.
    if (presented < last) return undefined;
    return snapFrameRate(presented / span);
  }

  // `span > 0` with no spacing negative means at least one is positive, and
  // that one counts at least one interval: `intervals` is never 0.
  let intervals = 0;
  for (let i = 1; i < mediaTimes.length; i++) {
    const spacing = mediaTimes[i] - mediaTimes[i - 1];
    if (spacing > 0) intervals += Math.round(spacing / smallest);
  }
  return snapFrameRate(intervals / span);
}

/**
 * Play `video` muted and read its frame rate off the frames it presents.
 *
 * Seeks it to 0, plays it at `playbackRate`, then collects
 * `requestVideoFrameCallback`'s `mediaTime` and `presentedFrames` until `maxFrames` frames have been
 * presented or `maxMs` has passed, then pauses the element, puts its own
 * playback rate back, seeks it to 0 and answers `rateFromMediaTimes` of what it
 * saw. `mediaTime` is media time, so the rate it reads is the file's whatever
 * speed it plays at. Answers
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
  { maxFrames, maxMs, playbackRate }: FrameRateProbeOptions
): Promise<number | undefined> {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const mediaTimes: number[] = [];
    const presentedFrames: (number | undefined)[] = [];
    let handle = 0;
    let finished = false;
    const previousPlaybackRate = video.playbackRate;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      video.cancelVideoFrameCallback(handle);
      video.pause();
      video.playbackRate = previousPlaybackRate;
      video.currentTime = 0;
      resolve(rateFromMediaTimes(mediaTimes, presentedFrames));
    };

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      mediaTimes.push(metadata.mediaTime);
      presentedFrames.push(metadata.presentedFrames);
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
    video.playbackRate = playbackRate;
    handle = video.requestVideoFrameCallback(onFrame);
    video.play().catch(finish);
  });
}
