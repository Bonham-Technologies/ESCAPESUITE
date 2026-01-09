// Theme management utility for ESCAPE Suite
// Supports light/dark/system themes with persistence and external API
// Uses native IndexedDB API to share preferences with ESCAPECRAFT/ESCAPEARTIST

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme-preference';
const DEFAULT_THEME: ThemePreference = 'dark';
const DB_NAME = 'video-editor-db';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';

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
 * Open the shared IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create stores if they don't exist (for compatibility)
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
  });
}

/**
 * Get a setting from IndexedDB
 */
async function getSettingFromDB<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.get(key);

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        db.close();
        resolve(request.result as T | undefined);
      };
    });
  } catch (e) {
    console.warn('IndexedDB read failed:', e);
    return undefined;
  }
}

/**
 * Save a setting to IndexedDB
 */
async function setSettingInDB(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.put(value, key);

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        db.close();
        resolve();
      };
    });
  } catch (e) {
    console.error('IndexedDB write failed:', e);
  }
}

/**
 * Load theme preference from storage
 * Tries IndexedDB first (shared with other apps), falls back to localStorage
 */
export async function loadThemePreference(): Promise<ThemePreference> {
  // Try IndexedDB first (shared with ESCAPECRAFT/ESCAPEARTIST)
  try {
    const stored = await getSettingFromDB<ThemePreference>(THEME_STORAGE_KEY);
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored;
    }
  } catch (e) {
    console.warn('Failed to load theme from IndexedDB:', e);
  }

  // Fall back to localStorage
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored as ThemePreference;
    }
  } catch (e) {
    console.warn('Failed to load theme from localStorage:', e);
  }

  return DEFAULT_THEME;
}

/**
 * Save theme preference to storage
 * Saves to both IndexedDB (for cross-app sync) and localStorage (fallback)
 */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  // Save to IndexedDB for cross-app sync
  try {
    await setSettingInDB(THEME_STORAGE_KEY, preference);
  } catch (e) {
    console.error('Failed to save theme to IndexedDB:', e);
  }

  // Also save to localStorage as fallback
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch (e) {
    console.error('Failed to save theme to localStorage:', e);
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
