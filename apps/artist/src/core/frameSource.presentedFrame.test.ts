import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTMLVideoFrameSource } from './frameSource';
import { elementSeekTarget } from './elementSeek';
import { MISSED_PRESENTATIONS_LIMIT, PRESENTED_FRAME_WAIT_MS } from './presentedFrame';
import { PresentingVideo, type PresentingVideoOptions } from '../test/doubles/presentingVideo';

/**
 * ESCSUITE-454: the `<video>` path (WebM and GIF go through `elementFrames.ts`;
 * this is the MP4 fallback, every MP4 export in Safari) drew the element as
 * soon as 'seeked' fired. Chromium can fire it while the frame the element
 * paints is still the one from before the seek, so an export sometimes held the
 * previous frame — the untrimmed start at a trimmed clip's frame 0, source
 * frame 7 at frame 8 — while the worker export of the same project was right.
 * `getFrame` now waits for the frame callback it registered before the seek.
 */

/** Long enough to show up as a stale frame, well inside the ceiling. */
const PRESENT_AFTER_MS = 40;

function sourceOver(options: PresentingVideoOptions) {
  const video = new PresentingVideo(options);
  const source = HTMLVideoFrameSource.fromElement('rec', video as unknown as HTMLVideoElement, 30, 'take.webm');
  return { video, source };
}

/** One request, driven by fake timers; resolves to the fake milliseconds it took and what it would draw. */
async function request(source: HTMLVideoFrameSource, video: PresentingVideo, time: number) {
  const started = Date.now();
  let shownAtReturn: number | undefined;
  const pending = source.getFrame(time).then((frame) => {
    shownAtReturn = video.shownTime;
    return frame;
  });
  while (shownAtReturn === undefined) await vi.advanceTimersByTimeAsync(1);
  await pending;
  return { elapsedMs: Date.now() - started, shown: shownAtReturn };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HTMLVideoFrameSource waits for the sought frame to be presented (ESCSUITE-454)', () => {
  it('hands back the sought frame, not the one before the seek, from a trimmed clip’s first frame on', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    const shown: number[] = [];
    const wanted: number[] = [];
    for (let n = 0; n < 10; n++) {
      const time = 0.5 + n / 30;
      shown.push((await request(source, video, time)).shown);
      wanted.push(elementSeekTarget(time));
    }
    expect(shown).toEqual(wanted);
  });

  it('registers the frame callback before it seeks, and leaves none behind', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    await request(source, video, 1);
    expect(video.calls).toEqual(['rvfc', 'seek']);
    expect(video.pending.size).toBe(0);
  });

  it('waits no longer than the frame takes to be presented', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    const { elapsedMs } = await request(source, video, 1);
    expect(elapsedMs).toBeLessThanOrEqual(PRESENT_AFTER_MS + 1);
  });

  it('does not wait for a request within half a frame of the element, which seeks nothing', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    await request(source, video, 1);
    video.calls.length = 0;
    const { elapsedMs } = await request(source, video, 1);
    expect(video.calls).toEqual([]);
    expect(elapsedMs).toBeLessThanOrEqual(1);
  });

  it('gives up on an element whose frame callback never fires after a paused seek: the ceiling twice, then not at all', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS, frameCallbacks: 'never' });
    const elapsed: number[] = [];
    for (let n = 0; n < 6; n++) elapsed.push((await request(source, video, 1 + n / 30)).elapsedMs);
    const waited = elapsed.slice(0, MISSED_PRESENTATIONS_LIMIT);
    for (const ms of waited) {
      expect(ms).toBeGreaterThanOrEqual(PRESENTED_FRAME_WAIT_MS);
      expect(ms).toBeLessThanOrEqual(PRESENTED_FRAME_WAIT_MS + 1);
    }
    for (const ms of elapsed.slice(MISSED_PRESENTATIONS_LIMIT)) expect(ms).toBeLessThanOrEqual(1);
    // Each callback it gave up on was cancelled, and none was asked for after.
    expect(video.pending.size).toBe(0);
    expect(video.calls.filter((call) => call === 'rvfc')).toHaveLength(MISSED_PRESENTATIONS_LIMIT);
    expect(video.calls.filter((call) => call === 'cancel')).toHaveLength(MISSED_PRESENTATIONS_LIMIT);
  });

  it('starts the miss count again when a callback arrives', async () => {
    const options: PresentingVideoOptions = { presentAfterMs: PRESENT_AFTER_MS };
    const { video, source } = sourceOver(options);
    // One miss: presented later than the ceiling.
    options.presentAfterMs = PRESENTED_FRAME_WAIT_MS + 100;
    await request(source, video, 1);
    // Then a prompt one, then another miss: never two in a row, so it keeps waiting.
    options.presentAfterMs = PRESENT_AFTER_MS;
    await request(source, video, 2);
    options.presentAfterMs = PRESENTED_FRAME_WAIT_MS + 100;
    await request(source, video, 3);
    options.presentAfterMs = PRESENT_AFTER_MS;
    const last = await request(source, video, 4);
    expect(last.shown).toBe(elementSeekTarget(4));
  });

  it('does not wait for, or count against the element, a request past the source’s end, which leaves it where it is', async () => {
    // A clip running past its source's end: every request there lands on the
    // end, and Chromium presents no frame for a seek that does not move the
    // element. Waiting the ceiling for one cost half a second a frame and, two
    // in a row, turned the wait off for the rest of the export.
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    video.duration = 2;
    expect((await request(source, video, 2.1)).shown).toBe(2);
    const elapsed: number[] = [];
    for (let n = 1; n <= 4; n++) elapsed.push((await request(source, video, 2.1 + n / 30)).elapsedMs);
    for (const ms of elapsed) expect(ms).toBeLessThanOrEqual(1);
    expect(video.pending.size).toBe(0);
    // Back in range, the element is still waited for.
    expect((await request(source, video, 1)).shown).toBe(elementSeekTarget(1));
  });

  it('draws at once, as before, from an element with no requestVideoFrameCallback', async () => {
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS, frameCallbacks: 'absent' });
    const { elapsedMs } = await request(source, video, 1);
    expect(elapsedMs).toBeLessThanOrEqual(1);
    expect(video.calls).toEqual(['seek']);
  });

  it('does not wait in a hidden tab, where no frame is presented, nor count it as a miss', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { video, source } = sourceOver({ presentAfterMs: PRESENT_AFTER_MS });
    for (let n = 0; n < 4; n++) {
      expect((await request(source, video, 1 + n / 30)).elapsedMs).toBeLessThanOrEqual(1);
    }
    expect(video.calls.filter((call) => call === 'rvfc')).toHaveLength(0);
    // Back in the foreground the element is still waited for.
    visibility.mockReturnValue('visible');
    expect((await request(source, video, 2)).shown).toBe(elementSeekTarget(2));
  });
});
