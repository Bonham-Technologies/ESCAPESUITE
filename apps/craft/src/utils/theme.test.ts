import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSystemTheme,
  resolveTheme,
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  setTheme,
  getTheme,
  getResolvedTheme,
  subscribe,
  parseThemeFromUrl,
  initTheme,
  cleanupTheme,
  type ThemePreference,
} from './theme';

// Mock the storage module
vi.mock('../core/storage', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting, setSetting } from '../core/storage';

describe('theme utilities', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Store original matchMedia
    originalMatchMedia = window.matchMedia;

    // Reset DOM
    document.documentElement.removeAttribute('data-theme');

    // Mock matchMedia for system theme detection
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia;

    // Clean up theme
    cleanupTheme();

    // Reset DOM
    document.documentElement.removeAttribute('data-theme');
  });

  describe('getSystemTheme', () => {
    it('returns dark when system prefers dark', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      expect(getSystemTheme()).toBe('dark');
    });

    it('returns light when system prefers light', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      expect(getSystemTheme()).toBe('light');
    });
  });

  describe('resolveTheme', () => {
    it('returns light for light preference', () => {
      expect(resolveTheme('light')).toBe('light');
    });

    it('returns dark for dark preference', () => {
      expect(resolveTheme('dark')).toBe('dark');
    });

    it('returns system theme for system preference', () => {
      // Mock dark system theme
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      expect(resolveTheme('system')).toBe('dark');

      // Mock light system theme
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      expect(resolveTheme('system')).toBe('light');
    });
  });

  describe('applyTheme', () => {
    it('sets data-theme attribute for light theme', () => {
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('removes data-theme attribute for dark theme', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('notifies subscribers when theme changes', () => {
      const callback = vi.fn();
      subscribe(callback);

      applyTheme('light');

      expect(callback).toHaveBeenCalledWith('light');
    });
  });

  describe('loadThemePreference', () => {
    it('returns stored preference from IndexedDB', async () => {
      vi.mocked(getSetting).mockResolvedValue('light');

      const result = await loadThemePreference();

      expect(getSetting).toHaveBeenCalledWith('theme-preference');
      expect(result).toBe('light');
    });

    it('returns default dark theme when no stored preference', async () => {
      vi.mocked(getSetting).mockResolvedValue(null);

      const result = await loadThemePreference();

      expect(result).toBe('dark');
    });

    it('returns default dark theme for invalid stored value', async () => {
      vi.mocked(getSetting).mockResolvedValue('invalid');

      const result = await loadThemePreference();

      expect(result).toBe('dark');
    });

    it('returns default dark theme on storage error', async () => {
      vi.mocked(getSetting).mockRejectedValue(new Error('Storage error'));

      const result = await loadThemePreference();

      expect(result).toBe('dark');
    });
  });

  describe('saveThemePreference', () => {
    it('saves preference to IndexedDB', async () => {
      await saveThemePreference('light');

      expect(setSetting).toHaveBeenCalledWith('theme-preference', 'light');
    });

    it('handles storage errors gracefully', async () => {
      vi.mocked(setSetting).mockRejectedValue(new Error('Storage error'));

      // Should not throw
      await expect(saveThemePreference('light')).resolves.toBeUndefined();
    });
  });

  describe('setTheme', () => {
    it('applies theme and saves preference', async () => {
      await setTheme('light');

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(setSetting).toHaveBeenCalledWith('theme-preference', 'light');
    });

    it('dispatches custom event on theme change', async () => {
      const eventHandler = vi.fn();
      window.addEventListener('escape-theme-changed', eventHandler);

      await setTheme('light');

      expect(eventHandler).toHaveBeenCalled();

      window.removeEventListener('escape-theme-changed', eventHandler);
    });
  });

  describe('getTheme and getResolvedTheme', () => {
    it('returns current theme preference', async () => {
      await setTheme('light');
      expect(getTheme()).toBe('light');
    });

    it('returns resolved theme', async () => {
      await setTheme('light');
      expect(getResolvedTheme()).toBe('light');
    });

    it('resolves system theme correctly', async () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      await setTheme('system');

      expect(getTheme()).toBe('system');
      expect(getResolvedTheme()).toBe('dark');
    });
  });

  describe('subscribe', () => {
    it('calls callback on theme change', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      await setTheme('light');

      expect(callback).toHaveBeenCalledWith('light');

      unsubscribe();
    });

    it('unsubscribe stops receiving updates', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      unsubscribe();
      callback.mockClear();

      await setTheme('light');

      expect(callback).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      subscribe(callback1);
      subscribe(callback2);

      await setTheme('light');

      expect(callback1).toHaveBeenCalledWith('light');
      expect(callback2).toHaveBeenCalledWith('light');
    });
  });

  describe('parseThemeFromUrl', () => {
    it('returns null when no theme param', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });

      expect(parseThemeFromUrl()).toBeNull();
    });

    it('parses light theme from URL', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?theme=light' },
        writable: true,
      });

      expect(parseThemeFromUrl()).toBe('light');
    });

    it('parses dark theme from URL', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?theme=dark' },
        writable: true,
      });

      expect(parseThemeFromUrl()).toBe('dark');
    });

    it('parses system theme from URL', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?theme=system' },
        writable: true,
      });

      expect(parseThemeFromUrl()).toBe('system');
    });

    it('returns null for invalid theme value', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '?theme=invalid' },
        writable: true,
      });

      expect(parseThemeFromUrl()).toBeNull();
    });
  });

  describe('initTheme', () => {
    it('loads and applies stored preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('light');
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });

      await initTheme();

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('applies URL parameter over stored preference', async () => {
      vi.mocked(getSetting).mockResolvedValue('dark');
      Object.defineProperty(window, 'location', {
        value: { search: '?theme=light' },
        writable: true,
      });

      await initTheme();

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('exposes window.ESCAPE_THEME API', async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });

      await initTheme();

      expect(window.ESCAPE_THEME).toBeDefined();
      expect(typeof window.ESCAPE_THEME.setTheme).toBe('function');
      expect(typeof window.ESCAPE_THEME.getTheme).toBe('function');
      expect(typeof window.ESCAPE_THEME.getResolvedTheme).toBe('function');
      expect(typeof window.ESCAPE_THEME.subscribe).toBe('function');
    });

    it('sets up system preference listener', async () => {
      const addEventListenerMock = vi.fn();
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: '',
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
      }));

      vi.mocked(getSetting).mockResolvedValue(null);
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });

      await initTheme();

      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('cleanupTheme', () => {
    it('removes system preference listener', async () => {
      const removeEventListenerMock = vi.fn();
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerMock,
      }));

      vi.mocked(getSetting).mockResolvedValue(null);
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });

      await initTheme();
      cleanupTheme();

      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('clears all subscribers', async () => {
      const callback = vi.fn();
      subscribe(callback);

      cleanupTheme();
      callback.mockClear();

      applyTheme('light');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('window.ESCAPE_THEME API', () => {
    beforeEach(async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      Object.defineProperty(window, 'location', {
        value: { search: '' },
        writable: true,
      });
      await initTheme();
    });

    it('setTheme applies theme correctly', async () => {
      await window.ESCAPE_THEME.setTheme('light');

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('setTheme rejects invalid themes', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await window.ESCAPE_THEME.setTheme('invalid' as ThemePreference);

      expect(consoleSpy).toHaveBeenCalledWith('Invalid theme:', 'invalid');

      consoleSpy.mockRestore();
    });

    it('getTheme returns current preference', async () => {
      await window.ESCAPE_THEME.setTheme('light');

      expect(window.ESCAPE_THEME.getTheme()).toBe('light');
    });

    it('getResolvedTheme returns resolved theme', async () => {
      await window.ESCAPE_THEME.setTheme('light');

      expect(window.ESCAPE_THEME.getResolvedTheme()).toBe('light');
    });

    it('subscribe works through API', async () => {
      const callback = vi.fn();
      const unsubscribe = window.ESCAPE_THEME.subscribe(callback);

      await window.ESCAPE_THEME.setTheme('light');

      expect(callback).toHaveBeenCalledWith('light');

      unsubscribe();
    });
  });
});
