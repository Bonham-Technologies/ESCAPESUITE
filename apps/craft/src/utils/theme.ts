// Theme management utility for ESCAPE Suite
// Supports light/dark/system themes with persistence and external API

import { getSetting, setSetting } from '../core/storage';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme-preference';
const DEFAULT_THEME: ThemePreference = 'dark';

// Internal state
let currentPreference: ThemePreference = DEFAULT_THEME;
let currentResolved: ResolvedTheme = 'dark';
let systemMediaQuery: MediaQueryList | null = null;
const subscribers: Set<(theme: ResolvedTheme) => void> = new Set();

/**
 * Get the system's preferred color scheme
 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolve a theme preference to an actual theme
 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return getSystemTheme();
  }
  return preference;
}

/**
 * Apply a theme to the document
 */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }

  currentResolved = theme;

  // Notify subscribers
  subscribers.forEach(callback => {
    try {
      callback(theme);
    } catch (e) {
      console.error('Theme subscriber error:', e);
    }
  });
}

/**
 * Load theme preference from storage
 */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await getSetting<ThemePreference>(THEME_STORAGE_KEY);
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored;
    }
  } catch (e) {
    console.warn('Failed to load theme preference:', e);
  }
  return DEFAULT_THEME;
}

/**
 * Save theme preference to storage
 */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await setSetting(THEME_STORAGE_KEY, preference);
  } catch (e) {
    console.error('Failed to save theme preference:', e);
  }
}

/**
 * Set the theme preference and apply it
 */
export async function setTheme(preference: ThemePreference): Promise<void> {
  currentPreference = preference;
  const resolved = resolveTheme(preference);
  applyTheme(resolved);
  await saveThemePreference(preference);

  // Dispatch custom event for cross-tab/component sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('escape-theme-changed', {
      detail: { preference, resolved }
    }));
  }
}

/**
 * Get the current theme preference
 */
export function getTheme(): ThemePreference {
  return currentPreference;
}

/**
 * Get the current resolved theme
 */
export function getResolvedTheme(): ResolvedTheme {
  return currentResolved;
}

/**
 * Subscribe to theme changes
 * Returns an unsubscribe function
 */
export function subscribe(callback: (theme: ResolvedTheme) => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Handle system theme change when in 'system' mode
 */
function handleSystemThemeChange(): void {
  if (currentPreference === 'system') {
    const resolved = getSystemTheme();
    applyTheme(resolved);
  }
}

/**
 * Parse theme from URL parameters
 */
export function parseThemeFromUrl(): ThemePreference | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const themeParam = params.get('theme');

  if (themeParam && ['light', 'dark', 'system'].includes(themeParam)) {
    return themeParam as ThemePreference;
  }

  return null;
}

/**
 * Initialize the theme system
 * - Loads saved preference (or uses URL override)
 * - Applies the theme
 * - Sets up system preference listener
 * - Exposes window.ESCAPE_THEME API
 */
export async function initTheme(): Promise<void> {
  // Check for URL override first (doesn't persist)
  const urlTheme = parseThemeFromUrl();

  if (urlTheme) {
    currentPreference = urlTheme;
  } else {
    currentPreference = await loadThemePreference();
  }

  // Apply the theme
  const resolved = resolveTheme(currentPreference);
  applyTheme(resolved);

  // Set up system preference listener
  if (typeof window !== 'undefined') {
    systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemMediaQuery.addEventListener('change', handleSystemThemeChange);
  }

  // Expose window API for external integrations
  exposeThemeAPI();
}

/**
 * Clean up theme system (for testing or unmount)
 */
export function cleanupTheme(): void {
  if (systemMediaQuery) {
    systemMediaQuery.removeEventListener('change', handleSystemThemeChange);
    systemMediaQuery = null;
  }
  subscribers.clear();
}

/**
 * Expose the theme API on window for external integrations
 */
function exposeThemeAPI(): void {
  if (typeof window === 'undefined') return;

  (window as Window & { ESCAPE_THEME: typeof ESCAPE_THEME_API }).ESCAPE_THEME = ESCAPE_THEME_API;
}

/**
 * The window.ESCAPE_THEME API object
 */
const ESCAPE_THEME_API = {
  /**
   * Set the theme preference
   * @param theme - 'light', 'dark', or 'system'
   */
  setTheme: async (theme: ThemePreference): Promise<void> => {
    if (!['light', 'dark', 'system'].includes(theme)) {
      console.error('Invalid theme:', theme);
      return;
    }
    await setTheme(theme);
  },

  /**
   * Get the current theme preference
   */
  getTheme: (): ThemePreference => getTheme(),

  /**
   * Get the currently applied theme (resolved from preference)
   */
  getResolvedTheme: (): ResolvedTheme => getResolvedTheme(),

  /**
   * Subscribe to theme changes
   * @param callback - Called when theme changes with the new resolved theme
   * @returns Unsubscribe function
   */
  subscribe: (callback: (theme: ResolvedTheme) => void): (() => void) => subscribe(callback),
};

// TypeScript declaration for window.ESCAPE_THEME
declare global {
  interface Window {
    ESCAPE_THEME: typeof ESCAPE_THEME_API;
  }
}
