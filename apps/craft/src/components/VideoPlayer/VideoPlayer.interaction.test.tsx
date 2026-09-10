import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';
import {
  installMediaErrorGlobal,
  uninstallMediaErrorGlobal,
  mediaError,
} from '../../test/doubles/video';

// jsdom implements <video> as an inert element: play()/pause() are "not
// implemented", duration/paused never change, getBoundingClientRect() is all
// zeroes and there is no MediaError interface. Everything below stands those
// four gaps up per element so the player's real logic runs against them.

const SRC = 'blob:http://localhost/recording';

function define(target: object, prop: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, prop, { configurable: true, ...descriptor });
}

interface MountOptions {
  autoPlay?: boolean;
  knownDuration?: number;
  title?: string;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

interface MountedPlayer {
  video: HTMLVideoElement;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  /** Report `value` from video.duration, then fire loadedmetadata. */
  load(value: number): void;
  setCurrentTime(value: number): void;
  progressBar: HTMLElement;
}

function mountPlayer(options: MountOptions = {}): MountedPlayer {
  render(<VideoPlayer src={SRC} {...options} />);
  const video = document.querySelector('video') as HTMLVideoElement;

  const play = vi.fn(() => {
    define(video, 'paused', { value: false, writable: true });
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    define(video, 'paused', { value: true, writable: true });
  });

  define(video, 'play', { value: play });
  define(video, 'pause', { value: pause });
  define(video, 'currentTime', { value: 0, writable: true });
  define(video, 'volume', { value: 1, writable: true });
  define(video, 'muted', { value: false, writable: true });
  define(video, 'paused', { value: true, writable: true });

  // The progress bar is measured with getBoundingClientRect(); give it a real
  // 200px-wide box anchored at x=100 so click maths is meaningful.
  const progressBar = document.querySelector('[class*="progressContainer"]') as HTMLElement;
  define(progressBar, 'getBoundingClientRect', {
    value: () => ({ left: 100, width: 200, top: 0, height: 8, right: 300, bottom: 8, x: 100, y: 0, toJSON: () => ({}) }),
  });

  return {
    video,
    play,
    pause,
    load(value: number) {
      define(video, 'duration', { get: () => value });
      act(() => {
        fireEvent.loadedMetadata(video);
      });
    },
    setCurrentTime(value: number) {
      define(video, 'currentTime', { value, writable: true });
      act(() => {
        fireEvent.timeUpdate(video);
      });
    },
    progressBar,
  };
}

function timeDisplay(): string {
  return document.querySelector('[class*="timeDisplay"]')!.textContent!;
}

function progressWidth(): string {
  return (document.querySelector('[class*="progressFilled"]') as HTMLElement).style.width;
}

beforeEach(() => {
  installMediaErrorGlobal();
});

afterEach(() => {
  uninstallMediaErrorGlobal();
  vi.restoreAllMocks();
});

describe('VideoPlayer duration reporting', () => {
  it('uses the video duration when it is finite and positive', () => {
    const player = mountPlayer({ knownDuration: 9 });
    player.load(120);
    expect(timeDisplay()).toBe('0:00 / 2:00');
  });

  it('falls back to knownDuration when the WebM reports Infinity', () => {
    const player = mountPlayer({ knownDuration: 42 });
    player.load(Infinity);
    expect(timeDisplay()).toBe('0:00 / 0:42');
  });

  it('falls back to knownDuration when the WebM reports a zero duration', () => {
    const player = mountPlayer({ knownDuration: 65 });
    player.load(0);
    expect(timeDisplay()).toBe('0:00 / 1:05');
  });

  it('shows 0:00 when the duration is unusable and no knownDuration was given', () => {
    const player = mountPlayer();
    player.load(Infinity);
    expect(timeDisplay()).toBe('0:00 / 0:00');
  });

  it('renders an hours component for long recordings', () => {
    const player = mountPlayer();
    player.load(3725); // 1:02:05
    expect(timeDisplay()).toBe('0:00 / 1:02:05');
  });

  it('renders 0:00 for a NaN playback position rather than "NaN:NaN"', () => {
    const player = mountPlayer();
    player.load(120);
    player.setCurrentTime(NaN);
    expect(timeDisplay()).toBe('0:00 / 2:00');
  });

  it('leaves the progress bar empty while the duration is still unknown', () => {
    mountPlayer();
    expect(progressWidth()).toBe('0%');
  });
});

describe('VideoPlayer seeking', () => {
  it('prefers fastSeek when the browser offers it', () => {
    const player = mountPlayer();
    const fastSeek = vi.fn();
    define(player.video, 'fastSeek', { value: fastSeek });
    player.load(100);

    act(() => {
      fireEvent.click(screen.getByTitle(/forward 5s/i));
    });

    expect(fastSeek).toHaveBeenCalledWith(5);
    expect(player.video.currentTime).toBe(0); // untouched — fastSeek did the work
    expect(timeDisplay()).toBe('0:05 / 1:40');
  });

  it('falls back to currentTime when fastSeek is absent', () => {
    const player = mountPlayer();
    player.load(100);
    player.setCurrentTime(30);

    act(() => {
      fireEvent.click(screen.getByTitle(/back 5s/i));
    });

    expect(player.video.currentTime).toBe(25);
  });

  it('clamps a seek past the end to the duration', () => {
    const player = mountPlayer();
    player.load(10);
    player.setCurrentTime(8);

    act(() => {
      fireEvent.click(screen.getByTitle(/forward 5s/i));
    });

    expect(player.video.currentTime).toBe(10);
  });

  it('clamps a seek before the start to zero', () => {
    const player = mountPlayer();
    player.load(100);
    player.setCurrentTime(2);

    act(() => {
      fireEvent.click(screen.getByTitle(/back 5s/i));
    });

    expect(player.video.currentTime).toBe(0);
  });

  it('ignores a seek before metadata has loaded', () => {
    const player = mountPlayer();

    act(() => {
      fireEvent.click(screen.getByTitle(/forward 5s/i));
    });

    expect(player.video.currentTime).toBe(0);
    expect(timeDisplay()).toBe('0:00 / 0:00');
  });

  it('survives a seek the media element refuses', () => {
    const player = mountPlayer();
    player.load(100);
    define(player.video, 'currentTime', {
      get: () => 0,
      set: () => {
        throw new Error('seek not supported');
      },
    });

    expect(() => {
      act(() => {
        fireEvent.click(screen.getByTitle(/forward 5s/i));
      });
    }).not.toThrow();

    // The refused seek left the displayed position where it was.
    expect(timeDisplay()).toBe('0:00 / 1:40');
  });
});

describe('VideoPlayer progress bar', () => {
  it('seeks to the clicked fraction of the duration', () => {
    const player = mountPlayer();
    player.load(200);

    act(() => {
      fireEvent.click(player.progressBar, { clientX: 150 }); // 25% of a 200px bar
    });

    expect(player.video.currentTime).toBe(50);
    expect(progressWidth()).toBe('25%');
  });

  it('ignores a click before metadata has loaded', () => {
    const player = mountPlayer();

    act(() => {
      fireEvent.click(player.progressBar, { clientX: 150 });
    });

    expect(player.video.currentTime).toBe(0);
  });

  it('scrubs while dragging and stops tracking on mouse up', () => {
    const player = mountPlayer();
    player.load(200);

    act(() => {
      fireEvent.mouseDown(player.progressBar, { clientX: 100 });
    });
    expect(player.video.currentTime).toBe(0);

    act(() => {
      fireEvent.mouseMove(document, { clientX: 250 }); // 75%
    });
    expect(player.video.currentTime).toBe(150);
    expect(progressWidth()).toBe('75%');

    // While seeking, timeupdate from the element must not fight the drag.
    define(player.video, 'currentTime', { value: 3, writable: true });
    act(() => {
      fireEvent.timeUpdate(player.video);
    });
    expect(progressWidth()).toBe('75%');

    act(() => {
      fireEvent.mouseUp(document);
    });

    // Listeners are gone: a later move must not move the playhead.
    act(() => {
      fireEvent.mouseMove(document, { clientX: 120 });
    });
    expect(player.video.currentTime).toBe(3);

    // ...and timeupdate is honoured again.
    define(player.video, 'currentTime', { value: 20, writable: true });
    act(() => {
      fireEvent.timeUpdate(player.video);
    });
    expect(progressWidth()).toBe('10%');
  });

  it('clamps a drag that leaves either end of the bar', () => {
    const player = mountPlayer();
    player.load(200);

    act(() => {
      fireEvent.mouseDown(player.progressBar, { clientX: 200 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 5000 });
    });
    expect(player.video.currentTime).toBe(200);

    act(() => {
      fireEvent.mouseMove(document, { clientX: -500 });
    });
    expect(player.video.currentTime).toBe(0);

    act(() => {
      fireEvent.mouseUp(document);
    });
  });
});

describe('VideoPlayer volume', () => {
  function showSlider(): HTMLInputElement {
    const container = document.querySelector('[class*="volumeContainer"]') as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(container);
    });
    return container.querySelector('input[type="range"]') as HTMLInputElement;
  }

  it('reveals the slider on hover and hides it again on leave', () => {
    mountPlayer();
    expect(document.querySelector('input[type="range"]')).toBeNull();

    const slider = showSlider();
    expect(slider).toBeTruthy();

    const container = document.querySelector('[class*="volumeContainer"]') as HTMLElement;
    act(() => {
      fireEvent.mouseLeave(container);
    });
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('applies a new volume to the element and switches to the low-volume icon', () => {
    const player = mountPlayer();
    player.load(100);
    const slider = showSlider();

    act(() => {
      fireEvent.change(slider, { target: { value: '0.3' } });
    });

    expect(player.video.volume).toBe(0.3);
    expect(player.video.muted).toBe(false);
    expect(screen.getByTitle('Mute (M)')).toBeTruthy();
  });

  it('mutes the element when the volume is dragged to zero', () => {
    const player = mountPlayer();
    const slider = showSlider();

    act(() => {
      fireEvent.change(slider, { target: { value: '0' } });
    });

    expect(player.video.volume).toBe(0);
    expect(player.video.muted).toBe(true);
    expect(screen.getByTitle('Unmute (M)')).toBeTruthy();
  });

  it('unmutes when the volume is raised off zero again', () => {
    const player = mountPlayer();
    const slider = showSlider();

    act(() => {
      fireEvent.change(slider, { target: { value: '0' } });
    });
    act(() => {
      fireEvent.change(slider, { target: { value: '0.8' } });
    });

    expect(player.video.volume).toBe(0.8);
    expect(player.video.muted).toBe(false);
    expect(screen.getByTitle('Mute (M)')).toBeTruthy();
  });

  it('reflects the muted state back on the slider', () => {
    const player = mountPlayer();
    const slider = showSlider();

    act(() => {
      fireEvent.click(screen.getByTitle('Mute (M)'));
    });

    expect(player.video.muted).toBe(true);
    expect(slider.value).toBe('0');

    act(() => {
      fireEvent.click(screen.getByTitle('Unmute (M)'));
    });
    expect(player.video.muted).toBe(false);
    expect(slider.value).toBe('1');
  });

  it('raises and lowers the volume with the arrow keys', () => {
    const player = mountPlayer();
    player.load(100);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    expect(player.video.volume).toBeCloseTo(0.9);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(player.video.volume).toBeCloseTo(1);

    // Already at the ceiling — stays clamped at 1.
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(player.video.volume).toBeCloseTo(1);
  });

  it('clamps the volume at zero when held down', () => {
    const player = mountPlayer();
    for (let i = 0; i < 12; i++) {
      act(() => {
        fireEvent.keyDown(window, { key: 'ArrowDown' });
      });
    }
    expect(player.video.volume).toBe(0);
  });
});

describe('VideoPlayer playback', () => {
  it('pauses a playing video when the button is pressed', () => {
    const player = mountPlayer();
    player.load(100);
    define(player.video, 'paused', { value: false, writable: true });
    act(() => {
      fireEvent.play(player.video);
    });

    act(() => {
      fireEvent.click(screen.getByTitle('Pause (Space)'));
    });

    expect(player.pause).toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('shows the play overlay again when the element reports it paused', () => {
    const player = mountPlayer();
    player.load(100);
    act(() => {
      fireEvent.play(player.video);
    });
    expect(document.querySelector('[class*="playOverlay"]')).toBeNull();

    act(() => {
      fireEvent.pause(player.video);
    });
    expect(document.querySelector('[class*="playOverlay"]')).toBeTruthy();
  });

  it('falls back to the paused state when play() is rejected', async () => {
    const player = mountPlayer({ autoPlay: true });
    player.load(100);
    define(player.video, 'play', { value: vi.fn().mockRejectedValue(new Error('gesture required')) });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/play|pause/i));
    });

    expect(document.querySelector('[class*="playOverlay"]')).toBeTruthy();
  });

  it('falls back to the paused state when a restart cannot autoplay', async () => {
    const player = mountPlayer({ autoPlay: true });
    player.load(100);
    player.setCurrentTime(40);
    define(player.video, 'play', { value: vi.fn().mockRejectedValue(new Error('gesture required')) });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Restart'));
    });

    expect(player.video.currentTime).toBe(0);
    expect(document.querySelector('[class*="playOverlay"]')).toBeTruthy();
  });

  it('rewinds and shows the play overlay when playback ends', () => {
    const player = mountPlayer();
    player.load(100);
    player.setCurrentTime(100);

    act(() => {
      fireEvent.ended(player.video);
    });

    expect(player.video.currentTime).toBe(0);
    expect(progressWidth()).toBe('0%');
    expect(document.querySelector('[class*="playOverlay"]')).toBeTruthy();
  });

  it('does nothing when play/pause is triggered on a failed video', () => {
    const player = mountPlayer();
    act(() => {
      fireEvent.error(player.video);
    });

    act(() => {
      fireEvent.click(document.querySelector('[class*="videoWrapper"]')!);
    });

    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });
});

describe('VideoPlayer error handling', () => {
  it('treats a decode error after load as non-fatal and keeps playing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = vi.fn();
    const player = mountPlayer({ onError });
    player.load(100);

    define(player.video, 'error', { value: mediaError('MEDIA_ERR_DECODE', 'decode hiccup') });
    act(() => {
      fireEvent.error(player.video);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText(/failed to load video/i)).toBeNull();
    expect(warn).toHaveBeenCalledWith('Video playback error (non-fatal):', 'decode hiccup');
  });

  it('treats an unsupported-source error after load as fatal', () => {
    const onError = vi.fn();
    const player = mountPlayer({ onError });
    player.load(100);

    define(player.video, 'error', { value: mediaError('MEDIA_ERR_SRC_NOT_SUPPORTED') });
    act(() => {
      fireEvent.error(player.video);
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByText(/failed to load video/i)).toBeTruthy();
  });

  it('does not require an onError handler to fail', () => {
    const player = mountPlayer();

    expect(() => {
      act(() => {
        fireEvent.error(player.video);
      });
    }).not.toThrow();
    expect(screen.getByText(/failed to load video/i)).toBeTruthy();
  });
});

describe('VideoPlayer keyboard shortcuts', () => {
  it('jumps to the start with 0 and Home, and to the end with End', () => {
    const player = mountPlayer();
    player.load(200);
    player.setCurrentTime(120);

    act(() => {
      fireEvent.keyDown(window, { key: 'End' });
    });
    expect(player.video.currentTime).toBe(200);

    act(() => {
      fireEvent.keyDown(window, { key: '0' });
    });
    expect(player.video.currentTime).toBe(0);

    player.setCurrentTime(75);
    act(() => {
      fireEvent.keyDown(window, { key: 'Home' });
    });
    expect(player.video.currentTime).toBe(0);
  });

  it('ignores an unhandled key', () => {
    const player = mountPlayer();
    player.load(200);
    player.setCurrentTime(50);

    act(() => {
      fireEvent.keyDown(window, { key: 'q' });
    });

    expect(player.video.currentTime).toBe(50);
    expect(player.play).not.toHaveBeenCalled();
  });

  it('stays out of the way while the user is typing in a field', () => {
    const player = mountPlayer();
    player.load(200);
    const container = document.querySelector('[class*="volumeContainer"]') as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(container);
    });
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

    act(() => {
      fireEvent.keyDown(slider, { key: ' ' });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
    });

    expect(player.play).not.toHaveBeenCalled();
    expect(player.video.currentTime).toBe(0);
  });

  it('ignores keystrokes coming from a textarea', () => {
    const player = mountPlayer();
    player.load(200);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    act(() => {
      fireEvent.keyDown(textarea, { key: ' ' });
    });

    expect(player.play).not.toHaveBeenCalled();
    textarea.remove();
  });

  it('tolerates Escape with no onClose handler', () => {
    mountPlayer();
    expect(() => {
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
    }).not.toThrow();
  });

  it('stops listening once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = render(<VideoPlayer src={SRC} onClose={onClose} />);
    unmount();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('VideoPlayer chrome', () => {
  // The title is the only thing in the right-hand controls slot, so the slot
  // being empty (no child element, no text) is what "no title" means. Asserting
  // on the slot rather than a CSS-module class matters here: vitest does not
  // process the CSS, so styles.title is the bare key 'title'.
  function controlsRight(): HTMLElement {
    return document.querySelector('[class*="controlsRight"]') as HTMLElement;
  }

  it('shows the title when one is given', () => {
    mountPlayer({ title: 'Standup 2026-09-09' });

    expect(screen.getByText('Standup 2026-09-09')).toBeTruthy();
    expect(controlsRight().children).toHaveLength(1);
    expect(controlsRight().textContent).toBe('Standup 2026-09-09');
  });

  it('renders nothing in the title slot when no title is given', () => {
    mountPlayer();

    expect(controlsRight().children).toHaveLength(0);
    expect(controlsRight().textContent).toBe('');
  });

  it('starts paused when autoPlay is off', () => {
    const player = mountPlayer({ autoPlay: false });
    player.load(100);
    expect(document.querySelector('[class*="playOverlay"]')).toBeTruthy();
    expect(player.video.hasAttribute('autoplay')).toBe(false);
  });
});
