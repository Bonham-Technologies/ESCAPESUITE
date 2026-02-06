// Theme storage adapter for ESCAPEPLAN
// Uses the shared storage module for IndexedDB access

import type { ThemeStorage, ThemePreference } from '@escapesuite/shared/theme';
import { getSetting, setSetting } from '@escapesuite/shared/storage';

const THEME_STORAGE_KEY = 'theme-preference';

/**
 * Theme storage implementation for ESCAPEPLAN
 * Uses the shared IndexedDB database via the storage module
 * Also saves to localStorage as fallback for initial page load
 */
export const themeStorage: ThemeStorage = {
  async load(): Promise<ThemePreference | null> {
    // Try IndexedDB first (shared with ESCAPECRAFT/ESCAPEARTIST)
    try {
      const stored = await getSetting<ThemePreference>(THEME_STORAGE_KEY);
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
      await setSetting(THEME_STORAGE_KEY, preference);
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
