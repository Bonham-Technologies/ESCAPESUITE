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

  it('removes the document drag listeners when it unmounts mid-drag', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { progressBar, unmount } = mountPlayer();

    act(() => {
      fireEvent.mouseDown(progressBar, { clientX: 150 });
    });

    unmount();

    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('mousemove');
    expect(removedEvents).toContain('mouseup');

    removeSpy.mockRestore();
  });
});
