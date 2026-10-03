// ESCSUITE-176 items 5 and 6 (probes m5 and m6).
//
// m5: the volume slider had no accessible name, and because it only mounted
// on hover, axe-core's "playback dialog passes axe-core audit" e2e spec could
// never see it to flag that. m6: the progress-bar drag installs two document
// listeners it removes only on its own mouseup — nothing removes them if the
// player unmounts mid-drag (the dialog closing from elsewhere, a `?loadVideo`
// navigation, HMR).
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';

const SRC = 'blob:http://localhost/recording';

function define(target: object, prop: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, prop, { configurable: true, ...descriptor });
}

function mountPlayer() {
  const view = render(<VideoPlayer src={SRC} />);
  const progressBar = document.querySelector('[class*="progressContainer"]') as HTMLElement;
  define(progressBar, 'getBoundingClientRect', {
    value: () => ({ left: 100, width: 200, top: 0, height: 8, right: 300, bottom: 8, x: 100, y: 0, toJSON: () => ({}) }),
  });
  return { ...view, progressBar };
}

describe('PROBE: VideoPlayer', () => {
  it('names the volume slider', () => {
    mountPlayer();

    const slider = document.querySelector('input[type="range"]');
    expect(slider?.getAttribute('aria-label') ?? '').toMatch(/volume/i);
  });

  // Review NIT 10: asserting the event *names* alone would also pass an
  // unmount cleanup that removed some other function under the same names —
  // a no-op against the listeners the drag actually installed. The pairs
  // removed must be exactly the pairs added.
  it('removes the exact (type, handler) pairs it added when it unmounts mid-drag', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { progressBar, unmount } = mountPlayer();

    act(() => {
      fireEvent.mouseDown(progressBar, { clientX: 150 });
    });

    const added = addSpy.mock.calls
      .filter(([type]) => type === 'mousemove' || type === 'mouseup')
      .map(([type, handler]) => [type, handler]);
    expect(added).toHaveLength(2);

    unmount();

    const removed = removeSpy.mock.calls
      .filter(([type]) => type === 'mousemove' || type === 'mouseup')
      .map(([type, handler]) => [type, handler]);
    expect(removed).toEqual(added);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
