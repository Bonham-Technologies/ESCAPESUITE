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

/**
 * ESCSUITE-495: a WebM timecode holds whole milliseconds, so a source's frame
 * starts are stored rounded to the nearest one — a 30 fps frame at 66.67 ms
 * at 67 ms, a third of a millisecond late — and the element shows the frame
 * whose stored start is at or before the seek. Each engine above, reading such
 * a file.
 */
const MS_ROUNDED: Engine[] = ENGINES.map((engine) => ({
  name: `${engine.name.split(' (')[0]} reading millisecond timecodes`,
  request: engine.request,
  frameStart: (k, rate) => Math.round((k / rate) * 1e3) * 1e3,
}));

/** Frame rates a source is commonly recorded or rendered at, NTSC ones included. */
const SOURCE_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60, 120, 240];

/** The bias the 0.1 ms one was (ESCSUITE-265), which a millisecond timecode defeats. */
const PREVIOUS_BIAS = 1e-4;

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

  it('moves it past the half millisecond a timecode rounded to the millisecond can be late (ESCSUITE-495)', () => {
    expect(ELEMENT_SEEK_BIAS).toBeGreaterThan(0.5e-3 + 1e-6);
  });

  it('keeps the bias inside a quarter of a frame even at 240 fps', () => {
    expect(ELEMENT_SEEK_BIAS).toBeLessThan(1 / 240 / 4);
  });

  /** The frame an engine shows for a seek to `seconds` in a `rate` fps source. */
  function shownFrame(engine: Engine, rate: number, seconds: number): number {
    const requested = engine.request(seconds);
    let k = 0;
    while (engine.frameStart(k + 1, rate) <= requested) k++;
    return k;
  }

  for (const engine of [...ENGINES, ...MS_ROUNDED]) {
    it(`lands a request on a frame's start, half way in, or 2 ms before the next on that frame: ${engine.name}`, () => {
      const wrong: string[] = [];
      for (const rate of SOURCE_RATES) {
        // 2 ms before the next frame: the bias, plus the half millisecond its
        // timecode can be early, plus room for the engine's microsecond.
        const offsets = [0, 0.5 / rate, 1 / rate - 2e-3];
        for (let k = 0; k < Math.ceil(rate * 3); k++) {
          for (const offset of offsets) {
            const shown = shownFrame(engine, rate, elementSeekTarget(k / rate + offset));
            if (shown !== k) wrong.push(`${rate.toFixed(3)} fps, frame ${k} + ${offset * 1e3} ms: showed ${shown}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it('treats a request within the bias before a frame start as that frame', () => {
    expect(shownFrame(ENGINES[0], 30, elementSeekTarget(1 - 0.9e-3))).toBe(30);
    expect(shownFrame(ENGINES[0], 30, elementSeekTarget(1 - 1.1e-3))).toBe(29);
  });

  it('the 0.1 ms bias showed the frame before a third of a 30 fps WebM source’s frames, which is the bug', () => {
    for (const engine of MS_ROUNDED) {
      const early = Array.from({ length: 90 }, (_, k) => k).filter(
        (k) => shownFrame(engine, 30, k / 30 + PREVIOUS_BIAS) !== k
      );
      expect(early).toEqual(Array.from({ length: 30 }, (_, i) => 3 * i + 2));
    }
  });
});

describe('HTMLVideoFrameSource on a frame start (ESCSUITE-265, ESCSUITE-495)', () => {
  for (const engine of [...ENGINES, ...MS_ROUNDED]) {
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
