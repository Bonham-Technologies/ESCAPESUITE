import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdScreenAwake } from './screenWakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('holdScreenAwake', () => {
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sentinels = [];
    request = vi.fn(async () => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return s;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('requests a screen lock and reports it held', async () => {
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    await flush();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    hold.release();
  });

  it('releases the lock when released, once, however often it is called', async () => {
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    await flush();
    hold.release();
    hold.release();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('releases when its signal aborts (a cancelled job)', async () => {
    const controller = new AbortController();
    holdScreenAwake({ signal: controller.signal });
    await flush();
    controller.abort();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    holdScreenAwake({ signal: controller.signal });
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('releases a lock whose request resolves after release()', async () => {
    let resolve!: (s: FakeSentinel) => void;
    request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    hold.release();
    const late = new FakeSentinel();
    resolve(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalledWith(true);
  });

  it('does nothing when the API is missing', async () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(() => hold.release()).not.toThrow();
  });

  it('does nothing when the request is rejected', async () => {
    request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(() => hold.release()).not.toThrow();
  });

  it('does nothing when the request throws synchronously', async () => {
    request.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const onChange = vi.fn();
    holdScreenAwake({ onChange }).release();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-acquires after the page is hidden and shown again', async () => {
    const onChange = vi.fn();
    const hold = holdScreenAwake({ onChange });
    await flush();
    // The browser drops the lock when the page is hidden.
    setVisibility('hidden');
    await sentinels[0].release();
    expect(onChange).toHaveBeenLastCalledWith(false);
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(true);
    hold.release();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
  });

  it('does not request while the page is hidden, and does once it shows', async () => {
    setVisibility('hidden');
    const hold = holdScreenAwake();
    await flush();
    expect(request).not.toHaveBeenCalled();
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    hold.release();
  });

  it('does not double-request on visibilitychange while a lock is held', async () => {
    const hold = holdScreenAwake();
    await flush();
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    hold.release();
  });

  it('stops re-acquiring after release', async () => {
    const hold = holdScreenAwake();
    await flush();
    hold.release();
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing onChange and a failing sentinel release', async () => {
    const hold = holdScreenAwake({
      onChange: () => {
        throw new Error('listener');
      },
    });
    await flush();
    sentinels[0].release.mockRejectedValueOnce(new Error('x'));
    expect(() => hold.release()).not.toThrow();
    await flush();
  });
});
