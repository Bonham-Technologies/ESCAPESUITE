import { describe, it, expect } from 'vitest';
import { HTMLVideoFrameSource, seekToleranceFor } from './frameSource';
import { elementSeekTarget } from './elementSeek';
import { rateFromMediaTimes } from './frameRateProbe';

/**
 * ESCSUITE-276 x ESCSUITE-263: a rate measured at import reaches the in-page
 * decoder's seek window, so a 120 fps source is no longer treated as 30.
 */
class SeekCountingVideo extends EventTarget {
  currentTime = 0; // replaced by an accessor in makeElement: assigning it is the seek
  readyState = 4;
  seeks: number[] = [];
  pause() {}
}

function makeElement(): SeekCountingVideo {
  const el = new SeekCountingVideo();
  let time = 0;
  Object.defineProperty(el, 'currentTime', {
    get: () => time,
    set: (t: number) => {
      time = t;
      el.seeks.push(t);
      queueMicrotask(() => el.dispatchEvent(new Event('seeked')));
    },
  });
  return el;
}

describe('a measured 120 fps source (ESCSUITE-276)', () => {
  it('seeks within 1/240 s, where the placeholder 30 seeked within 1/60 s', async () => {
    const measured = rateFromMediaTimes(Array.from({ length: 8 }, (_, i) => i / 120));
    expect(measured).toBe(120);
    expect(seekToleranceFor(measured)).toBeCloseTo(1 / 240, 12);
    expect(seekToleranceFor(30)).toBeCloseTo(1 / 60, 12);

    const real = makeElement();
    const source = HTMLVideoFrameSource.fromElement('s', real as unknown as HTMLVideoElement, measured);
    await source.getFrame(2);
    await source.getFrame(2 + 1 / 120);
    // Each seek lands ELEMENT_SEEK_BIAS past its request (ESCSUITE-265); the
    // point here is that there are two of them.
    expect(real.seeks).toEqual([2, 2 + 1 / 120].map(elementSeekTarget));

    // The same two requests at the old placeholder rate: the second is inside
    // 1/60 s and is skipped, repeating the previous frame.
    const placeholder = makeElement();
    const assumed = HTMLVideoFrameSource.fromElement('s', placeholder as unknown as HTMLVideoElement, 30);
    await assumed.getFrame(2);
    await assumed.getFrame(2 + 1 / 120);
    expect(placeholder.seeks).toEqual([elementSeekTarget(2)]);
  });
});
