import { describe, it, expect, vi } from 'vitest';
import { HTMLVideoFrameSource, FrameSourceFactory, seekToleranceFor } from './frameSource';
import { elementSeekTarget } from './elementSeek';

/**
 * ESCSUITE-263: the in-page frame source decides whether to seek from the
 * source's own frame rate (half a frame), not a hard-coded 30 fps.
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

function sourceFor(frameRate?: number) {
  const el = makeElement();
  const source = HTMLVideoFrameSource.fromElement('s', el as unknown as HTMLVideoElement, frameRate);
  return { el, source };
}

describe('seekToleranceFor', () => {
  it('is half a frame at a usable rate', () => {
    expect(seekToleranceFor(60)).toBeCloseTo(0.5 / 60, 12);
    expect(seekToleranceFor(120)).toBeCloseTo(0.5 / 120, 12);
  });

  it('floors a rate below 30 at 30 so the window never exceeds the 1/30 s request spacing', () => {
    expect(seekToleranceFor(10)).toBeCloseTo(0.5 / 30, 12);
    expect(seekToleranceFor(24)).toBeCloseTo(0.5 / 30, 12);
  });

  it.each([undefined, 0, -30, NaN, Infinity])('falls back to half a 30 fps frame for %s', (rate) => {
    expect(seekToleranceFor(rate)).toBeCloseTo(0.5 / 30, 12);
  });
});

describe('HTMLVideoFrameSource seek tolerance (ESCSUITE-263)', () => {
  it('seeks for each of two consecutive frames of a 60 fps source', async () => {
    const { el, source } = sourceFor(60);
    await source.getFrame(1);
    await source.getFrame(1 + 1 / 60);
    expect(el.seeks).toEqual([1, 1 + 1 / 60].map(elementSeekTarget));
  });

  it('seeks for each of two consecutive frames of a 30 fps source', async () => {
    const { el, source } = sourceFor(30);
    // At t = 2 the float difference is 0.033333333333333215 < 1/30: the old strict
    // `> 1/30` test skipped this seek and drew the previous frame again.
    await source.getFrame(2);
    await source.getFrame(2 + 1 / 30);
    expect(el.seeks).toEqual([2, 2 + 1 / 30].map(elementSeekTarget));
  });

  it('seeks for 1/30-spaced requests even when the rate is far below 30 fps', async () => {
    const { el, source } = sourceFor(10);
    await source.getFrame(2);
    await source.getFrame(2 + 1 / 30);
    expect(el.seeks).toHaveLength(2);
  });

  it('seeks once when the same time is asked twice', async () => {
    const { el, source } = sourceFor(60);
    await source.getFrame(2);
    await source.getFrame(2);
    expect(el.seeks).toEqual([elementSeekTarget(2)]);
  });

  it('skips a request closer than half a frame', async () => {
    const { el, source } = sourceFor(60);
    await source.getFrame(2);
    await source.getFrame(2 + 0.4 / 60);
    expect(el.seeks).toEqual([elementSeekTarget(2)]);
  });

  it('uses the 30 fps fallback when the rate is unknown', async () => {
    const near = sourceFor(undefined);
    await near.source.getFrame(2);
    await near.source.getFrame(2 + 0.4 / 30);
    expect(near.el.seeks).toHaveLength(1);

    const far = sourceFor(0);
    await far.source.getFrame(2);
    await far.source.getFrame(2 + 0.6 / 30);
    expect(far.el.seeks).toHaveLength(2);
  });

  it('is handed the rate by the factory', async () => {
    const el = makeElement();
    const source = new FrameSourceFactory(false).createFromElement(
      's',
      el as unknown as HTMLVideoElement,
      60
    );
    await source.getFrame(1);
    await source.getFrame(1 + 1 / 60);
    expect(el.seeks).toHaveLength(2);
  });

  it('is handed the rate by createSource on the <video> path', async () => {
    const el = makeElement() as SeekCountingVideo & { onloadeddata?: () => void; src?: string };
    const create = vi.spyOn(document, 'createElement').mockReturnValue(el as unknown as HTMLElement);
    try {
      const pending = new FrameSourceFactory(false).createSource(
        's',
        new Blob(['x'], { type: 'video/webm' }),
        'video/webm',
        undefined,
        undefined,
        60
      );
      // Setting src is what the loader waits on; answer it.
      await vi.waitFor(() => expect(el.onloadeddata).toBeTypeOf('function'));
      el.onloadeddata!();
      const source = await pending;
      await source.getFrame(1);
      await source.getFrame(1 + 1 / 60);
      expect(el.seeks).toHaveLength(2);
    } finally {
      create.mockRestore();
    }
  });
});
