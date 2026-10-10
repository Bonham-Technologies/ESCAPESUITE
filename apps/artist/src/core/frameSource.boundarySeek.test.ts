import { describe, it, expect } from 'vitest';
import { HTMLVideoFrameSource } from './frameSource';
import { ELEMENT_SEEK_BIAS, elementSeekTarget } from './elementSeek';

/**
 * ESCSUITE-265: an export asks the `<video>` path for frame-aligned times
 * (`clip.startTime + n / 30`), so most requests land exactly on a source
 * frame's start. Both measured engines quantise that seek to whole microseconds
 * and land one microsecond short of the frame on a third of those starts,
 * showing the frame before it:
 *
 * - Chromium 153 truncates the request (it reports `currentTime` 1.066666 for a
 *   seek to 1.0666…67) while its frame starts are rounded to the nearest
 *   microsecond, so the frames whose start has a fractional microsecond of .67
 *   (33333.33 µs apart at 30 fps: k = 2, 5, 8, …) come out one early;
 * - Firefox 155 misses the other third, the .33 starts (k = 1, 4, 7, …) — which
 *   is the "previous colour segment at export frame 25" (source frame 40) the
 *   ESCSUITE-254 parity run found.
 *
 * The two doubles below reproduce those measured patterns (Playwright's
 * Chromium 153 and Firefox 155; see `apps/artist/CLAUDE.md`'s "Seek target") —
 * models of the observations, not of either engine's source.
 */
const US = 1e6;

type Engine = {
  name: string;
  /** The request, in whole microseconds. */
  request: (seconds: number) => number;
  /** Frame `k`'s start at `rate` fps, in whole microseconds. */
  frameStart: (k: number, rate: number) => number;
};

const ENGINES: Engine[] = [
  {
    name: 'Chromium-like (request truncated, frame starts rounded)',
    request: (s) => Math.floor(s * US),
    frameStart: (k, rate) => Math.round((k / rate) * US),
  },
  {
    name: 'Firefox-like (request rounded, frame starts rounded up)',
    request: (s) => Math.round(s * US),
    frameStart: (k, rate) => Math.ceil((k / rate) * US),
  },
];

/** A paused `<video>` of a `rate` fps source that shows the frame its engine resolves a seek to. */
class QuantisingVideo extends EventTarget {
  readyState = 4;
  shownFrame = 0;
  readonly seeks: number[] = [];
  private time = 0;

  constructor(
    private readonly engine: Engine,
    private readonly rate: number
  ) {
    super();
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(seconds: number) {
    this.seeks.push(seconds);
    const requested = this.engine.request(seconds);
    this.time = requested / US;
    let k = 0;
    while (this.engine.frameStart(k + 1, this.rate) <= requested) k++;
    this.shownFrame = k;
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }

  pause() {}
}

describe('elementSeekTarget', () => {
  it('moves the seek forward by a bias of at least the microsecond engines quantise to', () => {
    expect(ELEMENT_SEEK_BIAS).toBeGreaterThanOrEqual(1e-6);
    expect(elementSeekTarget(1.5)).toBe(1.5 + ELEMENT_SEEK_BIAS);
  });

  it('keeps the bias far inside one frame even at 240 fps', () => {
    expect(ELEMENT_SEEK_BIAS).toBeLessThan(1 / 240 / 10);
  });
});

describe('HTMLVideoFrameSource on a frame start (ESCSUITE-265)', () => {
  for (const engine of ENGINES) {
    for (const rate of [30, 60]) {
      for (const start of [0, 0.5]) {
        it(`shows the requested frame for every 1/30 s request: ${engine.name}, ${rate} fps source, clip from ${start} s`, async () => {
          const video = new QuantisingVideo(engine, rate);
          const source = HTMLVideoFrameSource.fromElement('s', video as unknown as HTMLVideoElement, rate);
          const shown: number[] = [];
          const wanted: number[] = [];
          for (let n = 0; n < 45; n++) {
            const time = start + n / 30;
            await source.getFrame(time);
            shown.push(video.shownFrame);
            wanted.push(Math.round(time * rate));
          }
          expect(shown).toEqual(wanted);
        });
      }
    }
  }

  it('seeks the element to the biased target and reuses it for the same request', async () => {
    const video = new QuantisingVideo(ENGINES[0], 30);
    const source = HTMLVideoFrameSource.fromElement('s', video as unknown as HTMLVideoElement, 30);
    await source.getFrame(1);
    await source.getFrame(1);
    expect(video.seeks).toEqual([elementSeekTarget(1)]);
  });
});
