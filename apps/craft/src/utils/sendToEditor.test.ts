import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendToEditor } from './sendToEditor';
import { analytics } from './analytics';

vi.mock('./analytics', () => ({
  analytics: {
    recordingSentToEditor: vi.fn(),
  },
}));

/** Point window.location.search at a query string for one test. */
function withSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });
}

describe('sendToEditor', () => {
  let originalParent: typeof window.parent;
  let originalOpen: typeof window.open;
  let originalLocation: Location;
  let postMessage: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalParent = window.parent;
    originalOpen = window.open;
    originalLocation = window.location;
    postMessage = vi.fn();
    openSpy = vi.fn();
    window.open = openSpy;
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    window.open = originalOpen;
  });

  it('records analytics regardless of embedding state', () => {
    sendToEditor('abc123');
    expect(analytics.recordingSentToEditor).toHaveBeenCalledTimes(1);
  });

  describe('when embedded', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'parent', {
        value: { postMessage },
        writable: true,
        configurable: true,
      });
    });

    it('posts SEND_TO_EDITOR to the parent and does not open a window', () => {
      const result = sendToEditor('abc123');

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'SEND_TO_EDITOR', payload: { id: 'abc123' } },
        '*'
      );
      expect(openSpy).not.toHaveBeenCalled();
      expect(result).toBe('posted');
    });

    it('addresses the post at a valid hostOrigin', () => {
      withSearch(`?hostOrigin=${encodeURIComponent('https://host.example')}`);

      sendToEditor('abc123');

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'SEND_TO_EDITOR', payload: { id: 'abc123' } },
        'https://host.example'
      );
    });

    it('falls back to the wildcard when hostOrigin is invalid', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      withSearch(`?hostOrigin=${encodeURIComponent('https://host.example/app')}`);

      sendToEditor('abc123');

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'SEND_TO_EDITOR', payload: { id: 'abc123' } },
        '*'
      );
      warn.mockRestore();
    });
  });

  describe('when not embedded', () => {
    it('opens the editor URL with loadVideo and does not postMessage', () => {
      const result = sendToEditor('abc123');

      expect(openSpy).toHaveBeenCalledWith('/artist/?loadVideo=abc123', 'escapeartist');
      expect(postMessage).not.toHaveBeenCalled();
      expect(result).toBe('opened');
    });
  });
});
