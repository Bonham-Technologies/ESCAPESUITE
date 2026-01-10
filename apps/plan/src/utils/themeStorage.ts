// Theme storage adapter for ESCAPEPLAN
// Uses IndexedDB for cross-app theme sync with ESCAPECRAFT/ESCAPEARTIST

import type { ThemeStorage, ThemePreference } from '@escapesuite/shared/theme';

const THEME_STORAGE_KEY = 'theme-preference';
const DB_NAME = 'video-editor-db';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';

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
 * Theme storage implementation for ESCAPEPLAN
 * Uses IndexedDB for cross-app sync, with localStorage fallback
 */
export const themeStorage: ThemeStorage = {
  async load(): Promise<ThemePreference | null> {
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

    return null;
  },

  async save(preference: ThemePreference): Promise<void> {
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
  },
};
