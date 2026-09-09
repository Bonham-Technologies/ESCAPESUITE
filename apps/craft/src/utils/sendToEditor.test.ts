import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendToEditor } from './sendToEditor';
import { analytics } from './analytics';

vi.mock('./analytics', () => ({
  analytics: {
    recordingSentToEditor: vi.fn(),
  },
}));

describe('sendToEditor', () => {
  let originalParent: typeof window.parent;
  let originalOpen: typeof window.open;
  let postMessage: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalParent = window.parent;
    originalOpen = window.open;
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
